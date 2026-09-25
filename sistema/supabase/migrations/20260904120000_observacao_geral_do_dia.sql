-- =====================================================================
--  Gestão de Entregas — Migration 014
--  Observação geral do dia (pedido da empresa, 04/09/2026).
--
--  Até aqui toda observação nascia presa a um dos 5 itens da folha. Mas
--  boa parte do que o motorista precisa registrar não é sobre óleo, água,
--  freio, Thermo King ou pneu: "cheguei atrasado por causa do trânsito na
--  Dutra", "o baú está com cheiro forte", "o cliente reclamou da entrega".
--  Sem lugar para isso, ou a anotação era pendurada num item que nada tem
--  a ver com ela — sujando o histórico daquele item — ou simplesmente não
--  era escrita.
--
--  A escolha de modelagem: reaproveitar `observations` com o item 0 em vez
--  de criar uma tabela nova. O motivo é o app ser offline-first — uma
--  tabela nova exigiria uma segunda store no IndexedDB, uma segunda fila,
--  um segundo merge e um segundo conjunto de policies, tudo duplicado e
--  cada cópia com sua própria chance de bug. Com o item 0, a observação
--  geral herda de graça a fila offline, o RLS, o download e a folha
--  impressa que já existem e já foram testados.
--
--  0 é um valor legítimo aqui, não um "nulo disfarçado": NULL sairia do
--  índice [vehicle_id, item_number, entry_date] do IndexedDB, que não
--  indexa chaves nulas — a observação geral ficaria invisível para a
--  própria tela que deveria mostrá-la.
--
--  `inspection_entries` NÃO muda: item 0 não tem status C/NC, não entra na
--  grade e não arrasta não-conformidade. É anotação, não inspeção.
-- =====================================================================

alter table public.observations
  drop constraint if exists observations_item_number_check;

alter table public.observations
  add constraint observations_item_number_check
  check (item_number between 0 and 5);

comment on column public.observations.item_number is
  '1..5 = observação do item correspondente da folha; 0 = observação geral do dia, sem relação com os itens de inspeção.';
