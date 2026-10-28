-- A skipped source order has no crm_orders row, but its intake alert must still
-- reach the selected store's Realtime subscription immediately after commit.
-- touch_live_store emits one opaque revision per store and transaction.
create trigger crm_source_events_live after insert on public.crm_source_events
for each row execute function crm_private.touch_live_store();
