-- In-app notifications (UX audit 28/10/2026): new orders, callbacks that are due, parcels delivered or returned.
-- No copy of order data: the feed is computed from crm_orders / crm_shipments under their own RLS, so an agent only
-- sees the orders assigned to them and nothing leaks across companies or stores. Only the "seen up to" time is stored,
-- per user and per store. A carrier "delivered" is a carrier state, never a cash collection.

create table public.crm_notification_seen (
 user_id uuid not null references auth.users(id) on delete cascade,
 store_id uuid not null references public.crm_stores(id) on delete cascade,
 workspace_id uuid not null references public.crm_workspaces(id) on delete cascade,
 seen_at timestamptz not null default now(),
 primary key (user_id, store_id)
);
alter table public.crm_notification_seen enable row level security;
create policy crm_notification_seen_read on public.crm_notification_seen for select to authenticated
 using (user_id = (select auth.uid()) and workspace_id = any((select crm_private.my_workspaces())::uuid[]));
revoke all on public.crm_notification_seen from anon, authenticated;
grant select on public.crm_notification_seen to authenticated;

-- Feed of the last 7 days (30 newest items) + unread count since the user's last "seen".
create or replace function public.crm_notifications(p_store uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare seen timestamptz; result jsonb;
begin
 if p_store is null then raise exception 'INVALID_FILTER'; end if;
 select n.seen_at into seen from public.crm_notification_seen n where n.user_id=(select auth.uid()) and n.store_id=p_store;
 with feed as (
  select 'order.new'::text kind, o.created_at at, o.id order_id, o.number, o.customer_name, null::text detail
   from public.crm_orders o where o.store_id=p_store and o.created_at > now()-interval '7 days'
  union all
  select 'callback.due', o.callback_at, o.id, o.number, o.customer_name, null
   from public.crm_orders o where o.store_id=p_store and o.callback_at <= now() and o.callback_at > now()-interval '7 days'
    and o.status in ('new','call1','call2','call3','reported','check')
  union all
  select 'parcel.'||s.state, s.updated_at, o.id, o.number, o.customer_name, s.tracking
   from public.crm_shipments s join public.crm_orders o on o.id=s.order_id
   where o.store_id=p_store and s.state in ('delivered','returned') and s.updated_at > now()-interval '7 days'
 ), recent as (select * from feed order by at desc, order_id limit 30)
 select jsonb_build_object(
  'seen_at', seen,
  'unread', (select count(*) from feed f where seen is null or f.at > seen),
  'items', coalesce((select jsonb_agg(jsonb_build_object('kind',r.kind,'at',r.at,'order_id',r.order_id,'number',r.number,
    'customer_name',r.customer_name,'detail',r.detail,'unread',(seen is null or r.at > seen)) order by r.at desc, r.order_id) from recent r),'[]'::jsonb)
 ) into result;
 return result;
end $$;

-- Marks everything up to now as seen for this user and store. Membership is checked; nothing else is written.
create or replace function public.crm_notifications_seen(p_store uuid)
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

revoke all on function public.crm_notifications(uuid), public.crm_notifications_seen(uuid) from public, anon;
grant execute on function public.crm_notifications(uuid), public.crm_notifications_seen(uuid) to authenticated;
create index if not exists crm_orders_store_created_idx on public.crm_orders(store_id, created_at desc);
