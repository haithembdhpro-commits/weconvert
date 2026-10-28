-- Supabase advisor "extension_in_public": pg_net must live outside the exposed public schema.
-- pg_net always creates its functions in schema "net"; only the extension's registered namespace moves.
-- pg_net does not support ALTER EXTENSION ... SET SCHEMA, so it is recreated. Pending HTTP requests
-- (net.http_request_queue) are transient; cron jobs call net.http_post by qualified name and keep working.
do $$
begin
 if exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_net' and n.nspname='public') then
  create schema if not exists extensions;
  drop extension pg_net;
  create extension pg_net schema extensions;
 end if;
end $$;
