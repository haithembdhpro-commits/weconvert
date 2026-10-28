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
test('a signed body is only accepted for the shop it names (anti cross-shop replay)',async()=>{
 const {orderBelongsTo,uninstallBelongsTo,shopIdFrom,tokenExpired}=await import('../supabase/functions/weconvert-shopify/domain.mjs');
 const shop='a.myshopify.com';
 assert.equal(orderBelongsTo({order_status_url:'https://boutique.dz/111/orders/abc/authenticate?key=x'},{shop,shopId:'111'}),true);
 assert.equal(orderBelongsTo({order_status_url:'https://boutique.dz/222/orders/abc/authenticate?key=x'},{shop,shopId:'111'}),false);
 assert.equal(orderBelongsTo({},{shop,shopId:'111'}),false);
 assert.equal(orderBelongsTo({order_status_url:'https://a.myshopify.com/333/orders/x'},{shop,shopId:null}),true);
 assert.equal(orderBelongsTo({order_status_url:'https://b.myshopify.com/333/orders/x'},{shop,shopId:null}),false);
 assert.equal(orderBelongsTo({order_status_url:'http://a.myshopify.com/333/orders/x'},{shop,shopId:null}),false);
 assert.equal(uninstallBelongsTo({id:111,myshopify_domain:'A.myshopify.com'},{shop,shopId:'111'}),true);
 assert.equal(uninstallBelongsTo({id:222,myshopify_domain:'a.myshopify.com'},{shop,shopId:'111'}),false);
 assert.equal(uninstallBelongsTo({id:111,myshopify_domain:'b.myshopify.com'},{shop,shopId:null}),false);
 assert.equal(shopIdFrom(548380009),'548380009');assert.equal(shopIdFrom('0'),null);assert.equal(shopIdFrom('12a'),null);
 const now=Date.parse('2026-10-28T12:00:00Z');
 assert.equal(tokenExpired({obtained_at:'2026-10-28T11:00:00Z',expires_in:7200},now),false);
 assert.equal(tokenExpired({obtained_at:'2026-10-28T10:00:00Z',expires_in:3600},now),true);
 assert.equal(tokenExpired({},now),true);
});
