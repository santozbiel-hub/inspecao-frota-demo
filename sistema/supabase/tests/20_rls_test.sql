-- =====================================================================
--  Teste 3 — Row Level Security
--  Simula chamadas diretas de API (não passa pela interface): assume a
--  role `authenticated` e o mesmo GUC de sub que o PostgREST do Supabase
--  preenche a partir do JWT.
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages to warning;

-- A política do inspetor amarra a gravação a `today_local()`, e domingo não
-- aceita registro (constraint `*_dia_util`). Para a suíte rodar em qualquer
-- dia da semana, ancoramos today_local() no dia útil mais recente — só
-- neste banco de teste, que é descartado ao final.
create or replace function public.today_local() returns date
language sql stable as $$
  select case
    when public.is_business_day((now() at time zone 'America/Sao_Paulo')::date)
      then (now() at time zone 'America/Sao_Paulo')::date
      else (now() at time zone 'America/Sao_Paulo')::date - 1
  end;
$$;

create temp table rls_resultado (nome text, esperado text, obtido text);

create or replace function pg_temp.reg(p_nome text, p_esp text, p_obt text)
returns void language plpgsql as $$ begin
  insert into rls_resultado values (p_nome, p_esp, p_obt);
end $$;

-- Executa um comando como um usuário autenticado e diz se ele passou.
create or replace function pg_temp.como(p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  execute p_sql;
  get diagnostics n = row_count;
  reset role;
  return case when n > 0 then 'ok:' || n else 'zero-linhas' end;
exception
  when insufficient_privilege then reset role; return 'negado';
  when others then reset role; return 'erro:' || sqlstate;
end $$;

-- --------------------------------------------------------------- setup
do $$
declare a uuid; i1 uuid; i2 uuid; inat uuid; v uuid; v2 uuid;
begin
  insert into auth.users (email) values ('usuario-2e8a5fcc@example.invalid')   returning id into a;
  insert into auth.users (email) values ('usuario-c5f45e21@example.invalid')  returning id into i1;
  insert into auth.users (email) values ('usuario-86d332d3@example.invalid') returning id into i2;
  insert into auth.users (email) values ('usuario-55eb27e7@example.invalid')    returning id into inat;

  insert into public.profiles (id, name, role, active) values
    (a,   'Administrador',  'admin',     true),
    (i1,  'João',           'inspector', true),
    (i2,  'Maria',          'inspector', true),
    (inat,'Ex-funcionário', 'inspector', false);

  insert into public.vehicles (brand, model, plate, created_at)
  values ('Marca Exemplo','Modelo A','FJP 9H46', now() - interval '200 days') returning id into v;
  insert into public.vehicles (brand, plate, created_at)
  values ('Iveco','QQQ 1A11', now() - interval '200 days') returning id into v2;

  -- João registra hoje uma NC no item 1.
  insert into public.inspection_entries
    (vehicle_id, item_number, entry_date, status, nc_status, problem_description, created_by)
  values (v, 1, public.today_local(), 'NC', 'pendente', 'Pneu careca.', i1);

  create temp table rctx as
    select a as adm, i1 as joao, i2 as maria, inat as inativo, v as veic, v2 as veic2;
end $$;

-- --------------------------------------------------------------- casos
-- R1 — inspetor não altera registro de outro inspetor
select pg_temp.reg('R1 inspetor não altera registro de outro inspetor', 'zero-linhas',
  pg_temp.como((select maria from rctx), format(
    'update public.inspection_entries set problem_description = ''invadido'' where vehicle_id = %L and item_number = 1',
    (select veic from rctx))));

-- R2 — inspetor não resolve não-conformidade (nem a própria)
select pg_temp.reg('R2 inspetor não marca NC como resolvida', 'negado',
  pg_temp.como((select joao from rctx), format(
    'update public.inspection_entries set nc_status = ''resolvido'' where vehicle_id = %L and item_number = 1',
    (select veic from rctx))));

-- R3 — inspetor pode, sim, editar o próprio registro do dia (controle positivo)
select pg_temp.reg('R3 inspetor edita o próprio registro de hoje', 'ok:1',
  pg_temp.como((select joao from rctx), format(
    'update public.inspection_entries set problem_description = ''Pneu dianteiro esquerdo careca.'' where vehicle_id = %L and item_number = 1',
    (select veic from rctx))));

-- R4 — administrador resolve
select pg_temp.reg('R4 administrador resolve a NC', 'ok:1',
  pg_temp.como((select adm from rctx), format(
    'update public.inspection_entries set nc_status = ''resolvido'' where vehicle_id = %L and item_number = 1',
    (select veic from rctx))));

-- R5 — inspetor não cria registro em nome de outro
select pg_temp.reg('R5 inspetor não cria registro em nome de outro', 'negado',
  pg_temp.como((select maria from rctx), format(
    'insert into public.inspection_entries (vehicle_id,item_number,entry_date,status,created_by) values (%L,2,public.today_local(),''C'',%L)',
    (select veic from rctx), (select joao from rctx))));

-- R6 — inspetor não registra data passada (só o dia corrente)
select pg_temp.reg('R6 inspetor não registra data passada', 'negado',
  pg_temp.como((select joao from rctx), format(
    'insert into public.inspection_entries (vehicle_id,item_number,entry_date,status,created_by) values (%L,3,public.today_local()-7,''C'',%L)',
    (select veic from rctx), (select joao from rctx))));

-- R7 — administrador registra data passada
select pg_temp.reg('R7 administrador registra data passada', 'ok:1',
  pg_temp.como((select adm from rctx), format(
    'insert into public.inspection_entries (vehicle_id,item_number,entry_date,status,created_by) values (%L,3,public.today_local()-7,''C'',%L)',
    (select veic from rctx), (select adm from rctx))));

-- R8 — inspetor não cadastra veículo
select pg_temp.reg('R8 inspetor não cadastra veículo', 'negado',
  pg_temp.como((select joao from rctx),
    'insert into public.vehicles (brand,plate) values (''Scania'',''ZZZ 0A00'')'));

-- R9 — inspetor não apaga registro
select pg_temp.reg('R9 inspetor não apaga registro', 'zero-linhas',
  pg_temp.como((select joao from rctx), format(
    'delete from public.inspection_entries where vehicle_id = %L and item_number = 1',
    (select veic from rctx))));

-- R10 — inspetor não se promove a administrador
select pg_temp.reg('R10 inspetor não se promove a admin', 'zero-linhas',
  pg_temp.como((select joao from rctx), format(
    'update public.profiles set role = ''admin'' where id = %L', (select joao from rctx))));

-- R11 — inspetor não cria usuário
select pg_temp.reg('R11 inspetor não cria perfil de usuário', 'negado',
  pg_temp.como((select joao from rctx),
    'insert into public.profiles (id,name,role) values (gen_random_uuid(),''Fantasma'',''admin'')'));

-- R12 — usuário desativado não enxerga nada
select pg_temp.reg('R12 usuário desativado não lê registros', 'zero-linhas',
  pg_temp.como((select inativo from rctx),
    'create temp table _l as select * from public.inspection_entries'));

-- R13 — usuário desativado não escreve
select pg_temp.reg('R13 usuário desativado não escreve', 'negado',
  pg_temp.como((select inativo from rctx), format(
    'insert into public.inspection_entries (vehicle_id,item_number,entry_date,status,created_by) values (%L,4,public.today_local(),''C'',%L)',
    (select veic from rctx), (select inativo from rctx))));

-- R14 — mês fechado trava o inspetor
do $$
declare v uuid := (select veic2 from rctx); a uuid := (select adm from rctx);
begin
  insert into public.month_closures (vehicle_id, month, year, closed_by)
  values (v, extract(month from public.today_local())::smallint,
             extract(year  from public.today_local())::smallint, a);
end $$;

select pg_temp.reg('R14 mês fechado trava o inspetor', 'negado',
  pg_temp.como((select joao from rctx), format(
    'insert into public.inspection_entries (vehicle_id,item_number,entry_date,status,created_by) values (%L,1,public.today_local(),''C'',%L)',
    (select veic2 from rctx), (select joao from rctx))));

-- R15 — mês fechado não trava o administrador
select pg_temp.reg('R15 mês fechado não trava o administrador', 'ok:1',
  pg_temp.como((select adm from rctx), format(
    'insert into public.inspection_entries (vehicle_id,item_number,entry_date,status,created_by) values (%L,1,public.today_local(),''C'',%L)',
    (select veic2 from rctx), (select adm from rctx))));

-- R16 — inspetor não fecha o mês
select pg_temp.reg('R16 inspetor não fecha o mês', 'negado',
  pg_temp.como((select joao from rctx), format(
    'insert into public.month_closures (vehicle_id,month,year,closed_by) values (%L,1,2026,%L)',
    (select veic from rctx), (select joao from rctx))));

-- R17 — RPC de resolver recusa inspetor
select pg_temp.reg('R17 RPC resolve_nonconformity recusa inspetor', 'negado',
  pg_temp.como((select joao from rctx), format(
    'select public.resolve_nonconformity((select id from public.inspection_entries where vehicle_id=%L and item_number=1))',
    (select veic from rctx))));

-- R18 — observação só em nome próprio
select pg_temp.reg('R18 observação só em nome próprio', 'negado',
  pg_temp.como((select maria from rctx), format(
    'insert into public.observations (vehicle_id,item_number,entry_date,text,author_id) values (%L,1,public.today_local(),''oi'',%L)',
    (select veic from rctx), (select joao from rctx))));

-- R19 — anônimo (sem sessão) não lê nada
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin
    execute 'select count(*) from public.inspection_entries';
    n := 1;
  exception when insufficient_privilege then n := 0;
  end;
  reset role;
  insert into rls_resultado values ('R19 anônimo não lê registros', '0', n::text);
end $$;

-- ---------------------------------------------------------------------
\echo ''
\echo '===================== TESTE 3 — RLS ====================='
select case when esperado is not distinct from obtido then 'PASSOU' else 'FALHOU' end as r,
       nome, esperado, obtido
from rls_resultado order by nome;

do $$
declare f int;
begin
  select count(*) into f from rls_resultado where esperado is distinct from obtido;
  if f > 0 then raise exception '% teste(s) de RLS falharam', f; end if;
end $$;
\echo 'TESTE 3: TODAS AS POLICIES SE COMPORTARAM COMO O ESPERADO'
