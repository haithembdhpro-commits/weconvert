-- Source connections are tenant-scoped. A commerce status is never a COD decision.
create table public.crm_source_connections (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null, store_id uuid not null,
 provider text not null check (provider in ('shopify','youcan','ayor','lightfunnels')),
 external_shop text not null check (length(external_shop) between 3 and 255),
 cod_methods text[] not null default array['cash on delivery (cod)','cash on delivery','cod','cash_on_delivery'],
 status text not null default 'pending' check (status in ('pending','awaiting_webhook','active','disconnected','error')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 connected_at timestamptz, last_webhook_at timestamptz, last_error text,
 foreign key (workspace_id,store_id) references public.crm_stores(workspace_id,id),
 unique (store_id,provider), unique (workspace_id,provider,external_shop),
 unique (workspace_id,store_id,id)
);
create unique index crm_source_active_shop on public.crm_source_connections(provider,external_shop)
 where status in ('awaiting_webhook','active');
create index crm_source_workspace on public.crm_source_connections(workspace_id,store_id,provider);
alter table public.crm_source_connections enable row level security;
create policy crm_source_connections_read on public.crm_source_connections for select to authenticated
 using (crm_private.member_role(workspace_id) in ('owner','admin'));
revoke all on public.crm_source_connections from public,anon,authenticated;
grant select on public.crm_source_connections to authenticated;

create table public.crm_source_events (
 id bigint generated always as identity primary key,
 connection_id uuid not null references public.crm_source_connections(id),
 workspace_id uuid not null,store_id uuid not null,
 external_id text,order_id uuid references public.crm_orders(id),
 outcome text not null,code text not null,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,store_id,connection_id) references public.crm_source_connections(workspace_id,store_id,id)
);
create index crm_source_events_recent on public.crm_source_events(connection_id,id desc);
create index crm_source_events_store on public.crm_source_events(workspace_id,store_id);
alter table public.crm_source_events enable row level security;
create policy crm_source_events_read on public.crm_source_events for select to authenticated
 using (crm_private.member_role(workspace_id) in ('owner','admin'));
revoke all on public.crm_source_events from public,anon,authenticated;
grant select on public.crm_source_events to authenticated;

create table crm_private.source_secrets (
 connection_id uuid primary key references public.crm_source_connections(id),
 vault_secret_id uuid,
 oauth_nonce_hash text,oauth_expires_at timestamptz
);
create table crm_private.source_order_links (
 connection_id uuid not null references public.crm_source_connections(id),
 external_id text not null,order_id uuid not null unique references public.crm_orders(id),
 last_hash text not null,last_remote_at timestamptz not null,synced_version integer not null,
 primary key (connection_id,external_id)
);
create table crm_private.source_product_links (
 connection_id uuid not null references public.crm_source_connections(id),
 remote_key text not null,product_id uuid not null references public.crm_products(id),
 primary key(connection_id,remote_key)
);
create index crm_source_product_links_product on crm_private.source_product_links(product_id);
create table crm_private.source_deliveries (
 connection_id uuid not null references public.crm_source_connections(id),
 delivery_id text not null,received_at timestamptz not null default now(),
 primary key(connection_id,delivery_id)
);
create index crm_source_deliveries_recent on crm_private.source_deliveries(connection_id,received_at desc);
alter table crm_private.source_secrets enable row level security;
alter table crm_private.source_order_links enable row level security;
alter table crm_private.source_product_links enable row level security;
alter table crm_private.source_deliveries enable row level security;
revoke all on crm_private.source_secrets,crm_private.source_order_links,crm_private.source_product_links,crm_private.source_deliveries from public,anon,authenticated;

alter table public.crm_orders
 add column source_connection_id uuid,
 add column source_provider text,
 add column source_external_id text,
 add column source_status text,
 add column source_snapshot jsonb,
 add column source_attention boolean not null default false,
 add constraint crm_source_order_pair check ((source_connection_id is null)=(source_provider is null)),
 add constraint crm_source_order_tenant foreign key(workspace_id,store_id,source_connection_id)
  references public.crm_source_connections(workspace_id,store_id,id),
 add constraint crm_source_order_provider check (source_provider is null or source_provider in ('shopify','youcan','ayor','lightfunnels'));
create index crm_orders_source_lookup on public.crm_orders(source_connection_id,source_external_id)
 where source_connection_id is not null;

-- The Edge worker is the only caller. It authenticates Shopify's raw webhook body and
-- Shopify's OAuth callback before passing normalized data to this service-role function.
create function crm_private.source_service(p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.crm_source_connections;sec crm_private.source_secrets;
 l crm_private.source_order_links;o public.crm_orders;wid uuid;sid uuid;uid uuid;
 d jsonb;it jsonb;oid uuid;pid uuid;v integer;sku text;h text;remote_at timestamptz;
 q integer;unit_price numeric(14,2);subtotal numeric(14,2):=0;new_items jsonb:='[]'::jsonb;
 credential jsonb;secret uuid;reason text;result text;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>1000000 then raise exception 'INVALID_REQUEST';end if;
 if p_action='begin' then
  sid:=(p->>'store_id')::uuid;uid:=(p->>'actor')::uuid;
  select workspace_id into wid from public.crm_stores where id=sid;
  if not exists(select 1 from public.crm_members where workspace_id=wid and user_id=uid and active and role in ('owner','admin')) then raise exception 'FORBIDDEN';end if;
  if p->>'provider'<>'shopify' or p->>'external_shop' !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'
   or p->>'nonce_hash' !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(p->'cod_methods')<>'array' or jsonb_array_length(p->'cod_methods') not between 1 and 20
   then raise exception 'INVALID_REQUEST';end if;
  perform pg_advisory_xact_lock(hashtextextended(sid::text||'shopify',0));
  select * into c from public.crm_source_connections where store_id=sid and provider='shopify' for update;
  if found and c.external_shop<>p->>'external_shop' then raise exception 'SHOP_LOCKED';end if;
  if not found then
   insert into public.crm_source_connections(workspace_id,store_id,provider,external_shop,created_by,cod_methods)
    values(wid,sid,'shopify',p->>'external_shop',uid,
     array(select lower(trim(value)) from jsonb_array_elements_text(p->'cod_methods') where length(trim(value)) between 2 and 80)) returning * into c;
  else
   update public.crm_source_connections set status=case when status='active' then status else 'pending' end,last_error=null,
    cod_methods=array(select lower(trim(value)) from jsonb_array_elements_text(p->'cod_methods') where length(trim(value)) between 2 and 80)
    where id=c.id returning * into c;
  end if;
  insert into crm_private.source_secrets(connection_id,oauth_nonce_hash,oauth_expires_at)
   values(c.id,p->>'nonce_hash',now()+interval '10 minutes')
   on conflict(connection_id) do update set oauth_nonce_hash=excluded.oauth_nonce_hash,oauth_expires_at=excluded.oauth_expires_at;
  return jsonb_build_object('id',c.id);
 end if;
 if p_action='oauth_state' then
  select c.* into c from public.crm_source_connections c
   join crm_private.source_secrets s on s.connection_id=c.id
   where s.oauth_nonce_hash=p->>'nonce_hash' and s.oauth_expires_at>now()
   and c.provider='shopify' and c.external_shop=p->>'external_shop' and c.status in ('pending','active') for update of c;
  if not found then raise exception 'INVALID_STATE';end if;
  return jsonb_build_object('id',c.id,'external_shop',c.external_shop);
 end if;
 if p_action='by_shop' then
  select * into c from public.crm_source_connections
   where provider=p->>'provider' and external_shop=p->>'external_shop'
    and status in ('awaiting_webhook','active');
  if not found then raise exception 'NOT_FOUND';end if;
  return to_jsonb(c);
 end if;
 select * into c from public.crm_source_connections where id=(p->>'connection_id')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if p_action='finish_oauth' then
  select * into sec from crm_private.source_secrets where connection_id=c.id for update;
  if sec.oauth_nonce_hash is distinct from p->>'nonce_hash' or sec.oauth_expires_at<=now() or c.status not in ('pending','active') then raise exception 'INVALID_STATE';end if;
  credential:=p->'credentials';
  if jsonb_typeof(credential)<>'object' or nullif(credential->>'access_token','') is null
   or nullif(credential->>'refresh_token','') is null or (credential->>'expires_in')::integer<=0
   then raise exception 'INVALID_REQUEST';end if;
  if sec.vault_secret_id is null then
   secret:=vault.create_secret(credential::text,'weconvert_shopify_'||c.id::text,'Shopify merchant OAuth tokens');
  else
   secret:=sec.vault_secret_id;perform vault.update_secret(secret,credential::text);
  end if;
  update crm_private.source_secrets set vault_secret_id=secret,oauth_nonce_hash=null,oauth_expires_at=null where connection_id=c.id;
  update public.crm_source_connections set status=case when status='active' then 'active' else 'awaiting_webhook' end,
   connected_at=now(),last_error=null where id=c.id;
  insert into public.crm_source_events(connection_id,workspace_id,store_id,outcome,code)
   values(c.id,c.workspace_id,c.store_id,'connected','OAUTH_APPROVED');
  return jsonb_build_object('connected',true);
 end if;
 if p_action='disconnect' then
  uid:=(p->>'actor')::uuid;
  if not exists(select 1 from public.crm_members where workspace_id=c.workspace_id and user_id=uid and active and role in ('owner','admin')) then raise exception 'FORBIDDEN';end if;
  delete from vault.secrets where id=(select vault_secret_id from crm_private.source_secrets where connection_id=c.id);
  update crm_private.source_secrets set vault_secret_id=null,oauth_nonce_hash=null,oauth_expires_at=null where connection_id=c.id;
  update public.crm_source_connections set status='disconnected' where id=c.id;
  return jsonb_build_object('disconnected',true);
 end if;
 if p_action='uninstalled' then
  delete from vault.secrets where id=(select vault_secret_id from crm_private.source_secrets where connection_id=c.id);
  update crm_private.source_secrets set vault_secret_id=null,oauth_nonce_hash=null,oauth_expires_at=null where connection_id=c.id;
  update public.crm_source_connections set status='disconnected' where id=c.id;
  insert into public.crm_source_events(connection_id,workspace_id,store_id,outcome,code)
   values(c.id,c.workspace_id,c.store_id,'disconnected','SHOPIFY_UNINSTALLED');
  return jsonb_build_object('disconnected',true);
 end if;
 if p_action='error' then
  insert into public.crm_source_events(connection_id,workspace_id,store_id,external_id,outcome,code)
   values(c.id,c.workspace_id,c.store_id,left(p->>'external_id',120),'error',left(p->>'code',80));
  update public.crm_source_connections set last_error=left(p->>'code',80) where id=c.id;
  return '{}'::jsonb;
 end if;
 if p_action<>'ingest' then raise exception 'INVALID_REQUEST';end if;
 if c.status not in ('awaiting_webhook','active') then raise exception 'DISCONNECTED';end if;
 if c.provider<>'shopify' then raise exception 'INVALID_REQUEST';end if;
 d:=p->'order';h:=p->>'hash';remote_at:=(d->>'updated_at')::timestamptz;
 if d->>'external_id' is null or length(d->>'external_id')>120 or h !~ '^[a-f0-9]{64}$' or remote_at is null
  or p->>'delivery_id' is null or length(p->>'delivery_id')>200 then raise exception 'INVALID_ORDER';end if;
 insert into crm_private.source_deliveries(connection_id,delivery_id) values(c.id,p->>'delivery_id') on conflict do nothing;
 if not found then return jsonb_build_object('outcome','duplicate');end if;
 update public.crm_source_connections set last_webhook_at=now(),status='active' where id=c.id;
 select * into l from crm_private.source_order_links where connection_id=c.id and external_id=d->>'external_id';
 if l.order_id is not null then select * into o from public.crm_orders where id=l.order_id for update;end if;
 if o.id is not null and l.last_remote_at>remote_at then return jsonb_build_object('outcome','stale','id',o.id);end if;
 if o.id is not null and l.last_hash=h then return jsonb_build_object('outcome','unchanged','id',o.id);end if;
 if d ? 'skip' then reason:=left(d->>'skip',80);
 elsif o.id is null and (d->>'created_at')::timestamptz<date_trunc('second',c.connected_at) then reason:='ORDER_PREDATES_CONNECTION';
 end if;
 if reason is not null then
  if o.id is not null then
   update public.crm_orders set source_status=d->>'remote_status',source_snapshot=d,source_attention=true,version=version+1,updated_at=now()
    where id=o.id;
   update crm_private.source_order_links set last_hash=h,last_remote_at=remote_at where connection_id=c.id and external_id=d->>'external_id';
   insert into public.crm_events(workspace_id,store_id,order_id,actor_id,actor_name,kind,data)
    values(c.workspace_id,c.store_id,o.id,c.created_by,'Shopify','source.attention',jsonb_build_object('reason',reason,'number',d->>'number'));
  end if;
  insert into public.crm_source_events(connection_id,workspace_id,store_id,external_id,order_id,outcome,code)
   values(c.id,c.workspace_id,c.store_id,d->>'external_id',o.id,case when o.id is null then 'skipped' else 'attention' end,reason);
  return jsonb_build_object('outcome',case when o.id is null then 'skipped' else 'attention' end,'code',reason,'id',o.id);
 end if;
 if o.id is not null and (o.version<>l.synced_version or o.stock_reserved or l.last_remote_at=remote_at) then
  update public.crm_orders set source_status=d->>'remote_status',source_snapshot=d,source_attention=true,version=version+1,updated_at=now()
   where id=o.id returning version into v;
  result:='attention';oid:=o.id;
 else
  if jsonb_typeof(d->'items')<>'array' or jsonb_array_length(d->'items') not between 1 and 200 then raise exception 'INVALID_ITEMS';end if;
  for it in select value from jsonb_array_elements(d->'items') loop
   q:=(it->>'quantity')::integer;unit_price:=(it->>'unit_price')::numeric;
   if q not between 1 and 10000 or unit_price<0 then raise exception 'INVALID_ITEMS';end if;
   pid:=null;
   select product_id into pid from crm_private.source_product_links where connection_id=c.id and remote_key=it->>'remote_key';
   if pid is null and nullif(it->>'sku','') is not null then select id into pid from public.crm_products where store_id=c.store_id and public.crm_products.sku=it->>'sku';end if;
   if pid is null then
    sku:=coalesce(nullif(it->>'sku',''),'SHP-'||left(c.id::text,8)||'-'||left(encode(extensions.digest(it->>'remote_key','sha256'),'hex'),16));
    insert into public.crm_products(workspace_id,store_id,name,sku,price,stock)
     values(c.workspace_id,c.store_id,it->>'name',sku,unit_price,0)
     on conflict(store_id,sku) do nothing returning id into pid;
    if pid is null then select id into pid from public.crm_products where store_id=c.store_id and public.crm_products.sku=sku;end if;
   end if;
   insert into crm_private.source_product_links(connection_id,remote_key,product_id)
    values(c.id,it->>'remote_key',pid) on conflict(connection_id,remote_key) do nothing;
   subtotal:=subtotal+q*unit_price;
   new_items:=new_items||jsonb_build_array(it||jsonb_build_object('product_id',pid));
  end loop;
  if subtotal+(d->>'fee')::numeric-(d->>'discount')::numeric<>(d->>'total')::numeric then raise exception 'INVALID_AMOUNT';end if;
  if o.id is null then
   insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,commune,address,channel,source_detail,fee,discount,total,created_by,created_at,source_connection_id,source_provider,source_external_id,source_status,source_snapshot)
    values(c.workspace_id,c.store_id,d->>'customer_name',crm_private.normalize_phone(d->>'phone'),d->>'wilaya',d->>'commune',d->>'address','website','Shopify #'||left(d->>'number',100),(d->>'fee')::numeric,(d->>'discount')::numeric,(d->>'total')::numeric,c.created_by,(d->>'created_at')::timestamptz,c.id,c.provider,d->>'external_id',d->>'remote_status',d)
    returning id,version into oid,v;
   result:='received';
  else
   oid:=o.id;
   update public.crm_orders set customer_name=d->>'customer_name',phone=crm_private.normalize_phone(d->>'phone'),wilaya=d->>'wilaya',commune=d->>'commune',address=d->>'address',fee=(d->>'fee')::numeric,discount=(d->>'discount')::numeric,total=(d->>'total')::numeric,source_status=d->>'remote_status',source_snapshot=d,source_attention=false,version=version+1,updated_at=now()
    where id=o.id returning version into v;
   delete from public.crm_order_items where order_id=oid;
   result:='updated';
  end if;
  for it in select value from jsonb_array_elements(new_items) loop
   insert into public.crm_order_items(workspace_id,store_id,order_id,product_id,product_name,sku,quantity,unit_price)
    select c.workspace_id,c.store_id,oid,id,it->>'name',sku,(it->>'quantity')::integer,(it->>'unit_price')::numeric from public.crm_products where id=(it->>'product_id')::uuid;
  end loop;
 end if;
 if result='attention' then v:=o.version;end if;
 insert into crm_private.source_order_links(connection_id,external_id,order_id,last_hash,last_remote_at,synced_version)
  values(c.id,d->>'external_id',oid,h,remote_at,v)
  on conflict(connection_id,external_id) do update set last_hash=excluded.last_hash,last_remote_at=excluded.last_remote_at,
   synced_version=case when result='attention' then crm_private.source_order_links.synced_version else excluded.synced_version end;
 insert into public.crm_source_events(connection_id,workspace_id,store_id,external_id,order_id,outcome,code)
  values(c.id,c.workspace_id,c.store_id,d->>'external_id',oid,result,upper(result));
 insert into public.crm_events(workspace_id,store_id,order_id,actor_id,actor_name,kind,data)
  values(c.workspace_id,c.store_id,oid,c.created_by,'Shopify','source.'||result,jsonb_build_object('number',d->>'number','provider',c.provider,'status',d->>'remote_status'));
 return jsonb_build_object('outcome',result,'id',oid);
end $$;
create function public.crm_source_service(p_action text,p jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select crm_private.source_service(p_action,p)
$$;
revoke all on function crm_private.source_service(text,jsonb),public.crm_source_service(text,jsonb) from public,anon,authenticated;
grant usage on schema crm_private to service_role;
grant execute on function crm_private.source_service(text,jsonb),public.crm_source_service(text,jsonb) to service_role;
