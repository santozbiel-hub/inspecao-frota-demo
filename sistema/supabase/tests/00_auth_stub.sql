-- Somente para os testes locais: recria o mínimo dos schemas que o
-- Supabase gerencia (auth/storage), para que as migrations rodem contra
-- um Postgres puro. Não vai para o projeto Supabase.
create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- auth.uid() lê o mesmo GUC que o PostgREST do Supabase preenche.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

-- O mínimo de storage.objects para as migrations de foto rodarem contra um
-- Postgres puro. Sem isto, a migration 012 (`foto_imutavel_storage`) aborta
-- com "relation storage.objects does not exist" e derruba `npm test` e
-- `npm run e2e:setup` inteiros — que era o estado desde que ela entrou.
-- Só as colunas que as policies do projeto tocam; o Supabase de verdade tem
-- muito mais.
create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text,
  name       text,
  owner      uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  metadata   jsonb
);
alter table storage.objects enable row level security;

do $$ begin create role anon nologin;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
