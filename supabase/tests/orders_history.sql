begin;
insert into auth.users(id,email,email_confirmed_at) values('11111111-1111-4111-8111-111111111111','order-tests@example.invalid',now());
update private.configuracion_sistema set usuario_autorizado_id='11111111-1111-4111-8111-111111111111';
insert into public.empresas(codigo_interno,razon_social,pais) values ('FIXTURE-USA','Test issuer','US'),('FIXTURE-SUP','Test supplier','CN'),('FIXTURE-CLI','Test client','MX');
insert into public.roles_empresa(empresa_id,rol) select id,case codigo_interno when 'FIXTURE-USA' then 'empresa_usa' when 'FIXTURE-SUP' then 'proveedor' else 'cliente_mexico' end from public.empresas where codigo_interno like 'FIXTURE-%';
insert into public.domicilios_empresa(empresa_id,direccion,pais,es_domicilio_entrega) select id,'Test address','MX',true from public.empresas where codigo_interno='FIXTURE-CLI';
insert into public.productos(codigo,descripcion_compra) values('FIXTURE-PRODUCT','Test product');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local role authenticated;
do $test$ declare payload jsonb; first_save jsonb; second_save jsonb; copied jsonb; cnt integer;
begin
 select jsonb_build_object('clave_guardado',gen_random_uuid(),'folio','TEST-ROLLBACK','empresa_usa_id',e.id,
 'proveedor_id',s.id,'cliente_id',c.id,'domicilio_entrega_id',a.id,'fecha','2026-09-05',
 'moneda_compra','USD','moneda_venta','USD',
 'partidas',jsonb_build_array(jsonb_build_object('producto_id',p.id,'cantidad',200,'precio_compra',78,'precio_venta',80,'peso_unitario_kg',65,'unidad','ROLL')))
 into payload from public.empresas e,public.empresas s,public.empresas c,public.domicilios_empresa a,public.productos p
 where e.codigo_interno='FIXTURE-USA' and s.codigo_interno='FIXTURE-SUP' and c.codigo_interno='FIXTURE-CLI' and a.empresa_id=c.id and p.codigo='FIXTURE-PRODUCT';
 first_save:=public.guardar_operacion(payload);
 if (first_save->>'revision')::integer<>1 then raise exception 'Wrong first revision'; end if;
 copied:=public.guardar_operacion(payload);
 if copied<>first_save then raise exception 'Idempotency failed'; end if;
 payload:=payload || jsonb_build_object('id',first_save->>'id','revision',1,'clave_guardado',gen_random_uuid(),'partidas',jsonb_set(payload->'partidas','{0,cantidad}','100'));
 second_save:=public.guardar_operacion(payload);
 select count(*) into cnt from public.versiones_documento where purchase_order_id=(first_save->>'id')::uuid;
 if cnt<>8 then raise exception 'Expected 8 historical document versions, got %',cnt; end if;
 if (select (datos->'partidas'->0->>'importe_venta')::numeric from public.revisiones_operacion where id=(first_save->>'revision_id')::uuid)<>16000 then raise exception 'History changed'; end if;
 if (select (datos->'partidas'->0->>'importe_venta')::numeric from public.revisiones_operacion where id=(second_save->>'revision_id')::uuid)<>8000 then raise exception 'New totals incorrect'; end if;
 begin
 perform public.guardar_operacion(payload || jsonb_build_object('clave_guardado',gen_random_uuid()));
 raise exception 'Stale revision accepted';
 exception when serialization_failure then null; end;
 begin
 update public.revisiones_operacion set datos='{}';
 raise exception 'History modification allowed';
 exception when insufficient_privilege then null; end;
end; $test$;
reset role;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
set local role authenticated;
do $test$ begin
 if public.acceso_permitido() then raise exception 'Unauthorized owner accepted'; end if;
 if exists(select 1 from public.purchase_orders) then raise exception 'Unauthorized history read'; end if;
 begin
 perform public.guardar_operacion('{}'::jsonb);
 raise exception 'Unauthorized save accepted';
 exception when insufficient_privilege then null; end;
end; $test$;
reset role;
rollback;
select 'PASS: four documents per revision, shared recalculation, immutable history, stale write rejection, idempotency and authorization; all fixtures rolled back' as result;
