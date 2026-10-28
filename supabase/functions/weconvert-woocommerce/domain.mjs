// Shared, runtime-independent validation; also exercised by node:test.
export class WooError extends Error { constructor(code,status=400){super(code);this.status=status;} }
export function normalizeStoreUrl(input){
 let u;try{u=new URL(String(input).trim());}catch{throw new WooError('INVALID_URL');}
 const h=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||(u.port&&u.port!=='443')||!h.includes('.')||h.endsWith('.')||h.includes(':')||/^\d+(\.\d+)*$/.test(h)||/(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(h))throw new WooError('INVALID_URL');
 if(!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]*\/?$/.test(u.pathname)||/\/(wp-admin|wp-json|wp-login\.php)(\/|$)/i.test(u.pathname))throw new WooError('INVALID_URL');
 return u.origin+u.pathname.replace(/\/+$/,'');
}
export function publicIP(ip){
 if(ip.includes(':'))return /^2[0-9a-f]{3}:/i.test(ip)&&!/^2001:(db8|0|10|20):/i.test(ip)&&!/^2002:/i.test(ip);
 const a=ip.split('.').map(Number);if(a.length!==4||a.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
 const [x,y]=a;return !(x===0||x===10||x===127||x>=224||(x===100&&y>=64&&y<=127)||(x===169&&y===254)||(x===172&&y>=16&&y<=31)||(x===192&&(y===0||y===168))||(x===198&&(y===18||y===19||y===51))||(x===203&&y===0));
}
export function validateKeys(key,secret){if(!/^ck_[a-f0-9]{40}$/.test(key)||!/^cs_[a-f0-9]{40}$/.test(secret))throw new WooError('INVALID_KEYS');}
export function codMethods(input){const a=String(input||'cod').split(',').map(s=>s.trim()).filter(Boolean);if(a.length<1||a.length>10||a.some(s=>!/^[-a-zA-Z0-9_]{1,80}$/.test(s)))throw new WooError('INVALID_METHODS');return [...new Set(a)];}
export async function verifySignature(body,signature,secret){
 if(!/^[A-Za-z0-9+/]{43}=$/.test(signature||''))return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 return crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(signature),c=>c.charCodeAt(0)),typeof body==='string'?new TextEncoder().encode(body):body);
}
export async function digest(value){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function boundedText(response,max=2_000_000){
 if(Number(response.headers.get('content-length')||0)>max)throw new WooError('PAYLOAD_TOO_LARGE',413);
 const reader=response.body?.getReader();if(!reader)return '';const parts=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new WooError('PAYLOAD_TOO_LARGE',413);parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return new TextDecoder().decode(bytes);
}
// WooCommerce sends Algerian states as ISO codes (DZ-16). Store "16 - Alger": readable in reports, and the
// leading code still feeds the ZR wilaya selector. Codes without a known name (newer wilayas) are kept as "NN".
const DZ_WILAYAS=["Adrar", "Chlef", "Laghouat", "Oum El Bouaghi", "Batna", "Béjaïa", "Biskra", "Béchar", "Blida", "Bouira", "Tamanrasset", "Tébessa", "Tlemcen", "Tiaret", "Tizi Ouzou", "Alger", "Djelfa", "Jijel", "Sétif", "Saïda", "Skikda", "Sidi Bel Abbès", "Annaba", "Guelma", "Constantine", "Médéa", "Mostaganem", "M'Sila", "Mascara", "Ouargla", "Oran", "El Bayadh", "Illizi", "Bordj Bou Arréridj", "Boumerdès", "El Tarf", "Tindouf", "Tissemsilt", "El Oued", "Khenchela", "Souk Ahras", "Tipaza", "Mila", "Aïn Defla", "Naâma", "Aïn Témouchent", "Ghardaïa", "Relizane", "Timimoun", "Bordj Badji Mokhtar", "Ouled Djellal", "Béni Abbès", "In Salah", "In Guezzam", "Touggourt", "Djanet", "El M'Ghair", "El Meniaa"];
export function wilayaName(state){const m=/^DZ-(\d{1,2})$/i.exec(String(state??'').trim());if(!m)return state;const n=Number(m[1]);return String(n).padStart(2,'0')+(DZ_WILAYAS[n-1]?' - '+DZ_WILAYAS[n-1]:'');}
const text=(v,n=100)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,n);
function cents(v){if(!/^-?\d+(\.\d{1,6})?$/.test(String(v??'')))throw new WooError('INVALID_AMOUNT');const n=Math.round(Number(v)*100);if(!Number.isSafeInteger(n)||Math.abs(n)>99_999_999_999)throw new WooError('INVALID_AMOUNT');return n;}
function phone(v,country){let s=text(v,40).replace(/[\s().-]/g,'');if(s.startsWith('00'))s='+'+s.slice(2);if(/^\+2130[567]\d{8}$/.test(s))s='+213'+s.slice(5);if((country==='DZ'||!country)&&/^0[567]\d{8}$/.test(s))s='+213'+s.slice(1);if((country==='DZ'||!country)&&/^213[567]\d{8}$/.test(s))s='+'+s;if(!/^\+\d{8,15}$/.test(s)||(s.startsWith('+213')&&!/^\+213[567]\d{8}$/.test(s)))throw new WooError('INVALID_PHONE');return s;}
function utc(v){const s=String(v||'');const n=Date.parse(s.endsWith('Z')?s:s+'Z');if(!s||!Number.isFinite(n))throw new WooError('INVALID_REMOTE_DATE');return new Date(n).toISOString();}
export function normalizeOrder(raw,methods=['cod']){
 const id=Number(raw?.id);if(!Number.isSafeInteger(id)||id<1)throw new WooError('INVALID_ORDER');
 const status=text(raw.status,40),payment=text(raw.payment_method,80);
 const base={external_id:id,number:text(raw.number||id,80),remote_status:status,payment_method:payment,modified_at:utc(raw.date_modified_gmt||raw.date_created_gmt)};
 if(!methods.includes(payment))return {...base,skip:'NON_COD'};
 if(raw.currency!=='DZD')return {...base,skip:'CURRENCY_UNSUPPORTED'};
 if(!wooStatusSupported(status))return {...base,skip:'STATUS_EXCLUDED'};
 if(status!=='refunded'&&raw.refunds?.length)return {...base,skip:'PARTIAL_REFUND'};
 const bill=raw.billing||{},ship=raw.shipping||{};
 const customer=text([ship.first_name||bill.first_name,ship.last_name||bill.last_name].filter(Boolean).join(' '));
 if(customer.length<2)throw new WooError('CUSTOMER_REQUIRED');
 const items=new Map();
 if(!Array.isArray(raw.line_items)||raw.line_items.length<1||raw.line_items.length>200)throw new WooError('INVALID_ITEMS');
 for(const l of raw.line_items){
  const q=Number(l.quantity);if(!Number.isInteger(q)||q<1||q>10000)throw new WooError('INVALID_ITEMS');
  const remoteKey=l.variation_id>0?'v:'+l.variation_id:l.product_id>0?'p:'+l.product_id:'line:'+id+':'+l.id;
  const amount=cents(l.total)+cents(l.total_tax||'0');if(amount<0)throw new WooError('INVALID_AMOUNT');
  const prev=items.get(remoteKey);if(prev){prev.quantity+=q;prev.amount+=amount;if(prev.quantity>10000)throw new WooError('INVALID_ITEMS');}
  else items.set(remoteKey,{remote_key:remoteKey,name:text(l.name,160).length>=2?text(l.name,160):'Article WooCommerce',sku:text(l.sku,80),quantity:q,amount});
 }
 const normalized=[...items.values()].map(({amount,...i})=>({...i,unit_price:Math.round(amount/i.quantity)/100}));
 const subtotal=normalized.reduce((n,i)=>n+Math.round(i.unit_price*100)*i.quantity,0),total=cents(raw.total);if(total<0)throw new WooError('INVALID_AMOUNT');
 // Lines already include their discounts and tax. Reconcile the payable total exactly.
 const adjustment=total-subtotal;
 const attribution={},meta={};for(const m of raw.meta_data||[]){const key=text(m.key,100);if(/^(utm_(source|medium|campaign|content|term)|_wc_order_attribution_(utm_source|utm_medium|utm_campaign|utm_content|utm_term|source_type|referrer|session_entry)|fbclid|gclid|ttclid)$/.test(key)&&typeof m.value==='string')attribution[key]=text(m.value,500);if(['_kb_capi_event_id','_kb_capi_purchase_sent'].includes(key)&&typeof m.value==='string')meta[key]=text(m.value,100);}
 // The event ID is written before sending. Only the Suite's subsequent positive CAPI-response marker counts.
 const eventId=meta._kb_capi_event_id,marked=meta._kb_capi_purchase_sent;
 const tracking=eventId===undefined||!new RegExp('^kb_'+id+'_[a-f0-9]{12}$','i').test(eventId)||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(marked||'')?{}:{tracking:{purchase_event_id:eventId,purchase_sent_marker:marked}};
 return {...base,created_at:utc(raw.date_created_gmt),customer_name:customer,phone:phone(ship.phone||bill.phone,ship.country||bill.country),wilaya:text(wilayaName(ship.state||bill.state)||'À compléter',80),commune:text(ship.city||bill.city,100),address:text([ship.address_1||bill.address_1,ship.address_2||bill.address_2].filter(Boolean).join(', '),500),items:normalized,fee:Math.max(0,adjustment)/100,discount:Math.max(0,-adjustment)/100,total:total/100,note:text(raw.customer_note,2000),attribution,...tracking};
}

export function wooStatusSupported(status){return ['pending','on-hold','processing','completed','cancelled','failed','refunded'].includes(status);}

export function normalizeProduct(raw,parent=null){
 const id=Number(raw?.id),parentId=Number(parent?.id);
 if(!Number.isSafeInteger(id)||id<1||parent&&(!Number.isSafeInteger(parentId)||parentId<1))throw new WooError('INVALID_PRODUCT');
 if(!parent&&raw.type==='variable')return {parent_id:id,variable:true};
 if(!parent&&raw.type!=='simple')return {remote_key:'p:'+id,skip:'PRODUCT_UNSUPPORTED'};
 const attributes=parent?(raw.attributes||[]).map(a=>text(a.option,40)).filter(Boolean).join(' / '):'';
 const name=text((parent?parent.name+(attributes?' · '+attributes:''):raw.name),160);
 if(name.length<2)throw new WooError('INVALID_PRODUCT');
 const price=raw.price===''||raw.price==null?0:cents(raw.price)/100;
 if(price<0)throw new WooError('INVALID_PRODUCT');
 const quantity=raw.manage_stock===true?Number(raw.stock_quantity):null;
 if(quantity!==null&&(!Number.isSafeInteger(quantity)||Math.abs(quantity)>1_000_000_000))throw new WooError('INVALID_PRODUCT');
 return {remote_key:(parent?'v:':'p:')+id,name,sku:text(raw.sku,80),price,stock:quantity===null?null:Math.max(0,quantity),stock_managed:quantity!==null,parent_id:parent?parentId:null};
}

// Signed v3 payloads already contain the order: avoid a second network round trip.
// Minimal replay/restore notifications still fetch the authoritative API representation.
export async function readWebhookOrder(incoming,loadOrder){
 const id=Number(incoming?.id);if(!Number.isSafeInteger(id)||id<1)throw new WooError('INVALID_ORDER');
 const complete=typeof incoming.status==='string'&&typeof incoming.payment_method==='string'&&typeof incoming.currency==='string'&&typeof incoming.date_created_gmt==='string'&&typeof incoming.date_modified_gmt==='string'&&Array.isArray(incoming.line_items)&&Object.hasOwn(incoming,'total');
 return complete?incoming:loadOrder(id);
}
