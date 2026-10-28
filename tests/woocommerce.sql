-- Execute in a transaction and roll back; never send real store requests from SQL.
reset role;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous) values
('20000000-0000-4000-8000-000000000001','woo-owner@weconvert.invalid',now(),'{}','{}',false),
('20000000-0000-4000-8000-000000000002','woo-agent@weconvert.invalid',now(),'{}','{}',false),
('20000000-0000-4000-8000-000000000003','woo-outsider@weconvert.invalid',now(),'{}','{}',false);
create temp table woo_test(k text primary key,v jsonb);grant all on woo_test to service_role,authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into woo_test values('w',to_jsonb(public.crm_bootstrap('Woo test','Woo shop','Owner test',gen_random_uuid())));
insert into woo_test select 's',to_jsonb(id) from public.crm_stores where workspace_id=(select v#>>'{}' from woo_test where k='w')::uuid;
do $$begin
 begin perform public.crm_woo_service('get_webhook','{}');raise exception 'SERVICE_RPC_EXPOSED';exception when insufficient_privilege then null;end;
 begin perform * from vault.decrypted_secrets;raise exception 'VAULT_EXPOSED';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into public.crm_members(workspace_id,user_id,display_name,role) select (v#>>'{}')::uuid,'20000000-0000-4000-8000-000000000002','Agent test','agent' from woo_test where k='w';
set local role service_role;
do $$declare c jsonb;r jsonb;d jsonb;oid uuid;pid uuid;begin
 c:=public.crm_woo_service('save',jsonb_build_object('store_id',(select v#>>'{}' from woo_test where k='s'),'actor','20000000-0000-4000-8000-000000000001','base_url','https://woo-test.example.com','key','ck_'||repeat('0',40),'secret','cs_'||repeat('0',40),'cod_methods',jsonb_build_array('cod')));
 insert into woo_test values('c',c);
 begin perform public.crm_woo_service('get_admin',jsonb_build_object('connection_id',c->>'id','actor','20000000-0000-4000-8000-000000000002'));raise exception 'AGENT_CONNECTED';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 begin perform public.crm_woo_service('get_admin',jsonb_build_object('connection_id',c->>'id','actor','20000000-0000-4000-8000-000000000003'));raise exception 'TENANT_CONNECTED';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 d:=jsonb_build_object('external_id',81,'number','WEB81','remote_status','processing','payment_method','cod','modified_at','2026-10-20T10:00:00Z','created_at','2026-10-19T10:00:00Z','customer_name','Client Woo','phone','0555123456','wilaya','Alger','commune','Kouba','address','Adresse test','fee',500,'discount',0,'total',7500,'items',jsonb_build_array(jsonb_build_object('remote_key','v:9','name','Article test','sku','WOO-QA','quantity',2,'unit_price',3500)));
 insert into woo_test values('d',d);
 r:=public.crm_woo_service('ingest',jsonb_build_object('connection_id',c->>'id','generation',1,'order',d,'hash',repeat('0',64),'webhook',true));
 assert r->>'code'='ORDER_PREDATES_CONNECTION' and (select count(*)=0 from public.crm_orders where store_id=(c->>'store_id')::uuid),'old order.updated cannot create an untracked historical sale';
 -- The rest of the synthetic fixture represents a shop connected before its dated orders.
 update public.crm_integrations set created_at='2026-10-01T00:00:00Z' where id=(c->>'id')::uuid;
 r:=public.crm_woo_service('ingest',jsonb_build_object('connection_id',c->>'id','generation',1,'order',d,'hash',repeat('a',64)));
 assert r->>'code'='TRACKING_NOT_PROVEN' and r->>'outcome'='skipped','manual history without Suite evidence must not be imported';
 assert (select count(*)=0 from public.crm_orders where store_id=(c->>'store_id')::uuid),'no untracked backfill order created';
 begin
  perform public.crm_woo_service('ingest',jsonb_build_object('connection_id',c->>'id','order',d||jsonb_build_object('tracking',jsonb_build_object('purchase_event_id','kb_999_012345abcdef','purchase_sent_marker','2026-10-20 11:00:00')),'hash',repeat('9',64)));
  raise exception 'FOREIGN_TRACKING_EVENT_ACCEPTED';
 exception when others then if sqlerrm<>'INVALID_ORDER' then raise;end if;end;
 -- Signed webhooks still create operational orders promptly, before the Suite's CAPI callback.
 r:=public.crm_woo_service('ingest',jsonb_build_object('connection_id',c->>'id','generation',1,'order',d,'hash',repeat('a',64),'webhook',true));
 assert r->>'outcome'='imported','import creates order';oid:=(r->>'id')::uuid;insert into woo_test values('order',to_jsonb(oid));
 assert (select total=7500 and status='new' and channel='website' from public.crm_orders where id=oid),'source totals';
 assert (select woo_purchase_event_id is null from public.crm_orders where id=oid),'webhook is operational, not automatic tracking proof';
 select product_id into pid from public.crm_order_items where order_id=oid;
 assert (select stock=0 and reserved=0 from public.crm_products where id=pid),'never fabricate stock';
 r:=public.crm_woo_service('ingest',jsonb_build_object('connection_id',c->>'id','generation',1,'order',d,'hash',repeat('a',64)));
 assert r->>'outcome'='unchanged','replay deduplicated';
 assert (select count(*)=1 from public.crm_orders where store_id=(c->>'store_id')::uuid),'one source order';
 d:=d||jsonb_build_object('tracking',jsonb_build_object('purchase_event_id','kb_81_012345abcdef','purchase_sent_marker','2026-10-20 11:00:00'));
 r:=public.crm_woo_service('ingest',jsonb_build_object('connection_id',c->>'id','order',d,'hash',repeat('3',64)));
 assert r->>'outcome'='linked','same-second tracking-only re-scan links without CRM conflict';
 assert (select version=1 and woo_purchase_event_id='kb_81_012345abcdef' from public.crm_orders where id=oid),'proof upgrade leaves agent version unchanged';
 d:=d||'{"modified_at":"2026-10-21T10:00:00Z","address":"Nouvelle adresse"}';
 r:=public.crm_woo_service('ingest',jsonb_build_object('connection_id',c->>'id','order',d,'hash',repeat('b',64)));
 assert r->>'outcome'='updated','untouched order updates';
 assert (select address='Nouvelle adresse' and version=2 from public.crm_orders where id=oid),'update version';
 r:=public.crm_woo_service('ingest',jsonb_build_object('connection_id',c->>'id','order',(select v from woo_test where k='d'),'hash',repeat('c',64)));
 assert r->>'outcome'='stale','old event rejected';
 assert (public.crm_list_orders((c->>'store_id')::uuid,'all','WEB81')->>'total')::integer=1,'external reference searchable';
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.crm_command((select v#>>'{}' from woo_test where k='w')::uuid,'order.note',jsonb_build_object('id',(select v#>>'{}' from woo_test where k='order'),'version',2,'note','Agent has worked on this order'),gen_random_uuid());
do $$declare r jsonb;begin
 r:=public.crm_performance((select v#>>'{}' from woo_test where k='s')::uuid,'2026-10-19','2026-10-26');
 assert r#>>'{summary,woo_orders}'='1' and r#>>'{summary,woo_purchase_marked}'='1' and r#>>'{summary,woo_unverified}'='0','Woo tracking coverage is separate from operational totals';
end $$;
set local role service_role;
do $$declare c jsonb:=(select v from woo_test where k='c');d jsonb:=(select v from woo_test where k='d');r jsonb;begin
 d:=d||'{"modified_at":"2026-10-22T10:00:00Z","address":"Conflicting remote address"}';
 r:=public.crm_woo_service('ingest',jsonb_build_object('connection_id',c->>'id','order',d,'hash',repeat('d',64)));
 assert r->>'outcome'='attention','agent changes preserved';
 assert (select address='Nouvelle adresse' and woo_attention and status='new' from public.crm_orders where id=(r->>'id')::uuid),'no overwrite after agent activity';
 d:=(select v from woo_test where k='d')||'{"external_id":82,"number":"82","remote_status":"completed","modified_at":"2026-10-22T10:00:00Z"}';
 d:=d||jsonb_build_object('tracking',jsonb_build_object('purchase_event_id','kb_82_012345abcdef','purchase_sent_marker','2026-10-22 11:00:00'));
 r:=public.crm_woo_service('ingest',jsonb_build_object('connection_id',c->>'id','order',d,'hash',repeat('e',64)));
 assert r->>'outcome'='imported','explicit source fixture ingested without status inference';
 assert (select status='new' and woo_status='completed' and status_origin='crm' and not stock_reserved from public.crm_orders where id=(r->>'id')::uuid),'Woo completed does not confirm COD';
 insert into woo_test values('completed',to_jsonb(r->>'id'));
 assert (select count(*)=2 from public.crm_orders where store_id=(c->>'store_id')::uuid),'unique imported orders';
 d:=d||'{"remote_status":"cancelled","modified_at":"2026-10-23T10:00:00Z"}';
 r:=public.crm_woo_service('ingest',jsonb_build_object('connection_id',c->>'id','order',d,'hash',repeat('f',64)));
 assert r->>'outcome'='updated','remote Woo change updates source only';
 assert (select status='new' and woo_status='cancelled' and not stock_reserved from public.crm_orders where id=(r->>'id')::uuid),'Woo cancellation does not cancel CRM confirmation';
 d:=(select v from woo_test where k='d')||'{"external_id":83,"number":"83"}';
 r:=public.crm_woo_service('ingest',jsonb_build_object('connection_id',c->>'id','order',d,'hash',repeat('1',64),'webhook',true));
 d:=d||'{"address":"Ambiguous second"}';
 r:=public.crm_woo_service('ingest',jsonb_build_object('connection_id',c->>'id','order',d,'hash',repeat('2',64)));
 assert r->>'code'='REMOTE_VERSION_AMBIGUOUS','same-second conflicts preserved';
 assert (select address='Adresse test' and woo_attention from public.crm_orders where id=(r->>'id')::uuid),'same-second cannot overwrite';
 perform public.crm_woo_service('begin',jsonb_build_object('connection_id',c->>'id','actor','20000000-0000-4000-8000-000000000001','after','2026-10-01','token','20000000-0000-4000-8000-000000000005'));
 begin perform public.crm_woo_service('begin',jsonb_build_object('connection_id',c->>'id','actor','20000000-0000-4000-8000-000000000001','token',gen_random_uuid()));raise exception 'PARALLEL_SYNC_ALLOWED';exception when others then if sqlerrm<>'SYNC_BUSY' then raise;end if;end;
 perform public.crm_woo_service('finish',jsonb_build_object('connection_id',c->>'id','actor','20000000-0000-4000-8000-000000000001','token','20000000-0000-4000-8000-000000000005','done',true,'scanned',2,'total',2));
 assert (select import_done and import_scanned=2 from public.crm_integrations where id=(c->>'id')::uuid),'checkpoint';
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$begin
 assert (select count(*)=0 from public.crm_integrations),'agent integration isolation';
 assert (select count(*)=0 from public.crm_integration_events),'agent log isolation';
 begin perform public.crm_woo_ack((select v#>>'{}' from woo_test where k='order')::uuid,4);raise exception 'UNASSIGNED_ACK_ALLOWED';exception when others then if sqlerrm<>'NOT_FOUND' then raise;end if;end;
end $$;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.crm_woo_ack((select v#>>'{}' from woo_test where k='order')::uuid,4);
set local role service_role;
do $$declare c jsonb:=(select v from woo_test where k='c');d jsonb;r jsonb;pid uuid;tok uuid:='20000000-0000-4000-8000-000000000006';begin
 d:=(select v from woo_test where k='d')||'{"external_id":84,"number":"84","remote_status":"completed","modified_at":"2026-10-24T10:00:00Z"}';
 d:=d||jsonb_build_object('tracking',jsonb_build_object('purchase_event_id','kb_84_012345abcdef','purchase_sent_marker','2026-10-24 11:00:00'));
 r:=public.crm_woo_service('ingest',jsonb_build_object('connection_id',c->>'id','order',d,'hash',repeat('8',64)));
 insert into woo_test values('history',to_jsonb(r->>'id'));
 assert (select status='new' and woo_status='completed' and not stock_reserved from public.crm_orders where id=(r->>'id')::uuid),'completed source remains a new CRM order';
 begin perform public.crm_woo_service('catalog.begin',jsonb_build_object('connection_id',c->>'id','generation',1,'actor','20000000-0000-4000-8000-000000000002','token',tok,'reset',true));raise exception 'AGENT_CATALOG_ALLOWED';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 r:=public.crm_woo_service('catalog.begin',jsonb_build_object('connection_id',c->>'id','generation',1,'actor','20000000-0000-4000-8000-000000000001','token',tok,'reset',true));
 assert r->>'catalog_page'='1' and r->>'catalog_done'='false','catalog starts from first page';
 begin perform public.crm_woo_service('catalog.ingest',jsonb_build_object('connection_id',c->>'id','generation',1,'token',gen_random_uuid(),'product',jsonb_build_object('remote_key','p:88')));raise exception 'CATALOG_TOKEN_BYPASS';exception when others then if sqlerrm<>'SYNC_BUSY' then raise;end if;end;
 d:=jsonb_build_object('remote_key','v:9','name','Article catalogue','sku','WOO-QA','price',3600,'stock',20,'stock_managed',true);
 r:=public.crm_woo_service('catalog.ingest',jsonb_build_object('connection_id',c->>'id','generation',1,'token',tok,'product',d));
 assert r->>'outcome'='updated','order-created product receives real Woo price and stock';
 assert (select stock=20 and reserved=0 and price=3600 from public.crm_products where id=(r->>'id')::uuid),'product stock snapshot';
 d:=jsonb_build_object('remote_key','p:88','name','Nouveau produit','sku','CAT-88','price',1100,'stock',10,'stock_managed',true);
 r:=public.crm_woo_service('catalog.ingest',jsonb_build_object('connection_id',c->>'id','generation',1,'token',tok,'product',d));
 assert r->>'outcome'='imported','new product imported';pid:=(r->>'id')::uuid;
 assert (select stock=10 and reserved=0 from public.crm_products where id=pid),'managed stock copied';
 r:=public.crm_woo_service('catalog.ingest',jsonb_build_object('connection_id',c->>'id','generation',1,'token',tok,'product',d));
 assert r->>'outcome'='unchanged','catalog replay is idempotent';
 d:=d||'{"price":1200,"stock":12}';
 r:=public.crm_woo_service('catalog.ingest',jsonb_build_object('connection_id',c->>'id','generation',1,'token',tok,'product',d));
 assert r->>'outcome'='updated' and (select version=2 and stock=12 from public.crm_products where id=pid),'safe catalog refresh';
 insert into public.crm_events(workspace_id,store_id,actor_id,actor_name,kind,data) values((c->>'workspace_id')::uuid,(c->>'store_id')::uuid,'20000000-0000-4000-8000-000000000001','Owner test','stock.adjusted',jsonb_build_object('product_id',pid));
 update public.crm_products set stock=15,version=version+1 where id=pid;
 r:=public.crm_woo_service('catalog.ingest',jsonb_build_object('connection_id',c->>'id','generation',1,'token',tok,'product',d));
 assert r->>'outcome'='attention' and (select stock=15 from public.crm_products where id=pid),'manual stock preserved';
 perform public.crm_woo_service('catalog.finish',jsonb_build_object('connection_id',c->>'id','generation',1,'actor','20000000-0000-4000-8000-000000000001','token',tok,'page',2,'offset',0,'variation_page',1,'done',true,'scanned',4,'total',2));
 assert (select catalog_done and catalog_scanned=4 from public.crm_integrations where id=(c->>'id')::uuid),'catalog checkpoint';
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.crm_command((select v#>>'{}' from woo_test where k='w')::uuid,'order.status',jsonb_build_object('id',(select v#>>'{}' from woo_test where k='history'),'version',1,'status','cancelled','reason','Annulation manuelle de test'),gen_random_uuid());
do $$begin assert (select status='cancelled' and status_origin='crm' and not stock_reserved from public.crm_orders where id=(select v#>>'{}' from woo_test where k='history')::uuid),'explicit CRM cancellation is verified without negative stock';end $$;
-- A second subscribing enterprise can connect the same Woo URL and use the same remote order ID independently.
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
insert into woo_test values('w2',to_jsonb(public.crm_bootstrap('Other Woo company','Other shop','Second owner',gen_random_uuid())));
insert into woo_test select 's2',to_jsonb(id) from public.crm_stores where workspace_id=(select v#>>'{}' from woo_test where k='w2')::uuid;
set local role service_role;
do $$declare c jsonb;d jsonb;r jsonb;begin
 c:=public.crm_woo_service('save',jsonb_build_object('store_id',(select v#>>'{}' from woo_test where k='s2'),'actor','20000000-0000-4000-8000-000000000003','base_url','https://woo-test.example.com','key','ck_'||repeat('1',40),'secret','cs_'||repeat('1',40),'cod_methods',jsonb_build_array('cod')));
 update public.crm_integrations set created_at='2026-10-01T00:00:00Z' where id=(c->>'id')::uuid;
 begin
  perform public.crm_woo_service('get_admin',jsonb_build_object('connection_id',(select v->>'id' from woo_test where k='c'),'actor','20000000-0000-4000-8000-000000000003'));
  raise exception 'OTHER_COMPANY_READ_FIRST_CONNECTION';
 exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 d:=(select v from woo_test where k='d')||jsonb_build_object('tracking',jsonb_build_object('purchase_event_id','kb_81_012345abcdef','purchase_sent_marker','2026-10-20 11:00:00'));
 r:=public.crm_woo_service('ingest',jsonb_build_object('connection_id',c->>'id','order',d,'hash',repeat('7',64)));
 assert r->>'outcome'='imported','remote ID 81 is separate for the second company';
 assert (select workspace_id=(select v#>>'{}' from woo_test where k='w2')::uuid from public.crm_orders where id=(r->>'id')::uuid),'second company owns its order';
 assert (select count(*)=1 from public.crm_orders where store_id=(c->>'store_id')::uuid and woo_number='WEB81'),'Woo reference scoped to the second store';
end $$;
do $$declare c jsonb:=(select v from woo_test where k='c');begin
 perform public.crm_woo_service('disconnect',jsonb_build_object('connection_id',c->>'id','actor','20000000-0000-4000-8000-000000000001'));
 begin perform public.crm_woo_service('get_webhook',jsonb_build_object('connection_id',c->>'id'));raise exception 'DISCONNECTED_STILL_ACTIVE';exception when others then if sqlerrm<>'DISCONNECTED' then raise;end if;end;
end $$;
reset role;
do $$begin
 assert not exists(select 1 from vault.secrets where name like 'weconvert_woo_'||(select v->>'id' from woo_test where k='c')),'disconnect removes credentials';
end $$;
select 'WooCommerce database checks passed' as verification;
