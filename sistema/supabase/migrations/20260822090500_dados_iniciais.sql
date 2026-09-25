-- =====================================================================
--  Gestão de Entregas — Migration 006
--  Dados iniciais: o caminhão que aparece no formulário de papel.
--
--  É idempotente de propósito: rodar de novo não duplica nem sobrescreve
--  o que a empresa já cadastrou pela tela. Os demais caminhões e os
--  motoristas entram pelo próprio sistema.
--
--  O administrador NÃO é criado aqui: usuário nasce no Supabase Auth
--  (Authentication → Users), e o gatilho `handle_new_user` cria o perfil.
--  Para promover o primeiro, veja o README.
-- =====================================================================

insert into public.vehicles (brand, model, plate, internal_code, active)
values ('Marca Exemplo', 'Modelo A', 'DEM0A01', '01', true)
on conflict do nothing;
