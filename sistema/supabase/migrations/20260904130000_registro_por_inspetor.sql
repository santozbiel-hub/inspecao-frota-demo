-- =====================================================================
--  Gestão de Entregas — Migration 015
--  Um registro por inspetor (decisão da empresa, 04/09/2026).
--
--  O problema: a chave única era (vehicle_id, item_number, entry_date).
--  Ela declara "no máximo um registro por caminhão + item + dia". O app
--  envia `upsert ... on conflict (...) do update`, então quando um segundo
--  inspetor marcava um item que o primeiro já tinha marcado, o Postgres
--  não inseria — caía no caminho de UPDATE da linha do colega. A policy
--  `entries_update` exige `created_by = auth.uid()`, a linha era do outro,
--  e o servidor recusava com 42501. Na tela nada aparecia: a marcação
--  ficava presa na fila do aparelho parecendo salva.
--
--  A decisão não é técnica: ninguém sobrescreve o registro de ninguém.
--  Cada inspetor tem o seu, e os dois ficam no histórico — que é o que se
--  espera de um registro documental de alimento.
--
--  A constraint nova é ESTRITAMENTE MAIS PERMISSIVA que a antiga: toda
--  linha existente continua válida. Não há dado para migrar nem apagar.
-- =====================================================================

alter table public.inspection_entries
  drop constraint if exists inspection_entries_unique_key;

alter table public.inspection_entries
  add constraint inspection_entries_unique_key
  unique (vehicle_id, item_number, entry_date, created_by);

-- ---------------------------------------------------------------------
--  As três funções abaixo assumiam "uma linha por item e dia". Com duas,
--  cada uma passava a mentir de um jeito diferente.
-- ---------------------------------------------------------------------

-- 1) `count(e.id) < 5` viraria 10 com dois inspetores marcando os cinco
--    itens, e o sistema NUNCA MAIS acusaria dia incompleto. O que importa
--    é quantos itens distintos foram respondidos, não quantas respostas
--    existem.
create or replace function public.incomplete_days(
  p_vehicle_id uuid,
  p_from       date,
  p_to         date
)
returns table (entry_date date, marcados int, faltando int)
language sql stable as $$
  select
    d::date,
    count(distinct e.item_number)::int,
    (5 - count(distinct e.item_number))::int
  from generate_series(p_from::timestamp, least(p_to, public.today_local())::timestamp, interval '1 day') d
  left join public.inspection_entries e
    on e.vehicle_id = p_vehicle_id and e.entry_date = d::date
  where public.is_business_day(d::date)
  group by d::date
  having count(distinct e.item_number) < 5
  order by d::date desc;
$$;

-- 2) `open_nonconformity` fazia `order by entry_date desc limit 1`. Com
--    dois registros no mesmo dia ela escolhia um SEM CRITÉRIO — e se
--    escolhesse o Conforme, a não conformidade que o colega registrou
--    parava de arrastar para os dias seguintes. Era o mais perigoso dos
--    três. Agora, dentro do mesmo dia, a que ainda está aberta vem
--    primeiro; depois, a mais recente.
create or replace function public.open_nonconformity(
  p_vehicle_id  uuid,
  p_item_number smallint,
  p_date        date
)
returns table (
  source_date         date,
  problem_description text,
  nc_status           public.nc_status,
  photo_url           text
)
language sql stable as $$
  select e.entry_date, e.problem_description, e.nc_status, e.photo_url
  from public.inspection_entries e
  where e.vehicle_id  = p_vehicle_id
    and e.item_number = p_item_number
    and e.entry_date  < p_date
    and e.status      = 'NC'
    and (
      e.nc_status <> 'resolvido'
      or (
        e.resolved_at is not null
        and (e.resolved_at at time zone 'America/Sao_Paulo')::date >= p_date
      )
    )
  order by e.entry_date desc,
           (e.nc_status is distinct from 'resolvido') desc,
           e.updated_at desc
  limit 1;
$$;

-- 3) `effective_entries` fazia um LEFT JOIN direto: com dois registros no
--    mesmo item e dia, ela devolvia DUAS linhas onde a grade espera uma, e
--    a célula duplicava.
--
--    A regra escolhida pela empresa é "o mais grave manda": se qualquer
--    inspetor marcou Não Conforme, a célula sai NC. Nunca esconder um
--    problema que alguém viu vale mais do que mostrar a marcação mais
--    recente. Entre várias NC do mesmo dia, a ainda aberta ganha; depois,
--    a mais recente. Entre Conformes, a mais recente.
--
--    Quem quiser ver os dois registros abre o detalhe do dia na grade —
--    a tela lista todos, com nome e hora de cada um.
create or replace function public.effective_entries(
  p_vehicle_id uuid,
  p_from       date,
  p_to         date
)
returns table (
  item_number         smallint,
  entry_date          date,
  status              public.entry_status,
  nc_status           public.nc_status,
  problem_description text,
  photo_url           text,
  inherited           boolean,
  source_date         date,
  entry_id            uuid,
  created_by          uuid,
  updated_at          timestamptz
)
language sql stable as $$
  with dias as (
    select d::date as entry_date
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
    where public.is_business_day(d::date)
  ),
  grade as (
    select i::smallint as item_number, dias.entry_date
    from generate_series(1, 5) i
    cross join dias
  )
  select
    g.item_number,
    g.entry_date,
    coalesce(e.status, case when p.source_date is not null then 'NC'::public.entry_status end),
    coalesce(e.nc_status, p.nc_status),
    coalesce(e.problem_description, p.problem_description),
    coalesce(e.photo_url, p.photo_url),
    (e.id is null and p.source_date is not null) as inherited,
    case when e.id is null then p.source_date end,
    e.id,
    e.created_by,
    e.updated_at
  from grade g
  left join lateral (
    select *
    from public.inspection_entries x
    where x.vehicle_id  = p_vehicle_id
      and x.item_number = g.item_number
      and x.entry_date  = g.entry_date
    order by
      (x.status = 'NC') desc,                            -- o mais grave manda
      (x.nc_status is distinct from 'resolvido') desc,   -- NC aberta antes de resolvida
      x.updated_at desc                                  -- e, no empate, a mais recente
    limit 1
  ) e on true
  left join lateral (
    select *
    from public.open_nonconformity(p_vehicle_id, g.item_number, g.entry_date)
  ) p on e.id is null and g.entry_date <= public.today_local()
  order by g.entry_date, g.item_number;
$$;

grant execute on function
  public.open_nonconformity(uuid, smallint, date),
  public.effective_entries(uuid, date, date),
  public.incomplete_days(uuid, date, date)
  to authenticated;
