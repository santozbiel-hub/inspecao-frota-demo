-- =====================================================================
--  Gestão de Entregas — Migration 003
--  Row Level Security. A regra de quem pode o quê vive no banco: mesmo
--  que alguém chame a API do Supabase direto, sem passar pela tela, o
--  Postgres recusa.
-- =====================================================================

-- security definer para não cair em recursão ao ler profiles dentro da
-- própria policy de profiles.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.active
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
  );
$$;

alter table public.profiles           enable row level security;
alter table public.vehicles           enable row level security;
alter table public.inspection_entries enable row level security;
alter table public.observations       enable row level security;
alter table public.month_closures     enable row level security;

-- Ninguém entra sem sessão.
alter table public.profiles           force row level security;

-- ------------------------------------------------------------ profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (public.is_active_user() or id = auth.uid());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------ vehicles
drop policy if exists vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles
  for select to authenticated using (public.is_active_user());

drop policy if exists vehicles_write on public.vehicles;
create policy vehicles_write on public.vehicles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -------------------------------------------------- inspection_entries
drop policy if exists entries_select on public.inspection_entries;
create policy entries_select on public.inspection_entries
  for select to authenticated using (public.is_active_user());

-- Inspetor: só cria registro do dia de hoje, em seu próprio nome, num
-- mês que o administrador ainda não fechou, e nunca já resolvido.
drop policy if exists entries_insert on public.inspection_entries;
create policy entries_insert on public.inspection_entries
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      public.is_active_user()
      and created_by  = auth.uid()
      and entry_date  = public.today_local()
      and nc_status is distinct from 'resolvido'
      and not public.is_month_closed(vehicle_id, entry_date)
    )
  );

-- Inspetor: só mexe no que é dele, do dia, e não pode dar uma
-- não-conformidade por resolvida — isso é do administrador.
drop policy if exists entries_update on public.inspection_entries;
create policy entries_update on public.inspection_entries
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_active_user()
      and created_by = auth.uid()
      and entry_date = public.today_local()
      and not public.is_month_closed(vehicle_id, entry_date)
    )
  )
  with check (
    public.is_admin()
    or (
      created_by  = auth.uid()
      and entry_date = public.today_local()
      and nc_status is distinct from 'resolvido'
      and not public.is_month_closed(vehicle_id, entry_date)
    )
  );

drop policy if exists entries_delete on public.inspection_entries;
create policy entries_delete on public.inspection_entries
  for delete to authenticated using (public.is_admin());

-- -------------------------------------------------------- observations
drop policy if exists observations_select on public.observations;
create policy observations_select on public.observations
  for select to authenticated using (public.is_active_user());

drop policy if exists observations_insert on public.observations;
create policy observations_insert on public.observations
  for insert to authenticated
  with check (
    public.is_active_user()
    and author_id = auth.uid()
    and (
      public.is_admin()
      or (
        entry_date = public.today_local()
        and not public.is_month_closed(vehicle_id, entry_date)
      )
    )
  );

drop policy if exists observations_delete on public.observations;
create policy observations_delete on public.observations
  for delete to authenticated
  using (public.is_admin() or author_id = auth.uid());

-- ------------------------------------------------------ month_closures
drop policy if exists closures_select on public.month_closures;
create policy closures_select on public.month_closures
  for select to authenticated using (public.is_active_user());

drop policy if exists closures_write on public.month_closures;
create policy closures_write on public.month_closures
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------- grants
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete
  on public.profiles, public.vehicles, public.inspection_entries,
     public.observations, public.month_closures
  to authenticated;

grant execute on function
  public.today_local(),
  public.is_business_day(date),
  public.open_nonconformity(uuid, smallint, date),
  public.effective_entries(uuid, date, date),
  public.days_without_response(uuid, smallint, date, int),
  public.incomplete_days(uuid, date, date),
  public.is_month_closed(uuid, date),
  public.is_admin(),
  public.is_active_user()
  to authenticated;
