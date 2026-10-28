-- Continues database.sql in the same rollback-only transaction.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare w uuid:=(select v#>>'{}' from crm_test_context where k='w');o jsonb:=(select v from crm_test_context where k='order2');p uuid:=(select v#>>'{}' from crm_test_context where k='p');body jsonb; x jsonb;req uuid:=gen_random_uuid();
begin
 perform public.crm_command(w,'member.update','{"user_id":"10000000-0000-4000-8000-000000000002","role":"agent","active":true}',gen_random_uuid());
 perform public.crm_command(w,'order.status',jsonb_build_object('id',o->>'id','version',3,'status','new','reason','Correction adresse'),gen_random_uuid());
 body:=(select v from crm_test_context where k='payload')||jsonb_build_object('id',o->>'id','version',4,'discount',100,'items',jsonb_build_array(jsonb_build_object('product_id',p,'quantity',2,'unit_price',2300)));
 perform public.crm_command(w,'order.edit',body,gen_random_uuid());
 assert (select total=5000 from public.crm_orders where id=(o->>'id')::uuid),'edit recalculates total';
 assert (select data->'previous_items' is not null from public.crm_events where order_id=(o->>'id')::uuid and kind='order.edited' order by id desc limit 1),'history preserves prior items';
 insert into crm_test_context values('edited_payload',body||jsonb_build_object('version',5,'address','Nouvelle adresse','fee',501));
 x:=public.crm_command(w,'store.create','{"name":"Deuxième boutique"}',gen_random_uuid());
 begin perform public.crm_command(w,'order.create',(select v from crm_test_context where k='payload')||jsonb_build_object('store_id',x->>'id'),gen_random_uuid()); raise exception 'TEST_EXPECTED_STORE_ISOLATION'; exception when others then if sqlerrm<>'INVALID_PRODUCT' then raise; end if; end;
 select jsonb_build_object('store_id',store_id,'id',id,'version',version,'delta',5,'reason','Inventaire test') into body from public.crm_products where id=p;
 perform public.crm_command(w,'stock.adjust',body,req);
 perform public.crm_command(w,'stock.adjust',body,req);
 assert (select stock=8 from public.crm_products where id=p),'stock request replay does not duplicate adjustment';
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
declare w uuid:=(select v#>>'{}' from crm_test_context where k='w');body jsonb:=(select v from crm_test_context where k='edited_payload');o jsonb:=(select v from crm_test_context where k='order2');x jsonb;
begin
 perform public.crm_command(w,'order.edit',body,gen_random_uuid());
 assert (select total=5001 and address='Nouvelle adresse' from public.crm_orders where id=(o->>'id')::uuid),'agent preserves agreed prices while correcting address';
 begin perform public.crm_command(w,'order.edit',body||'{"version":6,"discount":200}',gen_random_uuid()); raise exception 'TEST_EXPECTED_DISCOUNT_DENIAL'; exception when others then if sqlerrm<>'INVALID_AMOUNT' then raise; end if; end;
 begin perform public.crm_command(w,'order.callback',jsonb_build_object('id',o->>'id','version',6,'callback_at',now()-interval '1 hour'),gen_random_uuid()); raise exception 'TEST_EXPECTED_PAST_CALLBACK'; exception when others then if sqlerrm<>'INVALID_CALLBACK' then raise; end if; end;
 begin perform public.crm_command(w,'order.status',jsonb_build_object('id',o->>'id','version',6,'status','shipped'),gen_random_uuid()); raise exception 'TEST_EXPECTED_SHIPPING_NOT_IMPLEMENTED'; exception when others then if sqlerrm<>'INVALID_TRANSITION' then raise; end if; end;
 x:=public.crm_command(w,'order.create',(select v from crm_test_context where k='payload')||'{"address":"","assigned_to":null}',gen_random_uuid());
 assert (select assigned_to=auth.uid() from public.crm_orders where id=(x->>'id')::uuid),'agent-created order assigned to self';
 begin perform public.crm_command(w,'order.status',jsonb_build_object('id',x->>'id','version',1,'status','confirmed'),gen_random_uuid()); raise exception 'TEST_EXPECTED_ADDRESS'; exception when others then if sqlerrm<>'ADDRESS_REQUIRED' then raise; end if; end;
end $$;
reset role;
select 'CRM edge cases passed; fixtures rolled back' as verification;
