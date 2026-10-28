-- WeConvert CRM / tranche 1. All mutations are transactional commands.
create schema if not exists crm_private;
revoke all on schema crm_private from public, anon;
grant usage on schema crm_private to authenticated;

create table public.crm_workspaces (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 2 and 100),
 created_by uuid not null references auth.users(id), request_id uuid not null,
 created_at timestamptz not null default now(), unique(created_by,request_id)
);
create table public.crm_members (
 workspace_id uuid not null references public.crm_workspaces(id), user_id uuid not null references auth.users(id),
 display_name text not null check(length(trim(display_name)) between 2 and 100),
 role text not null check(role in ('owner','admin','agent')), active boolean not null default true,
 created_at timestamptz not null default now(), primary key(workspace_id,user_id)
);
create index crm_members_user_idx on public.crm_members(user_id,workspace_id) where active;
create unique index crm_one_owner on public.crm_members(workspace_id) where role='owner';
create table public.crm_stores (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.crm_workspaces(id),
 name text not null check(length(trim(name)) between 2 and 100), created_at timestamptz not null default now(),
 unique(workspace_id,id)
);
create table public.crm_products (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null,
 name text not null check(length(trim(name)) between 2 and 160), sku text not null check(length(trim(sku)) between 1 and 80),
 price numeric(14,2) not null check(price>=0), stock integer not null default 0 check(stock>=0),
 reserved integer not null default 0 check(reserved>=0 and reserved<=stock),
 version integer not null default 1, created_at timestamptz not null default now(),
 foreign key(workspace_id,store_id) references public.crm_stores(workspace_id,id),
 unique(workspace_id,store_id,id), unique(store_id,sku)
);
create index crm_products_store_idx on public.crm_products(store_id,name,id);
create table public.crm_orders (
 id uuid primary key default gen_random_uuid(), number bigint generated always as identity unique,
 workspace_id uuid not null, store_id uuid not null,
 customer_name text not null check(length(trim(customer_name)) between 2 and 100),
 phone text not null check(phone ~ '^\+[0-9]{8,15}$'),
 wilaya text not null check(length(trim(wilaya)) between 2 and 80), commune text not null default '' check(length(commune)<=100),
 address text not null default '' check(length(address)<=500),
 channel text not null check(channel in ('manual','website','whatsapp','messenger','instagram','phone')),
 source_detail text not null default '' check(length(source_detail)<=500),
 delivery_type text not null default 'home' check(delivery_type in ('home','desk')),
 status text not null default 'new' check(status in ('new','call1','call2','call3','reported','check','confirmed','cancelled','duplicate','fake')),
 assigned_to uuid, callback_at timestamptz,
 attempts integer not null default 0 check(attempts>=0),
 fee numeric(14,2) not null default 0 check(fee>=0), discount numeric(14,2) not null default 0 check(discount>=0),
 total numeric(14,2) not null check(total>=0),
 version integer not null default 1,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(workspace_id,store_id) references public.crm_stores(workspace_id,id),
 foreign key(workspace_id,assigned_to) references public.crm_members(workspace_id,user_id),
 unique(workspace_id,store_id,id)
);
create index crm_orders_queue_idx on public.crm_orders(store_id,status,created_at desc,id);
create index crm_orders_assignee_idx on public.crm_orders(workspace_id,assigned_to,created_at desc);
create index crm_orders_phone_idx on public.crm_orders(store_id,phone);
create index crm_orders_callback_idx on public.crm_orders(store_id,callback_at) where callback_at is not null;
create index crm_orders_created_by_idx on public.crm_orders(created_by);
create table public.crm_order_items (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null, order_id uuid not null,
 product_id uuid not null, product_name text not null, sku text not null,
 quantity integer not null check(quantity between 1 and 10000), unit_price numeric(14,2) not null check(unit_price>=0),
 foreign key(workspace_id,store_id,order_id) references public.crm_orders(workspace_id,store_id,id),
 foreign key(workspace_id,store_id,product_id) references public.crm_products(workspace_id,store_id,id),
 unique(order_id,product_id)
);
create index crm_items_product_idx on public.crm_order_items(workspace_id,store_id,product_id);
create index crm_items_order_fk_idx on public.crm_order_items(workspace_id,store_id,order_id);
create table public.crm_events (
 id bigint generated always as identity primary key, workspace_id uuid not null references public.crm_workspaces(id),
 store_id uuid, order_id uuid, actor_id uuid not null references auth.users(id), actor_name text not null,
 kind text not null, data jsonb not null default '{}', created_at timestamptz not null default now(),
 foreign key(workspace_id,store_id) references public.crm_stores(workspace_id,id),
 foreign key(workspace_id,store_id,order_id) references public.crm_orders(workspace_id,store_id,id)
);
create index crm_events_order_idx on public.crm_events(order_id,id desc);
create index crm_events_workspace_idx on public.crm_events(workspace_id,id desc);
create index crm_events_store_fk_idx on public.crm_events(workspace_id,store_id);
create index crm_events_order_fk_idx on public.crm_events(workspace_id,store_id,order_id);
create index crm_events_actor_idx on public.crm_events(actor_id);
create table crm_private.requests (
 workspace_id uuid not null references public.crm_workspaces(id), request_id uuid not null,
 actor_id uuid not null references auth.users(id), action text not null, payload jsonb not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(workspace_id,request_id)
);
create index crm_requests_actor_idx on crm_private.requests(actor_id);
create table crm_private.invitations (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.crm_workspaces(id),
 email text not null, display_name text not null, role text not null check(role in ('admin','agent')),
 token_hash text unique not null, expires_at timestamptz not null default now()+interval '7 days',
 used_at timestamptz, created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index crm_invitations_workspace_idx on crm_private.invitations(workspace_id);
create index crm_invitations_actor_idx on crm_private.invitations(created_by);
alter table crm_private.requests enable row level security;
alter table crm_private.invitations enable row level security;

create function crm_private.member_role(w uuid) returns text language sql stable security definer set search_path='' as $$
 select m.role from public.crm_members m where m.workspace_id=w and m.user_id=(select auth.uid()) and m.active and auth.uid() is not null
$$;
create function crm_private.can_read_order(o uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.crm_orders x join public.crm_members m on m.workspace_id=x.workspace_id
 where x.id=o and m.user_id=(select auth.uid()) and m.active and (m.role in ('owner','admin') or x.assigned_to=auth.uid()))
$$;
alter table public.crm_workspaces enable row level security;
alter table public.crm_members enable row level security;
alter table public.crm_stores enable row level security;
alter table public.crm_products enable row level security;
alter table public.crm_orders enable row level security;
alter table public.crm_order_items enable row level security;
alter table public.crm_events enable row level security;
create policy crm_workspace_read on public.crm_workspaces for select to authenticated using(crm_private.member_role(id) is not null);
create policy crm_members_read on public.crm_members for select to authenticated using(crm_private.member_role(workspace_id) is not null);
create policy crm_stores_read on public.crm_stores for select to authenticated using(crm_private.member_role(workspace_id) is not null);
create policy crm_products_read on public.crm_products for select to authenticated using(crm_private.member_role(workspace_id) is not null);
create policy crm_orders_read on public.crm_orders for select to authenticated using(
 crm_private.member_role(workspace_id) in ('owner','admin') or (assigned_to=(select auth.uid()) and crm_private.member_role(workspace_id)='agent'));
create policy crm_items_read on public.crm_order_items for select to authenticated using(crm_private.can_read_order(order_id));
create policy crm_events_read on public.crm_events for select to authenticated using(
 crm_private.member_role(workspace_id) in ('owner','admin') or (order_id is not null and crm_private.can_read_order(order_id)));
revoke all on public.crm_workspaces,public.crm_members,public.crm_stores,public.crm_products,public.crm_orders,public.crm_order_items,public.crm_events from anon,authenticated;
grant select on public.crm_workspaces,public.crm_members,public.crm_stores,public.crm_products,public.crm_orders,public.crm_order_items,public.crm_events to authenticated;

create function crm_private.bootstrap(p_name text,p_store text,p_display text,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); w uuid;
begin
 if u is null or not exists(select 1 from auth.users where id=u and email_confirmed_at is not null and not coalesce(is_anonymous,false)) then raise exception 'AUTH_REQUIRED'; end if;
 if p_request is null then raise exception 'REQUEST_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_request::text,0));
 select id into w from public.crm_workspaces where created_by=u and request_id=p_request;
 if w is not null then return w; end if;
 insert into public.crm_workspaces(name,created_by,request_id) values(trim(p_name),u,p_request) returning id into w;
 insert into public.crm_members(workspace_id,user_id,display_name,role) values(w,u,trim(p_display),'owner');
 insert into public.crm_stores(workspace_id,name) values(w,trim(p_store));
 return w;
end $$;
create function public.crm_bootstrap(p_name text,p_store text,p_display text,p_request uuid) returns uuid language sql security invoker set search_path='' as $$
 select crm_private.bootstrap(p_name,p_store,p_display,p_request)
$$;

create function crm_private.normalize_phone(p text) returns text language plpgsql immutable set search_path='' as $$
declare s text:=regexp_replace(trim(p),'[\s().-]','','g');
begin
 if s ~ '^00' then s:='+'||substring(s from 3); end if;
 if s ~ '^0[567][0-9]{8}$' then s:='+213'||substring(s from 2); end if;
 if s !~ '^\+[0-9]{8,15}$' or (s like '+213%' and s !~ '^\+213[567][0-9]{8}$') then raise exception 'INVALID_PHONE'; end if;
 return s;
end $$;

create function crm_private.command(p_workspace uuid,p_action text,p_payload jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); m public.crm_members; prev crm_private.requests; o public.crm_orders; p public.crm_products;
 target public.crm_members; sid uuid; oid uuid; pid uuid; assignee uuid; item jsonb; result jsonb; event_data jsonb:='{}';
 ev text; new_status text; qty integer; price numeric(14,2); subtotal numeric(14,2):=0; v_fee numeric(14,2); v_discount numeric(14,2);
 token text; inv_id uuid; cb timestamptz; reason text; r record; stock_delta integer;
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
  if v_fee<0 or v_discount<0 or (m.role='agent' and v_discount<>0) then raise exception 'INVALID_AMOUNT'; end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'INVALID_ITEMS'; end if;
  if (select count(*)<>count(distinct x->>'product_id') from jsonb_array_elements(p_payload->'items') x) then raise exception 'DUPLICATE_ITEM'; end if;
  for item in select value from jsonb_array_elements(p_payload->'items') order by value->>'product_id' loop
   select * into p from public.crm_products where id=(item->>'product_id')::uuid and workspace_id=p_workspace and store_id=sid for share;
   if not found then raise exception 'INVALID_PRODUCT'; end if;
   qty:=(item->>'quantity')::integer; price:=(item->>'unit_price')::numeric;
   if qty is null or qty not between 1 and 10000 or price is null or price<0 then raise exception 'INVALID_ITEMS'; end if;
   if m.role='agent' and price<>p.price then raise exception 'PRICE_FORBIDDEN'; end if;
   subtotal:=subtotal+qty*price;
  end loop;
  if subtotal+v_fee-v_discount<0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_action='order.create' then
   insert into public.crm_orders(workspace_id,store_id,customer_name,phone,wilaya,commune,address,channel,source_detail,delivery_type,assigned_to,fee,discount,total,created_by)
   values(p_workspace,sid,trim(p_payload->>'customer_name'),crm_private.normalize_phone(p_payload->>'phone'),trim(p_payload->>'wilaya'),trim(coalesce(p_payload->>'commune','')),trim(coalesce(p_payload->>'address','')),p_payload->>'channel',coalesce(p_payload->>'source_detail',''),coalesce(p_payload->>'delivery_type','home'),assignee,v_fee,v_discount,subtotal+v_fee-v_discount,u) returning id into oid;
   ev:='order.created'; event_data:=jsonb_build_object('channel',p_payload->>'channel','assigned_to',assignee);
  else
   update public.crm_orders set customer_name=trim(p_payload->>'customer_name'),phone=crm_private.normalize_phone(p_payload->>'phone'),wilaya=trim(p_payload->>'wilaya'),commune=trim(coalesce(p_payload->>'commune','')),address=trim(coalesce(p_payload->>'address','')),channel=p_payload->>'channel',source_detail=coalesce(p_payload->>'source_detail',''),delivery_type=coalesce(p_payload->>'delivery_type','home'),fee=v_fee,discount=v_discount,total=subtotal+v_fee-v_discount where id=oid;
   delete from public.crm_order_items where order_id=oid;
   ev:='order.edited'; event_data:=jsonb_build_object('previous',to_jsonb(o)-'created_by','changes',p_payload-'id'-'version');
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
  -- Lock products in deterministic order; a second confirmation cannot oversell.
  if new_status='confirmed' or o.status='confirmed' then
   for r in select i.product_id,i.quantity from public.crm_order_items i where order_id=oid order by product_id loop
    select * into p from public.crm_products where id=r.product_id for update;
    if new_status='confirmed' and p.stock-p.reserved<r.quantity then raise exception 'INSUFFICIENT_STOCK: %',p.name; end if;
    update public.crm_products set reserved=reserved+case when new_status='confirmed' then r.quantity else -r.quantity end,version=version+1 where id=p.id;
   end loop;
  end if;
  update public.crm_orders set status=new_status,callback_at=null where id=oid;
  ev:='order.status'; event_data:=jsonb_build_object('from',o.status,'to',new_status,'reason',reason);
 elsif p_action='order.call' then
  if o.status not in ('new','call1','call2','call3','reported','check') then raise exception 'ORDER_LOCKED'; end if;
  update public.crm_orders set attempts=attempts+1,status=case when attempts=0 then 'call1' when attempts=1 then 'call2' else 'call3' end,callback_at=null where id=oid;
  ev:='order.call'; event_data:=jsonb_build_object('outcome','no_answer','attempt',o.attempts+1);
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
 insert into crm_private.requests(workspace_id,request_id,actor_id,action,payload,result) values(p_workspace,p_request,u,p_action,p_payload,result);
 return result;
end $$;
create function public.crm_command(p_workspace uuid,p_action text,p_payload jsonb,p_request uuid) returns jsonb language sql security invoker set search_path='' as $$
 select crm_private.command(p_workspace,p_action,p_payload,p_request)
$$;

create function crm_private.accept_invitation(p_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); e text; i crm_private.invitations;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 select lower(email) into e from auth.users where id=u and email_confirmed_at is not null and not coalesce(is_anonymous,false);
 select * into i from crm_private.invitations where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found or i.expires_at<now() or i.email is distinct from e then raise exception 'INVITATION_INVALID'; end if;
 if i.used_at is not null then
  if exists(select 1 from public.crm_members where workspace_id=i.workspace_id and user_id=u and active) then return i.workspace_id; end if;
  raise exception 'INVITATION_INVALID';
 end if;
 -- A removed/downgraded inviter cannot grant their previous permissions.
 if not exists(select 1 from public.crm_members where workspace_id=i.workspace_id and user_id=i.created_by and active and (role='owner' or (role='admin' and i.role='agent'))) then raise exception 'INVITATION_INVALID'; end if;
 if exists(select 1 from public.crm_members where workspace_id=i.workspace_id and user_id=u) then raise exception 'ALREADY_MEMBER'; end if;
 insert into public.crm_members(workspace_id,user_id,display_name,role) values(i.workspace_id,u,i.display_name,i.role);
 update crm_private.invitations set used_at=now() where id=i.id;
 insert into public.crm_events(workspace_id,actor_id,actor_name,kind,data) values(i.workspace_id,u,i.display_name,'member.joined',jsonb_build_object('role',i.role));
 return i.workspace_id;
end $$;
create function public.crm_accept_invitation(p_token text) returns uuid language sql security invoker set search_path='' as $$select crm_private.accept_invitation(p_token)$$;

create function public.crm_list_orders(p_store uuid,p_status text default 'all',p_query text default '',p_page integer default 1,p_size integer default 20,p_agent uuid default null,p_ascending boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_page<1 or p_size not between 1 and 100 or length(p_query)>200 then raise exception 'INVALID_FILTER'; end if;
 with matching as (
 select o.* from public.crm_orders o where store_id=p_store
 and (p_status='all' or o.status=p_status or (p_status='pending' and o.status in ('new','call1','call2','call3','reported','check')) or (p_status='cancelled_all' and o.status in ('cancelled','duplicate','fake')) or (p_status='due' and o.callback_at<=now()))
 and (p_agent is null or assigned_to=p_agent)
 and (p_query='' or strpos(lower(o.customer_name||' '||o.phone||' '||o.number::text||' '||o.wilaya),lower(p_query))>0)
 ), paged as (select * from matching order by case when p_ascending then created_at end asc,case when not p_ascending then created_at end desc,id limit p_size offset (p_page-1)*p_size)
 select jsonb_build_object('total',(select count(*) from matching),'items',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.crm_order_items i where order_id=o.id))) from paged o),'[]'::jsonb)) into result;
 return result;
end $$;
create function public.crm_order_detail(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select to_jsonb(o)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.crm_order_items i where order_id=o.id),'[]'::jsonb),'events',coalesce((select jsonb_agg(to_jsonb(e) order by id desc) from (select * from public.crm_events where order_id=o.id order by id desc limit 100) e),'[]'::jsonb)) from public.crm_orders o where id=p_id
$$;
create function public.crm_overview(p_store uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'all',count(*),'new',count(*) filter(where status='new'),
 'pending',count(*) filter(where status in ('new','call1','call2','call3','reported','check')),
 'confirmed',count(*) filter(where status='confirmed'),
 'cancelled',count(*) filter(where status in ('cancelled','duplicate','fake')),
 'callbacks',count(*) filter(where callback_at is not null),'due',count(*) filter(where callback_at<=now()),
 'confirmed_amount',coalesce(sum(total) filter(where status='confirmed'),0),
 'today',count(*) filter(where created_at >= date_trunc('day',now() at time zone 'Africa/Algiers') at time zone 'Africa/Algiers'),
 'days',(select coalesce(jsonb_agg(jsonb_build_object('date',d.day,'count',(select count(*) from public.crm_orders x where x.store_id=p_store and (x.created_at at time zone 'Africa/Algiers')::date=d.day)) order by d.day),'[]'::jsonb)
 from (select ((now() at time zone 'Africa/Algiers')::date-n) as day from generate_series(6,0,-1) n) d)
 ) from public.crm_orders where store_id=p_store
$$;

-- Explicit function grants: no anonymous RPCs, no table writes, no exposed definer.
revoke all on all functions in schema crm_private from public,anon,authenticated;
grant execute on function crm_private.member_role(uuid),crm_private.can_read_order(uuid),crm_private.bootstrap(text,text,text,uuid),crm_private.command(uuid,text,jsonb,uuid),crm_private.accept_invitation(text) to authenticated;
revoke all on function public.crm_bootstrap(text,text,text,uuid),public.crm_command(uuid,text,jsonb,uuid),public.crm_accept_invitation(text),public.crm_list_orders(uuid,text,text,integer,integer,uuid,boolean),public.crm_order_detail(uuid),public.crm_overview(uuid) from public,anon;
grant execute on function public.crm_bootstrap(text,text,text,uuid),public.crm_command(uuid,text,jsonb,uuid),public.crm_accept_invitation(text),public.crm_list_orders(uuid,text,text,integer,integer,uuid,boolean),public.crm_order_detail(uuid),public.crm_overview(uuid) to authenticated;
