begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('11111111-1111-4111-8111-111111111111','primary@example.invalid',now()),
 ('22222222-2222-4222-8222-222222222222','additional@example.invalid',now()),
 ('33333333-3333-4333-8333-333333333333','unverified@example.invalid',null),
 ('44444444-4444-4444-8444-444444444444','outsider@example.invalid',now());
update private.configuracion_sistema set usuario_autorizado_id=null,
 correo_autorizado='primary@example.invalid',
 correos_adicionales=array['additional@example.invalid','unverified@example.invalid'];
set local role authenticated;
do $test$ begin
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 if not public.acceso_permitido() then raise exception 'Primary access lost'; end if;
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 if not public.acceso_permitido() then raise exception 'Additional access denied'; end if;
 perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
 if public.acceso_permitido() then raise exception 'Unverified email allowed'; end if;
 perform set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
 if public.acceso_permitido() then raise exception 'Unlisted email allowed'; end if;
 if has_table_privilege('authenticated','private.configuracion_sistema','UPDATE') then raise exception 'Access configuration exposed'; end if;
end; $test$;
reset role;
rollback;
select 'PASS: primary and additional verified access; unverified and unlisted rejected; fixtures rolled back' as result;
