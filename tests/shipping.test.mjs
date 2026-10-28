import test from 'node:test';
import assert from 'node:assert/strict';
import {zrState,legacyParcel,newParcel,matchTerritory,parcelFacts} from '../supabase/functions/weconvert-zr/domain.mjs';

test('ZR statuses preserve delivery and return semantics',()=>{
 assert.equal(zrState('Livrée [ encaisser ]'),'delivered');
 assert.equal(zrState('ReadyToDispatch'),'submitted');
 assert.equal(zrState('Sortie en livraison'),'out_for_delivery');
 assert.equal(zrState('Retour stock'),'returned');
 assert.equal(zrState('recupere_par_fournisseur'),'returned');
 assert.equal(zrState('Nouveau statut ZR'),'unknown');
});
test('legacy parcel carries stable id and COD amount',()=>{
 const o={reference:'WC123-abc',delivery_type:'home',customer_name:'Client Test',phone:'+213555000010',address:'Rue du test',commune:'Kouba',total:2400,items:[{name:'Article',quantity:2}]};
 const p=legacyParcel(o,16).Colis[0];
 assert.equal(p.Tracking,o.reference);assert.equal(p.id_Externe,o.reference);
 assert.equal(p.IDWilaya,'16');assert.equal(p.Total,'2400');assert.equal(p.Confrimee,1);
 assert.throws(()=>legacyParcel(o,70),/WILAYA_CODE_REQUIRED/);
});
test('new platform requires both territories and ready state',()=>{
 const u='10000000-0000-4000-8000-000000000001';
 const o={reference:'WC123-abc',source_hub_id:u,delivery_type:'home',customer_name:'Client Test',phone:'+213555000010',address:'Rue du test',total:2400,items:[{name:'Article',quantity:2}]};
 const p=newParcel(o,u,u,u);assert.equal(p.externalId,o.reference);assert.equal(p.stateId,u);assert.equal(p.amount,2400);
 assert.throws(()=>newParcel(o,'',u,u),/TERRITORY_REQUIRED/);
 assert.throws(()=>newParcel(o,u,u,''),/READY_STATE_REQUIRED/);
 assert.throws(()=>newParcel({...o,delivery_type:'desk'},u,u,u),/PICKUP_UNAVAILABLE/);
});
test('wilaya matching handles numeric prefixes and French diacritics',()=>{
 const items=[{id:'a',name:'Béjaïa'},{id:'b',name:'Alger'}];
 assert.equal(matchTerritory('06 - Bejaia',items),'a');
 assert.equal(matchTerritory('Alger',items),'b');
 assert.equal(matchTerritory('Oran',items),'');
});
test('ZR parcel facts use remote external reference and status, never a Woo completed label',()=>{
 const p=parcelFacts({id:'10000000-0000-4000-8000-000000000001',externalId:'345',trackingNumber:'16-ABC-ZR',amount:2400,state:{name:'Livrée'},customer:{phone:{number1:'+213555000010'}},lastStateUpdateAt:'2026-10-25T12:00:00Z'});
 assert.equal(p.external_id,'345');assert.equal(p.phone,'+213555000010');
 assert.equal(p.state,'delivered');assert.equal(p.amount,2400);
 assert.equal(parcelFacts({externalId:'346',state:{name:'OrderReceived'}}).state,'submitted');
});
