-- Local, offline emulation of the Supabase platform objects that the migrations
-- and SQL tests rely on. FOR DISPOSABLE TEST DATABASES ONLY.
-- Not a faithful copy of Supabase: vault stores plaintext, pg_net/pg_cron are
-- no-op stubs registered in pg_extension so "create extension if not exists"
-- is a no-op. Load as a superuser into an empty database.
\set ON_ERROR_STOP on

-- Roles (cluster-wide; created only if missing so reruns are idempotent)
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
 if not exists(select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if;
 if not exists(select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin nologin superuser; end if;
end$$;
grant anon, authenticated, service_role to authenticator;

-- Extensions schema (Supabase installs pgcrypto/uuid-ossp there and keeps it on search_path)
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
do $$begin execute format('alter database %I set search_path = "$user", public, extensions', current_database()); end$$;
set search_path = "$user", public, extensions;

-- public schema default privileges, as on a Supabase project
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- auth
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users(
 instance_id uuid, id uuid primary key, aud varchar(255), role varchar(255),
 email varchar(255), encrypted_password varchar(255), email_confirmed_at timestamptz,
 phone text, phone_confirmed_at timestamptz, confirmed_at timestamptz,
 last_sign_in_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
 is_super_admin boolean, is_sso_user boolean not null default false,
 is_anonymous boolean not null default false, banned_until timestamptz, deleted_at timestamptz,
 created_at timestamptz default now(), updated_at timestamptz default now()
);
grant select on auth.users to service_role;

create or replace function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                 nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                 (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                 (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
create or replace function auth.email() returns text language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.email', true), ''),
                 (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'))::text $$;
grant execute on function auth.jwt(), auth.uid(), auth.role(), auth.email() to anon, authenticated, service_role;

-- vault (plaintext stub; NO encryption). Not granted to anon/authenticated.
create schema if not exists vault;
create table if not exists vault.secrets(
 id uuid primary key default extensions.gen_random_uuid(), name text unique, description text not null default '',
 secret text not null, key_id uuid, nonce bytea, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create or replace view vault.decrypted_secrets as
 select id, name, description, secret, secret as decrypted_secret, key_id, nonce, created_at, updated_at from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null,
 new_description text default '', new_key_id uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rec_id uuid; begin
 insert into vault.secrets(secret, name, description, key_id)
 values (new_secret, new_name, coalesce(new_description, ''), new_key_id) returning id into rec_id;
 return rec_id; end $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null,
 new_description text default null, new_key_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
 update vault.secrets s set secret = coalesce(new_secret, s.secret), name = coalesce(new_name, s.name),
  description = coalesce(new_description, s.description), key_id = coalesce(new_key_id, s.key_id), updated_at = now()
 where s.id = secret_id; end $$;
revoke all on schema vault from public;
revoke all on all tables in schema vault from public, anon, authenticated;
revoke all on function vault.create_secret(text, text, text, uuid), vault.update_secret(uuid, text, text, text, uuid) from public;
grant usage on schema vault to service_role;
grant select on vault.secrets, vault.decrypted_secrets to service_role;
grant execute on function vault.create_secret(text, text, text, uuid), vault.update_secret(uuid, text, text, text, uuid) to service_role;

-- pg_net stub: records requests, never sends anything.
create schema if not exists net;
create table if not exists net.http_request_queue(id bigserial primary key, method text, url text, headers jsonb,
 body jsonb, timeout_milliseconds int, created_at timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
 headers jsonb default '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds int default 5000) returns bigint
language sql as $$ insert into net.http_request_queue(method,url,headers,body,timeout_milliseconds)
 values('POST',url,headers,body,timeout_milliseconds) returning id $$;
create or replace function net.http_get(url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb,
 timeout_milliseconds int default 5000) returns bigint
language sql as $$ insert into net.http_request_queue(method,url,headers,timeout_milliseconds)
 values('GET',url,headers,timeout_milliseconds) returning id $$;

-- pg_cron stub: stores jobs, never runs them.
create schema if not exists cron;
create table if not exists cron.job(jobid bigserial primary key, schedule text not null, command text not null,
 nodename text default 'localhost', nodeport int default 5432, database text default current_database(),
 username text default current_user, active boolean default true, jobname text unique);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql as $$ insert into cron.job(jobname,schedule,command) values(job_name,schedule,command)
 on conflict (jobname) do update set schedule=excluded.schedule, command=excluded.command returning jobid $$;
create or replace function cron.schedule(schedule text, command text) returns bigint
language sql as $$ insert into cron.job(schedule,command) values(schedule,command) returning jobid $$;
create or replace function cron.unschedule(job_name text) returns boolean
language sql as $$ with d as (delete from cron.job where jobname=job_name returning 1) select exists(select 1 from d) $$;
create or replace function cron.unschedule(job_id bigint) returns boolean
language sql as $$ with d as (delete from cron.job where jobid=job_id returning 1) select exists(select 1 from d) $$;

-- Register pg_cron / pg_net as "installed" so the migrations' CREATE EXTENSION IF NOT EXISTS
-- become no-ops (the real extensions are not available offline). Catalog hack, test DB only.
set allow_system_table_mods = on;
do $$declare e text; begin
 foreach e in array array['pg_cron','pg_net'] loop
  if not exists(select 1 from pg_extension where extname=e) then
   insert into pg_extension(oid,extname,extowner,extnamespace,extrelocatable,extversion,extconfig,extcondition)
   values((select coalesce(max(oid::int8),16384)+1 from pg_extension)::oid, e, (select oid from pg_roles where rolname=current_user),
          (select oid from pg_namespace where nspname=case e when 'pg_cron' then 'cron' else 'net' end), false, 'stub', null, null);
  end if;
 end loop; end$$;
reset allow_system_table_mods;

-- Realtime publication
do $$begin if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
 create publication supabase_realtime; end if; end$$;
