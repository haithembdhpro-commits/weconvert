-- Run inside BEGIN / ROLLBACK. A member renames themself only, in their own company.
reset role;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous) values
 ('70000000-0000-4000-8000-000000000001','profile-owner@weconvert.invalid',now(),'{}','{}',false),
 ('70000000-0000-4000-8000-000000000002','profile-agent@weconvert.invalid',now(),'{}','{}',false),
 ('70000000-0000-4000-8000-000000000003','profile-other@weconvert.invalid',now(),'{}','{}',false);
create temp table pf(k text primary key,v uuid);
grant select,insert on pf to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into pf values('ws',public.crm_bootstrap('Profil A','Boutique A','Owner A',gen_random_uuid()));
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
insert into pf values('ws_b',public.crm_bootstrap('Profil B','Boutique B','Owner B',gen_random_uuid()));
set local role service_role;
insert into public.crm_members(workspace_id,user_id,display_name,role) values((select v from pf where k='ws'),'70000000-0000-4000-8000-000000000002','Agent A','agent');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$declare w uuid:=(select v from pf where k='ws');r jsonb;begin
 r:=public.crm_my_profile_update(w,'  Amina B.  ');
 assert r->>'display_name'='Amina B.','trimmed name returned';
 assert (select display_name from public.crm_members where workspace_id=w and user_id='70000000-0000-4000-8000-000000000002')='Amina B.','own name changed';
 assert (select display_name from public.crm_members where workspace_id=w and user_id='70000000-0000-4000-8000-000000000001')='Owner A','owner untouched';
 assert (select role from public.crm_members where workspace_id=w and user_id='70000000-0000-4000-8000-000000000002')='agent','role untouched';
 begin perform public.crm_my_profile_update(w,'A');raise exception 'SHORT_ACCEPTED';exception when others then if sqlerrm<>'INVALID_NAME' then raise;end if;end;
 begin perform public.crm_my_profile_update((select v from pf where k='ws_b'),'Intrus');raise exception 'CROSS_TENANT';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
end $$;
-- An inactive member can no longer rename themself.
set local role service_role;
update public.crm_members set active=false where user_id='70000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$begin
 begin perform public.crm_my_profile_update((select v from pf where k='ws'),'Retour');raise exception 'INACTIVE_ACCEPTED';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
end $$;
select 'Profile checks passed' as verification;
