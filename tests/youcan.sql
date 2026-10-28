-- Synthetic merchants never persist; this fixture rolls back its transaction.
begin;
reset role;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous) values
 ('40000000-0000-4000-8000-000000000001','youcan-owner-a@weconvert.invalid',now(),'{}','{}',false),
 ('40000000-0000-4000-8000-000000000002','youcan-agent-a@weconvert.invalid',now(),'{}','{}',false),
 ('40000000-0000-4000-8000-000000000003','youcan-owner-b@weconvert.invalid',now(),'{}','{}',false);
create temp table youcan_test(k text primary key,v jsonb);grant all on youcan_test to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into youcan_test values('w1',to_jsonb(public.crm_bootstrap('YouCan A','Boutique A','Owner A',gen_random_uuid())));
insert into youcan_test select 's1',to_jsonb(id) from public.crm_stores where workspace_id=(select (v#>>'{}')::uuid from youcan_test where k='w1');
do $$begin
 begin perform public.crm_youcan_service('credentials','{}');raise exception 'PUBLIC_TOKEN_EXPOSED';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into public.crm_members(workspace_id,user_id,display_name,role) select (v#>>'{}')::uuid,'40000000-0000-4000-8000-000000000002','Agent A','agent' from youcan_test where k='w1';
set local role service_role;
do $$declare c jsonb;r jsonb;d jsonb;oid uuid;begin
 begin perform public.crm_youcan_service('save_channel',jsonb_build_object('store_id',(select v#>>'{}' from youcan_test where k='s1'),'actor','40000000-0000-4000-8000-000000000002','channel_name','Canal A','public_url','https://shop-a.youcan.store','cod_methods',jsonb_build_array('cod')));raise exception 'AGENT_CONNECTED';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 c:=public.crm_youcan_service('save_channel',jsonb_build_object('store_id',(select v#>>'{}' from youcan_test where k='s1'),'actor','40000000-0000-4000-8000-000000000001','channel_name','Canal A','public_url','https://shop-a.youcan.store','cod_methods',jsonb_build_array('cash on delivery')));
 insert into youcan_test values('c1',c);
 assert (select channel_name='Canal A' and public_url='https://shop-a.youcan.store' and status='pending' from public.crm_source_connections where id=(c->>'id')::uuid),'channel draft persists before app credentials';
 perform public.crm_youcan_service('begin',jsonb_build_object('connection_id',c->>'id','actor','40000000-0000-4000-8000-000000000001','nonce_hash',repeat('a',64)));
 assert (public.crm_youcan_service('oauth_state',jsonb_build_object('nonce_hash',repeat('a',64)))->>'id')=c->>'id','state binds merchant';
 assert (public.crm_youcan_service('oauth_state',jsonb_build_object('nonce_hash',repeat('a',64)))->>'public_url')='https://shop-a.youcan.store','state binds expected URL';
 begin perform public.crm_youcan_service('oauth_state',jsonb_build_object('nonce_hash',repeat('b',64)));raise exception 'BAD_STATE';exception when others then if sqlerrm<>'INVALID_STATE' then raise;end if;end;
 begin perform public.crm_youcan_service('finish_oauth',jsonb_build_object('connection_id',c->>'id','nonce_hash',repeat('a',64),'external_shop','40000000-0000-4000-8000-000000000010','expected_url','https://other.youcan.store','verified_domain','shop-a.youcan.store','credentials',jsonb_build_object('access_token','bad','refresh_token','bad','expires_in',3600,'obtained_at',now())));raise exception 'WRONG_URL_BOUND';exception when others then if sqlerrm<>'SHOP_LOCKED' then raise;end if;end;
 perform public.crm_youcan_service('finish_oauth',jsonb_build_object('connection_id',c->>'id','nonce_hash',repeat('a',64),'external_shop','40000000-0000-4000-8000-000000000010','expected_url','https://shop-a.youcan.store','verified_domain','shop-a.youcan.store','credentials',jsonb_build_object('access_token','test-access','refresh_token','test-refresh','expires_in',3155673600::bigint,'obtained_at',now())));
 begin perform public.crm_youcan_service('finish_oauth',jsonb_build_object('connection_id',c->>'id','nonce_hash',repeat('a',64),'external_shop','40000000-0000-4000-8000-000000000010','expected_url','https://shop-a.youcan.store','verified_domain','shop-a.youcan.store','credentials',jsonb_build_object('access_token','bad','refresh_token','bad','expires_in',3600,'obtained_at',now())));raise exception 'STATE_REPLAYED';exception when others then if sqlerrm<>'INVALID_STATE' then raise;end if;end;
 assert (select verified_domain='shop-a.youcan.store' from public.crm_source_connections where id=(c->>'id')::uuid),'store domain verified';
 begin perform public.crm_youcan_service('save_channel',jsonb_build_object('store_id',(select v#>>'{}' from youcan_test where k='s1'),'actor','40000000-0000-4000-8000-000000000001','channel_name','Autre','public_url','https://other.youcan.store','cod_methods',jsonb_build_array('cod')));raise exception 'OTHER_SHOP_ON_SAME_STORE';exception when others then if sqlerrm<>'SHOP_LOCKED' then raise;end if;end;
 assert (public.crm_youcan_service('credentials',jsonb_build_object('connection_id',c->>'id'))->>'access_token')='test-access','merchant token Vault';
 assert (public.crm_youcan_service('credentials',jsonb_build_object('connection_id',c->>'id'))->>'expires_in')='3155673600','long YouCan token lifetime retained';
 begin perform public.crm_youcan_service('repair',jsonb_build_object('connection_id',c->>'id','actor','40000000-0000-4000-8000-000000000002'));raise exception 'AGENT_REPAIR';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 r:=public.crm_youcan_service('refresh_credentials',jsonb_build_object('connection_id',c->>'id','old_access_hash',repeat('0',64),'credentials',jsonb_build_object('access_token','bad','refresh_token','bad','expires_in',3600,'obtained_at',now())));
 assert r->>'access_token'='test-access','stale refresh cannot replace current token';
 r:=public.crm_youcan_service('refresh_credentials',jsonb_build_object('connection_id',c->>'id','old_access_hash',encode(extensions.digest('test-access','sha256'),'hex'),'credentials',jsonb_build_object('access_token','refreshed-access','refresh_token','refreshed-refresh','expires_in',3155673600::bigint,'obtained_at',now())));
 assert r->>'access_token'='refreshed-access' and r->>'expires_in'='3155673600','long-lived token refresh accepted';
 d:=jsonb_build_object('external_id','40000000-0000-4000-8000-000000000011','number','10245','created_at',now(),'updated_at',now(),'remote_status','Open · pending','customer_name','Client YouCan','phone','0555123456','wilaya','Alger','commune','Kouba','address','Rue test','fee','400.00','discount','200.00','total','3200.00','items',jsonb_build_array(jsonb_build_object('remote_key','40000000-0000-4000-8000-000000000012','sku','','name','Livre YouCan','quantity',2,'unit_price','1500.00')));
 r:=public.crm_source_service('ingest',jsonb_build_object('connection_id',c->>'id','delivery_id','yc-1','hash',repeat('1',64),'order',d));
 assert r->>'outcome'='received','new YouCan COD order received';oid:=(r->>'id')::uuid;insert into youcan_test values('order',to_jsonb(oid)),('order_data',d);
 assert (select status='new' and source_provider='youcan' and status_origin='crm' and total=3200 and not stock_reserved from public.crm_orders where id=oid),'platform status does not confirm COD';
 assert (select p.sku like 'YCN-%' and p.stock=0 from public.crm_products p join public.crm_order_items i on p.id=i.product_id where i.order_id=oid),'untracked product stock is zero';
 r:=public.crm_source_service('ingest',jsonb_build_object('connection_id',c->>'id','delivery_id','yc-1','hash',repeat('1',64),'order',d));assert r->>'outcome'='duplicate','same delivery idempotent';
 r:=public.crm_source_service('ingest',jsonb_build_object('connection_id',c->>'id','delivery_id','yc-2','hash',repeat('1',64),'order',d));assert r->>'outcome'='unchanged','same source content idempotent';
 r:=public.crm_source_service('ingest',jsonb_build_object('connection_id',c->>'id','delivery_id','yc-old','hash',repeat('2',64),'order',d||jsonb_build_object('external_id','40000000-0000-4000-8000-000000000013','created_at',now()-interval '10 days')));assert r->>'code'='ORDER_PREDATES_CONNECTION','no historical import';
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.crm_command((select (v#>>'{}')::uuid from youcan_test where k='w1'),'order.note',jsonb_build_object('id',(select v#>>'{}' from youcan_test where k='order'),'version',1,'note','Client appelé'),gen_random_uuid());
set local role service_role;
do $$declare c jsonb:=(select v from youcan_test where k='c1');d jsonb:=(select v from youcan_test where k='order_data');r jsonb;begin
 d:=d||jsonb_build_object('updated_at',now()+interval '1 minute','address','Autre rue','remote_status','Cancelled');
 r:=public.crm_source_service('ingest',jsonb_build_object('connection_id',c->>'id','delivery_id','yc-3','hash',repeat('3',64),'order',d));assert r->>'outcome'='attention','agent changes preserved';
 assert (select address='Rue test' and status='new' and source_status='Cancelled' and source_attention from public.crm_orders where id=(select (v#>>'{}')::uuid from youcan_test where k='order')),'remote cancellation does not cancel CRM';
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"40000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
insert into youcan_test values('w2',to_jsonb(public.crm_bootstrap('YouCan B','Boutique B','Owner B',gen_random_uuid())));
insert into youcan_test select 's2',to_jsonb(id) from public.crm_stores where workspace_id=(select (v#>>'{}')::uuid from youcan_test where k='w2');
do $$begin assert (select count(*)=0 from public.crm_source_connections),'another enterprise cannot read YouCan connection';assert (select count(*)=0 from public.crm_source_events),'another enterprise cannot read logs';end $$;
set local role service_role;
do $$declare c jsonb;r jsonb;begin
 begin perform public.crm_youcan_service('begin',jsonb_build_object('connection_id',(select v->>'id' from youcan_test where k='c1'),'actor','40000000-0000-4000-8000-000000000003','nonce_hash',repeat('b',64)));raise exception 'CROSS_TENANT_BEGIN';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 c:=public.crm_youcan_service('save_channel',jsonb_build_object('store_id',(select v#>>'{}' from youcan_test where k='s2'),'actor','40000000-0000-4000-8000-000000000003','channel_name','Canal B','public_url','https://shop-b.youcan.store','cod_methods',jsonb_build_array('cod')));
 perform public.crm_youcan_service('begin',jsonb_build_object('connection_id',c->>'id','actor','40000000-0000-4000-8000-000000000003','nonce_hash',repeat('b',64)));
 perform public.crm_youcan_service('finish_oauth',jsonb_build_object('connection_id',c->>'id','nonce_hash',repeat('b',64),'external_shop','40000000-0000-4000-8000-000000000020','expected_url','https://shop-b.youcan.store','verified_domain','shop-b.youcan.store','credentials',jsonb_build_object('access_token','other','refresh_token','other','expires_in',3600,'obtained_at',now())));
 r:=public.crm_source_service('ingest',jsonb_build_object('connection_id',c->>'id','delivery_id','yc-1','hash',repeat('1',64),'order',(select v from youcan_test where k='order_data')));
 assert r->>'outcome'='received' and r->>'id'<>(select v#>>'{}' from youcan_test where k='order'),'external order ID isolated by merchant';
end $$;
select 'youcan_channel_passed' as result;
rollback;
