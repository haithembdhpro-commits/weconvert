// Pure validation and normalization. The Shopify raw webhook is authenticated in index.ts.
export class ShopifyError extends Error {
 constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
export const DEFAULT_COD_METHODS=['cash on delivery (cod)','cash on delivery','cod','cash_on_delivery'];
export function shopDomain(input){
 const host=String(input||'').trim().toLowerCase();
 if(!/^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(host))throw new ShopifyError('INVALID_SHOP');
 return host;
}
export function codMethods(input){
 const values=String(input||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 const all=[...new Set([...DEFAULT_COD_METHODS,...values])];
 if(all.length>20||all.some(x=>x.length<2||x.length>80))throw new ShopifyError('INVALID_COD_METHODS');
 return all;
}
const str=(x,max)=>String(x??'').trim().slice(0,max);
const amount=(x)=>{
 if(!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(String(x??'')))throw new ShopifyError('INVALID_AMOUNT');
 return Math.round(Number(x)*100);
};
const money=cents=>(cents/100).toFixed(2);
const date=x=>{
 const n=Date.parse(x||'');if(!Number.isFinite(n))throw new ShopifyError('INVALID_REMOTE_DATE');
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
export function normalizeOrder(raw,methods=DEFAULT_COD_METHODS){
 if(!raw||typeof raw!=='object'||!/^[1-9]\d{0,19}$/.test(String(raw.id||'')))throw new ShopifyError('INVALID_ORDER');
 const base={external_id:String(raw.id),number:str(raw.name||raw.order_number||raw.id,100).replace(/^#/,''),created_at:date(raw.created_at),updated_at:date(raw.updated_at||raw.created_at),remote_status:raw.cancelled_at?'Annulée':`${str(raw.financial_status||'pending',40)} · ${str(raw.fulfillment_status||'non expédiée',40)}`};
 if(Date.parse(base.updated_at)<Date.parse(base.created_at)-1000)throw new ShopifyError('INVALID_REMOTE_DATE');
 const gateways=Array.isArray(raw.payment_gateway_names)?raw.payment_gateway_names.map(x=>String(x).trim().toLowerCase()):[];
 if(!gateways.some(x=>methods.includes(x)))return skip(base,'NON_COD');
 if(raw.currency!=='DZD')return skip(base,'CURRENCY_UNSUPPORTED');
 if(raw.financial_status==='partially_refunded'||raw.financial_status==='refunded'||(Array.isArray(raw.refunds)&&raw.refunds.length))return skip(base,'REFUND_REVIEW');
 const ship=raw.shipping_address||{},bill=raw.billing_address||{},customer=raw.customer||{};
 const name=str(ship.name||[bill.first_name||customer.first_name,bill.last_name||customer.last_name].filter(Boolean).join(' ')||bill.name,100);
 const phone=str(ship.phone||raw.phone||bill.phone||customer.phone||customer.default_address?.phone,35);
 const wilaya=str(ship.province||bill.province,80),commune=str(ship.city||bill.city,100),address=str([ship.address1,ship.address2].filter(Boolean).join(' ')||[bill.address1,bill.address2].filter(Boolean).join(' '),500);
 if(name.length<2)return skip(base,'CUSTOMER_REQUIRED');
 if(!normalizePhone(phone))return skip(base,'INVALID_PHONE');
 if(wilaya.length<2)return skip(base,'WILAYA_REQUIRED');
 const lines=raw.line_items;
 if(!Array.isArray(lines)||!lines.length||lines.length>200)return skip(base,'INVALID_ITEMS');
 const combined=new Map();let subtotal=0;
 try{
  for(const line of lines){
   const q=Number(line.quantity),price=amount(line.price);
   if(!Number.isInteger(q)||q<1||q>10000)throw new ShopifyError('INVALID_ITEMS');
   const key=str(line.variant_id||line.product_id||line.id,100),sku=str(line.sku,80),title=str(line.title||line.name,160);
   if(!key||title.length<2)throw new ShopifyError('INVALID_ITEMS');
   // The CRM stores one row per catalog product. Merge equal-price split lines.
   const grouping=sku||key,prior=combined.get(grouping);
   if(prior){if(prior.unit_price!==money(price)||prior.quantity+q>10000)throw new ShopifyError('INVALID_ITEMS');prior.quantity+=q;}
   else combined.set(grouping,{remote_key:key,sku,name:title,quantity:q,unit_price:money(price)});
   subtotal+=price*q;
  }
  const shipping=amount(raw.total_shipping_price_set?.shop_money?.amount??raw.total_shipping_price_set?.presentment_money?.amount??'0');
  const tax=amount(raw.total_tax||'0'),duties=amount(raw.current_total_duties_set?.shop_money?.amount||'0');
  const total=amount(raw.total_price),fee=shipping+tax+duties,discount=subtotal+fee-total;
  if(discount<0||discount>subtotal+fee||subtotal+fee>10_000_000_000)throw new ShopifyError('INVALID_AMOUNT');
  return {...base,customer_id:raw.customer?.id?String(raw.customer.id):null,customer_name:name,phone,wilaya,commune,address,
   fee:money(fee),discount:money(discount),total:money(total),items:[...combined.values()]};
 }catch(e){if(e instanceof ShopifyError)return skip(base,e.code);throw e;}
}
// The webhook HMAC covers the body only: X-Shopify-Shop-Domain is not signed. A signed body captured from shop A
// must not be accepted under shop B's header, so the body itself has to name the shop the connection belongs to.
export function shopIdFrom(value){
 const id=String(value??'').trim();
 return /^[1-9]\d{0,19}$/.test(id)?id:null;
}
export function orderBelongsTo(raw,{shop,shopId}){
 let url;try{url=new URL(String(raw?.order_status_url||''));}catch{url=null;}
 if(shopId){
  const m=url&&/^\/(\d{1,20})\/orders\//.exec(url.pathname);
  return !!m&&m[1]===shopId;
 }
 // Connection made before the numeric id was stored: only the store's own myshopify host is accepted.
 return !!url&&url.protocol==='https:'&&url.hostname.toLowerCase()===shop;
}
export function uninstallBelongsTo(raw,{shop,shopId}){
 if(String(raw?.myshopify_domain||'').toLowerCase()!==shop)return false;
 return !shopId||String(raw?.id??'')===shopId;
}
export function tokenExpired(credentials,now=Date.now(),marginMs=60_000){
 const at=Date.parse(credentials?.obtained_at||''),ttl=Number(credentials?.expires_in);
 if(!Number.isFinite(at)||!Number.isFinite(ttl))return true;
 return at+ttl*1000-marginMs<=now;
}
