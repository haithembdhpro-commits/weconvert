import {createClient} from '@supabase/supabase-js';
import {ShopifyError,shopDomain,codMethods,normalizeOrder} from './domain.mjs';
const url=Deno.env.get('SUPABASE_URL')!;
const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
// Frontend origin per environment (production, staging); used for OAuth return and CORS.
const frontend=(Deno.env.get('WECONVERT_FRONTEND_URL')||'https://weconvert-cod-studio-ht26.citrus-mug-9991.chatgpt.site').replace(/\/+$/,'');
const allowedOrigins=new Set([frontend,...(Deno.env.get('WECONVERT_DEV_ORIGINS')||'').split(',').map(x=>x.trim()).filter(x=>/^https?:\/\/[^\s,]+$/.test(x))]);
const known=new Set(['APP_NOT_CONFIGURED','INVALID_SHOP','INVALID_COD_METHODS','INVALID_REQUEST','AUTH_REQUIRED','FORBIDDEN','NOT_FOUND','SHOP_LOCKED','INVALID_STATE','INVALID_SIGNATURE','UNSUPPORTED_TOPIC','SHOPIFY_AUTH','SHOPIFY_UNREACHABLE','PAYLOAD_TOO_LARGE','DISCONNECTED','INVALID_ORDER','INVALID_AMOUNT','INVALID_ITEMS','INVALID_REMOTE_DATE','INVALID_PHONE']);
function failure(e:unknown){const code=e instanceof ShopifyError?e.code:String((e as Error)?.message||'INTEGRATION_ERROR');return known.has(code)?code:'INTEGRATION_ERROR';}
function status(e:unknown){return e instanceof ShopifyError?e.status:failure(e)==='FORBIDDEN'?403:failure(e)==='AUTH_REQUIRED'?401:409;}
async function rpc(action:string,p:Record<string,unknown>){const {data,error}=await service.rpc('crm_source_service',{p_action:action,p});if(error)throw new ShopifyError(failure(error),error.message==='FORBIDDEN'?403:409);return data;}
async function guard(action:string,p:Record<string,unknown>){const {data,error}=await service.rpc('crm_oauth_guard',{p_action:action,p});if(error)throw new ShopifyError(failure(error),error.message==='FORBIDDEN'?403:409);return data;}
function credentials(){const id=Deno.env.get('SHOPIFY_CLIENT_ID'),secret=Deno.env.get('SHOPIFY_CLIENT_SECRET');if(!id||!secret)throw new ShopifyError('APP_NOT_CONFIGURED',503);return {id,secret};}
async function sha256(input:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function hmac(input:Uint8Array,key:string){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',k,input));}
function equal(a:Uint8Array,b:Uint8Array){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;}
function hex(b:Uint8Array){return [...b].map(x=>x.toString(16).padStart(2,'0')).join('');}
function base64(b:Uint8Array){return btoa(String.fromCharCode(...b));}
async function verifyWebhook(raw:Uint8Array,header:string|null,secret:string){if(!header||!/^[a-zA-Z0-9+/]{43}=$/.test(header))return false;return equal(new TextEncoder().encode(base64(await hmac(raw,secret))),new TextEncoder().encode(header));}
async function verifyCallback(q:URLSearchParams,secret:string){
 const fields=[...q.entries()];if(new Set(fields.map(([k])=>k)).size!==fields.length)return false;
 const signature=q.get('hmac')||'';if(!/^[a-f0-9]{64}$/i.test(signature))return false;
 const message=fields.filter(([key])=>key!=='hmac').sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('&');
 return equal(new TextEncoder().encode(hex(await hmac(new TextEncoder().encode(message),secret))),new TextEncoder().encode(signature.toLowerCase()));
}
async function bounded(req:Request,max:number){const size=Number(req.headers.get('content-length')||0);if(size>max)throw new ShopifyError('PAYLOAD_TOO_LARGE',413);const bytes=new Uint8Array(await req.arrayBuffer());if(bytes.length>max)throw new ShopifyError('PAYLOAD_TOO_LARGE',413);return bytes;}
// Validation rejects are final: journal them and acknowledge, so Shopify does not redeliver forever.
const deterministic=new Set(['INVALID_ORDER','INVALID_AMOUNT','INVALID_ITEMS','INVALID_REMOTE_DATE','INVALID_PHONE','DISCONNECTED']);
const callback=url+'/functions/v1/weconvert-shopify/callback';
const responseHeaders={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(data:unknown,code=200,headers:Record<string,string>={})=>new Response(JSON.stringify(data),{status:code,headers:{...responseHeaders,...headers}});
function redirect(success:boolean){return new Response(null,{status:303,headers:{Location:frontend+'/#integrations'+(success?'':'/shopify-error'),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
export async function handler(req:Request):Promise<Response>{
 const path=new URL(req.url).pathname,origin=req.headers.get('origin');
 const cors:Record<string,string>=origin&&allowedOrigins.has(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'}:{};
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{...responseHeaders,...cors}});
 try{
  if(req.method==='GET'&&path.endsWith('/callback')){
   try{
    const {id,secret}=credentials(),params=new URL(req.url).searchParams;
    if(!await verifyCallback(params,secret))throw new ShopifyError('INVALID_SIGNATURE',401);
    const shop=shopDomain(params.get('shop')),state=params.get('state')||'',code=params.get('code')||'';
    if(!/^[a-f0-9]{64}$/.test(state)||!code||code.length>300)throw new ShopifyError('INVALID_STATE');
    const nonceHash=await sha256(state),connection=await rpc('oauth_state',{nonce_hash:nonceHash,external_shop:shop});
    const result=await fetch(`https://${shop}/admin/oauth/access_token`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:id,client_secret:secret,code,expiring:1}),redirect:'manual',signal:AbortSignal.timeout(12000)});
    if(!result.ok)throw new ShopifyError('SHOPIFY_AUTH',502);
    const token=await result.json();
    if(!token?.access_token||!token?.refresh_token||!Number.isInteger(token.expires_in)||!String(token.scope||'').split(',').map((x:string)=>x.trim()).includes('read_orders'))throw new ShopifyError('SHOPIFY_AUTH',502);
    // Park the tokens: only the CRM user who started this flow can activate them (see crm_oauth_guard).
    const ticket=hex(crypto.getRandomValues(new Uint8Array(32)));
    await guard('stash',{connection_id:connection.id,nonce_hash:nonceHash,confirm_hash:await sha256(ticket),payload:{credentials:{access_token:token.access_token,refresh_token:token.refresh_token,expires_in:token.expires_in,scope:token.scope,obtained_at:new Date().toISOString()}}});
    return new Response(null,{status:303,headers:{Location:frontend+'/#oauth/shopify/'+ticket,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
   }catch(e){console.error('Shopify callback:',failure(e));return redirect(false);}
  }
  if(req.method==='POST'&&path.endsWith('/webhook')){
   // Verify the raw body before interpreting any of its fields or looking up a tenant.
   const raw=await bounded(req,2_000_000),secret=credentials().secret;
   if(!await verifyWebhook(raw,req.headers.get('x-shopify-hmac-sha256'),secret))throw new ShopifyError('INVALID_SIGNATURE',401);
   const shop=shopDomain(req.headers.get('x-shopify-shop-domain'));
   const topic=req.headers.get('x-shopify-topic')||'';
   if(!['orders/create','orders/updated','app/uninstalled'].includes(topic))throw new ShopifyError('UNSUPPORTED_TOPIC');
   const c=await rpc('by_shop',{provider:'shopify',external_shop:shop});
   if(topic==='app/uninstalled'){await rpc('uninstalled',{connection_id:c.id});return reply({ok:true});}
   const delivery=req.headers.get('x-shopify-webhook-id');
   if(!delivery||delivery.length>200)throw new ShopifyError('INVALID_REQUEST');
   let incoming:any=null,order;
   try{incoming=JSON.parse(new TextDecoder().decode(raw));order=normalizeOrder(incoming,c.cod_methods);}
   catch(e){try{await rpc('error',{connection_id:c.id,external_id:String(incoming?.id||''),code:failure(e)});}catch{}return reply({outcome:'error',code:failure(e)});}
   try{
    const result=await rpc('ingest',{connection_id:c.id,delivery_id:delivery,hash:await sha256(JSON.stringify(order)),order});
    return reply(result);
   }catch(e){
    // A transient DB failure must return a retryable 5xx; keep the provider order out of the CRM.
    try{await rpc('error',{connection_id:c.id,external_id:String(incoming?.id||''),code:failure(e)});}catch{}
    if(deterministic.has(failure(e)))return reply({outcome:'error',code:failure(e)});
    throw new ShopifyError(failure(e),503);
   }
  }
  if(req.method!=='POST')throw new ShopifyError('INVALID_REQUEST',405);
  if(origin&&!allowedOrigins.has(origin))throw new ShopifyError('FORBIDDEN',403);
  const jwt=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');if(!jwt)throw new ShopifyError('AUTH_REQUIRED',401);
  const {data:user,error}=await service.auth.getUser(jwt);if(error||!user.user)throw new ShopifyError('AUTH_REQUIRED',401);
  let body;try{body=JSON.parse(new TextDecoder().decode(await bounded(req,20000)));}catch(e){if(e instanceof ShopifyError)throw e;throw new ShopifyError('INVALID_REQUEST');}
  if(body.action==='connect'){
   const {id}=credentials(),shop=shopDomain(body.shop),methods=codMethods(body.cod_methods);
   const state=hex(crypto.getRandomValues(new Uint8Array(32))),nonce_hash=await sha256(state);
   const begun=await rpc('begin',{provider:'shopify',store_id:body.store_id,actor:user.user.id,external_shop:shop,cod_methods:methods,nonce_hash});
   await guard('bind',{connection_id:begun.id,actor:user.user.id,nonce_hash});
   const authorization=new URL(`https://${shop}/admin/oauth/authorize`);
   authorization.search=new URLSearchParams({client_id:id,scope:'read_orders',redirect_uri:callback,state}).toString();
   return reply({authorize_url:authorization.toString()},200,cors);
  }
  if(body.action==='confirm'){
   if(!/^[a-f0-9]{64}$/.test(String(body.ticket||'')))throw new ShopifyError('INVALID_STATE');
   const pending=await guard('confirm',{actor:user.user.id,confirm_hash:await sha256(body.ticket)});
   if(pending?.error||pending?.provider!=='shopify'||!pending?.payload?.credentials)throw new ShopifyError('INVALID_STATE');
   await rpc('finish_oauth',{connection_id:pending.connection_id,nonce_hash:pending.nonce_hash,credentials:pending.payload.credentials});
   return reply({connected:true},200,cors);
  }
  if(body.action==='disconnect'){
   await rpc('disconnect',{connection_id:body.connection_id,actor:user.user.id});return reply({ok:true},200,cors);
  }
  throw new ShopifyError('INVALID_REQUEST');
 }catch(e){console.error('Shopify connector:',failure(e));return reply({error:failure(e)},status(e),cors);}
}
Deno.serve(handler);
