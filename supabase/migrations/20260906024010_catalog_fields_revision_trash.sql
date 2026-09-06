alter table public.revisiones_operacion add column eliminada_at timestamptz;
alter table public.productos
 add column precio_heq_kimix numeric(18,6) check(precio_heq_kimix>=0),
 add column factor_columna_115 numeric(18,6) check(factor_columna_115>=0),
 add column precio_kimix_pha numeric(18,6) check(precio_kimix_pha>=0);

create function private.papelera_revision(revision_id uuid, eliminar boolean) returns void
language plpgsql security definer set search_path='' as $fn$
begin
 if not private.es_usuario_autorizado() then raise exception 'No autorizado' using errcode='42501'; end if;
 if eliminar is null then raise exception 'Indica eliminar o restaurar'; end if;
 update public.revisiones_operacion set eliminada_at=case when eliminar then coalesce(eliminada_at,now()) else null end where id=revision_id;
 if not found then raise exception 'La versión no existe'; end if;
end; $fn$;
revoke all on function private.papelera_revision(uuid,boolean) from public,anon;
grant execute on function private.papelera_revision(uuid,boolean) to authenticated;
create function public.papelera_revision(revision_id uuid, eliminar boolean) returns void
language sql set search_path='' as $fn$ select private.papelera_revision(revision_id,eliminar); $fn$;
revoke all on function public.papelera_revision(uuid,boolean) from public,anon;
grant execute on function public.papelera_revision(uuid,boolean) to authenticated;
