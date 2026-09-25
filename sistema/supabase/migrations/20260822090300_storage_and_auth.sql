-- =====================================================================
--  Gestão de Entregas — Migration 004
--  Bucket de fotos e gatilho do Auth.
--  Estes dois tocam schemas gerenciados pelo Supabase (storage/auth) e
--  por isso ficam separados: rodam no projeto Supabase, não no Postgres
--  simples usado nos testes locais.
-- =====================================================================

-- Gatilho que cria o profile junto com o usuário do Auth.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------- bucket
-- Privado: a foto de uma não-conformidade não fica exposta numa URL
-- pública adivinhável. O app pede URL assinada de curta duração.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inspection-photos',
  'inspection-photos',
  false,
  1048576,                                   -- 1 MB: o client comprime para ~150–250 KB
  array['image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Caminho do objeto: {auth.uid()}/{vehicle_id}/{data}-{item}.jpg
-- A primeira pasta ser o id do usuário é o que permite a policy abaixo
-- amarrar o arquivo a quem enviou.
drop policy if exists photos_insert on storage.objects;
create policy photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inspection-photos'
    and public.is_active_user()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists photos_select on storage.objects;
create policy photos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'inspection-photos' and public.is_active_user());

drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'inspection-photos'
    and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  );

drop policy if exists photos_delete on storage.objects;
create policy photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'inspection-photos' and public.is_admin());
