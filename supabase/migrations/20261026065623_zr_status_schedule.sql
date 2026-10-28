-- Read-only status reconciliation, isolated from user actions and transport writes.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret(encode(gen_random_bytes(32),'hex'),'weconvert_zr_sync_secret','Cron to ZR status reader');
select vault.create_secret('https://loxdcfxxefigfchmrwzy.supabase.co','weconvert_zr_project_url','Production Supabase URL');

create function public.crm_zr_cron_authorized(p_secret text) returns boolean
language sql security definer set search_path='' as $$
 select p_secret is not null and length(p_secret)=64 and
  p_secret=(select decrypted_secret from vault.decrypted_secrets where name='weconvert_zr_sync_secret')
$$;
create function public.crm_zr_cron_connection(p_connection uuid) returns jsonb
language sql security definer set search_path='' as $$
 select to_jsonb(c)||jsonb_build_object('credentials',v.decrypted_secret::jsonb)
 from public.crm_shipping_connections c join crm_private.zr_credentials z on z.connection_id=c.id
 join vault.decrypted_secrets v on v.id=z.secret_id
 where c.id=p_connection and c.active
$$;
create function public.crm_zr_sync_queue() returns setof public.crm_shipments
language sql security definer set search_path='' as $$
 select s.* from public.crm_shipments s
 join public.crm_shipping_connections c on c.id=s.connection_id and c.active
 where s.state not in ('sending','needs_review')
  and (s.last_checked_at is null or s.last_checked_at <
    now()-case when s.state in ('delivered','returned','cancelled') then interval '12 hours' else interval '15 minutes' end)
 order by s.last_checked_at asc nulls first,s.id limit 12
$$;
create function public.crm_zr_cron_track(p_shipment uuid,p jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare s public.crm_shipments;stage text:=p->>'state';raw text:=left(p->>'raw_status',200);
begin
 select * into s from public.crm_shipments where id=p_shipment and state not in ('sending','needs_review') for update;
 if s.id is null then raise exception 'NOT_FOUND';end if;
 if stage not in ('submitted','in_transit','out_for_delivery','ready_for_pickup','delivered','failed_delivery','returning','returned','cancelled','exception','unknown') or
   (s.remote_id is not null and s.remote_id is distinct from p->>'remote_id') then raise exception 'INVALID_STATUS';end if;
 if s.state is distinct from stage or s.raw_status is distinct from raw then
  update public.crm_shipments set state=stage,raw_status=raw,updated_at=now(),last_checked_at=now(),last_error=null where id=s.id;
  insert into public.crm_shipping_events(shipment_id,workspace_id,store_id,order_id,state,raw_status,kind)
   values(s.id,s.workspace_id,s.store_id,s.order_id,stage,raw,'status.changed');
 else update public.crm_shipments set last_checked_at=now() where id=s.id;end if;
end $$;
revoke all on function public.crm_zr_cron_authorized(text),public.crm_zr_cron_connection(uuid),public.crm_zr_sync_queue(),public.crm_zr_cron_track(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crm_zr_cron_authorized(text),public.crm_zr_cron_connection(uuid),public.crm_zr_sync_queue(),public.crm_zr_cron_track(uuid,jsonb) to service_role;

select cron.schedule('weconvert-zr-status-pull','*/5 * * * *',$$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='weconvert_zr_project_url')||'/functions/v1/weconvert-zr',
  headers:=jsonb_build_object('Content-Type','application/json','X-WeConvert-Sync',
    (select decrypted_secret from vault.decrypted_secrets where name='weconvert_zr_sync_secret')),
  body:='{"action":"scheduled_sync"}'::jsonb,timeout_milliseconds:=45000
 ) as request_id;
$$);
