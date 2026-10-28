/* Read-only CRM cohort reports, using the approved dashboard components. */
const reportDate=iso=>new Date(iso+'T12:00:00').toLocaleDateString('fr-DZ',{day:'numeric',month:'short'});
const reportSelection=()=>S.reportPreset==='custom'&&S.reportFrom&&S.reportTo
 ?{from:S.reportFrom,to:S.reportTo}:reportRange(S.reportPreset||'30');
const reportRows=(headers,rows,caption)=>rows.length?table(headers,rows):empty('Aucune donnée pour ce filtre',caption);

function reportKpi(label,value,ic,color,foot,action=''){
 const tag=action?'button':'div';
 return `<${tag} ${action?`type="button" data-action="${action}"`:''} class="card kpi report-kpi ${action?'report-kpi-action':''}" style="${tone(color)}"><span class="kpi-top"><span class="icon">${icon(ic)}</span><span>${label}</span>${action?icon('arrow','arrow'):''}</span><span class="wc-kpi-bottom"><span class="wc-kpi-copy"><span class="kpi-value">${value}</span><span class="kpi-foot">${foot}</span></span></span></${tag}>`;
}
function deliveryPeriodSection(){
 if(!manager())return '';
 const result=S.deliveredPeriod||{orders:[],total:0},rows=(result.orders||[]).map(o=>`<tr><td><button class="order-id" data-open-order="${esc(o.order_id)}">#WC${String(o.number).padStart(5,'0')}</button>${o.woo_number?`<small class="muted zr-sub">Woo #${esc(o.woo_number)}</small>`:''}</td><td>${esc(o.customer_name)}<small class="muted zr-sub">${esc(o.wilaya)}</small></td><td>${esc(CHANNELS[o.channel]||o.channel)}</td><td>${esc(new Date(o.created_at).toLocaleString('fr-FR',{timeZone:'Africa/Algiers',dateStyle:'medium',timeStyle:'short'}))}</td><td class="mono">${money(o.cod_amount)}</td><td>${zrBadge(o.state)}</td></tr>`);
 const total=Number(result.total)||0,last=Math.max(1,Math.ceil(total/20));
 return `<section class="card delivered-period" id="delivered-period" aria-labelledby="delivered-period-title"><div class="card-head"><div><h2 id="delivered-period-title" tabindex="-1">Commandes de la période livrées</h2><p>${f(total)} commande${total>1?'s':''} créée${total>1?'s':''} pendant la période · statut ZR actuel « Livré »</p></div></div>${rows.length?table(['Commande','Client','Canal','Commande créée le','COD demandé','Statut ZR'],rows):empty('Aucune commande de la période livrée','Essayez une autre plage de dates ou un autre canal.')}<div class="table-foot"><span>${f(total)} résultat${total>1?'s':''} · ${total?(S.deliveredPage-1)*20+1:0}–${Math.min(S.deliveredPage*20,total)}</span><div class="pagination"><button data-delivered-page="${S.deliveredPage-1}" ${S.deliveredPage===1?'disabled':''} aria-label="Page précédente des livraisons">${icon('chevron')}</button><span>Page ${S.deliveredPage} / ${last}</span><button data-delivered-page="${S.deliveredPage+1}" ${S.deliveredPage>=last?'disabled':''} aria-label="Page suivante des livraisons">${icon('chevron')}</button></div></div></section>`;
}
function reportChart(days){
 const buckets=reportBuckets(days),max=Math.max(1,...buckets.map(x=>x.orders));
 if(!buckets.some(x=>x.orders))return empty('Aucune commande sur cette période','Essayez une autre plage de dates ou un autre canal.');
 const step=buckets.length>20?5:buckets.length>12?2:1;
 return `<div class="report-chart-scroll" role="region" aria-label="Évolution des commandes ; défilement horizontal si nécessaire" tabindex="0"><div class="report-chart" style="--report-columns:${buckets.length}">${buckets.map((b,i)=>{
  const label=b.from===b.to?reportDate(b.from):reportDate(b.from)+' – '+reportDate(b.to);
  const tip=`${label} : ${f(b.orders)} reçues, ${f(b.confirmed)} confirmées, ${f(b.cancelled)} annulées`;
  return `<div class="report-bar-group" role="img" tabindex="0" aria-label="${esc(tip)}" data-tip="${esc(tip)}"><div class="report-bar-pair" aria-hidden="true"><i class="report-bar received" style="height:${b.orders?Math.max(2,Math.round(100*b.orders/max)):0}%"></i><i class="report-bar confirmed" style="height:${b.confirmed?Math.max(2,Math.round(100*b.confirmed/max)):0}%"></i></div><small>${i%step===0||i===buckets.length-1?esc(reportDate(b.from)):'&nbsp;'}</small></div>`;
 }).join('')}</div></div><details class="report-values"><summary>Voir les valeurs détaillées du graphique</summary>${table(['Période','Reçues','Confirmées','Annulées'],buckets.map(b=>`<tr><td>${esc(b.from===b.to?reportDate(b.from):reportDate(b.from)+' – '+reportDate(b.to))}</td><td>${f(b.orders)}</td><td>${f(b.confirmed)}</td><td>${f(b.cancelled)}</td></tr>`))}</details>`;
}
function reportStatus(summary){
 const items=[['Confirmées',summary.confirmed,'green'],['À traiter',summary.pending,'orange'],['Annulées',summary.cancelled,'red'],['Doublons',summary.duplicate,'gray'],['Faux numéros',summary.fake,'gray']];
 return `<div class="report-status-list">${items.map(([label,count,color])=>`<div class="progress-row" style="${tone(color)}"><div class="between"><b>${label}</b><span>${f(count)} · ${reportRate(count,summary.orders)}</span></div><div class="bar-track"><i style="width:${summary.orders?Math.min(100,100*Number(count)/Number(summary.orders)):0}%"></i></div></div>`).join('')}</div>`;
}
function performancePage(){
 const r=S.reportData,period=reportSelection();
 const presets=[['7','7 jours'],['30','30 jours'],['90','90 jours'],['365','12 mois']];
 const filters=`<section class="card pad report-filters"><div class="between wrap"><div><h2>Filtres du rapport</h2><p>Période selon la création des commandes · états CRM et ZR actuels · heure d’Alger.</p></div><div class="report-presets" role="group" aria-label="Périodes rapides">${presets.map(([id,label])=>`<button type="button" class="btn sm ${S.reportPreset===id?'report-preset-active':''}" data-report-preset="${id}" aria-pressed="${S.reportPreset===id}">${label}</button>`).join('')}</div></div><form data-form="performance" class="report-filter-form mt"><div class="report-filter-fields">${field('Du','from',period.from,'date',true,`min="2000-01-01" max="${algerToday()}"`)}${field('Au (inclus)','to',period.to,'date',true,`min="2000-01-01" max="${algerToday()}"`)}${selectField('Canal','channel',[['','Tous les canaux'],...Object.entries(CHANNELS)],S.reportChannel||'')}${manager()?selectField('Agent','agent',[['','Tous les agents'],...S.members.map(m=>[m.user_id,m.display_name+(m.active?'':' · inactif')])],S.reportAgent||''):''}</div><div class="flex wrap mt"><button class="btn primary" type="submit">${icon('filter')}Appliquer les filtres</button><span class="crm-caption">Jusqu’à 366 jours par rapport · données de la boutique sélectionnée.</span></div><div class="form-error" role="alert"></div></form></section>`;
 const title=header('Performance & rapports.','L’activité réelle de vos commandes COD, de la réception à la livraison.',r?btn('Exporter le rapport CSV','reportExport','download'):'');
 if(!r)return title+filters+empty('Rapport indisponible','Actualisez la page pour recharger les indicateurs.');
 const s=r.summary||{},label=`${reportDate(r.period.from)} – ${reportDate(r.period.to)}`;
 const delivered=manager()?reportKpi('Commandes livrées',f(S.deliveredPeriod?.total),'truck','blue','Créées du '+esc(label)+' · statut ZR actuel · voir la liste','showDeliveredPeriod'):'';
 const kpis=`<div class="kpis report-kpis ${manager()?'kpis-four':''}">${reportKpi('Commandes reçues',f(s.orders),'bag','purple','Créées du '+esc(label))}${reportKpi('Taux de confirmation',reportRate(s.confirmed,s.orders),'checkcircle','green',f(s.confirmed)+' confirmées sur '+f(s.orders)+' reçues')}${reportKpi('Montant COD confirmé',money(s.confirmed_amount),'coins','orange','Promis à la livraison · non encaissé')}${delivered}</div>`;
 const legacy=(Number(s.woo_confirmation_unverified)||0)+(Number(s.woo_cancellation_unverified)||0);
 const confirmation=legacy>0?`<div class="notice mb" role="status">${icon('info')}${f(legacy)} commandes historiques portent un statut « confirmé » ou « annulé » issu de WooCommerce sans décision COD vérifiée. Elles restent consultables, mais sont exclues des confirmations, annulations et montants de ce rapport. Une intégration avec le SaaS de confirmation d’origine sera nécessaire pour les rapprocher.</div>`:'';
 const tracking=Number(s.woo_orders)>0?`<div class="notice mb" role="status">${icon('info')}Suivi WooCommerce : ${f(s.woo_purchase_marked)} sur ${f(s.woo_orders)} commandes de la période ont un Purchase CAPI marqué envoyé par la Suite WeConvert. ${f(s.woo_unverified)} restent sans preuve et sont incluses dans ces chiffres opérationnels ; elles ne doivent pas être comparées directement aux achats Meta. Les nouvelles commandes WooCommerce sont reçues par webhook signé.</div>`:'';
 const analysis=`<div class="overview-row report-analysis"><section class="card report-chart-card"><div class="card-head"><div><h2>Évolution des commandes</h2><p>Jour de création · statut actuel de chaque commande</p></div><span class="pill">${esc(label)}</span></div><div class="report-chart-legend"><span><i class="received"></i>Reçues</span><span><i class="confirmed"></i>Confirmées</span></div>${reportChart(r.days||[])}</section><section class="card pad"><h2>Répartition des statuts</h2><p>Sur ${f(s.orders)} commandes créées dans la période</p>${reportStatus(s)}<p class="crm-caption mt">Les confirmations et annulations historiques déduites de WooCommerce sont exclues. Les statuts affichés sont ceux d’aujourd’hui ; confirmé ne signifie pas livré.</p></section></div>`;
 const channels=reportRows(['Canal','Reçues','Confirmées','Taux','Montant COD confirmé'],(r.channels||[]).map(x=>`<tr><td><b>${esc(CHANNELS[x.channel]||x.channel)}</b></td><td>${f(x.orders)}</td><td>${f(x.confirmed)}</td><td>${reportRate(x.confirmed,x.orders)}</td><td class="mono">${money(x.confirmed_amount)}</td></tr>`),'Les commandes par message apparaîtront selon leur canal de saisie.');
 const wilayas=reportRows(['Wilaya','Reçues','Confirmées','Taux'],(r.wilayas||[]).map(x=>`<tr><td><b>${esc(x.wilaya)}</b></td><td>${f(x.orders)}</td><td>${f(x.confirmed)}</td><td>${reportRate(x.confirmed,x.orders)}</td></tr>`),'Aucune wilaya dans cette sélection.');
 const products=reportRows(['Produit','Unités commandées','Unités confirmées','Lignes confirmées'],(r.products||[]).map(x=>`<tr><td><b>${esc(x.name)}</b><small class="muted report-sku">${esc(x.sku)}</small></td><td>${f(x.units)}</td><td>${f(x.confirmed_units)}</td><td class="mono">${money(x.confirmed_lines_amount)}</td></tr>`),'Aucun produit dans cette sélection.');
 const agents=reportRows(['Agent actuel','Commandes','Confirmées','Taux','Montant COD confirmé'],(r.agents||[]).map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${f(x.orders)}</td><td>${f(x.confirmed)}</td><td>${reportRate(x.confirmed,x.orders)}</td><td class="mono">${money(x.confirmed_amount)}</td></tr>`),'Aucune attribution dans cette sélection.');
 const breakdowns=`<div class="report-breakdowns"><div class="grid2"><section class="card"><div class="card-head"><div><h2>Par canal</h2><p>Site web, WhatsApp, Messenger, Instagram, téléphone et saisie manuelle</p></div></div>${channels}</section><section class="card"><div class="card-head"><div><h2>Par wilaya</h2><p>Les 10 premières selon les commandes reçues</p></div></div>${wilayas}</section></div><div class="grid2 mt"><section class="card"><div class="card-head"><div><h2>Par produit</h2><p>Articles des commandes, variantes comprises</p></div></div>${products}<p class="crm-caption report-table-note">Le montant des lignes confirmées exclut les frais de livraison et les ajustements de la commande.</p></section><section class="card"><div class="card-head"><div><h2>Par agent</h2><p>Affectation actuelle, commandes non attribuées incluses</p></div></div>${agents}</section></div><div class="notice mt">${icon('info')}Le taux de confirmation = commandes confirmées dans le CRM et vérifiables ÷ commandes créées dans la période. Les anciens statuts déduits de WooCommerce sont exclus. Le montant COD confirmé n’est pas encaissé. « Livrées » compte ces mêmes commandes actuellement au statut livré chez ZR ; leur date réelle de livraison n’est pas connue pour les colis historiques.</div></div>`;
 return title+filters+kpis+confirmation+tracking+deliveryPeriodSection()+analysis+breakdowns+deliverySection();
}

function applyPerformanceFilters(d){
 const from=String(d.from||''),to=String(d.to||''),today=algerToday();
 const fromTime=Date.parse(from+'T00:00:00Z'),toTime=Date.parse(to+'T00:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)
    ||!Number.isFinite(fromTime)||!Number.isFinite(toTime)
    ||new Date(fromTime).toISOString().slice(0,10)!==from||new Date(toTime).toISOString().slice(0,10)!==to
    ||from<'2000-01-01'||to>today||from>to||(toTime-fromTime)/86400000>365)throw Error('INVALID_FILTER');
 if(d.channel&&!Object.hasOwn(CHANNELS,d.channel))throw Error('INVALID_FILTER');
 if(d.agent&&(!manager()||!S.members.some(m=>m.user_id===d.agent)))throw Error('INVALID_FILTER');
 S.reportFrom=from;S.reportTo=to;S.reportPreset='custom';S.reportChannel=d.channel||'';S.reportAgent=manager()?d.agent||'':'';S.deliveredPage=1;
 return refresh();
}

function exportPerformance(){
 const r=S.reportData;if(!r)return;
 const s=r.summary,sections=[
  [['WeConvert · Performance & rapports'],['Boutique',storeName()],['Du',r.period.from],['Au',r.period.to],['Fuseau horaire','Africa/Algiers'],['Filtre canal',S.reportChannel?CHANNELS[S.reportChannel]:'Tous'],['Filtre agent',S.reportAgent?memberName(S.reportAgent):manager()?'Tous':'Mes commandes'],[]],
  [['Indicateurs','Valeur'],['Commandes reçues',s.orders],['Confirmées',s.confirmed],['À traiter',s.pending],['Annulées',s.cancelled],['Doublons',s.duplicate],['Faux numéros',s.fake],['Taux de confirmation',reportRate(s.confirmed,s.orders)],['Montant COD confirmé (DA)',s.confirmed_amount],['WooCommerce dans le rapport opérationnel',s.woo_orders],['WooCommerce avec Purchase CAPI marqué envoyé',s.woo_purchase_marked],['WooCommerce sans preuve de suivi',s.woo_unverified],['Confirmations Woo historiques non vérifiées',s.woo_confirmation_unverified],['Annulations Woo historiques non vérifiées',s.woo_cancellation_unverified],...(manager()?[['Commandes créées dans la période et actuellement livrées (ZR)',S.deliveredPeriod?.total??0]]:[]),[]],
  [['Évolution','Reçues','Confirmées','Annulées'],...(r.days||[]).map(x=>[x.date,x.orders,x.confirmed,x.cancelled]),[]],
  [['Canal','Reçues','Confirmées','Annulées','Montant COD confirmé (DA)'],...(r.channels||[]).map(x=>[CHANNELS[x.channel]||x.channel,x.orders,x.confirmed,x.cancelled,x.confirmed_amount]),[]],
  [['Wilaya','Reçues','Confirmées','Montant COD confirmé (DA)'],...(r.wilayas||[]).map(x=>[x.wilaya,x.orders,x.confirmed,x.confirmed_amount]),[]],
  [['Produit','SKU','Unités','Unités confirmées','Montant des lignes confirmées (DA)'],...(r.products||[]).map(x=>[x.name,x.sku,x.units,x.confirmed_units,x.confirmed_lines_amount]),[]],
  [['Agent actuel','Reçues','Confirmées','Annulées','Montant COD confirmé (DA)'],...(r.agents||[]).map(x=>[x.name,x.orders,x.confirmed,x.cancelled,x.confirmed_amount])]
 ];
 const csv='\ufeff'+sections.flat().map(row=>row.map(csvCell).join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=`WeConvert-performance-${r.period.from}-${r.period.to}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 toast('Rapport CSV exporté pour la période sélectionnée.');
}
