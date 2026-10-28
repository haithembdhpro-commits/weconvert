-- Bind Shopify/YouCan OAuth approvals to the CRM user who started them.
-- Before: the callback activated whichever connection owned the state, so a tenant could start a flow
-- for someone else's shop and receive that merchant's orders once the merchant approved the app.
-- After: the callback only parks the tokens. The initiating owner/admin must confirm from a logged-in
-- session (single-use ticket, 10 min) before crm_source_service/crm_youcan_service('finish_oauth') runs.
create table if not exists crm_private.oauth_pending(
 connection_id uuid primary key references public.crm_source_connections(id) on delete cascade,
 provider text not null check (provider in ('shopify','youcan')),
 actor uuid not null,
 nonce_hash text not null check (nonce_hash ~ '^[a-f0-9]{64}$'),
 confirm_hash text unique check (confirm_hash ~ '^[a-f0-9]{64}$'),
 payload_secret uuid,
 confirm_expires_at timestamptz,
 created_at timestamptz not null default now()
);
alter table crm_private.oauth_pending enable row level security;
revoke all on crm_private.oauth_pending from public,anon,authenticated;

create or replace function crm_private.oauth_guard(p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.crm_source_connections;r crm_private.oauth_pending;uid uuid;payload jsonb;secret uuid;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>200000 then raise exception 'INVALID_REQUEST';end if;
 if p_action='bind' then
  uid:=(p->>'actor')::uuid;
  select * into c from public.crm_source_connections where id=(p->>'connection_id')::uuid for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if c.provider not in ('shopify','youcan') or p->>'nonce_hash' !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_REQUEST';end if;
  if not exists(select 1 from public.crm_members where workspace_id=c.workspace_id and user_id=uid and active and role in ('owner','admin'))
   then raise exception 'FORBIDDEN';end if;
  select * into r from crm_private.oauth_pending where connection_id=c.id for update;
  if found and r.payload_secret is not null then delete from vault.secrets where id=r.payload_secret;end if;
  insert into crm_private.oauth_pending(connection_id,provider,actor,nonce_hash)
   values(c.id,c.provider,uid,p->>'nonce_hash')
   on conflict(connection_id) do update set provider=excluded.provider,actor=excluded.actor,nonce_hash=excluded.nonce_hash,
    confirm_hash=null,payload_secret=null,confirm_expires_at=null,created_at=now();
  return jsonb_build_object('bound',true);
 end if;
 if p_action='stash' then
  select * into r from crm_private.oauth_pending
   where connection_id=(p->>'connection_id')::uuid and nonce_hash=p->>'nonce_hash' and confirm_hash is null for update;
  if not found then raise exception 'INVALID_STATE';end if;
  if p->>'confirm_hash' !~ '^[a-f0-9]{64}$' or jsonb_typeof(p->'payload')<>'object' then raise exception 'INVALID_REQUEST';end if;
  secret:=vault.create_secret((p->'payload')::text,'weconvert_oauth_pending_'||r.connection_id::text||'_'||extract(epoch from clock_timestamp())::bigint,'Pending OAuth approval');
  update crm_private.oauth_pending set confirm_hash=p->>'confirm_hash',payload_secret=secret,confirm_expires_at=now()+interval '10 minutes'
   where connection_id=r.connection_id;
  return jsonb_build_object('stashed',true);
 end if;
 if p_action='confirm' then
  -- Never raise after reading the row: the single-use ticket must be consumed even on refusal.
  uid:=(p->>'actor')::uuid;
  if p->>'confirm_hash' !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','INVALID_STATE');end if;
  select * into r from crm_private.oauth_pending where confirm_hash=p->>'confirm_hash' for update;
  if not found then return jsonb_build_object('error','INVALID_STATE');end if;
  select decrypted_secret::jsonb into payload from vault.decrypted_secrets where id=r.payload_secret;
  delete from vault.secrets where id=r.payload_secret;
  delete from crm_private.oauth_pending where connection_id=r.connection_id;
  select * into c from public.crm_source_connections where id=r.connection_id;
  if r.confirm_expires_at<=now() or r.actor is distinct from uid or payload is null
   or not exists(select 1 from public.crm_members where workspace_id=c.workspace_id and user_id=uid and active and role in ('owner','admin'))
   then
    insert into public.crm_source_events(connection_id,workspace_id,store_id,outcome,code)
     values(c.id,c.workspace_id,c.store_id,'error','OAUTH_CONFIRMATION_REFUSED');
    return jsonb_build_object('error','INVALID_STATE');
  end if;
  return jsonb_build_object('connection_id',r.connection_id,'provider',r.provider,'nonce_hash',r.nonce_hash,'payload',payload);
 end if;
 raise exception 'INVALID_REQUEST';
end $$;

create or replace function public.crm_oauth_guard(p_action text,p jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select crm_private.oauth_guard(p_action,p) $$;
revoke all on function crm_private.oauth_guard(text,jsonb),public.crm_oauth_guard(text,jsonb) from public,anon,authenticated;
grant execute on function crm_private.oauth_guard(text,jsonb),public.crm_oauth_guard(text,jsonb) to service_role;
