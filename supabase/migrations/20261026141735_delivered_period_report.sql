-- Delivery-date report: current ZR delivered state and verified delivery timestamp,
-- independently of the order-creation cohort used by crm_delivery_performance.
create index crm_shipments_delivered_period_idx
 on public.crm_shipments(store_id,delivered_at desc,id desc) where state='delivered';

create function public.crm_delivered_period_page(
 p_store uuid,p_from date,p_to date,p_agent uuid default null,p_channel text default null,p_page integer default 1
) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare wid uuid;result jsonb;
begin
 select workspace_id into wid from public.crm_stores where id=p_store;
 if wid is null or not exists(select 1 from public.crm_members
  where workspace_id=wid and user_id=(select auth.uid()) and active and role in ('owner','admin'))
 then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_from<'2000-01-01'::date or p_to<p_from or p_to-p_from>365
  or p_to>(now() at time zone 'Africa/Algiers')::date
  or p_page is null or p_page<1 or p_page>100000
  or (p_channel is not null and p_channel not in ('manual','website','whatsapp','messenger','instagram','phone'))
 then raise exception 'INVALID_FILTER';end if;
 if p_agent is not null and not exists(select 1 from public.crm_members
  where workspace_id=wid and user_id=p_agent) then raise exception 'FORBIDDEN';end if;

 with filtered as materialized (
  select s.id,s.order_id,s.state,s.cod_amount,s.tracking,s.delivered_at,
   o.number,o.woo_number,o.customer_name,o.wilaya,o.channel,o.assigned_to,o.created_at
  from public.crm_shipments s join public.crm_orders o on o.id=s.order_id
  where s.store_id=p_store and s.state='delivered'
   and s.delivered_at>=(p_from::timestamp at time zone 'Africa/Algiers')
   and s.delivered_at<((p_to+1)::timestamp at time zone 'Africa/Algiers')
   and (p_channel is null or o.channel=p_channel)
   and (p_agent is null or o.assigned_to=p_agent)
 )
 select jsonb_build_object(
  'period',jsonb_build_object('from',p_from,'to',p_to,'timezone','Africa/Algiers','basis','delivered_at'),
  'total',(select count(*) from filtered),
  'orders',coalesce((select jsonb_agg(to_jsonb(q) order by q.delivered_at desc,q.id desc)
   from (select * from filtered order by delivered_at desc,id desc limit 20 offset (p_page-1)*20) q),'[]'::jsonb))
 into result;
 return result;
end $$;
revoke all on function public.crm_delivered_period_page(uuid,date,date,uuid,text,integer) from public,anon;
grant execute on function public.crm_delivered_period_page(uuid,date,date,uuid,text,integer) to authenticated;
