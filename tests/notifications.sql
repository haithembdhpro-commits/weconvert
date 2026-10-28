-- Run inside BEGIN / ROLLBACK. Notifications: feed computed under RLS, unread count per user and store.
-- Two companies (A: owner + agent, B: owner). No external calls.
reset role;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous) values
 ('70000000-0000-4000-8000-0000000000a1','notif-a-owner@weconvert.invalid',now(),'{}','{}',false),
 ('70000000-0000-4000-8000-0000000000a2','notif-a-agent@weconvert.invalid',now(),'{}','{}',false),
 ('70000000-0000-4000-8000-0000000000b1','notif-b-owner@weconvert.invalid',now(),'{}','{}',false);
create temp table nh(k text primary key,v jsonb);
grant select,insert on nh to authenticated,service_role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
insert into nh values('wa',to_jsonb(public.crm_bootstrap('Notif A','Boutique Notif A','Owner A',gen_random_uuid())));
insert into nh select 'sa',to_jsonb(id) from public.crm_stores where workspace_id=(select (v#>>'{}')::uuid from nh where k='wa');
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-0000000000b1","role":"authenticated"}',true);
insert into nh values('wb',to_jsonb(public.crm_bootstrap('Notif B','Boutique Notif B','Owner B',gen_random_uuid())));
insert into nh select 'sb',to_jsonb(id) from public.crm_stores where workspace_id=(select (v#>>'{}')::uuid from nh where k='wb');
reset role;
insert into public.crm_members(workspace_id,user_id,display_name,role) values
 ((select (v#>>'{}')::uuid from nh where k='wa'),'70000000-0000-4000-8000-0000000000a2','Agent A','agent');

-- Store A: a new order assigned to the agent, an unassigned order with a due callback, an old order (10 days) with a returned parcel.
insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,commune,address,channel,status,total,created_by,assigned_to,callback_at,created_at)
select (select (v#>>'{}')::uuid from nh where k='wa'),(select (v#>>'{}')::uuid from nh where k='sa'),x.n,x.p,'16 - Alger','Kouba','Rue','website',x.s,1000,
 '70000000-0000-4000-8000-0000000000a1',x.a,x.cb,x.c
from (values
 ('Nouvelle A','+213555200001','new','70000000-0000-4000-8000-0000000000a2'::uuid,null::timestamptz,now()-interval '1 hour'),
 ('Rappel A','+213555200002','reported',null,now()-interval '10 minutes',now()-interval '3 days'),
 ('Retour A','+213555200003','confirmed',null,null,now()-interval '10 days')) x(n,p,s,a,cb,c);
insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,commune,address,channel,status,total,created_by)
values((select (v#>>'{}')::uuid from nh where k='wb'),(select (v#>>'{}')::uuid from nh where k='sb'),'Nouvelle B','+213555200009','31 - Oran','Bir El Djir','Rue B','website','new',1000,'70000000-0000-4000-8000-0000000000b1');
insert into public.crm_shipping_connections(workspace_id,store_id,platform,created_by)
 values((select (v#>>'{}')::uuid from nh where k='wa'),(select (v#>>'{}')::uuid from nh where k='sa'),'legacy','70000000-0000-4000-8000-0000000000a1');
insert into public.crm_shipments(workspace_id,store_id,order_id,connection_id,reference,platform,state,tracking,raw_status,cod_amount,sent_by)
 select o.workspace_id,o.store_id,o.id,c.id,'REF-RET','legacy','returned','TRK-RET','Retourné',1000,'70000000-0000-4000-8000-0000000000a1'
 from public.crm_orders o join public.crm_shipping_connections c on c.store_id=o.store_id where o.customer_name='Retour A';

set local role authenticated;
-- Owner A: three kinds, everything unread at first; "seen" clears the count; the other company's store shows nothing.
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
do $$declare s uuid:=(select (v#>>'{}')::uuid from nh where k='sa');r jsonb;begin
 r:=public.crm_notifications(s);
 -- 2 orders created within 7 days + 1 due callback + 1 returned parcel.
 assert (r->>'unread')::integer=4,'four unread: '||r::text;
 assert (select array_agg(i->>'kind' order by i->>'kind') from jsonb_array_elements(r->'items') i)=array['callback.due','order.new','order.new','parcel.returned'],'kinds: '||(r->'items')::text;
 assert not exists(select 1 from jsonb_array_elements(r->'items') i where i->>'customer_name'='Retour A' and i->>'kind'='order.new'),'10-day-old order is not new';
 perform public.crm_notifications_seen(s);
 r:=public.crm_notifications(s);
 assert (r->>'unread')::integer=0 and r->>'seen_at' is not null,'seen clears unread';
 assert (select bool_and(not (i->>'unread')::boolean) from jsonb_array_elements(r->'items') i),'items marked read';
 r:=public.crm_notifications((select (v#>>'{}')::uuid from nh where k='sb'));
 assert jsonb_array_length(r->'items')=0 and (r->>'unread')::integer=0,'no cross-tenant items';
 begin perform public.crm_notifications_seen((select (v#>>'{}')::uuid from nh where k='sb'));raise exception 'SEEN_OTHER';
 exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
end $$;

-- Agent A: only the order assigned to them; their own "seen" state, independent of the owner's.
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
do $$declare s uuid:=(select (v#>>'{}')::uuid from nh where k='sa');r jsonb;begin
 r:=public.crm_notifications(s);
 assert (r->>'unread')::integer=1 and jsonb_array_length(r->'items')=1 and r#>>'{items,0,customer_name}'='Nouvelle A','agent scope: '||r::text;
 assert (select count(*) from public.crm_notification_seen)=0,'agent cannot read the owner seen row';
end $$;
reset role;
