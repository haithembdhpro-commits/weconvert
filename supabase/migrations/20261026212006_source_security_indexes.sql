-- Closed private tables and indexes for tenant joins and audited events.
create policy source_secrets_closed on crm_private.source_secrets for all to authenticated using(false) with check(false);
create policy source_links_closed on crm_private.source_order_links for all to authenticated using(false) with check(false);
create policy source_products_closed on crm_private.source_product_links for all to authenticated using(false) with check(false);
create policy source_deliveries_closed on crm_private.source_deliveries for all to authenticated using(false) with check(false);
create index crm_source_connections_actor_idx on public.crm_source_connections(created_by);
create index crm_source_events_order_idx on public.crm_source_events(order_id);
create index crm_source_events_tenant_idx on public.crm_source_events(workspace_id,store_id,connection_id);
create index crm_orders_source_tenant_fk_idx on public.crm_orders(workspace_id,store_id,source_connection_id)
 where source_connection_id is not null;
