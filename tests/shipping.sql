-- Run inside BEGIN / ROLLBACK. No requests to ZR and no persistent fixtures.
reset role;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous) values
 ('40000000-0000-4000-8000-000000000001','zr-owner@weconvert.invalid',now(),'{}','{}',false),
 ('40000000-0000-4000-8000-000000000002','zr-agent@weconvert.invalid',now(),'{}','{}',false),
 ('40000000-0000-4000-8000-000000000003','zr-outsider@weconvert.invalid',now(),'{}','{}',false);
create temp table zr_test(k text primary key,v jsonb);
grant select,insert on zr_test to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into zr_test values('w',to_jsonb(public.crm_bootstrap('ZR test','ZR shop','Owner test',gen_random_uuid())));
insert into zr_test select 'store',to_jsonb(id) from public.crm_stores where workspace_id=(select (v#>>'{}')::uuid from zr_test where k='w');
do $$begin
 begin perform public.crm_shipping_service('get','{}');raise exception 'SERVICE_EXPOSED';exception when insufficient_privilege then null;end;
 begin select * from crm_private.zr_credentials;raise exception 'SECRETS_EXPOSED';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into public.crm_members(workspace_id,user_id,display_name,role) values
 ((select (v#>>'{}')::uuid from zr_test where k='w'),'40000000-0000-4000-8000-000000000002','Agent ZR','agent');
set local role service_role;
insert into public.crm_products(workspace_id,store_id,name,sku,price,stock) values
 ((select (v#>>'{}')::uuid from zr_test where k='w'),(select (v#>>'{}')::uuid from zr_test where k='store'),'Article ZR','ZR-QA',2000,5);
insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,commune,address,channel,status,total,created_by,assigned_to) values
 ((select (v#>>'{}')::uuid from zr_test where k='w'),(select (v#>>'{}')::uuid from zr_test where k='store'),'Client ZR','+213555000010','Alger','Kouba','Rue du test','website','confirmed',2400,'40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002');
insert into zr_test select 'order',to_jsonb(id) from public.crm_orders where customer_name='Client ZR';
insert into public.crm_order_items(workspace_id,store_id,order_id,product_id,product_name,sku,quantity,unit_price)
 select o.workspace_id,o.store_id,o.id,p.id,p.name,p.sku,1,2000 from public.crm_orders o,public.crm_products p where o.id=(select (v#>>'{}')::uuid from zr_test where k='order') and p.store_id=o.store_id;
do $$declare c jsonb;r jsonb;sid uuid:=(select (v#>>'{}')::uuid from zr_test where k='store');oid uuid:=(select (v#>>'{}')::uuid from zr_test where k='order');
 owner uuid:='40000000-0000-4000-8000-000000000001';begin
 c:=public.crm_shipping_service('save',jsonb_build_object('store_id',sid,'actor',owner,'platform','legacy','first',repeat('a',20),'second',repeat('b',20)));
 insert into zr_test values('c',c);
 assert not (c ? 'credentials'),'public connection has no secrets';
 begin perform public.crm_shipping_service('get',jsonb_build_object('connection_id',c->>'id','actor','40000000-0000-4000-8000-000000000002'));raise exception 'AGENT_KEYS';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 begin perform public.crm_shipping_service('get',jsonb_build_object('connection_id',c->>'id','actor','40000000-0000-4000-8000-000000000003'));raise exception 'OUTSIDER_KEYS';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 r:=public.crm_shipping_service('prepare',jsonb_build_object('connection_id',c->>'id','actor',owner,'order_id',oid,'generation',1));
 insert into zr_test values('shipment',to_jsonb(r->>'shipment_id'));
 assert r->>'customer_name'='Client ZR' and (r->>'total')::numeric=2400,'server snapshot';
 begin perform public.crm_shipping_service('prepare',jsonb_build_object('connection_id',c->>'id','actor',owner,'order_id',oid));raise exception 'DOUBLE_SEND';exception when others then if sqlerrm<>'ALREADY_SENT' then raise;end if;end;
 perform public.crm_shipping_service('uncertain',jsonb_build_object('connection_id',c->>'id','actor',owner,'shipment_id',r->>'shipment_id','code','ZR_UNREACHABLE'));
 assert (select state='needs_review' from public.crm_shipments where id=(r->>'shipment_id')::uuid),'ambiguous creates review, not retry';
 perform public.crm_shipping_service('complete',jsonb_build_object('connection_id',c->>'id','actor',owner,'shipment_id',r->>'shipment_id','tracking',r->>'reference','state','submitted','raw_status','En préparation'));
 perform public.crm_shipping_service('track',jsonb_build_object('connection_id',c->>'id','actor',owner,'shipment_id',r->>'shipment_id','state','delivered','raw_status','Livrée'));
 assert (select state='delivered' and raw_status='Livrée' and cod_amount=2400 from public.crm_shipments where id=(r->>'shipment_id')::uuid),'raw and normalized status separate';
 assert (select count(*)=4 from public.crm_shipping_events where shipment_id=(r->>'shipment_id')::uuid),'event trail';
 begin perform public.crm_shipping_service('save',jsonb_build_object('store_id',sid,'actor',owner,'platform','new','first',repeat('a',20),'second',repeat('b',20),'source_hub_id',gen_random_uuid()));raise exception 'PLATFORM_CHANGED';exception when others then if sqlerrm<>'PLATFORM_LOCKED' then raise;end if;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$begin
 assert (select count(*)=0 from public.crm_shipping_connections),'agent cannot see connection';
 assert (select count(*)=1 from public.crm_shipments),'assigned agent can see shipment';
 assert (select count(*)=4 from public.crm_shipping_events),'assigned agent can see history';
 begin perform public.crm_shipping_dashboard((select (v#>>'{}')::uuid from zr_test where k='store'));raise exception 'AGENT_DASHBOARD';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
end $$;
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$begin assert (select count(*)=0 from public.crm_shipments),'other tenant isolated';end $$;
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare dashboard jsonb;begin
 dashboard:=public.crm_shipping_dashboard((select (v#>>'{}')::uuid from zr_test where k='store'));
 assert jsonb_array_length(dashboard->'queue')=0 and jsonb_array_length(dashboard->'shipments')=1,'queue excludes sent order';
end $$;
set local role service_role;
select public.crm_shipping_service('disconnect',jsonb_build_object('connection_id',(select v->>'id' from zr_test where k='c'),'actor','40000000-0000-4000-8000-000000000001'));
reset role;
do $$begin
 assert (select count(*)=0 from crm_private.zr_credentials),'credentials removed';
 assert (select count(*)=1 from public.crm_shipments),'shipment preserved';
end $$;
reset role;
select 'ZR shipping database assertions passed' as verification;
