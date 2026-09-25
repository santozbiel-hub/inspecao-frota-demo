-- =====================================================================
--  Gestão de Entregas — Migration 008
--  Achado de auditoria de segurança (crítico): o gatilho que cria o
--  perfil junto com o usuário lia `role` direto do `raw_user_meta_data`
--  — que é o campo `options.data` do `supabase.auth.signUp()`, e quem
--  chama esse método controla o próprio conteúdo dele.
--
--  O app nunca chama `signUp()` (só `signInWithPassword` e a Edge
--  Function `criar-usuario`, que já checa admin antes). Mas o projeto
--  Supabase tem um interruptor solto, fora do código — "Allow new users
--  to sign up" — que qualquer um no painel pode ligar de novo (foi
--  mexido nesta mesma conversa, ao lado do de confirmação de e-mail). Se
--  ele estiver ligado em qualquer momento, e a anon key é pública por
--  definição, então:
--
--    POST {url}/auth/v1/signup
--    { "email": "...", "password": "...", "data": { "role": "admin" } }
--
--  criava uma conta com acesso total — cadastra/edita veículo, promove
--  outros usuários, apaga registro, tudo — sem passar por nenhuma
--  checagem de administrador.
--
--  A tela nunca ofereceu esse caminho, mas o banco não deve confiar em
--  nada que vem do cliente para decidir privilégio — é a mesma lógica
--  por trás da migration 007 (domingo). Corrigido aqui: todo perfil
--  novo nasce 'inspector', sempre, não importa o que o metadata diga.
--  Promoção a admin só existe por dentro do sistema (tela Usuários —
--  update em profiles.role, RLS já exige is_admin() para isso).
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    'inspector'  -- nunca confiar em role vindo do cliente (raw_user_meta_data)
  )
  on conflict (id) do nothing;
  return new;
end $$;
