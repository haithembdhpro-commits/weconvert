-- Confirmoo-style orders board (owner request 28/10/2026): logistic stages, parcel column, explicit call attempts.
-- crm_private.command is the 20261028002625 version, changed only in the order.call branch (optional explicit attempt).

create or replace function crm_private.command(p_workspace uuid, p_action text, p_payload jsonb, p_request uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
 u uuid:=auth.uid(); m public.crm_members; prev crm_private.requests; o public.crm_orders; p public.crm_products;
 target public.crm_members; sid uuid; oid uuid; pid uuid; assignee uuid; item jsonb; result jsonb; event_data jsonb:='{}';
 ev text; new_status text; qty integer; price numeric(14,2); subtotal numeric(14,2):=0; v_fee numeric(14,2); v_discount numeric(14,2);
 token text; inv_id uuid; cb timestamptz; reason text; r record; stock_delta integer; stored_result jsonb;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>100000 then raise exception 'INVALID_REQUEST'; end if;
 select * into m from public.crm_members where workspace_id=p_workspace and user_id=u and active for share;
 if not found then raise exception 'FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||p_request::text,0));
 select * into prev from crm_private.requests where workspace_id=p_workspace and request_id=p_request;
 if found then
  if prev.actor_id<>u or prev.action<>p_action or prev.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return prev.result;
 end if;
 if p_action in ('order.create','product.save','stock.adjust','store.create') then
  sid:=(p_payload->>'store_id')::uuid;
  if p_action<>'store.create' and not exists(select 1 from public.crm_stores where id=sid and workspace_id=p_workspace) then raise exception 'NOT_FOUND'; end if;
 end if;
 if p_action like 'order.%' and p_action<>'order.create' then
  oid:=(p_payload->>'id')::uuid;
  select * into o from public.crm_orders where id=oid and workspace_id=p_workspace for update;
  if not found or (m.role='agent' and o.assigned_to is distinct from u) then raise exception 'NOT_FOUND'; end if;
  sid:=o.store_id;
  if o.version is distinct from (p_payload->>'version')::integer then raise exception 'VERSION_CONFLICT'; end if;
 end if;

 if p_action in ('order.create','order.edit') then
  if p_action='order.edit' and o.status not in ('new','call1','call2','call3','reported','check') then raise exception 'ORDER_LOCKED'; end if;
  if p_action='order.create' then
   assignee:=case when m.role='agent' then u else nullif(p_payload->>'assigned_to','')::uuid end;
  else assignee:=o.assigned_to; end if;
  if assignee is not null and not exists(select 1 from public.crm_members where workspace_id=p_workspace and user_id=assignee and active) then raise exception 'INVALID_AGENT'; end if;
  v_fee:=coalesce((p_payload->>'fee')::numeric,0); v_discount:=coalesce((p_payload->>'discount')::numeric,0);
  if v_fee<0 or v_discount<0 or (m.role='agent' and v_discount<>case when p_action='order.edit' then o.discount else 0 end) then raise exception 'INVALID_AMOUNT'; end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'INVALID_ITEMS'; end if;
  if (select count(*)<>count(distinct x->>'product_id') from jsonb_array_elements(p_payload->'items') x) then raise exception 'DUPLICATE_ITEM'; end if;
  for item in select value from jsonb_array_elements(p_payload->'items') order by value->>'product_id' loop
   select * into p from public.crm_products where id=(item->>'product_id')::uuid and workspace_id=p_workspace and store_id=sid for share;
   if not found then raise exception 'INVALID_PRODUCT'; end if;
   qty:=(item->>'quantity')::integer; price:=(item->>'unit_price')::numeric;
   if qty is null or qty not between 1 and 10000 or price is null or price<0 then raise exception 'INVALID_ITEMS'; end if;
   if m.role='agent' and price<>p.price and not (p_action='order.edit' and exists(select 1 from public.crm_order_items i where i.order_id=oid and i.product_id=p.id and i.unit_price=price)) then raise exception 'PRICE_FORBIDDEN'; end if;
   subtotal:=subtotal+qty*price;
  end loop;
  if subtotal+v_fee-v_discount<0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_action='order.create' then
   insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,commune,address,channel,source_detail,delivery_type,assigned_to,fee,discount,total,created_by)
   values(p_workspace,sid,trim(p_payload->>'customer_name'),crm_private.normalize_phone(p_payload->>'phone'),trim(p_payload->>'wilaya'),trim(coalesce(p_payload->>'commune','')),trim(coalesce(p_payload->>'address','')),p_payload->>'channel',coalesce(p_payload->>'source_detail',''),coalesce(p_payload->>'delivery_type','home'),assignee,v_fee,v_discount,subtotal+v_fee-v_discount,u) returning id into oid;
   ev:='order.created'; event_data:=jsonb_build_object('channel',p_payload->>'channel','assigned_to',assignee);
  else
   update public.crm_orders set customer_name=trim(p_payload->>'customer_name'),phone=crm_private.normalize_phone(p_payload->>'phone'),wilaya=trim(p_payload->>'wilaya'),commune=trim(coalesce(p_payload->>'commune','')),address=trim(coalesce(p_payload->>'address','')),channel=p_payload->>'channel',source_detail=coalesce(p_payload->>'source_detail',''),delivery_type=coalesce(p_payload->>'delivery_type','home'),fee=v_fee,discount=v_discount,total=subtotal+v_fee-v_discount where id=oid;
   ev:='order.edited'; event_data:=jsonb_build_object('previous',to_jsonb(o)-'created_by','previous_items',(select jsonb_agg(to_jsonb(i)) from public.crm_order_items i where order_id=oid),'changes',p_payload-'id'-'version');
   delete from public.crm_order_items where order_id=oid;
  end if;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
   select * into p from public.crm_products where id=(item->>'product_id')::uuid and store_id=sid;
   insert into public.crm_order_items(workspace_id,store_id,order_id,product_id,product_name,sku,quantity,unit_price)
   values(p_workspace,sid,oid,p.id,p.name,p.sku,(item->>'quantity')::integer,(item->>'unit_price')::numeric);
  end loop;
 elsif p_action='order.status' then
  new_status:=p_payload->>'status'; reason:=trim(coalesce(p_payload->>'reason',''));
  if new_status not in ('new','check','confirmed','cancelled','duplicate','fake') or new_status is null then raise exception 'INVALID_TRANSITION'; end if;
  if o.status=new_status then raise exception 'INVALID_TRANSITION'; end if;
  if o.status in ('confirmed','cancelled','duplicate','fake') and not (m.role in ('owner','admin') and new_status in ('new','cancelled') and new_status<>o.status) then raise exception 'INVALID_TRANSITION'; end if;
  if new_status in ('cancelled','duplicate','fake','new') and length(reason) not between 2 and 2000 then raise exception 'REASON_REQUIRED'; end if;
  if new_status='confirmed' and (length(trim(o.address))<3 or length(trim(o.commune))<2) then raise exception 'ADDRESS_REQUIRED'; end if;
  if o.status='confirmed' and exists(select 1 from public.crm_shipments s where s.order_id=oid and s.state not in ('cancelled','returned')) then raise exception 'SHIPMENT_ACTIVE'; end if;
  if new_status='confirmed' or o.stock_reserved then
   for r in select i.product_id,i.quantity from public.crm_order_items i where order_id=oid order by product_id loop
    select * into p from public.crm_products where id=r.product_id for update;
    if new_status='confirmed' and p.stock-p.reserved<r.quantity then raise exception 'INSUFFICIENT_STOCK: %',p.name; end if;
    update public.crm_products set reserved=reserved+case when new_status='confirmed' then r.quantity else -r.quantity end where id=p.id;
   end loop;
  end if;
  update public.crm_orders set status=new_status,stock_reserved=(new_status='confirmed'),callback_at=null where id=oid;
  ev:='order.status'; event_data:=jsonb_build_object('from',o.status,'to',new_status,'reason',reason);
 elsif p_action='order.call' then
  if o.status not in ('new','call1','call2','call3','reported','check') then raise exception 'ORDER_LOCKED'; end if;
  -- Status menu (Confirmoo style) may name the attempt: "Appel 2", "Appel 3". Never backwards, at most 20.
  if p_payload ? 'attempt' and coalesce(p_payload->>'attempt','') !~ '^[0-9]{1,2}$' then raise exception 'INVALID_TRANSITION'; end if;
  qty:=coalesce((p_payload->>'attempt')::integer,o.attempts+1);
  if qty<=o.attempts or qty>20 then raise exception 'INVALID_TRANSITION'; end if;
  update public.crm_orders set attempts=qty,status=case when qty=1 then 'call1' when qty=2 then 'call2' else 'call3' end,callback_at=null where id=oid;
  ev:='order.call'; event_data:=jsonb_build_object('outcome','no_answer','attempt',qty);
 elsif p_action='order.callback' then
  if o.status not in ('new','call1','call2','call3','reported','check') then raise exception 'ORDER_LOCKED'; end if;
  cb:=(p_payload->>'callback_at')::timestamptz;
  if cb is null or cb<now() or cb>now()+interval '1 year' then raise exception 'INVALID_CALLBACK'; end if;
  reason:=trim(coalesce(p_payload->>'note',''));
  if length(reason)>2000 then raise exception 'INVALID_NOTE'; end if;
  update public.crm_orders set status='reported',callback_at=cb where id=oid;
  ev:='order.callback'; event_data:=jsonb_build_object('callback_at',cb,'note',reason);
 elsif p_action='order.note' then
  reason:=trim(coalesce(p_payload->>'note',''));
  if length(reason) not between 1 and 2000 then raise exception 'INVALID_NOTE'; end if;
  ev:='order.note'; event_data:=jsonb_build_object('note',reason);
 elsif p_action='order.assign' then
  if m.role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
  assignee:=nullif(p_payload->>'assigned_to','')::uuid;
  if assignee is not null and not exists(select 1 from public.crm_members where workspace_id=p_workspace and user_id=assignee and active) then raise exception 'INVALID_AGENT'; end if;
  update public.crm_orders set assigned_to=assignee where id=oid;
  ev:='order.assigned'; event_data:=jsonb_build_object('from',o.assigned_to,'to',assignee);
 elsif p_action='product.save' then
  if m.role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
  pid:=nullif(p_payload->>'id','')::uuid;
  if pid is null then
   insert into public.crm_products(workspace_id,store_id,name,sku,price,stock) values(p_workspace,sid,trim(p_payload->>'name'),trim(p_payload->>'sku'),(p_payload->>'price')::numeric,coalesce((p_payload->>'stock')::integer,0)) returning id into pid;
  else
   select * into p from public.crm_products where id=pid and workspace_id=p_workspace and store_id=sid for update;
   if not found then raise exception 'NOT_FOUND'; end if;
   if p.version is distinct from (p_payload->>'version')::integer then raise exception 'VERSION_CONFLICT'; end if;
   update public.crm_products set name=trim(p_payload->>'name'),sku=trim(p_payload->>'sku'),price=(p_payload->>'price')::numeric,version=version+1 where id=pid;
  end if;
  ev:='product.saved'; event_data:=jsonb_build_object('product_id',pid,'values',p_payload);
  result:=jsonb_build_object('id',pid);
 elsif p_action='stock.adjust' then
  if m.role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
  pid:=(p_payload->>'id')::uuid; stock_delta:=(p_payload->>'delta')::integer; reason:=trim(coalesce(p_payload->>'reason',''));
  if stock_delta is null or stock_delta=0 or length(reason) not between 2 and 2000 then raise exception 'INVALID_ADJUSTMENT'; end if;
  select * into p from public.crm_products where id=pid and workspace_id=p_workspace and store_id=sid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p.version is distinct from (p_payload->>'version')::integer then raise exception 'VERSION_CONFLICT'; end if;
  if p.stock+stock_delta<p.reserved then raise exception 'STOCK_RESERVED'; end if;
  update public.crm_products set stock=stock+stock_delta,version=version+1 where id=pid;
  ev:='stock.adjusted'; event_data:=jsonb_build_object('product_id',pid,'delta',stock_delta,'reason',reason,'before',p.stock,'after',p.stock+stock_delta);
  result:=jsonb_build_object('id',pid);
 elsif p_action='store.create' then
  if m.role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
  insert into public.crm_stores(workspace_id,name) values(p_workspace,trim(p_payload->>'name')) returning id into sid;
  ev:='store.created'; event_data:=jsonb_build_object('name',p_payload->>'name'); result:=jsonb_build_object('id',sid);
 elsif p_action='member.invite' then
  if m.role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
  if (p_payload->>'role') not in ('admin','agent') or (m.role='admin' and p_payload->>'role'<>'agent') then raise exception 'FORBIDDEN'; end if;
  if coalesce(p_payload->>'email','') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(p_payload->>'email')>254 or length(trim(coalesce(p_payload->>'display_name',''))) not between 2 and 100 then raise exception 'INVALID_MEMBER'; end if;
  token:=gen_random_uuid()::text||gen_random_uuid()::text;
  insert into crm_private.invitations(workspace_id,email,display_name,role,token_hash,created_by)
  values(p_workspace,lower(trim(p_payload->>'email')),trim(p_payload->>'display_name'),p_payload->>'role',encode(sha256(convert_to(token,'UTF8')),'hex'),u) returning id into inv_id;
  ev:='member.invited'; event_data:=jsonb_build_object('invitation_id',inv_id,'role',p_payload->>'role'); result:=jsonb_build_object('token',token,'expires_at',now()+interval '7 days');
 elsif p_action='member.update' then
  if m.role<>'owner' then raise exception 'FORBIDDEN'; end if;
  select * into target from public.crm_members where workspace_id=p_workspace and user_id=(p_payload->>'user_id')::uuid for update;
  if not found or target.role='owner' then raise exception 'FORBIDDEN'; end if;
  if p_payload->>'role' not in ('admin','agent') then raise exception 'INVALID_MEMBER'; end if;
  update public.crm_members set role=p_payload->>'role',active=(p_payload->>'active')::boolean where workspace_id=p_workspace and user_id=target.user_id;
  ev:='member.updated'; event_data:=jsonb_build_object('user_id',target.user_id,'role',p_payload->>'role','active',p_payload->'active'); result:='{}';
 else raise exception 'UNKNOWN_ACTION';
 end if;
 if oid is not null then
  if p_action<>'order.create' then update public.crm_orders set version=version+1,updated_at=now() where id=oid; end if;
  select jsonb_build_object('id',id,'number',number,'version',version,'status',status) into result from public.crm_orders where id=oid;
 end if;
 insert into public.crm_events(workspace_id,store_id,order_id,actor_id,actor_name,kind,data) values(p_workspace,sid,oid,u,m.display_name,ev,event_data);
 -- The idempotency record must never hold the one-time invitation token in clear text.
 stored_result:=case when p_action='member.invite' then result-'token' else result end;
 insert into crm_private.requests(workspace_id,request_id,actor_id,action,payload,result) values(p_workspace,p_request,u,p_action,p_payload,stored_result);
 return result;
end $function$;

-- Orders board (Confirmoo-style): one row per order with its logistic stage and carrier parcel, plus stage counters.
-- Stage: delivered / returned / dispatched come from the CRM parcel (a parcel cancelled at the carrier does not count);
-- otherwise pending confirmation statuses = new, confirmed = preparing, cancelled/duplicate/fake = closed.
-- Security invoker: RLS keeps an agent on the orders assigned to them.
create or replace function public.crm_order_board(p_store uuid,p_stage text default 'all',p_status text default 'all',p_query text default '',
 p_page integer default 1,p_size integer default 20,p_agent uuid default null,p_ascending boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_page<1 or p_size not between 1 and 100 or length(coalesce(p_query,''))>200
  or coalesce(p_stage,'') not in ('all','new','preparing','dispatched','delivered','returned','closed')
  or coalesce(p_status,'') not in ('all','new','call1','call2','call3','reported','check','confirmed','cancelled','duplicate','fake')
 then raise exception 'INVALID_FILTER';end if;
 with base as (
  select o.*,s.state ship_state,s.raw_status ship_raw,s.tracking ship_tracking,s.updated_at ship_updated_at,
   case when s.state='delivered' then 'delivered' when s.state='returned' then 'returned'
    when s.state is not null and s.state<>'cancelled' then 'dispatched'
    when o.status in ('new','call1','call2','call3','reported','check') then 'new'
    when o.status='confirmed' then 'preparing' else 'closed' end stage
  from public.crm_orders o left join public.crm_shipments s on s.order_id=o.id
  where o.store_id=p_store and (p_agent is null or o.assigned_to=p_agent)
   and (p_status='all' or o.status=p_status)
   and (coalesce(p_query,'')='' or strpos(lower(o.customer_name||' '||o.phone||' '||o.number::text||' '||coalesce(o.woo_number::text,'')||' '||coalesce(o.source_external_id,'')||' '||o.wilaya||' '||coalesce(s.tracking,'')),lower(p_query))>0)
 ), matching as (select * from base where p_stage='all' or stage=p_stage),
 paged as (
  select m.*,row_number() over(order by case when p_ascending then m.created_at end asc,case when not p_ascending then m.created_at end desc,m.id) rn
  from matching m order by rn limit p_size offset (p_page-1)*p_size
 )
 select jsonb_build_object(
  'total',(select count(*) from matching),
  'stages',coalesce((select jsonb_object_agg(stage,n) from (select stage,count(*) n from base group by stage) x),'{}'::jsonb),
  'items',coalesce((select jsonb_agg((to_jsonb(p)-'ship_state'-'ship_raw'-'ship_tracking'-'ship_updated_at'-'rn')
    ||jsonb_build_object('shipment',case when p.ship_state is null then null else jsonb_build_object('state',p.ship_state,'raw_status',p.ship_raw,'tracking',p.ship_tracking,'updated_at',p.ship_updated_at) end,
     'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.crm_order_items i where i.order_id=p.id)) order by p.rn) from paged p),'[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.crm_order_board(uuid,text,text,text,integer,integer,uuid,boolean) from public,anon;
grant execute on function public.crm_order_board(uuid,text,text,text,integer,integer,uuid,boolean) to authenticated;
