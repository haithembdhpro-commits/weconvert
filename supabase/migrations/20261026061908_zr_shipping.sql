-- ZR Express: one connection per store, one irreversible send reservation per order.
-- Customer details are fetched from the order at dispatch; credentials live only in Vault.
create table public.crm_shipping_connections (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null unique,
 provider text not null default 'zr' check(provider='zr'), platform text not null check(platform in ('legacy','new')),
 source_hub_id uuid, active boolean not null default true, generation integer not null default 1,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), last_test_at timestamptz,
 foreign key(workspace_id,store_id) references public.crm_stores(workspace_id,id),
 unique(workspace_id,store_id,id)
);
create index crm_shipping_connections_actor_idx on public.crm_shipping_connections(created_by);
create table crm_private.zr_credentials (
 connection_id uuid primary key references public.crm_shipping_connections(id), secret_id uuid not null
);
alter table crm_private.zr_credentials enable row level security;
revoke all on crm_private.zr_credentials from public,anon,authenticated;

create table public.crm_shipments (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null,store_id uuid not null,
 order_id uuid not null unique,connection_id uuid not null,reference text not null,
 platform text not null check(platform in ('legacy','new')),
 state text not null default 'sending' check(state in ('sending','needs_review','submitted','in_transit','out_for_delivery','ready_for_pickup','delivered','failed_delivery','returning','returned','cancelled','exception','unknown')),
 tracking text,remote_id text,raw_status text, cod_amount numeric(14,2) not null check(cod_amount>=0),
 sent_by uuid not null references auth.users(id),sent_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),last_checked_at timestamptz,last_error text,
 foreign key(workspace_id,store_id,order_id) references public.crm_orders(workspace_id,store_id,id),
 foreign key(workspace_id,store_id,connection_id) references public.crm_shipping_connections(workspace_id,store_id,id),
 unique(connection_id,reference),unique(connection_id,tracking)
);
create index crm_shipments_store_recent_idx on public.crm_shipments(store_id,sent_at desc,id);
create index crm_shipments_connection_idx on public.crm_shipments(connection_id);
create index crm_shipments_actor_idx on public.crm_shipments(sent_by);
create table public.crm_shipping_events (
 id bigint generated always as identity primary key, shipment_id uuid not null references public.crm_shipments(id),
 workspace_id uuid not null,store_id uuid not null,order_id uuid not null,
 state text not null,raw_status text,kind text not null,created_at timestamptz not null default now(),
 foreign key(workspace_id,store_id,order_id) references public.crm_orders(workspace_id,store_id,id)
);
create index crm_shipping_events_recent_idx on public.crm_shipping_events(shipment_id,id desc);
create index crm_shipping_events_store_idx on public.crm_shipping_events(store_id,id desc);
create index crm_shipping_events_order_idx on public.crm_shipping_events(order_id);

alter table public.crm_shipping_connections enable row level security;
alter table public.crm_shipments enable row level security;
alter table public.crm_shipping_events enable row level security;
create policy crm_shipping_connection_read on public.crm_shipping_connections for select to authenticated
 using(crm_private.member_role(workspace_id) in ('owner','admin'));
create policy crm_shipments_read on public.crm_shipments for select to authenticated
 using(crm_private.can_read_order(order_id));
create policy crm_shipping_events_read on public.crm_shipping_events for select to authenticated
 using(crm_private.can_read_order(order_id));
revoke all on public.crm_shipping_connections,public.crm_shipments,public.crm_shipping_events from public,anon,authenticated;
grant select on public.crm_shipping_connections,public.crm_shipments,public.crm_shipping_events to authenticated;

create trigger crm_shipping_connections_live after insert or update on public.crm_shipping_connections
 for each row execute function crm_private.touch_live_store();
create trigger crm_shipments_live after insert or update on public.crm_shipments
 for each row execute function crm_private.touch_live_store();

create function crm_private.shipping_dashboard(p_store uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare wid uuid; pending jsonb; shipments jsonb;
begin
 select workspace_id into wid from public.crm_stores where id=p_store;
 if wid is null or crm_private.member_role(wid) not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]'::jsonb) into pending from (
  select o.id,o.number,o.customer_name,o.phone,o.wilaya,o.commune,o.address,o.delivery_type,o.total,o.created_at,
   (select coalesce(jsonb_agg(jsonb_build_object('name',i.product_name,'quantity',i.quantity) order by i.id),'[]'::jsonb)
    from public.crm_order_items i where i.order_id=o.id) items
  from public.crm_orders o where o.store_id=p_store and o.status='confirmed' and not o.woo_attention
   and not exists(select 1 from public.crm_shipments s where s.order_id=o.id)
  order by o.created_at desc,o.id desc limit 50
 ) q;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.sent_at desc,q.id desc),'[]'::jsonb) into shipments from (
  select s.id,s.order_id,s.reference,s.platform,s.state,s.tracking,s.remote_id,s.raw_status,s.cod_amount,
   s.sent_at,s.last_checked_at,s.last_error,o.number,o.customer_name,o.wilaya,o.commune,o.delivery_type,
   (select coalesce(jsonb_agg(jsonb_build_object('state',e.state,'raw_status',e.raw_status,'kind',e.kind,'created_at',e.created_at) order by e.id desc),'[]'::jsonb)
    from (select * from public.crm_shipping_events where shipment_id=s.id order by id desc limit 10) e) events
  from public.crm_shipments s join public.crm_orders o on o.id=s.order_id
  where s.store_id=p_store order by s.sent_at desc,s.id desc limit 50
 ) q;
 return jsonb_build_object('queue',pending,'shipments',shipments);
end $$;
create function public.crm_shipping_dashboard(p_store uuid) returns jsonb language sql security invoker set search_path='' as $$
 select crm_private.shipping_dashboard(p_store)
$$;
revoke all on function crm_private.shipping_dashboard(uuid),public.crm_shipping_dashboard(uuid) from public,anon;
grant execute on function crm_private.shipping_dashboard(uuid),public.crm_shipping_dashboard(uuid) to authenticated;

create function crm_private.shipping_service(p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.crm_shipping_connections; s public.crm_shipments;o public.crm_orders;
 sid uuid;wid uuid;uid uuid;secret uuid;sec uuid;creds jsonb; ref text;wanted text;stage text;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>20000 then raise exception 'INVALID_REQUEST';end if;
 uid:=(p->>'actor')::uuid;
 if uid is null then raise exception 'AUTH_REQUIRED';end if;
 if p_action='save' then
  sid:=(p->>'store_id')::uuid;
  select workspace_id into wid from public.crm_stores where id=sid;
  if wid is null or not exists(select 1 from public.crm_members where workspace_id=wid and user_id=uid and active and role in ('owner','admin')) then raise exception 'FORBIDDEN';end if;
  wanted:=p->>'platform';if wanted not in ('legacy','new') or wanted is null then raise exception 'INVALID_PLATFORM';end if;
  perform pg_advisory_xact_lock(hashtextextended(sid::text||'zr',0));
  select * into c from public.crm_shipping_connections where store_id=sid for update;
  if c.id is not null and c.platform<>wanted and exists(select 1 from public.crm_shipments where connection_id=c.id) then raise exception 'PLATFORM_LOCKED';end if;
  if wanted='new' and nullif(p->>'source_hub_id','') is null then raise exception 'HUB_REQUIRED';end if;
  if c.id is null then
   insert into public.crm_shipping_connections(workspace_id,store_id,platform,source_hub_id,created_by,last_test_at)
   values(wid,sid,wanted,nullif(p->>'source_hub_id','')::uuid,uid,now()) returning * into c;
  else
   update public.crm_shipping_connections set platform=wanted,source_hub_id=nullif(p->>'source_hub_id','')::uuid,
    active=true,generation=generation+1,updated_at=now(),last_test_at=now() where id=c.id returning * into c;
  end if;
  select secret_id into sec from crm_private.zr_credentials where connection_id=c.id;
  creds:=jsonb_build_object('first',p->>'first','second',p->>'second');
  if sec is null then
   secret:=vault.create_secret(creds::text,'weconvert_zr_'||c.id::text,'ZR Express server credentials');
   insert into crm_private.zr_credentials(connection_id,secret_id) values(c.id,secret);
  else perform vault.update_secret(sec,creds::text);end if;
  return to_jsonb(c);
 end if;
 select * into c from public.crm_shipping_connections where id=(p->>'connection_id')::uuid for update;
 if c.id is null then raise exception 'NOT_FOUND';end if;
 if not exists(select 1 from public.crm_members where workspace_id=c.workspace_id and user_id=uid and active and role in ('owner','admin')) then raise exception 'FORBIDDEN';end if;
 if p_action='disconnect' then
  select secret_id into sec from crm_private.zr_credentials where connection_id=c.id;
  if sec is not null then delete from vault.secrets where id=sec;delete from crm_private.zr_credentials where connection_id=c.id;end if;
  update public.crm_shipping_connections set active=false,generation=generation+1,updated_at=now() where id=c.id;
  return '{}'::jsonb;
 end if;
 if not c.active then raise exception 'DISCONNECTED';end if;
 if p ? 'generation' and c.generation<>(p->>'generation')::integer then raise exception 'CONNECTION_CHANGED';end if;
 if p_action='get' then
  select secret_id into sec from crm_private.zr_credentials where connection_id=c.id;
  select decrypted_secret::jsonb into creds from vault.decrypted_secrets where id=sec;
  if creds is null then raise exception 'DISCONNECTED';end if;
  return to_jsonb(c)||jsonb_build_object('credentials',creds);
 elsif p_action='tested' then
  update public.crm_shipping_connections set last_test_at=now() where id=c.id;
  return '{}'::jsonb;
 elsif p_action='prepare' then
  select * into o from public.crm_orders where id=(p->>'order_id')::uuid and store_id=c.store_id for share;
  if o.id is null then raise exception 'NOT_FOUND';end if;
  if o.status<>'confirmed' or o.woo_attention then raise exception 'ORDER_NOT_READY';end if;
  if length(trim(o.commune))<2 or length(trim(o.address))<3 then raise exception 'ADDRESS_REQUIRED';end if;
  if not exists(select 1 from public.crm_order_items where order_id=o.id) then raise exception 'INVALID_ITEMS';end if;
  ref:='WC'||o.number||'-'||left(replace(o.id::text,'-',''),8);
  if exists(select 1 from public.crm_shipments where order_id=o.id) then raise exception 'ALREADY_SENT';end if;
  insert into public.crm_shipments(workspace_id,store_id,order_id,connection_id,reference,platform,cod_amount,sent_by)
   values(o.workspace_id,o.store_id,o.id,c.id,ref,c.platform,o.total,uid) returning * into s;
  insert into public.crm_shipping_events(shipment_id,workspace_id,store_id,order_id,state,kind)
   values(s.id,s.workspace_id,s.store_id,s.order_id,'sending','send.requested');
  return jsonb_build_object('shipment_id',s.id,'reference',ref,'platform',c.platform,'source_hub_id',c.source_hub_id,
   'customer_name',o.customer_name,'phone',o.phone,'wilaya',o.wilaya,'commune',o.commune,
   'address',o.address,'delivery_type',o.delivery_type,'total',o.total,
   'items',(select jsonb_agg(jsonb_build_object('name',i.product_name,'quantity',i.quantity) order by i.id) from public.crm_order_items i where i.order_id=o.id));
 elsif p_action in ('complete','uncertain','track') then
  select * into s from public.crm_shipments where id=(p->>'shipment_id')::uuid and connection_id=c.id for update;
  if s.id is null then raise exception 'NOT_FOUND';end if;
  if p_action='uncertain' then
   if s.state='sending' then
    update public.crm_shipments set state='needs_review',remote_id=coalesce(nullif(left(p->>'remote_id',100),''),remote_id),
     last_error=left(coalesce(p->>'code','ZR_RESPONSE'),80),updated_at=now() where id=s.id;
    insert into public.crm_shipping_events(shipment_id,workspace_id,store_id,order_id,state,kind)
     values(s.id,s.workspace_id,s.store_id,s.order_id,'needs_review','send.uncertain');
   end if;return '{}'::jsonb;
  end if;
  if p_action='complete' and s.state not in ('sending','needs_review') then raise exception 'ALREADY_SENT';end if;
  if p_action='track' and s.state in ('sending','needs_review') then raise exception 'NEEDS_REVIEW';end if;
  stage:=p->>'state';
  if stage not in ('submitted','in_transit','out_for_delivery','ready_for_pickup','delivered','failed_delivery','returning','returned','cancelled','exception','unknown') or stage is null then raise exception 'INVALID_STATUS';end if;
  if p_action='complete' and length(trim(coalesce(p->>'tracking','')))<3 then raise exception 'INVALID_TRACKING';end if;
  if p_action='complete' or s.state<>stage or coalesce(s.raw_status,'')<>coalesce(p->>'raw_status','') then
   update public.crm_shipments set state=stage,tracking=case when p_action='complete' then left(p->>'tracking',100) else tracking end,
    remote_id=case when p_action='complete' then nullif(left(p->>'remote_id',100),'') else remote_id end,
    raw_status=nullif(left(p->>'raw_status',200),''),last_checked_at=now(),updated_at=now(),last_error=null where id=s.id;
   insert into public.crm_shipping_events(shipment_id,workspace_id,store_id,order_id,state,raw_status,kind)
    values(s.id,s.workspace_id,s.store_id,s.order_id,stage,nullif(left(p->>'raw_status',200),''),case when p_action='complete' then 'send.accepted' else 'status.changed' end);
  else update public.crm_shipments set last_checked_at=now() where id=s.id;end if;
  return '{}'::jsonb;
 end if;
 raise exception 'UNKNOWN_ACTION';
end $$;
create function public.crm_shipping_service(p_action text,p jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select crm_private.shipping_service(p_action,p)
$$;
revoke all on function crm_private.shipping_service(text,jsonb),public.crm_shipping_service(text,jsonb) from public,anon,authenticated;
grant usage on schema crm_private to service_role;
grant execute on function crm_private.shipping_service(text,jsonb),public.crm_shipping_service(text,jsonb) to service_role;
