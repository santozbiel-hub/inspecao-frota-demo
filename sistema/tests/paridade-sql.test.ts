/**
 * Paridade entre as duas implementações da regra de arrasto.
 *
 * O Postgres é a autoridade; o TypeScript é o espelho que faz a tela
 * funcionar offline. Este teste joga os mesmos cenários aleatórios nos
 * dois e falha se discordarem em qualquer célula da grade — é o que
 * impede o espelho de sair de sincronia com o banco ao longo do tempo.
 *
 * Precisa de um Postgres. Sem ele, o teste é pulado (não falha), para
 * que `npm test` continue rodando em qualquer máquina.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { daysWithoutResponse, effectiveGrid } from "@/lib/domain/status";
import { addDays, isBusinessDay, todayLocal } from "@/lib/domain/dates";
import type { InspectionEntry } from "@/lib/domain/types";

const URL_BASE =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp&port=5433";
const DB = "bp_paridade";

let cliente: Client | null = null;
let disponivel = false;

// PRNG com semente: cenário aleatório, mas reproduzível quando quebra.
function prng(semente: number) {
  let s = semente >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const HOJE = todayLocal();
const INICIO = addDays(HOJE, -45);
const FIM = addDays(HOJE, 5);
const CRIADO_EM = new Date(`${addDays(HOJE, -120)}T09:00:00Z`).toISOString();

interface Cenario {
  entries: InspectionEntry[];
}

function gerarCenario(semente: number): Cenario {
  const rnd = prng(semente);
  const entries: InspectionEntry[] = [];
  let n = 0;
  for (let item = 1; item <= 5; item++) {
    let d = addDays(HOJE, -40);
    while (d <= HOJE) {
      if (isBusinessDay(d) && rnd() < 0.45) {
        // Desde a migration 015 cada inspetor tem o próprio registro do
        // item no dia, então o cenário precisa produzir dias com DOIS
        // registros — é justamente aí que a regra "o mais grave manda"
        // pode divergir entre o Postgres e o espelho em TypeScript.
        const quantos = rnd() < 0.3 ? 2 : 1;
        for (let k = 0; k < quantos; k++) {
          const ehNC = rnd() < 0.35;
          let ncStatus: InspectionEntry["nc_status"] = null;
          let resolvedAt: string | null = null;
          if (ehNC) {
            const r = rnd();
            ncStatus = r < 0.5 ? "pendente" : r < 0.75 ? "manutencao" : "resolvido";
            if (ncStatus === "resolvido") {
              const depois = Math.floor(rnd() * 20);
              resolvedAt = new Date(`${addDays(d, depois)}T13:00:00Z`).toISOString();
            }
          }
          n += 1;
          const hora = 11 + k; // registros do mesmo dia nunca empatam no relógio
          entries.push({
            id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
            vehicle_id: "",
            item_number: item,
            entry_date: d,
            status: ehNC ? "NC" : "C",
            nc_status: ncStatus,
            problem_description: ehNC ? `Problema ${n}` : null,
            photo_url: null,
            created_by: String(k), // índice do inspetor; vira uuid em `carregar`
            created_at: `${d}T${String(hora).padStart(2, "0")}:00:00Z`,
            updated_at: `${d}T${String(hora).padStart(2, "0")}:00:00Z`,
            resolved_at: resolvedAt,
          });
        }
      }
      d = addDays(d, 1);
    }
  }
  return { entries };
}

beforeAll(async () => {
  const admin = new Client({ connectionString: URL_BASE });
  try {
    await admin.connect();
  } catch {
    return; // sem Postgres: teste pulado
  }
  await admin.query(`drop database if exists ${DB}`);
  await admin.query(`create database ${DB}`);
  await admin.end();

  cliente = new Client({ connectionString: URL_BASE.replace("/postgres?", `/${DB}?`) });
  await cliente.connect();
  await cliente.query("create extension if not exists pgcrypto");
  const raiz = join(process.cwd(), "supabase");
  await cliente.query(readFileSync(join(raiz, "tests", "00_auth_stub.sql"), "utf8"));
  for (const f of readdirSync(join(raiz, "migrations")).sort()) {
    if (f.includes("storage_and_auth") || f.includes("dados_iniciais")) continue;
    await cliente.query(readFileSync(join(raiz, "migrations", f), "utf8"));
  }
  disponivel = true;
});

afterAll(async () => {
  await cliente?.end();
});

async function carregar(cenario: Cenario) {
  const c = cliente!;
  await c.query("truncate public.inspection_entries, public.observations, public.vehicles, public.profiles cascade");
  await c.query("delete from auth.users");
  const u = await c.query(
    "insert into auth.users (email) values ('usuario-efb05d22@example.invalid'),('usuario-c2e6b4e1@example.invalid') returning id",
  );
  const uids = u.rows.map((r) => r.id as string);
  const uid = uids[0];
  await c.query(
    "insert into public.profiles (id,name,role) select unnest($1::uuid[]),'Teste','admin'",
    [uids],
  );
  const v = await c.query(
    "insert into public.vehicles (brand,plate,created_at) values ('Marca Exemplo','TST 0A00',$1) returning id",
    [CRIADO_EM],
  );
  const vid = v.rows[0].id as string;

  // Desliga os gatilhos que carimbam data: o cenário precisa das datas
  // históricas que ele mesmo definiu, e `updated_at` agora é critério de
  // desempate entre dois registros do mesmo dia.
  await c.query("alter table public.inspection_entries disable trigger inspection_entries_resolved");
  await c.query("alter table public.inspection_entries disable trigger inspection_entries_stamp_insert");
  await c.query("alter table public.inspection_entries disable trigger inspection_entries_touch");

  for (const e of cenario.entries) {
    e.vehicle_id = vid;
    e.created_by = uids[Number(e.created_by) || 0];
    await c.query(
      `insert into public.inspection_entries
         (id,vehicle_id,item_number,entry_date,status,nc_status,problem_description,created_by,resolved_at,created_at,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [e.id, vid, e.item_number, e.entry_date, e.status, e.nc_status,
       e.problem_description, e.created_by, e.resolved_at, e.created_at, e.updated_at],
    );
  }
  return { vid, uid };
}

describe("paridade Postgres × TypeScript", () => {
  it("existe um Postgres para comparar", () => {
    if (!disponivel) console.warn("Postgres indisponível — paridade pulada");
    expect(true).toBe(true);
  });

  for (const semente of [1, 7, 42, 2026, 90210]) {
    it(`grade de status efetivo bate em todas as células (semente ${semente})`, async () => {
      if (!disponivel) return;
      const cenario = gerarCenario(semente);

      // Sem dias de dois inspetores o teste não exercita a regra nova, e
      // passaria por vacuidade. Falhar aqui significa gerador quebrado.
      const porItemDia = new Map<string, number>();
      for (const e of cenario.entries) {
        const k = `${e.item_number}|${e.entry_date}`;
        porItemDia.set(k, (porItemDia.get(k) ?? 0) + 1);
      }
      const comDois = [...porItemDia.values()].filter((n) => n > 1).length;
      expect(comDois, "o cenário precisa ter dias com dois inspetores").toBeGreaterThan(5);

      const { vid } = await carregar(cenario);

      const sql = await cliente!.query(
        "select item_number, to_char(entry_date,'YYYY-MM-DD') as entry_date, status, inherited, to_char(source_date,'YYYY-MM-DD') as source_date from public.effective_entries($1,$2,$3) order by entry_date, item_number",
        [vid, INICIO, FIM],
      );
      const ts = effectiveGrid(cenario.entries, INICIO, FIM, HOJE);

      const chave = (r: { item_number: number; entry_date: string; status: string | null; inherited: boolean; source_date: string | null }) =>
        `${r.entry_date}|${r.item_number}|${r.status ?? "-"}|${r.inherited}|${r.source_date ?? "-"}`;

      expect(sql.rows.length).toBe(ts.length);
      expect(sql.rows.map((r) => chave({ ...r, item_number: Number(r.item_number) }))).toEqual(
        ts.map(chave),
      );
    });

    it(`dias sem resposta batem (semente ${semente})`, async () => {
      if (!disponivel) return;
      const cenario = gerarCenario(semente);
      const { vid } = await carregar(cenario);

      for (let item = 1; item <= 5; item++) {
        for (const offset of [0, -1, -3, -10, -20]) {
          const data = addDays(HOJE, offset);
          const sql = await cliente!.query(
            "select to_char(d,'YYYY-MM-DD') as d from public.days_without_response($1,$2,$3,12) d",
            [vid, item, data],
          );
          const ts = daysWithoutResponse(cenario.entries, item, data, CRIADO_EM, 12, HOJE);
          expect(sql.rows.map((r) => r.d), `item ${item} em ${data}`).toEqual(ts);
        }
      }
    });
  }
});
