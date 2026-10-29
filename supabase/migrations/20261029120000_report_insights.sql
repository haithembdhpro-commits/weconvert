-- Rapport « Performance » complet (29/10/2026) : parcours des commandes jusqu'à la livraison, motifs de perte,
-- wilayas (livraison et retours), qualité et rapidité des agents, panier moyen, heures des commandes.
-- Même périmètre et mêmes règles que crm_performance : commandes créées dans la période (heure d'Alger),
-- boutique choisie, RLS appliquée (SECURITY INVOKER : un agent ne lit que ses commandes et leurs colis).
-- Statuts hérités de WooCommerce (status_origin = 'woo_legacy') : jamais comptés comme décisions vérifiées.
-- « Expédiée » = colis remis à ZR ; « livrée / retournée » = dernier état ZR connu, pas un encaissement.
create or replace function public.crm_report_insights(p_store uuid, p_from date, p_to date, p_agent uuid default null, p_channel text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare wid uuid; role_name text; result jsonb;
begin
 if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
 select s.workspace_id into wid from public.crm_stores s where s.id=p_store;
 select m.role into role_name from public.crm_members m where m.workspace_id=wid and m.user_id=(select auth.uid()) and m.active;
 if role_name is null then raise exception 'FORBIDDEN'; end if;
 if p_from is null or p_to is null or p_from<'2000-01-01'::date or p_to<p_from or p_to-p_from>365
    or p_to>(now() at time zone 'Africa/Algiers')::date then raise exception 'INVALID_FILTER'; end if;
 if p_channel is not null and p_channel not in ('manual','website','whatsapp','messenger','instagram','phone') then raise exception 'INVALID_FILTER'; end if;
 if p_agent is not null and (role_name='agent' and p_agent<>(select auth.uid())
   or role_name in ('owner','admin') and not exists(select 1 from public.crm_members m where m.workspace_id=wid and m.user_id=p_agent))
 then raise exception 'FORBIDDEN'; end if;

 with filtered as materialized (
  select o.id, o.status, o.status_origin, o.wilaya, o.assigned_to, o.total, o.attempts, o.created_at,
   o.status_origin is distinct from 'woo_legacy' as verified,
   s.state, s.cod_amount, s.sent_at, s.delivered_at,
   s.id is not null and s.state not in ('sending','needs_review','cancelled','submitted') as shipped
  from public.crm_orders o
  left join public.crm_shipments s on s.order_id=o.id
  where o.store_id=p_store
   and o.created_at >= (p_from::timestamp at time zone 'Africa/Algiers')
   and o.created_at < ((p_to+1)::timestamp at time zone 'Africa/Algiers')
   and (p_agent is null or o.assigned_to=p_agent)
   and (p_channel is null or o.channel=p_channel)
 ),
 -- First handling of each order (call without answer, status change or callback), whoever did it.
 touched as materialized (
  select f.id, f.assigned_to,
   (select min(e.created_at) from public.crm_events e
     where e.order_id=f.id and e.kind in ('order.call','order.status','order.callback')) as first_at,
   f.created_at
  from filtered f where f.verified
 ),
 lost as (
  select f.status,
   coalesce(nullif(trim((select e.data->>'reason' from public.crm_events e
     where e.order_id=f.id and e.kind='order.status' and e.data->>'to'=f.status order by e.id desc limit 1)),''),'') as reason
  from filtered f where f.verified and f.status in ('cancelled','fake','duplicate')
 ),
 lines as (
  select f.id, sum(i.quantity) as units, count(*) as products
  from filtered f join public.crm_order_items i on i.order_id=f.id
  where f.verified and f.status='confirmed' group by f.id
 )
 select jsonb_build_object(
  'period', jsonb_build_object('from',p_from,'to',p_to,'timezone','Africa/Algiers'),
  'funnel', (select jsonb_build_object(
    'received', count(*),
    'rate_base', count(*) filter(where verified),
    'confirmed', count(*) filter(where verified and status='confirmed'),
    'shipped', count(*) filter(where shipped),
    'delivered', count(*) filter(where state='delivered'),
    'returned', count(*) filter(where state='returned'),
    'in_progress', count(*) filter(where shipped and state not in ('delivered','returned')),
    'delivered_cod', coalesce(sum(cod_amount) filter(where state='delivered'),0),
    'lost', count(*) filter(where verified and status in ('cancelled','fake','duplicate')),
    'pending', count(*) filter(where status in ('new','call1','call2','call3','reported','check'))
   ) from filtered),
  'reasons', (select coalesce(jsonb_agg(to_jsonb(x) order by x.orders desc, x.status, x.reason),'[]'::jsonb) from (
    select status, reason, count(*) as orders from lost group by status, reason order by count(*) desc, status, reason limit 30
   ) x),
  'wilayas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.orders desc, x.wilaya),'[]'::jsonb) from (
    select wilaya, count(*) as orders,
     count(*) filter(where verified) as rate_base,
     count(*) filter(where verified and status='confirmed') as confirmed,
     count(*) filter(where shipped) as shipped,
     count(*) filter(where state='delivered') as delivered,
     count(*) filter(where state='returned') as returned,
     coalesce(sum(cod_amount) filter(where state='delivered'),0) as delivered_cod,
     round((avg(extract(epoch from delivered_at-sent_at)/86400) filter(where state='delivered' and delivered_at>=sent_at))::numeric,1) as avg_days
    from filtered group by wilaya
   ) x),
  'agents', (select coalesce(jsonb_agg(to_jsonb(x) order by x.orders desc, x.name),'[]'::jsonb) from (
    select f.assigned_to, coalesce(m.display_name,'Non attribué') as name,
     count(*) as orders,
     count(*) filter(where f.verified) as rate_base,
     count(*) filter(where f.verified and f.status='confirmed') as confirmed,
     count(*) filter(where f.state='delivered') as delivered,
     count(*) filter(where f.state='returned') as returned,
     round((avg(f.attempts) filter(where f.verified))::numeric,1) as avg_no_answer,
     (select round((percentile_cont(0.5) within group (order by extract(epoch from t.first_at-t.created_at)/60))::numeric)
       from touched t where t.assigned_to is not distinct from f.assigned_to and t.first_at is not null) as median_first_minutes
    from filtered f left join public.crm_members m on m.workspace_id=wid and m.user_id=f.assigned_to
    group by f.assigned_to, m.display_name
   ) x),
  'speed', (select jsonb_build_object(
    'median_first_minutes', round((percentile_cont(0.5) within group (order by extract(epoch from first_at-created_at)/60))::numeric),
    'within_30', count(*) filter(where first_at-created_at <= interval '30 minutes'),
    'handled', count(*)
   ) from touched where first_at is not null),
  'basket', (select jsonb_build_object(
    'orders', count(*),
    'avg_total', round(avg(f.total)::numeric),
    'avg_units', round(avg(l.units)::numeric,2),
    'multi_unit', count(*) filter(where l.units>1),
    'multi_product', count(*) filter(where l.products>1)
   ) from filtered f left join lines l on l.id=f.id where f.verified and f.status='confirmed'),
  'delivery_days', (select round((percentile_cont(0.5) within group (order by extract(epoch from delivered_at-sent_at)/86400))::numeric,1)
   from filtered where state='delivered' and delivered_at>=sent_at),
  'hours', (select coalesce(jsonb_agg(jsonb_build_object('hour',h,'orders',coalesce(c.n,0)) order by h),'[]'::jsonb)
   from generate_series(0,23) h left join (
    select extract(hour from created_at at time zone 'Africa/Algiers')::int as hr, count(*) as n from filtered group by 1
   ) c on c.hr=h)
 ) into result;
 return result;
end $$;
revoke all on function public.crm_report_insights(uuid,date,date,uuid,text) from public, anon;
grant execute on function public.crm_report_insights(uuid,date,date,uuid,text) to authenticated;
