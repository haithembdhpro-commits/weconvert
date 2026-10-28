// Provider wire formats are isolated here so the CRM never treats a courier status
// as a confirmation status or an amount actually collected.
const ascii=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function zrState(raw){
 const s=ascii(raw).replace(/[_-]/g,' ').replace(/\s+/g,' ');
 if(['livre','livree','colis livree','livree [ encaisser ]','delivered','encaisse','collected','recouvert'].includes(s))return 'delivered';
 if(['retourne','retour stock','retour confirme','returnconfirmed','returned','reinjecte stock','recupere par fournisseur'].includes(s))return 'returned';
 if(['retour','en retour','inreturn','returning','retour livreur','retour navette','retour de dispatche'].includes(s))return 'returning';
 if(['annule','cancelled','annuler par le client','sd annuler par le client','sd annuler 3x'].includes(s))return 'cancelled';
 if(['echec livraison','faileddelivery','delivery failed','orderrefused','commande annulee','refuse','non livre','reporte','a relance','absent'].includes(s)||s.includes('appel sans reponse'))return 'failed_delivery';
 if(['sortie en livraison','outfordelivery','en livraison','in delivery','indelivery','en cours de livraison'].includes(s))return 'out_for_delivery';
 if(['disponible bureau','readyforpickup','en attente client','waitingclient','au bureau'].includes(s))return 'ready_for_pickup';
 if(['pret a expedier','readytodispatch','ramasse','collecte'].includes(s))return 'submitted';
 if(['confirme au bureau','confirmedatbranch','dispatch','dispatched','dispatcher','vers wilaya','interwilayatransit','en transit'].includes(s))return 'in_transit';
 if(['perdu','endommage','en attente echange','remboursement'].includes(s))return 'exception';
 if(['commande recue','orderreceived','en traitement','inprocessing','commande confirmee','orderconfirmed','en preparation','inpreparation'].includes(s))return 'submitted';
 return 'unknown';
}
export function legacyParcel(order,code){
 const wilaya=Number(code);
 if(!Number.isInteger(wilaya)||wilaya<1||wilaya>69)throw Error('WILAYA_CODE_REQUIRED');
 if(order.delivery_type==='desk'&&order.address.length<3)throw Error('ADDRESS_REQUIRED');
 return {Colis:[{Tracking:order.reference,TypeLivraison:order.delivery_type==='desk'?1:0,TypeColis:0,Confrimee:1,
  Client:order.customer_name,MobileA:order.phone,Adresse:order.address,IDWilaya:String(wilaya).padStart(2,'0'),
  Commune:order.commune,Total:String(order.total),TProduit:order.items.map(i=>`${i.quantity} × ${i.name}`).join(' ; ').slice(0,250),
  id_Externe:order.reference,Source:'WeConvert'}]};
}
export function newParcel(order,cityId,districtId,stateId){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!uuid.test(cityId||'')||!uuid.test(districtId||''))throw Error('TERRITORY_REQUIRED');
 if(!uuid.test(order.source_hub_id||''))throw Error('HUB_REQUIRED');
 if(!uuid.test(stateId||''))throw Error('READY_STATE_REQUIRED');
 if(order.delivery_type==='desk')throw Error('PICKUP_UNAVAILABLE');
 return {hubId:order.source_hub_id,customer:{customerId:crypto.randomUUID(),name:order.customer_name,
  phone:{number1:order.phone,number2:null}},deliveryAddress:{cityTerritoryId:cityId,districtTerritoryId:districtId,street:order.address},
  orderedProducts:[{productName:order.items.map(i=>`${i.quantity} × ${i.name}`).join(' ; ').slice(0,250),unitPrice:Number(order.total),quantity:1,stockType:'none'}],
  deliveryType:'home',description:order.items.map(i=>`${i.quantity} × ${i.name}`).join(' ; ').slice(0,250),
  amount:Number(order.total),externalId:order.reference,stateId};
}
export function matchTerritory(name,items){
 const s=ascii(name).replace(/^\d{1,2}\s*[-–.]?\s*/,'').replace(/[^a-z0-9\u0621-\u064a]/g,'');
 return items.find(x=>ascii(x.name).replace(/[^a-z0-9\u0621-\u064a]/g,'')===s)?.id||'';
}
// Supplier responses can be sparse in search results; never infer delivery from Woo status.
export function parcelFacts(raw){
 const p=raw?.parcel??raw??{};
 const state=typeof p.state==='string'?p.state:(p.state?.name??p.stateName??'');
 return {
  remote_id:String(p.id??''),external_id:String(p.externalId??'').trim(),
  tracking:String(p.trackingNumber??p.tracking??p.id??''),
  phone:String(p.customer?.phone?.number1??p.customer?.phone?.number??p.customerPhone??''),
  amount:p.amount===null||p.amount===undefined?NaN:Number(p.amount),
  raw_status:String(state),
  state:zrState(state),
  created_at:p.createdAt??null,
  updated_at:p.lastStateUpdateAt??p.updatedAt??null
 };
}
