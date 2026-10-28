-- The operations screen must reach older linked parcels to enter actual ZR fees.
create function public.crm_shipping_page(p_store uuid,p_page integer default 1) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare wid uuid; result jsonb;
begin
 select workspace_id into wid from public.crm_stores where id=p_store;
 if wid is null or not exists(select 1 from public.crm_members where workspace_id=wid and user_id=auth.uid() and active and role in ('owner','admin')) then raise exception 'FORBIDDEN';end if;
 if p_page is null or p_page<1 or p_page>100000 then raise exception 'INVALID_PAGE';end if;
 select jsonb_build_object(
  'total',(select count(*) from public.crm_shipments where store_id=p_store),
  'shipments',coalesce((select jsonb_agg(to_jsonb(q) order by q.sent_at desc,q.id desc) from (
   select s.id,s.order_id,s.reference,s.platform,s.state,s.tracking,s.remote_id,s.raw_status,s.cod_amount,
    s.sent_at,s.last_checked_at,s.last_error,o.number,o.customer_name,o.wilaya,o.commune,o.delivery_type,
    sc.delivery_cost,sc.return_cost,sc.other_cost,
    (select coalesce(jsonb_agg(jsonb_build_object('state',e.state,'raw_status',e.raw_status,'kind',e.kind,'created_at',e.created_at) order by e.id desc),'[]'::jsonb)
     from (select * from public.crm_shipping_events where shipment_id=s.id order by id desc limit 10) e) events
   from public.crm_shipments s join public.crm_orders o on o.id=s.order_id
    left join public.crm_shipment_costs sc on sc.shipment_id=s.id
   where s.store_id=p_store order by s.sent_at desc,s.id desc
   limit 50 offset (p_page-1)*50
  ) q),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.crm_shipping_page(uuid,integer) from public,anon;
grant execute on function public.crm_shipping_page(uuid,integer) to authenticated;
