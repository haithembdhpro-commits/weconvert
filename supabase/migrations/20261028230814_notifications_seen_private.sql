-- Project pattern: exposed RPCs are SECURITY INVOKER; the privileged write lives in crm_private (not exposed by the API).
create or replace function crm_private.notifications_seen(p_store uuid)
returns timestamptz language plpgsql volatile security definer set search_path='' as $$
declare w uuid; t timestamptz := now();
begin
 if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
 select s.workspace_id into w from public.crm_stores s where s.id=p_store and s.workspace_id=any(crm_private.my_workspaces());
 if w is null then raise exception 'FORBIDDEN'; end if;
 insert into public.crm_notification_seen(user_id,store_id,workspace_id,seen_at) values ((select auth.uid()),p_store,w,t)
 on conflict (user_id,store_id) do update set seen_at=greatest(public.crm_notification_seen.seen_at, excluded.seen_at);
 return t;
end $$;
revoke all on function crm_private.notifications_seen(uuid) from public, anon;
grant execute on function crm_private.notifications_seen(uuid) to authenticated;

drop function public.crm_notifications_seen(uuid);
create function public.crm_notifications_seen(p_store uuid) returns timestamptz language sql volatile security invoker set search_path='' as $$
 select crm_private.notifications_seen(p_store)
$$;
revoke all on function public.crm_notifications_seen(uuid) from public, anon;
grant execute on function public.crm_notifications_seen(uuid) to authenticated;
