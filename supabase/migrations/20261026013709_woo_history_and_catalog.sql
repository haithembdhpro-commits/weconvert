-- Historical COD orders respect Woo status; Woo-confirmed history does not reserve CRM stock.
alter table public.crm_orders add column stock_reserved boolean not null default false;
update public.crm_orders set stock_reserved=true where status='confirmed';
alter table public.crm_orders add constraint crm_reserved_requires_confirmation check(not stock_reserved or status='confirmed');
alter table public.crm_integrations add column catalog_page integer not null default 1,
 add column catalog_offset integer not null default 0,
 add column catalog_variation_page integer not null default 1,
 add column catalog_done boolean not null default true,
 add column catalog_scanned integer not null default 0,
 add column catalog_total integer,
 add column last_catalog_sync_at timestamptz;
alter table crm_private.woo_products add column synced_version integer;
alter table public.crm_integration_events add column entity text not null default 'order'
 check(entity in ('order','product','connection'));

create or replace function crm_private.woo_service(p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.crm_integrations;sec crm_private.woo_credentials;link crm_private.woo_orders;
 o public.crm_orders;sid uuid;wid uuid;uid uuid;secret uuid;credentials jsonb;d jsonb;it jsonb;
 pid uuid;oid uuid;v_sku text;h text;modified timestamptz;outcome text;reason text;v integer;new_items jsonb:='[]';
 qty integer;price numeric(14,2);subtotal numeric(14,2):=0;after_at timestamptz;before_at timestamptz;
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
 if link.last_hash=h then return jsonb_build_object('outcome','unchanged','id',link.order_id);end if;
 if link.last_remote_at>modified then return jsonb_build_object('outcome','stale','id',link.order_id);end if;
 if link.order_id is not null then select * into o from public.crm_orders where id=link.order_id for update;end if;
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
   insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,commune,address,channel,source_detail,fee,discount,total,created_by,created_at,woo_number,woo_status,woo_snapshot,status)
    values(c.workspace_id,c.store_id,d->>'customer_name',crm_private.normalize_phone(d->>'phone'),d->>'wilaya',d->>'commune',d->>'address','website','WooCommerce #'||(d->>'number'),(d->>'fee')::numeric,(d->>'discount')::numeric,(d->>'total')::numeric,c.created_by,(d->>'created_at')::timestamptz,d->>'number',d->>'remote_status',d,case when d->>'remote_status'='completed' then 'confirmed' when d->>'remote_status' in ('cancelled','failed','refunded') then 'cancelled' else 'new' end)
    returning id,version into oid,v;
   outcome:='imported';reason:='ORDER_IMPORTED';
  else
   oid:=o.id;
   update public.crm_orders set customer_name=d->>'customer_name',phone=crm_private.normalize_phone(d->>'phone'),wilaya=d->>'wilaya',commune=d->>'commune',address=d->>'address',fee=(d->>'fee')::numeric,discount=(d->>'discount')::numeric,total=(d->>'total')::numeric,woo_number=d->>'number',woo_status=d->>'remote_status',woo_snapshot=d,woo_attention=false,status=case when d->>'remote_status'='completed' then 'confirmed' when d->>'remote_status' in ('cancelled','failed','refunded') then 'cancelled' else 'new' end,stock_reserved=false,version=version+1,updated_at=now() where id=oid returning version into v;
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

-- Historical Woo confirmation has no CRM stock reservation to release.
create or replace function crm_private.command(p_workspace uuid,p_action text,p_payload jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); m public.crm_members; prev crm_private.requests; o public.crm_orders; p public.crm_products;
 target public.crm_members; sid uuid; oid uuid; pid uuid; assignee uuid; item jsonb; result jsonb; event_data jsonb:='{}';
 ev text; new_status text; qty integer; price numeric(14,2); subtotal numeric(14,2):=0; v_fee numeric(14,2); v_discount numeric(14,2);
 token text; inv_id uuid; cb timestamptz; reason text; r record; stock_delta integer;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>100000 then raise exception 'INVALID_REQUEST'; end if;
 select * into m from public.crm_members where workspace_id=p_workspace and user_id=u and active for share;
 if not found then raise exception 'FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||p_request::text,0));
 select * into prev from crm_private.requests where workspace_id=p_workspace and request_id=p_request;
 if found then
  if prev.actor_id<>u or prev.action<>p_action or prev.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return prev.result;
 end if;
 if p_action in ('order.create','product.save','stock.adjust','store.create') then
  sid:=(p_payload->>'store_id')::uuid;
  if p_action<>'store.create' and not exists(select 1 from public.crm_stores where id=sid and workspace_id=p_workspace) then raise exception 'NOT_FOUND'; end if;
 end if;
 if p_action like 'order.%' and p_action<>'order.create' then
  oid:=(p_payload->>'id')::uuid;
  select * into o from public.crm_orders where id=oid and workspace_id=p_workspace for update;
  if not found or (m.role='agent' and o.assigned_to is distinct from u) then raise exception 'NOT_FOUND'; end if;
  sid:=o.store_id;
  if o.version is distinct from (p_payload->>'version')::integer then raise exception 'VERSION_CONFLICT'; end if;
 end if;

 if p_action in ('order.create','order.edit') then
  if p_action='order.edit' and o.status not in ('new','call1','call2','call3','reported','check') then raise exception 'ORDER_LOCKED'; end if;
  if p_action='order.create' then
   assignee:=case when m.role='agent' then u else nullif(p_payload->>'assigned_to','')::uuid end;
  else assignee:=o.assigned_to; end if;
  if assignee is not null and not exists(select 1 from public.crm_members where workspace_id=p_workspace and user_id=assignee and active) then raise exception 'INVALID_AGENT'; end if;
  v_fee:=coalesce((p_payload->>'fee')::numeric,0); v_discount:=coalesce((p_payload->>'discount')::numeric,0);
  if v_fee<0 or v_discount<0 or (m.role='agent' and v_discount<>case when p_action='order.edit' then o.discount else 0 end) then raise exception 'INVALID_AMOUNT'; end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'INVALID_ITEMS'; end if;
  if (select count(*)<>count(distinct x->>'product_id') from jsonb_array_elements(p_payload->'items') x) then raise exception 'DUPLICATE_ITEM'; end if;
  for item in select value from jsonb_array_elements(p_payload->'items') order by value->>'product_id' loop
   select * into p from public.crm_products where id=(item->>'product_id')::uuid and workspace_id=p_workspace and store_id=sid for share;
   if not found then raise exception 'INVALID_PRODUCT'; end if;
   qty:=(item->>'quantity')::integer; price:=(item->>'unit_price')::numeric;
   if qty is null or qty not between 1 and 10000 or price is null or price<0 then raise exception 'INVALID_ITEMS'; end if;
   if m.role='agent' and price<>p.price and not (p_action='order.edit' and exists(select 1 from public.crm_order_items i where i.order_id=oid and i.product_id=p.id and i.unit_price=price)) then raise exception 'PRICE_FORBIDDEN'; end if;
   subtotal:=subtotal+qty*price;
  end loop;
  if subtotal+v_fee-v_discount<0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_action='order.create' then
   insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,commune,address,channel,source_detail,delivery_type,assigned_to,fee,discount,total,created_by)
   values(p_workspace,sid,trim(p_payload->>'customer_name'),crm_private.normalize_phone(p_payload->>'phone'),trim(p_payload->>'wilaya'),trim(coalesce(p_payload->>'commune','')),trim(coalesce(p_payload->>'address','')),p_payload->>'channel',coalesce(p_payload->>'source_detail',''),coalesce(p_payload->>'delivery_type','home'),assignee,v_fee,v_discount,subtotal+v_fee-v_discount,u) returning id into oid;
   ev:='order.created'; event_data:=jsonb_build_object('channel',p_payload->>'channel','assigned_to',assignee);
  else
   update public.crm_orders set customer_name=trim(p_payload->>'customer_name'),phone=crm_private.normalize_phone(p_payload->>'phone'),wilaya=trim(p_payload->>'wilaya'),commune=trim(coalesce(p_payload->>'commune','')),address=trim(coalesce(p_payload->>'address','')),channel=p_payload->>'channel',source_detail=coalesce(p_payload->>'source_detail',''),delivery_type=coalesce(p_payload->>'delivery_type','home'),fee=v_fee,discount=v_discount,total=subtotal+v_fee-v_discount where id=oid;
   ev:='order.edited'; event_data:=jsonb_build_object('previous',to_jsonb(o)-'created_by','previous_items',(select jsonb_agg(to_jsonb(i)) from public.crm_order_items i where order_id=oid),'changes',p_payload-'id'-'version');
   delete from public.crm_order_items where order_id=oid;
  end if;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
   select * into p from public.crm_products where id=(item->>'product_id')::uuid and store_id=sid;
   insert into public.crm_order_items(workspace_id,store_id,order_id,product_id,product_name,sku,quantity,unit_price)
   values(p_workspace,sid,oid,p.id,p.name,p.sku,(item->>'quantity')::integer,(item->>'unit_price')::numeric);
  end loop;
 elsif p_action='order.status' then
  new_status:=p_payload->>'status'; reason:=trim(coalesce(p_payload->>'reason',''));
  if new_status not in ('new','check','confirmed','cancelled','duplicate','fake') or new_status is null then raise exception 'INVALID_TRANSITION'; end if;
  if o.status=new_status then raise exception 'INVALID_TRANSITION'; end if;
  if o.status in ('confirmed','cancelled','duplicate','fake') and not (m.role in ('owner','admin') and new_status in ('new','cancelled') and new_status<>o.status) then raise exception 'INVALID_TRANSITION'; end if;
  if new_status in ('cancelled','duplicate','fake','new') and length(reason) not between 2 and 2000 then raise exception 'REASON_REQUIRED'; end if;
  if new_status='confirmed' and (length(trim(o.address))<3 or length(trim(o.commune))<2) then raise exception 'ADDRESS_REQUIRED'; end if;
  -- Lock products in deterministic order; a second confirmation cannot oversell.
  if new_status='confirmed' or o.stock_reserved then
   for r in select i.product_id,i.quantity from public.crm_order_items i where order_id=oid order by product_id loop
    select * into p from public.crm_products where id=r.product_id for update;
    if new_status='confirmed' and p.stock-p.reserved<r.quantity then raise exception 'INSUFFICIENT_STOCK: %',p.name; end if;
    update public.crm_products set reserved=reserved+case when new_status='confirmed' then r.quantity else -r.quantity end,version=version+1 where id=p.id;
   end loop;
  end if;
  update public.crm_orders set status=new_status,stock_reserved=(new_status='confirmed'),callback_at=null where id=oid;
  ev:='order.status'; event_data:=jsonb_build_object('from',o.status,'to',new_status,'reason',reason);
 elsif p_action='order.call' then
  if o.status not in ('new','call1','call2','call3','reported','check') then raise exception 'ORDER_LOCKED'; end if;
  update public.crm_orders set attempts=attempts+1,status=case when attempts=0 then 'call1' when attempts=1 then 'call2' else 'call3' end,callback_at=null where id=oid;
  ev:='order.call'; event_data:=jsonb_build_object('outcome','no_answer','attempt',o.attempts+1);
 elsif p_action='order.callback' then
  if o.status not in ('new','call1','call2','call3','reported','check') then raise exception 'ORDER_LOCKED'; end if;
  cb:=(p_payload->>'callback_at')::timestamptz;
  if cb is null or cb<now() or cb>now()+interval '1 year' then raise exception 'INVALID_CALLBACK'; end if;
  reason:=trim(coalesce(p_payload->>'note',''));
  if length(reason)>2000 then raise exception 'INVALID_NOTE'; end if;
  update public.crm_orders set status='reported',callback_at=cb where id=oid;
  ev:='order.callback'; event_data:=jsonb_build_object('callback_at',cb,'note',reason);
 elsif p_action='order.note' then
  reason:=trim(coalesce(p_payload->>'note',''));
  if length(reason) not between 1 and 2000 then raise exception 'INVALID_NOTE'; end if;
  ev:='order.note'; event_data:=jsonb_build_object('note',reason);
 elsif p_action='order.assign' then
  if m.role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
  assignee:=nullif(p_payload->>'assigned_to','')::uuid;
  if assignee is not null and not exists(select 1 from public.crm_members where workspace_id=p_workspace and user_id=assignee and active) then raise exception 'INVALID_AGENT'; end if;
  update public.crm_orders set assigned_to=assignee where id=oid;
  ev:='order.assigned'; event_data:=jsonb_build_object('from',o.assigned_to,'to',assignee);
 elsif p_action='product.save' then
  if m.role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
  pid:=nullif(p_payload->>'id','')::uuid;
  if pid is null then
   insert into public.crm_products(workspace_id,store_id,name,sku,price,stock) values(p_workspace,sid,trim(p_payload->>'name'),trim(p_payload->>'sku'),(p_payload->>'price')::numeric,coalesce((p_payload->>'stock')::integer,0)) returning id into pid;
  else
   select * into p from public.crm_products where id=pid and workspace_id=p_workspace and store_id=sid for update;
   if not found then raise exception 'NOT_FOUND'; end if;
   if p.version is distinct from (p_payload->>'version')::integer then raise exception 'VERSION_CONFLICT'; end if;
   update public.crm_products set name=trim(p_payload->>'name'),sku=trim(p_payload->>'sku'),price=(p_payload->>'price')::numeric,version=version+1 where id=pid;
  end if;
  ev:='product.saved'; event_data:=jsonb_build_object('product_id',pid,'values',p_payload);
  result:=jsonb_build_object('id',pid);
 elsif p_action='stock.adjust' then
  if m.role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
  pid:=(p_payload->>'id')::uuid; stock_delta:=(p_payload->>'delta')::integer; reason:=trim(coalesce(p_payload->>'reason',''));
  if stock_delta is null or stock_delta=0 or length(reason) not between 2 and 2000 then raise exception 'INVALID_ADJUSTMENT'; end if;
  select * into p from public.crm_products where id=pid and workspace_id=p_workspace and store_id=sid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p.version is distinct from (p_payload->>'version')::integer then raise exception 'VERSION_CONFLICT'; end if;
  if p.stock+stock_delta<p.reserved then raise exception 'STOCK_RESERVED'; end if;
  update public.crm_products set stock=stock+stock_delta,version=version+1 where id=pid;
  ev:='stock.adjusted'; event_data:=jsonb_build_object('product_id',pid,'delta',stock_delta,'reason',reason,'before',p.stock,'after',p.stock+stock_delta);
  result:=jsonb_build_object('id',pid);
 elsif p_action='store.create' then
  if m.role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
  insert into public.crm_stores(workspace_id,name) values(p_workspace,trim(p_payload->>'name')) returning id into sid;
  ev:='store.created'; event_data:=jsonb_build_object('name',p_payload->>'name'); result:=jsonb_build_object('id',sid);
 elsif p_action='member.invite' then
  if m.role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
  if (p_payload->>'role') not in ('admin','agent') or (m.role='admin' and p_payload->>'role'<>'agent') then raise exception 'FORBIDDEN'; end if;
  if coalesce(p_payload->>'email','') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(p_payload->>'email')>254 or length(trim(coalesce(p_payload->>'display_name',''))) not between 2 and 100 then raise exception 'INVALID_MEMBER'; end if;
  token:=gen_random_uuid()::text||gen_random_uuid()::text;
  insert into crm_private.invitations(workspace_id,email,display_name,role,token_hash,created_by)
  values(p_workspace,lower(trim(p_payload->>'email')),trim(p_payload->>'display_name'),p_payload->>'role',encode(sha256(convert_to(token,'UTF8')),'hex'),u) returning id into inv_id;
  ev:='member.invited'; event_data:=jsonb_build_object('invitation_id',inv_id,'role',p_payload->>'role'); result:=jsonb_build_object('token',token,'expires_at',now()+interval '7 days');
 elsif p_action='member.update' then
  if m.role<>'owner' then raise exception 'FORBIDDEN'; end if;
  select * into target from public.crm_members where workspace_id=p_workspace and user_id=(p_payload->>'user_id')::uuid for update;
  if not found or target.role='owner' then raise exception 'FORBIDDEN'; end if;
  if p_payload->>'role' not in ('admin','agent') then raise exception 'INVALID_MEMBER'; end if;
  update public.crm_members set role=p_payload->>'role',active=(p_payload->>'active')::boolean where workspace_id=p_workspace and user_id=target.user_id;
  ev:='member.updated'; event_data:=jsonb_build_object('user_id',target.user_id,'role',p_payload->>'role','active',p_payload->'active'); result:='{}';
 else raise exception 'UNKNOWN_ACTION';
 end if;
 if oid is not null then
  if p_action<>'order.create' then update public.crm_orders set version=version+1,updated_at=now() where id=oid; end if;
  select jsonb_build_object('id',id,'number',number,'version',version,'status',status) into result from public.crm_orders where id=oid;
 end if;
 insert into public.crm_events(workspace_id,store_id,order_id,actor_id,actor_name,kind,data) values(p_workspace,sid,oid,u,m.display_name,ev,event_data);
 insert into crm_private.requests(workspace_id,request_id,actor_id,action,payload,result) values(p_workspace,p_request,u,p_action,p_payload,result);
 return result;
end $$;

-- Catalog import is separate from order ingestion. The same server-side lease prevents
-- overlapping jobs; external clients cannot call either privileged function directly.
create function crm_private.woo_catalog_service(p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.crm_integrations;sec crm_private.woo_credentials;link crm_private.woo_products;
 prod public.crm_products;d jsonb;uid uuid;pid uuid;v_sku text;v_name text;v_price numeric(14,2);
 v_stock integer;managed boolean;outcome text;code text;remote text;v integer;external bigint;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>10000 then raise exception 'INVALID_REQUEST';end if;
 select * into c from public.crm_integrations where id=(p->>'connection_id')::uuid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if p_action in ('catalog.begin','catalog.finish') then
  uid:=(p->>'actor')::uuid;
  if not exists(select 1 from public.crm_members where workspace_id=c.workspace_id and user_id=uid and active and role in ('owner','admin')) then raise exception 'FORBIDDEN';end if;
 end if;
 if not c.active then raise exception 'DISCONNECTED';end if;
 if c.generation is distinct from (p->>'generation')::integer then raise exception 'CONNECTION_CHANGED';end if;
 select * into sec from crm_private.woo_credentials where connection_id=c.id for update;
 if not found then raise exception 'DISCONNECTED';end if;
 if p_action='catalog.begin' then
  if sec.lease_until>now() then raise exception 'SYNC_BUSY';end if;
  if coalesce((p->>'reset')::boolean,false) then
   update public.crm_integrations set catalog_page=1,catalog_offset=0,catalog_variation_page=1,catalog_done=false,catalog_scanned=0,catalog_total=null where id=c.id returning * into c;
  end if;
  if c.catalog_done then raise exception 'IMPORT_NOT_STARTED';end if;
  update crm_private.woo_credentials set lease_token=(p->>'token')::uuid,lease_until=now()+interval '2 minutes' where connection_id=c.id;
  return to_jsonb(c);
 elsif p_action='catalog.finish' then
  if sec.lease_token is distinct from (p->>'token')::uuid then raise exception 'SYNC_BUSY';end if;
  if not coalesce((p->>'failed')::boolean,false) then
   if (p->>'page')::integer<1 or (p->>'offset')::integer not between 0 and 25 or (p->>'variation_page')::integer<1 or (p->>'scanned')::integer not between 0 and 25 then raise exception 'INVALID_REQUEST';end if;
   update public.crm_integrations set catalog_page=(p->>'page')::integer,catalog_offset=(p->>'offset')::integer,
    catalog_variation_page=(p->>'variation_page')::integer,catalog_done=(p->>'done')::boolean,
    catalog_scanned=catalog_scanned+(p->>'scanned')::integer,catalog_total=(p->>'total')::integer,
    last_catalog_sync_at=now(),last_error=null where id=c.id;
  end if;
  update crm_private.woo_credentials set lease_token=null,lease_until=null where connection_id=c.id;
  return '{}'::jsonb;
 elsif p_action='catalog.error' then
  if sec.lease_token is distinct from (p->>'token')::uuid then raise exception 'SYNC_BUSY';end if;
  insert into public.crm_integration_events(connection_id,workspace_id,store_id,external_id,outcome,code,entity)
   values(c.id,c.workspace_id,c.store_id,(p->>'external_id')::bigint,'error',left(p->>'code',80),'product');
  update public.crm_integrations set last_error=left(p->>'code',80) where id=c.id;
  return '{}'::jsonb;
 elsif p_action<>'catalog.ingest' then raise exception 'UNKNOWN_ACTION';end if;
 if sec.lease_token is distinct from (p->>'token')::uuid or sec.lease_until<now() then raise exception 'SYNC_BUSY';end if;
 d:=p->'product';remote:=d->>'remote_key';
 if remote !~ '^[pv]:[1-9][0-9]*$' or length(remote)>40 then raise exception 'INVALID_PRODUCT';end if;
 external:=split_part(remote,':',2)::bigint;
 if d ? 'skip' then outcome:='skipped';code:=left(d->>'skip',80);
 else
  v_name:=trim(d->>'name');v_sku:=nullif(trim(coalesce(d->>'sku','')),'');v_price:=(d->>'price')::numeric;
  managed:=coalesce((d->>'stock_managed')::boolean,false);v_stock:=(d->>'stock')::integer;
  if length(v_name) not between 2 and 160 or length(v_sku)>80 or v_price<0 or v_price is null or (managed and (v_stock is null or v_stock<0)) then raise exception 'INVALID_PRODUCT';end if;
  select * into link from crm_private.woo_products where connection_id=c.id and remote_key=remote;
  if link.product_id is not null then
   select * into prod from public.crm_products where id=link.product_id and store_id=c.store_id for update;
   if not found then raise exception 'INVALID_PRODUCT';end if;
   if link.synced_version is null and not exists(
    select 1 from public.crm_events e where e.workspace_id=c.workspace_id and e.store_id=c.store_id
    and e.kind in ('product.saved','stock.adjusted') and e.data->>'product_id'=prod.id::text
   ) then link.synced_version:=prod.version;end if;
   if link.synced_version is null or prod.version<>link.synced_version or (managed and v_stock<prod.reserved) then
    outcome:='attention';code:='PRODUCT_CRM_PRESERVED';
   elsif prod.name=v_name and prod.price=v_price and (not managed or prod.stock=v_stock) then
    outcome:='unchanged';code:='PRODUCT_UNCHANGED';
   else
    update public.crm_products set name=v_name,price=v_price,stock=case when managed then v_stock else stock end,version=version+1 where id=prod.id returning version into v;
    update crm_private.woo_products set synced_version=v where connection_id=c.id and remote_key=remote;
    outcome:='updated';code:='PRODUCT_UPDATED';
   end if;
   pid:=prod.id;
  else
   if v_sku is not null then select * into prod from public.crm_products where store_id=c.store_id and sku=v_sku for update;end if;
   if prod.id is not null then
    pid:=prod.id;outcome:='linked';code:='PRODUCT_MATCHED_SKU';
    insert into crm_private.woo_products(connection_id,remote_key,product_id) values(c.id,remote,pid);
   else
    v_sku:=coalesce(v_sku,'WOO-'||left(c.id::text,8)||'-'||replace(remote,':','-'));
    insert into public.crm_products(workspace_id,store_id,name,sku,price,stock)
     values(c.workspace_id,c.store_id,v_name,v_sku,v_price,case when managed then v_stock else 0 end)
     on conflict(store_id,sku) do nothing returning id,version into pid,v;
    if pid is null then
     select id into pid from public.crm_products where store_id=c.store_id and sku=v_sku;
     outcome:='linked';code:='PRODUCT_MATCHED_SKU';
    else outcome:='imported';code:=case when managed then 'PRODUCT_IMPORTED' else 'PRODUCT_STOCK_UNMANAGED' end;end if;
    insert into crm_private.woo_products(connection_id,remote_key,product_id,synced_version)
     values(c.id,remote,pid,case when outcome='imported' then v else null end);
   end if;
  end if;
 end if;
 if outcome<>'unchanged' then
  insert into public.crm_integration_events(connection_id,workspace_id,store_id,external_id,outcome,code,entity)
   values(c.id,c.workspace_id,c.store_id,external,outcome,code,'product');
 end if;
 return jsonb_build_object('outcome',outcome,'id',pid,'code',code);
end $$;
revoke all on function crm_private.woo_catalog_service(text,jsonb) from public,anon,authenticated;
grant execute on function crm_private.woo_catalog_service(text,jsonb) to service_role;
create or replace function public.crm_woo_service(p_action text,p jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select case when p_action in ('catalog.begin','catalog.finish','catalog.ingest','catalog.error')
  then crm_private.woo_catalog_service(p_action,p) else crm_private.woo_service(p_action,p) end
$$;
