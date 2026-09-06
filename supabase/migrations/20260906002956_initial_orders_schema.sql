-- Foundation only: no customer data and no default authorized user.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
create extension if not exists btree_gist with schema extensions;

create table private.configuracion_sistema (
 id boolean primary key default true check (id),
 usuario_autorizado_id uuid references auth.users(id) on delete restrict
);
insert into private.configuracion_sistema(id) values(true);
revoke all on private.configuracion_sistema from public, anon, authenticated;
alter table private.configuracion_sistema enable row level security;

create function private.es_usuario_autorizado() returns boolean
language sql stable security definer set search_path = ''
as $fn$
 select exists (
   select 1 from private.configuracion_sistema c
   where c.usuario_autorizado_id = (select auth.uid())
 );
$fn$;
revoke all on function private.es_usuario_autorizado() from public, anon;
grant execute on function private.es_usuario_autorizado() to authenticated;

create table public.empresas (
 id uuid primary key default gen_random_uuid(),
 codigo_interno text not null unique check (btrim(codigo_interno) <> ''),
 razon_social text not null check (btrim(razon_social) <> ''),
 pais text not null check (pais ~ '^[A-Z]{2}$'),
 identificacion_fiscal text, telefono text, email text,
 activa boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.roles_empresa (
 empresa_id uuid not null references public.empresas(id),
 rol text not null check (rol in ('empresa_usa','proveedor','cliente_mexico')),
 codigo_catalogo_origen text,
 primary key(empresa_id,rol),
 unique(rol,codigo_catalogo_origen)
);
create table public.domicilios_empresa (
 id uuid primary key default gen_random_uuid(),
 empresa_id uuid not null references public.empresas(id),
 direccion text not null check (btrim(direccion) <> ''),
 ciudad text, estado text, codigo_postal text,
 pais text not null check(pais ~ '^[A-Z]{2}$'),
 es_domicilio_entrega boolean not null default false,
 activo boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,empresa_id)
);
create unique index domicilio_entrega_unico on public.domicilios_empresa(empresa_id)
 where activo and es_domicilio_entrega;
create index domicilios_empresa_idx on public.domicilios_empresa(empresa_id);

create table public.unidades (
 id uuid primary key default gen_random_uuid(),
 codigo text not null unique check(btrim(codigo) <> ''),
 nombre text not null check(btrim(nombre) <> ''),
 etiqueta_es text, etiqueta_en text,
 permite_fraccion boolean not null default false,
 activa boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.productos (
 id uuid primary key default gen_random_uuid(),
 codigo text not null unique check(btrim(codigo) <> ''),
 descripcion_compra text not null check(btrim(descripcion_compra) <> ''),
 descripcion_venta text, descripcion_mexico text,
 unidad_compra_id uuid references public.unidades(id),
 unidad_venta_id uuid references public.unidades(id),
 unidad_mexico_id uuid references public.unidades(id),
 peso_unitario_kg numeric(18,6) check(peso_unitario_kg >= 0),
 factor_conversion numeric(18,6) check(factor_conversion > 0),
 activo boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index productos_unidad_compra_idx on public.productos(unidad_compra_id);
create index productos_unidad_venta_idx on public.productos(unidad_venta_id);
create index productos_unidad_mexico_idx on public.productos(unidad_mexico_id);

create table public.precios_compra (
 id uuid primary key default gen_random_uuid(),
 proveedor_id uuid not null,
 rol_proveedor text not null default 'proveedor' check(rol_proveedor='proveedor'),
 producto_id uuid not null references public.productos(id),
 unidad_id uuid not null references public.unidades(id),
 moneda text not null check(moneda ~ '^[A-Z]{3}$'),
 precio numeric(18,6) not null check(precio >= 0),
 vigente_desde date not null,
 vigente_hasta date,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(proveedor_id,rol_proveedor) references public.roles_empresa(empresa_id,rol),
 check(vigente_hasta is null or vigente_hasta > vigente_desde),
 exclude using gist (
 proveedor_id with =, producto_id with =, unidad_id with =, moneda with =,
 daterange(vigente_desde,vigente_hasta,'[)') with &&
 )
);
create index precios_compra_producto_idx on public.precios_compra(producto_id);
create index precios_compra_unidad_idx on public.precios_compra(unidad_id);
create index precios_compra_proveedor_idx on public.precios_compra(proveedor_id,rol_proveedor);

create table public.precios_venta (
 id uuid primary key default gen_random_uuid(),
 vendedor_id uuid not null,
 rol_vendedor text not null default 'empresa_usa' check(rol_vendedor='empresa_usa'),
 cliente_id uuid not null,
 rol_cliente text not null default 'cliente_mexico' check(rol_cliente='cliente_mexico'),
 producto_id uuid not null references public.productos(id),
 unidad_id uuid not null references public.unidades(id),
 moneda text not null check(moneda ~ '^[A-Z]{3}$'),
 precio numeric(18,6) not null check(precio >= 0),
 vigente_desde date not null,
 vigente_hasta date,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(vendedor_id,rol_vendedor) references public.roles_empresa(empresa_id,rol),
 foreign key(cliente_id,rol_cliente) references public.roles_empresa(empresa_id,rol),
 check(vigente_hasta is null or vigente_hasta > vigente_desde),
 exclude using gist (
 vendedor_id with =, cliente_id with =, producto_id with =, unidad_id with =, moneda with =,
 daterange(vigente_desde,vigente_hasta,'[)') with &&
 )
);
create index precios_venta_producto_idx on public.precios_venta(producto_id);
create index precios_venta_unidad_idx on public.precios_venta(unidad_id);
create index precios_venta_vendedor_idx on public.precios_venta(vendedor_id,rol_vendedor);
create index precios_venta_cliente_idx on public.precios_venta(cliente_id,rol_cliente);

create function private.actualizar_fecha() returns trigger
language plpgsql set search_path = '' as $fn$
begin new.updated_at := now(); return new; end;
$fn$;
revoke all on function private.actualizar_fecha() from public, anon, authenticated;

do $block$
declare tabla text;
begin
 foreach tabla in array array['empresas','roles_empresa','domicilios_empresa','unidades','productos','precios_compra','precios_venta']
 loop
 execute format('alter table public.%I enable row level security',tabla);
 execute format('revoke all on public.%I from public, anon, authenticated',tabla);
 execute format('grant select, insert, update on public.%I to authenticated',tabla);
 execute format('create policy acceso_usuario on public.%I for all to authenticated using ((select private.es_usuario_autorizado())) with check ((select private.es_usuario_autorizado()))',tabla);
 if tabla <> 'roles_empresa' then
 execute format('create trigger fecha_actualizacion before update on public.%I for each row execute function private.actualizar_fecha()',tabla);
 end if;
 end loop;
end;
$block$;
