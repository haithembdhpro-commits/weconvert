import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {normalizeStoreUrl,publicIP,validateKeys,codMethods,verifySignature,normalizeOrder,normalizeProduct,wooStatusSupported,boundedText,digest,readWebhookOrder} from '../supabase/functions/weconvert-woocommerce/domain.mjs';
const fixture=()=>({id:81,number:'WEB-81',status:'processing',payment_method:'cod',currency:'DZD',date_created_gmt:'2026-10-01T10:00:00',date_modified_gmt:'2026-10-02T10:00:00',billing:{first_name:'أحمد',last_name:'Test',phone:'0555 12 34 56',state:'DZ-16',city:'Alger',address_1:'Rue test',country:'DZ'},shipping:{},line_items:[{id:1,product_id:7,variation_id:9,name:'Livre rouge',sku:'RED',quantity:3,total:'100',total_tax:'0'}],shipping_total:'500',total:'600',meta_data:[{key:'utm_campaign',value:'pack'},{key:'private_token',value:'DO NOT KEEP'}],customer_note:'Après 16h'});
test('store URL handles subdirectories but blocks credentials, IPs, internal addresses and redirects-in-path',()=>{
 assert.equal(normalizeStoreUrl('https://shop.example.com/wp/'),'https://shop.example.com/wp');
 for(const u of ['http://shop.com','https://127.1','https://0x7f000001','https://localhost','https://shop.internal','https://user:pass@shop.com','https://shop.com:444','https://shop.com/?a=b','https://shop.com/wp-json','https://shop.com/a%2fb','https://[::1]'])assert.throws(()=>normalizeStoreUrl(u));
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1','2001:db8::1','2002:7f00:1::'])assert.equal(publicIP(ip),false,ip);
 assert.equal(publicIP('8.8.8.8'),true);assert.equal(publicIP('2606:4700:4700::1111'),true);
});
test('keys and custom COD method names validated',()=>{validateKeys('ck_'+'a'.repeat(40),'cs_'+'b'.repeat(40));assert.throws(()=>validateKeys('key','secret'));assert.deepEqual(codMethods('cod, cash, cod'),['cod','cash']);assert.throws(()=>codMethods('a,b,<script>'));});
test('signature authenticates exact bytes and rejects missing, wrong or modified payloads',async()=>{
 const body='{"id":81,"name":"أحمد"}',secret='fixture-only',sig=createHmac('sha256',secret).update(body).digest('base64');
 assert.equal(await verifySignature(body,sig,secret),true);assert.equal(await verifySignature(body+' ',sig,secret),false);assert.equal(await verifySignature(body,sig,'wrong'),false);assert.equal(await verifySignature(body,'',secret),false);
});
test('COD total reconciles cents, variants and whitelist attribution',()=>{const o=normalizeOrder(fixture());assert.equal(o.phone,'+213555123456');assert.equal(o.items[0].remote_key,'v:9');assert.equal(o.items[0].unit_price,33.33);assert.equal(o.fee,500.01);assert.equal(Math.round((o.items[0].unit_price*3+o.fee-o.discount)*100),60000);assert.deepEqual(o.attribution,{utm_campaign:'pack'});assert.equal(o.created_at,'2026-10-01T10:00:00.000Z');});
test('Suite Purchase requires both the order-bound event ID and the successful CAPI marker',()=>{
 const event={key:'_kb_capi_event_id',value:'kb_81_012345abcdef'},sent={key:'_kb_capi_purchase_sent',value:'2026-10-01 11:05:06'};
 const raw=fixture();raw.meta_data.push(event);
 assert.equal(normalizeOrder(raw).tracking,undefined,'an ID alone is created before the Meta send');
 raw.meta_data.push(sent);assert.deepEqual(normalizeOrder(raw).tracking,{purchase_event_id:event.value,purchase_sent_marker:sent.value});
 raw.meta_data[raw.meta_data.length-2]={...event,value:'kb_82_012345abcdef'};
 assert.equal(normalizeOrder(raw).tracking,undefined,'event for another order is rejected');
 raw.meta_data[raw.meta_data.length-2]=event;raw.meta_data[raw.meta_data.length-1]={...sent,value:'failed'};
 assert.equal(normalizeOrder(raw).tracking,undefined,'arbitrary status is not evidence');
});
test('Woo statuses are retained as source facts, not interpreted as COD confirmation',()=>{
 for(const woo of ['pending','on-hold','processing','completed','cancelled','failed','refunded']){
  assert.equal(wooStatusSupported(woo),true);
  assert.equal(normalizeOrder({...fixture(),status:woo,date_paid_gmt:'2026-10-02T12:00:00'}).remote_status,woo);
 }
 assert.equal(wooStatusSupported('trash'),false);
 for(const [patch,code] of [[{payment_method:'stripe'},'NON_COD'],[{currency:'EUR'},'CURRENCY_UNSUPPORTED'],[{status:'trash'},'STATUS_EXCLUDED'],[{refunds:[{id:1}]},'PARTIAL_REFUND']])assert.equal(normalizeOrder({...fixture(),...patch}).skip,code);
});
test('Woo products and variations normalize price, SKU and managed stock without inventing inventory',()=>{
 const simple=normalizeProduct({id:7,type:'simple',name:'Livre rouge',sku:'RED',price:'4100.50',manage_stock:true,stock_quantity:15});
 assert.deepEqual(simple,{remote_key:'p:7',name:'Livre rouge',sku:'RED',price:4100.5,stock:15,stock_managed:true,parent_id:null});
 const variable={id:10,type:'variable',name:'T-shirt'};
 assert.deepEqual(normalizeProduct(variable),{parent_id:10,variable:true});
 const variant=normalizeProduct({id:11,sku:'TS-BL',price:'2900',manage_stock:false,stock_quantity:null,attributes:[{option:'Bleu'},{option:'M'}]},variable);
 assert.deepEqual(variant,{remote_key:'v:11',name:'T-shirt · Bleu / M',sku:'TS-BL',price:2900,stock:null,stock_managed:false,parent_id:10});
 assert.equal(normalizeProduct({id:12,type:'grouped'}).skip,'PRODUCT_UNSUPPORTED');
 assert.throws(()=>normalizeProduct({id:0,type:'simple'}),/INVALID_PRODUCT/);
});
test('bad contacts or quantities produce actionable errors without silently losing an order',()=>{assert.throws(()=>normalizeOrder({...fixture(),billing:{phone:'123'}}),/CUSTOMER_REQUIRED/);const o=fixture();o.billing.phone='123';assert.throws(()=>normalizeOrder(o),/INVALID_PHONE/);o.billing.phone='0555123456';o.line_items[0].quantity=0;assert.throws(()=>normalizeOrder(o),/INVALID_ITEMS/);});
test('same variation repeated is merged and negative adjustment remains a discount',()=>{const o=fixture();o.line_items.push({...o.line_items[0],id:2});o.total='199.99';const n=normalizeOrder(o);assert.equal(n.items.length,1);assert.equal(n.items[0].quantity,6);assert.equal(Math.round((6*n.items[0].unit_price+n.fee-n.discount)*100),19999);});
test('bodies are bounded even without a Content-Length header; hash is stable',async()=>{await assert.rejects(()=>boundedText(new Response('123456'),5),/PAYLOAD_TOO_LARGE/);assert.equal(await boundedText(new Response('abc'),3),'abc');assert.equal(await digest({a:1}),await digest({a:1}));});

test('complete signed webhook uses its payload without another Woo request; minimal replays fetch once',async()=>{
 const full=fixture();let calls=0;const load=async id=>{calls++;assert.equal(id,81);return full;};
 assert.equal(await readWebhookOrder(full,load),full);assert.equal(calls,0);
 assert.equal(await readWebhookOrder({id:81},load),full);assert.equal(calls,1);
 await assert.rejects(()=>readWebhookOrder({id:'oops'},load),/INVALID_ORDER/);assert.equal(calls,1);
});
