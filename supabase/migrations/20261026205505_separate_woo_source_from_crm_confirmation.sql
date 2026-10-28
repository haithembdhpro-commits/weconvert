-- Woo order status reports its commerce/fulfillment state, not COD confirmation by WeConvert.
-- Keep all legacy records untouched. New signed webhooks create CRM-new orders, and later
-- Woo updates refresh source metadata without changing confirmation or stock reservations.
-- Existing Woo-derived confirmed records stay visible but are quantified as unverified.
-- Label the old Woo-derived terminal states without rewriting the operational status,
-- ZR links, stock or history. An explicit CRM status change clears the legacy label.
alter table public.crm_orders add column status_origin text not null default 'crm'
 check (status_origin in ('crm','woo_legacy'));
update public.crm_orders o set status_origin='woo_legacy'
where o.woo_snapshot is not null and o.status in ('confirmed','cancelled')
 and not exists (select 1 from public.crm_events e where e.order_id=o.id and e.kind='order.status');

create function crm_private.mark_explicit_status() returns trigger language plpgsql
set search_path='' as $$
begin
 if new.status is distinct from old.status and new.status_origin=old.status_origin then
  new.status_origin:='crm';
 end if;
 return new;
end $$;
create trigger crm_order_status_origin before update of status on public.crm_orders
for each row execute function crm_private.mark_explicit_status();

create or replace function crm_private.woo_service(p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.crm_integrations;sec crm_private.woo_credentials;link crm_private.woo_orders;
 o public.crm_orders;sid uuid;wid uuid;uid uuid;secret uuid;credentials jsonb;d jsonb;it jsonb;
 pid uuid;oid uuid;v_sku text;h text;modified timestamptz;outcome text;reason text;v integer;new_items jsonb:='[]';
 qty integer;price numeric(14,2);subtotal numeric(14,2):=0;after_at timestamptz;before_at timestamptz;
 proof_id text;proof_marker text;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>1000000 then raise exception 'INVALID_REQUEST'; end if;
 if p_action='save' then
  sid:=(p->>'store_id')::uuid;uid:=(p->>'actor')::uuid;
  select workspace_id into wid from public.crm_stores where id=sid;
  if not exists(select 1 from public.crm_members where workspace_id=wid and user_id=uid and active and role in ('owner','admin')) then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended(sid::text||'woo',0));
  select * into c from public.crm_integrations where store_id=sid for update;
  if found and c.base_url<>p->>'base_url' then raise exception 'STORE_URL_LOCKED'; end if;
  if c.id is null then
   insert into public.crm_integrations(workspace_id,store_id,base_url,created_by,cod_methods,last_test_at)
    values(wid,sid,p->>'base_url',uid,array(select jsonb_array_elements_text(p->'cod_methods')),now()) returning * into c;
  else
   update public.crm_integrations set active=true,generation=generation+1,cod_methods=array(select jsonb_array_elements_text(p->'cod_methods')),updated_at=now(),last_test_at=now(),last_error=null where id=c.id returning * into c;
  end if;
  select * into sec from crm_private.woo_credentials where connection_id=c.id;
  if found then
   select decrypted_secret::jsonb into credentials from vault.decrypted_secrets where id=sec.secret_id;
   credentials:=jsonb_build_object('key',p->>'key','secret',p->>'secret','webhook_secret',credentials->>'webhook_secret');
   perform vault.update_secret(sec.secret_id,credentials::text);
   update crm_private.woo_credentials set lease_token=null,lease_until=null where connection_id=c.id;
  else
   credentials:=jsonb_build_object('key',p->>'key','secret',p->>'secret','webhook_secret',encode(extensions.gen_random_bytes(32),'hex'));
   secret:=vault.create_secret(credentials::text,'weconvert_woo_'||c.id::text,'WooCommerce server credentials');
   insert into crm_private.woo_credentials(connection_id,secret_id) values(c.id,secret);
  end if;
  insert into public.crm_integration_events(connection_id,workspace_id,store_id,outcome,code) values(c.id,c.workspace_id,c.store_id,'connected','CONNECTED');
  return to_jsonb(c);
 end if;
 select * into c from public.crm_integrations where id=(p->>'connection_id')::uuid for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if p_action in ('get_admin','disconnect','begin','finish','tested') then
  uid:=(p->>'actor')::uuid;
  if not exists(select 1 from public.crm_members where workspace_id=c.workspace_id and user_id=uid and active and role in ('owner','admin')) then raise exception 'FORBIDDEN'; end if;
 end if;
 if p_action='disconnect' then
  delete from vault.secrets where id=(select secret_id from crm_private.woo_credentials where connection_id=c.id);
  delete from crm_private.woo_credentials where connection_id=c.id;
  update public.crm_integrations set active=false,generation=generation+1,updated_at=now() where id=c.id;
  insert into public.crm_integration_events(connection_id,workspace_id,store_id,outcome,code) values(c.id,c.workspace_id,c.store_id,'disconnected','DISCONNECTED');
  return '{}'::jsonb;
 end if;
 if not c.active then raise exception 'DISCONNECTED'; end if;
 if p ? 'generation' and c.generation<>(p->>'generation')::integer then raise exception 'CONNECTION_CHANGED'; end if;
 select * into sec from crm_private.woo_credentials where connection_id=c.id;
 if p_action in ('get_admin','get_webhook') then
  select decrypted_secret::jsonb into credentials from vault.decrypted_secrets where id=sec.secret_id;
  if credentials is null then raise exception 'DISCONNECTED'; end if;
  return to_jsonb(c)||jsonb_build_object('credentials',credentials);
 elsif p_action='begin' then
  if sec.lease_until>now() then raise exception 'SYNC_BUSY'; end if;
  if p ? 'after' then
   after_at:=(p->>'after')::timestamptz;before_at:=least(coalesce((p->>'before')::timestamptz,now()),now());
   if after_at is null or after_at<'2000-01-01' or after_at>=before_at then raise exception 'INVALID_DATE'; end if;
   update public.crm_integrations set import_after=after_at,import_before=before_at,import_page=1,import_done=false,import_scanned=0,import_total=null where id=c.id returning * into c;
  end if;
  if c.import_done or c.import_after is null then raise exception 'IMPORT_NOT_STARTED'; end if;
  update crm_private.woo_credentials set lease_token=(p->>'token')::uuid,lease_until=now()+interval '2 minutes' where connection_id=c.id;
  return to_jsonb(c);
 elsif p_action='finish' then
  if sec.lease_token is distinct from (p->>'token')::uuid then raise exception 'SYNC_BUSY'; end if;
  if not coalesce((p->>'failed')::boolean,false) then
   update public.crm_integrations set import_page=import_page+1,import_done=(p->>'done')::boolean,import_scanned=import_scanned+(p->>'scanned')::integer,import_total=(p->>'total')::integer,last_sync_at=now(),last_error=null where id=c.id;
  end if;
  update crm_private.woo_credentials set lease_token=null,lease_until=null where connection_id=c.id;
  return '{}';
 elsif p_action='tested' then
  update public.crm_integrations set last_test_at=now(),last_error=null where id=c.id;return '{}';
 elsif p_action='error' then
  reason:=left(p->>'code',80);
  insert into public.crm_integration_events(connection_id,workspace_id,store_id,external_id,outcome,code) values(c.id,c.workspace_id,c.store_id,(p->>'external_id')::bigint,'error',reason);
  update public.crm_integrations set last_error=reason where id=c.id;return '{}';
 elsif p_action='ping' then
  update public.crm_integrations set last_webhook_at=now() where id=c.id;return '{}';
 elsif p_action<>'ingest' then raise exception 'UNKNOWN_ACTION';
 end if;
 d:=p->'order';h:=p->>'hash';modified:=(d->>'modified_at')::timestamptz;
 if coalesce((d->>'external_id')::bigint,0)<1 or modified is null or h!~'^[a-f0-9]{64}$' then raise exception 'INVALID_ORDER'; end if;
 if not (d ? 'skip') and d->>'remote_status' not in ('pending','on-hold','processing','completed','cancelled','failed','refunded') then raise exception 'INVALID_ORDER'; end if;
 select * into link from crm_private.woo_orders where connection_id=c.id and external_id=(d->>'external_id')::bigint;
 if link.order_id is not null then select * into o from public.crm_orders where id=link.order_id for update;end if;
 proof_id:=d#>>'{tracking,purchase_event_id}';proof_marker:=d#>>'{tracking,purchase_sent_marker}';
 -- The Suite creates an ID before sending. Only a successful Purchase marker bound to this Woo order is evidence.
 if d ? 'tracking' and (jsonb_typeof(d->'tracking')<>'object'
  or proof_id !~ ('^kb_'||(d->>'external_id')||'_[a-f0-9]{12}$')
  or proof_marker !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$'
  or proof_id is null or proof_marker is null) then raise exception 'INVALID_ORDER';end if;
 -- An update to an old Woo order is not a new sale in this CRM. Existing linked orders
 -- can still be refreshed, but unknown orders created before the first connection cannot enter.
 if link.order_id is null and not (d ? 'skip') and (d->>'created_at')::timestamptz<date_trunc('second',c.created_at) then
  insert into public.crm_integration_events(connection_id,workspace_id,store_id,external_id,outcome,code)
   values(c.id,c.workspace_id,c.store_id,(d->>'external_id')::bigint,'skipped','ORDER_PREDATES_CONNECTION');
  return jsonb_build_object('outcome','skipped','code','ORDER_PREDATES_CONNECTION');
 end if;
 -- Existing operational orders are retained; evidence can be attached without changing CRM versions or agent work.
 if o.id is not null and proof_id is not null and o.woo_purchase_event_id is null then
  update public.crm_orders set woo_purchase_event_id=proof_id,woo_purchase_marked_at=proof_marker where id=o.id;
 end if;
 if link.order_id is null and not (d ? 'skip') and not coalesce((p->>'webhook')::boolean,false) and proof_id is null then
  insert into public.crm_integration_events(connection_id,workspace_id,store_id,external_id,outcome,code)
   values(c.id,c.workspace_id,c.store_id,(d->>'external_id')::bigint,'skipped','TRACKING_NOT_PROVEN');
  return jsonb_build_object('outcome','skipped','code','TRACKING_NOT_PROVEN');
 end if;
 if link.last_hash=h then return jsonb_build_object('outcome','unchanged','id',link.order_id);end if;
 if link.last_remote_at>modified then return jsonb_build_object('outcome','stale','id',link.order_id);end if;
 -- A re-scan that changes only the new evidence does not create an ambiguous remote version.
 if o.id is not null and link.last_remote_at=modified and d-'tracking'=o.woo_snapshot-'tracking' then
  update crm_private.woo_orders set last_hash=h where connection_id=c.id and external_id=(d->>'external_id')::bigint;
  return jsonb_build_object('outcome','linked','id',o.id,'code','TRACKING_RECONCILED');
 end if;
 if d ? 'skip' and o.id is null then outcome:='skipped';reason:=d->>'skip';
 elsif o.id is not null and (d ? 'skip' or o.stock_reserved or o.version<>link.synced_version or link.last_remote_at=modified) then
  outcome:='attention';reason:=case when d ? 'skip' then d->>'skip' when link.last_remote_at=modified then 'REMOTE_VERSION_AMBIGUOUS' else 'CRM_EDIT_PRESERVED' end;
  update public.crm_orders set woo_number=d->>'number',woo_status=d->>'remote_status',woo_snapshot=d,woo_attention=true,version=version+1,updated_at=now() where id=o.id returning version into v;
  oid:=o.id;
  insert into public.crm_events(workspace_id,store_id,order_id,actor_id,actor_name,kind,data) values(c.workspace_id,c.store_id,oid,c.created_by,'WooCommerce','woo.attention',jsonb_build_object('reason',reason,'number',d->>'number','status',d->>'remote_status'));
 else
  if jsonb_typeof(d->'items')<>'array' or jsonb_array_length(d->'items') not between 1 and 200 then raise exception 'INVALID_ITEMS';end if;
  -- SKU matches reuse current CRM inventory. Newly discovered items start at zero.
  for it in select value from jsonb_array_elements(d->'items') loop
   pid:=null;
   select product_id into pid from crm_private.woo_products where connection_id=c.id and remote_key=it->>'remote_key';
   if pid is null then
    if nullif(it->>'sku','') is not null then select id into pid from public.crm_products where store_id=c.store_id and sku=it->>'sku';end if;
    if pid is null then
     v_sku:=coalesce(nullif(it->>'sku',''),'WOO-'||left(c.id::text,8)||'-'||replace(it->>'remote_key',':','-'));
     insert into public.crm_products(workspace_id,store_id,name,sku,price,stock) values(c.workspace_id,c.store_id,it->>'name',v_sku,(it->>'unit_price')::numeric,0)
      on conflict(store_id,sku) do nothing returning id into pid;
     if pid is null then select id into pid from public.crm_products where store_id=c.store_id and public.crm_products.sku=v_sku;end if;
    end if;
    insert into crm_private.woo_products(connection_id,remote_key,product_id) values(c.id,it->>'remote_key',pid);
   end if;
   qty:=(it->>'quantity')::integer;price:=(it->>'unit_price')::numeric;
   if qty not between 1 and 10000 or price<0 then raise exception 'INVALID_ITEMS';end if;
   subtotal:=subtotal+qty*price;
   new_items:=new_items||jsonb_build_array(it||jsonb_build_object('product_id',pid));
  end loop;
  if subtotal+(d->>'fee')::numeric-(d->>'discount')::numeric<>(d->>'total')::numeric then raise exception 'INVALID_AMOUNT';end if;
  if o.id is null then
   insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,commune,address,channel,source_detail,fee,discount,total,created_by,created_at,woo_number,woo_status,woo_snapshot,status,woo_purchase_event_id,woo_purchase_marked_at)
    values(c.workspace_id,c.store_id,d->>'customer_name',crm_private.normalize_phone(d->>'phone'),d->>'wilaya',d->>'commune',d->>'address','website','WooCommerce #'||(d->>'number'),(d->>'fee')::numeric,(d->>'discount')::numeric,(d->>'total')::numeric,c.created_by,(d->>'created_at')::timestamptz,d->>'number',d->>'remote_status',d,'new',proof_id,proof_marker)
    returning id,version into oid,v;
   outcome:='imported';reason:='ORDER_IMPORTED';
  else
   oid:=o.id;
   update public.crm_orders set customer_name=d->>'customer_name',phone=crm_private.normalize_phone(d->>'phone'),wilaya=d->>'wilaya',commune=d->>'commune',address=d->>'address',fee=(d->>'fee')::numeric,discount=(d->>'discount')::numeric,total=(d->>'total')::numeric,woo_number=d->>'number',woo_status=d->>'remote_status',woo_snapshot=d,woo_attention=false,version=version+1,updated_at=now() where id=oid returning version into v;
   delete from public.crm_order_items where order_id=oid;
   outcome:='updated';reason:='ORDER_UPDATED';
  end if;
  for it in select value from jsonb_array_elements(new_items) loop
   insert into public.crm_order_items(workspace_id,store_id,order_id,product_id,product_name,sku,quantity,unit_price)
    select c.workspace_id,c.store_id,oid,id,it->>'name',public.crm_products.sku,(it->>'quantity')::integer,(it->>'unit_price')::numeric from public.crm_products where id=(it->>'product_id')::uuid;
  end loop;
  insert into public.crm_events(workspace_id,store_id,order_id,actor_id,actor_name,kind,data) values(c.workspace_id,c.store_id,oid,c.created_by,'WooCommerce','woo.'||outcome,jsonb_build_object('number',d->>'number','status',d->>'remote_status','previous',case when o.id is not null then o.woo_snapshot else null end));
 end if;
 insert into crm_private.woo_orders(connection_id,external_id,order_id,last_hash,last_remote_at,synced_version,last_outcome)
 values(c.id,(d->>'external_id')::bigint,oid,h,modified,case when outcome='attention' then link.synced_version else v end,outcome)
 on conflict(connection_id,external_id) do update set order_id=excluded.order_id,last_hash=excluded.last_hash,last_remote_at=excluded.last_remote_at,synced_version=excluded.synced_version,last_outcome=excluded.last_outcome;
 insert into public.crm_integration_events(connection_id,workspace_id,store_id,external_id,order_id,outcome,code) values(c.id,c.workspace_id,c.store_id,(d->>'external_id')::bigint,oid,outcome,reason);
 if coalesce((p->>'webhook')::boolean,false) then update public.crm_integrations set last_webhook_at=now() where id=c.id;end if;
 return jsonb_build_object('outcome',outcome,'id',oid,'code',reason);
end $$;

create or replace function public.crm_performance(
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
   select channel,count(*) as orders,count(*) filter(where status='confirmed' and status_origin<>'woo_legacy') as confirmed,
    count(*) filter(where status='cancelled' and status_origin<>'woo_legacy') as cancelled,
    coalesce(sum(total) filter(where status='confirmed' and status_origin<>'woo_legacy'),0) as confirmed_amount
   from filtered group by channel
  ) x),
  'wilayas',(select coalesce(jsonb_agg(to_jsonb(x) order by x.orders desc,x.wilaya),'[]'::jsonb) from (
   select wilaya,count(*) as orders,count(*) filter(where status='confirmed' and status_origin<>'woo_legacy') as confirmed,
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
    count(*) as orders,count(*) filter(where f.status='confirmed' and f.status_origin<>'woo_legacy') as confirmed,
    count(*) filter(where f.status='cancelled' and f.status_origin<>'woo_legacy') as cancelled,
    coalesce(sum(f.total) filter(where f.status='confirmed' and f.status_origin<>'woo_legacy'),0) as confirmed_amount
   from filtered f left join public.crm_members m on m.workspace_id=wid and m.user_id=f.assigned_to
   group by f.assigned_to,m.display_name
  ) x)
 ) into result;
 return result;
end $$;

create or replace function public.crm_overview(p_store uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'all',count(*),'new',count(*) filter(where status='new'),
 'pending',count(*) filter(where status in ('new','call1','call2','call3','reported','check')),
 'confirmed',count(*) filter(where status='confirmed'),
 'woo_confirmation_unverified',count(*) filter(where status='confirmed' and status_origin='woo_legacy'),
 'woo_cancellation_unverified',count(*) filter(where status='cancelled' and status_origin='woo_legacy'),
 'confirmed_verified',count(*) filter(where status='confirmed' and status_origin<>'woo_legacy'),
 'confirmed_verified_amount',coalesce(sum(total) filter(where status='confirmed' and status_origin<>'woo_legacy'),0),
 'cancelled',count(*) filter(where status in ('cancelled','duplicate','fake')),
 'callbacks',count(*) filter(where callback_at is not null),'due',count(*) filter(where callback_at<=now()),
 'confirmed_amount',coalesce(sum(total) filter(where status='confirmed' and status_origin<>'woo_legacy'),0),
 'today',count(*) filter(where created_at >= date_trunc('day',now() at time zone 'Africa/Algiers') at time zone 'Africa/Algiers'),
 'days',(select coalesce(jsonb_agg(jsonb_build_object('date',d.day,'count',(select count(*) from public.crm_orders x where x.store_id=p_store and (x.created_at at time zone 'Africa/Algiers')::date=d.day)) order by d.day),'[]'::jsonb)
 from (select ((now() at time zone 'Africa/Algiers')::date-n) as day from generate_series(6,0,-1) n) d)
 ) from public.crm_orders where store_id=p_store
$$;
