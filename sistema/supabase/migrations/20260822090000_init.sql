-- =====================================================================
--  Gestão de Entregas — Inspeção de Frota
--  Migration 001 — tipos, tabelas, índices e gatilhos
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tipos
do $$ begin
  create type public.user_role   as enum ('admin', 'inspector');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.entry_status as enum ('C', 'NC');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.nc_status    as enum ('pendente', 'manutencao', 'resolvido');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- perfis
-- Estende auth.users. A senha nunca trafega nem é guardada aqui:
-- quem cuida disso é o Supabase Auth.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  role        public.user_role not null default 'inspector',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------- veículos
create table if not exists public.vehicles (
  id            uuid primary key default gen_random_uuid(),
  brand         text not null check (btrim(brand) <> ''),
  model         text,
  plate         text not null check (btrim(plate) <> ''),
  internal_code text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Placa normalizada (sem espaço/hífen, maiúscula) é única.
create unique index if not exists vehicles_plate_norm_key
  on public.vehicles ((upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g'))));

-- ------------------------------------- registros de inspeção (o coração)
-- Uma linha por veículo + item + data. O upsert do Postgres resolve
-- conflito pela chave única, então dois aparelhos nunca se sobrescrevem
-- por inteiro como acontecia no protótipo.
create table if not exists public.inspection_entries (
  id                  uuid primary key default gen_random_uuid(),
  vehicle_id          uuid not null references public.vehicles (id) on delete cascade,
  item_number         smallint not null check (item_number between 1 and 5),
  entry_date          date not null,
  status              public.entry_status not null,
  nc_status           public.nc_status,
  problem_description text,
  photo_url           text,
  created_by          uuid not null references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  resolved_at         timestamptz,

  constraint inspection_entries_unique_key
    unique (vehicle_id, item_number, entry_date),

  -- Conforme não carrega estado de não-conformidade.
  constraint inspection_entries_nc_consistency check (
    (status = 'C'  and nc_status is null and resolved_at is null and problem_description is null)
    or
    (status = 'NC' and nc_status is not null)
  ),

  -- Não Conforme sem descrição não serve para ninguém.
  constraint inspection_entries_nc_needs_description check (
    status <> 'NC' or coalesce(btrim(problem_description), '') <> ''
  ),

  -- Resolvido precisa saber quando foi resolvido: é a data que faz a
  -- não-conformidade parar de arrastar para os dias seguintes.
  constraint inspection_entries_resolved_needs_timestamp check (
    nc_status is distinct from 'resolvido' or resolved_at is not null
  ),

  constraint inspection_entries_description_length check (
    problem_description is null or char_length(problem_description) <= 2000
  )
);

create index if not exists inspection_entries_lookup_idx
  on public.inspection_entries (vehicle_id, item_number, entry_date desc);

create index if not exists inspection_entries_open_nc_idx
  on public.inspection_entries (vehicle_id, item_number, entry_date desc)
  where status = 'NC' and nc_status <> 'resolvido';

create index if not exists inspection_entries_date_idx
  on public.inspection_entries (entry_date desc);

-- -------------------------------------------------------- observações
-- Várias por item/dia, como no protótipo.
create table if not exists public.observations (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references public.vehicles (id) on delete cascade,
  item_number smallint not null check (item_number between 1 and 5),
  entry_date  date not null,
  text        text not null check (btrim(text) <> '' and char_length(text) <= 2000),
  author_id   uuid not null references public.profiles (id),
  created_at  timestamptz not null default now()
);

create index if not exists observations_lookup_idx
  on public.observations (vehicle_id, item_number, entry_date desc);

-- --------------------------------------------------- fechamento do mês
-- Substitui o "status: finalizado" do protótipo sem voltar ao blob mensal.
create table if not exists public.month_closures (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  month      smallint not null check (month between 1 and 12),
  year       smallint not null check (year between 2000 and 2100),
  closed_at  timestamptz not null default now(),
  closed_by  uuid not null references public.profiles (id),
  unique (vehicle_id, month, year)
);

-- ------------------------------------------------------------ updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch           on public.profiles;
drop trigger if exists vehicles_touch           on public.vehicles;
drop trigger if exists inspection_entries_touch on public.inspection_entries;

create trigger profiles_touch           before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger vehicles_touch           before update on public.vehicles
  for each row execute function public.touch_updated_at();
create trigger inspection_entries_touch before update on public.inspection_entries
  for each row execute function public.touch_updated_at();

-- Carimba resolved_at sozinho quando a NC vira "resolvido", e limpa
-- quando ela reabre. Assim o client não precisa acertar isso na mão.
create or replace function public.stamp_resolved_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'NC' and new.nc_status = 'resolvido' then
    if new.resolved_at is null
       or (tg_op = 'UPDATE' and old.nc_status is distinct from 'resolvido') then
      new.resolved_at := now();
    end if;
  else
    new.resolved_at := null;
  end if;
  return new;
end $$;

drop trigger if exists inspection_entries_resolved on public.inspection_entries;
create trigger inspection_entries_resolved
  before insert or update on public.inspection_entries
  for each row execute function public.stamp_resolved_at();

-- Cria o profile automaticamente quando um usuário nasce no Auth.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'inspector')::public.user_role
  )
  on conflict (id) do nothing;
  return new;
end $$;
