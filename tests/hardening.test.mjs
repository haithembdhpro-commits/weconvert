import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as shopify from '../supabase/functions/weconvert-shopify/domain.mjs';
import * as youcan from '../supabase/functions/weconvert-youcan/domain.mjs';
import {wilayaName} from '../supabase/functions/weconvert-woocommerce/domain.mjs';
import {legacyParcel} from '../supabase/functions/weconvert-zr/domain.mjs';

test('JS phone rules match crm_private.normalize_phone (no SQL reject after a JS accept)',()=>{
 for(const m of [shopify,youcan]){
  assert.equal(m.normalizePhone('+213 0551 23 45 67'),'+213551234567');
  assert.equal(m.normalizePhone('213551234567'),'+213551234567');
  assert.equal(m.normalizePhone('0551 23 45 67'),'+213551234567');
  assert.equal(m.normalizePhone('0033 6 12 34 56 78'),'+33612345678');
  assert.equal(m.normalizePhone('+2130212345'),null);
  assert.equal(m.normalizePhone('12'),null);
 }
});

test('WooCommerce DZ state codes become readable wilayas that keep their code',()=>{
 assert.equal(wilayaName('DZ-16'),'16 - Alger');
 assert.equal(wilayaName('DZ-58'),'58 - El Meniaa');
 assert.equal(wilayaName('DZ-63'),'63');
 assert.equal(wilayaName('Oran'),'Oran');
});

test('ZR legacy accepts the 69 wilaya codes',()=>{
 const o={customer_name:'Client',phone:'+213555000000',address:'Rue test',commune:'Commune',delivery_type:'home',total:1000,items:[{name:'Produit',quantity:1}],reference:'R1'};
 assert.doesNotThrow(()=>legacyParcel(o,69));
 assert.throws(()=>legacyParcel(o,70),/WILAYA_CODE_REQUIRED/);
});

test('Edge Functions no longer trust the null origin or a local dev host in production',async()=>{
 for(const f of ['woocommerce','shopify','youcan','zr']){
  const src=await readFile(new URL(`../supabase/functions/weconvert-${f}/index.ts`,import.meta.url),'utf8');
  assert.ok(!src.includes("'null'")&&!src.includes('terminal.local'),f);
 }
});

test('OAuth callbacks park tokens until the initiator confirms',async()=>{
 for(const f of ['shopify','youcan']){
  const src=await readFile(new URL(`../supabase/functions/weconvert-${f}/index.ts`,import.meta.url),'utf8');
  const callback=src.slice(src.indexOf("path.endsWith('/callback')"),src.indexOf("path.endsWith('/webhook')"));
  assert.ok(!callback.includes("'finish_oauth'"),f+' callback must not activate');
  assert.ok(callback.includes("guard('stash'"),f+' callback stashes');
  assert.ok(src.includes("guard('bind'")&&src.includes("action==='confirm'"),f+' binds and confirms');
 }
});

test('Built page ships a Content-Security-Policy',async()=>{
 const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
 assert.match(html,/Content-Security-Policy" content="default-src 'self'; script-src 'self';/);
});
