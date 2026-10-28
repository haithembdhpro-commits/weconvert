-- Run inside BEGIN / ROLLBACK, following database.sql and edge-cases.sql.
reset role;
-- Live signals are deferred constraint triggers (fire at commit); flush them as a commit would.
set constraints all immediate;
do $$begin
 assert exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='crm_live_stores'),'signal publication enabled';
 assert not exists(select 1 from information_schema.columns where table_schema='public' and table_name='crm_live_stores' and column_name not in ('store_id','workspace_id','revision','changed_at')),'signals carry no customer information';
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$declare sid uuid:=(select v#>>'{}' from crm_test_context where k='s');r uuid;begin
 assert exists(select 1 from public.crm_live_stores where store_id=sid),'order/product trigger created signal';
 assert (select count(*)=1 from public.crm_live_stores),'workspace isolation on signals';
 select revision into r from public.crm_live_stores where store_id=sid;
 begin update public.crm_live_stores set revision=gen_random_uuid() where store_id=sid;raise exception 'SIGNAL_CLIENT_WRITE_ALLOWED';exception when insufficient_privilege then null;end;
 assert (select revision=r from public.crm_live_stores where store_id=sid),'client cannot forge signals';
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$begin
 assert exists(select 1 from public.crm_live_stores),'active agent may receive non-sensitive invalidations';
end $$;
reset role;
update public.crm_members set active=false where user_id='10000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$begin assert not exists(select 1 from public.crm_live_stores),'revoked member sees no signal';end $$;
reset role;
set local role anon;
do $$begin
 begin perform * from public.crm_live_stores;raise exception 'ANONYMOUS_SIGNAL_ACCESS';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'Realtime isolation checks passed' as verification;
