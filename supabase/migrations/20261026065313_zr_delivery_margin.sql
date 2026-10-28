-- Delivery outcome and transparent contribution margin. Costs are manager-only.
alter table public.crm_shipments
 add column source text not null default 'weconvert' check (source in ('weconvert','zr_import')),
 add column delivered_at timestamptz;
create unique index crm_shipments_remote_id_unique on public.crm_shipments(connection_id,remote_id) where remote_id is not null;
create function crm_private.mark_zr_delivery() returns trigger language plpgsql set search_path='' as $$
begin
 if new.state='delivered' and (old.state is distinct from 'delivered' or old.delivered_at is null) then
  new.delivered_at:=coalesce(new.delivered_at,now());
 end if;
 return new;
end $$;
create trigger crm_shipments_delivered_at before update on public.crm_shipments
 for each row execute function crm_private.mark_zr_delivery();

create table public.crm_product_costs(
 product_id uuid primary key references public.crm_products(id) on delete cascade,
 workspace_id uuid not null,store_id uuid not null,unit_cost numeric(14,2) not null check(unit_cost>=0),
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),
 foreign key(workspace_id,store_id,product_id) references public.crm_products(workspace_id,store_id,id)
);
create index crm_product_costs_actor_idx on public.crm_product_costs(updated_by);
create table public.crm_shipment_costs(
 shipment_id uuid primary key references public.crm_shipments(id) on delete cascade,
 workspace_id uuid not null,store_id uuid not null,
 delivery_cost numeric(14,2) not null check(delivery_cost>=0),
 return_cost numeric(14,2) not null default 0 check(return_cost>=0),
 other_cost numeric(14,2) not null default 0 check(other_cost>=0),
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),
 foreign key(workspace_id,store_id) references public.crm_stores(workspace_id,id)
);
create index crm_shipment_costs_actor_idx on public.crm_shipment_costs(updated_by);
create table public.crm_cost_entries(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,store_id uuid not null,
 spent_on date not null,kind text not null check(kind in ('ads','operations')),
 amount numeric(14,2) not null check(amount>=0),note text not null default '' check(length(note)<=160),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(workspace_id,store_id) references public.crm_stores(workspace_id,id)
);
create index crm_cost_entries_store_date_idx on public.crm_cost_entries(store_id,spent_on);
create index crm_cost_entries_actor_idx on public.crm_cost_entries(created_by);
alter table public.crm_product_costs enable row level security;
alter table public.crm_shipment_costs enable row level security;
alter table public.crm_cost_entries enable row level security;
create policy crm_product_costs_read on public.crm_product_costs for select to authenticated using(crm_private.member_role(workspace_id) in ('owner','admin'));
create policy crm_shipment_costs_read on public.crm_shipment_costs for select to authenticated using(crm_private.member_role(workspace_id) in ('owner','admin'));
create policy crm_cost_entries_read on public.crm_cost_entries for select to authenticated using(crm_private.member_role(workspace_id) in ('owner','admin'));
revoke all on public.crm_product_costs,public.crm_shipment_costs,public.crm_cost_entries from public,anon,authenticated;
grant select on public.crm_product_costs,public.crm_shipment_costs,public.crm_cost_entries to authenticated;

create function crm_private.cost_command(p_store uuid,p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare wid uuid;uid uuid:=auth.uid();v numeric(14,2);r jsonb;
begin
 select workspace_id into wid from public.crm_stores where id=p_store;
 if uid is null or wid is null or not exists(select 1 from public.crm_members where workspace_id=wid and user_id=uid and active and role in ('owner','admin')) then raise exception 'FORBIDDEN';end if;
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>2000 then raise exception 'INVALID_REQUEST';end if;
 if p_action='product' then
  v:=(p->>'unit_cost')::numeric;
  if v<0 or v>100000000 or v is null then raise exception 'INVALID_COST';end if;
  if not exists(select 1 from public.crm_products where id=(p->>'product_id')::uuid and store_id=p_store) then raise exception 'NOT_FOUND';end if;
  insert into public.crm_product_costs(product_id,workspace_id,store_id,unit_cost,updated_by)
   values((p->>'product_id')::uuid,wid,p_store,v,uid)
   on conflict(product_id) do update set unit_cost=excluded.unit_cost,updated_by=uid,updated_at=now();
 elsif p_action='shipment' then
  if not exists(select 1 from public.crm_shipments where id=(p->>'shipment_id')::uuid and store_id=p_store) then raise exception 'NOT_FOUND';end if;
  if (p->>'delivery_cost')::numeric<0 or (p->>'delivery_cost')::numeric>100000000 or
     (p->>'return_cost')::numeric<0 or (p->>'return_cost')::numeric>100000000 or
     (p->>'other_cost')::numeric<0 or (p->>'other_cost')::numeric>100000000 or
     p->>'delivery_cost' is null or p->>'return_cost' is null or p->>'other_cost' is null then raise exception 'INVALID_COST';end if;
  insert into public.crm_shipment_costs(shipment_id,workspace_id,store_id,delivery_cost,return_cost,other_cost,updated_by)
   values((p->>'shipment_id')::uuid,wid,p_store,(p->>'delivery_cost')::numeric,(p->>'return_cost')::numeric,(p->>'other_cost')::numeric,uid)
   on conflict(shipment_id) do update set delivery_cost=excluded.delivery_cost,return_cost=excluded.return_cost,other_cost=excluded.other_cost,updated_by=uid,updated_at=now();
 elsif p_action='expense' then
  v:=(p->>'amount')::numeric;
  if v<0 or v>100000000 or v is null or (p->>'spent_on')::date>(now() at time zone 'Africa/Algiers')::date or
    p->>'kind' not in ('ads','operations') or length(coalesce(p->>'note',''))>160 then raise exception 'INVALID_COST';end if;
  insert into public.crm_cost_entries(workspace_id,store_id,spent_on,kind,amount,note,created_by)
   values(wid,p_store,(p->>'spent_on')::date,p->>'kind',v,coalesce(p->>'note',''),uid);
 elsif p_action='delete_expense' then
  delete from public.crm_cost_entries where id=(p->>'id')::uuid and store_id=p_store;
  if not found then raise exception 'NOT_FOUND';end if;
 else raise exception 'INVALID_REQUEST';end if;
 return '{}'::jsonb;
end $$;
-- Only this checked RPC can write; exposed tables remain read-only for clients.
create function public.crm_cost_command(p_store uuid,p_action text,p jsonb) returns jsonb
language sql security invoker set search_path='' as $$select crm_private.cost_command(p_store,p_action,p)$$;
revoke all on function crm_private.cost_command(uuid,text,jsonb),public.crm_cost_command(uuid,text,jsonb) from public,anon;
grant execute on function crm_private.cost_command(uuid,text,jsonb),public.crm_cost_command(uuid,text,jsonb) to authenticated;

create function crm_private.zr_import_link(p_connection uuid,p_order uuid,p jsonb,p_actor uuid) returns text
language plpgsql security definer set search_path='' as $$
declare c public.crm_shipping_connections;o public.crm_orders;s public.crm_shipments;
 remote_ref text;remote_id text;remote_phone text;remote_amount numeric;state_name text;
begin
 select * into c from public.crm_shipping_connections where id=p_connection and active;
 if c.id is null or not exists(select 1 from public.crm_members where workspace_id=c.workspace_id and user_id=p_actor and active and role in ('owner','admin')) then raise exception 'FORBIDDEN';end if;
 select * into o from public.crm_orders where id=p_order and store_id=c.store_id and woo_number is not null for share;
 if o.id is null then raise exception 'NOT_FOUND';end if;
 remote_ref:=trim(coalesce(p->>'external_id',''));remote_id:=trim(coalesce(p->>'remote_id',''));
 if remote_ref not in (o.woo_number,coalesce(o.woo_snapshot->>'external_id','')) or remote_ref='' or
  remote_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 then raise exception 'REFERENCE_MISMATCH';end if;
 remote_phone:=crm_private.normalize_phone(p->>'phone');
 remote_amount:=(p->>'amount')::numeric;
 if remote_phone<>o.phone or remote_amount is null or remote_amount<>o.total then raise exception 'PARCEL_MISMATCH';end if;
 state_name:=p->>'state';
 if state_name not in ('submitted','in_transit','out_for_delivery','ready_for_pickup','delivered','failed_delivery','returning','returned','cancelled','exception','unknown') or
   length(trim(coalesce(p->>'tracking','')))<3 then raise exception 'INVALID_REQUEST';end if;
 select * into s from public.crm_shipments where order_id=o.id for update;
 if s.id is not null and (s.source<>'zr_import' or s.remote_id<>remote_id or s.connection_id<>c.id) then raise exception 'ALREADY_SENT';end if;
 if s.id is null then
  insert into public.crm_shipments(workspace_id,store_id,order_id,connection_id,reference,platform,source,state,tracking,remote_id,raw_status,cod_amount,sent_by,sent_at,last_checked_at,delivered_at)
  values(o.workspace_id,o.store_id,o.id,c.id,remote_ref,c.platform,'zr_import',state_name,left(p->>'tracking',100),remote_id,left(p->>'raw_status',200),
    remote_amount,p_actor,coalesce((p->>'created_at')::timestamptz,now()),now(),case when state_name='delivered' then coalesce((p->>'updated_at')::timestamptz,now()) end)
   returning * into s;
  insert into public.crm_shipping_events(shipment_id,workspace_id,store_id,order_id,state,raw_status,kind)
   values(s.id,s.workspace_id,s.store_id,s.order_id,state_name,left(p->>'raw_status',200),'import.linked');
  return 'linked';
 end if;
 if s.state is distinct from state_name or s.raw_status is distinct from left(p->>'raw_status',200) then
  update public.crm_shipments set state=state_name,raw_status=left(p->>'raw_status',200),tracking=left(p->>'tracking',100),
   last_checked_at=now(),updated_at=now(),
   delivered_at=case when state_name='delivered' then coalesce((p->>'updated_at')::timestamptz,now()) else delivered_at end where id=s.id;
  insert into public.crm_shipping_events(shipment_id,workspace_id,store_id,order_id,state,raw_status,kind)
   values(s.id,s.workspace_id,s.store_id,s.order_id,state_name,left(p->>'raw_status',200),'status.changed');
  return 'updated';
 end if;
 update public.crm_shipments set last_checked_at=now() where id=s.id;
 return 'unchanged';
end $$;
create function public.crm_zr_import_link(p_connection uuid,p_order uuid,p jsonb,p_actor uuid) returns text
language sql security invoker set search_path='' as $$select crm_private.zr_import_link(p_connection,p_order,p,p_actor)$$;
revoke all on function crm_private.zr_import_link(uuid,uuid,jsonb,uuid),public.crm_zr_import_link(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function crm_private.zr_import_link(uuid,uuid,jsonb,uuid),public.crm_zr_import_link(uuid,uuid,jsonb,uuid) to service_role;

create function public.crm_delivery_performance(p_store uuid,p_from date,p_to date,p_channel text default null) returns jsonb
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
   count(*) filter(where state='delivered' and missing_items>0) missing_product_cost,
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
   'after_recorded_expenses',case when t.missing_product_cost=0 and t.missing_shipping_cost=0 then
    t.delivered_cod-t.known_product_cost-t.known_shipping_cost-e.ads-e.operations else null end,
   'ads_recorded',e.ads,'operations_recorded',e.operations),
  'channels',(select coalesce(jsonb_agg(to_jsonb(c) order by c.orders desc),'[]'::jsonb) from channels c))
 into result from totals t cross join spend e;
 return result;
end $$;
revoke all on function public.crm_delivery_performance(uuid,date,date,text) from public,anon;
grant execute on function public.crm_delivery_performance(uuid,date,date,text) to authenticated;
