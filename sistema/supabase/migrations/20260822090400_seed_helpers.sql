-- =====================================================================
--  Gestão de Entregas — Migration 005
--  Função de conveniência para o administrador resolver uma
--  não-conformidade. Existe para que o client não precise saber
--  carimbar resolved_at nem repetir a regra.
-- =====================================================================

create or replace function public.resolve_nonconformity(
  p_entry_id uuid,
  p_new_status public.nc_status default 'resolvido'
)
returns public.inspection_entries
language plpgsql security invoker as $$
declare
  v_row public.inspection_entries;
begin
  if not public.is_admin() then
    raise exception 'Apenas o administrador pode alterar o andamento de uma não conformidade'
      using errcode = '42501';
  end if;

  update public.inspection_entries
     set nc_status = p_new_status
   where id = p_entry_id and status = 'NC'
  returning * into v_row;

  if not found then
    raise exception 'Registro de não conformidade não encontrado' using errcode = 'P0002';
  end if;

  return v_row;
end $$;

grant execute on function public.resolve_nonconformity(uuid, public.nc_status) to authenticated;
