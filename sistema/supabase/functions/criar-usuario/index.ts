/**
 * Edge Function — criar usuário.
 *
 * Existe por um motivo de segurança: criar um usuário no Auth exige a
 * `service_role` key, que dá acesso irrestrito ao banco (ela ignora RLS).
 * Essa chave não pode existir no navegador. Aqui ela fica no servidor da
 * função, e a função só aceita a chamada depois de confirmar, no banco,
 * que quem chamou é um administrador ativo.
 *
 * Publicar:
 *   npx supabase functions deploy criar-usuario --project-ref SEU_REF
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Achado de auditoria: `Access-Control-Allow-Origin: "*"` liberava a função
 * para qualquer site do planeta chamar via navegador. Na prática o risco era
 * baixo — a função ainda exige um Bearer token de admin de verdade, que uma
 * página de terceiros não tem como forjar —, mas não custa nada restringir:
 * só o app da Gestão de Entregas (produção, deploy previews do Netlify, e
 * localhost em desenvolvimento) pode chamar pelo navegador.
 *
 * Se um domínio próprio for configurado no Netlify, adicione-o na lista.
 */
const ORIGENS_PERMITIDAS = [
  "https://frota.example.invalid",
  "http://localhost:3000",
];

function origemPermitida(origem: string | null): boolean {
  if (!origem) return false;
  if (ORIGENS_PERMITIDAS.includes(origem)) return true;
  // deploy previews do Netlify: https://<hash>--frota.example.invalid
  return /^https:\/\/[a-z0-9-]+--frota\.example\.invalid$/.test(origem);
}

function corsPara(req: Request) {
  const origem = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origemPermitida(origem) ? origem! : ORIGENS_PERMITIDAS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(corpo: unknown, status = 200, cors: Record<string, string> = {}) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const CORS = corsPara(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405, CORS);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!autorizacao) return json({ erro: "Sem sessão" }, 401, CORS);

  // Passo 1: quem está chamando? Usa a chave pública com o JWT de quem
  // chamou, para que o RLS valha normalmente nesta leitura.
  const comoUsuario = createClient(url, anon, {
    global: { headers: { Authorization: autorizacao } },
  });
  const { data: sessao } = await comoUsuario.auth.getUser();
  if (!sessao.user) return json({ erro: "Sem sessão" }, 401, CORS);

  const { data: perfil } = await comoUsuario
    .from("profiles")
    .select("role, active")
    .eq("id", sessao.user.id)
    .single();

  if (!perfil || perfil.role !== "admin" || !perfil.active) {
    return json({ erro: "Só o administrador pode criar usuários" }, 403, CORS);
  }

  // Passo 2: agora sim, com a chave de serviço.
  const corpo = await req.json().catch(() => null);
  const nome = String(corpo?.nome ?? "").trim().slice(0, 120);
  const email = String(corpo?.email ?? "").trim().toLowerCase();
  const senha = String(corpo?.senha ?? "");
  const papel = corpo?.papel === "admin" ? "admin" : "inspector";

  if (!nome) return json({ erro: "Informe o nome" }, 400, CORS);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ erro: "E-mail inválido" }, 400, CORS);
  if (senha.length < 8) return json({ erro: "A senha precisa ter ao menos 8 caracteres" }, 400, CORS);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { name: nome, role: papel },
  });

  if (error) return json({ erro: error.message }, 400, CORS);

  // O gatilho `handle_new_user` já criou o profile (sempre como inspector,
  // desde a migration 008); aqui garantimos o papel escolhido de verdade,
  // com a chave de serviço, que ignora RLS.
  await admin.from("profiles").update({ name: nome, role: papel }).eq("id", data.user.id);

  return json({ id: data.user.id, email, nome, papel }, 201, CORS);
});
