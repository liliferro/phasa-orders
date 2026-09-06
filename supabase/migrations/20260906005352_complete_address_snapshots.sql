create or replace function private.guardar_operacion(p jsonb) returns jsonb
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
 'proveedor_domicilios',(select jsonb_agg(to_jsonb(d)) from public.domicilios_empresa d where d.empresa_id=supplier and d.activo),
 'empresa_usa_domicilios',(select jsonb_agg(to_jsonb(d)) from public.domicilios_empresa d where d.empresa_id=issuer and d.activo),
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
