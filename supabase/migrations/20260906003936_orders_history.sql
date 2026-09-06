alter table private.configuracion_sistema add column correo_autorizado text;
create or replace function private.es_usuario_autorizado() returns boolean
language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from private.configuracion_sistema c join auth.users u on u.id=auth.uid()
 where u.email_confirmed_at is not null and
 ((c.usuario_autorizado_id is not null and u.id=c.usuario_autorizado_id)
 or (c.usuario_autorizado_id is null and lower(u.email)=c.correo_autorizado)));
$fn$;
create function public.acceso_permitido() returns boolean language sql stable
set search_path='' as $fn$ select private.es_usuario_autorizado(); $fn$;
revoke all on function public.acceso_permitido() from public,anon;
grant execute on function public.acceso_permitido() to authenticated;

create table public.purchase_orders (
 id uuid primary key default gen_random_uuid(), folio text not null unique check(btrim(folio)<>''),
 empresa_usa_id uuid not null references public.empresas(id),
 proveedor_id uuid not null references public.empresas(id),
 cliente_id uuid not null references public.empresas(id),
 domicilio_entrega_id uuid not null,
 fecha date not null,
 revision integer not null default 0 check(revision>=0),
 estado text not null default 'borrador' check(estado in ('borrador','confirmada','cancelada')),
 moneda_compra text not null check(moneda_compra ~ '^[A-Z]{3}$'),
 moneda_venta text not null check(moneda_venta ~ '^[A-Z]{3}$'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(domicilio_entrega_id,cliente_id) references public.domicilios_empresa(id,empresa_id)
);
create table public.partidas_purchase_order (
 id uuid primary key default gen_random_uuid(), purchase_order_id uuid not null references public.purchase_orders(id),
 numero_partida integer not null check(numero_partida>0), producto_id uuid not null references public.productos(id),
 codigo text not null, descripcion_compra text not null, descripcion_venta text not null, descripcion_mexico text not null,
 unidad text not null, cantidad numeric(18,4) not null check(cantidad>0),
 precio_compra numeric(18,6) check(precio_compra>=0), precio_venta numeric(18,6) check(precio_venta>=0),
 peso_unitario_kg numeric(18,6) check(peso_unitario_kg>=0),
 importe_compra numeric(18,2) generated always as (round(cantidad*precio_compra,2)) stored,
 importe_venta numeric(18,2) generated always as (round(cantidad*precio_venta,2)) stored,
 peso_total_kg numeric(18,6) generated always as (cantidad*peso_unitario_kg) stored,
 unique(purchase_order_id,numero_partida)
);
create table public.revisiones_operacion (
 id uuid primary key default gen_random_uuid(), purchase_order_id uuid not null references public.purchase_orders(id),
 numero_revision integer not null check(numero_revision>0),
 clave_guardado uuid not null unique,
 revision_origen_id uuid references public.revisiones_operacion(id),
 motivo text not null default '', datos jsonb not null check(jsonb_typeof(datos)='object'),
 guardado_por uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(purchase_order_id,numero_revision), unique(id,purchase_order_id)
);
create table public.documentos (
 id uuid primary key default gen_random_uuid(), purchase_order_id uuid not null references public.purchase_orders(id),
 tipo text not null check(tipo in ('purchase_order','invoice','orden_compra_mexico','packing_list')),
 unique(purchase_order_id,tipo), unique(id,purchase_order_id)
);
create table public.versiones_documento (
 id uuid primary key default gen_random_uuid(), documento_id uuid not null, purchase_order_id uuid not null,
 revision_operacion_id uuid not null, datos jsonb not null check(jsonb_typeof(datos)='object'),
 created_at timestamptz not null default now(),
 foreign key(documento_id,purchase_order_id) references public.documentos(id,purchase_order_id),
 foreign key(revision_operacion_id,purchase_order_id) references public.revisiones_operacion(id,purchase_order_id),
 unique(documento_id,revision_operacion_id)
);
create index orders_supplier on public.purchase_orders(proveedor_id);
create index orders_client_address on public.purchase_orders(domicilio_entrega_id,cliente_id);
create index orders_client on public.purchase_orders(cliente_id);
create index orders_issuer on public.purchase_orders(empresa_usa_id);
create index lines_product on public.partidas_purchase_order(producto_id);
create index revisions_origin on public.revisiones_operacion(revision_origen_id);
create index revisions_user on public.revisiones_operacion(guardado_por);
create index versions_revision on public.versiones_documento(revision_operacion_id,purchase_order_id);

do $block$ declare t text; begin
 foreach t in array array['purchase_orders','partidas_purchase_order','revisiones_operacion','documentos','versiones_documento'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy lectura_autorizada on public.%I for select to authenticated using ((select private.es_usuario_autorizado()))',t);
 end loop;
end; $block$;

-- Privileged transaction is private and checks authorization explicitly.
-- The public invoker wrapper exposes only this validated operation.
create function private.guardar_operacion(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
 oid uuid; rid uuid; did uuid; current_revision integer; next_revision integer;
 line jsonb; prod public.productos; item_count integer:=0;
 kind text; body jsonb; common jsonb; headers jsonb; existing jsonb;
 supplier uuid:=(p->>'proveedor_id')::uuid; client uuid:=(p->>'cliente_id')::uuid;
 issuer uuid:=(p->>'empresa_usa_id')::uuid; address uuid:=(p->>'domicilio_entrega_id')::uuid;
 request_key uuid:=(p->>'clave_guardado')::uuid;
begin
 if not private.es_usuario_autorizado() then raise exception 'Acceso no autorizado' using errcode='42501'; end if;
 if request_key is null then raise exception 'Falta identificador del guardado'; end if;
 perform pg_advisory_xact_lock(hashtextextended(request_key::text,0));
 select jsonb_build_object('id',purchase_order_id,'revision',numero_revision,'revision_id',id)
 into existing from public.revisiones_operacion where clave_guardado=request_key;
 if existing is not null then return existing; end if;
 if not exists(select 1 from public.roles_empresa r join public.empresas e on e.id=r.empresa_id where r.empresa_id=supplier and r.rol='proveedor' and e.activa)
 or not exists(select 1 from public.roles_empresa r join public.empresas e on e.id=r.empresa_id where r.empresa_id=client and r.rol='cliente_mexico' and e.activa)
 or not exists(select 1 from public.roles_empresa r join public.empresas e on e.id=r.empresa_id where r.empresa_id=issuer and r.rol='empresa_usa' and e.activa)
 then raise exception 'Revisa proveedor, cliente y empresa emisora'; end if;
 if not exists(select 1 from public.domicilios_empresa where id=address and empresa_id=client and activo and es_domicilio_entrega)
 then raise exception 'El destino debe ser el domicilio vigente del cliente'; end if;
 if jsonb_typeof(p->'partidas') is distinct from 'array' or jsonb_array_length(p->'partidas')=0 then raise exception 'Agrega al menos un producto'; end if;
 headers:=coalesce(p->'encabezados','{}'::jsonb);
 if jsonb_typeof(headers)<>'object' then raise exception 'Encabezados inválidos'; end if;
 oid:=nullif(p->>'id','')::uuid;
 if oid is null then
 insert into public.purchase_orders(folio,empresa_usa_id,proveedor_id,cliente_id,domicilio_entrega_id,fecha,moneda_compra,moneda_venta)
 values(p->>'folio',issuer,supplier,client,address,(p->>'fecha')::date,p->>'moneda_compra',p->>'moneda_venta') returning id,revision into oid,current_revision;
 else
 select revision into current_revision from public.purchase_orders where id=oid for update;
 if not found then raise exception 'La operación no existe'; end if;
 if current_revision<>(p->>'revision')::integer or p->>'revision' is null then raise exception 'La operación cambió. Recarga antes de guardar.' using errcode='40001'; end if;
 end if;
 next_revision:=current_revision+1;
 update public.purchase_orders set folio=p->>'folio',empresa_usa_id=issuer,proveedor_id=supplier,cliente_id=client,
 domicilio_entrega_id=address,fecha=(p->>'fecha')::date,moneda_compra=p->>'moneda_compra',moneda_venta=p->>'moneda_venta',
 revision=next_revision,updated_at=now() where id=oid;
 if nullif(p->>'revision_origen_id','') is not null and not exists(select 1 from public.revisiones_operacion where id=(p->>'revision_origen_id')::uuid and purchase_order_id=oid)
 then raise exception 'La revisión de origen no pertenece a esta operación'; end if;
 delete from public.partidas_purchase_order where purchase_order_id=oid;
 for line in select value from jsonb_array_elements(p->'partidas') loop
 item_count:=item_count+1;
 select * into prod from public.productos where id=(line->>'producto_id')::uuid;
 if not found then raise exception 'Producto inexistente'; end if;
 insert into public.partidas_purchase_order(purchase_order_id,numero_partida,producto_id,codigo,descripcion_compra,descripcion_venta,descripcion_mexico,unidad,cantidad,precio_compra,precio_venta,peso_unitario_kg)
 values(oid,item_count,prod.id,prod.codigo,coalesce(line->>'descripcion_compra',prod.descripcion_compra),
 coalesce(line->>'descripcion_venta',prod.descripcion_venta,prod.descripcion_compra),
 coalesce(line->>'descripcion_mexico',prod.descripcion_mexico,prod.descripcion_compra),
 coalesce(line->>'unidad',(select codigo from public.unidades where id=prod.unidad_compra_id)),
 (line->>'cantidad')::numeric,(line->>'precio_compra')::numeric,(line->>'precio_venta')::numeric,(line->>'peso_unitario_kg')::numeric);
 end loop;
 select jsonb_build_object('operacion',to_jsonb(o),'proveedor',to_jsonb(s),'cliente',to_jsonb(c),'empresa_usa',to_jsonb(e),'domicilio',to_jsonb(a),
 'partidas',(select jsonb_agg(to_jsonb(l) order by numero_partida) from public.partidas_purchase_order l where purchase_order_id=oid),
 'encabezados',headers,'regla_edicion','propagar_con_historial',
 'redondeo','precio_6_decimales_importe_partida_2_provisional')
 into common from public.purchase_orders o join public.empresas s on s.id=o.proveedor_id join public.empresas c on c.id=o.cliente_id
 join public.empresas e on e.id=o.empresa_usa_id join public.domicilios_empresa a on a.id=o.domicilio_entrega_id where o.id=oid;
 insert into public.revisiones_operacion(purchase_order_id,numero_revision,clave_guardado,revision_origen_id,motivo,datos,guardado_por)
 values(oid,next_revision,request_key,nullif(p->>'revision_origen_id','')::uuid,coalesce(p->>'motivo',''),common,auth.uid()) returning id into rid;
 foreach kind in array array['purchase_order','invoice','orden_compra_mexico','packing_list'] loop
 insert into public.documentos(purchase_order_id,tipo) values(oid,kind) on conflict(purchase_order_id,tipo) do nothing;
 select id into did from public.documentos where purchase_order_id=oid and tipo=kind;
 body:=common || jsonb_build_object('tipo',kind,'encabezado',coalesce(headers->kind,'{}'::jsonb));
 insert into public.versiones_documento(documento_id,purchase_order_id,revision_operacion_id,datos) values(did,oid,rid,body);
 end loop;
 return jsonb_build_object('id',oid,'revision',next_revision,'revision_id',rid);
end; $fn$;
revoke all on function private.guardar_operacion(jsonb) from public,anon;
grant execute on function private.guardar_operacion(jsonb) to authenticated;
create function public.guardar_operacion(p jsonb) returns jsonb language sql set search_path=''
as $fn$ select private.guardar_operacion(p); $fn$;
revoke all on function public.guardar_operacion(jsonb) from public,anon;
grant execute on function public.guardar_operacion(jsonb) to authenticated;
