-- YouCan can issue access tokens with an expires_in around 100 years.
-- Keep the reported lifetime, using bigint rather than truncating or forcing early refresh.
create or replace function crm_private.youcan_service(p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.crm_source_connections; s crm_private.source_secrets;
 sid uuid; wid uuid; uid uuid; credential jsonb; previous jsonb; secret uuid;
 remote_shop text; methods text[];
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>20000 then raise exception 'INVALID_REQUEST'; end if;
 if p_action='save_channel' then
  sid:=(p->>'store_id')::uuid;uid:=(p->>'actor')::uuid;
  select workspace_id into wid from public.crm_stores where id=sid;
  if not exists(select 1 from public.crm_members where workspace_id=wid and user_id=uid and active and role in ('owner','admin')) then raise exception 'FORBIDDEN';end if;
  if char_length(trim(coalesce(p->>'channel_name',''))) not between 2 and 100
   or coalesce(p->>'public_url','') !~ '^https://[a-z0-9.-]{4,247}$'
   or jsonb_typeof(p->'cod_methods')<>'array'
   or jsonb_array_length(p->'cod_methods') not between 1 and 20 then raise exception 'INVALID_REQUEST';end if;
  select array_agg(distinct lower(trim(value))) into methods
   from jsonb_array_elements_text(p->'cod_methods')
   where length(trim(value)) between 2 and 80;
  if coalesce(array_length(methods,1),0)=0 or array_length(methods,1)<>jsonb_array_length(p->'cod_methods') then raise exception 'INVALID_REQUEST';end if;
  perform pg_advisory_xact_lock(hashtextextended(sid::text||'youcan',0));
  select * into c from public.crm_source_connections where store_id=sid and provider='youcan' for update;
  if not found then
   insert into public.crm_source_connections(workspace_id,store_id,provider,external_shop,created_by,cod_methods,channel_name,public_url)
    values(wid,sid,'youcan','pending-'||gen_random_uuid()::text,uid,methods,trim(p->>'channel_name'),p->>'public_url') returning * into c;
  else
   if c.connected_at is not null and c.public_url is not null and c.public_url<>p->>'public_url' then raise exception 'SHOP_LOCKED';end if;
   if c.public_url is distinct from p->>'public_url' and exists(
    select 1 from crm_private.source_secrets ss where ss.connection_id=c.id and ss.oauth_nonce_hash is not null and ss.oauth_expires_at>now()
   ) then raise exception 'AUTH_IN_PROGRESS';end if;
   update public.crm_source_connections set channel_name=trim(p->>'channel_name'),public_url=p->>'public_url',cod_methods=methods,
    status=case when status='disconnected' then 'pending' else status end,last_error=null
    where id=c.id returning * into c;
  end if;
  return jsonb_build_object('id',c.id,'status',c.status);
 end if;
 if p_action='begin' then
  uid:=(p->>'actor')::uuid;
  select * into c from public.crm_source_connections where id=(p->>'connection_id')::uuid and provider='youcan' for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if not exists(select 1 from public.crm_members where workspace_id=c.workspace_id and user_id=uid and active and role in ('owner','admin')) then raise exception 'FORBIDDEN';end if;
  if c.public_url is null or p->>'nonce_hash' !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_REQUEST';end if;
  update public.crm_source_connections set status=case when status in ('active','awaiting_webhook') then status else 'pending' end,last_error=null
   where id=c.id returning * into c;
  insert into crm_private.source_secrets(connection_id,oauth_nonce_hash,oauth_expires_at)
   values(c.id,p->>'nonce_hash',now()+interval '10 minutes')
   on conflict(connection_id) do update set oauth_nonce_hash=excluded.oauth_nonce_hash,oauth_expires_at=excluded.oauth_expires_at;
  return jsonb_build_object('id',c.id,'public_url',c.public_url);
 end if;
 if p_action='oauth_state' then
  select sc.* into c from public.crm_source_connections sc
   join crm_private.source_secrets ss on ss.connection_id=sc.id
   where ss.oauth_nonce_hash=p->>'nonce_hash' and ss.oauth_expires_at>now()
   and sc.provider='youcan' and sc.status in ('pending','awaiting_webhook','active') for update of sc;
  if not found then raise exception 'INVALID_STATE';end if;
  return jsonb_build_object('id',c.id,'public_url',c.public_url);
 end if;
 select * into c from public.crm_source_connections where id=(p->>'connection_id')::uuid and provider='youcan' for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if p_action='finish_oauth' then
  select * into s from crm_private.source_secrets where connection_id=c.id for update;
  if s.oauth_nonce_hash is distinct from p->>'nonce_hash' or s.oauth_expires_at<=now()
   or c.status not in ('pending','awaiting_webhook','active') then raise exception 'INVALID_STATE';end if;
  remote_shop:=lower(p->>'external_shop');
  if remote_shop !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or (c.connected_at is not null and c.external_shop<>remote_shop)
   or c.public_url is distinct from p->>'expected_url'
   or p->>'verified_domain' !~ '^[a-z0-9][a-z0-9.-]{2,251}[a-z0-9]$'
   then raise exception 'SHOP_LOCKED';end if;
  credential:=p->'credentials';
  if jsonb_typeof(credential)<>'object' or nullif(credential->>'access_token','') is null
   or nullif(credential->>'refresh_token','') is null
   or (credential->>'expires_in')::bigint<=0 or (credential->>'expires_in')::bigint>3155760000
   or (credential->>'obtained_at')::timestamptz is null then raise exception 'INVALID_REQUEST';end if;
  if s.vault_secret_id is null then
   secret:=vault.create_secret(credential::text,'weconvert_youcan_'||c.id::text,'YouCan merchant OAuth tokens');
  else secret:=s.vault_secret_id;perform vault.update_secret(secret,credential::text);end if;
  update crm_private.source_secrets set vault_secret_id=secret,oauth_nonce_hash=null,oauth_expires_at=null where connection_id=c.id;
  update public.crm_source_connections set external_shop=remote_shop,verified_domain=p->>'verified_domain',
   status=case when status='active' then 'active' else 'awaiting_webhook' end,
   connected_at=coalesce(connected_at,now()),last_error=null where id=c.id;
  insert into public.crm_source_events(connection_id,workspace_id,store_id,outcome,code)
   values(c.id,c.workspace_id,c.store_id,'connected','OAUTH_APPROVED');
  return jsonb_build_object('connected',true);
 end if;
 if p_action in ('credentials','refresh_credentials','repair') then
  if p_action='repair' and not exists(
   select 1 from public.crm_members where workspace_id=c.workspace_id and user_id=(p->>'actor')::uuid
    and active and role in ('owner','admin')) then raise exception 'FORBIDDEN';end if;
  if c.status not in ('awaiting_webhook','active') then raise exception 'DISCONNECTED';end if;
  select * into s from crm_private.source_secrets where connection_id=c.id for update;
  select decrypted_secret::jsonb into previous from vault.decrypted_secrets where id=s.vault_secret_id;
  if previous is null then raise exception 'DISCONNECTED';end if;
  if p_action='refresh_credentials' then
   if encode(extensions.digest(previous->>'access_token','sha256'),'hex')=p->>'old_access_hash' then
    credential:=p->'credentials';
    if jsonb_typeof(credential)<>'object' or nullif(credential->>'access_token','') is null
     or nullif(credential->>'refresh_token','') is null
     or (credential->>'expires_in')::bigint<=0 or (credential->>'expires_in')::bigint>3155760000
     or (credential->>'obtained_at')::timestamptz is null then raise exception 'INVALID_REQUEST';end if;
    perform vault.update_secret(s.vault_secret_id,credential::text);
    previous:=credential;
   end if;
  end if;
  return previous;
 end if;
 raise exception 'INVALID_REQUEST';
end $$;
