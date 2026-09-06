begin;
insert into auth.users(id,email_confirmed_at) values ('11111111-1111-4111-8111-111111111111',now());
update private.configuracion_sistema set usuario_autorizado_id='11111111-1111-4111-8111-111111111111';
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local role authenticated;
insert into public.empresas(codigo_interno,razon_social,pais) values ('TEST-SUP','Test supplier','CN');
update public.empresas set telefono='TEST' where codigo_interno='TEST-SUP';
do $test$
begin
 if (select count(*) from public.empresas where telefono='TEST') <> 1 then raise exception 'Owner access failed'; end if;
 begin
 delete from public.empresas;
 raise exception 'Delete unexpectedly allowed';
 exception when insufficient_privilege then null;
 end;
end;
$test$;
reset role;
insert into public.roles_empresa(empresa_id,rol) select id,'proveedor' from public.empresas where codigo_interno='TEST-SUP';
insert into public.unidades(codigo,nombre) values('TEST','Test unit');
insert into public.productos(codigo,descripcion_compra) values('TEST','Test product');
insert into public.precios_compra(proveedor_id,producto_id,unidad_id,moneda,precio,vigente_desde)
select e.id,p.id,u.id,'USD',80,'2026-01-01'
from public.empresas e,public.productos p,public.unidades u
where e.codigo_interno='TEST-SUP' and p.codigo='TEST' and u.codigo='TEST';
do $test$
begin
 begin
 insert into public.precios_compra(proveedor_id,producto_id,unidad_id,moneda,precio,vigente_desde)
 select proveedor_id,producto_id,unidad_id,moneda,90,'2026-02-01' from public.precios_compra;
 raise exception 'Overlap unexpectedly allowed';
 exception when exclusion_violation then null;
 end;
end;
$test$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
set local role authenticated;
do $test$
begin
 if (select count(*) from public.empresas) <> 0 then raise exception 'Unauthorized read allowed'; end if;
 update public.empresas set razon_social='Unauthorized';
 if found then raise exception 'Unauthorized update allowed'; end if;
 begin
 insert into public.empresas(codigo_interno,razon_social,pais) values('BAD','Bad','CN');
 raise exception 'Unauthorized insert allowed';
 exception when insufficient_privilege then null;
 end;
 begin
 update private.configuracion_sistema set usuario_autorizado_id=auth.uid();
 raise exception 'Privilege escalation allowed';
 exception when insufficient_privilege then null;
 end;
end;
$test$;
reset role;
set local role anon;
do $test$
begin
 begin
 perform * from public.empresas;
 raise exception 'Anonymous read allowed';
 exception when insufficient_privilege then null;
 end;
end;
$test$;
reset role;
rollback;
select 'PASS: owner CRUD permissions, unauthorized access, privilege escalation, anonymous access and overlapping prices; fixtures rolled back' as result;
