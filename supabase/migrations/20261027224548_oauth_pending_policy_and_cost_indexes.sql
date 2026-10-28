-- Same explicit-deny convention as the other crm_private tables (RLS on, no client access).
create policy oauth_pending_internal_only on crm_private.oauth_pending for all to authenticated using(false) with check(false);
-- Covering indexes for tenant foreign keys reported by the Supabase performance advisor.
create index if not exists crm_cost_entries_tenant_fk_idx on public.crm_cost_entries(workspace_id,store_id);
create index if not exists crm_product_costs_tenant_fk_idx on public.crm_product_costs(workspace_id,store_id,product_id);
create index if not exists crm_shipment_costs_tenant_fk_idx on public.crm_shipment_costs(workspace_id,store_id);
