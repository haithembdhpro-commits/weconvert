-- Realtime invalidations contain no customer/order information. Data is refetched through RLS.
create table public.crm_live_stores (
 store_id uuid primary key, workspace_id uuid not null,
 revision uuid not null default gen_random_uuid(),changed_at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,store_id) references public.crm_stores(workspace_id,id)
);
create index crm_live_stores_workspace_idx on public.crm_live_stores(workspace_id,store_id);
alter table public.crm_live_stores enable row level security;
create policy crm_live_store_read on public.crm_live_stores for select to authenticated using(crm_private.member_role(workspace_id) is not null);
revoke all on public.crm_live_stores from public,anon,authenticated;
grant select on public.crm_live_stores to authenticated;
insert into public.crm_live_stores(store_id,workspace_id) select id,workspace_id from public.crm_stores;
create function crm_private.touch_live_store() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if current_setting('weconvert.live_'||replace(new.store_id::text,'-',''),true)='sent' then return null; end if;
 perform set_config('weconvert.live_'||replace(new.store_id::text,'-',''),'sent',true);
 insert into public.crm_live_stores(store_id,workspace_id) values(new.store_id,new.workspace_id)
 on conflict(store_id) do update set revision=gen_random_uuid(),changed_at=clock_timestamp();
 return null;
end $$;
revoke all on function crm_private.touch_live_store() from public,anon,authenticated;
-- Orders/items are committed together. A single revision per store is broadcast per transaction.
create trigger crm_orders_live after insert or update on public.crm_orders for each row execute function crm_private.touch_live_store();
create trigger crm_items_live after insert or update on public.crm_order_items for each row execute function crm_private.touch_live_store();
create trigger crm_products_live after insert or update on public.crm_products for each row execute function crm_private.touch_live_store();
create trigger crm_integrations_live after insert or update on public.crm_integrations for each row execute function crm_private.touch_live_store();
create trigger crm_integration_events_live after insert on public.crm_integration_events for each row execute function crm_private.touch_live_store();
alter publication supabase_realtime add table public.crm_live_stores;
