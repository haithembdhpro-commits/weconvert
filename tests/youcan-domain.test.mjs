import test from 'node:test';
import assert from 'node:assert/strict';
import {YouCanError,storeId,codMethods,normalizeOrder,verifySignature,channelName,storefrontUrl,matchStorefront} from '../supabase/functions/weconvert-youcan/domain.mjs';

const id='72aa7882-3898-49a8-87a2-506af3dd7320';
const order=(patch={})=>({id,ref:'10245',created_at:'2026-10-26T10:00:00Z',updated_at:'2026-10-26T10:03:00Z',currency:'DZD',total:3200,vat:0,
 status_new:'Open',confirmation_status:'pending',shipping_status:'unfulfilled',payment_status_new:'Pending',
 payment:{gateway_type_text:'Cash on Delivery'},shipping:{price:400,address:[{full_name:'Client YouCan',phone:'0555123456',state:'Alger',city:'Kouba',first_line:'Rue du test'}]},
 customer:{id:'00000000-0000-0000-0000-000000000010',phone:'0555123456'},refunds:[],
 variants:[{id:'00000000-0000-0000-0000-000000000011',price:1500,quantity:2,variant:{id:'00000000-0000-0000-0000-000000000012',sku:'YCN-BOOK',product:{name:'Livre YouCan'}}}],...patch});

test('YouCan UUID remains a safe, fixed API path segment',()=>{
 assert.equal(storeId(id.toUpperCase()),id);
 for(const bad of ['https://api.youcan.shop/orders/a','../me','00000000-0000-0000-0000-000000000000?include=all'])assert.throws(()=>storeId(bad),YouCanError);
});
test('a channel has a clear name and a safe HTTPS storefront URL',()=>{
 assert.equal(channelName('  Librairie DZ  '),'Librairie DZ');
 assert.equal(storefrontUrl(' https://www.librairie-dz.com/ '),'https://www.librairie-dz.com');
 for(const value of ['http://shop.youcan.store','https://127.0.0.1','https://localhost','https://shop.youcan.store/orders','https://user:pass@shop.youcan.store','https://shop.youcan.store/?q=x'])assert.throws(()=>storefrontUrl(value),YouCanError);
 assert.throws(()=>channelName(' '),YouCanError);
});
test('OAuth identity must match the entered domain or the store canonical slug',()=>{
 const store={domain:'www.ma-boutique.dz',slug:'ma-boutique'};
 assert.equal(matchStorefront('https://ma-boutique.dz',store),'ma-boutique.dz');
 assert.equal(matchStorefront('https://ma-boutique.youcan.store',store),'ma-boutique.dz');
 assert.throws(()=>matchStorefront('https://autre-boutique.youcan.store',store),e=>e.code==='SHOP_URL_MISMATCH');
});
test('raw webhook body signature rejects tampering and malformed headers',async()=>{
 const raw=new TextEncoder().encode('{"event_name":"order.created","data":{"id":"test"}}');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,raw))].map(x=>x.toString(16).padStart(2,'0')).join('');
 assert.equal(await verifySignature(raw,sig,'secret'),true);
 assert.equal(await verifySignature(new TextEncoder().encode(new TextDecoder().decode(raw)+' '),sig,'secret'),false);
 assert.equal(await verifySignature(raw,'','secret'),false);
 assert.equal(await verifySignature(raw,sig,'other'),false);
});
test('DZD COD preserves amount and platform statuses as metadata',()=>{
 const d=normalizeOrder(order());assert.equal(d.number,'10245');assert.equal(d.total,'3200.00');assert.equal(d.fee,'400.00');assert.equal(d.discount,'200.00');
 assert.equal(d.remote_status,'Open · pending · unfulfilled · Pending');assert.equal(d.items[0].remote_key,'00000000-0000-0000-0000-000000000012');assert.equal(d.skip,undefined);
});
test('non COD, refund, foreign currency, missing phone and wilaya never create orders',()=>{
 assert.equal(normalizeOrder(order({payment:{gateway_type_text:'Card'}})).skip,'NON_COD');
 assert.equal(normalizeOrder(order({refunds:[{id:'refund'}]})).skip,'REFUND_REVIEW');
 assert.equal(normalizeOrder(order({currency:'MAD'})).skip,'CURRENCY_UNSUPPORTED');
 assert.equal(normalizeOrder(order({customer:{},shipping:{price:400,address:[{full_name:'Client YouCan',state:'Alger'}]}})).skip,'INVALID_PHONE');
 assert.equal(normalizeOrder(order({shipping:{price:400,address:[{full_name:'Client YouCan',phone:'0555123456',city:'Kouba'}]}})).skip,'WILAYA_REQUIRED');
});
test('malformed totals and conflicting variants are held for review',()=>{
 assert.equal(normalizeOrder(order({total:3500})).skip,'INVALID_AMOUNT');
 const lines=order().variants;assert.equal(normalizeOrder(order({variants:[lines[0],{...lines[0],price:1000}],total:4500})).skip,'INVALID_ITEMS');
});
test('exact per-store manual COD names are supported',()=>{
 assert.equal(normalizeOrder(order({payment:{gateway_type_text:'Paiement à la livraison'}}),codMethods('Paiement à la livraison')).skip,undefined);
 assert.equal(normalizeOrder(order({payment:{gateway_type_text:'Virement bancaire'}}),codMethods('Paiement à la livraison')).skip,'NON_COD');
});
