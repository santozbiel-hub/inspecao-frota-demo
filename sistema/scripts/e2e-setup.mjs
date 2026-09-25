/**
 * Prepara o banco usado pelos testes de ponta a ponta:
 * cria o banco, aplica as migrations e semeia um administrador, um
 * inspetor, um segundo inspetor (para o teste de RLS) e dois caminhões.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const BASE = process.env.TEST_DATABASE_URL_ADMIN ?? "postgresql://postgres@/postgres?host=/tmp&port=5433";
const DB = "bp_e2e";
const URL_DB = BASE.replace("/postgres?", `/${DB}?`);

const admin = new pg.Client({ connectionString: BASE });
await admin.connect();
await admin.query(`drop database if exists ${DB}`);
await admin.query(`create database ${DB}`);
await admin.end();

const c = new pg.Client({ connectionString: URL_DB });
await c.connect();
await c.query("create extension if not exists pgcrypto");

const raiz = join(process.cwd(), "supabase");
await c.query(readFileSync(join(raiz, "tests", "00_auth_stub.sql"), "utf8"));
for (const f of readdirSync(join(raiz, "migrations")).sort()) {
  // schemas gerenciados pelo Supabase, e carga inicial (o teste semeia a sua)
  if (f.includes("storage_and_auth") || f.includes("dados_iniciais")) continue;
  await c.query(readFileSync(join(raiz, "migrations", f), "utf8"));
}

async function usuario(email, nome, papel) {
  const { rows } = await c.query(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  const id = rows[0].id;
  // `active` explícito: desde a migration 009 toda conta nasce inativa, e
  // uma conta inativa reprova em is_active_user() — o seed sem esta coluna
  // criava três usuários que não conseguiam nem entrar no sistema.
  await c.query(
    "insert into public.profiles (id, name, role, active) values ($1,$2,$3,true)",
    [id, nome, papel],
  );
  return id;
}

const adminId = await usuario("usuario-52a681a1@example.invalid", "Operacao Administradora", "admin");
const joaoId = await usuario("usuario-d0c02212@example.invalid", "João Motorista", "inspector");
const mariaId = await usuario("usuario-dcd04bdc@example.invalid", "Maria Motorista", "inspector");

const v1 = await c.query(
  "insert into public.vehicles (brand, model, plate, internal_code, created_at) values ('Marca Exemplo','Modelo A','DEM0A01','01', now() - interval '120 days') returning id",
);
const v2 = await c.query(
  "insert into public.vehicles (brand, model, plate, internal_code, created_at) values ('Volkswagen','Delivery','ABC1D23','02', now() - interval '120 days') returning id",
);

console.log(
  JSON.stringify(
    { database: URL_DB, adminId, joaoId, mariaId, veiculo1: v1.rows[0].id, veiculo2: v2.rows[0].id },
    null,
    2,
  ),
);
await c.end();
