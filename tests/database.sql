-- Run inside BEGIN ... ROLLBACK. Fixture users and business data must never persist.
create temporary table crm_test_context(k text primary key,v jsonb);
grant all on crm_test_context to authenticated;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous) values
 ('10000000-0000-4000-8000-000000000001','owner-a@weconvert.invalid',now(),'{}','{}',false),
 ('10000000-0000-4000-8000-000000000002','agent-a@weconvert.invalid',now(),'{}','{}',false),
 ('10000000-0000-4000-8000-000000000003','owner-b@weconvert.invalid',now(),'{}','{}',false);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare w uuid;s uuid;p uuid;o jsonb;x jsonb;payload jsonb;req uuid:=gen_random_uuid();
begin
 w:=public.crm_bootstrap('Test A','Boutique A','Owner A','10000000-0000-4000-8000-000000000010');
 assert w=public.crm_bootstrap('Test A','Boutique A','Owner A','10000000-0000-4000-8000-000000000010'),'bootstrap idempotency';
 select id into s from public.crm_stores where workspace_id=w;
 insert into crm_test_context values('w',to_jsonb(w)),('s',to_jsonb(s));
 x:=public.crm_command(w,'product.save',jsonb_build_object('store_id',s,'name','Produit test','sku','QA-1','price',2500,'stock',3),gen_random_uuid()); p:=(x->>'id')::uuid;
 insert into crm_test_context values('p',to_jsonb(p));
 payload:=jsonb_build_object('store_id',s,'customer_name','Client test','phone','0555 12 34 56','wilaya','Alger','commune','Kouba','address','Adresse test','channel','whatsapp','fee',500,'discount',0,'items',jsonb_build_array(jsonb_build_object('product_id',p,'quantity',2,'unit_price',2500)));
 o:=public.crm_command(w,'order.create',payload,req);
 assert o=public.crm_command(w,'order.create',payload,req),'create idempotency';
 assert (select count(*)=1 from public.crm_orders),'one order on retry';
 assert (select total=5500 and phone='+213555123456' from public.crm_orders where id=(o->>'id')::uuid),'total and phone normalization';
 begin perform public.crm_command(w,'order.create',payload||'{"fee":1000}',req); raise exception 'TEST_EXPECTED_IDEMPOTENCY'; exception when others then if sqlerrm<>'IDEMPOTENCY_CONFLICT' then raise; end if; end;
 insert into crm_test_context values('order',o),('payload',payload);
 x:=public.crm_command(w,'order.call',jsonb_build_object('id',o->>'id','version',1),gen_random_uuid());
 assert x->>'status'='call1','first attempt';
 begin perform public.crm_command(w,'order.note',jsonb_build_object('id',o->>'id','version',1,'note','old write'),gen_random_uuid()); raise exception 'TEST_EXPECTED_CONFLICT'; exception when others then if sqlerrm<>'VERSION_CONFLICT' then raise; end if; end;
 x:=public.crm_command(w,'order.callback',jsonb_build_object('id',o->>'id','version',2,'callback_at',now()+interval '1 day','note','Rappeler demain'),gen_random_uuid());
 assert x->>'status'='reported','callback state';
 x:=public.crm_command(w,'order.note',jsonb_build_object('id',o->>'id','version',3,'note','Client disponible'),gen_random_uuid());
 x:=public.crm_command(w,'order.status',jsonb_build_object('id',o->>'id','version',4,'status','confirmed'),gen_random_uuid());
 assert (select reserved=2 from public.crm_products where id=p),'stock reservation';
 o:=public.crm_command(w,'order.create',payload,gen_random_uuid());
 begin perform public.crm_command(w,'order.status',jsonb_build_object('id',o->>'id','version',1,'status','confirmed'),gen_random_uuid()); raise exception 'TEST_EXPECTED_STOCK'; exception when others then if sqlerrm not like 'INSUFFICIENT_STOCK:%' then raise; end if; end;
 assert (select reserved=2 from public.crm_products where id=p),'failed confirmation atomic';
 insert into crm_test_context values('order2',o);
 o:=(select v from crm_test_context where k='order');
 x:=public.crm_command(w,'order.status',jsonb_build_object('id',o->>'id','version',5,'status','cancelled','reason','Client annule'),gen_random_uuid());
 assert (select reserved=0 from public.crm_products where id=p),'reservation released';
 assert (select count(*)=6 from public.crm_events where order_id=(o->>'id')::uuid),'append only history';
 begin update public.crm_orders set status='confirmed' where id=(o->>'id')::uuid; raise exception 'TEST_EXPECTED_WRITE_DENIAL'; exception when insufficient_privilege then null; end;
 begin delete from public.crm_events where order_id=(o->>'id')::uuid; raise exception 'TEST_EXPECTED_AUDIT_DENIAL'; exception when insufficient_privilege then null; end;
 x:=public.crm_command(w,'member.invite','{"email":"agent-a@weconvert.invalid","display_name":"Agent A","role":"agent"}',gen_random_uuid());
 insert into crm_test_context values('invite',x);
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$
declare w uuid;s uuid;x jsonb;foreign_w uuid:=(select v#>>'{}' from crm_test_context where k='w');foreign_p uuid:=(select v#>>'{}' from crm_test_context where k='p');o jsonb:=(select v from crm_test_context where k='order');
begin
 assert (select count(*)=0 from public.crm_orders),'tenant isolation';
 assert public.crm_order_detail((o->>'id')::uuid) is null,'detail isolation';
 begin perform public.crm_command(foreign_w,'order.note',jsonb_build_object('id',o->>'id','version',6,'note','cross tenant'),gen_random_uuid()); raise exception 'TEST_EXPECTED_FORBIDDEN'; exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
 w:=public.crm_bootstrap('Test B','Boutique B','Owner B',gen_random_uuid()); select id into s from public.crm_stores where workspace_id=w;
 insert into crm_test_context values('w2',to_jsonb(w)),('s2',to_jsonb(s));
 begin perform public.crm_command(w,'order.create',(select v from crm_test_context where k='payload')||jsonb_build_object('store_id',s),gen_random_uuid()); raise exception 'TEST_EXPECTED_PRODUCT_ISOLATION'; exception when others then if sqlerrm<>'INVALID_PRODUCT' then raise; end if; end;
 begin perform public.crm_accept_invitation((select v->>'token' from crm_test_context where k='invite')); raise exception 'TEST_EXPECTED_EMAIL_BINDING'; exception when others then if sqlerrm<>'INVITATION_INVALID' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
declare w uuid; x jsonb;o jsonb:=(select v from crm_test_context where k='order2');
begin
 w:=public.crm_accept_invitation((select v->>'token' from crm_test_context where k='invite'));
 assert (select count(*)=0 from public.crm_orders),'agent cannot see unassigned orders';
 begin perform public.crm_command(w,'order.note',jsonb_build_object('id',o->>'id','version',1,'note','unassigned'),gen_random_uuid()); raise exception 'TEST_EXPECTED_ASSIGNEE'; exception when others then if sqlerrm<>'NOT_FOUND' then raise; end if; end;
 begin perform public.crm_command(w,'product.save',jsonb_build_object('store_id',(select v#>>'{}' from crm_test_context where k='s'),'name','Bad product','sku','BAD','price',10),gen_random_uuid()); raise exception 'TEST_EXPECTED_ROLE'; exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.crm_command((select (v#>>'{}')::uuid from crm_test_context where k='w'),'order.assign',jsonb_build_object('id',(select v->>'id' from crm_test_context where k='order2'),'version',1,'assigned_to','10000000-0000-4000-8000-000000000002'),gen_random_uuid());
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
declare w uuid:=(select v#>>'{}' from crm_test_context where k='w');o jsonb:=(select v from crm_test_context where k='order2');x jsonb;
begin
 assert (select count(*)=1 from public.crm_orders),'assigned order visible';
 x:=public.crm_command(w,'order.status',jsonb_build_object('id',o->>'id','version',2,'status','confirmed'),gen_random_uuid());
 assert x->>'status'='confirmed','agent can confirm assigned order';
 assert (public.crm_list_orders((select (v#>>'{}')::uuid from crm_test_context where k='s'))->>'total')::integer=1,'list respects RLS';
 assert (public.crm_overview((select (v#>>'{}')::uuid from crm_test_context where k='s'))->>'all')::integer=1,'metrics respect RLS';
 begin perform public.crm_command(w,'order.status',jsonb_build_object('id',o->>'id','version',3,'status','new','reason','agent reopen'),gen_random_uuid()); raise exception 'TEST_EXPECTED_REOPEN'; exception when others then if sqlerrm<>'INVALID_TRANSITION' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.crm_command((select (v#>>'{}')::uuid from crm_test_context where k='w'),'member.update','{"user_id":"10000000-0000-4000-8000-000000000002","role":"agent","active":false}',gen_random_uuid());
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$begin assert (select count(*)=0 from public.crm_orders),'revocation effective without JWT refresh'; end $$;
set local role anon;
do $$begin
 begin perform public.crm_overview('10000000-0000-4000-8000-000000000010'); raise exception 'TEST_EXPECTED_ANON'; exception when insufficient_privilege then null; end;
 begin perform * from public.crm_orders; raise exception 'TEST_EXPECTED_ANON_READ'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'CRM database assertions passed; fixtures rolled back' as verification;
