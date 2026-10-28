import test from 'node:test';
import assert from 'node:assert/strict';
import {shopDomain,codMethods,normalizeOrder,ShopifyError} from '../supabase/functions/weconvert-shopify/domain.mjs';
const order=(patch={})=>({id:98765,name:'#1001',created_at:'2026-10-26T10:00:00Z',updated_at:'2026-10-26T10:02:00Z',currency:'DZD',financial_status:'pending',payment_gateway_names:['Cash on Delivery (COD)'],shipping_address:{name:'Amine Test',phone:'0551234567',province:'Alger',city:'Alger Centre',address1:'Rue des tests'},line_items:[{id:10,product_id:100,variant_id:101,title:'Livre test',sku:'BOOK-1',quantity:2,price:'1500.00'}],total_shipping_price_set:{shop_money:{amount:'400.00'}},total_tax:'0.00',total_price:'3200.00',...patch});
test('Shopify shop remains on a permanent, safe domain',()=>{
 assert.equal(shopDomain(' librairie.myshopify.com '),'librairie.myshopify.com');
 for(const input of ['https://librairie.myshopify.com','librairie.myshopify.com.evil.net','127.0.0.1','librairie.myshopify.com/path'])assert.throws(()=>shopDomain(input),ShopifyError);
});
test('COD in DZD is normalized, source decision is only metadata',()=>{
 const d=normalizeOrder(order());assert.equal(d.number,'1001');assert.equal(d.total,'3200.00');assert.equal(d.fee,'400.00');assert.equal(d.discount,'200.00');assert.equal(d.remote_status,'pending · non expédiée');assert.equal(d.items[0].quantity,2);assert.equal(d.skip,undefined);
});
test('non COD, refund and historical formats are held out of the confirmation queue',()=>{
 assert.equal(normalizeOrder(order({payment_gateway_names:['shopify_payments']})).skip,'NON_COD');
 assert.equal(normalizeOrder(order({financial_status:'partially_refunded'})).skip,'REFUND_REVIEW');
 assert.equal(normalizeOrder(order({currency:'EUR'})).skip,'CURRENCY_UNSUPPORTED');
 assert.equal(normalizeOrder(order({shipping_address:{name:'Amine Test',phone:'0551234567',province:'',city:'Alger'}})).skip,'WILAYA_REQUIRED');
});
test('split line items coalesce only at matching SKU and unit price',()=>{
 const first=order();first.line_items.push({...first.line_items[0],id:11,quantity:1});first.total_price='4700.00';assert.equal(normalizeOrder(first).items[0].quantity,3);
 first.line_items[1].price='1300.00';assert.equal(normalizeOrder(first).skip,'INVALID_ITEMS');
});
test('COD methods allow store-specific manual gateways without accepting other payments',()=>{
 const methods=codMethods(' Paiement à la livraison ');assert.equal(normalizeOrder(order({payment_gateway_names:['Paiement à la livraison']}),methods).skip,undefined);
 assert.equal(normalizeOrder(order({payment_gateway_names:['bank_transfer']}),methods).skip,'NON_COD');
});
