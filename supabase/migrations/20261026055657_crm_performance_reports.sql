-- Cohort reports: creation date in Algeria; statuses are the current CRM state.
-- This is read-only and runs as the caller, so order RLS also limits agents.
create index crm_orders_report_date_idx on public.crm_orders(store_id,created_at);

create function public.crm_performance(
 p_store uuid,p_from date,p_to date,p_agent uuid default null,p_channel text default null
) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare wid uuid;role_name text;result jsonb;
begin
 if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED';end if;
 select s.workspace_id into wid from public.crm_stores s where s.id=p_store;
 select m.role into role_name from public.crm_members m
 where m.workspace_id=wid and m.user_id=(select auth.uid()) and m.active;
 if role_name is null then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_from<'2000-01-01'::date
    or p_to<p_from or p_to-p_from>365
    or p_to>(now() at time zone 'Africa/Algiers')::date then raise exception 'INVALID_FILTER';end if;
 if p_channel is not null and p_channel not in ('manual','website','whatsapp','messenger','instagram','phone') then raise exception 'INVALID_FILTER';end if;
 if p_agent is not null and (role_name='agent' and p_agent<>(select auth.uid())
   or role_name in ('owner','admin') and not exists(
    select 1 from public.crm_members m where m.workspace_id=wid and m.user_id=p_agent))
 then raise exception 'FORBIDDEN';end if;

 with filtered as materialized (
  select o.id,o.status,o.channel,o.wilaya,o.assigned_to,o.total,
   (o.created_at at time zone 'Africa/Algiers')::date as day
  from public.crm_orders o
  where o.store_id=p_store
   and o.created_at >= (p_from::timestamp at time zone 'Africa/Algiers')
   and o.created_at < ((p_to+1)::timestamp at time zone 'Africa/Algiers')
   and (p_agent is null or o.assigned_to=p_agent)
   and (p_channel is null or o.channel=p_channel)
 ),
 totals as (
  select count(*) as orders,
   count(*) filter(where status='confirmed') as confirmed,
   count(*) filter(where status in ('new','call1','call2','call3','reported','check')) as pending,
   count(*) filter(where status='cancelled') as cancelled,
   count(*) filter(where status='duplicate') as duplicate,
   count(*) filter(where status='fake') as fake,
   coalesce(sum(total) filter(where status='confirmed'),0) as confirmed_amount
  from filtered
 ),
 daily as (
  select day,count(*) as orders,
   count(*) filter(where status='confirmed') as confirmed,
   count(*) filter(where status='cancelled') as cancelled
  from filtered group by day
 )
 select jsonb_build_object(
  'period',jsonb_build_object('from',p_from,'to',p_to,'timezone','Africa/Algiers'),
  'summary',(select to_jsonb(t) from totals t),
  'days',(select coalesce(jsonb_agg(jsonb_build_object(
    'date',g.day::date,'orders',coalesce(d.orders,0),
    'confirmed',coalesce(d.confirmed,0),'cancelled',coalesce(d.cancelled,0)
   ) order by g.day),'[]'::jsonb)
   from generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') g(day)
   left join daily d on d.day=g.day::date),
  'channels',(select coalesce(jsonb_agg(to_jsonb(x) order by x.orders desc,x.channel),'[]'::jsonb) from (
   select channel,count(*) as orders,count(*) filter(where status='confirmed') as confirmed,
    count(*) filter(where status='cancelled') as cancelled,
    coalesce(sum(total) filter(where status='confirmed'),0) as confirmed_amount
   from filtered group by channel
  ) x),
  'wilayas',(select coalesce(jsonb_agg(to_jsonb(x) order by x.orders desc,x.wilaya),'[]'::jsonb) from (
   select wilaya,count(*) as orders,count(*) filter(where status='confirmed') as confirmed,
    coalesce(sum(total) filter(where status='confirmed'),0) as confirmed_amount
   from filtered group by wilaya order by orders desc,wilaya limit 10
  ) x),
  'products',(select coalesce(jsonb_agg(to_jsonb(x) order by x.confirmed_units desc,x.units desc,x.name),'[]'::jsonb) from (
   select i.product_id,p.name,p.sku,count(*) as orders,sum(i.quantity) as units,
    coalesce(sum(i.quantity) filter(where f.status='confirmed'),0) as confirmed_units,
    coalesce(sum(i.quantity*i.unit_price) filter(where f.status='confirmed'),0) as confirmed_lines_amount
   from filtered f join public.crm_order_items i on i.order_id=f.id
    join public.crm_products p on p.id=i.product_id
   group by i.product_id,p.name,p.sku order by confirmed_units desc,units desc,p.name limit 10
  ) x),
  'agents',(select coalesce(jsonb_agg(to_jsonb(x) order by x.orders desc,x.name),'[]'::jsonb) from (
   select f.assigned_to,coalesce(m.display_name,'Non attribué') as name,
    count(*) as orders,count(*) filter(where f.status='confirmed') as confirmed,
    count(*) filter(where f.status='cancelled') as cancelled,
    coalesce(sum(f.total) filter(where f.status='confirmed'),0) as confirmed_amount
   from filtered f left join public.crm_members m on m.workspace_id=wid and m.user_id=f.assigned_to
   group by f.assigned_to,m.display_name
  ) x)
 ) into result;
 return result;
end $$;

revoke all on function public.crm_performance(uuid,date,date,uuid,text) from public,anon;
grant execute on function public.crm_performance(uuid,date,date,uuid,text) to authenticated;
