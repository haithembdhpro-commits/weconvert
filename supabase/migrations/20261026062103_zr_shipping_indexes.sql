-- Closed private table: explicit deny keeps the security linter unambiguous.
create policy zr_credentials_closed on crm_private.zr_credentials for all to authenticated using(false) with check(false);
create index crm_shipments_order_fk_idx on public.crm_shipments(workspace_id,store_id,order_id);
create index crm_shipments_connection_fk_idx on public.crm_shipments(workspace_id,store_id,connection_id);
create index crm_shipping_events_order_fk_idx on public.crm_shipping_events(workspace_id,store_id,order_id);
