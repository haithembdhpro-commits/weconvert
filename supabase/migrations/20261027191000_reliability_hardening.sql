-- Reliability and integrity hardening from the 27/10/2026 audit. Each function below is the latest
-- definition copied verbatim with only the commented changes applied.

-- 1. Two source lines may map to the same CRM product (shared parent SKU, duplicate Shopify SKU).
--    The old unique(order_id,product_id) rejected such orders forever. Lines keep their own name/price.
alter table public.crm_order_items drop constraint if exists crm_order_items_order_id_product_id_key;
create index if not exists crm_order_items_order_product_idx on public.crm_order_items(order_id,product_id);


-- 2. command: SHIPMENT_ACTIVE guard; stock reservation no longer bumps crm_products.version.
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
  -- A parcel handed to the carrier keeps its order: reopening/cancelling would free stock that left the shelf.
  if o.status='confirmed' and exists(select 1 from public.crm_shipments s where s.order_id=oid and s.state not in ('cancelled','returned')) then raise exception 'SHIPMENT_ACTIVE'; end if;
  -- Lock products in deterministic order; a second confirmation cannot oversell.
  if new_status='confirmed' or o.stock_reserved then
   for r in select i.product_id,i.quantity from public.crm_order_items i where order_id=oid order by product_id loop
    select * into p from public.crm_products where id=r.product_id for update;
    if new_status='confirmed' and p.stock-p.reserved<r.quantity then raise exception 'INSUFFICIENT_STOCK: %',p.name; end if;
    update public.crm_products set reserved=reserved+case when new_status='confirmed' then r.quantity else -r.quantity end where id=p.id;
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

-- 3. woo_service: never rewrite a legacy-confirmed or already shipped order from a webhook; flag it instead.
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
 elsif o.id is not null and (d ? 'skip' or o.stock_reserved or o.version<>link.synced_version or link.last_remote_at=modified
   or o.status_origin='woo_legacy' or exists(select 1 from public.crm_shipments s where s.order_id=o.id)) then
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

-- 4. source_service: same protection for Shopify/YouCan orders that already have a parcel.
create or replace function crm_private.source_service(p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
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
end $$;

-- 5. ZR: only a phone-confirmed CRM order with no pending source change can be shipped.
create or replace function crm_private.shipping_service(p_action text,p jsonb) returns jsonb
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
  if o.status<>'confirmed' or o.woo_attention or o.source_attention or o.status_origin<>'crm' then raise exception 'ORDER_NOT_READY';end if;
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

create or replace function crm_private.shipping_dashboard(p_store uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare wid uuid; pending jsonb; shipments jsonb;
begin
 select workspace_id into wid from public.crm_stores where id=p_store;
 if wid is null or crm_private.member_role(wid) not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]'::jsonb) into pending from (
  select o.id,o.number,o.customer_name,o.phone,o.wilaya,o.commune,o.address,o.delivery_type,o.total,o.created_at,
   (select coalesce(jsonb_agg(jsonb_build_object('name',i.product_name,'quantity',i.quantity) order by i.id),'[]'::jsonb)
    from public.crm_order_items i where i.order_id=o.id) items
  from public.crm_orders o where o.store_id=p_store and o.status='confirmed' and not o.woo_attention and not o.source_attention and o.status_origin='crm'
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

-- 6. woo_ack checks access before taking a row lock.
create or replace function crm_private.woo_ack(p_order uuid,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare o public.crm_orders;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
 if not crm_private.can_read_order(p_order) then raise exception 'NOT_FOUND';end if;
 select * into o from public.crm_orders where id=p_order for update;
 if not found or not crm_private.can_read_order(p_order) then raise exception 'NOT_FOUND';end if;
 if o.version<>p_version then raise exception 'VERSION_CONFLICT';end if;
 if not o.woo_attention then return;end if;
 update public.crm_orders set woo_attention=false,version=version+1,updated_at=now() where id=p_order;
 insert into public.crm_events(workspace_id,store_id,order_id,actor_id,actor_name,kind) select o.workspace_id,o.store_id,o.id,auth.uid(),display_name,'woo.reviewed' from public.crm_members where workspace_id=o.workspace_id and user_id=auth.uid();
end $$;

-- 7. Acknowledge a Shopify/YouCan source change after review (managers only), mirroring woo_ack.
create or replace function crm_private.source_ack(p_order uuid,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare o public.crm_orders;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
 if not crm_private.can_read_order(p_order) then raise exception 'NOT_FOUND';end if;
 select * into o from public.crm_orders where id=p_order for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if crm_private.member_role(o.workspace_id) not in ('owner','admin') then raise exception 'FORBIDDEN';end if;
 if o.version<>p_version then raise exception 'VERSION_CONFLICT';end if;
 if not o.source_attention then return;end if;
 update public.crm_orders set source_attention=false,version=version+1,updated_at=now() where id=p_order;
 insert into public.crm_events(workspace_id,store_id,order_id,actor_id,actor_name,kind)
  select o.workspace_id,o.store_id,o.id,auth.uid(),m.display_name,'source.reviewed' from public.crm_members m where m.workspace_id=o.workspace_id and m.user_id=auth.uid();
end $$;
create or replace function public.crm_source_ack(p_order uuid,p_version integer) returns void language sql security invoker set search_path='' as $$select crm_private.source_ack(p_order,p_version)$$;
revoke all on function crm_private.source_ack(uuid,integer),public.crm_source_ack(uuid,integer) from public,anon;
grant execute on function crm_private.source_ack(uuid,integer),public.crm_source_ack(uuid,integer) to authenticated;


-- 8. Phone: accept the common "+213 0XXXXXXXXX" and "213XXXXXXXXX" spellings, as the Edge Functions now do.
create or replace function crm_private.normalize_phone(p text) returns text language plpgsql immutable set search_path='' as $$
declare s text:=regexp_replace(trim(p),'[\s().-]','','g');
begin
 if s ~ '^00' then s:='+'||substring(s from 3); end if;
 if s ~ '^\+2130[567][0-9]{8}$' then s:='+213'||substring(s from 6); end if; -- "+213 0551…"
 if s ~ '^213[567][0-9]{8}$' then s:='+'||s; end if;
 if s ~ '^0[567][0-9]{8}$' then s:='+213'||substring(s from 2); end if;
 if s !~ '^\+[0-9]{8,15}$' or (s like '+213%' and s !~ '^\+213[567][0-9]{8}$') then raise exception 'INVALID_PHONE'; end if;
 return s;
end $$;

-- 9. Expenses: a retried submission with the same request id is stored once.
alter table public.crm_cost_entries add column if not exists request_id uuid;
create unique index if not exists crm_cost_entries_request_idx on public.crm_cost_entries(store_id,request_id);
create or replace function crm_private.cost_command(p_store uuid,p_action text,p jsonb) returns jsonb
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
  if p ? 'request_id' and (p->>'request_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_REQUEST';end if;
  insert into public.crm_cost_entries(workspace_id,store_id,spent_on,kind,amount,note,created_by,request_id)
   values(wid,p_store,(p->>'spent_on')::date,p->>'kind',v,coalesce(p->>'note',''),uid,(p->>'request_id')::uuid)
   on conflict(store_id,request_id) do nothing;
 elsif p_action='delete_expense' then
  delete from public.crm_cost_entries where id=(p->>'id')::uuid and store_id=p_store;
  if not found then raise exception 'NOT_FOUND';end if;
 else raise exception 'INVALID_REQUEST';end if;
 return '{}'::jsonb;
end $$;

-- 10. Delivery report: "shipped" now means handed to the carrier (not cancelled/awaiting pickup/unverified).
--     "attached" keeps the old meaning; "closed" = delivered + returned for the final delivery rate.
create or replace function public.crm_delivery_performance(p_store uuid,p_from date,p_to date,p_channel text default null) returns jsonb
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
   count(*) filter(where shipment_id is not null) attached,
   count(*) filter(where shipment_id is not null and state not in ('sending','needs_review','cancelled','submitted')) shipped,
   count(*) filter(where state in ('delivered','returned')) closed,
   count(*) filter(where state='delivered') delivered,
   count(*) filter(where state='delivered' and woo_number is not null) woo_delivered,
   count(*) filter(where state='returned') returned,
   count(*) filter(where state in ('returning','failed_delivery')) delivery_issues,
   coalesce(sum(cod_amount) filter(where state='delivered'),0) delivered_cod,
   coalesce(sum(product_cost) filter(where state='delivered' and missing_items=0),0) known_product_cost,
   coalesce(sum(delivery_cost+return_cost+other_cost) filter(where shipment_id is not null and delivery_cost is not null),0) known_shipping_cost,
   count(*) filter(where state='delivered' and (missing_items>0 or product_cost is null)) missing_product_cost,
   count(*) filter(where shipment_id is not null and delivery_cost is null) missing_shipping_cost
  from cohort
 ), spend as (
  select coalesce(sum(amount) filter(where kind='ads'),0) ads,
   coalesce(sum(amount) filter(where kind='operations'),0) operations
  from public.crm_cost_entries where store_id=p_store and spent_on between p_from and p_to
 ), channels as (
  select channel,count(*) orders,count(*) filter(where shipment_id is not null and state not in ('sending','needs_review','cancelled','submitted')) shipped,
   count(*) filter(where state='delivered') delivered,count(*) filter(where state='returned') returned,
   coalesce(sum(cod_amount) filter(where state='delivered'),0) delivered_cod
  from cohort group by channel
 )
 select jsonb_build_object('period',jsonb_build_object('from',p_from,'to',p_to,'timezone','Africa/Algiers'),
  'summary',to_jsonb(t)||jsonb_build_object(
   'contribution',case when t.missing_product_cost=0 and t.missing_shipping_cost=0 then
    t.delivered_cod-t.known_product_cost-t.known_shipping_cost else null end,
   'after_recorded_expenses',case when p_channel is null and t.missing_product_cost=0 and t.missing_shipping_cost=0 then
    t.delivered_cod-t.known_product_cost-t.known_shipping_cost-e.ads-e.operations else null end,
   'ads_recorded',e.ads,'operations_recorded',e.operations),
  'channels',(select coalesce(jsonb_agg(to_jsonb(c) order by c.orders desc),'[]'::jsonb) from channels c))
 into result from totals t cross join spend e;
 return result;
end $$;

-- 11. ZR status cron: failing parcels back off (15 min doubling, max 12 h) instead of taking every slot forever.
alter table public.crm_shipments add column if not exists last_attempt_at timestamptz, add column if not exists attempt_errors integer not null default 0;
create or replace function public.crm_zr_sync_queue() returns setof public.crm_shipments
language sql security definer set search_path='' as $$
 with picked as (
  select s.id from public.crm_shipments s
  join public.crm_shipping_connections c on c.id=s.connection_id and c.active
  where s.state not in ('sending','needs_review')
   and coalesce(s.last_attempt_at,'-infinity'::timestamptz) < now()-least(interval '15 minutes'*power(2,least(s.attempt_errors,6)),interval '12 hours')
   and (s.last_checked_at is null or s.last_checked_at <
     now()-case when s.state in ('delivered','returned','cancelled') then interval '12 hours' else interval '15 minutes' end)
  order by s.last_attempt_at asc nulls first,s.last_checked_at asc nulls first,s.id limit 12
  for update of s skip locked)
 update public.crm_shipments s set last_attempt_at=now() from picked where s.id=picked.id returning s.*
$$;

create or replace function public.crm_zr_cron_track(p_shipment uuid,p jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare s public.crm_shipments;stage text:=p->>'state';raw text:=left(p->>'raw_status',200);
begin
 select * into s from public.crm_shipments where id=p_shipment and state not in ('sending','needs_review') for update;
 if s.id is null then raise exception 'NOT_FOUND';end if;
 if stage not in ('submitted','in_transit','out_for_delivery','ready_for_pickup','delivered','failed_delivery','returning','returned','cancelled','exception','unknown') or
   (s.remote_id is not null and s.remote_id is distinct from p->>'remote_id') then raise exception 'INVALID_STATUS';end if;
 if s.state is distinct from stage or s.raw_status is distinct from raw then
  update public.crm_shipments set state=stage,raw_status=raw,updated_at=now(),last_checked_at=now(),last_error=null,attempt_errors=0 where id=s.id;
  insert into public.crm_shipping_events(shipment_id,workspace_id,store_id,order_id,state,raw_status,kind)
   values(s.id,s.workspace_id,s.store_id,s.order_id,stage,raw,'status.changed');
 else update public.crm_shipments set last_checked_at=now(),attempt_errors=0 where id=s.id;end if;
end $$;

create or replace function public.crm_zr_cron_failed(p_shipment uuid,p_code text) returns void
language sql security definer set search_path='' as $$
 update public.crm_shipments set attempt_errors=least(attempt_errors+1,1000),last_error=left(coalesce(p_code,'ZR_SYNC_FAILED'),80) where id=p_shipment
$$;
revoke all on function public.crm_zr_cron_failed(uuid,text) from public,anon,authenticated;
grant execute on function public.crm_zr_cron_failed(uuid,text) to service_role;
revoke all on function public.crm_zr_sync_queue() from public,anon,authenticated;
grant execute on function public.crm_zr_sync_queue() to service_role;


-- 12. Realtime signal row is touched at commit (deferred), so it no longer serialises a store or deadlocks with product locks.
drop trigger if exists crm_orders_live on public.crm_orders;
create constraint trigger crm_orders_live after insert or update on public.crm_orders deferrable initially deferred for each row execute function crm_private.touch_live_store();
drop trigger if exists crm_items_live on public.crm_order_items;
create constraint trigger crm_items_live after insert or update on public.crm_order_items deferrable initially deferred for each row execute function crm_private.touch_live_store();
drop trigger if exists crm_products_live on public.crm_products;
create constraint trigger crm_products_live after insert or update on public.crm_products deferrable initially deferred for each row execute function crm_private.touch_live_store();
drop trigger if exists crm_integrations_live on public.crm_integrations;
create constraint trigger crm_integrations_live after insert or update on public.crm_integrations deferrable initially deferred for each row execute function crm_private.touch_live_store();
drop trigger if exists crm_integration_events_live on public.crm_integration_events;
create constraint trigger crm_integration_events_live after insert on public.crm_integration_events deferrable initially deferred for each row execute function crm_private.touch_live_store();
drop trigger if exists crm_shipping_connections_live on public.crm_shipping_connections;
create constraint trigger crm_shipping_connections_live after insert or update on public.crm_shipping_connections deferrable initially deferred for each row execute function crm_private.touch_live_store();
drop trigger if exists crm_shipments_live on public.crm_shipments;
create constraint trigger crm_shipments_live after insert or update on public.crm_shipments deferrable initially deferred for each row execute function crm_private.touch_live_store();
drop trigger if exists crm_source_events_live on public.crm_source_events;
create constraint trigger crm_source_events_live after insert on public.crm_source_events deferrable initially deferred for each row execute function crm_private.touch_live_store();

