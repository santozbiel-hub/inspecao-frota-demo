/**
 * Backend de teste que fala o suficiente de PostgREST / GoTrue / Storage
 * para o `@supabase/supabase-js` conversar com ele.
 *
 * Por que existe: o Docker Hub está bloqueado no ambiente de build, então
 * não deu para subir o stack local do Supabase. Este processo põe o
 * PostgREST de lado, mas mantém o que importa nos testes: cada requisição
 * roda no Postgres de verdade, dentro de uma transação, como a role
 * `authenticated` e com `request.jwt.claim.sub` preenchido — exatamente
 * como o PostgREST faz. Ou seja, o RLS exercitado aqui é o RLS real, com
 * as policies das migrations, e não uma imitação.
 *
 * NÃO faz parte da aplicação. Só é usado por `npm run test:e2e`.
 */
import http from "node:http";
import { Buffer } from "node:buffer";
import pg from "pg";

const PORT = Number(process.env.FAKE_SUPABASE_PORT ?? 54329);
const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres@/bp_e2e?host=/tmp&port=5433";

// O PostgREST devolve `date` como "YYYY-MM-DD"; o driver do node, por
// padrão, converte para Date e o JSON vira um timestamp. Sem isto o
// backend de teste mentiria sobre o formato e mascararia bugs de data.
pg.types.setTypeParser(1082, (v) => v);   // date
pg.types.setTypeParser(1114, (v) => v);   // timestamp
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 8 });

/** Arquivos do "Storage" ficam em memória: o teste só precisa saber que
 *  subiram, com que tamanho e em que caminho. */
const objetos = new Map();

// Modo de rede controlado pelo teste: "online" | "offline".
let modo = "online";

// ----------------------------------------------------------------- JWT
function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function criarToken(uid, email) {
  const agora = Math.floor(Date.now() / 1000);
  const payload = {
    sub: uid,
    email,
    role: "authenticated",
    aud: "authenticated",
    iat: agora,
    exp: agora + 3600,
  };
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.assinatura-de-teste`;
}

function uidDoToken(req) {
  const auth = req.headers.authorization ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------- filtros
const OPERADORES = {
  eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike",
};

function montarWhere(params, valores) {
  const partes = [];
  for (const [coluna, bruto] of params) {
    if (["select", "on_conflict", "order", "limit", "offset", "columns"].includes(coluna)) continue;
    const m = /^([a-z]+)\.(.*)$/s.exec(bruto);
    if (!m) continue;
    const [, op, valor] = m;
    if (op === "is") {
      partes.push(`"${coluna}" is ${valor === "null" ? "null" : valor}`);
      continue;
    }
    if (op === "in") {
      const itens = valor.replace(/^\(|\)$/g, "").split(",");
      const marcadores = itens.map((v) => {
        valores.push(v.replace(/^"|"$/g, ""));
        return `$${valores.length}`;
      });
      partes.push(`"${coluna}" in (${marcadores.join(",")})`);
      continue;
    }
    const sqlOp = OPERADORES[op];
    if (!sqlOp) continue;
    valores.push(valor);
    partes.push(`"${coluna}" ${sqlOp} $${valores.length}`);
  }
  return partes.length ? `where ${partes.join(" and ")}` : "";
}

async function comoUsuario(uid, fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query("begin");
    if (uid) {
      await cliente.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
      await cliente.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
      await cliente.query("set local role authenticated");
    } else {
      await cliente.query("set local role anon");
    }
    const r = await fn(cliente);
    await cliente.query("commit");
    return r;
  } catch (e) {
    await cliente.query("rollback").catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}

/** `.single()` do supabase-js pede um objeto, não um array — o PostgREST
 *  decide isso pelo Accept. Sem honrar esse cabeçalho, o cliente recebe
 *  um array onde espera uma linha, e o bug só aparece longe daqui. */
function talvezObjeto(req, linhas) {
  const aceita = String(req.headers.accept ?? "");
  if (!aceita.includes("vnd.pgrst.object")) return linhas;
  if (linhas.length === 1) return linhas[0];
  return { __erroPgrst: true, linhas: linhas.length };
}

function responder(res, status, corpo, extra = {}) {
  const texto = corpo === undefined ? "" : JSON.stringify(corpo);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-expose-headers": "*",
    ...extra,
  });
  res.end(texto);
}

function erroPg(res, e) {
  const status = e.code === "42501" ? 403 : e.code === "23505" ? 409 : e.code === "23514" ? 400 : 500;
  responder(res, status, {
    code: e.code ?? "500",
    message: e.message,
    details: e.detail ?? null,
    hint: e.hint ?? null,
  });
}

async function lerCorpo(req) {
  const pedacos = [];
  for await (const c of req) pedacos.push(c);
  return Buffer.concat(pedacos);
}

// ---------------------------------------------------------------- rotas
const servidor = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return responder(res, 204);

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const caminho = url.pathname;

  // Controle do teste: liga/desliga a "rede".
  if (caminho === "/__modo") {
    if (req.method === "POST") {
      modo = (await lerCorpo(req)).toString().trim() === "offline" ? "offline" : "online";
      return responder(res, 200, { modo });
    }
    return responder(res, 200, { modo, objetos: [...objetos.keys()] });
  }

  // Simula queda de rede: o cliente vê a mesma coisa que veria no pátio.
  if (modo === "offline" && !caminho.startsWith("/__")) {
    res.destroy();
    return;
  }

  try {
    // ---------------------------------------------------------- auth
    if (caminho === "/auth/v1/token") {
      const corpo = JSON.parse((await lerCorpo(req)).toString() || "{}");
      const { rows } = await pool.query(
        "select u.id, u.email, p.name from auth.users u join public.profiles p on p.id = u.id where u.email = $1 and p.active",
        [corpo.email],
      );
      if (!rows.length || corpo.password !== "senha-de-teste") {
        return responder(res, 400, { error: "invalid_grant", error_description: "Credenciais inválidas" });
      }
      const u = rows[0];
      return responder(res, 200, {
        access_token: criarToken(u.id, u.email),
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: `refresh-${u.id}`,
        user: { id: u.id, email: u.email, aud: "authenticated", role: "authenticated", user_metadata: { name: u.name }, app_metadata: {} },
      });
    }

    if (caminho === "/auth/v1/user") {
      const uid = uidDoToken(req);
      if (!uid) return responder(res, 401, { message: "sem sessão" });
      const { rows } = await pool.query("select id, email from auth.users where id = $1", [uid]);
      return responder(res, 200, { id: uid, email: rows[0]?.email, aud: "authenticated", role: "authenticated", user_metadata: {}, app_metadata: {} });
    }

    if (caminho === "/auth/v1/logout") return responder(res, 204);

    // ------------------------------------------------------- storage
    if (caminho.startsWith("/storage/v1/object/")) {
      const uid = uidDoToken(req);
      if (!uid) return responder(res, 401, { message: "sem sessão" });
      const resto = caminho.replace("/storage/v1/object/", "");
      const [bucket, ...pedaco] = resto.split("/");
      const nome = pedaco.join("/");
      if (req.method === "POST" || req.method === "PUT") {
        const bytes = await lerCorpo(req);
        if (bytes.length > 1024 * 1024) {
          return responder(res, 413, { message: "Payload too large", statusCode: "413" });
        }
        if (nome.split("/")[0] !== uid) {
          return responder(res, 403, { message: "new row violates row-level security policy", statusCode: "403" });
        }
        objetos.set(`${bucket}/${nome}`, { bytes: bytes.length, tipo: req.headers["content-type"] });
        return responder(res, 200, { Key: `${bucket}/${nome}`, Id: nome });
      }
      const obj = objetos.get(`${bucket}/${nome}`);
      if (!obj) return responder(res, 404, { message: "não encontrado" });
      return responder(res, 200, obj);
    }

    // ---------------------------------------------------------- rest
    if (caminho.startsWith("/rest/v1/")) {
      const uid = uidDoToken(req);
      const alvo = caminho.replace("/rest/v1/", "");
      const params = [...url.searchParams.entries()];
      const prefer = String(req.headers.prefer ?? "");
      const retornar = prefer.includes("return=representation");

      // RPC
      if (alvo.startsWith("rpc/")) {
        const fn = alvo.slice(4).replace(/[^a-z_]/g, "");
        const corpo = JSON.parse((await lerCorpo(req)).toString() || "{}");
        const nomes = Object.keys(corpo);
        const args = nomes.map((n, i) => `${n} => $${i + 1}`).join(", ");
        const linhas = await comoUsuario(uid, (c) =>
          c.query(`select * from public.${fn}(${args})`, nomes.map((n) => corpo[n])),
        );
        return responder(res, 200, linhas.rows);
      }

      const tabela = alvo.replace(/[^a-z_]/g, "");
      const selecao = url.searchParams.get("select") ?? "*";
      const colunas = selecao === "*" ? "*" : selecao.split(",").map((c) => `"${c.trim()}"`).join(",");

      if (req.method === "GET") {
        const valores = [];
        const where = montarWhere(params, valores);
        let sql = `select ${colunas} from public.${tabela} ${where}`;
        const ordem = url.searchParams.get("order");
        if (ordem) {
          const [col, dir] = ordem.split(".");
          sql += ` order by "${col}" ${dir === "desc" ? "desc" : "asc"}`;
        }
        const limite = url.searchParams.get("limit");
        if (limite) sql += ` limit ${Number(limite)}`;
        const r = await comoUsuario(uid, (c) => c.query(sql, valores));
        const saida = talvezObjeto(req, r.rows);
        if (saida?.__erroPgrst) {
          return responder(res, 406, {
            code: "PGRST116",
            message: `JSON object requested, multiple (or no) rows returned`,
            details: `Results contain ${saida.linhas} rows`,
          });
        }
        return responder(res, 200, saida);
      }

      if (req.method === "POST") {
        const corpo = JSON.parse((await lerCorpo(req)).toString() || "{}");
        const linhas = Array.isArray(corpo) ? corpo : [corpo];
        const cols = Object.keys(linhas[0]);
        const valores = [];
        const tuplas = linhas.map((l) => {
          const marcadores = cols.map((c) => {
            valores.push(l[c]);
            return `$${valores.length}`;
          });
          return `(${marcadores.join(",")})`;
        });
        let sql = `insert into public.${tabela} (${cols.map((c) => `"${c}"`).join(",")}) values ${tuplas.join(",")}`;
        const onConflict = url.searchParams.get("on_conflict");
        // O PostgREST aceita duas resoluções de conflito, e a diferença
        // entre elas é justamente o que distingue "regrava" de "não
        // duplica". Precisa valer aqui também, senão o teste não enxerga
        // erro de RLS que só aparece no caminho de UPDATE.
        if (prefer.includes("resolution=ignore-duplicates")) {
          const alvoConflito = onConflict
            ? onConflict.split(",").map((c) => `"${c.trim()}"`).join(",")
            : `"id"`;
          sql += ` on conflict (${alvoConflito}) do nothing`;
        } else if (prefer.includes("resolution=merge-duplicates")) {
          const alvoConflito = onConflict
            ? onConflict.split(",").map((c) => `"${c.trim()}"`).join(",")
            : cols.map((c) => `"${c}"`).join(",");
          const set = cols
            .filter((c) => !(onConflict ?? "").split(",").map((x) => x.trim()).includes(c))
            .map((c) => `"${c}" = excluded."${c}"`)
            .join(", ");
          sql += ` on conflict (${alvoConflito}) do update set ${set || `"${cols[0]}" = excluded."${cols[0]}"`}`;
        }
        sql += " returning *";
        const r = await comoUsuario(uid, (c) => c.query(sql, valores));
        return responder(res, 201, retornar ? talvezObjeto(req, r.rows) : null);
      }

      if (req.method === "PATCH") {
        const corpo = JSON.parse((await lerCorpo(req)).toString() || "{}");
        const valores = [];
        const sets = Object.keys(corpo).map((c) => {
          valores.push(corpo[c]);
          return `"${c}" = $${valores.length}`;
        });
        const where = montarWhere(params, valores);
        if (!where) return responder(res, 400, { message: "PATCH sem filtro" });
        const sql = `update public.${tabela} set ${sets.join(", ")} ${where} returning *`;
        const r = await comoUsuario(uid, (c) => c.query(sql, valores));
        return responder(res, 200, retornar ? talvezObjeto(req, r.rows) : null);
      }

      if (req.method === "DELETE") {
        const valores = [];
        const where = montarWhere(params, valores);
        if (!where) return responder(res, 400, { message: "DELETE sem filtro" });
        const r = await comoUsuario(uid, (c) =>
          c.query(`delete from public.${tabela} ${where} returning *`, valores),
        );
        return responder(res, 200, retornar ? r.rows : null);
      }
    }

    return responder(res, 404, { message: "rota não implementada no backend de teste", caminho });
  } catch (e) {
    return erroPg(res, e);
  }
});

servidor.listen(PORT, "127.0.0.1", () => {
  console.log(`backend de teste ouvindo em http://127.0.0.1:${PORT} -> ${DATABASE_URL}`);
});
