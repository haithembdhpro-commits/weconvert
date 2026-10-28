-- Run inside BEGIN / ROLLBACK. Synthetic users, stores and orders only.
reset role;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous) values
 ('30000000-0000-4000-8000-000000000001','report-owner@weconvert.invalid',now(),'{}','{}',false),
 ('30000000-0000-4000-8000-000000000002','report-agent@weconvert.invalid',now(),'{}','{}',false),
 ('30000000-0000-4000-8000-000000000003','report-outsider@weconvert.invalid',now(),'{}','{}',false);
create temp table report_test(k text primary key,v uuid);
grant select,insert on report_test to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into report_test values('workspace',public.crm_bootstrap('Report test','Store A','Owner report',gen_random_uuid()));
insert into report_test select 'store',id from public.crm_stores where workspace_id=(select v from report_test where k='workspace');
set local role service_role;
insert into public.crm_members(workspace_id,user_id,display_name,role)
 values((select v from report_test where k='workspace'),'30000000-0000-4000-8000-000000000002','Agent report','agent');
insert into public.crm_stores(workspace_id,name) values((select v from report_test where k='workspace'),'Store B') returning id;
insert into report_test select 'other_store',id from public.crm_stores where workspace_id=(select v from report_test where k='workspace') and name='Store B';
insert into public.crm_products(workspace_id,store_id,name,sku,price,stock)
 values((select v from report_test where k='workspace'),(select v from report_test where k='store'),'Produit report','REP-1',1000,10);
insert into report_test select 'product',id from public.crm_products where store_id=(select v from report_test where k='store');
insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,channel,status,total,created_by,created_at,assigned_to) values
 ((select v from report_test where k='workspace'),(select v from report_test where k='store'),'Client A','+213555000001','Alger','website','confirmed',1000,'30000000-0000-4000-8000-000000000001',(((now() at time zone 'Africa/Algiers')::date-1)::timestamp+interval '1 hour') at time zone 'Africa/Algiers','30000000-0000-4000-8000-000000000002'),
 ((select v from report_test where k='workspace'),(select v from report_test where k='store'),'Client B','+213555000002','Oran','website','confirmed',2000,'30000000-0000-4000-8000-000000000001',((now() at time zone 'Africa/Algiers')::date::timestamp+interval '1 hour') at time zone 'Africa/Algiers',null),
 ((select v from report_test where k='workspace'),(select v from report_test where k='store'),'Client C','+213555000003','Oran','whatsapp','cancelled',500,'30000000-0000-4000-8000-000000000001',(((now() at time zone 'Africa/Algiers')::date-1)::timestamp+interval '2 hours') at time zone 'Africa/Algiers','30000000-0000-4000-8000-000000000002'),
 ((select v from report_test where k='workspace'),(select v from report_test where k='store'),'Client D','+213555000004','Alger','website','new',800,'30000000-0000-4000-8000-000000000001',(((now() at time zone 'Africa/Algiers')::date-1)::timestamp+interval '3 hours') at time zone 'Africa/Algiers',null),
 ((select v from report_test where k='workspace'),(select v from report_test where k='store'),'Client old','+213555000005','Alger','website','confirmed',5000,'30000000-0000-4000-8000-000000000001',(((now() at time zone 'Africa/Algiers')::date-2)::timestamp+interval '23 hours') at time zone 'Africa/Algiers',null),
 ((select v from report_test where k='workspace'),(select v from report_test where k='other_store'),'Client other','+213555000006','Alger','website','confirmed',9000,'30000000-0000-4000-8000-000000000001',now(),null);
insert into public.crm_order_items(workspace_id,store_id,order_id,product_id,product_name,sku,quantity,unit_price)
 select o.workspace_id,o.store_id,o.id,(select v from report_test where k='product'),'Produit report','REP-1',
  case when o.customer_name='Client B' then 2 else 1 end,
  case when o.customer_name='Client C' then 500 else 1000 end
 from public.crm_orders o where o.store_id=(select v from report_test where k='store') and o.customer_name in ('Client A','Client B','Client C');

-- Historical Woo terminal states remain visible, but are not verified COD outcomes.
insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,channel,status,status_origin,total,created_by,created_at,woo_snapshot,woo_status) values
 ((select v from report_test where k='workspace'),(select v from report_test where k='store'),'Legacy completed','+213555000007','Alger','website','confirmed','woo_legacy',7000,'30000000-0000-4000-8000-000000000001',(((now() at time zone 'Africa/Algiers')::date-1)::timestamp+interval '4 hours') at time zone 'Africa/Algiers','{"external_id":7}'::jsonb,'completed'),
 ((select v from report_test where k='workspace'),(select v from report_test where k='store'),'Legacy cancelled','+213555000008','Oran','website','cancelled','woo_legacy',900,'30000000-0000-4000-8000-000000000001',(((now() at time zone 'Africa/Algiers')::date-1)::timestamp+interval '5 hours') at time zone 'Africa/Algiers','{"external_id":8}'::jsonb,'cancelled');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare r jsonb;s uuid:=(select v from report_test where k='store');d date:=(now() at time zone 'Africa/Algiers')::date;begin
 r:=public.crm_performance(s,d-1,d);
 assert (r->'summary'->>'orders')::integer=6 and (r->'summary'->>'confirmed')::integer=2,'cohort counts without legacy status inference';
 assert (r->'summary'->>'pending')::integer=1 and (r->'summary'->>'cancelled')::integer=1,'status counts';
 assert (r->'summary'->>'woo_confirmation_unverified')::integer=1 and (r->'summary'->>'woo_cancellation_unverified')::integer=1,'unverified outcomes reported separately';
 assert (public.crm_overview(s)->>'woo_confirmation_unverified')::integer=1 and (public.crm_overview(s)->>'woo_cancellation_unverified')::integer=1,'dashboard provenance is scoped to this store';
 assert (r->'summary'->>'confirmed_amount')::numeric=3000,'COD amount counts confirmed only';
 assert jsonb_array_length(r->'days')=2 and (r->'days'->0->>'orders')::integer=5 and (r->'days'->1->>'orders')::integer=1,'Algeria local day boundary';
 assert (r->'products'->0->>'confirmed_units')::integer=3 and (r->'products'->0->>'confirmed_lines_amount')::numeric=3000,'line amounts exclude cancelled';
 assert jsonb_array_length(r->'agents')=2,'assigned and unassigned groups';
 r:=public.crm_performance(s,d-1,d,null,'whatsapp');
 assert (r->'summary'->>'orders')::integer=1 and (r->'summary'->>'confirmed')::integer=0,'channel filter';
 r:=public.crm_performance(s,d-1,d,null,'instagram');
 assert (r->'summary'->>'orders')::integer=0 and jsonb_array_length(r->'days')=2
  and jsonb_array_length(r->'channels')=0,'empty cohort and zero-filled days';
 r:=public.crm_performance(s,d-1,d,'30000000-0000-4000-8000-000000000002');
 assert (r->'summary'->>'orders')::integer=2 and (r->'summary'->>'confirmed_amount')::numeric=1000,'agent filter';
 begin perform public.crm_performance(s,d-366,d);raise exception 'RANGE_UNBOUNDED';exception when others then if sqlerrm<>'INVALID_FILTER' then raise;end if;end;
end $$;
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$declare r jsonb;s uuid:=(select v from report_test where k='store');d date:=(now() at time zone 'Africa/Algiers')::date;begin
 r:=public.crm_performance(s,d-1,d);
 assert (r->'summary'->>'orders')::integer=2 and (r->'summary'->>'confirmed_amount')::numeric=1000,'agent RLS';
 begin perform public.crm_performance(s,d-1,d,'30000000-0000-4000-8000-000000000001');raise exception 'AGENT_FILTER_BYPASS';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
end $$;
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$declare s uuid:=(select v from report_test where k='store');d date:=(now() at time zone 'Africa/Algiers')::date;begin
 begin perform public.crm_performance(s,d-1,d);raise exception 'CROSS_TENANT';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
end $$;
select 'Performance checks passed' as verification;
