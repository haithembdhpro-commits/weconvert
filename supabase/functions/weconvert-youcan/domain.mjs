// YouCan's REST hook is authenticated before this pure order normalizer runs.
export class YouCanError extends Error {
 constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
export const DEFAULT_COD_METHODS=['cash on delivery','cash on delivery (cod)','cod','cash_on_delivery'];
export function channelName(input){
 const value=String(input??'').trim();
 if(value.length<2||value.length>100)throw new YouCanError('INVALID_CHANNEL_NAME');
 return value;
}
export function storefrontUrl(input){
 const value=String(input??'').trim();let parsed;
 try{parsed=new URL(value);}catch{throw new YouCanError('INVALID_STORE_URL');}
 const host=parsed.hostname.toLowerCase();
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||parsed.pathname!=='/'||parsed.search||parsed.hash||
  value.length>255||!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)||
  host==='localhost'||host.endsWith('.local')||/^\d+(?:\.\d+){3}$/.test(host))throw new YouCanError('INVALID_STORE_URL');
 return parsed.origin;
}
export function matchStorefront(input,store){
 const host=new URL(storefrontUrl(input)).hostname.replace(/^www\./,'');
 const domain=String(store?.domain||'').trim().toLowerCase().replace(/^www\./,'');
 const slug=String(store?.slug||'').trim().toLowerCase();
 if(!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))throw new YouCanError('INVALID_SHOP');
 const canonical=/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)?[`${slug}.youcan.store`,`${slug}.youcan.shop`]:[];
 if(host!==domain&&!canonical.includes(host))throw new YouCanError('SHOP_URL_MISMATCH');
 return domain;
}
export async function verifySignature(raw,signature,secret){
 if(!/^[a-f0-9]{64}$/i.test(signature||''))return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signed=new Uint8Array(await crypto.subtle.sign('HMAC',key,raw));
 const expected=[...signed].map(x=>x.toString(16).padStart(2,'0')).join('');
 const got=signature.toLowerCase();let difference=0;
 for(let i=0;i<64;i++)difference|=expected.charCodeAt(i)^got.charCodeAt(i);
 return difference===0;
}
export const storeId=x=>{
 const v=String(x||'').toLowerCase();
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v))throw new YouCanError('INVALID_SHOP');
 return v;
};
export function codMethods(input){
 const values=String(input||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 const all=[...new Set([...DEFAULT_COD_METHODS,...values])];
 if(all.length>20||all.some(x=>x.length<2||x.length>80))throw new YouCanError('INVALID_COD_METHODS');
 return all;
}
const str=(x,max)=>String(x??'').trim().slice(0,max);
const amount=x=>{
 if(!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(String(x??'')))throw new YouCanError('INVALID_AMOUNT');
 return Math.round(Number(x)*100);
};
const money=cents=>(cents/100).toFixed(2);
const date=x=>{
 const n=Date.parse(x||'');if(!Number.isFinite(n))throw new YouCanError('INVALID_REMOTE_DATE');
 return new Date(n).toISOString();
};
// Same rules as crm_private.normalize_phone: a JS accept must never become a SQL reject (503 loop).
export function normalizePhone(v){
 let s=String(v??'').replace(/[\s().-]/g,'');
 if(s.startsWith('00'))s='+'+s.slice(2);
 if(/^\+2130[567]\d{8}$/.test(s))s='+213'+s.slice(5);
 if(/^213[567]\d{8}$/.test(s))s='+'+s;
 if(/^0[567]\d{8}$/.test(s))s='+213'+s.slice(1);
 if(!/^\+\d{8,15}$/.test(s)||(s.startsWith('+213')&&!/^\+213[567]\d{8}$/.test(s)))return null;
 return s;
}
function skip(base,code){return {...base,skip:code,items:[],customer_name:'',phone:'',wilaya:'',commune:'',address:'',fee:'0.00',discount:'0.00',total:'0.00'};}
const first=x=>Array.isArray(x)?x.find(a=>a&&typeof a==='object')||{}:x&&typeof x==='object'?x:{};

export function normalizeOrder(raw,methods=DEFAULT_COD_METHODS){
 if(!raw||typeof raw!=='object')throw new YouCanError('INVALID_ORDER');
 const id=storeId(raw.id);
 const base={external_id:id,number:str(raw.ref||id,100),created_at:date(raw.created_at),updated_at:date(raw.updated_at||raw.created_at),
  remote_status:[raw.status_new||raw.status_object?.name,raw.confirmation_status,raw.shipping_status,raw.payment_status_new].map(x=>str(x,35)).filter(Boolean).join(' · ').slice(0,160)};
 if(Date.parse(base.updated_at)<Date.parse(base.created_at)-1000)throw new YouCanError('INVALID_REMOTE_DATE');
 const gateway=str(raw.payment?.gateway_type_text,80).toLowerCase();
 if(!gateway||!methods.includes(gateway))return skip(base,'NON_COD');
 if(raw.currency!=='DZD')return skip(base,'CURRENCY_UNSUPPORTED');
 if(raw.is_refunded_by_platform||(Array.isArray(raw.refunds)&&raw.refunds.length))return skip(base,'REFUND_REVIEW');
 const shipping=raw.shipping||{},customer=raw.customer||{},address=first(shipping.address),fallback=first(customer.address);
 const name=str(address.full_name||customer.full_name||[address.first_name||customer.first_name,address.last_name||customer.last_name].filter(Boolean).join(' ')||fallback.full_name,100);
 const phone=str(address.phone||customer.phone||fallback.phone,35);
 const wilaya=str(address.state||address.region||fallback.state||fallback.region||customer.region,80);
 const commune=str(address.city||fallback.city,100);
 const street=str([address.first_line,address.second_line].filter(Boolean).join(' ')||[fallback.first_line,fallback.second_line].filter(Boolean).join(' '),500);
 if(name.length<2)return skip(base,'CUSTOMER_REQUIRED');
 if(!normalizePhone(phone))return skip(base,'INVALID_PHONE');
 if(wilaya.length<2)return skip(base,'WILAYA_REQUIRED');
 if(!Array.isArray(raw.variants)||raw.variants.length<1||raw.variants.length>200)return skip(base,'INVALID_ITEMS');
 const combined=new Map();let subtotal=0;
 try{
  for(const line of raw.variants){
   const q=Number(line.quantity),price=amount(line.price);
   if(!Number.isInteger(q)||q<1||q>10000)throw new YouCanError('INVALID_ITEMS');
   const key=str(line.variant?.id||line.id,100),sku=str(line.variant?.sku||'',80),title=str(line.variant?.product?.name||'',160);
   if(!key||title.length<2)throw new YouCanError('INVALID_ITEMS');
   const grouping=sku||key,prior=combined.get(grouping);
   if(prior){if(prior.unit_price!==money(price)||prior.quantity+q>10000)throw new YouCanError('INVALID_ITEMS');prior.quantity+=q;}
   else combined.set(grouping,{remote_key:key,sku,name:title,quantity:q,unit_price:money(price)});
   subtotal+=price*q;
  }
  const fee=amount(shipping.price??0)+amount(raw.vat??0),total=amount(raw.total),discount=subtotal+fee-total;
  if(discount<0||discount>subtotal+fee||subtotal+fee>10_000_000_000)throw new YouCanError('INVALID_AMOUNT');
  return {...base,customer_id:customer.id?str(customer.id,100):null,customer_name:name,phone,wilaya,commune,address:street,
   fee:money(fee),discount:money(discount),total:money(total),items:[...combined.values()]};
 }catch(e){if(e instanceof YouCanError)return skip(base,e.code);throw e;}
}
