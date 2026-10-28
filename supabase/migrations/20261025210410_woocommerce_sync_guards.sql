-- Preserve ambiguous same-second Woo updates for manual review; search external references.
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
   after_at:=(p->>'after')::timestamptz;before_at:=now();
   if after_at is null or after_at<'2000-01-01' or after_at>before_at then raise exception 'INVALID_DATE'; end if;
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
 select * into link from crm_private.woo_orders where connection_id=c.id and external_id=(d->>'external_id')::bigint;
 if link.last_hash=h then return jsonb_build_object('outcome','unchanged','id',link.order_id);end if;
 if link.last_remote_at>modified then return jsonb_build_object('outcome','stale','id',link.order_id);end if;
 if link.order_id is not null then select * into o from public.crm_orders where id=link.order_id for update;end if;
 if d ? 'skip' and o.id is null then outcome:='skipped';reason:=d->>'skip';
 elsif o.id is not null and (d ? 'skip' or o.status<>'new' or o.version<>link.synced_version or link.last_remote_at=modified) then
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
   insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,commune,address,channel,source_detail,fee,discount,total,created_by,created_at,woo_number,woo_status,woo_snapshot)
    values(c.workspace_id,c.store_id,d->>'customer_name',crm_private.normalize_phone(d->>'phone'),d->>'wilaya',d->>'commune',d->>'address','website','WooCommerce #'||(d->>'number'),(d->>'fee')::numeric,(d->>'discount')::numeric,(d->>'total')::numeric,c.created_by,(d->>'created_at')::timestamptz,d->>'number',d->>'remote_status',d)
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

create or replace function public.crm_list_orders(p_store uuid,p_status text default 'all',p_query text default '',p_page integer default 1,p_size integer default 20,p_agent uuid default null,p_ascending boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_page<1 or p_size not between 1 and 100 or length(p_query)>200 then raise exception 'INVALID_FILTER'; end if;
 with matching as (
 select o.* from public.crm_orders o where store_id=p_store
 and (p_status='all' or o.status=p_status or (p_status='pending' and o.status in ('new','call1','call2','call3','reported','check')) or (p_status='cancelled_all' and o.status in ('cancelled','duplicate','fake')) or (p_status='due' and o.callback_at<=now()))
 and (p_agent is null or assigned_to=p_agent)
 and (p_query='' or strpos(lower(o.customer_name||' '||o.phone||' '||o.number::text||' '||coalesce(o.woo_number,'')||' '||o.wilaya),lower(p_query))>0)
 ), paged as (select * from matching order by case when p_ascending then created_at end asc,case when not p_ascending then created_at end desc,id limit p_size offset (p_page-1)*p_size)
 select jsonb_build_object('total',(select count(*) from matching),'items',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.crm_order_items i where order_id=o.id))) from paged o),'[]'::jsonb)) into result;
 return result;
end $$;
