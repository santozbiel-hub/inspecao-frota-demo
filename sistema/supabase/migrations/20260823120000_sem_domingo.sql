-- =====================================================================
--  Gestão de Entregas — Migration 007
--  A fábrica roda de segunda a sábado. Domingo não é dia de inspeção.
--
--  A tela já bloqueia, mas a tela não é garantia: um aparelho com versão
--  antiga em cache, ou uma chamada direta à API, ainda conseguiria gravar
--  um registro de domingo. E registro de domingo é pior que erro visível,
--  porque `effective_entries` filtra domingo fora — o dado ficaria gravado
--  e invisível na grade.
--
--  `is_business_day` é IMMUTABLE, então serve em CHECK.
-- =====================================================================

alter table public.inspection_entries
  drop constraint if exists inspection_entries_dia_util;
alter table public.inspection_entries
  add constraint inspection_entries_dia_util
  check (public.is_business_day(entry_date));

alter table public.observations
  drop constraint if exists observations_dia_util;
alter table public.observations
  add constraint observations_dia_util
  check (public.is_business_day(entry_date));
