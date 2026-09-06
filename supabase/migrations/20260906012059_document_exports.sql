create table public.plantillas_documento(
 id uuid primary key default gen_random_uuid(), version integer not null unique,
 nombre text not null, created_at timestamptz not null default now()
);
insert into public.plantillas_documento(version,nombre) values(1,'Formato original de cuatro documentos');
create table public.recursos_plantilla(
 plantilla_id uuid not null references public.plantillas_documento(id),
 nombre text not null, contenido text not null, mime_type text not null,
 primary key(plantilla_id,nombre)
);
alter table public.revisiones_operacion add column plantilla_id uuid references public.plantillas_documento(id);
update public.revisiones_operacion set plantilla_id=(select id from public.plantillas_documento where version=1) where plantilla_id is null;
create function private.asignar_plantilla() returns trigger language plpgsql set search_path='' as $f$
begin
 new.plantilla_id:=(select id from public.plantillas_documento order by version desc limit 1);
 if new.plantilla_id is null then raise exception 'Falta plantilla de documentos'; end if;
 return new;
end; $f$;
revoke all on function private.asignar_plantilla() from public,anon,authenticated;
create trigger asignar_plantilla before insert on public.revisiones_operacion for each row execute function private.asignar_plantilla();
create index revisiones_plantilla_idx on public.revisiones_operacion(plantilla_id);
create table public.exportaciones(
 id uuid primary key default gen_random_uuid(),
 revision_operacion_id uuid not null references public.revisiones_operacion(id),
 formato text not null check(formato in ('pdf','xlsx','zip')),
 documentos text[] not null check(cardinality(documentos)>0 and documentos <@ array['purchase_order','invoice','orden_compra_mexico','packing_list']::text[]),
 ruta_storage text not null unique check(ruta_storage like id::text||'/%'),
 nombre_archivo text not null,
 estado text not null default 'pendiente' check(estado in ('pendiente','listo','error')),
 sha256 text, error text, created_at timestamptz not null default now()
);
create index exportaciones_revision_idx on public.exportaciones(revision_operacion_id);
do $b$ declare t text; begin
 foreach t in array array['plantillas_documento','recursos_plantilla','exportaciones'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy lectura_propietario on public.%I for select to authenticated using ((select private.es_usuario_autorizado()))',t);
 end loop;
end; $b$;
grant insert on public.exportaciones to authenticated;
grant update(estado,sha256,error) on public.exportaciones to authenticated;
create policy crear_exportacion on public.exportaciones for insert to authenticated with check((select private.es_usuario_autorizado()));
create policy terminar_exportacion on public.exportaciones for update to authenticated using((select private.es_usuario_autorizado())) with check((select private.es_usuario_autorizado()));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('documentos','documentos',false,52428800,array['application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/zip']);
create policy descargar_documentos on storage.objects for select to authenticated
using(bucket_id='documentos' and (select private.es_usuario_autorizado()));
create policy subir_documentos on storage.objects for insert to authenticated
with check(bucket_id='documentos' and (select private.es_usuario_autorizado()) and exists(select 1 from public.exportaciones e where e.ruta_storage=name and e.estado='pendiente'));
