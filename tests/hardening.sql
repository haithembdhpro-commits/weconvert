-- Run inside BEGIN / ROLLBACK. Regression checks for the 27/10/2026 audit fixes.
-- Two companies: A (owner A1, agent A2) and B (owner B1, attacker). No external calls.
reset role;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous) values
 ('50000000-0000-4000-8000-0000000000a1','a-owner@weconvert.invalid',now(),'{}','{}',false),
 ('50000000-0000-4000-8000-0000000000a2','a-agent@weconvert.invalid',now(),'{}','{}',false),
 ('50000000-0000-4000-8000-0000000000b1','b-owner@weconvert.invalid',now(),'{}','{}',false);
create temp table h(k text primary key,v jsonb);
grant select,insert on h to authenticated,service_role;

-- Phone spellings accepted by the Edge Functions must also pass SQL.
do $$begin
 assert crm_private.normalize_phone('+213 0551 23 45 67')='+213551234567','+213 0… accepted';
 assert crm_private.normalize_phone('213551234567')='+213551234567','213… accepted';
 assert crm_private.normalize_phone('0551234567')='+213551234567','local accepted';
 begin perform crm_private.normalize_phone('+21345');raise exception 'BAD_PHONE_ACCEPTED';exception when others then if sqlerrm<>'INVALID_PHONE' then raise;end if;end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
insert into h values('wa',to_jsonb(public.crm_bootstrap('Entreprise A','Boutique A','Owner A',gen_random_uuid())));
insert into h select 'sa',to_jsonb(id) from public.crm_stores where workspace_id=(select (v#>>'{}')::uuid from h where k='wa');
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-0000000000b1","role":"authenticated"}',true);
insert into h values('wb',to_jsonb(public.crm_bootstrap('Entreprise B','Boutique B','Owner B',gen_random_uuid())));
insert into h select 'sb',to_jsonb(id) from public.crm_stores where workspace_id=(select (v#>>'{}')::uuid from h where k='wb');
reset role;
insert into public.crm_members(workspace_id,user_id,display_name,role) values
 ((select (v#>>'{}')::uuid from h where k='wa'),'50000000-0000-4000-8000-0000000000a2','Agent A','agent');

-- OAuth: B starts a Shopify flow for a shop, the merchant approves; only B's own logged-in confirmation activates it.
set local role service_role;
do $$declare c jsonb;r jsonb;sb uuid:=(select (v#>>'{}')::uuid from h where k='sb');
 b uuid:='50000000-0000-4000-8000-0000000000b1';a uuid:='50000000-0000-4000-8000-0000000000a1';begin
 begin perform public.crm_oauth_guard('bind',jsonb_build_object('connection_id',gen_random_uuid(),'actor',b,'nonce_hash',repeat('a',64)));raise exception 'BIND_UNKNOWN';
 exception when others then if sqlerrm<>'NOT_FOUND' then raise;end if;end;
 c:=public.crm_source_service('begin',jsonb_build_object('store_id',sb,'actor',b,'provider','shopify','external_shop','victim.myshopify.com','nonce_hash',repeat('a',64),'cod_methods',jsonb_build_array('cod')));
 begin perform public.crm_oauth_guard('bind',jsonb_build_object('connection_id',c->>'id','actor',a,'nonce_hash',repeat('a',64)));raise exception 'FOREIGN_BIND';
 exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 perform public.crm_oauth_guard('bind',jsonb_build_object('connection_id',c->>'id','actor',b,'nonce_hash',repeat('a',64)));
 begin perform public.crm_oauth_guard('stash',jsonb_build_object('connection_id',c->>'id','nonce_hash',repeat('f',64),'confirm_hash',repeat('c',64),'payload','{}'::jsonb));raise exception 'STASH_WRONG_NONCE';
 exception when others then if sqlerrm<>'INVALID_STATE' then raise;end if;end;
 perform public.crm_oauth_guard('stash',jsonb_build_object('connection_id',c->>'id','nonce_hash',repeat('a',64),'confirm_hash',repeat('c',64),'payload',jsonb_build_object('credentials',jsonb_build_object('access_token','t','refresh_token','r','expires_in',3600))));
 assert (select status='pending' from public.crm_source_connections where id=(c->>'id')::uuid),'callback alone does not activate';
 -- Someone else (the merchant's own CRM account here) presenting the ticket is refused and burns it.
 r:=public.crm_oauth_guard('confirm',jsonb_build_object('actor',a,'confirm_hash',repeat('c',64)));
 assert r->>'error'='INVALID_STATE','foreign confirmation refused';
 r:=public.crm_oauth_guard('confirm',jsonb_build_object('actor',b,'confirm_hash',repeat('c',64)));
 assert r->>'error'='INVALID_STATE','ticket is single use';
 -- Legitimate path.
 perform public.crm_oauth_guard('bind',jsonb_build_object('connection_id',c->>'id','actor',b,'nonce_hash',repeat('a',64)));
 perform public.crm_oauth_guard('stash',jsonb_build_object('connection_id',c->>'id','nonce_hash',repeat('a',64),'confirm_hash',repeat('d',64),'payload',jsonb_build_object('credentials',jsonb_build_object('access_token','t','refresh_token','r','expires_in',3600))));
 r:=public.crm_oauth_guard('confirm',jsonb_build_object('actor',b,'confirm_hash',repeat('d',64)));
 assert r->>'connection_id'=c->>'id' and r->>'nonce_hash'=repeat('a',64),'initiator confirmation returns the parked approval';
 perform public.crm_source_service('finish_oauth',jsonb_build_object('connection_id',c->>'id','nonce_hash',r->>'nonce_hash','credentials',r#>'{payload,credentials}'));
 assert (select status='awaiting_webhook' from public.crm_source_connections where id=(c->>'id')::uuid),'activated after confirmation';
end $$;
reset role;
set local role authenticated;
do $$begin
 begin perform public.crm_oauth_guard('confirm','{}');raise exception 'GUARD_EXPOSED';exception when insufficient_privilege then null;end;
 begin perform * from crm_private.oauth_pending;raise exception 'PENDING_EXPOSED';exception when insufficient_privilege then null;end;
end $$;
reset role;

-- Two lines mapped to the same CRM product are accepted (previously a permanent unique violation).
set local role service_role;
insert into public.crm_products(workspace_id,store_id,name,sku,price,stock) values
 ((select (v#>>'{}')::uuid from h where k='wa'),(select (v#>>'{}')::uuid from h where k='sa'),'Produit A','HA-1',1000,10);
insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,commune,address,channel,status,total,created_by,assigned_to) values
 ((select (v#>>'{}')::uuid from h where k='wa'),(select (v#>>'{}')::uuid from h where k='sa'),'Client H','+213555000099','Alger','Kouba','Rue du test','website','new',3000,
  '50000000-0000-4000-8000-0000000000a1','50000000-0000-4000-8000-0000000000a2');
insert into h select 'o',to_jsonb(id) from public.crm_orders where customer_name='Client H';
insert into public.crm_order_items(workspace_id,store_id,order_id,product_id,product_name,sku,quantity,unit_price)
 select o.workspace_id,o.store_id,o.id,p.id,x.n,p.sku,x.q,1000 from public.crm_orders o join public.crm_products p on p.store_id=o.store_id,
 (values('Variante rouge',1),('Variante bleue',2)) x(n,q) where o.customer_name='Client H';
reset role;

-- Confirm as owner: stock reserved across both lines, product version untouched (catalog sync stays live).
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
do $$declare w uuid:=(select (v#>>'{}')::uuid from h where k='wa');oid uuid:=(select (v#>>'{}')::uuid from h where k='o');pv integer;ov integer;begin
 select version into pv from public.crm_products where sku='HA-1';select version into ov from public.crm_orders where id=oid;
 perform public.crm_command(w,'order.status',jsonb_build_object('id',oid,'version',ov,'status','confirmed'),gen_random_uuid());
 assert (select reserved=3 and version=pv from public.crm_products where sku='HA-1'),'both lines reserved, version unchanged';
end $$;
reset role;

-- Parcel handed to ZR: the confirmed order cannot be reopened or cancelled any more.
insert into public.crm_shipping_connections(workspace_id,store_id,platform,created_by)
 select o.workspace_id,o.store_id,'legacy','50000000-0000-4000-8000-0000000000a1' from public.crm_orders o where o.id=(select (v#>>'{}')::uuid from h where k='o');
insert into public.crm_shipments(workspace_id,store_id,order_id,connection_id,reference,platform,state,cod_amount,sent_by)
 select o.workspace_id,o.store_id,o.id,c.id,'REF-H','legacy','in_transit',3000,'50000000-0000-4000-8000-0000000000a1'
 from public.crm_orders o join public.crm_shipping_connections c on c.store_id=o.store_id where o.id=(select (v#>>'{}')::uuid from h where k='o');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
do $$declare w uuid:=(select (v#>>'{}')::uuid from h where k='wa');oid uuid:=(select (v#>>'{}')::uuid from h where k='o');ov integer;begin
 select version into ov from public.crm_orders where id=oid;
 begin perform public.crm_command(w,'order.status',jsonb_build_object('id',oid,'version',ov,'status','cancelled','reason','Client injoignable'),gen_random_uuid());raise exception 'SHIPPED_ORDER_CANCELLED';
 exception when others then if sqlerrm<>'SHIPMENT_ACTIVE' then raise;end if;end;
 assert (select reserved=3 from public.crm_products where sku='HA-1'),'reservation kept';
end $$;
-- Agents cannot acknowledge a source change; managers can.
reset role;
update public.crm_orders set source_attention=true where id=(select (v#>>'{}')::uuid from h where k='o');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
do $$declare oid uuid:=(select (v#>>'{}')::uuid from h where k='o');ov integer;begin
 select version into ov from public.crm_orders where id=oid;
 begin perform public.crm_source_ack(oid,ov);raise exception 'AGENT_ACK';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
end $$;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-0000000000b1","role":"authenticated"}',true);
do $$declare oid uuid:=(select (v#>>'{}')::uuid from h where k='o');begin
 begin perform public.crm_source_ack(oid,1);raise exception 'CROSS_TENANT_ACK';exception when others then if sqlerrm<>'NOT_FOUND' then raise;end if;end;
end $$;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
do $$declare oid uuid:=(select (v#>>'{}')::uuid from h where k='o');ov integer;begin
 select version into ov from public.crm_orders where id=oid;
 perform public.crm_source_ack(oid,ov);
 assert (select not source_attention from public.crm_orders where id=oid),'manager acknowledged';
end $$;

-- Expenses: same request id stored once.
do $$declare s uuid:=(select (v#>>'{}')::uuid from h where k='sa');rq uuid:=gen_random_uuid();p jsonb;begin
 p:=jsonb_build_object('amount',4500,'kind','ads','spent_on',current_date-1,'note','Meta','request_id',rq);
 perform public.crm_cost_command(s,'expense',p);perform public.crm_cost_command(s,'expense',p);
 assert (select count(*)=1 from public.crm_cost_entries where request_id=rq),'expense retry is idempotent';
end $$;
reset role;

-- ZR cron queue: failing parcels back off and stop starving healthy ones.
set local role service_role;
do $$declare sh uuid:=(select id from public.crm_shipments where reference='REF-H');n integer;begin
 select count(*) into n from public.crm_zr_sync_queue() where id=sh;assert n=1,'due parcel picked';
 perform public.crm_zr_cron_failed(sh,'ZR_AUTH');
 select count(*) into n from public.crm_zr_sync_queue() where id=sh;assert n=0,'failed parcel backs off';
 assert (select attempt_errors=1 and last_error='ZR_AUTH' from public.crm_shipments where id=sh),'failure recorded';
end $$;
reset role;
select 'Hardening checks passed' as verification;
