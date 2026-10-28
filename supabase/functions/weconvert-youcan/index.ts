import {createClient} from '@supabase/supabase-js';
import {YouCanError,storeId,codMethods,normalizeOrder,verifySignature,channelName,storefrontUrl,matchStorefront} from './domain.mjs';

const projectUrl=Deno.env.get('SUPABASE_URL')!;
const service=createClient(projectUrl,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
// Frontend origin per environment (production, staging); used for OAuth return and CORS.
const frontend=(Deno.env.get('WECONVERT_FRONTEND_URL')||'https://weconvert-cod-studio-ht26.citrus-mug-9991.chatgpt.site').replace(/\/+$/,'');
const origins=new Set([frontend,...(Deno.env.get('WECONVERT_DEV_ORIGINS')||'').split(',').map(x=>x.trim()).filter(x=>/^https?:\/\/[^\s,]+$/.test(x))]);
const callback=projectUrl+'/functions/v1/weconvert-youcan/callback';
const webhook=projectUrl+'/functions/v1/weconvert-youcan/webhook';
const api='https://api.youcan.shop';
const maxTokenLifetime=3155760000; // 100 Julian years in seconds; YouCan may issue long-lived tokens.
const known=new Set(['APP_NOT_CONFIGURED','INVALID_SHOP','INVALID_CHANNEL_NAME','INVALID_STORE_URL','SHOP_URL_MISMATCH','AUTH_IN_PROGRESS','INVALID_COD_METHODS','INVALID_REQUEST','AUTH_REQUIRED','FORBIDDEN','NOT_FOUND','SHOP_LOCKED','INVALID_STATE','INVALID_SIGNATURE','UNSUPPORTED_TOPIC','YOUCAN_AUTH','YOUCAN_UNREACHABLE','HOOK_SUBSCRIBE_FAILED','PAYLOAD_TOO_LARGE','DISCONNECTED','INVALID_ORDER','INVALID_AMOUNT','INVALID_ITEMS','INVALID_REMOTE_DATE','INVALID_PHONE']);
function failure(e:unknown){const code=e instanceof YouCanError?e.code:String((e as Error)?.message||'INTEGRATION_ERROR');return known.has(code)?code:'INTEGRATION_ERROR';}
function codeStatus(e:unknown){return e instanceof YouCanError?e.status:failure(e)==='FORBIDDEN'?403:failure(e)==='AUTH_REQUIRED'?401:409;}
function credentials(){const id=Deno.env.get('YOUCAN_CLIENT_ID'),secret=Deno.env.get('YOUCAN_CLIENT_SECRET');if(!id||!secret)throw new YouCanError('APP_NOT_CONFIGURED',503);return {id,secret};}
async function source(action:string,p:Record<string,unknown>){const {data,error}=await service.rpc('crm_source_service',{p_action:action,p});if(error)throw new YouCanError(failure(error),409);return data;}
async function youcan(action:string,p:Record<string,unknown>){const {data,error}=await service.rpc('crm_youcan_service',{p_action:action,p});if(error){console.error('YouCan RPC:',action,error.code);throw new YouCanError(failure(error),409);}return data;}
async function guard(action:string,p:Record<string,unknown>){const {data,error}=await service.rpc('crm_oauth_guard',{p_action:action,p});if(error)throw new YouCanError(failure(error),error.message==='FORBIDDEN'?403:409);return data;}
async function sha256(input:string){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function hex(b:Uint8Array){return [...b].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function bounded(req:Request,max:number){if(Number(req.headers.get('content-length')||0)>max)throw new YouCanError('PAYLOAD_TOO_LARGE',413);const raw=new Uint8Array(await req.arrayBuffer());if(raw.length>max)throw new YouCanError('PAYLOAD_TOO_LARGE',413);return raw;}
// Validation rejects are final: journal them and acknowledge, so YouCan does not redeliver forever.
const deterministic=new Set(['INVALID_ORDER','INVALID_AMOUNT','INVALID_ITEMS','INVALID_REMOTE_DATE','INVALID_PHONE','DISCONNECTED']);
const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(body:unknown,status=200,cors:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{...headers,...cors}});
const redirect=(ok:boolean)=>new Response(null,{status:303,headers:{Location:frontend+'/#integrations'+(ok?'':'/youcan-error'),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});

async function jsonResponse(url:string,init:RequestInit,errorCode:string){
 let response:Response;
 try{response=await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(12000)});}catch{throw new YouCanError('YOUCAN_UNREACHABLE',503);}
 if(!response.ok){
  // Do not log the request body or response: OAuth codes and tokens may be present.
  console.error('YouCan upstream:',new URL(url).pathname,response.status);
  throw new YouCanError(errorCode,response.status===429||response.status>=500?503:502);
 }
 if(Number(response.headers.get('content-length')||0)>2_000_000)throw new YouCanError('PAYLOAD_TOO_LARGE',502);
 const data=await response.text();if(data.length>2_000_000)throw new YouCanError('PAYLOAD_TOO_LARGE',502);
 try{return JSON.parse(data);}catch{throw new YouCanError(errorCode,502);}
}
async function tokenRequest(body:Record<string,string>){const {id,secret}=credentials();return jsonResponse(api+'/oauth/token',{
 method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
 body:new URLSearchParams({...body,client_id:id,client_secret:secret})},'YOUCAN_AUTH');}
function validToken(input:any){if(!input?.access_token||!input?.refresh_token||!Number.isInteger(Number(input.expires_in))||Number(input.expires_in)<=0||Number(input.expires_in)>maxTokenLifetime)throw new YouCanError('YOUCAN_AUTH',502);
 return {access_token:String(input.access_token),refresh_token:String(input.refresh_token),expires_in:Number(input.expires_in),obtained_at:new Date().toISOString()};}
async function accessToken(connectionId:string,existing?:any){
 let token=existing||await youcan('credentials',{connection_id:connectionId});
 const expires=Date.parse(token?.obtained_at||'')+Number(token?.expires_in||0)*1000;
 if(!Number.isFinite(expires)||expires<Date.now()+120_000){
  try{
   const fresh=validToken(await tokenRequest({grant_type:'refresh_token',refresh_token:token.refresh_token}));
   token=await youcan('refresh_credentials',{connection_id:connectionId,old_access_hash:await sha256(token.access_token),credentials:fresh});
  }catch(e){
   const current=await youcan('credentials',{connection_id:connectionId});
   if(current?.access_token===token.access_token)throw e;
   token=current;
  }
 }
 return token.access_token as string;
}
async function getStore(token:string){const data=await jsonResponse(api+'/me',{headers:{Authorization:'Bearer '+token,'Accept':'application/json'}},'YOUCAN_AUTH');return {id:storeId(data.store_id||data.id),domain:data.domain,slug:data.slug};}
async function subscribe(token:string){for(const event of ['order.created','order.updated','app.uninstalled']){
  await jsonResponse(api+'/resthooks/subscribe',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({event,target_url:webhook})},'HOOK_SUBSCRIBE_FAILED');
 }}
async function getOrder(token:string,id:string){return jsonResponse(api+'/orders/'+storeId(id)+'?include=customer,variants,payment,shipping,discount,refunds',
  {headers:{Authorization:'Bearer '+token,'Accept':'application/json'}},'YOUCAN_UNREACHABLE');}

export async function handler(req:Request):Promise<Response>{
 const path=new URL(req.url).pathname,origin=req.headers.get('origin');
 const cors:Record<string,string>=origin&&origins.has(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'}:{};
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,...cors}});
 try{
  if(req.method==='GET'&&path.endsWith('/callback')){
   let connectionId:string|undefined,stage='state';
   try{
    credentials();const params=new URL(req.url).searchParams;
    const fields=[...params.keys()];if(new Set(fields).size!==fields.length)throw new YouCanError('INVALID_STATE');
    const state=params.get('state')||'';if(!/^[a-f0-9]{64}$/.test(state))throw new YouCanError('INVALID_STATE');
    const nonce_hash=await sha256(state),connection=await youcan('oauth_state',{nonce_hash});connectionId=connection.id;
    const code=params.get('code')||'';
    if(!code||code.length>4096){
     console.error('YouCan callback code:',{present:Boolean(code),length:code.length,parameterNames:fields.slice(0,8).map(x=>x.slice(0,40))});
     throw new YouCanError('YOUCAN_AUTH');
    }
    stage='token_exchange';
    const token=validToken(await tokenRequest({grant_type:'authorization_code',code,redirect_uri:callback}));
    stage='store_identity';
    const merchant=await getStore(token.access_token),domain=matchStorefront(connection.public_url,merchant);
    // Park the tokens: only the CRM user who started this flow can activate them (see crm_oauth_guard).
    stage='stash';
    const ticket=hex(crypto.getRandomValues(new Uint8Array(32)));
    await guard('stash',{connection_id:connectionId,nonce_hash,confirm_hash:await sha256(ticket),payload:{external_shop:merchant.id,expected_url:connection.public_url,verified_domain:domain,credentials:token}});
    return new Response(null,{status:303,headers:{Location:frontend+'/#oauth/youcan/'+ticket,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
   }catch(e){if(connectionId)try{await source('error',{connection_id:connectionId,code:failure(e)});}catch{}console.error('YouCan callback:',stage,failure(e));return redirect(false);}
  }
  if(req.method==='POST'&&path.endsWith('/webhook')){
   // The callback is shared by merchants: verify the raw bytes before trusting store_id.
   const raw=await bounded(req,2_000_000),sig=req.headers.get('x-youcan-signature')||'',secret=credentials().secret;
   if(!await verifySignature(raw,sig,secret))throw new YouCanError('INVALID_SIGNATURE',401);
   const topic=req.headers.get('x-youcan-topic')||'';
   if(!['order.created','order.updated','app.uninstalled'].includes(topic))throw new YouCanError('UNSUPPORTED_TOPIC');
   let event:any;try{event=JSON.parse(new TextDecoder().decode(raw));}catch{throw new YouCanError('INVALID_ORDER');}
   if(event?.event_name!==topic)throw new YouCanError('INVALID_ORDER');
   const merchant=storeId(event?.data?.store_id);
   const c=await source('by_shop',{provider:'youcan',external_shop:merchant});
   if(topic==='app.uninstalled'){await source('uninstalled',{connection_id:c.id});return reply({ok:true});}
   const delivery=req.headers.get('x-youcan-delivery-id');if(!delivery||delivery.length>200)throw new YouCanError('INVALID_REQUEST');
   const id=storeId(event?.data?.id);
   try{
    const token=await accessToken(c.id),rawOrder=await getOrder(token,id);
    if(storeId(rawOrder?.id)!==id||rawOrder?.store_id&&storeId(rawOrder.store_id)!==merchant)throw new YouCanError('INVALID_ORDER');
    const order=normalizeOrder(rawOrder,c.cod_methods);
    return reply(await source('ingest',{connection_id:c.id,delivery_id:delivery,hash:await sha256(JSON.stringify(order)),order}));
   }catch(e){try{await source('error',{connection_id:c.id,external_id:id,code:failure(e)});}catch{}
    // YouCan retries 5xx; do not acknowledge a delivery before it reaches the CRM (unless it can never succeed).
    if(deterministic.has(failure(e)))return reply({outcome:'error',code:failure(e)});
    throw new YouCanError(failure(e),503);
   }
  }
  if(req.method!=='POST')throw new YouCanError('INVALID_REQUEST',405);
  if(origin&&!origins.has(origin))throw new YouCanError('FORBIDDEN',403);
  const jwt=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');if(!jwt)throw new YouCanError('AUTH_REQUIRED',401);
  const {data:user,error}=await service.auth.getUser(jwt);if(error||!user.user)throw new YouCanError('AUTH_REQUIRED',401);
  let body:any;try{body=JSON.parse(new TextDecoder().decode(await bounded(req,20000)));}catch(e){if(e instanceof YouCanError)throw e;throw new YouCanError('INVALID_REQUEST');}
  if(body.action==='save'){
   const saved=await youcan('save_channel',{store_id:body.store_id,actor:user.user.id,channel_name:channelName(body.channel_name),public_url:storefrontUrl(body.public_url),cod_methods:codMethods(body.cod_methods)});
   return reply(saved,200,cors);
  }
  if(body.action==='authorize'){
   const {id}=credentials(),state=hex(crypto.getRandomValues(new Uint8Array(32))),nonce_hash=await sha256(state);
   const begun=await youcan('begin',{connection_id:body.connection_id,actor:user.user.id,nonce_hash});
   await guard('bind',{connection_id:begun.id,actor:user.user.id,nonce_hash});
   const authorization=new URL('https://seller-area.youcan.shop/admin/oauth/authorize');
   authorization.search=new URLSearchParams({client_id:id,redirect_uri:callback,response_type:'code',state}).toString();
   for(const scope of ['read-orders','view-store-info','edit-rest-hooks'])authorization.searchParams.append('scope[]',scope);
   return reply({authorize_url:authorization.toString()},200,cors);
  }
  if(body.action==='confirm'){
   if(!/^[a-f0-9]{64}$/.test(String(body.ticket||'')))throw new YouCanError('INVALID_STATE');
   const pending=await guard('confirm',{actor:user.user.id,confirm_hash:await sha256(body.ticket)});
   const p=pending?.payload;
   if(pending?.error||pending?.provider!=='youcan'||!p?.credentials?.access_token)throw new YouCanError('INVALID_STATE');
   await youcan('finish_oauth',{connection_id:pending.connection_id,nonce_hash:pending.nonce_hash,external_shop:p.external_shop,expected_url:p.expected_url,verified_domain:p.verified_domain,credentials:p.credentials});
   try{await subscribe(p.credentials.access_token);}catch(e){try{await source('error',{connection_id:pending.connection_id,code:failure(e)});}catch{}throw e;}
   return reply({connected:true},200,cors);
  }
  if(body.action==='repair'){
   const token=await accessToken(body.connection_id,await youcan('repair',{connection_id:body.connection_id,actor:user.user.id}));
   await subscribe(token);return reply({ok:true},200,cors);
  }
  if(body.action==='retry_order'){
   const orderId=storeId(body.external_id),connectionId=storeId(body.connection_id);
   // A manager may retry only a known, incomplete order from their own YouCan channel.
   const token=await accessToken(connectionId,await youcan('repair',{connection_id:connectionId,actor:user.user.id}));
   const {data:connection,error:connectionError}=await service.from('crm_source_connections').select('external_shop,cod_methods').eq('id',connectionId).eq('provider','youcan').single();
   if(connectionError||!connection)throw new YouCanError('NOT_FOUND',404);
   const {data:latest,error:lookupError}=await service.from('crm_source_events').select('outcome,code')
    .eq('connection_id',connectionId).eq('external_id',orderId).order('id',{ascending:false}).limit(1).maybeSingle();
   if(lookupError)throw new YouCanError('INTEGRATION_ERROR',503);
   if(['received','updated'].includes(latest?.outcome))return reply({outcome:'already_received'},200,cors);
   if(latest?.outcome!=='skipped'||!['CUSTOMER_REQUIRED','INVALID_PHONE','WILAYA_REQUIRED'].includes(latest.code))throw new YouCanError('NOT_FOUND',404);
   const rawOrder=await getOrder(token,orderId);
   if(storeId(rawOrder?.id)!==orderId||rawOrder?.store_id&&storeId(rawOrder.store_id)!==connection.external_shop)throw new YouCanError('INVALID_ORDER');
   const order=normalizeOrder(rawOrder,connection.cod_methods);
   return reply(await source('ingest',{connection_id:connectionId,delivery_id:'manual-'+crypto.randomUUID(),hash:await sha256(JSON.stringify(order)),order}),200,cors);
  }
  if(body.action==='disconnect'){
   await source('disconnect',{connection_id:body.connection_id,actor:user.user.id});return reply({ok:true},200,cors);
  }
  throw new YouCanError('INVALID_REQUEST');
 }catch(e){console.error('YouCan connector:',failure(e));return reply({error:failure(e)},codeStatus(e),cors);}
}
Deno.serve(handler);
