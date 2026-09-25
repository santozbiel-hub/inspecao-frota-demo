-- =====================================================================
--  Gestão de Entregas — Migration 002
--  Regras de negócio no banco: arrasto de não-conformidade e dias sem
--  resposta. Ficam aqui, e não no client, para que celular, desktop e
--  relatório impresso enxerguem sempre o mesmo número.
-- =====================================================================

-- Fuso da empresa. `current_date` no Supabase é UTC: às 21h de Brasília
-- já virou o dia seguinte lá, e o motorista perderia o direito de editar
-- o próprio registro. Toda regra de "hoje" passa por aqui.
create or replace function public.today_local()
returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- Segunda a sábado. Domingo não é dia de inspeção (isodow 7).
create or replace function public.is_business_day(p_date date)
returns boolean language sql immutable as $$
  select extract(isodow from p_date) <> 7;
$$;

-- ---------------------------------------------------------------------
--  Não-conformidade que ainda está arrastando
-- ---------------------------------------------------------------------
-- Equivalente ao `pendenciaAberta` do protótipo: a NC mais recente do
-- mesmo veículo + item, anterior a esta data, que o administrador ainda
-- não resolveu. Depois de resolvida ela para de arrastar, mas continua
-- marcada nos dias em que de fato esteve aberta — por isso a comparação
-- é com a data da resolução, não com um booleano.
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
  order by e.entry_date desc
  limit 1;
$$;

-- ---------------------------------------------------------------------
--  Status efetivo
-- ---------------------------------------------------------------------
-- Equivalente ao `statusEfetivo`. Devolve a grade inteira (5 itens ×
-- dias úteis do período) já resolvida: o que foi marcado, ou a pendência
-- que veio se arrastando. Dia futuro nunca herda nada.
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
  left join public.inspection_entries e
    on  e.vehicle_id  = p_vehicle_id
    and e.item_number = g.item_number
    and e.entry_date  = g.entry_date
  left join lateral (
    select *
    from public.open_nonconformity(p_vehicle_id, g.item_number, g.entry_date)
  ) p on e.id is null and g.entry_date <= public.today_local()
  order by g.entry_date, g.item_number;
$$;

-- ---------------------------------------------------------------------
--  Dias sem resposta
-- ---------------------------------------------------------------------
-- Equivalente ao `diasSemResposta`, com a diferença acertada com o dono
-- do projeto: janela deslizante de dias úteis, que atravessa a virada do
-- mês (no protótipo o alerta zerava todo dia 1º). Nunca olha antes do
-- cadastro do veículo, senão um caminhão novo nasceria cheio de alerta.
create or replace function public.days_without_response(
  p_vehicle_id  uuid,
  p_item_number smallint,
  p_date        date,
  p_lookback    int default 12
)
returns setof date
language plpgsql stable as $$
declare
  v_inicio  date;
  v_hoje    date := public.today_local();
  d         date := p_date - 1;
  n         int  := 0;
  faltantes date[] := '{}';
begin
  select (created_at at time zone 'America/Sao_Paulo')::date
    into v_inicio
  from public.vehicles
  where id = p_vehicle_id;

  if v_inicio is null then
    return;
  end if;

  while n < p_lookback and d >= v_inicio loop
    if public.is_business_day(d) and d <= v_hoje then
      n := n + 1;
      if exists (
        select 1 from public.inspection_entries e
        where e.vehicle_id  = p_vehicle_id
          and e.item_number = p_item_number
          and e.entry_date  = d
      ) then
        exit;                        -- achou resposta: para de olhar para trás
      end if;
      faltantes := d || faltantes;   -- mais antigo primeiro
    end if;
    d := d - 1;
  end loop;

  return query select unnest(faltantes);
end $$;

-- Dias em que a inspeção ficou incompleta (menos de 5 itens marcados),
-- para a lista de alertas do administrador.
create or replace function public.incomplete_days(
  p_vehicle_id uuid,
  p_from       date,
  p_to         date
)
returns table (entry_date date, marcados int, faltando int)
language sql stable as $$
  select
    d::date,
    count(e.id)::int,
    (5 - count(e.id))::int
  from generate_series(p_from::timestamp, least(p_to, public.today_local())::timestamp, interval '1 day') d
  left join public.inspection_entries e
    on e.vehicle_id = p_vehicle_id and e.entry_date = d::date
  where public.is_business_day(d::date)
  group by d::date
  having count(e.id) < 5
  order by d::date desc;
$$;

-- Mês fechado pelo administrador: inspetor não edita mais.
create or replace function public.is_month_closed(p_vehicle_id uuid, p_date date)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.month_closures c
    where c.vehicle_id = p_vehicle_id
      and c.month = extract(month from p_date)::smallint
      and c.year  = extract(year  from p_date)::smallint
  );
$$;
