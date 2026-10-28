-- Internal event trigger must not be an API endpoint.
-- The platform trigger exists on the hosted project, but may not exist locally.
do $$ begin
 if to_regprocedure('public.rls_auto_enable()') is not null then
  execute 'revoke execute on function public.rls_auto_enable() from public,anon,authenticated';
 end if;
end $$;
-- Explicit deny policies document that only the checked private command functions
-- may read request receipts or invitation tokens.
revoke all on crm_private.requests,crm_private.invitations from public,anon,authenticated;
create policy requests_internal_only on crm_private.requests for all to authenticated using(false) with check(false);
create policy invitations_internal_only on crm_private.invitations for all to authenticated using(false) with check(false);
