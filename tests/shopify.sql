-- Run within BEGIN ... ROLLBACK against a test database. No fixture is committed.
reset role;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous) values
 ('30000000-0000-4000-8000-000000000001','shopify-owner-a@weconvert.invalid',now(),'{}','{}',false),
 ('30000000-0000-4000-8000-000000000002','shopify-agent-a@weconvert.invalid',now(),'{}','{}',false),
 ('30000000-0000-4000-8000-000000000003','shopify-owner-b@weconvert.invalid',now(),'{}','{}',false);
create temp table shopify_test(k text primary key,v jsonb);grant all on shopify_test to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into shopify_test values('w1',to_jsonb(public.crm_bootstrap('Shopify A','Boutique Shopify A','Owner A',gen_random_uuid())));
insert into shopify_test select 's1',to_jsonb(id) from public.crm_stores where workspace_id=(select (v#>>'{}')::uuid from shopify_test where k='w1');
select public.crm_command((select (v#>>'{}')::uuid from shopify_test where k='w1'),'store.create','{"name":"Boutique Shopify A2"}',gen_random_uuid());
insert into shopify_test select 's1b',to_jsonb(id) from public.crm_stores where workspace_id=(select (v#>>'{}')::uuid from shopify_test where k='w1') and id<>(select (v#>>'{}')::uuid from shopify_test where k='s1');
do $$begin
 begin perform public.crm_source_service('by_shop','{}');raise exception 'PUBLIC_SOURCE_RPC_EXPOSED';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into public.crm_members(workspace_id,user_id,display_name,role) select (v#>>'{}')::uuid,'30000000-0000-4000-8000-000000000002','Agent A','agent' from shopify_test where k='w1';
set local role service_role;
do $$declare c jsonb;r jsonb;d jsonb;o uuid;begin
 begin perform public.crm_source_service('begin',jsonb_build_object('store_id',(select v#>>'{}' from shopify_test where k='s1'),'actor','30000000-0000-4000-8000-000000000002','provider','shopify','external_shop','shop-a.myshopify.com','nonce_hash',repeat('a',64),'cod_methods',jsonb_build_array('cod')));raise exception 'AGENT_CONNECTED';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 c:=public.crm_source_service('begin',jsonb_build_object('store_id',(select v#>>'{}' from shopify_test where k='s1'),'actor','30000000-0000-4000-8000-000000000001','provider','shopify','external_shop','shop-a.myshopify.com','nonce_hash',repeat('a',64),'cod_methods',jsonb_build_array('cod')));
 insert into shopify_test values('c1',c);
 assert (public.crm_source_service('oauth_state',jsonb_build_object('nonce_hash',repeat('a',64),'external_shop','shop-a.myshopify.com'))->>'id')=c->>'id','nonce binds shop';
 begin perform public.crm_source_service('oauth_state',jsonb_build_object('nonce_hash',repeat('a',64),'external_shop','shop-b.myshopify.com'));raise exception 'STATE_CROSS_SHOP';exception when others then if sqlerrm<>'INVALID_STATE' then raise;end if;end;
 perform public.crm_source_service('finish_oauth',jsonb_build_object('connection_id',c->>'id','nonce_hash',repeat('a',64),'credentials',jsonb_build_object('access_token','fake','refresh_token','fake','expires_in',3600)));
 begin perform public.crm_source_service('finish_oauth',jsonb_build_object('connection_id',c->>'id','nonce_hash',repeat('a',64),'credentials',jsonb_build_object('access_token','fake','refresh_token','fake','expires_in',3600)));raise exception 'STATE_REPLAYED';exception when others then if sqlerrm<>'INVALID_STATE' then raise;end if;end;
 assert (public.crm_source_service('by_shop',jsonb_build_object('provider','shopify','external_shop','shop-a.myshopify.com'))->>'id')=c->>'id','webhook shop lookup';
 d:=jsonb_build_object('external_id','77','number','#77','created_at',now(),'updated_at',now(),'remote_status','paid','customer_name','Client Shopify','phone','0555123456','wilaya','Alger','commune','Kouba','address','Rue test','fee','400.00','discount','100.00','total','3200.00','items',jsonb_build_array(jsonb_build_object('remote_key','100','sku','SHOPIFY-QA','name','Livre QA','quantity',2,'unit_price','1500.00')));
 -- Mistatched amount is rejected atomically and the delivery can be retried.
 begin perform public.crm_source_service('ingest',jsonb_build_object('connection_id',c->>'id','delivery_id','d0','hash',repeat('0',64),'order',d));raise exception 'BAD_AMOUNT_ACCEPTED';exception when others then if sqlerrm<>'INVALID_AMOUNT' then raise;end if;end;
 d:=d||'{"total":"3300.00","discount":"100.00","fee":"400.00"}'::jsonb;
 -- 2 x 1500 + 400 - 100 = 3300.
 r:=public.crm_source_service('ingest',jsonb_build_object('connection_id',c->>'id','delivery_id','d1','hash',repeat('1',64),'order',d));
 assert r->>'outcome'='received','signed COD order received';o:=(r->>'id')::uuid;insert into shopify_test values('o1',to_jsonb(o)),('d1',d);
 assert (select status='new' and status_origin='crm' and source_status='paid' and not stock_reserved and total=3300 from public.crm_orders where id=o),'commerce paid is not COD confirmed';
 assert (select stock=0 from public.crm_products p join public.crm_order_items i on p.id=i.product_id where i.order_id=o),'no invented stock';
 r:=public.crm_source_service('ingest',jsonb_build_object('connection_id',c->>'id','delivery_id','d1','hash',repeat('1',64),'order',d));assert r->>'outcome'='duplicate','same delivery idempotent';
 r:=public.crm_source_service('ingest',jsonb_build_object('connection_id',c->>'id','delivery_id','d2','hash',repeat('1',64),'order',d));assert r->>'outcome'='unchanged','same order hash idempotent';
 d:=d||jsonb_build_object('external_id','78','number','#78','created_at',now()-interval '1 month','updated_at',now());
 r:=public.crm_source_service('ingest',jsonb_build_object('connection_id',c->>'id','delivery_id','d3','hash',repeat('2',64),'order',d));assert r->>'code'='ORDER_PREDATES_CONNECTION','no history import';
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.crm_command((select (v#>>'{}')::uuid from shopify_test where k='w1'),'order.note',jsonb_build_object('id',(select v#>>'{}' from shopify_test where k='o1'),'version',1,'note','Client appelé'),gen_random_uuid());
set local role service_role;
do $$declare c jsonb:=(select v from shopify_test where k='c1');d jsonb:=(select v from shopify_test where k='d1');r jsonb;o uuid:=(select (v#>>'{}')::uuid from shopify_test where k='o1');begin
 d:=d||jsonb_build_object('updated_at',now()+interval '1 minute','address','Adresse modifiée Shopify','remote_status','cancelled');
 r:=public.crm_source_service('ingest',jsonb_build_object('connection_id',c->>'id','delivery_id','d4','hash',repeat('4',64),'order',d));assert r->>'outcome'='attention','agent changes preserved';
 assert (select address='Rue test' and status='new' and source_status='cancelled' and source_attention from public.crm_orders where id=o),'remote cancellation does not cancel CRM';
 r:=public.crm_source_service('ingest',jsonb_build_object('connection_id',c->>'id','delivery_id','d5','hash',repeat('5',64),'order',d||'{"skip":"REFUND_REVIEW"}'::jsonb));
 assert r->>'outcome'='attention' and r->>'code'='REFUND_REVIEW','refund flagged on existing order';
 c:=public.crm_source_service('begin',jsonb_build_object('store_id',(select v#>>'{}' from shopify_test where k='s1b'),'actor','30000000-0000-4000-8000-000000000001','provider','shopify','external_shop','shop-a2.myshopify.com','nonce_hash',repeat('b',64),'cod_methods',jsonb_build_array('cod')));
 perform public.crm_source_service('finish_oauth',jsonb_build_object('connection_id',c->>'id','nonce_hash',repeat('b',64),'credentials',jsonb_build_object('access_token','fake','refresh_token','fake','expires_in',3600)));
 r:=public.crm_source_service('ingest',jsonb_build_object('connection_id',c->>'id','delivery_id','d1','hash',repeat('1',64),'order',(select v from shopify_test where k='d1')));
 assert r->>'outcome'='received' and (r->>'id')::uuid<>o,'same external reference is isolated by store';
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
insert into shopify_test values('w2',to_jsonb(public.crm_bootstrap('Shopify B','Boutique B','Owner B',gen_random_uuid())));
insert into shopify_test select 's2',to_jsonb(id) from public.crm_stores where workspace_id=(select (v#>>'{}')::uuid from shopify_test where k='w2');
do $$begin assert (select count(*)=0 from public.crm_source_connections),'other company cannot read A connection';assert (select count(*)=0 from public.crm_source_events),'other company cannot read A events';end $$;
set local role service_role;
do $$declare c jsonb;r jsonb;begin
 begin perform public.crm_source_service('begin',jsonb_build_object('store_id',(select v#>>'{}' from shopify_test where k='s1'),'actor','30000000-0000-4000-8000-000000000003','provider','shopify','external_shop','shop-a.myshopify.com','nonce_hash',repeat('c',64),'cod_methods',jsonb_build_array('cod')));raise exception 'CROSS_TENANT_BEGIN';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 c:=public.crm_source_service('begin',jsonb_build_object('store_id',(select v#>>'{}' from shopify_test where k='s2'),'actor','30000000-0000-4000-8000-000000000003','provider','shopify','external_shop','shop-b.myshopify.com','nonce_hash',repeat('c',64),'cod_methods',jsonb_build_array('cod')));
 perform public.crm_source_service('finish_oauth',jsonb_build_object('connection_id',c->>'id','nonce_hash',repeat('c',64),'credentials',jsonb_build_object('access_token','fake','refresh_token','fake','expires_in',3600)));
 r:=public.crm_source_service('ingest',jsonb_build_object('connection_id',c->>'id','delivery_id','d1','hash',repeat('1',64),'order',(select v from shopify_test where k='d1')));
 assert r->>'outcome'='received','second company independently receives same external order id';
 assert (select count(*)=0 from public.crm_orders where store_id=(select (v#>>'{}')::uuid from shopify_test where k='s1') and workspace_id=(select (v#>>'{}')::uuid from shopify_test where k='w2')),'no tenant confusion';
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$begin assert (select count(*)=0 from public.crm_source_connections),'agent cannot read connections';assert (select count(*)=0 from public.crm_source_events),'agent cannot read source journal';end $$;
