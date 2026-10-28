-- Backend hardening (28/10/2026). Owner decisions:
--  * stock leaves the shelf when the parcel is handed to ZR (stock and reserved decrease); a ZR return puts it
--    back; a parcel cancelled at ZR puts it back and re-reserves it while the order is still confirmed;
--  * an agent may acknowledge a source change (WooCommerce, Shopify, YouCan) on an order assigned to them;
--  * inherited WooCommerce statuses are excluded from the confirmation-rate denominator (rate_base).
-- Plus: lock-free WooCommerce webhook secret lookup, Shopify shop-id binding and token handover for revocation,
-- RLS evaluated once per query, log retention, index for the ZR parcel matcher.

-- 1. Stock consumption at ZR handoff ---------------------------------------------------------------
alter table public.crm_shipments add column if not exists stock_consumed boolean not null default false;

create or replace function crm_private.shipment_consume(p_shipment uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare s public.crm_shipments;o public.crm_orders;r record;
begin
 select * into s from public.crm_shipments where id=p_shipment for update;
 if s.id is null or s.stock_consumed or s.state in ('sending','needs_review','cancelled','returned') then return false;end if;
 select * into o from public.crm_orders where id=s.order_id for update;
 -- Only stock that this CRM reserved is consumed: imported historical parcels never touch the shelf.
 if o.id is null or not o.stock_reserved then return false;end if;
 for r in select i.product_id,sum(i.quantity)::integer q from public.crm_order_items i where i.order_id=o.id group by i.product_id order by i.product_id loop
  update public.crm_products set stock=stock-r.q,reserved=reserved-r.q,version=version+1 where id=r.product_id;
 end loop;
 update public.crm_orders set stock_reserved=false,updated_at=now() where id=o.id;
 update public.crm_shipments set stock_consumed=true where id=s.id;
 insert into public.crm_events(workspace_id,store_id,order_id,actor_id,actor_name,kind,data)
  values(o.workspace_id,o.store_id,o.id,coalesce(s.sent_by,o.created_by),'ZR Express','stock.shipped',jsonb_build_object('shipment_id',s.id,'state',s.state));
 return true;
end $$;

create or replace function crm_private.shipment_restore(p_shipment uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare s public.crm_shipments;o public.crm_orders;r record;rereserve boolean;
begin
 select * into s from public.crm_shipments where id=p_shipment for update;
 if s.id is null or not s.stock_consumed or s.state not in ('returned','cancelled') then return false;end if;
 select * into o from public.crm_orders where id=s.order_id for update;
 if o.id is null then return false;end if;
 -- A parcel cancelled before delivery goes back to "confirmed and reserved"; a returned parcel only restocks.
 rereserve:=s.state='cancelled' and o.status='confirmed';
 for r in select i.product_id,sum(i.quantity)::integer q from public.crm_order_items i where i.order_id=o.id group by i.product_id order by i.product_id loop
  update public.crm_products set stock=stock+r.q,reserved=reserved+case when rereserve then r.q else 0 end,version=version+1 where id=r.product_id;
 end loop;
 if rereserve then update public.crm_orders set stock_reserved=true,updated_at=now() where id=o.id;end if;
 update public.crm_shipments set stock_consumed=false where id=s.id;
 insert into public.crm_events(workspace_id,store_id,order_id,actor_id,actor_name,kind,data)
  values(o.workspace_id,o.store_id,o.id,coalesce(s.sent_by,o.created_by),'ZR Express',case when rereserve then 'stock.restored' else 'stock.returned' end,
   jsonb_build_object('shipment_id',s.id,'state',s.state));
 return true;
end $$;

create or replace function crm_private.shipment_stock() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.state is not distinct from old.state then return null;end if;
 if new.state in ('returned','cancelled') then perform crm_private.shipment_restore(new.id);
 else perform crm_private.shipment_consume(new.id);end if;
 return null;
end $$;
revoke all on function crm_private.shipment_consume(uuid),crm_private.shipment_restore(uuid),crm_private.shipment_stock() from public,anon,authenticated;

drop trigger if exists crm_shipments_stock on public.crm_shipments;
create trigger crm_shipments_stock after insert or update of state on public.crm_shipments
 for each row execute function crm_private.shipment_stock();

-- Parcels already with the carrier: apply the same rule once, each step recorded in the order history.
select crm_private.shipment_consume(s.id) from public.crm_shipments s
 join public.crm_orders o on o.id=s.order_id
 where s.state not in ('sending','needs_review','cancelled','returned') and not s.stock_consumed and o.stock_reserved;

-- 2. An agent may acknowledge a source change on an order assigned to them ---------------------------
create or replace function crm_private.source_ack(p_order uuid, p_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare o public.crm_orders;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
 if not crm_private.can_read_order(p_order) then raise exception 'NOT_FOUND';end if;
 select * into o from public.crm_orders where id=p_order for update;
 if not found or not crm_private.can_read_order(p_order) then raise exception 'NOT_FOUND';end if;
 if o.version<>p_version then raise exception 'VERSION_CONFLICT';end if;
 if not o.source_attention then return;end if;
 update public.crm_orders set source_attention=false,version=version+1,updated_at=now() where id=p_order;
 insert into public.crm_events(workspace_id,store_id,order_id,actor_id,actor_name,kind)
  select o.workspace_id,o.store_id,o.id,auth.uid(),m.display_name,'source.reviewed' from public.crm_members m where m.workspace_id=o.workspace_id and m.user_id=auth.uid();
end $$;

-- 3. WooCommerce webhook: read the signing secret without locking the connection row ----------------
-- The caller is not authenticated yet (signature checked afterwards), so it must not be able to hold locks.
create or replace function crm_private.woo_webhook_secret(p jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.crm_integrations;credentials jsonb;
begin
 select * into c from public.crm_integrations where id=(p->>'connection_id')::uuid;
 if not found then raise exception 'NOT_FOUND';end if;
 if not c.active then raise exception 'DISCONNECTED';end if;
 select decrypted_secret::jsonb into credentials from vault.decrypted_secrets
  where id=(select secret_id from crm_private.woo_credentials where connection_id=c.id);
 if credentials is null then raise exception 'DISCONNECTED';end if;
 return to_jsonb(c)||jsonb_build_object('credentials',credentials);
end $$;
revoke all on function crm_private.woo_webhook_secret(jsonb) from public,anon,authenticated;
grant execute on function crm_private.woo_webhook_secret(jsonb) to service_role;

create or replace function public.crm_woo_service(p_action text, p jsonb) returns jsonb
language sql set search_path='' as $$
 select case when p_action in ('catalog.begin','catalog.finish','catalog.ingest','catalog.error')
  then crm_private.woo_catalog_service(p_action,p)
  when p_action='get_webhook' then crm_private.woo_webhook_secret(p)
  else crm_private.woo_service(p_action,p) end
$$;

-- 4. Shopify: numeric shop id bound at OAuth time; disconnect hands tokens back for revocation -------
alter table public.crm_source_connections add column if not exists external_shop_id text
 check (external_shop_id is null or external_shop_id ~ '^[0-9]{1,20}$');

CREATE OR REPLACE FUNCTION crm_private.source_service(p_action text, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.crm_source_connections;sec crm_private.source_secrets;
 l crm_private.source_order_links;o public.crm_orders;wid uuid;sid uuid;uid uuid;
 d jsonb;it jsonb;oid uuid;pid uuid;v integer;generated_sku text;h text;remote_at timestamptz;
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
  select sc.* into c from public.crm_source_connections sc
   join crm_private.source_secrets s on s.connection_id=sc.id
   where s.oauth_nonce_hash=p->>'nonce_hash' and s.oauth_expires_at>now()
   and sc.provider='shopify' and sc.external_shop=p->>'external_shop' and sc.status in ('pending','active') for update of sc;
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
  -- Numeric Shopify shop id read with the fresh token: webhooks must carry this id (anti cross-shop replay).
  if p ? 'shop_id' and p->>'shop_id' !~ '^[0-9]{1,20}$' then raise exception 'INVALID_REQUEST';end if;
  update public.crm_source_connections set status=case when status='active' then 'active' else 'awaiting_webhook' end,
   connected_at=now(),last_error=null,external_shop_id=coalesce(p->>'shop_id',external_shop_id) where id=c.id;
  insert into public.crm_source_events(connection_id,workspace_id,store_id,outcome,code)
   values(c.id,c.workspace_id,c.store_id,'connected','OAUTH_APPROVED');
  return jsonb_build_object('connected',true);
 end if;
 if p_action='disconnect' then
  uid:=(p->>'actor')::uuid;
  if not exists(select 1 from public.crm_members where workspace_id=c.workspace_id and user_id=uid and active and role in ('owner','admin')) then raise exception 'FORBIDDEN';end if;
  -- Tokens leave the vault now; they are handed back once so the Edge Function can revoke them at the provider.
  select decrypted_secret::jsonb into credential from vault.decrypted_secrets where id=(select vault_secret_id from crm_private.source_secrets where connection_id=c.id);
  delete from vault.secrets where id=(select vault_secret_id from crm_private.source_secrets where connection_id=c.id);
  update crm_private.source_secrets set vault_secret_id=null,oauth_nonce_hash=null,oauth_expires_at=null where connection_id=c.id;
  update public.crm_source_connections set status='disconnected' where id=c.id;
  return jsonb_build_object('disconnected',true,'provider',c.provider,'external_shop',c.external_shop,'credentials',credential);
 end if;
 if p_action='uninstalled' then
  delete from vault.secrets where id=(select vault_secret_id from crm_private.source_secrets where connection_id=c.id);
  update crm_private.source_secrets set vault_secret_id=null,oauth_nonce_hash=null,oauth_expires_at=null where connection_id=c.id;
  update public.crm_source_connections set status='disconnected' where id=c.id;
  insert into public.crm_source_events(connection_id,workspace_id,store_id,outcome,code)
   values(c.id,c.workspace_id,c.store_id,'disconnected',upper(c.provider)||'_UNINSTALLED');
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
 if c.provider not in ('shopify','youcan') then raise exception 'INVALID_REQUEST';end if;
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
    values(c.workspace_id,c.store_id,o.id,c.created_by,case when c.provider='youcan' then 'YouCan' else 'Shopify' end,'source.attention',jsonb_build_object('reason',reason,'number',d->>'number'));
  end if;
  insert into public.crm_source_events(connection_id,workspace_id,store_id,external_id,order_id,outcome,code)
   values(c.id,c.workspace_id,c.store_id,d->>'external_id',o.id,case when o.id is null then 'skipped' else 'attention' end,reason);
  return jsonb_build_object('outcome',case when o.id is null then 'skipped' else 'attention' end,'code',reason,'id',o.id);
 end if;
 if o.id is not null and (o.version<>l.synced_version or o.stock_reserved or l.last_remote_at=remote_at
   or exists(select 1 from public.crm_shipments s where s.order_id=o.id)) then
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
    generated_sku:=coalesce(nullif(it->>'sku',''),case when c.provider='youcan' then 'YCN-' else 'SHP-' end||left(c.id::text,8)||'-'||left(encode(extensions.digest(it->>'remote_key','sha256'),'hex'),16));
    insert into public.crm_products(workspace_id,store_id,name,sku,price,stock)
     values(c.workspace_id,c.store_id,it->>'name',generated_sku,unit_price,0)
     on conflict(store_id,sku) do nothing returning id into pid;
    if pid is null then select id into pid from public.crm_products where store_id=c.store_id and public.crm_products.sku=generated_sku;end if;
   end if;
   insert into crm_private.source_product_links(connection_id,remote_key,product_id)
    values(c.id,it->>'remote_key',pid) on conflict(connection_id,remote_key) do nothing;
   subtotal:=subtotal+q*unit_price;
   new_items:=new_items||jsonb_build_array(it||jsonb_build_object('product_id',pid));
  end loop;
  if subtotal+(d->>'fee')::numeric-(d->>'discount')::numeric<>(d->>'total')::numeric then raise exception 'INVALID_AMOUNT';end if;
  if o.id is null then
   insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,commune,address,channel,source_detail,fee,discount,total,created_by,created_at,source_connection_id,source_provider,source_external_id,source_status,source_snapshot)
    values(c.workspace_id,c.store_id,d->>'customer_name',crm_private.normalize_phone(d->>'phone'),d->>'wilaya',d->>'commune',d->>'address','website',case when c.provider='youcan' then 'YouCan' else 'Shopify' end||' #'||left(d->>'number',100),(d->>'fee')::numeric,(d->>'discount')::numeric,(d->>'total')::numeric,c.created_by,(d->>'created_at')::timestamptz,c.id,c.provider,d->>'external_id',d->>'remote_status',d)
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
  values(c.workspace_id,c.store_id,oid,c.created_by,case when c.provider='youcan' then 'YouCan' else 'Shopify' end,'source.'||result,jsonb_build_object('number',d->>'number','provider',c.provider,'status',d->>'remote_status'));
 return jsonb_build_object('outcome',result,'id',oid);
end $function$;

CREATE OR REPLACE FUNCTION public.crm_overview(p_store uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
 'all',count(*),'new',count(*) filter(where status='new'),
 'pending',count(*) filter(where status in ('new','call1','call2','call3','reported','check')),
 'confirmed',count(*) filter(where status='confirmed'),
 'woo_confirmation_unverified',count(*) filter(where status='confirmed' and status_origin='woo_legacy'),
 'woo_cancellation_unverified',count(*) filter(where status='cancelled' and status_origin='woo_legacy'),
 'confirmed_verified',count(*) filter(where status='confirmed' and status_origin<>'woo_legacy'),
 -- Confirmation-rate denominator: orders whose status is a CRM decision (inherited WooCommerce statuses excluded).
 'rate_base',count(*) filter(where status_origin is distinct from 'woo_legacy'),
 'confirmed_verified_amount',coalesce(sum(total) filter(where status='confirmed' and status_origin<>'woo_legacy'),0),
 'cancelled',count(*) filter(where status in ('cancelled','duplicate','fake')),
 'callbacks',count(*) filter(where callback_at is not null),'due',count(*) filter(where callback_at<=now()),
 'confirmed_amount',coalesce(sum(total) filter(where status='confirmed' and status_origin<>'woo_legacy'),0),
 'today',count(*) filter(where created_at >= date_trunc('day',now() at time zone 'Africa/Algiers') at time zone 'Africa/Algiers'),
 'days',(select coalesce(jsonb_agg(jsonb_build_object('date',d.day,'count',(select count(*) from public.crm_orders x where x.store_id=p_store and (x.created_at at time zone 'Africa/Algiers')::date=d.day)) order by d.day),'[]'::jsonb)
 from (select ((now() at time zone 'Africa/Algiers')::date-n) as day from generate_series(6,0,-1) n) d)
 ) from public.crm_orders where store_id=p_store
$function$;

CREATE OR REPLACE FUNCTION public.crm_performance(p_store uuid, p_from date, p_to date, p_agent uuid DEFAULT NULL::uuid, p_channel text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
  select o.id,o.status,o.channel,o.wilaya,o.assigned_to,o.total,o.woo_snapshot,o.woo_purchase_event_id,o.status_origin,
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
   count(*) filter(where status_origin is distinct from 'woo_legacy') as rate_base,
   count(*) filter(where woo_snapshot is not null) as woo_orders,
   count(*) filter(where woo_snapshot is not null and woo_purchase_event_id is not null) as woo_purchase_marked,
   count(*) filter(where woo_snapshot is not null and woo_purchase_event_id is null) as woo_unverified,
   count(*) filter(where status='confirmed' and status_origin<>'woo_legacy') as confirmed,
   count(*) filter(where status='confirmed' and status_origin='woo_legacy') as woo_confirmation_unverified,
   count(*) filter(where status='cancelled' and status_origin='woo_legacy') as woo_cancellation_unverified,
   count(*) filter(where status in ('new','call1','call2','call3','reported','check')) as pending,
   count(*) filter(where status='cancelled' and status_origin<>'woo_legacy') as cancelled,
   count(*) filter(where status='duplicate') as duplicate,
   count(*) filter(where status='fake') as fake,
   coalesce(sum(total) filter(where status='confirmed' and status_origin<>'woo_legacy'),0) as confirmed_amount
  from filtered
 ),
 daily as (
  select day,count(*) as orders,
   count(*) filter(where status='confirmed' and status_origin<>'woo_legacy') as confirmed,
   count(*) filter(where status='cancelled' and status_origin<>'woo_legacy') as cancelled
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
   select channel,count(*) as orders,count(*) filter(where status_origin is distinct from 'woo_legacy') as rate_base,count(*) filter(where status='confirmed' and status_origin<>'woo_legacy') as confirmed,
    count(*) filter(where status='cancelled' and status_origin<>'woo_legacy') as cancelled,
    coalesce(sum(total) filter(where status='confirmed' and status_origin<>'woo_legacy'),0) as confirmed_amount
   from filtered group by channel
  ) x),
  'wilayas',(select coalesce(jsonb_agg(to_jsonb(x) order by x.orders desc,x.wilaya),'[]'::jsonb) from (
   select wilaya,count(*) as orders,count(*) filter(where status_origin is distinct from 'woo_legacy') as rate_base,count(*) filter(where status='confirmed' and status_origin<>'woo_legacy') as confirmed,
    coalesce(sum(total) filter(where status='confirmed' and status_origin<>'woo_legacy'),0) as confirmed_amount
   from filtered group by wilaya order by orders desc,wilaya limit 10
  ) x),
  'products',(select coalesce(jsonb_agg(to_jsonb(x) order by x.confirmed_units desc,x.units desc,x.name),'[]'::jsonb) from (
   select i.product_id,p.name,p.sku,count(*) as orders,sum(i.quantity) as units,
    coalesce(sum(i.quantity) filter(where f.status='confirmed' and f.status_origin<>'woo_legacy'),0) as confirmed_units,
    coalesce(sum(i.quantity*i.unit_price) filter(where f.status='confirmed' and f.status_origin<>'woo_legacy'),0) as confirmed_lines_amount
   from filtered f join public.crm_order_items i on i.order_id=f.id
    join public.crm_products p on p.id=i.product_id
   group by i.product_id,p.name,p.sku order by confirmed_units desc,units desc,p.name limit 10
  ) x),
  'agents',(select coalesce(jsonb_agg(to_jsonb(x) order by x.orders desc,x.name),'[]'::jsonb) from (
   select f.assigned_to,coalesce(m.display_name,'Non attribué') as name,
    count(*) as orders,count(*) filter(where f.status_origin is distinct from 'woo_legacy') as rate_base,count(*) filter(where f.status='confirmed' and f.status_origin<>'woo_legacy') as confirmed,
    count(*) filter(where f.status='cancelled' and f.status_origin<>'woo_legacy') as cancelled,
    coalesce(sum(f.total) filter(where f.status='confirmed' and f.status_origin<>'woo_legacy'),0) as confirmed_amount
   from filtered f left join public.crm_members m on m.workspace_id=wid and m.user_id=f.assigned_to
   group by f.assigned_to,m.display_name
  ) x)
 ) into result;
 return result;
end $function$;

-- 5. RLS: the user's workspaces are computed once per query (initplan), not once per row ------------
create or replace function crm_private.my_workspaces(p_roles text[] default array['owner','admin','agent']) returns uuid[]
language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(m.workspace_id),'{}'::uuid[]) from public.crm_members m
 where m.user_id=(select auth.uid()) and m.active and m.role=any(p_roles)
$$;
revoke all on function crm_private.my_workspaces(text[]) from public,anon;
grant execute on function crm_private.my_workspaces(text[]) to authenticated,service_role;

alter policy crm_cost_entries_read on public.crm_cost_entries using (workspace_id=any((select crm_private.my_workspaces(array['owner','admin']))::uuid[]));
alter policy crm_integration_events_read on public.crm_integration_events using (workspace_id=any((select crm_private.my_workspaces(array['owner','admin']))::uuid[]));
alter policy crm_integrations_read on public.crm_integrations using (workspace_id=any((select crm_private.my_workspaces(array['owner','admin']))::uuid[]));
alter policy crm_product_costs_read on public.crm_product_costs using (workspace_id=any((select crm_private.my_workspaces(array['owner','admin']))::uuid[]));
alter policy crm_shipment_costs_read on public.crm_shipment_costs using (workspace_id=any((select crm_private.my_workspaces(array['owner','admin']))::uuid[]));
alter policy crm_shipping_connection_read on public.crm_shipping_connections using (workspace_id=any((select crm_private.my_workspaces(array['owner','admin']))::uuid[]));
alter policy crm_source_connections_read on public.crm_source_connections using (workspace_id=any((select crm_private.my_workspaces(array['owner','admin']))::uuid[]));
alter policy crm_source_events_read on public.crm_source_events using (workspace_id=any((select crm_private.my_workspaces(array['owner','admin']))::uuid[]));
alter policy crm_live_store_read on public.crm_live_stores using (workspace_id=any((select crm_private.my_workspaces())::uuid[]));
alter policy crm_members_read on public.crm_members using (workspace_id=any((select crm_private.my_workspaces())::uuid[]));
alter policy crm_products_read on public.crm_products using (workspace_id=any((select crm_private.my_workspaces())::uuid[]));
alter policy crm_stores_read on public.crm_stores using (workspace_id=any((select crm_private.my_workspaces())::uuid[]));
alter policy crm_workspace_read on public.crm_workspaces using (id=any((select crm_private.my_workspaces())::uuid[]));
alter policy crm_orders_read on public.crm_orders using (
 workspace_id=any((select crm_private.my_workspaces(array['owner','admin']))::uuid[])
 or (assigned_to=(select auth.uid()) and workspace_id=any((select crm_private.my_workspaces(array['agent']))::uuid[])));
-- Order children: managers see their workspaces; an agent sees the children of orders assigned to them.
alter policy crm_items_read on public.crm_order_items using (
 workspace_id=any((select crm_private.my_workspaces(array['owner','admin']))::uuid[])
 or order_id in (select o.id from public.crm_orders o where o.assigned_to=(select auth.uid()) and o.workspace_id=any((select crm_private.my_workspaces(array['agent']))::uuid[])));
alter policy crm_shipments_read on public.crm_shipments using (
 workspace_id=any((select crm_private.my_workspaces(array['owner','admin']))::uuid[])
 or order_id in (select o.id from public.crm_orders o where o.assigned_to=(select auth.uid()) and o.workspace_id=any((select crm_private.my_workspaces(array['agent']))::uuid[])));
alter policy crm_shipping_events_read on public.crm_shipping_events using (
 workspace_id=any((select crm_private.my_workspaces(array['owner','admin']))::uuid[])
 or order_id in (select o.id from public.crm_orders o where o.assigned_to=(select auth.uid()) and o.workspace_id=any((select crm_private.my_workspaces(array['agent']))::uuid[])));
alter policy crm_events_read on public.crm_events using (
 workspace_id=any((select crm_private.my_workspaces(array['owner','admin']))::uuid[])
 or (order_id is not null and order_id in (select o.id from public.crm_orders o where o.assigned_to=(select auth.uid()) and o.workspace_id=any((select crm_private.my_workspaces(array['agent']))::uuid[]))));

create index if not exists crm_order_items_order_idx on public.crm_order_items(order_id);
create index if not exists crm_shipments_order_idx on public.crm_shipments(order_id);
create index if not exists crm_shipping_events_order_idx on public.crm_shipping_events(order_id);
create index if not exists crm_events_order_idx on public.crm_events(order_id) where order_id is not null;
do $$begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='crm_orders' and column_name='woo_number') then
  execute 'create index if not exists crm_orders_woo_number_idx on public.crm_orders(store_id,woo_number) where woo_number is not null';
 end if;
end$$;

-- 6. Retention of technical logs (order history in crm_events is never purged) ----------------------
create or replace function crm_private.purge_logs() returns jsonb
language plpgsql security definer set search_path='' as $$
declare a bigint;b bigint;c bigint;d bigint;
begin
 -- Idempotency records only protect retries made within minutes; 30 days is a wide margin.
 delete from crm_private.requests where created_at<now()-interval '30 days';get diagnostics a=row_count;
 -- Shopify/YouCan retry a webhook for at most 48 hours; keep 30 days of delivery ids for de-duplication.
 delete from crm_private.source_deliveries where received_at<now()-interval '30 days';get diagnostics b=row_count;
 -- Journals: 180 days, but always the latest 200 entries of each connection.
 with keep as (select id from (select id,row_number() over(partition by connection_id order by id desc) rn from public.crm_integration_events) t where rn<=200)
 delete from public.crm_integration_events e where e.created_at<now()-interval '180 days' and not exists(select 1 from keep k where k.id=e.id);
 get diagnostics c=row_count;
 with keep as (select id from (select id,row_number() over(partition by connection_id order by id desc) rn from public.crm_source_events) t where rn<=200)
 delete from public.crm_source_events e where e.created_at<now()-interval '180 days' and not exists(select 1 from keep k where k.id=e.id);
 get diagnostics d=row_count;
 return jsonb_build_object('requests',a,'deliveries',b,'integration_events',c,'source_events',d);
end $$;
revoke all on function crm_private.purge_logs() from public,anon,authenticated;
select cron.schedule('weconvert-purge-logs','23 3 * * *','select crm_private.purge_logs()');

-- ZR scan looks parcels up by store + external reference (replaces the 10 000-order load in the Edge Function).
create index if not exists crm_orders_store_external_ref on public.crm_orders(store_id,(woo_snapshot->>'external_id')) where woo_snapshot is not null;
