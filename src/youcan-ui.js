/* YouCan channels use the existing CRM shell, cards, form controls and themes. */
const YOUCAN_LABELS={
 APP_NOT_CONFIGURED:'Le canal est enregistré. WeConvert doit encore configurer son application YouCan avant de pouvoir lancer l’autorisation.',
 INVALID_CHANNEL_NAME:'Donnez un nom de canal de 2 à 100 caractères.',
 INVALID_STORE_URL:'Saisissez l’URL HTTPS de la boutique, sans chemin ni paramètres.',
 SHOP_URL_MISMATCH:'La boutique autorisée sur YouCan ne correspond pas à l’URL du canal. Vérifiez l’URL ou choisissez la bonne boutique lors de l’autorisation.',
 AUTH_IN_PROGRESS:'Une autorisation est déjà en cours pour ce canal. Attendez son retour avant de modifier l’URL.',
 INVALID_COD_METHODS:'Séparez les noms supplémentaires des moyens COD par des virgules.',
 SHOP_LOCKED:'Cette boutique CRM est déjà liée à une autre boutique YouCan. Ajoutez une boutique CRM distincte pour changer de boutique.',
 FORBIDDEN:'Seuls le propriétaire et les administrateurs peuvent gérer cette connexion.',
 AUTH_REQUIRED:'Votre session a expiré. Reconnectez-vous.',
 INVALID_STATE:'Le lien YouCan a expiré. Relancez l’autorisation.',
 YOUCAN_AUTH:'YouCan a refusé l’autorisation ou le jeton a expiré.',
 YOUCAN_UNREACHABLE:'L’API YouCan est momentanément indisponible.',
 HOOK_SUBSCRIBE_FAILED:'L’autorisation a réussi, mais les webhooks ne sont pas tous installés. Réactivez-les.',
 INTEGRATION_ERROR:'La connexion YouCan a échoué. Réessayez.',
 NON_COD:'Paiement hors COD : commande ignorée.',CURRENCY_UNSUPPORTED:'Devise différente du DZD : commande ignorée.',
 REFUND_REVIEW:'Remboursement YouCan : montant à vérifier.',CUSTOMER_REQUIRED:'Nom client absent sur YouCan.',
 INVALID_PHONE:'Téléphone absent ou invalide.',WILAYA_REQUIRED:'Wilaya absente sur YouCan.',
 INVALID_ITEMS:'Articles non exploitables sur la commande.',INVALID_AMOUNT:'Montant COD incohérent : vérification requise.',
 ORDER_PREDATES_CONNECTION:'Commande créée avant la connexion : aucun import historique.',
 OAUTH_APPROVED:'Autorisation YouCan reçue ; premier webhook en attente.',RECEIVED:'Nouvelle commande COD reçue.',
 UPDATED:'Informations source actualisées.',ATTENTION:'La fiche CRM est préservée : vérifiez la modification YouCan.',
 YOUCAN_UNINSTALLED:'Application désinstallée sur YouCan.',
 NOT_FOUND:'Cette commande YouCan ne peut plus être réessayée depuis ce canal.'
};
async function youcanApi(action,body={}){
 const {data,error}=await supabase.functions.invoke('weconvert-youcan',{body:{action,...body}});
 if(error){let code;try{code=(await error.context.json()).error;}catch{}throw Object.assign(Error(code||'INTEGRATION_ERROR'),{youcanCode:code||'INTEGRATION_ERROR'});}
 if(data?.error)throw Object.assign(Error(data.error),{youcanCode:data.error});return data;
}
function youcanCard(){
 const c=S.youcan,logs=(S.sourceEvents||[]).filter(e=>e.connection_id===c?.id);
 const states={active:['Réception vérifiée','green'],awaiting_webhook:['Autorisation accordée · webhook en attente','orange'],pending:['Canal créé · autorisation à faire','orange'],error:['Connexion à vérifier','red'],disconnected:['Déconnectée','gray']};
 const [label,color]=c?states[c.status]||['À vérifier','orange']:['À connecter','gray'];
 return `<section class="card pad mt">
  <div class="between wrap"><div class="flex"><span class="store-icon">${icon('store')}</span><div><h2>YouCan${c?.channel_name?' · '+esc(c.channel_name):''}</h2><p>${c?.public_url?esc(c.public_url):'Nouvelles commandes COD → WeConvert'}</p></div></div>${badge(label,color)}</div>
  <p class="mt">Créez un canal avec le nom et l’URL de votre boutique, puis autorisez WeConvert sur YouCan. Les nouvelles commandes COD en DZD rejoignent la file de confirmation. Les statuts YouCan restent des informations source et aucun historique n’est importé automatiquement.</p>
  ${tab==='youcan-error'?`<div class="notice mt" role="alert">${icon('info')}L’autorisation YouCan n’a pas abouti. Vérifiez la boutique choisie et le dernier problème ci-dessous.</div>`:''}
  ${c?.last_error?`<div class="notice mt" role="alert">${icon('info')}${esc(YOUCAN_LABELS[c.last_error]||c.last_error)}</div>`:''}
  ${c?`<div class="woo-facts mt"><div><small>Boutique YouCan vérifiée</small><b>${esc(c.verified_domain||'Autorisation en attente')}</b></div><div><small>Autorisation</small><b>${esc(time(c.connected_at))}</b></div><div><small>Dernière commande traitée</small><b>${c.last_webhook_at?esc(time(c.last_webhook_at)):'En attente de réception'}</b></div></div>`:''}
  <div class="flex wrap mt">${!c?btn('Nouveau canal YouCan','youcanConnect','plus','primary'):btn('Modifier le canal','youcanConnect','settings')}${c?btn(c.connected_at?'Renouveler l’autorisation':'Autoriser sur YouCan','youcanAuthorize','link',c.connected_at?'':'primary'):''}${c?.connected_at&&c.status!=='disconnected'?btn('Réactiver les webhooks','youcanRepair','refresh'):''}${c&&c.status!=='disconnected'?btn('Déconnecter','youcanDisconnect','logout'):''}</div>
  ${c&&!c.connected_at?`<div class="notice mt">${icon('info')}Le canal est enregistré. L’autorisation associera la boutique choisie sur YouCan à cette URL ; la réception ne sera vérifiée qu’après une nouvelle commande COD de test.</div>`:''}
 </section><section class="card mt"><div class="card-head"><div><h2>Journal YouCan</h2><p>Les 30 derniers événements de cette connexion</p></div>${btn('Actualiser','refresh','refresh','sm')}</div>
 ${logs.length?table(['Date','Référence','Résultat','Détail','Action'],logs.map(e=>`<tr><td class="muted">${esc(time(e.created_at))}</td><td>${esc(e.external_id||'—')}</td><td>${badge(e.outcome==='received'?'Reçue':e.outcome==='attention'?'À vérifier':e.outcome==='skipped'?'Ignorée':e.outcome==='error'?'Erreur':e.outcome==='updated'?'Mise à jour':e.outcome==='connected'?'Autorisée':e.outcome==='disconnected'?'Déconnectée':esc(e.outcome),e.outcome==='error'?'red':e.outcome==='attention'?'orange':e.outcome==='received'?'green':'gray')}</td><td>${esc(YOUCAN_LABELS[e.code]||e.code)}</td><td>${e.order_id?`<button class="btn sm" data-open-order="${e.order_id}">Voir la fiche</button>`:'—'}</td></tr>`)):empty('Aucun événement YouCan','Une commande COD reçue ou ignorée apparaîtra ici après l’activation.')}</section>`;
}
function youcanConnectForm(){
 const c=S.youcan;
 modal(c?'Modifier le canal YouCan':'Nouveau canal YouCan',`<p>Identifiez la boutique que vous souhaitez connecter. Vous autoriserez ensuite WeConvert dans votre compte YouCan.</p>
  <form id="youcan-connect" data-form="youcanConnect" class="mt" autocomplete="off">
   ${field('Nom du canal','channel_name',c?.channel_name||'','text',true,'placeholder="Ex. Ma boutique YouCan" maxlength="100"')}
   ${field('URL de la boutique','public_url',c?.public_url||'','url',true,`placeholder="https://maboutique.youcan.store" maxlength="255" ${c?.connected_at?'readonly':''}`)}
   ${c?.connected_at?'<p class="crm-caption">Cette URL est liée à la boutique autorisée. Pour connecter une autre boutique YouCan, créez une boutique CRM distincte.</p>':''}
   <details class="mt"><summary>Options avancées COD</summary>${field('Autres noms des moyens de paiement COD','cod_methods',(c?.cod_methods||[]).filter(x=>!['cash on delivery','cash on delivery (cod)','cod','cash_on_delivery'].includes(x)).join(', '),'text',false,'placeholder="Ex. Paiement à la livraison" maxlength="400"')}<p class="crm-caption">Les modes « Cash on Delivery » et « cod » sont déjà reconnus.</p></details>
   <div class="form-error" role="alert"></div>
  </form>`,btn('Annuler','close')+`<button class="btn primary" form="youcan-connect">${c?.connected_at?'Enregistrer':'Enregistrer et autoriser'}</button>`);
}
async function youcanSubmit(type,data){
 if(type==='youcanConnect'){
  const wasConnected=Boolean(S.youcan?.connected_at),saved=await youcanApi('save',{store_id:S.store,channel_name:data.channel_name,public_url:data.public_url,cod_methods:data.cod_methods});
  closeModal();await refresh();
  if(wasConnected){toast('Nom du canal YouCan mis à jour.');return;}
  try{const result=await youcanApi('authorize',{connection_id:saved.id});location.assign(result.authorize_url);}
  catch(e){toast(safeError(e),'info');}
 }
 if(type==='youcanDisconnect'){await youcanApi('disconnect',{connection_id:S.youcan.id});closeModal();toast('Connexion YouCan désactivée. Les commandes déjà reçues sont conservées.');await refresh();}
}
async function youcanAction(action){
 if(action==='youcanConnect')return youcanConnectForm();
 if(action==='youcanAuthorize'){const result=await youcanApi('authorize',{connection_id:S.youcan.id});location.assign(result.authorize_url);return;}
 if(action==='youcanDisconnect')return modal('Déconnecter YouCan',`<p>La réception des nouvelles commandes s’arrêtera. Les commandes et confirmations existantes restent dans WeConvert.</p><form id="youcan-disconnect" data-form="youcanDisconnect"><div class="form-error" role="alert"></div></form>`,btn('Annuler','close')+'<button class="btn primary" form="youcan-disconnect">Déconnecter</button>');
 if(action==='youcanRepair'){await youcanApi('repair',{connection_id:S.youcan.id});toast('Abonnements webhook YouCan réactivés. Passez une commande de test.');await refresh();}
}
function youcanSource(o){if(o.source_provider!=='youcan')return '';const s=o.source_snapshot||{};return `<section class="woo-source mt"><div class="between wrap"><b>YouCan #${esc(s.number||o.source_external_id)}</b>${badge(o.source_attention?'Modification à vérifier':'Source synchronisée',o.source_attention?'orange':'blue')}</div><p class="mt">État YouCan : ${esc(o.source_status||'Inconnu')} · ${esc(time(s.updated_at))}. Confirmation COD et livraison ZR restent indépendantes.</p><p class="crm-caption mt">Tracking publicitaire YouCan : aucune preuve WeConvert associée à cette commande.</p>${o.source_attention?`<p class="mt">La fiche CRM a été préservée. Vérifiez les nouvelles informations avant de la corriger.</p><dl class="woo-compare"><dt>Client</dt><dd>${esc(s.customer_name||'—')} · ${esc(s.phone||'—')}</dd><dt>Adresse</dt><dd>${esc([s.wilaya,s.commune,s.address].filter(Boolean).join(' · ')||'—')}</dd><dt>Montant source</dt><dd>${s.total!==undefined?money(s.total):'—'}</dd></dl>${manager()?`<button class="btn sm mt" data-source-ack="${esc(o.id)}" data-version="${esc(o.version)}">Marquer comme vérifié</button>`:''}`:''}</section>`;}
