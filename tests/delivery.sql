-- Execute inside BEGIN/ROLLBACK; no real ZR requests and no persistent data.
reset role;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous) values
 ('50000000-0000-4000-8000-000000000001','delivery-owner@weconvert.invalid',now(),'{}','{}',false),
 ('50000000-0000-4000-8000-000000000002','delivery-agent@weconvert.invalid',now(),'{}','{}',false);
create temp table delivery_fixture(k text primary key,v uuid);
grant select,insert on delivery_fixture to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into delivery_fixture values('workspace',public.crm_bootstrap('Delivery test','Book shop','Owner test',gen_random_uuid()));
insert into delivery_fixture select 'store',id from public.crm_stores where workspace_id=(select v from delivery_fixture where k='workspace');
set local role service_role;
insert into public.crm_members(workspace_id,user_id,display_name,role)
 values((select v from delivery_fixture where k='workspace'),'50000000-0000-4000-8000-000000000002','Agent delivery','agent');
insert into public.crm_products(workspace_id,store_id,name,sku,price,stock)
 values((select v from delivery_fixture where k='workspace'),(select v from delivery_fixture where k='store'),'Test product','BOOK-1',2000,10);
insert into delivery_fixture select 'product',id from public.crm_products where store_id=(select v from delivery_fixture where k='store');
insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,channel,status,total,created_by,woo_number,woo_snapshot) values
 ((select v from delivery_fixture where k='workspace'),(select v from delivery_fixture where k='store'),'Client livré','+213555000010','Alger','website','confirmed',2400,'50000000-0000-4000-8000-000000000001','345','{"external_id":345}'),
 ((select v from delivery_fixture where k='workspace'),(select v from delivery_fixture where k='store'),'Client retour','+213555000011','Oran','website','confirmed',2000,'50000000-0000-4000-8000-000000000001','346','{"external_id":346}');
insert into delivery_fixture select 'delivered',id from public.crm_orders where woo_number='345' and store_id=(select v from delivery_fixture where k='store');
insert into delivery_fixture select 'returned',id from public.crm_orders where woo_number='346' and store_id=(select v from delivery_fixture where k='store');
insert into public.crm_order_items(workspace_id,store_id,order_id,product_id,product_name,sku,quantity,unit_price)
 select o.workspace_id,o.store_id,o.id,(select v from delivery_fixture where k='product'),'Test product','BOOK-1',1,2000 from public.crm_orders o where o.id=(select v from delivery_fixture where k='delivered');
insert into public.crm_shipping_connections(workspace_id,store_id,platform,created_by)
 values((select v from delivery_fixture where k='workspace'),(select v from delivery_fixture where k='store'),'new','50000000-0000-4000-8000-000000000001');
insert into delivery_fixture select 'connection',id from public.crm_shipping_connections where store_id=(select v from delivery_fixture where k='store');
do $$declare c uuid:=(select v from delivery_fixture where k='connection');o uuid:=(select v from delivery_fixture where k='delivered');a uuid:='50000000-0000-4000-8000-000000000001';r text;begin
 r:=public.crm_zr_import_link(c,o,'{"external_id":"345","remote_id":"50000000-0000-4000-8000-000000000010","tracking":"16-ABC-ZR","phone":"+213555000010","amount":2400,"state":"delivered","raw_status":"Livrée"}',a);
 assert r='linked','historical parcel linked';
 r:=public.crm_zr_import_link(c,o,'{"external_id":"345","remote_id":"50000000-0000-4000-8000-000000000010","tracking":"16-ABC-ZR","phone":"+213555000010","amount":2400,"state":"delivered","raw_status":"Livrée"}',a);
 assert r='unchanged','replay idempotent';
 begin perform public.crm_zr_import_link(c,o,'{"external_id":"345","remote_id":"50000000-0000-4000-8000-000000000011","tracking":"16-ABC2-ZR","phone":"+213555000010","amount":2400,"state":"delivered","raw_status":"Livrée"}',a);
 raise exception 'DUPLICATE_LINK';exception when others then if sqlerrm<>'ALREADY_SENT' then raise;end if;end;
 begin perform public.crm_zr_import_link(c,(select v from delivery_fixture where k='returned'),'{"external_id":"346","remote_id":"50000000-0000-4000-8000-000000000012","tracking":"16-DEF-ZR","phone":"+213555000011","amount":2500,"state":"returned","raw_status":"Retourné"}',a);
 raise exception 'AMOUNT_MISMATCH';exception when others then if sqlerrm<>'PARCEL_MISMATCH' then raise;end if;end;
 r:=public.crm_zr_import_link(c,(select v from delivery_fixture where k='returned'),'{"external_id":"346","remote_id":"50000000-0000-4000-8000-000000000012","tracking":"16-DEF-ZR","phone":"+213555000011","amount":2000,"state":"returned","raw_status":"Retourné"}',a);
 assert r='linked','returned parcel linked';
end $$;
update public.crm_orders set assigned_to='50000000-0000-4000-8000-000000000001'
 where id=(select v from delivery_fixture where k='delivered');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare s uuid:=(select v from delivery_fixture where k='store');d date:=(now() at time zone 'Africa/Algiers')::date;r jsonb;begin
 r:=public.crm_shipping_page(s,1);
 assert (r->>'total')::int=2 and jsonb_array_length(r->'shipments')=2,'all linked parcels accessible to managers';
 r:=public.crm_shipping_page(s,2);
 assert jsonb_array_length(r->'shipments')=0,'older pages are bounded';
 r:=public.crm_shipping_filtered_page(s,1,'delivered');
 assert (r->>'total')::int=1 and (r->'shipments'->0->>'state')='delivered','delivered filter reads carrier outcome';
 assert (r->'shipments'->0->>'woo_number')='345','Woo reference visible on delivered row';
 r:=public.crm_shipping_filtered_page(s,1,'returned');
 assert (r->>'total')::int=1 and (r->'shipments'->0->>'state')='returned','returned orders excluded from delivered';
 r:=public.crm_shipping_filtered_page(s,1,'other');
 assert (r->>'total')::int=0,'other statuses are separated';
 r:=public.crm_delivered_period_page(s,d,d);
 assert (r->>'total')::int=1 and (r->'orders'->0->>'woo_number')='345','order-created cohort returns linked Woo order';
 assert (r->'period'->>'basis')='created_at','metric is dated by order creation';
 assert r->'orders'->0 ? 'created_at' and not (r->'orders'->0 ? 'delivered_at'),'last ZR state date is not exported as delivery date';
 r:=public.crm_delivered_period_page(s,d-1,d-1);
 assert (r->>'total')::int=0,'order-created cohort excludes orders created outside range';
 r:=public.crm_delivered_period_page(s,d,d,null,'whatsapp');
 assert (r->>'total')::int=0,'channel filter applies to delivered period';
 r:=public.crm_delivered_period_page(s,d,d,'50000000-0000-4000-8000-000000000001','website');
 assert (r->>'total')::int=1,'agent and channel filters apply together';
 r:=public.crm_delivered_period_page(s,d,d,null,null,2);
 assert (r->>'total')::int=1 and jsonb_array_length(r->'orders')=0,'delivery period page is bounded';
 r:=public.crm_delivery_performance(s,d,d);
 assert (r->'summary'->>'delivered')::int=1 and (r->'summary'->>'returned')::int=1,'ZR outcome not Woo status';
 assert (r->'summary'->>'delivered_cod')::numeric=2400,'COD delivered only';
 assert r->'summary'->'contribution'='null'::jsonb,'missing costs suppress margin';
 perform public.crm_cost_command(s,'product',jsonb_build_object('product_id',(select v from delivery_fixture where k='product'),'unit_cost',1200));
 perform public.crm_cost_command(s,'shipment',jsonb_build_object('shipment_id',(select id from public.crm_shipments where order_id=(select v from delivery_fixture where k='delivered')),'delivery_cost',350,'return_cost',0,'other_cost',0));
 perform public.crm_cost_command(s,'shipment',jsonb_build_object('shipment_id',(select id from public.crm_shipments where order_id=(select v from delivery_fixture where k='returned')),'delivery_cost',350,'return_cost',100,'other_cost',0));
 perform public.crm_cost_command(s,'expense',jsonb_build_object('spent_on',d,'kind','ads','amount',200,'note','Test'));
 r:=public.crm_delivery_performance(s,d,d);
 assert (r->'summary'->>'contribution')::numeric=400,'COD − COGS − both delivery fees − return fee';
 assert (r->'summary'->>'after_recorded_expenses')::numeric=200,'recorded ads separated';
 r:=public.crm_delivery_performance(s,d,d,'website');
 assert r->'summary'->'after_recorded_expenses'='null'::jsonb,'store expenses cannot imply channel profit';
end $$;
set local role service_role;
-- Imported ZR financial timestamps can fall on a different day than order
-- creation; the two reports must still use the same cohort.
update public.crm_orders set created_at=((now() at time zone 'Africa/Algiers')::date-1)::timestamp at time zone 'Africa/Algiers'
 where id=(select v from delivery_fixture where k='delivered');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare s uuid:=(select v from delivery_fixture where k='store');d date:=(now() at time zone 'Africa/Algiers')::date;r jsonb;begin
 r:=public.crm_delivered_period_page(s,d,d);
 assert (r->>'total')::int=0,'today excludes yesterday order despite ZR terminal state today';
 r:=public.crm_delivered_period_page(s,d-1,d-1);
 assert (r->>'total')::int=1,'yesterday includes delivered order created yesterday';
 r:=public.crm_delivery_performance(s,d-1,d-1);
 assert (r->'summary'->>'delivered')::int=1,'finance and delivery listing use the same order-created cohort';
end $$;
set local role service_role;
update public.crm_orders set created_at=now() where id=(select v from delivery_fixture where k='delivered');
update public.crm_shipments set state='delivered' where order_id=(select v from delivery_fixture where k='returned');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare s uuid:=(select v from delivery_fixture where k='store');d date:=(now() at time zone 'Africa/Algiers')::date;r jsonb;begin
 r:=public.crm_delivery_performance(s,d,d);
 assert (r->'summary'->>'missing_product_cost')::int=1,'delivered order without items lacks COGS';
 assert r->'summary'->'contribution'='null'::jsonb,'no items suppress margin';
end $$;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$declare s uuid:=(select v from delivery_fixture where k='store');d date:=(now() at time zone 'Africa/Algiers')::date;begin
 assert (select count(*)=0 from public.crm_product_costs),'agents cannot see costs';
 begin perform public.crm_delivery_performance(s,d,d);raise exception 'AGENT_REPORT';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 begin perform public.crm_shipping_page(s,1);raise exception 'AGENT_SHIPPING_PAGE';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 begin perform public.crm_shipping_filtered_page(s,1,'delivered');raise exception 'AGENT_FILTERED_SHIPPING';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 begin perform public.crm_delivered_period_page(s,d,d);raise exception 'AGENT_DELIVERED_REPORT';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 begin perform public.crm_cost_command(s,'product',jsonb_build_object('product_id',(select v from delivery_fixture where k='product'),'unit_cost',0));raise exception 'AGENT_WRITE';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
end $$;
select 'Delivery and margin checks passed' as verification;
