-- A channel has no allocated advertising/operating expense; do not imply channel profit.
-- Orders without catalog lines cannot have a known product cost.
create or replace function public.crm_delivery_performance(p_store uuid,p_from date,p_to date,p_channel text default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare wid uuid;result jsonb;
begin
 select workspace_id into wid from public.crm_stores where id=p_store;
 if wid is null or not exists(select 1 from public.crm_members where workspace_id=wid and user_id=auth.uid() and active and role in ('owner','admin')) then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 or p_to>(now() at time zone 'Africa/Algiers')::date
  or p_channel is not null and p_channel not in ('manual','website','whatsapp','messenger','instagram','phone') then raise exception 'INVALID_FILTER';end if;
 with cohort as materialized (
  select o.id,o.channel,o.woo_number,o.wilaya,o.total,s.id shipment_id,s.state,s.cod_amount,
   sc.delivery_cost,sc.return_cost,sc.other_cost,
   (select sum(i.quantity*pc.unit_cost) from public.crm_order_items i
     left join public.crm_product_costs pc on pc.product_id=i.product_id where i.order_id=o.id) as product_cost,
   (select count(*) from public.crm_order_items i left join public.crm_product_costs pc on pc.product_id=i.product_id
    where i.order_id=o.id and pc.unit_cost is null) as missing_items
  from public.crm_orders o left join public.crm_shipments s on s.order_id=o.id
   left join public.crm_shipment_costs sc on sc.shipment_id=s.id
  where o.store_id=p_store and o.created_at>=p_from::timestamp at time zone 'Africa/Algiers'
   and o.created_at<(p_to+1)::timestamp at time zone 'Africa/Algiers'
   and (p_channel is null or o.channel=p_channel)
 ), totals as (
  select count(*) orders,count(*) filter(where woo_number is not null) woo_orders,
   count(*) filter(where shipment_id is not null) shipped,
   count(*) filter(where state='delivered') delivered,
   count(*) filter(where state='delivered' and woo_number is not null) woo_delivered,
   count(*) filter(where state='returned') returned,
   count(*) filter(where state in ('returning','failed_delivery')) delivery_issues,
   coalesce(sum(cod_amount) filter(where state='delivered'),0) delivered_cod,
   coalesce(sum(product_cost) filter(where state='delivered' and missing_items=0),0) known_product_cost,
   coalesce(sum(delivery_cost+return_cost+other_cost) filter(where shipment_id is not null and delivery_cost is not null),0) known_shipping_cost,
   count(*) filter(where state='delivered' and (missing_items>0 or product_cost is null)) missing_product_cost,
   count(*) filter(where shipment_id is not null and delivery_cost is null) missing_shipping_cost
  from cohort
 ), spend as (
  select coalesce(sum(amount) filter(where kind='ads'),0) ads,
   coalesce(sum(amount) filter(where kind='operations'),0) operations
  from public.crm_cost_entries where store_id=p_store and spent_on between p_from and p_to
 ), channels as (
  select channel,count(*) orders,count(*) filter(where shipment_id is not null) shipped,
   count(*) filter(where state='delivered') delivered,count(*) filter(where state='returned') returned,
   coalesce(sum(cod_amount) filter(where state='delivered'),0) delivered_cod
  from cohort group by channel
 )
 select jsonb_build_object('period',jsonb_build_object('from',p_from,'to',p_to,'timezone','Africa/Algiers'),
  'summary',to_jsonb(t)||jsonb_build_object(
   'contribution',case when t.missing_product_cost=0 and t.missing_shipping_cost=0 then
    t.delivered_cod-t.known_product_cost-t.known_shipping_cost else null end,
   'after_recorded_expenses',case when p_channel is null and t.missing_product_cost=0 and t.missing_shipping_cost=0 then
    t.delivered_cod-t.known_product_cost-t.known_shipping_cost-e.ads-e.operations else null end,
   'ads_recorded',e.ads,'operations_recorded',e.operations),
  'channels',(select coalesce(jsonb_agg(to_jsonb(c) order by c.orders desc),'[]'::jsonb) from channels c))
 into result from totals t cross join spend e;
 return result;
end $$;
