-- Menu compte (29/10/2026) : chaque membre actif peut changer son propre nom affiché dans une entreprise.
-- Le rôle, l'activation et les autres membres restent réservés au propriétaire (member.update).
-- Modèle du projet : wrapper public SECURITY INVOKER → fonction crm_private SECURITY DEFINER, search_path fixe.
create or replace function crm_private.my_profile_update(p_workspace uuid, p_display_name text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare u uuid := (select auth.uid()); n text := btrim(coalesce(p_display_name,'')); old text;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if length(n) not between 2 and 100 or n ~ '[[:cntrl:]]' then raise exception 'INVALID_NAME'; end if;
 select m.display_name into old from public.crm_members m where m.workspace_id=p_workspace and m.user_id=u and m.active for update;
 if not found then raise exception 'FORBIDDEN'; end if;
 if old is distinct from n then
  update public.crm_members set display_name=n where workspace_id=p_workspace and user_id=u;
  insert into public.crm_events(workspace_id,actor_id,actor_name,kind,data) values(p_workspace,u,n,'member.profile',jsonb_build_object('from',old,'to',n));
 end if;
 return jsonb_build_object('display_name',n);
end $$;
revoke all on function crm_private.my_profile_update(uuid,text) from public, anon;
grant execute on function crm_private.my_profile_update(uuid,text) to authenticated;

create or replace function public.crm_my_profile_update(p_workspace uuid, p_display_name text) returns jsonb
language sql volatile security invoker set search_path='' as $$ select crm_private.my_profile_update(p_workspace, p_display_name) $$;
revoke all on function public.crm_my_profile_update(uuid,text) from public, anon;
grant execute on function public.crm_my_profile_update(uuid,text) to authenticated;
