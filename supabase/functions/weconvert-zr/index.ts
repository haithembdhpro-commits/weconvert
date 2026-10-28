import {createClient} from '@supabase/supabase-js';
import {zrState,legacyParcel,newParcel,matchTerritory,parcelFacts} from './domain.mjs';

const url=Deno.env.get('SUPABASE_URL')!;
const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set([(Deno.env.get('WECONVERT_FRONTEND_URL')||'https://weconvert-cod-studio-ht26.citrus-mug-9991.chatgpt.site').replace(/\/+$/,''),...(Deno.env.get('WECONVERT_DEV_ORIGINS')||'').split(',').map(x=>x.trim()).filter(x=>/^https?:\/\/[^\s,]+$/.test(x))]);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const known=new Set(['AUTH_REQUIRED','FORBIDDEN','INVALID_REQUEST','INVALID_PLATFORM','INVALID_KEYS','INVALID_HUB','HUB_REQUIRED','PLATFORM_LOCKED','DISCONNECTED','NOT_FOUND','CONNECTION_CHANGED','ORDER_NOT_READY','ADDRESS_REQUIRED','INVALID_ITEMS','ALREADY_SENT','WILAYA_CODE_REQUIRED','TERRITORY_REQUIRED','READY_STATE_REQUIRED','PICKUP_UNAVAILABLE','INVALID_TRACKING','NEEDS_REVIEW','ZR_AUTH','ZR_UNREACHABLE','ZR_RESPONSE','ZR_REJECTED','ZR_RATE_LIMIT','ZR_NOT_FOUND','REFERENCE_MISMATCH','PARCEL_MISMATCH']);
class ZrError extends Error{constructor(code:string,public status=400){super(code);}}
function code(e:unknown){const value=e instanceof Error?e.message:'';return known.has(value)?value:'ZR_RESPONSE';}
async function rpc(action:string,p:Record<string,unknown>){
 const {data,error}=await db.rpc('crm_shipping_service',{p_action:action,p});
 if(error)throw new ZrError(code(error),['FORBIDDEN','DISCONNECTED'].includes(error.message)?403:409);
 return data;
}
async function provider(c:any,path:string,method='GET',body?:unknown){
 const base=c.platform==='new'?'https://api.zrexpress.app/api/v1/':'https://procolis.com/api_v1/';
 const endpoint=new URL(path,base);
 const headers:Record<string,string>={Accept:'application/json'};
 if(body!==undefined)headers['Content-Type']='application/json';
 if(c.platform==='new'){headers['X-Tenant']=c.credentials.first;headers['X-Api-Key']=c.credentials.second;}
 else{headers.token=c.credentials.first;headers.key=c.credentials.second;}
 let res:Response;
 try{res=await fetch(endpoint,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(12000)});}
 catch{throw new ZrError('ZR_UNREACHABLE',502);}
 if(res.status===401||res.status===403)throw new ZrError('ZR_AUTH',403);
 if(res.status===404)throw new ZrError('ZR_NOT_FOUND',404);
 if(res.status===429)throw new ZrError('ZR_RATE_LIMIT',429);
 if(!res.ok)throw new ZrError('ZR_REJECTED',502);
 if(Number(res.headers.get('content-length')||0)>1_000_000)throw new ZrError('ZR_RESPONSE',502);
 const text=await res.text();if(text.length>1_000_000)throw new ZrError('ZR_RESPONSE',502);
 try{return JSON.parse(text);}catch{throw new ZrError('ZR_RESPONSE',502);}
}
async function probe(platform:string,first:string,second:string){
 const c={platform,credentials:{first,second}};
 if(platform==='new'){
  const r=await provider(c,'workflows/search','POST',{pageNumber:1,pageSize:1});
  if(!r||!Array.isArray(r.items??r.data))throw new ZrError('ZR_RESPONSE',502);
 }else{
  const r=await provider(c,'token');
  if(r?.Statut!=='Accès activé')throw new ZrError('ZR_AUTH',403);
 }
}
async function territory(c:any,level:string,parentId?:string){
 const filters:any[]=[{field:'level',operator:'eq',value:level}];
 if(parentId)filters.push({field:'parentId',operator:'eq',value:parentId});
 const r=await provider(c,'territories/search','POST',{pageNumber:1,pageSize:1000,orderBy:['code asc'],advancedFilter:{logic:'and',filters}});
 if(!Array.isArray(r?.items)||r.hasNext)throw new ZrError('ZR_RESPONSE',502);
 return r.items.filter((x:any)=>uuid.test(String(x.id||''))).map((x:any)=>({id:x.id,name:String(x.name||''),code:Number(x.code||0),parentId:x.parentId||null}));
}
async function readyState(c:any){
 const r=await provider(c,'workflows/search','POST',{pageNumber:1,pageSize:100});
 const states=(r?.items??r?.data??[]).flatMap((w:any)=>w?.states??w?.workflowStates??[w]);
 const id=states.find((s:any)=>String(s?.name||'').toLowerCase().replace(/[\s_-]/g,'')==='readytodispatch')?.id;
 if(!uuid.test(String(id||'')))throw new ZrError('READY_STATE_REQUIRED');return id;
}
async function hubs(c:any){
 const r=await provider(c,'hubs/search','POST',{pageNumber:1,pageSize:1000,includeServices:false});
 if(!Array.isArray(r?.items)||r.hasNext)throw new ZrError('ZR_RESPONSE',502);
 return r.items.filter((x:any)=>uuid.test(String(x.id||''))).map((x:any)=>({id:x.id,name:String(x.name||'Dépôt ZR').slice(0,120),city:String(x.address?.city||'').slice(0,80)}));
}
async function orderFor(c:any,id:string){
 const {data,error}=await db.from('crm_orders').select('id,store_id,status,customer_name,phone,wilaya,commune,address,delivery_type,total,woo_attention').eq('id',id).eq('store_id',c.store_id).maybeSingle();
 if(error||!data)throw new ZrError('NOT_FOUND',404);
 if(data.status!=='confirmed'||data.woo_attention)throw new ZrError('ORDER_NOT_READY');
 return data;
}
async function shipmentFor(c:any,id:string){
 const {data,error}=await db.from('crm_shipments').select('*').eq('id',id).eq('connection_id',c.id).maybeSingle();
 if(error||!data)throw new ZrError('NOT_FOUND',404);return data;
}
async function readRemote(c:any,s:any,reference?:string){
 if(c.platform==='legacy'){
  const r=await provider(c,'lire','POST',{Colis:[{Tracking:reference||s.tracking||s.reference}]});
  const parcel=r?.Colis?.[0];if(!parcel?.Tracking)throw new ZrError('ZR_NOT_FOUND',404);
  if(String(parcel.Tracking)!==s.reference||parcel.id_Externe&&String(parcel.id_Externe)!==s.reference)throw new ZrError('REFERENCE_MISMATCH');
  return {tracking:String(parcel.Tracking),remote_id:'',raw_status:String(parcel.Statut??parcel.statut??''),state:zrState(parcel.Statut??parcel.statut??'')};
 }
 const id=reference||s.remote_id||s.tracking;
 if(!id||!/^[a-z0-9-]{3,100}$/i.test(id))throw new ZrError('INVALID_TRACKING');
 const parcel=await provider(c,'parcels/'+encodeURIComponent(id));
 if(!parcel?.id)throw new ZrError('ZR_NOT_FOUND',404);
 if(String(parcel.externalId||'')!==s.reference)throw new ZrError('REFERENCE_MISMATCH');
 const raw=String(parcel.state?.name??'');return {tracking:String(parcel.trackingNumber||parcel.id),remote_id:String(parcel.id),raw_status:raw,state:zrState(raw)};
}
async function wooOrders(storeId:string){
 const orders:any[]=[];
 for(let start=0;start<10000;start+=1000){
  const {data,error}=await db.from('crm_orders').select('id,woo_number,woo_snapshot,phone,total').eq('store_id',storeId).not('woo_number','is',null).order('id').range(start,start+999);
  if(error)throw new ZrError('ZR_RESPONSE',500);
  orders.push(...(data||[]));
  if((data||[]).length<1000)return orders;
 }
 throw new ZrError('ZR_RESPONSE',500);
}
function matchingOrders(orders:any[]){
 const index=new Map<string,any[]>();
 for(const order of orders){
  for(const ref of new Set([order.woo_number,String(order.woo_snapshot?.external_id??'')])){
   if(!ref)continue;
   const list=index.get(ref)||[];list.push(order);index.set(ref,list);
  }
 }
 return index;
}
async function linkParcel(c:any,actor:string,order:any,raw:any){
 let p=parcelFacts(raw);
 if(!p.phone||!Number.isFinite(p.amount)||!p.raw_status){
  if(!p.remote_id)throw new ZrError('ZR_RESPONSE',502);
  p=parcelFacts(await provider(c,'parcels/'+encodeURIComponent(p.remote_id)));
 }
 if(!p.remote_id||!p.external_id||!p.phone||!Number.isFinite(p.amount)||!p.raw_status)return 'skipped';
 const {data,error}=await db.rpc('crm_zr_import_link',{p_connection:c.id,p_order:order.id,p_actor:actor,p});
 if(error){
  if(['REFERENCE_MISMATCH','PARCEL_MISMATCH','ALREADY_SENT','INVALID_PHONE'].some(x=>error.message.includes(x)))return 'conflict';
  throw new ZrError('ZR_RESPONSE',500);
 }
 return String(data);
}
async function scanPage(c:any,actor:string,page:number){
 if(c.platform!=='new'||!Number.isInteger(page)||page<1||page>500)throw new ZrError('INVALID_REQUEST');
 const response=await provider(c,'parcels/search','POST',{pageNumber:page,pageSize:50,orderBy:['createdAt desc']});
 if(!Array.isArray(response?.items))throw new ZrError('ZR_RESPONSE',502);
 const byRef=matchingOrders(await wooOrders(c.store_id));
 const result={scanned:response.items.length,linked:0,updated:0,unchanged:0,conflict:0,unmatched:0,next_page:response.hasNext?page+1:null};
 for(const raw of response.items){
  const ref=parcelFacts(raw).external_id,candidates=byRef.get(ref)||[];
  if(candidates.length!==1){result.unmatched++;continue;}
  const outcome=await linkParcel(c,actor,candidates[0],raw);
  if(outcome==='linked')result.linked++;
  else if(outcome==='updated')result.updated++;
  else if(outcome==='unchanged')result.unchanged++;
  else result.conflict++;
 }
 return result;
}
export async function handler(req:Request):Promise<Response>{
 const origin=req.headers.get('origin'),headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(origin&&origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'INVALID_REQUEST'},405);
 try{
  if(origin&&!origins.has(origin))throw new ZrError('FORBIDDEN',403);
  let body:any;try{const raw=await req.text();if(raw.length>20000)throw Error();body=JSON.parse(raw);}catch{throw new ZrError('INVALID_REQUEST');}
  if(body?.action==='scheduled_sync'||body?.action==='scheduled_scan'){
   const key=req.headers.get('x-weconvert-sync')||'';
   const {data:authorized,error:authError}=await db.rpc('crm_zr_cron_authorized',{p_secret:key});
   if(authError||!authorized)throw new ZrError('FORBIDDEN',403);
   if(body.action==='scheduled_scan'){
    if(!uuid.test(body.connection_id||''))throw new ZrError('INVALID_REQUEST');
    const {data:c,error}=await db.rpc('crm_zr_cron_connection',{p_connection:body.connection_id});
    if(error||!c)throw new ZrError('NOT_FOUND',404);
    return reply(await scanPage(c,c.created_by,Number(body.page)));
   }
   const {data:queue,error:queueError}=await db.rpc('crm_zr_sync_queue');
   if(queueError)throw new ZrError('ZR_RESPONSE',500);
   const cached=new Map<string,any>();let checked=0,changed=0,errors=0;
   for(let i=0;i<(queue||[]).length;i+=6){
    await Promise.all(queue.slice(i,i+6).map(async(s:any)=>{
     try{
      let c=cached.get(s.connection_id);
      if(!c){const {data,error}=await db.rpc('crm_zr_cron_connection',{p_connection:s.connection_id});if(error||!data)throw Error('connection');c=data;cached.set(s.connection_id,c);}
      const remote=await readRemote(c,s);
      const {error}=await db.rpc('crm_zr_cron_track',{p_shipment:s.id,p:{...remote,state:remote.state==='unknown'?s.state:remote.state}});
      if(error)throw Error('track');
      checked++;if(remote.state!==s.state)changed++;
     }catch(e){errors++;
      // Back off this parcel so a few permanently failing ones cannot starve every other tenant.
      await db.rpc('crm_zr_cron_failed',{p_shipment:s.id,p_code:e instanceof ZrError?e.message:'ZR_SYNC_FAILED'});}
    }));
   }
   return reply({checked,changed,errors});
  }
  const token=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');if(!token)throw new ZrError('AUTH_REQUIRED',401);
  const {data:user,error:authError}=await db.auth.getUser(token);if(authError||!user.user)throw new ZrError('AUTH_REQUIRED',401);
  const actor=user.user.id,action=body?.action;
  if(action==='connect'||action==='hubs'){
   if(!uuid.test(body.store_id||''))throw new ZrError('INVALID_REQUEST');
   const {data:store}=await db.from('crm_stores').select('workspace_id').eq('id',body.store_id).maybeSingle();
   const {data:member}=await db.from('crm_members').select('role').eq('workspace_id',store?.workspace_id||'00000000-0000-0000-0000-000000000000').eq('user_id',actor).eq('active',true).maybeSingle();
   if(!member||!['owner','admin'].includes(member.role))throw new ZrError('FORBIDDEN',403);
   const platform=String(body.platform||''),first=String(body.first||'').trim(),second=String(body.second||'').trim();
   if(!['legacy','new'].includes(platform))throw new ZrError('INVALID_PLATFORM');
   if(first.length<8||first.length>250||second.length<8||second.length>250||/[\r\n]/.test(first+second))throw new ZrError('INVALID_KEYS');
   if(platform==='new'&&!uuid.test(first))throw new ZrError('INVALID_KEYS');
   await probe(platform,first,second);
   if(action==='hubs'){
    if(platform!=='new')throw new ZrError('INVALID_PLATFORM');
    return reply({hubs:await hubs({platform,credentials:{first,second}})});
   }
   if(platform==='new'&&(!uuid.test(body.source_hub_id||'')||!(await hubs({platform,credentials:{first,second}})).some((x:any)=>x.id===body.source_hub_id)))throw new ZrError('INVALID_HUB');
   const connection=await rpc('save',{actor,store_id:body.store_id,platform,first,second,source_hub_id:platform==='new'?body.source_hub_id:null});
   return reply({connection});
  }
  if(!uuid.test(body?.connection_id||''))throw new ZrError('INVALID_REQUEST');
  const args={actor,connection_id:body.connection_id};
  if(action==='disconnect'){await rpc('disconnect',args);return reply({ok:true});}
  const c=await rpc('get',args);
  if(action==='test'){await probe(c.platform,c.credentials.first,c.credentials.second);await rpc('tested',args);return reply({ok:true});}
  if(action==='scan'){
   return reply(await scanPage(c,actor,Number(body.page)));
  }
  if(action==='link'){
   if(c.platform!=='new'||!body.order_ref||!body.tracking||!(/^[a-z0-9-]{3,100}$/i.test(String(body.tracking))))throw new ZrError('INVALID_REQUEST');
   const orders=matchingOrders(await wooOrders(c.store_id)).get(String(body.order_ref).trim())||[];
   if(orders.length!==1)throw new ZrError('NOT_FOUND',404);
   const parcel=await provider(c,'parcels/'+encodeURIComponent(String(body.tracking).trim()));
   if(parcelFacts(parcel).external_id!==String(body.order_ref).trim())throw new ZrError('REFERENCE_MISMATCH');
   const outcome=await linkParcel(c,actor,orders[0],parcel);
   if(outcome==='conflict'||outcome==='skipped')throw new ZrError('PARCEL_MISMATCH');
   return reply({outcome});
  }
  if(action==='sync'){
   const page=Number(body.page);
   if(!Number.isInteger(page)||page<1||page>500)throw new ZrError('INVALID_REQUEST');
   const {data:shipments,error}=await db.from('crm_shipments').select('*').eq('connection_id',c.id).not('state','in','(sending,needs_review)').order('sent_at',{ascending:false}).order('id').range((page-1)*30,page*30-1);
   if(error)throw new ZrError('ZR_RESPONSE',500);
   let checked=0,changed=0,errors=0;
   for(const s of shipments||[]){
    try{
     const remote=await readRemote(c,s);
     await rpc('track',{...args,shipment_id:s.id,...remote,state:remote.state==='unknown'?s.state:remote.state});
     checked++;if(remote.state!==s.state)changed++;
    }catch{errors++;}
   }
   return reply({checked,changed,errors,next_page:(shipments||[]).length===30?page+1:null});
  }
  if(action==='locations'){
   if(c.platform!=='new'||!uuid.test(body.order_id||''))throw new ZrError('INVALID_REQUEST');
   const o=await orderFor(c,body.order_id);
   const cities=await territory(c,'wilaya');
   const cityId=body.city_id||matchTerritory(o.wilaya,cities);
   const districts=uuid.test(cityId||'')&&cities.some((x:any)=>x.id===cityId)?await territory(c,'commune',cityId):[];
   return reply({cities,districts,cityId, districtId:matchTerritory(o.commune,districts)});
  }
  if(action==='send'){
   if(!uuid.test(body.order_id||''))throw new ZrError('INVALID_REQUEST');
   const o=await orderFor(c,body.order_id);
   let stateId='';
   if(c.platform==='new'){
    if(o.delivery_type==='desk')throw new ZrError('PICKUP_UNAVAILABLE');
    const cities=await territory(c,'wilaya');
    if(!cities.some((x:any)=>x.id===body.city_id))throw new ZrError('TERRITORY_REQUIRED');
    const districts=await territory(c,'commune',body.city_id);
    if(!districts.some((x:any)=>x.id===body.district_id))throw new ZrError('TERRITORY_REQUIRED');
    stateId=await readyState(c);
   }else if(!Number.isInteger(Number(body.wilaya_code))||Number(body.wilaya_code)<1||Number(body.wilaya_code)>69)throw new ZrError('WILAYA_CODE_REQUIRED');
   // Reserve before the remote POST. An uncertain response cannot be retried blindly.
   const draft=await rpc('prepare',{...args,order_id:body.order_id,generation:c.generation});
   let remoteId='';
   try{
    if(c.platform==='legacy'){
     const data=legacyParcel(draft,body.wilaya_code);
     const response=await provider(c,'add_colis','POST',data);
     const parcel=response?.Colis?.[0];
     if(!parcel||parcel.MessageRetour!=='Good'||String(parcel.Tracking||'')!==draft.reference)throw new ZrError('ZR_REJECTED',502);
     const raw=String(parcel.Statut??'');
     await rpc('complete',{...args,shipment_id:draft.shipment_id,tracking:draft.reference,raw_status:raw,state:zrState(raw)==='unknown'?'submitted':zrState(raw)});
    }else{
     const data=newParcel(draft,body.city_id,body.district_id,stateId);
     const response=await provider(c,'parcels','POST',data);
     if(!uuid.test(response?.id||''))throw new ZrError('ZR_RESPONSE',502);
     remoteId=response.id;
     const remote=await readRemote(c,{reference:draft.reference,remote_id:remoteId});
     await rpc('complete',{...args,shipment_id:draft.shipment_id,...remote,state:remote.state==='unknown'?'submitted':remote.state});
    }
    return reply({ok:true,shipment_id:draft.shipment_id});
   }catch(e){await rpc('uncertain',{...args,shipment_id:draft.shipment_id,remote_id:remoteId,code:code(e)}).catch(()=>{});throw e;}
  }
  if(action==='track'||action==='reconcile'){
   if(!uuid.test(body.shipment_id||''))throw new ZrError('INVALID_REQUEST');
   const s=await shipmentFor(c,body.shipment_id);
   if(action==='track'&&['sending','needs_review'].includes(s.state))throw new ZrError('NEEDS_REVIEW');
   if(action==='reconcile'&&s.state!=='needs_review')throw new ZrError('INVALID_REQUEST');
   const remote=await readRemote(c,s,action==='reconcile'?String(body.tracking||'').trim():undefined);
   await rpc(action==='track'?'track':'complete',{...args,shipment_id:s.id,...remote,state:remote.state==='unknown'?(action==='track'?s.state:'submitted'):remote.state});
   return reply({ok:true,...remote});
  }
  throw new ZrError('INVALID_REQUEST');
 }catch(e){return reply({error:code(e)},e instanceof ZrError?e.status:500);}
}
Deno.serve(handler);
