-- Run inside BEGIN / ROLLBACK. Confirmoo-style orders board: stages, parcel column, explicit call attempts.
-- Two companies (A: owner + agent, B: owner). No external calls.
reset role;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous) values
 ('60000000-0000-4000-8000-0000000000a1','board-a-owner@weconvert.invalid',now(),'{}','{}',false),
 ('60000000-0000-4000-8000-0000000000a2','board-a-agent@weconvert.invalid',now(),'{}','{}',false),
 ('60000000-0000-4000-8000-0000000000b1','board-b-owner@weconvert.invalid',now(),'{}','{}',false);
create temp table bh(k text primary key,v jsonb);
grant select,insert on bh to authenticated,service_role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
insert into bh values('wa',to_jsonb(public.crm_bootstrap('Board A','Boutique Board A','Owner A',gen_random_uuid())));
insert into bh select 'sa',to_jsonb(id) from public.crm_stores where workspace_id=(select (v#>>'{}')::uuid from bh where k='wa');
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-0000000000b1","role":"authenticated"}',true);
insert into bh values('wb',to_jsonb(public.crm_bootstrap('Board B','Boutique Board B','Owner B',gen_random_uuid())));
insert into bh select 'sb',to_jsonb(id) from public.crm_stores where workspace_id=(select (v#>>'{}')::uuid from bh where k='wb');
reset role;
insert into public.crm_members(workspace_id,user_id,display_name,role) values
 ((select (v#>>'{}')::uuid from bh where k='wa'),'60000000-0000-4000-8000-0000000000a2','Agent A','agent');

-- Store A: six orders, one per stage (new, preparing, dispatched, delivered, returned, closed); one more in store B.
insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,commune,address,channel,status,total,created_by,assigned_to)
select (select (v#>>'{}')::uuid from bh where k='wa'),(select (v#>>'{}')::uuid from bh where k='sa'),x.n,x.p,'Alger','Kouba','Rue du test','website',x.s,1000,
 '60000000-0000-4000-8000-0000000000a1',case when x.n in ('Nouvelle A','Expediee A') then '60000000-0000-4000-8000-0000000000a2'::uuid end
from (values('Nouvelle A','+213555100001','new'),('Preparation A','+213555100002','confirmed'),('Expediee A','+213555100003','confirmed'),
 ('Livree A','+213555100004','confirmed'),('Retournee A','+213555100005','confirmed'),('Annulee A','+213555100006','cancelled')) x(n,p,s);
insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,commune,address,channel,status,total,created_by)
values((select (v#>>'{}')::uuid from bh where k='wb'),(select (v#>>'{}')::uuid from bh where k='sb'),'Nouvelle B','+213555100009','Oran','Bir El Djir','Rue B','website','new',1000,'60000000-0000-4000-8000-0000000000b1');
insert into public.crm_shipping_connections(workspace_id,store_id,platform,created_by)
 values((select (v#>>'{}')::uuid from bh where k='wa'),(select (v#>>'{}')::uuid from bh where k='sa'),'legacy','60000000-0000-4000-8000-0000000000a1');
insert into public.crm_shipments(workspace_id,store_id,order_id,connection_id,reference,platform,state,tracking,raw_status,cod_amount,sent_by)
 select o.workspace_id,o.store_id,o.id,c.id,'REF-'||x.r,'legacy',x.st,'TRK-'||x.r,x.raw,1000,'60000000-0000-4000-8000-0000000000a1'
 from (values('Expediee A','EXP','in_transit','En transit'),('Livree A','LIV','delivered','Livré'),('Retournee A','RET','returned','Retourné')) x(n,r,st,raw)
 join public.crm_orders o on o.customer_name=x.n join public.crm_shipping_connections c on c.store_id=o.store_id;

-- Owner A: every stage counted once; the parcel and its tracking travel with the order; tracking is searchable.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
do $$declare s uuid:=(select (v#>>'{}')::uuid from bh where k='sa');r jsonb;begin
 r:=public.crm_order_board(s);
 assert (r->>'total')::integer=6,'store A only';
 assert r->'stages'='{"new":1,"preparing":1,"dispatched":1,"delivered":1,"returned":1,"closed":1}'::jsonb,'one order per stage: '||(r->'stages')::text;
 r:=public.crm_order_board(s,'dispatched');
 assert (r->>'total')::integer=1 and r#>>'{items,0,customer_name}'='Expediee A' and r#>>'{items,0,shipment,state}'='in_transit' and r#>>'{items,0,shipment,tracking}'='TRK-EXP','dispatched with parcel';
 assert (r->'stages'->>'new')::integer=1,'stage counters ignore the stage filter';
 r:=public.crm_order_board(s,'all','all','TRK-LIV');
 assert (r->>'total')::integer=1 and r#>>'{items,0,customer_name}'='Livree A','search by tracking';
 r:=public.crm_order_board(s,'all','confirmed');
 assert (r->>'total')::integer=4,'status filter (legacy link #orders/confirmed)';
 assert (select bool_and(i ? 'items' and not i ? 'rn' and not i ? 'ship_state') from jsonb_array_elements(public.crm_order_board(s)->'items') i),'clean item shape';
 begin perform public.crm_order_board(s,'shipped');raise exception 'BAD_STAGE';exception when others then if sqlerrm<>'INVALID_FILTER' then raise;end if;end;
 begin perform public.crm_order_board(s,'all','delivered');raise exception 'BAD_STATUS';exception when others then if sqlerrm<>'INVALID_FILTER' then raise;end if;end;
 -- Other company's store: nothing visible.
 r:=public.crm_order_board((select (v#>>'{}')::uuid from bh where k='sb'));
 assert (r->>'total')::integer=0 and r->'stages'='{}'::jsonb,'no cross-tenant rows';
end $$;

-- Agent A: only the two orders assigned to them, counters included.
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
do $$declare r jsonb;begin
 r:=public.crm_order_board((select (v#>>'{}')::uuid from bh where k='sa'));
 assert (r->>'total')::integer=2 and r->'stages'='{"new":1,"dispatched":1}'::jsonb,'agent scope: '||(r->'stages')::text;
end $$;

-- Explicit call attempts from the status menu: jump to "Appel 3", never backwards, default still +1.
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
do $$declare w uuid:=(select (v#>>'{}')::uuid from bh where k='wa');oid uuid;ov integer;begin
 select id,version into oid,ov from public.crm_orders where customer_name='Nouvelle A';
 perform public.crm_command(w,'order.call',jsonb_build_object('id',oid,'version',ov),gen_random_uuid());
 assert (select attempts=1 and status='call1' from public.crm_orders where id=oid),'default +1';
 select version into ov from public.crm_orders where id=oid;
 perform public.crm_command(w,'order.call',jsonb_build_object('id',oid,'version',ov,'attempt',3),gen_random_uuid());
 assert (select attempts=3 and status='call3' from public.crm_orders where id=oid),'jump to Appel 3';
 assert exists(select 1 from public.crm_events where order_id=oid and kind='order.call' and data->>'attempt'='3'),'attempt in history';
 select version into ov from public.crm_orders where id=oid;
 begin perform public.crm_command(w,'order.call',jsonb_build_object('id',oid,'version',ov,'attempt',2),gen_random_uuid());raise exception 'BACKWARDS';
 exception when others then if sqlerrm<>'INVALID_TRANSITION' then raise;end if;end;
 begin perform public.crm_command(w,'order.call',jsonb_build_object('id',oid,'version',ov,'attempt','x'),gen_random_uuid());raise exception 'GARBAGE';
 exception when others then if sqlerrm<>'INVALID_TRANSITION' then raise;end if;end;
 perform public.crm_command(w,'order.call',jsonb_build_object('id',oid,'version',ov),gen_random_uuid());
 assert (select attempts=4 and status='call3' from public.crm_orders where id=oid),'beyond 3 stays Appel 3+';
end $$;
reset role;
