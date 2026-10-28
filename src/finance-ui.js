/* Verified delivery outcomes and explicitly entered COD costs. */
function deliverySection(){
 if(!manager())return '';
 if(S.reportAgent)return `<section class="card pad mt"><h2>Livraison & marge COD</h2><p class="mt">Ce rapport de livraison est calculé pour toute la boutique. Choisissez « Tous les agents » pour voir des chiffres cohérents avec les filtres.</p></section>`;
 const d=S.deliveryReport?.summary||{};
 const missing=Number(d.missing_product_cost||0)+Number(d.missing_shipping_cost||0);
 const contribution=d.contribution===null||d.contribution===undefined?'—':money(d.contribution);
 const after=S.reportChannel||d.after_recorded_expenses===null||d.after_recorded_expenses===undefined?'—':money(d.after_recorded_expenses);
 const rows=(S.deliveryReport?.channels||[]).map(x=>`<tr><td><b>${esc(CHANNELS[x.channel]||x.channel)}</b></td><td>${f(x.orders)}</td><td>${f(x.shipped)}</td><td>${f(x.delivered)}</td><td>${f(x.returned)}</td><td class="mono">${money(x.delivered_cod)}</td></tr>`);
 const expenses=(S.expenses||[]).map(x=>`<tr><td>${esc(x.spent_on)}</td><td>${x.kind==='ads'?'Publicité':'Exploitation'}</td><td>${esc(x.note||'—')}</td><td class="mono">${money(x.amount)}</td><td><button class="btn sm" data-expense-delete="${esc(x.id)}" aria-label="Supprimer cette dépense">Supprimer</button></td></tr>`);
 return `<div class="delivery-report mt">
 <section class="card pad"><div class="between wrap"><div><h2>Livraison & marge COD</h2><p>Commandes créées pendant la période sélectionnée · état ZR au dernier suivi</p></div><div class="flex wrap"><span class="pill">ZR Express</span>${btn('Voir les commandes livrées','showDeliveredPeriod','arrow')}</div></div>
 <div class="kpis report-kpis mt">
 ${reportKpi('Livrées · cohorte créée',f(d.delivered),'truck','green',f(d.shipped)+' remis à ZR · '+reportRate(d.delivered,d.closed)+' livrés sur colis terminés')}
 ${reportKpi('Retours ZR',f(d.returned),'return','red',reportRate(d.returned,d.closed)+' des colis terminés (livrés + retournés)')}
 ${reportKpi('COD livré',money(d.delivered_cod),'coins','blue','COD demandé · reversement non vérifié')}
 </div>
 <div class="grid2 mt"><div class="stat-box"><p>Marge après produits et frais ZR</p><strong>${contribution}</strong><p>COD livré − coûts d’achat estimés des produits livrés − frais ZR de tous les colis rattachés. ${missing?'Calcul bloqué : '+f(d.missing_product_cost)+' colis livrés sans coût d’achat et '+f(d.missing_shipping_cost)+' colis sans frais ZR.':'Coûts renseignés sur les colis concernés.'}</p></div>
 <div class="stat-box"><p>Résultat après dépenses saisies</p><strong>${after}</strong><p>${S.reportChannel?'Les dépenses de la boutique ne sont pas réparties par canal. Affichez « Tous les canaux » pour ce résultat.':`Publicité saisie : ${money(d.ads_recorded)} · exploitation saisie : ${money(d.operations_recorded)}. Les dépenses absentes ne valent pas zéro : ce résultat n’est pas un bénéfice net comptable.`}</p></div></div>
 <div class="notice mt">${icon('info')}Les commandes WooCommerce sont identifiées dans le même rapport : ${f(d.woo_delivered)} livrées sur ${f(d.woo_orders)} commandes Woo de la période. ${f(d.delivery_issues)} colis sont en retour ou en échec. Le statut ZR « Livré » ne prouve pas le reversement.</div></section>
 <div class="grid2 mt"><section class="card"><div class="card-head"><div><h2>Livraison par canal</h2><p>La période suit la création des commandes, pas la date de livraison.</p></div></div>${reportRows(['Canal','Reçues','Expédiées','Livrées','Retournées','COD livré'],rows,'Aucun colis rattaché pour ce filtre.')}</section>
 <section class="card pad"><h2>Ajouter une dépense</h2><p>Renseignez les dépenses réelles de publicité et d’exploitation pour compléter la marge.</p>
 <form data-form="costExpense" class="mt"><div class="form-grid">${field('Date','spent_on',algerToday(),'date',true,`max="${algerToday()}"`)}${selectField('Type','kind',[['ads','Publicité'],['operations','Exploitation']],'ads',true)}${field('Montant (DA)','amount','','number',true,'min="0" step="0.01"')}${field('Description','note','','text',false,'maxlength="160"')}</div><div class="form-error" role="alert"></div><button class="btn primary mt" type="submit">${icon('plus')}Enregistrer la dépense</button></form></section></div>
 <section class="card mt"><div class="card-head"><div><h2>Dépenses enregistrées</h2><p>${f((S.expenses||[]).length)} affichées pour la période · maximum 100 lignes${S.reportChannel?' · tous les canaux de la boutique':''}</p></div></div>${expenses.length?table(['Date','Type','Description','Montant','Action'],expenses):empty('Aucune dépense saisie','Le résultat après dépenses reste partiel tant que les frais ne sont pas saisis.')}</section>
 </div>`;
}
function productCostForm(id){
 const p=S.products.find(x=>x.id===id),v=S.productCosts.find(x=>x.product_id===id);
 if(!p)return;
 modal('Coût d’achat · '+esc(p.name),`<p>Coût unitaire en DA. Pour les anciennes commandes Woo, le rapport utilise ce coût actuel comme estimation, sans reconstruire le prix payé à l’époque.</p><form data-form="costProduct" data-id="${esc(id)}" class="mt">${field('Coût d’achat unitaire (DA)','unit_cost',v?.unit_cost??'','number',true,'min="0" step="0.01"')}<div class="form-error" role="alert"></div></form>`,btn('Annuler','close')+'<button class="btn primary" form="product-cost-form" type="submit">Enregistrer</button>');
 const form=$('#modal-root form[data-form="costProduct"]');form.id='product-cost-form';
}
function shipmentCostForm(id){
 const s=(S.shipping?.shipments||[]).find(x=>x.id===id),v=S.shipmentCosts.find(x=>x.shipment_id===id);
 if(!s)return;
 modal('Frais ZR · #WC'+String(s.number).padStart(5,'0'),`<p>Reportez les frais réellement facturés par ZR : livraison, éventuel retour et autre frais. Mettez 0 quand un frais est confirmé gratuit.</p><form id="shipment-cost-form" data-form="costShipment" data-id="${esc(id)}" class="mt"><div class="form-grid">${field('Frais de livraison (DA)','delivery_cost',v?.delivery_cost??'','number',true,'min="0" step="0.01"')}${field('Frais de retour (DA)','return_cost',v?.return_cost??0,'number',true,'min="0" step="0.01"')}${field('Autres frais (DA)','other_cost',v?.other_cost??0,'number',true,'min="0" step="0.01"')}</div><div class="form-error" role="alert"></div></form>`,btn('Annuler','close')+'<button class="btn primary" form="shipment-cost-form" type="submit">Enregistrer</button>');
}
function expenseDeleteForm(id){
 const x=(S.expenses||[]).find(e=>e.id===id);if(!x)return;
 modal('Supprimer cette dépense ?',`<p>La dépense du ${esc(x.spent_on)} de <b>${money(x.amount)}</b> sera retirée des calculs. Cette action est définitive.</p><form id="expense-delete-form" data-form="costExpenseDelete" data-id="${esc(id)}"><div class="form-error" role="alert"></div></form>`,btn('Annuler','close')+'<button class="btn primary" type="submit" form="expense-delete-form">Supprimer</button>');
}
async function submitCost(type,d,form){
 const action=type==='costProduct'?'product':type==='costShipment'?'shipment':type==='costExpenseDelete'?'delete_expense':'expense';
 const payload=type==='costProduct'?{product_id:form.dataset.id,unit_cost:Number(d.unit_cost)}:
  type==='costShipment'?{shipment_id:form.dataset.id,delivery_cost:Number(d.delivery_cost),return_cost:Number(d.return_cost),other_cost:Number(d.other_cost)}:
  type==='costExpenseDelete'?{id:form.dataset.id}:
  {...d,amount:Number(d.amount),request_id:form.dataset.request||(form.dataset.request=requestId())};
 await rpc('crm_cost_command',{p_store:S.store,p_action:action,p:payload});
 closeModal();toast(action==='delete_expense'?'Dépense supprimée.':'Coût enregistré.');await refresh();
}
