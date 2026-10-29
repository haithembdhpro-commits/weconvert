-- Run inside BEGIN / ROLLBACK. Synthetic data only: 2 companies, 2 stores, owner / agent / outsider.
reset role;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous) values
 ('60000000-0000-4000-8000-000000000001','insights-owner@weconvert.invalid',now(),'{}','{}',false),
 ('60000000-0000-4000-8000-000000000002','insights-agent@weconvert.invalid',now(),'{}','{}',false),
 ('60000000-0000-4000-8000-000000000003','insights-other@weconvert.invalid',now(),'{}','{}',false);
create temp table ins(k text primary key,v uuid);
grant select,insert on ins to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into ins values('ws',public.crm_bootstrap('Insights A','Store A','Owner A',gen_random_uuid()));
insert into ins select 'store',id from public.crm_stores where workspace_id=(select v from ins where k='ws');
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
insert into ins values('ws_b',public.crm_bootstrap('Insights B','Store B1','Owner B',gen_random_uuid()));
set local role service_role;
insert into public.crm_members(workspace_id,user_id,display_name,role) values((select v from ins where k='ws'),'60000000-0000-4000-8000-000000000002','Agent A','agent');
insert into public.crm_stores(workspace_id,name) values((select v from ins where k='ws'),'Store A2');
insert into ins select 'store2',id from public.crm_stores where workspace_id=(select v from ins where k='ws') and name='Store A2';
insert into public.crm_products(workspace_id,store_id,name,sku,price,stock) values((select v from ins where k='ws'),(select v from ins where k='store'),'Crème','CR-1',2000,50);
insert into ins select 'product',id from public.crm_products where store_id=(select v from ins where k='store');
insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,channel,status,status_origin,total,attempts,created_by,created_at,assigned_to) values
 ((select v from ins where k='ws'),(select v from ins where k='store'),'Livré','+213555100001','16 - Alger','website','confirmed','crm',4400,1,'60000000-0000-4000-8000-000000000001',now()-interval '30 hours','60000000-0000-4000-8000-000000000002'),
 ((select v from ins where k='ws'),(select v from ins where k='store'),'Retour','+213555100002','31 - Oran','website','confirmed','crm',2400,0,'60000000-0000-4000-8000-000000000001',now()-interval '29 hours',null),
 ((select v from ins where k='ws'),(select v from ins where k='store'),'Annulé','+213555100003','31 - Oran','website','cancelled','crm',2400,2,'60000000-0000-4000-8000-000000000001',now()-interval '28 hours',null),
 ((select v from ins where k='ws'),(select v from ins where k='store'),'Faux','+213555100004','16 - Alger','website','fake','crm',2400,0,'60000000-0000-4000-8000-000000000001',now()-interval '27 hours',null),
 ((select v from ins where k='ws'),(select v from ins where k='store'),'Nouveau','+213555100005','16 - Alger','whatsapp','new','crm',2400,0,'60000000-0000-4000-8000-000000000001',now()-interval '2 hours',null),
 ((select v from ins where k='ws'),(select v from ins where k='store'),'Ancien Woo','+213555100006','16 - Alger','website','cancelled','woo_legacy',2400,0,'60000000-0000-4000-8000-000000000001',now()-interval '26 hours',null),
 ((select v from ins where k='ws'),(select v from ins where k='store2'),'Autre boutique','+213555100007','16 - Alger','website','confirmed','crm',9000,0,'60000000-0000-4000-8000-000000000001',now()-interval '25 hours',null);
insert into public.crm_order_items(workspace_id,store_id,order_id,product_id,product_name,sku,quantity,unit_price)
 select o.workspace_id,o.store_id,o.id,(select v from ins where k='product'),'Crème','CR-1',case when o.customer_name='Livré' then 2 else 1 end,2000
 from public.crm_orders o where o.store_id=(select v from ins where k='store') and o.customer_name in ('Livré','Retour');
insert into public.crm_shipping_connections(workspace_id,store_id,platform,created_by) values((select v from ins where k='ws'),(select v from ins where k='store'),'new','60000000-0000-4000-8000-000000000001');
insert into public.crm_shipments(workspace_id,store_id,order_id,connection_id,reference,platform,state,cod_amount,sent_by,sent_at,delivered_at)
 select o.workspace_id,o.store_id,o.id,(select id from public.crm_shipping_connections where store_id=o.store_id),'REF-'||o.customer_name,'new',
  case when o.customer_name='Livré' then 'delivered' else 'returned' end,o.total,'60000000-0000-4000-8000-000000000001',now()-interval '26 hours',
  case when o.customer_name='Livré' then now()-interval '2 hours' end
 from public.crm_orders o where o.store_id=(select v from ins where k='store') and o.customer_name in ('Livré','Retour');
-- Handling history: first call 20 min after arrival for the delivered order, reasons for the lost ones.
insert into public.crm_events(workspace_id,store_id,order_id,actor_id,actor_name,kind,data,created_at)
 select o.workspace_id,o.store_id,o.id,'60000000-0000-4000-8000-000000000002','Agent A',x.kind,x.data,o.created_at+x.after
 from public.crm_orders o join (values
  ('Livré','order.call','{"attempt":1}'::jsonb,interval '20 minutes'),
  ('Livré','order.status','{"from":"call1","to":"confirmed","reason":""}'::jsonb,interval '50 minutes'),
  ('Annulé','order.status','{"from":"new","to":"cancelled","reason":"Prix trop élevé"}'::jsonb,interval '2 hours'),
  ('Faux','order.status','{"from":"new","to":"fake","reason":"Numéro inexistant ou hors service"}'::jsonb,interval '40 minutes')
 ) x(name,kind,data,after) on x.name=o.customer_name
 where o.store_id=(select v from ins where k='store');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare r jsonb;s uuid:=(select v from ins where k='store');d date:=(now() at time zone 'Africa/Algiers')::date;w jsonb;a jsonb;begin
 r:=public.crm_report_insights(s,d-2,d);
 assert (r->'funnel'->>'received')::int=6,'received counts every order of this store only';
 assert (r->'funnel'->>'rate_base')::int=5 and (r->'funnel'->>'confirmed')::int=2,'legacy Woo excluded from verified decisions';
 assert (r->'funnel'->>'shipped')::int=2 and (r->'funnel'->>'delivered')::int=1 and (r->'funnel'->>'returned')::int=1 and (r->'funnel'->>'in_progress')::int=0,'parcels';
 assert (r->'funnel'->>'delivered_cod')::numeric=4400,'COD delivered = delivered parcels only';
 assert (r->'funnel'->>'lost')::int=2 and (r->'funnel'->>'pending')::int=1,'lost = verified cancelled/fake/duplicate';
 assert jsonb_array_length(r->'reasons')=2 and exists(select 1 from jsonb_array_elements(r->'reasons') x where x->>'reason'='Prix trop élevé' and x->>'status'='cancelled'),'reasons from the last status change';
 select x into w from jsonb_array_elements(r->'wilayas') x where x->>'wilaya'='31 - Oran';
 assert (w->>'orders')::int=2 and (w->>'returned')::int=1 and (w->>'delivered')::int=0,'wilaya returns';
 select x into w from jsonb_array_elements(r->'wilayas') x where x->>'wilaya'='16 - Alger';
 assert (w->>'delivered')::int=1 and (w->>'avg_days')::numeric=1.0,'wilaya delivery and delay';
 select x into a from jsonb_array_elements(r->'agents') x where x->>'name'='Agent A';
 assert (a->>'confirmed')::int=1 and (a->>'delivered')::int=1 and (a->>'median_first_minutes')::int=20,'agent quality and speed';
 assert (r->'speed'->>'handled')::int=3 and (r->'speed'->>'within_30')::int=1,'first handling speed';
 assert (r->'basket'->>'orders')::int=2 and (r->'basket'->>'avg_total')::numeric=3400 and (r->'basket'->>'multi_unit')::int=1,'basket';
 assert (r->>'delivery_days')::numeric=1.0,'median delivery days';
 assert jsonb_array_length(r->'hours')=24 and (select sum((x->>'orders')::int) from jsonb_array_elements(r->'hours') x)=6,'24 hours cover every order';
 r:=public.crm_report_insights(s,d-2,d,null,'whatsapp');
 assert (r->'funnel'->>'received')::int=1 and (r->'funnel'->>'shipped')::int=0,'channel filter';
 r:=public.crm_report_insights((select v from ins where k='store2'),d-2,d);
 assert (r->'funnel'->>'received')::int=1 and (r->'funnel'->>'shipped')::int=0,'second store isolated';
 begin perform public.crm_report_insights(s,d-400,d);raise exception 'RANGE_UNBOUNDED';exception when others then if sqlerrm<>'INVALID_FILTER' then raise;end if;end;
end $$;
-- Agent: only the orders assigned to them, parcels included.
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$declare r jsonb;s uuid:=(select v from ins where k='store');d date:=(now() at time zone 'Africa/Algiers')::date;begin
 r:=public.crm_report_insights(s,d-2,d);
 assert (r->'funnel'->>'received')::int=1 and (r->'funnel'->>'delivered')::int=1 and (r->'funnel'->>'returned')::int=0,'agent sees own orders only';
 assert jsonb_array_length(r->'reasons')=0,'agent does not see other agents'' losses';
 begin perform public.crm_report_insights(s,d-2,d,'60000000-0000-4000-8000-000000000001');raise exception 'AGENT_FILTER_BYPASS';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
end $$;
-- Another company: no access.
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$declare s uuid:=(select v from ins where k='store');d date:=(now() at time zone 'Africa/Algiers')::date;begin
 begin perform public.crm_report_insights(s,d-2,d);raise exception 'CROSS_TENANT';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
end $$;
select 'Insights checks passed' as verification;
