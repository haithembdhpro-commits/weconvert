import { createClient } from '@supabase/supabase-js';
import {WooError,normalizeStoreUrl,publicIP,validateKeys,codMethods,verifySignature,digest,boundedText,normalizeOrder,normalizeProduct,readWebhookOrder} from './domain.mjs';
import {pinnedGet} from './pinned.mjs';
const url=Deno.env.get('SUPABASE_URL')!;
const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set([(Deno.env.get('WECONVERT_FRONTEND_URL')||'https://weconvert-cod-studio-ht26.citrus-mug-9991.chatgpt.site').replace(/\/+$/,''),...(Deno.env.get('WECONVERT_DEV_ORIGINS')||'').split(',').map(x=>x.trim()).filter(x=>/^https?:\/\/[^\s,]+$/.test(x))]);
const knownErrors=new Set(['INVALID_URL','UNSAFE_HOST','DNS_FAILED','INVALID_KEYS','INVALID_METHODS','WOO_AUTH','WOO_UNREACHABLE','WOO_REDIRECT','WOO_NOT_FOUND','WOO_RATE_LIMIT','WOO_RESPONSE','PAYLOAD_TOO_LARGE','INVALID_ORDER','INVALID_PHONE','INVALID_AMOUNT','INVALID_ITEMS','INVALID_REMOTE_DATE','INVALID_PRODUCT','CUSTOMER_REQUIRED','FORBIDDEN','AUTH_REQUIRED','NOT_FOUND','DISCONNECTED','CONNECTION_CHANGED','STORE_URL_LOCKED','SYNC_BUSY','INVALID_DATE','IMPORT_NOT_STARTED','INVALID_REQUEST','INVALID_SIGNATURE','UNSUPPORTED_TOPIC','HISTORY_IMPORT_DISABLED']);
function errorCode(e:unknown){const m=e instanceof Error?e.message:String((e as any)?.message||'');return knownErrors.has(m)?m:'SYNC_FAILED';}
async function rpc(action:string,p:Record<string,unknown>){const {data,error}=await service.rpc('crm_woo_service',{p_action:action,p});if(error)throw new WooError(errorCode(error),['FORBIDDEN','DISCONNECTED'].includes(error.message)?403:409);return data;}
// Resolve once, refuse any private/reserved address, and return the checked IPs (IPv4 first).
async function safeHost(base:string){
 const host=new URL(normalizeStoreUrl(base)).hostname;
 const [a,aaaa]=await Promise.allSettled([Deno.resolveDns(host,'A'),Deno.resolveDns(host,'AAAA')]);
 const v4=a.status==='fulfilled'?a.value:[],v6=aaaa.status==='fulfilled'?aaaa.value:[];
 const ips=[...v4,...v6];if(!ips.length)throw new WooError('DNS_FAILED',502);
 if(ips.some(ip=>!publicIP(ip)))throw new WooError('UNSAFE_HOST');
 return ips;
}
// The connection goes to the verified IP (no second DNS lookup): DNS rebinding cannot redirect it inside.
async function woo(c:any,path:string,params:Record<string,string>={}){
 const ips=await safeHost(c.base_url);
 const endpoint=new URL(c.base_url+'/wp-json/wc/v3/'+path);for(const [k,v] of Object.entries(params))endpoint.searchParams.set(k,v);
 let res:any=null,last:unknown=null;
 for(const ip of ips.slice(0,3)){
  try{res=await pinnedGet({url:endpoint.toString(),ip,headers:{Authorization:'Basic '+btoa(c.credentials.key+':'+c.credentials.secret),Accept:'application/json'},timeoutMs:12000,max:4_000_000});break;}
  catch(e){last=e;if(e instanceof WooError&&e.message!=='WOO_UNREACHABLE')throw e;}
 }
 if(!res)throw last instanceof WooError?last:new WooError('WOO_UNREACHABLE',502);
 if(res.status>=300&&res.status<400)throw new WooError('WOO_REDIRECT');
 if(res.status===401||res.status===403)throw new WooError('WOO_AUTH');if(res.status===404)throw new WooError('WOO_NOT_FOUND');if(res.status===429)throw new WooError('WOO_RATE_LIMIT',429);if(res.status<200||res.status>=300)throw new WooError('WOO_UNREACHABLE',502);
 let data;try{data=JSON.parse(res.text);}catch{throw new WooError('WOO_RESPONSE',502);}
 return {data,total:Number(res.headers.get('x-wp-total')||0),pages:Number(res.headers.get('x-wp-totalpages')||0)};
}
async function probe(c:any){const r=await woo(c,'orders',{per_page:'1'});if(!Array.isArray(r.data))throw new WooError('WOO_RESPONSE');return true;}
async function recordError(c:any,e:unknown,id?:number){await rpc('error',{connection_id:c.id,generation:c.generation,code:errorCode(e),external_id:Number.isSafeInteger(id)&&Number(id)>0?id:null});}
// Validation rejects are final and acknowledged; anything else (timeout, deadlock, unknown) is
// surfaced so a signed webhook answers 503 and WooCommerce delivers it again. Ingest is idempotent.
const deterministic=new Set(['INVALID_ORDER','INVALID_PHONE','INVALID_AMOUNT','INVALID_ITEMS','INVALID_REMOTE_DATE','CUSTOMER_REQUIRED','DISCONNECTED','CONNECTION_CHANGED']);
async function ingest(c:any,raw:any,webhook=false){
 let order;
 try{order=normalizeOrder(raw,c.cod_methods);}
 catch(e){await recordError(c,e,Number(raw?.id));return {outcome:'error',code:errorCode(e)};}
 try{return await rpc('ingest',{connection_id:c.id,generation:c.generation,order,hash:await digest(order),webhook});}
 catch(e){if(webhook&&!deterministic.has(errorCode(e)))throw new WooError(errorCode(e),503);await recordError(c,e,Number(raw?.id)).catch(()=>{});return {outcome:'error',code:errorCode(e)};}
}
async function ingestProduct(c:any,raw:any,token:string,parent:any=null){
 try{return await rpc('catalog.ingest',{connection_id:c.id,generation:c.generation,token,product:normalizeProduct(raw,parent)});}
 catch(e){await rpc('catalog.error',{connection_id:c.id,generation:c.generation,token,external_id:Number.isSafeInteger(Number(raw?.id))?Number(raw.id):null,code:errorCode(e)});return {outcome:'error',code:errorCode(e)};}
}
export async function handler(req:Request):Promise<Response>{
 const origin=req.headers.get('origin');const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(origin&&origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
 try{
  const path=new URL(req.url).pathname;
  const webhook=path.match(/\/webhook\/([0-9a-f-]{36})$/i);
  if(webhook){
   const raw=await boundedText(req,2_000_000);
   // Woo's initial reachability ping is unsigned. Acknowledge without lookup or mutation.
   if(/^webhook_id=\d+$/.test(raw)&&!req.headers.get('x-wc-webhook-signature'))return reply({ping:true});
   const c=await rpc('get_webhook',{connection_id:webhook[1]});
   if(!await verifySignature(raw,req.headers.get('x-wc-webhook-signature'),c.credentials.webhook_secret))throw new WooError('INVALID_SIGNATURE',401);
   if(!['order.created','order.updated','order.restored'].includes(req.headers.get('x-wc-webhook-topic')||''))throw new WooError('UNSUPPORTED_TOPIC');
   let incoming;try{incoming=JSON.parse(raw);}catch{throw new WooError('INVALID_ORDER');}
   const id=Number(incoming.id);if(!Number.isSafeInteger(id)||id<1)throw new WooError('INVALID_ORDER');
   // HMAC authenticates the full payload. SQL rejects stale versions and preserves same-second conflicts.
   try{const order=await readWebhookOrder(incoming,async (orderId:number)=>(await woo(c,'orders/'+orderId)).data);const result=await ingest(c,order,true);await rpc('ping',{connection_id:c.id,generation:c.generation});return reply(result);}
   catch(e){await recordError(c,e,id);return reply({error:errorCode(e)},503);}
  }
  if(origin&&!origins.has(origin))throw new WooError('FORBIDDEN',403);
  const jwt=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');if(!jwt)throw new WooError('AUTH_REQUIRED',401);
  const {data:user,error}=await service.auth.getUser(jwt);if(error||!user.user)throw new WooError('AUTH_REQUIRED',401);
  let body;try{body=JSON.parse(await boundedText(req,20000));}catch{throw new WooError('INVALID_REQUEST');}
  const actor=user.user.id,action=body.action;
  if(action==='connect'){
   const {data:store}=await service.from('crm_stores').select('workspace_id').eq('id',body.store_id).maybeSingle();
   const {data:member}=await service.from('crm_members').select('role').eq('workspace_id',store?.workspace_id||'00000000-0000-0000-0000-000000000000').eq('user_id',actor).eq('active',true).maybeSingle();
   if(!member||!['owner','admin'].includes(member.role))throw new WooError('FORBIDDEN',403);
   const base_url=normalizeStoreUrl(body.base_url),key=String(body.key||'').trim(),secret=String(body.secret||'').trim();validateKeys(key,secret);
   const methods=codMethods(body.cod_methods);await probe({base_url,credentials:{key,secret}});
   const c=await rpc('save',{actor,store_id:body.store_id,base_url,key,secret,cod_methods:methods});return reply({connection:c});
  }
  if(!/^[0-9a-f-]{36}$/i.test(body.connection_id||''))throw new WooError('INVALID_REQUEST');
  const args={connection_id:body.connection_id,actor};
  if(action==='disconnect'){await rpc('disconnect',args);return reply({ok:true});}
  const c=await rpc('get_admin',args);
  if(action==='setup')return reply({url:url+'/functions/v1/weconvert-woocommerce/webhook/'+c.id,secret:c.credentials.webhook_secret,topics:['order.created','order.updated']});
  if(action==='test'){try{await probe(c);await rpc('tested',args);return reply({ok:true});}catch(e){await recordError(c,e);throw e;}}
  if(action==='retry'){
   const id=Number(body.external_id);if(!Number.isSafeInteger(id)||id<1)throw new WooError('INVALID_ORDER');
   try{const r=await woo(c,'orders/'+id);return reply(await ingest(c,r.data));}catch(e){await recordError(c,e,id);throw e;}
  }
  if(action==='sync')throw new WooError('HISTORY_IMPORT_DISABLED',410);
  if(action==='sync_products'){
   const token=crypto.randomUUID();const lease=await rpc('catalog.begin',{...args,generation:c.generation,token,reset:body.reset===true});
   try{
    const page=lease.catalog_page,products=await woo(c,'products',{per_page:'25',page:String(page),orderby:'id',order:'asc',status:'any'});
    if(!Array.isArray(products.data))throw new WooError('WOO_RESPONSE');
    let offset=lease.catalog_offset,variationPage=lease.catalog_variation_page,scanned=0,networkCalls=0;
    const counts:Record<string,number>={};
    while(offset<products.data.length&&scanned<25&&networkCalls<5){
     const parent=products.data[offset];
     if(parent?.type==='variable'){
      // Keep the checkpoint bounded to 25 sellable records even when a
      // variable product follows simple products on the same Woo page.
      if(scanned>0)break;
      const variants=await woo(c,'products/'+Number(parent.id)+'/variations',{per_page:'25',page:String(variationPage),orderby:'id',order:'asc'});networkCalls++;
      if(!Array.isArray(variants.data))throw new WooError('WOO_RESPONSE');
      for(const raw of variants.data){const result=await ingestProduct(c,raw,token,parent);counts[result.outcome]=(counts[result.outcome]||0)+1;scanned++;}
      if(variants.pages>variationPage){variationPage++;break;}
      variationPage=1;offset++;
     }else{
      const result=await ingestProduct(c,parent,token);counts[result.outcome]=(counts[result.outcome]||0)+1;scanned++;offset++;
     }
    }
    const lastPage=products.data.length<25||(products.pages>0&&page>=products.pages);
    const done=offset>=products.data.length&&lastPage;
    const nextPage=offset>=products.data.length&&!done?page+1:page;
    if(offset>=products.data.length)offset=0;
    await rpc('catalog.finish',{...args,generation:c.generation,token,done,page:nextPage,offset,variation_page:variationPage,scanned,total:products.total});
    return reply({done,counts,page,scanned:lease.catalog_scanned+scanned,total:products.total});
   }catch(e){await rpc('catalog.finish',{...args,generation:c.generation,token,failed:true}).catch(()=>{});await recordError(c,e);throw e;}
  }
  throw new WooError('INVALID_REQUEST');
 }catch(e){return reply({error:errorCode(e)},e instanceof WooError?e.status:500);}
}
Deno.serve(handler);
