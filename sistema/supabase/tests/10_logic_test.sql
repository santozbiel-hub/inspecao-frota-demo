-- =====================================================================
--  Teste 1 — lógica de negócio no banco
--  Mesmos casos que o protótipo cobria: arrasto de não-conformidade
--  (statusEfetivo/pendenciaAberta) e dias sem resposta.
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages to warning;

create temp table resultado (nome text, esperado text, obtido text);

create or replace function pg_temp.check(p_nome text, p_esperado text, p_obtido text)
returns void language plpgsql as $$
begin
  insert into resultado values (p_nome, p_esperado, p_obtido);
end $$;

-- Dia útil (seg–sáb) N dias úteis antes de hoje.
create or replace function pg_temp.du(n int) returns date
language plpgsql stable as $$
declare d date := public.today_local(); i int := 0;
begin
  while i < n loop
    d := d - 1;
    if public.is_business_day(d) then i := i + 1; end if;
  end loop;
  return d;
end $$;

-- Dia útil N dias úteis DEPOIS de hoje.
create or replace function pg_temp.duf(n int) returns date
language plpgsql stable as $$
declare d date := public.today_local(); i int := 0;
begin
  while i < n loop
    d := d + 1;
    if public.is_business_day(d) then i := i + 1; end if;
  end loop;
  return d;
end $$;

-- O primeiro dia de inspeção a partir de hoje: hoje, se hoje for dia útil;
-- senão o próximo. Sem isto a suíte quebra quando roda num domingo — a
-- grade não tem linha de domingo, e domingo não aceita gravação.
create or replace function pg_temp.hoje_util() returns date
language sql stable as $$
  select case when public.is_business_day(public.today_local())
              then public.today_local()
              else pg_temp.duf(1) end;
$$;

-- ------------------------------------------------------------ cenário
do $$
declare v_admin uuid; v_insp uuid; v_veic uuid;
begin
  insert into auth.users (email) values ('usuario-52a681a1@example.invalid') returning id into v_admin;
  insert into auth.users (email) values ('usuario-785ba88f@example.invalid') returning id into v_insp;
  insert into public.profiles (id, name, role) values (v_admin, 'Administrador', 'admin');
  insert into public.profiles (id, name, role) values (v_insp,  'João Motorista', 'inspector');

  insert into public.vehicles (brand, model, plate, internal_code, created_at)
  values ('Marca Exemplo', 'Modelo A', 'FJP 9H46', '01', now() - interval '120 days')
  returning id into v_veic;

  -- guarda os ids para os blocos seguintes
  create temp table ctx as select v_admin as admin_id, v_insp as insp_id, v_veic as veiculo_id;
end $$;

-- ---------------------------------------------------------------------
--  A. Arrasto de não-conformidade
-- ---------------------------------------------------------------------

-- Item 1: NC 5 dias úteis atrás, nunca resolvida.
insert into public.inspection_entries
  (vehicle_id, item_number, entry_date, status, nc_status, problem_description, created_by)
select veiculo_id, 1, pg_temp.du(5), 'NC', 'pendente',
       'Pneu dianteiro esquerdo com desgaste.', insp_id from ctx;

-- A1: o próprio dia da marcação não é herdado.
select pg_temp.check(
  'A1 dia da marcação = NC própria (não herdada)',
  'NC|false',
  (select coalesce(status::text,'-') || '|' || coalesce(inherited::text,'-')
     from public.effective_entries((select veiculo_id from ctx), pg_temp.du(5), pg_temp.du(5))
    where item_number = 1)
);

-- A2: dia seguinte sem marcação nenhuma herda a NC.
select pg_temp.check(
  'A2 dia seguinte herda NC em aberto',
  'NC|true',
  (select coalesce(status::text,'-') || '|' || coalesce(inherited::text,'-')
     from public.effective_entries((select veiculo_id from ctx), pg_temp.du(4), pg_temp.du(4))
    where item_number = 1)
);

-- A3: a origem apontada é o dia da NC original.
select pg_temp.check(
  'A3 origem do arrasto aponta o dia original',
  pg_temp.du(5)::text,
  (select coalesce(source_date::text,'-')
     from public.effective_entries((select veiculo_id from ctx), pg_temp.du(4), pg_temp.du(4))
    where item_number = 1)
);

-- A4: marcar Conforme depois NÃO encerra a pendência — só o administrador
--     resolvendo encerra. Regra confirmada com o dono do projeto.
insert into public.inspection_entries
  (vehicle_id, item_number, entry_date, status, created_by)
select veiculo_id, 1, pg_temp.du(4), 'C', insp_id from ctx;

select pg_temp.check(
  'A4 dia com C marcado mostra C (marcação vence a herança)',
  'C|false',
  (select coalesce(status::text,'-') || '|' || coalesce(inherited::text,'-')
     from public.effective_entries((select veiculo_id from ctx), pg_temp.du(4), pg_temp.du(4))
    where item_number = 1)
);

select pg_temp.check(
  'A5 dia seguinte volta a herdar NC (C não resolve pendência)',
  'NC|true',
  (select coalesce(status::text,'-') || '|' || coalesce(inherited::text,'-')
     from public.effective_entries((select veiculo_id from ctx), pg_temp.du(3), pg_temp.du(3))
    where item_number = 1)
);

-- A6: item sem nenhuma marcação nunca herda nada.
select pg_temp.check(
  'A6 item sem histórico fica sem status',
  '-|false',
  (select coalesce(status::text,'-') || '|' || coalesce(inherited::text,'-')
     from public.effective_entries((select veiculo_id from ctx), pg_temp.du(3), pg_temp.du(3))
    where item_number = 5)
);

-- A7: dia futuro nunca herda.
select pg_temp.check(
  'A7 dia futuro não herda pendência',
  '-|false',
  (select coalesce(status::text,'-') || '|' || coalesce(inherited::text,'-')
     from public.effective_entries((select veiculo_id from ctx), pg_temp.duf(1), pg_temp.duf(1))
    where item_number = 1)
);

-- A8: domingo não aparece na grade.
select pg_temp.check(
  'A8 domingo fora da grade',
  '0',
  (select count(*)::text from public.effective_entries(
      (select veiculo_id from ctx), public.today_local() - 30, public.today_local())
    where extract(isodow from entry_date) = 7)
);

-- ---------------------------------------------------------------------
--  B. Resolução encerra o arrasto a partir da data da resolução
-- ---------------------------------------------------------------------
-- Administrador resolve a NC do item 1 "ontem útil" (du(1)).
update public.inspection_entries
   set nc_status = 'resolvido', resolved_at = pg_temp.du(1) + time '10:00'
 where vehicle_id = (select veiculo_id from ctx)
   and item_number = 1 and entry_date = pg_temp.du(5);

-- O gatilho carimba resolved_at = now(); para testar a data histórica,
-- reescrevemos direto (o gatilho só mexe quando muda de estado).
update public.inspection_entries
   set resolved_at = (pg_temp.du(1) + time '10:00') at time zone 'America/Sao_Paulo'
 where vehicle_id = (select veiculo_id from ctx)
   and item_number = 1 and entry_date = pg_temp.du(5);

select pg_temp.check(
  'B1 antes da resolução continua marcada como NC herdada',
  'NC|true',
  (select coalesce(status::text,'-') || '|' || coalesce(inherited::text,'-')
     from public.effective_entries((select veiculo_id from ctx), pg_temp.du(3), pg_temp.du(3))
    where item_number = 1)
);

select pg_temp.check(
  'B2 no dia da resolução ainda arrasta (esteve aberta no dia)',
  'NC|true',
  (select coalesce(status::text,'-') || '|' || coalesce(inherited::text,'-')
     from public.effective_entries((select veiculo_id from ctx), pg_temp.du(1), pg_temp.du(1))
    where item_number = 1)
);

select pg_temp.check(
  'B3 depois da resolução para de arrastar',
  '-|false',
  (select coalesce(status::text,'-') || '|' || coalesce(inherited::text,'-')
     from public.effective_entries((select veiculo_id from ctx), pg_temp.hoje_util(), pg_temp.hoje_util())
    where item_number = 1)
);

-- ---------------------------------------------------------------------
--  C. Dias sem resposta (janela deslizante)
-- ---------------------------------------------------------------------
-- Item 2: marcado 4 dias úteis atrás, nada depois.
insert into public.inspection_entries
  (vehicle_id, item_number, entry_date, status, created_by)
select veiculo_id, 2, pg_temp.du(4), 'C', insp_id from ctx;

select pg_temp.check(
  'C1 conta os dias úteis sem resposta até a última marcação',
  '3',
  (select count(*)::text from public.days_without_response(
     (select veiculo_id from ctx), 2::smallint, public.today_local()))
);

select pg_temp.check(
  'C2 lista em ordem cronológica, começando no dia seguinte à marcação',
  pg_temp.du(3)::text,
  (select min(x)::text from public.days_without_response(
     (select veiculo_id from ctx), 2::smallint, public.today_local()) x)
);

select pg_temp.check(
  'C3 para no primeiro dia com resposta (dia seguinte à marcação = 0)',
  '0',
  (select count(*)::text from public.days_without_response(
     (select veiculo_id from ctx), 2::smallint, pg_temp.du(3)))
);

select pg_temp.check(
  'C4 nunca inclui dia futuro',
  '0',
  (select count(*)::text from public.days_without_response(
     (select veiculo_id from ctx), 3::smallint, pg_temp.duf(2)) x
   where x > public.today_local())
);

select pg_temp.check(
  'C5 nunca inclui domingo',
  '0',
  (select count(*)::text from public.days_without_response(
     (select veiculo_id from ctx), 3::smallint, public.today_local()) x
   where extract(isodow from x) = 7)
);

select pg_temp.check(
  'C6 respeita o teto da janela (lookback)',
  '4',
  (select count(*)::text from public.days_without_response(
     (select veiculo_id from ctx), 4::smallint, public.today_local(), 4))
);

-- C7: janela atravessa a virada do mês — a mudança pedida em relação ao
-- protótipo. Veículo novo, marcação no último dia útil do mês passado.
do $$
declare v_novo uuid; v_insp uuid := (select insp_id from ctx);
begin
  insert into public.vehicles (brand, plate, created_at)
  values ('Volkswagen', 'ABC 1D23', now() - interval '120 days') returning id into v_novo;
  insert into public.inspection_entries (vehicle_id, item_number, entry_date, status, created_by)
  values (v_novo, 1, date_trunc('month', public.today_local())::date - 8, 'C', v_insp);
  create temp table ctx2 as select v_novo as veiculo_id;
end $$;

select pg_temp.check(
  'C7 janela atravessa a virada do mês',
  'true',
  (select (count(*) > 0)::text from public.days_without_response(
     (select veiculo_id from ctx2), 1::smallint, date_trunc('month', public.today_local())::date + 1) x
   where x < date_trunc('month', public.today_local())::date)
);

-- C8: veículo recém-cadastrado não nasce cheio de alerta.
do $$
declare v_zero uuid;
begin
  insert into public.vehicles (brand, plate, created_at)
  values ('Mercedes', 'XYZ 9K88', now() - interval '1 day') returning id into v_zero;
  create temp table ctx3 as select v_zero as veiculo_id;
end $$;

select pg_temp.check(
  'C8 veículo cadastrado ontem não gera alerta retroativo',
  'true',
  (select (count(*) <= 1)::text from public.days_without_response(
     (select veiculo_id from ctx3), 1::smallint, public.today_local()))
);

-- ---------------------------------------------------------------------
--  D. Restrições de integridade
-- ---------------------------------------------------------------------
do $$
declare ok boolean := false;
begin
  begin
    insert into public.inspection_entries (vehicle_id, item_number, entry_date, status, nc_status, created_by)
    select veiculo_id, 3, pg_temp.hoje_util(), 'NC', 'pendente', insp_id from ctx;
  exception when check_violation then ok := true;
  end;
  insert into resultado values ('D1 NC sem descrição é recusada', 'true', ok::text);
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.inspection_entries (vehicle_id, item_number, entry_date, status, created_by)
    select veiculo_id, 1, pg_temp.du(5), 'C', insp_id from ctx;   -- já existe
  exception when unique_violation then ok := true;
  end;
  insert into resultado values ('D2 chave única veículo+item+data', 'true', ok::text);
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.inspection_entries (vehicle_id, item_number, entry_date, status, nc_status, problem_description, created_by)
    select veiculo_id, 9, pg_temp.hoje_util(), 'NC', 'pendente', 'x', insp_id from ctx;
  exception when check_violation then ok := true;
  end;
  insert into resultado values ('D3 item fora de 1..5 é recusado', 'true', ok::text);
end $$;

-- ---------------------------------------------------------------------
\echo ''
\echo '================= TESTE 1 — LÓGICA DE NEGÓCIO ================='
select
  case when esperado is not distinct from obtido then 'PASSOU' else 'FALHOU' end as r,
  nome, esperado, obtido
from resultado order by nome;

select count(*) filter (where esperado is distinct from obtido) as falhas,
       count(*) as total
from resultado;

do $$
declare f int;
begin
  select count(*) into f from resultado where esperado is distinct from obtido;
  if f > 0 then raise exception '% teste(s) de lógica falharam', f; end if;
end $$;
\echo 'TESTE 1: TODOS OS CASOS PASSARAM'
