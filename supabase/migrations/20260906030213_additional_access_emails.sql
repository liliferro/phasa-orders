alter table private.configuracion_sistema
 add column correos_adicionales text[] not null default '{}'::text[];

create or replace function private.es_usuario_autorizado() returns boolean
language sql stable security definer set search_path='' as $fn$
 select exists(
  select 1 from private.configuracion_sistema c join auth.users u on u.id=auth.uid()
  where u.email_confirmed_at is not null and
   ((c.usuario_autorizado_id is not null and u.id=c.usuario_autorizado_id)
    or (c.usuario_autorizado_id is null and
     (lower(u.email)=lower(c.correo_autorizado)
      or lower(u.email)=any(c.correos_adicionales))))
 );
$fn$;
