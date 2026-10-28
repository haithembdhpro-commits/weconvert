/* CRM tranche 1: every business write goes through a transactional RPC. */
const supabase=createClient(CONFIG.url,CONFIG.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const statusDefs=STATUS,PRE=PENDING;
let route='dashboard',tab='',dialogReturn=null,searchTimer,loadSequence=0,authSequence=0;
const S={user:null,workspace:null,store:null,role:null,members:[],stores:[],workspaces:[],orders:[],products:[],overview:{},total:0,productTotal:0,page:1,q:'',status:'all',agent:'',ascending:false,queueId:null,detail:null,selected:new Set(),busy:false,loading:false,error:'',authMode:'login',authInfo:'',lastSync:null,reportData:null,deliveryReport:null,deliveredPeriod:null,dashboardDelivered:null,deliveredPage:1,expenses:[],productCosts:[],reportPreset:'30',reportFrom:null,reportTo:null,reportAgent:'',reportChannel:'',zr:null,shipping:null,shippingPage:1,shippingStatus:'all',shippingTotal:0,zrScanPage:1,shopify:null,youcan:null,youcanAlerts:[],sourceEvents:[]};
const requests=new Map(),productCache=new Map();
let liveState='connecting',lastLiveSignal=null;
const liveSync=createLiveSync({client:supabase,onSignal:signal=>{lastLiveSignal={...signal,receivedAt:performance.now()};},onState:state=>{liveState=state;updateLiveBadge();},onChange:async context=>{
 if(S.user?.id!==context.userId||S.workspace!==context.workspaceId||S.store!==context.storeId||document.visibilityState==='hidden')return;
 if(S.busy||S.loading)return false;
 if(await refresh({quiet:true,live:true})===false)throw Error('LIVE_REFRESH_FAILED');
}});
function watchLiveStore(){liveSync.watch(S.user&&S.workspace&&S.store?{userId:S.user.id,workspaceId:S.workspace,storeId:S.store}:null);}
function liveBadge(){const offline=navigator.onLine===false;const connected=!offline&&liveState==='connected';return `<i style="background:var(--${connected?'green':'orange'})"></i>${offline?'Hors ligne':connected?'En direct':liveState==='retrying'?'Reconnexion…':'Connexion…'}`;}
function updateLiveBadge(){const el=$('[data-live-connection]');if(el)el.innerHTML=liveBadge();}

const ACTIVE_PAGES=new Set(['dashboard','performance','orders','confirmation','shipping','products','team','settings','integrations']);
const roles={owner:'Propriétaire',admin:'Administrateur',agent:'Agent de confirmation'};
const time=at=>at?new Date(at).toLocaleString('fr-FR',{timeZone:'Africa/Algiers',dateStyle:'medium',timeStyle:'short'}):'—';
const initials=s=>esc(initialsOf(s));
const code=o=>'WC'+String(o.number).padStart(5,'0');
const manager=()=>['owner','admin'].includes(S.role);
const selfMember=()=>S.members.find(m=>m.user_id===S.user?.id);
const memberName=id=>S.members.find(m=>m.user_id===id)?.display_name||'Non attribué';
const storeName=()=>S.stores.find(s=>s.id===S.store)?.name||'Votre boutique';
function applyTheme(){let theme=null;try{theme=localStorage.getItem('wc-theme');}catch{}document.body.classList.toggle('dark',theme==='dark');}
function readRoute(){const [r,t]=location.hash.slice(1).split('/');route=TITLES[r]?r:'dashboard';tab=t||'';}
function navigate(r,t=''){const hash=r+(t?'/'+t:'');if(location.hash==='#'+hash){readRoute();refresh();}else location.hash=hash;$('#sidebar')?.classList.remove('open');$('[aria-controls=sidebar]')?.setAttribute('aria-expanded','false');}
function safeError(e){return e?.youcanCode?YOUCAN_LABELS[e.youcanCode]||e.youcanCode:e?.shopifyCode?SHOPIFY_LABELS[e.shopifyCode]||e.shopifyCode:e?.zrCode?zrLabel(e.zrCode):e?.wooCode?wooLabel(e.wooCode):ZR_LABELS[e?.message]?zrLabel(e.message):errorMessage(e);}
async function rpc(name,args){const {data,error}=await supabase.rpc(name,args);if(error)throw error;return data;}
async function query(builder){const {data,error,count}=await builder;if(error)throw error;return {data,count};}
async function command(action,payload){
 if(!S.workspace)throw Error('FORBIDDEN');
 const key=JSON.stringify([S.user.id,S.workspace,action,payload]);
 let id=requests.get(key);if(!id){id=requestId();requests.set(key,id);}
 const result=await rpc('crm_command',{p_workspace:S.workspace,p_action:action,p_payload:payload,p_request:id});
 requests.delete(key);return result;
}
function showError(e,form){const message=safeError(e);if(form){let box=form.querySelector('.form-error');if(!box){box=document.createElement('div');box.className='form-error';box.setAttribute('role','alert');form.append(box);}box.textContent=message;box.scrollIntoView({block:'nearest'});}else toast(message,'info');}
function loader(text='Chargement de vos données…'){return `<div class="crm-loader" role="status">${esc(text)}</div>`;}
function authView(){
 $('#app-root').hidden=true;$('#auth-root').hidden=false;applyTheme();
 const signup=S.authMode==='signup',reset=S.authMode==='reset',password=S.authMode==='password';
 const title=password?'Choisissez votre mot de passe.':signup?'Bienvenue dans WeConvert.':reset?'Retrouvez votre accès.':'Votre commerce, sous contrôle.';
 $('#auth-root').innerHTML=`<div class="auth-shell"><section class="card auth-card"><div class="brand"><span class="brandmark">${brandLogo()}</span><div><div class="brand-name">WeConvert</div><div class="brand-sub">COD WORKSPACE</div></div></div><h1>${title}</h1><p class="mt">${signup?'Créez votre compte, puis votre espace de travail.':reset?'Recevez un lien pour réinitialiser votre mot de passe.':password?'Un mot de passe d’au moins 12 caractères.':'Connectez-vous pour retrouver vos commandes et votre équipe.'}</p>${S.authInfo?`<div class="notice" role="status">${icon('info')}${esc(S.authInfo)}</div>`:''}<form data-form="auth">${!password?field('Adresse e-mail','email','','email',true,'autocomplete="email" maxlength="254"'):''}${!reset?field('Mot de passe','password','','password',true,`autocomplete="${signup||password?'new-password':'current-password'}" ${signup||password?'minlength="12"':''} maxlength="200"`):''}<div class="form-error" role="alert"></div><button class="btn primary" type="submit">${password?'Enregistrer le mot de passe':signup?'Créer mon compte':reset?'Recevoir le lien':'Se connecter'}${icon('arrow')}</button></form><div class="auth-links">${!password?`<button data-auth-mode="${signup||reset?'login':'signup'}">${signup||reset?'J’ai déjà un compte':'Créer un compte'}</button>${!reset&&!signup?'<button data-auth-mode="reset">Mot de passe oublié</button>':''}`:''}<button data-action="dark">${document.body.classList.contains('dark')?'Mode clair':'Mode sombre'}</button></div><p class="crm-caption mt center">CRM • Commandes & confirmation</p></section></div>`;
}
function onboardingView(){
 $('#app-root').hidden=true;$('#auth-root').hidden=false;applyTheme();
 const token=sessionStorage.getItem('wc-invitation');
 $('#auth-root').innerHTML=`<div class="auth-shell"><section class="card auth-card"><div class="brand"><span class="brandmark">${brandLogo()}</span><div class="brand-name">WeConvert</div></div><h1>${token?'Rejoindre votre équipe.':'Créons votre espace CRM.'}</h1><p class="mt">Connecté avec ${esc(S.user.email)}.</p>${token?`<p class="mt">Le lien est lié à l’adresse e-mail invitée.</p><form data-form="accept"><div class="form-error" role="alert"></div><button class="btn primary">Accepter l’invitation</button></form><button class="btn mt" data-action="discardInvite">Créer mon propre espace</button>`:`<form data-form="workspace">${field('Nom de l’entreprise','name','','text',true,'minlength="2" maxlength="100"')}${field('Première boutique','store','','text',true,'minlength="2" maxlength="100"')}${field('Votre nom','display','','text',true,'minlength="2" maxlength="100"')}<div class="notice">${icon('info')}Votre espace démarre vide. Vous pourrez ensuite ajouter vos produits et vos premières commandes.</div><div class="form-error" role="alert"></div><button class="btn primary">Créer l’espace de travail</button></form>`}<button class="btn mt" data-action="logout">Se déconnecter</button></section></div>`;
}
async function loadContext(preferredWorkspace){
 const epoch=++authSequence;const uid=S.user?.id;if(!uid)return authView();
 const {data:memberships}=await query(supabase.from('crm_members').select('workspace_id,role').eq('user_id',uid).eq('active',true));
 if(epoch!==authSequence||S.user?.id!==uid)return;
 if(!memberships.length){liveSync.stop();S.workspace=null;S.store=null;S.members=[];return onboardingView();}
 const want=preferredWorkspace||S.workspace||localStorage.getItem('wc-workspace-'+uid);
 const membership=memberships.find(m=>m.workspace_id===want)||memberships[0];
 const [ws,st,mb]=await Promise.all([
  query(supabase.from('crm_workspaces').select('id,name').order('created_at')),
  query(supabase.from('crm_stores').select('id,name,workspace_id').eq('workspace_id',membership.workspace_id).order('created_at')),
  query(supabase.from('crm_members').select('user_id,display_name,role,active').eq('workspace_id',membership.workspace_id).order('created_at'))
 ]);
 if(epoch!==authSequence||S.user?.id!==uid)return;
 if(S.workspace!==membership.workspace_id){S.reportData=null;S.deliveredPeriod=null;S.dashboardDelivered=null;S.deliveredPage=1;S.reportAgent='';S.reportChannel='';}
 S.workspaces=ws.data;S.workspace=membership.workspace_id;S.role=membership.role;S.members=mb.data;S.stores=st.data;
 const storeChoice=S.store||localStorage.getItem('wc-store-'+uid+'-'+S.workspace);
 S.store=st.data.find(x=>x.id===storeChoice)?.id||st.data[0]?.id;
 try{localStorage.setItem('wc-workspace-'+uid,S.workspace);}catch{}
 $('#auth-root').hidden=true;$('#app-root').hidden=false;
 if(sessionStorage.getItem('wc-invitation')){modal('Rejoindre un espace',`<p>Vous avez ouvert un lien d’invitation. Rejoignez l’équipe avec le compte ${esc(S.user.email)}.</p><form data-form="accept" id="accept-form"><div class="form-error" role="alert"></div></form>`,btn('Plus tard','close')+'<button class="btn primary" form="accept-form">Accepter l’invitation</button>');}
 readRoute();await refresh();
 consumeOAuthTicket();
}
// The OAuth callback only parks tokens; this logged-in confirmation by the initiator activates them.
async function consumeOAuthTicket(){
 let pending=null;try{pending=JSON.parse(sessionStorage.getItem('wc-oauth')||'null');sessionStorage.removeItem('wc-oauth');}catch{}
 if(!pending||!['shopify','youcan'].includes(pending.provider)||!/^[a-f0-9]{64}$/.test(pending.ticket||''))return;
 const name=pending.provider==='shopify'?'Shopify':'YouCan';
 try{const {data,error}=await supabase.functions.invoke('weconvert-'+pending.provider,{body:{action:'confirm',ticket:pending.ticket}});if(error||data?.error)throw Error('INVALID_STATE');toast('Connexion '+name+' confirmée.');}
 catch{toast('La connexion '+name+' n’a pas pu être confirmée : elle doit être validée par la personne qui l’a lancée, dans les 10 minutes. Relancez-la depuis Intégrations.','info');}
 await refresh();
}
function sidebar(){
 const counts={orders:S.overview.all,confirmation:S.overview.pending};
 $('#sidebar').innerHTML=`<a href="#dashboard" class="brand"><span class="brandmark">${brandLogo()}</span><div><div class="brand-name">WeConvert</div><div class="brand-sub">COD WORKSPACE</div></div></a><button class="store-switch" data-action="switchStore"><span class="store-icon">${icon('store')}</span><span class="grow"><span class="store-name">${esc(storeName())}</span><span class="store-sub" style="display:block">${esc(S.workspaces.find(w=>w.id===S.workspace)?.name||'E-commerce COD')}</span></span>${icon('down')}</button><nav class="nav-scroll" aria-label="Navigation principale">${NAV.map(([group,items])=>`<div class="nav-section">${group}</div>${items.map(([id,label,ic])=>`<a href="#${id}" class="nav-link ${route===id?'active':''}" ${route===id?'aria-current="page"':''}>${icon(ic)}<span>${label}</span>${counts[id]!==undefined?`<span class="counter" data-live-counter="${id}">${f(counts[id])}</span>`:!ACTIVE_PAGES.has(id)?'<span class="later" aria-label="À venir">À venir</span>':''}</a>`).join('')}`).join('')}</nav><button class="profile" data-nav="settings"><span class="avatar orange">${initials(selfMember()?.display_name||S.user.email)}</span><span class="grow" style="text-align:left"><b style="font-size:.875rem">${esc(selfMember()?.display_name||S.user.email)}</b><span class="store-sub" style="display:block">${esc(roles[S.role])}</span></span>${icon('down')}</button>`;
}
function topbar(){
 applyTheme();$('#topbar').innerHTML=`<div class="flex"><button class="icon-btn bare mobile-menu" data-action="menu" aria-controls="sidebar" aria-expanded="false" aria-label="Ouvrir le menu">${icon('menu')}</button><div class="breadcrumbs"><span>Workspace</span>${icon('chevron')}<b>${esc(TITLES[route])}</b></div></div><div class="top-actions"><button class="search-trigger" data-nav="orders">${icon('search')}Rechercher une commande</button><span class="demo-tag" data-live-connection role="status" aria-live="polite">${liveBadge()}</span><button class="icon-btn bare" data-action="dark" aria-label="Changer le thème">${icon(document.body.classList.contains('dark')?'sun':'moon')}</button><button class="icon-btn bare" data-action="refresh" aria-label="Actualiser les données">${icon('refresh')}</button><span class="avatar orange">${initials(selfMember()?.display_name||S.user.email)}</span></div>`;
}
function render({live=false}={}){
 if(live&&renderLive())return;
 if(!S.user||!S.workspace)return;
 sidebar();topbar();const views={dashboard:dashboardPage,performance:performancePage,orders:ordersPage,confirmation:confirmationPage,shipping:shippingPage,products:productsPage,team:teamPage,settings:settingsPage,integrations:integrationsPage};
 $('#content').innerHTML=(S.error?`<div class="notice" role="alert">${icon('info')}${esc(S.error)} ${btn('Réessayer','refresh','refresh')}</div>`:S.loading?loader():(views[route]||plannedPage)())+`<footer class="bottom-foot"><span>WeConvert · Votre commerce, sous contrôle.</span><span>${S.lastSync?'Actualisé à '+new Date(S.lastSync).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'CRM connecté'} · ${manager()?'Boutique sélectionnée':'Vos commandes affectées'}</span></footer>`;
 document.title=`${TITLES[route]} — WeConvert`;
}
async function refresh({quiet=false,live=false}={}){
 if(!S.user||!S.workspace||!S.store)return;
 watchLiveStore();
 const generation=++loadSequence,store=S.store,view=route;
 S.error='';if(!quiet){S.loading=true;render();}
 try{
  const [overview,orders,products,members,woo,wooEvents,shopify,youcan,report,zr,shipping,shippingPage,delivery,productCosts,expenses,deliveredPeriod,dashboardDelivered]=await Promise.all([
   rpc('crm_overview',{p_store:store}),
   ['dashboard','orders','confirmation'].includes(view)?rpc('crm_list_orders',{p_store:store,p_status:view==='confirmation'?(S.status==='due'?'due':'pending'):view==='dashboard'?'all':S.status,p_query:S.q,p_page:view==='dashboard'?1:S.page,p_size:view==='dashboard'?5:20,p_agent:S.agent||null,p_ascending:S.ascending}):null,
   view==='products'?query(supabase.from('crm_products').select('*',{count:'exact'}).eq('store_id',store).ilike('name','%'+S.q.replace(/[\\%_]/g,'\\$&')+'%').order('name').order('id').range((S.page-1)*20,S.page*20-1)):null,
   view==='team'?query(supabase.from('crm_members').select('user_id,display_name,role,active').eq('workspace_id',S.workspace).order('created_at')):null,
   view==='integrations'&&manager()?query(supabase.from('crm_integrations').select('*').eq('store_id',store).maybeSingle()):null,
   view==='integrations'&&manager()?query(supabase.from('crm_integration_events').select('*').eq('store_id',store).order('id',{ascending:false}).limit(50)):null,
   view==='integrations'&&manager()?query(supabase.from('crm_source_connections').select('*').eq('store_id',store).eq('provider','shopify').maybeSingle()):null,
   ['integrations','orders'].includes(view)&&manager()?query(supabase.from('crm_source_connections').select('*').eq('store_id',store).eq('provider','youcan').maybeSingle()):null,
   view==='performance'?rpc('crm_performance',{p_store:store,p_from:reportSelection().from,p_to:reportSelection().to,p_agent:manager()?S.reportAgent||null:null,p_channel:S.reportChannel||null}):null,
   view==='shipping'&&manager()?query(supabase.from('crm_shipping_connections').select('*').eq('store_id',store).maybeSingle()):null,
   view==='shipping'&&manager()?rpc('crm_shipping_dashboard',{p_store:store}):null,
   view==='shipping'&&manager()?rpc('crm_shipping_filtered_page',{p_store:store,p_page:S.shippingPage,p_status:S.shippingStatus}):null,
   view==='performance'&&manager()?rpc('crm_delivery_performance',{p_store:store,p_from:reportSelection().from,p_to:reportSelection().to,p_channel:S.reportChannel||null}):null,
   view==='products'&&manager()?query(supabase.from('crm_product_costs').select('product_id,unit_cost').eq('store_id',store)):null,
   view==='performance'&&manager()?query(supabase.from('crm_cost_entries').select('id,spent_on,kind,amount,note').eq('store_id',store).gte('spent_on',reportSelection().from).lte('spent_on',reportSelection().to).order('spent_on',{ascending:false}).limit(100)):null,
   view==='performance'&&manager()?rpc('crm_delivered_period_page',{p_store:store,p_from:reportSelection().from,p_to:reportSelection().to,p_agent:S.reportAgent||null,p_channel:S.reportChannel||null,p_page:S.deliveredPage}):null,
   view==='dashboard'&&manager()?rpc('crm_delivered_period_page',{p_store:store,p_from:reportRange('7').from,p_to:reportRange('7').to,p_page:1}):null
  ]);
  const sourceEventBatches=view==='integrations'&&manager()?await Promise.all([shopify?.data?.id,youcan?.data?.id].map(id=>id?query(supabase.from('crm_source_events').select('*').eq('connection_id',id).order('id',{ascending:false}).limit(30)):null)):null;
  const intakeEvents=view==='orders'&&manager()&&youcan?.data?.id?await query(supabase.from('crm_source_events').select('id,external_id,outcome,code,created_at').eq('connection_id',youcan.data.id).not('external_id','is',null).order('id',{ascending:false}).limit(100)):null;
  if(generation!==loadSequence||store!==S.store||view!==route)return;
  S.overview=overview;
  if(orders){S.orders=orders.items||[];S.total=orders.total;if(S.page>1&&!S.orders.length&&S.total>0){S.page=Math.ceil(S.total/20);return refresh({quiet,live});}}
  if(products){S.products=products.data;S.productTotal=products.count;S.products.forEach(p=>productCache.set(p.id,p));}
  if(members)S.members=members.data;
  if(woo)S.woo=woo.data;if(wooEvents)S.wooEvents=wooEvents.data;if(shopify)S.shopify=shopify.data;if(youcan)S.youcan=youcan.data;if(sourceEventBatches)S.sourceEvents=sourceEventBatches.flatMap(batch=>batch?.data||[]);
  if(view==='orders'){
   const latest=new Map();for(const event of intakeEvents?.data||[])if(!latest.has(event.external_id))latest.set(event.external_id,event);
   S.youcanAlerts=manager()?[...latest.values()].filter(e=>e.outcome==='skipped'&&['CUSTOMER_REQUIRED','INVALID_PHONE','WILAYA_REQUIRED'].includes(e.code)).slice(0,10):[];
  }
  if(report)S.reportData=report;
  if(delivery)S.deliveryReport=delivery;
  if(deliveredPeriod){S.deliveredPeriod=deliveredPeriod;if(S.deliveredPage>1&&!deliveredPeriod.orders?.length&&Number(deliveredPeriod.total)>0){S.deliveredPage=Math.ceil(Number(deliveredPeriod.total)/20);return refresh({quiet,live});}}
  if(dashboardDelivered)S.dashboardDelivered=dashboardDelivered;
  if(productCosts)S.productCosts=productCosts.data;
  if(expenses)S.expenses=expenses.data;
  if(view==='shipping'){
   S.zr=zr?.data||null;S.shippingTotal=Number(shippingPage?.total||0);
   if(S.shippingPage>1&&!shippingPage?.shipments?.length&&S.shippingTotal>0){S.shippingPage=Math.ceil(S.shippingTotal/50);return refresh({quiet,live});}
   S.shipping={queue:shipping?.queue||[],shipments:shippingPage?.shipments||[]};
   S.shipmentCosts=(shippingPage?.shipments||[]).filter(s=>s.delivery_cost!==null).map(s=>({shipment_id:s.id,delivery_cost:s.delivery_cost,return_cost:s.return_cost,other_cost:s.other_cost}));
  }
  if(view==='confirmation'){
   const chosen=S.orders.find(x=>x.id===S.queueId)||S.orders[0];S.queueId=live&&S.queueId?S.queueId:chosen?.id||null;
   const detail=S.queueId?await rpc('crm_order_detail',{p_id:S.queueId}):null;
   if(generation!==loadSequence||view!==route||store!==S.store)return;S.detail=detail;
  }
  S.lastSync=Date.now();S.loading=false;render({live});return true;
 }catch(e){if(generation!==loadSequence)return;S.loading=false;S.error=safeError(e);if(!live)render();return false;}
}
function dotSvg(values,maxOverride){
 const series=(values||[]).slice(-7),padded=[...Array(Math.max(0,7-series.length)).fill(0),...series];
 const max=maxOverride??Math.max(1,...padded);
 return `<svg class="wc-kpi-spark" viewBox="0 0 112 64" aria-hidden="true" focusable="false">${padded.map((value,x)=>{
  const active=value>0?Math.max(1,Math.round(value/max*7)):0;
  return Array.from({length:7},(_,y)=>`<circle cx="${8+x*16}" cy="${8+y*8}" r="2.4" class="${y>=7-active?'on':'off'}"/>`).join('');
 }).join('')}</svg>`;
}
function ratioDots(value,total){return dotSvg(Array(7).fill(total?Math.max(0,Math.min(1,Number(value)/Number(total))):0),1)}
function kpi(label,value,ic,color,foot,nav,dots='',action=''){
 return `<button class="card kpi" ${action?`data-action="${action}"`:`data-nav="${nav}"`} style="${tone(color)}"><span class="kpi-top"><span class="icon">${icon(ic)}</span><span>${label}</span>${icon('arrow','arrow')}</span><span class="wc-kpi-bottom"><span class="wc-kpi-copy"><span class="kpi-value">${value}</span><span class="kpi-foot">${foot}</span></span>${dots}</span></button>`;
}
function chart(){
 const days=S.overview.days||[];
 if(!days.length)return empty('Pas encore de données','Les commandes reçues apparaîtront ici par jour.');
 const max=Math.max(1,...days.map(d=>Number(d.count)||0));
 const label=days.map(d=>new Date(d.date+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'long'})+' : '+f(d.count)+' commande(s)').join(', ');
 return `<div class="crm-chart wc-dots-chart" role="img" aria-label="Commandes créées : ${esc(label)}">${days.map(d=>{
  const count=Number(d.count)||0,active=count?Math.max(1,Math.round(count/max*12)):0;
  const date=new Date(d.date+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
  return `<div class="wc-dots-day"><b>${f(count)}</b><div class="wc-dot-stack" aria-hidden="true">${Array.from({length:12},(_,i)=>`<i class="${i>=12-active?'on':''}"></i>`).join('')}</div><small>${esc(date)}</small></div>`;
 }).join('')}</div>`;
}
function dashboardPage(){
 const m=S.overview,days=m.days||[],activeMembers=S.members.filter(x=>x.active).length;
 const legacy=(Number(m.woo_confirmation_unverified)||0)+(Number(m.woo_cancellation_unverified)||0);
 return header('Votre activité, en un coup d’œil.','Commandes, confirmation et rappels dans votre boutique.',btn('Nouvelle commande','newOrder','plus','primary'))+
 `<div class="kpis ${manager()?'kpis-four':''}">${kpi('Commandes reçues',f(m.all),'bag','purple','<b>'+f(m.today)+'</b> reçues aujourd’hui','orders',dotSvg(days.map(d=>Number(d.count)||0)))}${kpi('À confirmer',f(m.pending),'phone','orange',f(m.pending)+' sur '+f(m.all)+' commandes visibles','confirmation',ratioDots(m.pending,m.all))}${kpi('Taux de confirmation',reportRate(m.confirmed_verified,m.all),'checkcircle','blue',f(m.confirmed_verified)+' vérifiées sur '+f(m.all)+' reçues depuis l’ouverture','orders/confirmed',ratioDots(m.confirmed_verified,m.all))}${manager()?kpi('Commandes livrées',f(S.dashboardDelivered?.total),'truck','green','Parmi les commandes créées ces 7 jours · ZR','performance','','goDeliveredReport'):''}</div>`+
 (legacy?`<div class="notice mb" role="status">${icon('info')}${f(legacy)} statuts historiques (confirmations ou annulations) ont été déduits de WooCommerce sans décision COD vérifiée. Ces commandes restent visibles ; leurs statuts sont exclus des taux et montants du rapport jusqu’au rapprochement avec la source de confirmation d’origine.</div>`:'')+
 `<div class="overview-row"><section class="card chart-card"><div class="card-head"><div><h2>Activité des commandes</h2><p>Commandes créées · heure d’Alger</p></div><span class="pill">7 derniers jours</span></div><div class="chart-meta"><div class="chart-total">${f(sum(days,d=>d.count))}</div><p>Commandes sur cette période</p></div>${chart()}</section><section class="card wc-day-card"><div class="card-head"><div><h2>Votre journée</h2><p>Les actions qui comptent maintenant</p></div></div><div class="task-list">${[['phone','orange',m.pending,'commandes à confirmer','Vérifier les coordonnées et la disponibilité','confirmation'],['clock','purple',m.due,'rappels arrivés à échéance','Planifier les rappels','confirmation/due'],['checkcircle','green',m.confirmed,'statuts confirmés','À vérifier pour l’historique Woo','orders/confirmed']].map(([ic,c,n,label,desc,nav])=>`<button class="task" data-nav="${nav}" style="${tone(c)}"><span class="task-icon">${icon(ic)}</span><span class="grow"><span class="task-title">${f(n)} ${label}</span><span class="task-sub" style="display:block">${desc}</span></span>${icon('chevron')}</button>`).join('')}</div><div class="insight">${icon('info')}<span>Valeur COD confirmée : <b>${money(m.confirmed_verified_amount)}</b>. Les livraisons sont dans Performance ; le reversement reste distinct.</span></div></section></div>`+
 `<section class="card wc-activity-card"><div class="card-head"><div><h2>Dernières commandes</h2><p>Commandes enregistrées dans cette boutique</p></div>${btn('Tout voir','goOrders','arrow','link')}</div>${ordersTable(S.orders,true)}</section><div class="grid2 mt"><section class="card pad"><h2>Votre équipe</h2><p class="mt">${f(activeMembers)} membre${activeMembers>1?'s':''} actif${activeMembers>1?'s':''} dans cet espace.</p>${btn('Gérer les accès','goTeam','users','mt')}</section><section class="card pad"><h2>Vos commandes par message</h2><p class="mt">Enregistrez aussi les commandes reçues sur WhatsApp, Messenger, Instagram ou par téléphone. Leur canal est conservé dans chaque fiche.</p>${btn('Ajouter une commande','newOrder','plus','mt')}</section></div>`;
}
function ordersTable(orders,compact=false){return `<div class="crm-order-list"><div class="table-scroll" role="region" aria-label="Commandes, défilement horizontal si nécessaire" tabindex="0"><table><thead><tr>${!compact&&manager()?'<th><input type="checkbox" class="check" data-select-all aria-label="Sélectionner la page"></th>':''}<th>N° commande</th><th>Client</th><th>Produit</th><th>Wilaya</th><th>Montant COD</th><th>Agent</th><th>Statut</th><th>Date</th><th></th></tr></thead><tbody>${orders.map((o,i)=>`<tr class="clickrow" data-open-order="${o.id}">${!compact&&manager()?`<td><input type="checkbox" class="check" data-select="${o.id}" aria-label="Sélectionner ${code(o)}" ${S.selected.has(o.id)?'checked':''}></td>`:''}<td><button class="order-id" data-open-order="${o.id}">#${code(o)}</button><small class="muted" style="display:block">${esc(CHANNELS[o.channel])}</small></td><td><div class="customer-cell"><span class="avatar ${['orange','blue','violet','green'][i%4]}">${initials(o.customer_name)}</span><span>${esc(o.customer_name)}<small>${esc(o.phone)}</small></span></div></td><td><div class="product-cell"><span class="product-thumb" style="${tone('purple')}">${icon('box')}</span><span>${esc(o.items?.[0]?.product_name||'—')}<small>${(o.items||[]).length>1?'+'+((o.items||[]).length-1)+' autre(s) produit(s)':f(o.items?.[0]?.quantity)+' article(s)'}</small></span></div></td><td>${esc(o.wilaya)}</td><td class="mono"><b>${money(o.total)}</b></td><td>${esc(memberName(o.assigned_to))}</td><td>${statusBadge(o.status)}${o.status_origin==='woo_legacy'?'<small class="muted" style="display:block">Statut Woo non vérifié</small>':''}${o.woo_attention?'<small class="muted" style="display:block">WooCommerce à vérifier</small>':''}${o.callback_at?`<small class="muted" style="display:block">${esc(time(o.callback_at))}</small>`:''}</td><td class="muted">${new Date(o.created_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})}</td><td>${icon('chevron')}</td></tr>`).join('')}</tbody></table></div>${!orders.length?empty('Aucune commande','Ajoutez une commande ou adaptez votre recherche.'):''}</div>`;}
function pager(total){const last=Math.max(1,Math.ceil(total/20));return `<div class="table-foot"><span>${f(total)} résultat${total>1?'s':''} · ${total?(S.page-1)*20+1:0}–${Math.min(S.page*20,total)}</span><div class="pagination"><button data-page="${S.page-1}" ${S.page===1?'disabled':''} aria-label="Page précédente">${icon('chevron')}</button><span>Page ${S.page} / ${last}</span><button data-page="${S.page+1}" ${S.page>=last?'disabled':''} aria-label="Page suivante">${icon('chevron')}</button></div></div>`;}
function searchBox(placeholder='Client, téléphone, wilaya ou numéro…'){return `<label class="searchbox">${icon('search')}<input type="search" data-search aria-label="Rechercher" value="${esc(S.q)}" placeholder="${placeholder}" maxlength="200"></label>`;}
function ordersPage(){return header('Vos commandes, sous contrôle.','Centralisez, vérifiez et confirmez chaque commande.',btn('Exporter la sélection filtrée','exportOrders','download')+btn('Nouvelle commande','newOrder','plus','primary'))+youcanIntakeAlerts()+tabs([['all','Toutes',S.overview.all],['new','Nouvelles',S.overview.new],['pending','En traitement',S.overview.pending],['confirmed','Statuts confirmés',S.overview.confirmed],['cancelled_all','Annulées',S.overview.cancelled]],S.status)+`<section class="card"><div class="toolbar">${searchBox()}<div class="flex wrap crm-search">${manager()?`<select data-agent-filter aria-label="Filtrer par agent"><option value="">Tous les agents</option>${S.members.filter(m=>m.active).map(m=>`<option value="${m.user_id}" ${S.agent===m.user_id?'selected':''}>${esc(m.display_name)}</option>`).join('')}</select>`:''}<button class="btn sm" data-action="sort">${icon('down')}${S.ascending?'Anciennes d’abord':'Récentes d’abord'}</button></div></div><div data-live-selection>${S.selected.size&&manager()?`<div class="toolbar"><span>${S.selected.size} sélectionnée(s)</span>${btn('Affecter à un agent','bulkAssign','users')}${btn('Désélectionner','clearSelection','close')}</div>`:''}</div>${ordersTable(S.orders)}${pager(S.total)}</section>`;}
function youcanIntakeAlerts(){
 if(!manager()||!S.youcanAlerts.length)return '';
 const reasons={CUSTOMER_REQUIRED:'Nom du client absent',INVALID_PHONE:'Téléphone absent ou invalide',WILAYA_REQUIRED:'Wilaya absente'};
 return `<section class="card pad mb" data-source-anomalies role="status"><div class="between wrap"><div><h2>Commandes YouCan à compléter</h2><p>Ces commandes sont reçues, mais ne sont pas encore dans la file de confirmation ni dans les statistiques COD.</p></div><a class="btn sm" href="#integrations">Journal YouCan ${icon('arrow')}</a></div><div class="mt">${S.youcanAlerts.map(e=>`<div class="between wrap mt"><span>${icon('info')} <b>${esc(time(e.created_at))}</b> · ${esc(reasons[e.code])}</span>${/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(e.external_id||'')?`<a class="btn sm" href="https://seller-area.youcan.shop/admin/orders/${encodeURIComponent(e.external_id)}/edit" target="_blank" rel="noopener noreferrer">Compléter sur YouCan ${icon('arrow')}</a><button class="btn sm" data-youcan-retry="${esc(e.external_id)}">Réessayer</button>`:''}</div>`).join('')}</div></section>`;
}
function itemsSummary(o){return table(['Produit','Qté','Prix unitaire','Total'],(o.items||[]).map(i=>`<tr><td><b>${esc(i.product_name)}</b><small class="muted" style="display:block">${esc(i.sku)}</small></td><td>${f(i.quantity)}</td><td>${money(i.unit_price)}</td><td>${money(Number(i.quantity)*Number(i.unit_price))}</td></tr>`));}
function orderActions(o){const pending=PRE.includes(o.status);return `<div class="crm-detail-actions mt">${pending?`<button class="btn primary" data-status="confirmed" data-id="${o.id}" data-version="${o.version}">${icon('check')}Confirmer</button><button class="btn" data-callback="${o.id}">${icon('clock')}Planifier un rappel</button><button class="btn" data-call="${o.id}" data-version="${o.version}">Sans réponse</button><button class="btn" data-edit-order="${o.id}">${icon('edit')}Modifier</button><button class="btn danger" data-status="cancelled" data-id="${o.id}" data-version="${o.version}">Annuler</button><button class="btn" data-status="check" data-id="${o.id}" data-version="${o.version}" ${o.status==='check'?'disabled':''}>À vérifier</button><button class="btn" data-status="fake" data-id="${o.id}" data-version="${o.version}">Faux numéro</button><button class="btn" data-status="duplicate" data-id="${o.id}" data-version="${o.version}">Doublon</button>`:manager()?`<button class="btn" data-status="new" data-id="${o.id}" data-version="${o.version}">Rouvrir la commande</button>${o.status==='confirmed'?`<button class="btn danger" data-status="cancelled" data-id="${o.id}" data-version="${o.version}">Annuler</button>`:''}`:''}</div>`;}
function noteForm(o){return `<form data-form="note" data-id="${o.id}" data-version="${o.version}" class="mt crm-queue-note"><label class="field"><span>Compte rendu ou note interne</span><textarea name="note" required maxlength="2000" rows="3" placeholder="Disponibilité, repère, objection, demande du client…"></textarea></label><button class="btn sm mt" type="submit">Enregistrer la note</button><div class="form-error" role="alert"></div></form>`;}
function eventText(e){const d=e.data||{};if(e.kind.startsWith('woo.'))return ({'woo.imported':'Commande importée de WooCommerce #'+d.number,'woo.updated':'Commande mise à jour depuis WooCommerce #'+d.number,'woo.attention':'Modification WooCommerce à vérifier : '+wooLabel(d.reason),'woo.reviewed':'Modification WooCommerce vérifiée ; fiche CRM conservée.'})[e.kind]||e.kind;const texts={'order.created':'Commande créée · '+(CHANNELS[d.channel]||''),'order.edited':'Coordonnées ou contenu de la commande modifiés.','order.status':(STATUS[d.from]?.[0]||d.from)+' → '+(STATUS[d.to]?.[0]||d.to)+(d.reason?' · '+d.reason:''),'order.call':'Appel '+d.attempt+' : sans réponse.','order.callback':'Rappel prévu le '+time(d.callback_at)+(d.note?' · '+d.note:''),'order.note':d.note,'order.assigned':'Affectation : '+memberName(d.to)};return texts[e.kind]||e.kind;}
function orderHistory(o){return `<h3 class="form-section">Historique · 100 derniers événements</h3>${(o.events||[]).map(e=>`<article class="history-item"><small>${esc(time(e.created_at))} · ${esc(e.actor_name)}</small><p>${esc(eventText(e))}</p></article>`).join('')}`;}
function confirmationPage(){const o=S.detail;return header('Un appel. Une commande confirmée.','Votre espace de confirmation, avec les bonnes informations au même endroit.',btn('Nouvelle commande','newOrder','plus','primary'))+`<div class="grid3 mb">${[['À confirmer',S.overview.pending,'orange','phone'],['Rappels planifiés',S.overview.callbacks,'purple','calendar'],['Rappels à traiter',S.overview.due,'green','clock']].map(([label,n,c,ic])=>`<div class="card pad between"><span><p style="font-size:.875rem">${label}</p><div class="metric">${f(n)}</div></span><span class="task-icon" style="${tone(c)}">${icon(ic)}</span></div>`).join('')}</div>${tabs([['pending','Toute la file'],['due','Rappels à traiter']],S.status==='due'?'due':'pending')}<div class="panel-columns"><section class="card"><div class="card-head"><h2>File d’attente</h2><span class="pill">${S.total}</span></div><div class="toolbar">${searchBox('Rechercher un client…')}</div><div class="queue-list">${S.orders.map(x=>`<button class="queue-item ${x.id===o?.id?'active':''}" data-queue="${x.id}"><span class="avatar violet">${initials(x.customer_name)}</span><span class="grow"><b>${esc(x.customer_name)}</b><p>#${code(x)} · ${esc(x.wilaya)}</p>${x.callback_at?`<small>${esc(time(x.callback_at))}</small>`:''}</span>${statusBadge(x.status)}</button>`).join('')}${!S.orders.length?empty('File traitée','Aucune commande dans cette sélection.'):''}</div>${pager(S.total)}</section><section class="card pad">${o?`<div class="between mb"><div><h2>${esc(o.customer_name)}</h2><p style="font-size:.875rem">#${code(o)} · ${esc(o.phone)}</p></div><button class="btn" data-open-order="${o.id}">Fiche complète ${icon('arrow')}</button></div><div class="flex wrap mb"><a class="btn" href="tel:${esc(o.phone)}">${icon('phone')}Appeler</a>${badge(CHANNELS[o.channel],'blue')}<span class="muted">${f(o.attempts)} tentative(s) sans réponse</span></div><div class="grid2"><div class="stat-box"><p>Montant à confirmer</p><strong>${money(o.total)}</strong></div><div class="stat-box"><p>Adresse de livraison</p><b style="display:block;margin-top:6px">${esc(o.wilaya)} · ${esc(o.commune)}</b><small class="muted">${esc(o.address||'Adresse à compléter')}</small></div></div><div class="mt">${itemsSummary(o)}</div><h3 class="form-section">Script de confirmation</h3><p style="font-size:1rem;line-height:1.9">« Bonjour ${esc(o.customer_name.split(' ')[0])}, je vous appelle de ${esc(storeName())} concernant votre commande. Je vous confirme les articles, votre adresse à ${esc(o.wilaya)} et le montant de <b>${money(o.total)}</b>, à régler à la réception. Serez-vous disponible pour réceptionner le colis ? »</p>${wooSource(o)}${shopifySource(o)}${youcanSource(o)}${orderActions(o)}${noteForm(o)}${orderHistory(o)}`:empty('File de confirmation vide','Ajoutez une commande ou adaptez votre recherche.')}</section></div>`;}
async function openOrder(id){modal('Commande',loader());const o=await rpc('crm_order_detail',{p_id:id});if(!o)throw Error('NOT_FOUND');S.detail=o;const shipment=route==='shipping'?(S.shipping?.shipments||[]).find(x=>x.order_id===id):route==='performance'?(S.deliveredPeriod?.orders||[]).find(x=>x.order_id===id):null;modal('Commande #'+code(o),`<div class="between mb"><div class="flex"><span class="avatar orange">${initials(o.customer_name)}</span><div><h2>${esc(o.customer_name)}</h2><p>${esc(o.phone)}</p></div></div>${statusBadge(o.status)}</div>${shipment?`<div class="notice mb">${icon('truck')}Statut ZR : ${zrBadge(shipment.state)} · COD demandé ${money(shipment.cod_amount)}. Le statut de confirmation CRM est distinct.</div>`:''}<div class="grid2"><div class="stat-box"><p>Livraison ${o.delivery_type==='desk'?'en point de retrait':'à domicile'}</p><b>${esc(o.wilaya)} · ${esc(o.commune)}</b><p class="crm-note">${esc(o.address)}</p></div><div class="stat-box"><p>Source & affectation</p><b>${esc(CHANNELS[o.channel])} · ${esc(memberName(o.assigned_to))}</b><p class="crm-note">${esc(o.source_detail||'Aucun détail de source ajouté.')}</p></div></div><div class="mt">${itemsSummary(o)}</div><div class="between mt"><span>Frais ${money(o.fee)} · Remise ${money(o.discount)}</span><b class="crm-total">${money(o.total)}</b></div>${manager()?`<button class="btn mt" data-assign="${o.id}">${icon('users')}Affecter à un agent</button>`:''}${wooSource(o)}${shopifySource(o)}${youcanSource(o)}${orderActions(o)}${noteForm(o)}${orderHistory(o)}`,btn('Fermer','close'),'wide');}
function productsPage(){return header('Les bons produits. Le bon stock.','Le stock disponible tient compte des commandes confirmées.',manager()?btn('Nouveau produit','newProduct','plus','primary'):'')+tabs([['catalog','Catalogue & stock']], 'catalog')+`<section class="card"><div class="toolbar">${searchBox('Rechercher un produit…')}<span class="crm-caption">Stock physique − réservé = disponible</span></div>${table(['Produit','SKU','Prix de vente',...(manager()?['Coût d’achat estimé']:[]),'Physique','Réservé','Disponible','Actions'],S.products.map(p=>`<tr><td><div class="product-cell"><span class="product-thumb" style="${tone('purple')}">${icon('box')}</span><b>${esc(p.name)}</b></div></td><td>${esc(p.sku)}</td><td>${money(p.price)}</td>${manager()?`<td>${S.productCosts.find(c=>c.product_id===p.id)?money(S.productCosts.find(c=>c.product_id===p.id).unit_cost):'À renseigner'}</td>`:''}<td>${f(p.stock)}</td><td>${f(p.reserved)}</td><td>${badge(f(p.stock-p.reserved),p.stock-p.reserved>0?'green':'red')}</td><td>${manager()?`<div class="flex wrap"><button class="btn sm" data-edit-product="${p.id}">Modifier</button><button class="btn sm" data-product-cost="${p.id}">Coût d’achat</button><button class="btn sm" data-stock="${p.id}">Stock</button></div>`:'Lecture seule'}</td></tr>`))}${pager(S.productTotal)}</section>`;}
function teamPage(){return header('Une équipe. Les bons accès.','Les permissions sont vérifiées pour chaque opération.',manager()?btn('Inviter un membre','invite','plus','primary'):'')+tabs([['members','Membres'],['roles','Permissions']],tab==='roles'?'roles':'members')+(tab==='roles'?`<section class="card">${table(['Permission','Propriétaire','Administrateur','Agent'],[['Lire les commandes','Toutes les boutiques','Toutes les boutiques','Commandes affectées uniquement'],['Créer une commande','Oui','Oui','Oui, affectée à lui-même'],['Confirmer, appeler, noter','Oui','Oui','Sur ses commandes'],['Changer un prix / remise','Oui','Oui','Catalogue à la création ; prix convenu conservé'],['Affecter une commande','Oui','Oui','Non'],['Gérer produits et stock','Oui','Oui','Lecture seule'],['Inviter un membre','Admin ou agent','Agent uniquement','Non'],['Modifier / désactiver les accès','Oui','Non','Non']].map(row=>'<tr>'+row.map(c=>'<td>'+c+'</td>').join('')+'</tr>'))}</section>`:`<section class="card">${table(['Membre','Rôle','Accès','Action'],S.members.map(m=>`<tr><td><div class="flex"><span class="avatar ${m.role==='owner'?'orange':'violet'}">${initials(m.display_name)}</span><b>${esc(m.display_name)}${m.user_id===S.user.id?' (vous)':''}</b></div></td><td>${esc(roles[m.role])}</td><td>${badge(m.active?'Actif':'Désactivé',m.active?'green':'gray')}</td><td>${S.role==='owner'&&m.role!=='owner'?`<button class="btn sm" data-member="${m.user_id}">Gérer l’accès</button>`:'—'}</td></tr>`))}</section><div class="notice mt">${icon('info')}Les invitations sont des liens personnels valables 7 jours. Partagez le lien avec le membre concerné ; son adresse e-mail sera vérifiée.</div>`);}
function settingsPage(){return header('Votre espace de travail.','Gérez vos boutiques, votre session et votre affichage.')+`<div class="grid2"><section class="card pad"><h2>Entreprise & boutiques</h2><p class="mt">${esc(S.workspaces.find(w=>w.id===S.workspace)?.name)}</p><div class="stack mt">${S.stores.map(s=>`<button class="queue-item" data-store="${s.id}">${icon('store')}<span class="grow">${esc(s.name)}</span>${s.id===S.store?badge('Sélectionnée','orange'):icon('chevron')}</button>`).join('')}</div>${manager()?btn('Ajouter une boutique','newStore','plus','mt'):''}</section><section class="card pad"><h2>Votre compte</h2><p class="mt">${esc(S.user.email)}</p><p>${esc(roles[S.role])}</p><div class="theme-setting mt">${btn('Changer le thème','dark',document.body.classList.contains('dark')?'sun':'moon')}<span class="muted">${document.body.classList.contains('dark')?'Sombre':'Clair'}</span></div>${btn('Se déconnecter','logout','logout','mt')}</section><section class="card pad"><h2>Sources de commandes</h2><p class="mt">La saisie manuelle accepte les canaux site web, WhatsApp, Messenger, Instagram et téléphone. WooCommerce se connecte dans Intégrations. Les messageries seront raccordées dans les étapes suivantes.</p></section><section class="card pad"><h2>Ce qui est connecté</h2><p class="mt">Commandes, confirmation, rappels, historique, catalogue, réservations de stock, boutiques et permissions. WooCommerce et ZR Express se connectent par boutique.</p><p class="mt">Le reversement COD réel, les variantes et l’attribution publicitaire sont à compléter.</p></section></div>`;}
const FUTURE={shipping:['Préparation des colis et bordereaux','Connexion transporteur et synchronisation des statuts'],returns:['Retours, échanges et remise en stock','Suivi des motifs de refus'],clients:['Annuaire unifié par téléphone','Historique client, doublons et liste noire'],purchases:['Fournisseurs et bons d’achat','Réceptions et coûts d’achat'],finance:['Encaissements COD et rapprochement','Charges, trésorerie et marge'],ads:['UTM et identifiants publicitaires','Attribution jusqu’à la livraison et déduplication Pixel / CAPI'],suite:['Raccordement de votre Suite WordPress','Collecte des commandes et événements de tracking'],messages:['Boîte de réception WhatsApp, Messenger et Instagram','Passage d’une conversation à une commande'],automation:['Affectation automatique et rappels','Règles et scénarios métier'],integrations:['WooCommerce et boutiques externes','Transporteurs et messageries'],pos:['Ventes comptoir','Tickets et sessions de caisse']};
function plannedPage(){return header(TITLES[route],'Ce module sera raccordé au socle CRM dans une prochaine étape.')+`<section class="card pad" style="max-width:850px"><div class="flex mb"><span class="task-icon" style="${tone('orange')}">${icon('link')}</span><div><h2>À connecter progressivement</h2><p>Le parcours de navigation est conservé.</p></div></div><div class="stack">${(FUTURE[route]||[]).map(t=>`<div class="setting-line"><span>${esc(t)}</span>${badge('À venir','gray')}</div>`).join('')}</div><p class="mt">Commencez par vos commandes et votre file de confirmation. Les opérations affichées ici seront activées à mesure que leur backend sera prêt.</p>${btn('Ouvrir les commandes','goOrders','bag','mt primary')}</section>`;}

async function searchProducts(text=''){
 const {data}=await query(supabase.from('crm_products').select('*').eq('store_id',S.store).ilike('name','%'+text.replace(/[\\%_]/g,'\\$&')+'%').order('name').order('id').limit(80));
 data.forEach(p=>productCache.set(p.id,p));return data;
}
function orderLine(i={},options=[]){const selected=productCache.get(i.product_id),all=[...new Map([...(selected?[selected]:[]),...options].map(p=>[p.id,p])).values()];return `<div data-line><div class="order-line"><select name="product_id" required aria-label="Produit"><option value="">Choisir un produit</option>${all.map(p=>`<option value="${p.id}" ${p.id===i.product_id?'selected':''}>${esc(p.name)} · ${esc(p.sku)}</option>`).join('')}</select><input name="quantity" type="number" min="1" max="10000" step="1" value="${i.quantity||1}" required aria-label="Quantité"><input name="unit_price" type="number" min="0" step="0.01" value="${i.unit_price??''}" required ${manager()?'':'readonly'} aria-label="Prix unitaire"><button type="button" class="icon-btn bare" data-remove-line aria-label="Retirer l’article">${icon('close')}</button></div></div>`;}
async function orderForm(id){
 const [o,products]=await Promise.all([id?rpc('crm_order_detail',{p_id:id}):null,searchProducts()]);
 if(id&&!o)throw Error('NOT_FOUND');
 if(!products.length&&!o){modal('Ajoutez votre premier produit',`<p>Une commande doit contenir au moins un produit du catalogue.</p>`,btn('Fermer','close')+(manager()?btn('Créer un produit','newProduct','plus','primary'):''));return;}
 if(o){for(const i of o.items){if(!productCache.has(i.product_id)){const {data}=await query(supabase.from('crm_products').select('*').eq('id',i.product_id).single());productCache.set(data.id,data);}}}
 const data=o||{};
 modal(id?'Modifier #'+code(o):'Nouvelle commande',`<form id="order-form" data-form="order" data-id="${id||''}" data-version="${o?.version||''}"><h3 class="form-section">Client & livraison</h3><div class="form-grid">${field('Nom du client','customer_name',data.customer_name,'text',true,'minlength="2" maxlength="100" autocomplete="name"')}${field('Téléphone','phone',data.phone,'tel',true,'maxlength="25" placeholder="0555 12 34 56" autocomplete="tel"')}${field('Wilaya','wilaya',data.wilaya,'text',true,'minlength="2" maxlength="80"')}${field('Commune','commune',data.commune,'text',false,'maxlength="100"')}${field('Adresse / point de retrait','address',data.address,'text',false,'maxlength="500"')}${selectField('Type de livraison','delivery_type',[['home','Domicile'],['desk','Point de retrait']],data.delivery_type||'home')}</div><h3 class="form-section">Articles</h3><label class="searchbox crm-product-picker">${icon('search')}<input type="search" data-product-search placeholder="Chercher un produit à ajouter…" aria-label="Chercher dans le catalogue"></label><p class="crm-caption mb">La liste affiche jusqu’à 80 résultats. Recherchez un produit pour affiner.</p><div id="order-lines">${(o?.items||[{}]).map(i=>orderLine(i,products)).join('')}</div>${btn('Ajouter un article','addLine','plus','sm mt')}<h3 class="form-section">Source & affectation</h3><div class="form-grid">${selectField('Canal de la commande','channel',Object.entries(CHANNELS),data.channel||'manual')}${manager()&&!id?selectField('Agent','assigned_to',[['','Non attribué'],...S.members.filter(m=>m.active).map(m=>[m.user_id,m.display_name])],''):''}${field('Détail de la source / référence de conversation','source_detail',data.source_detail,'text',false,'maxlength="500"')}${field('Frais de livraison (DA)','fee',data.fee??0,'number',true,'min="0" step="0.01"')}${field('Remise (DA)','discount',data.discount??0,'number',true,'min="0" step="0.01" '+(manager()?'':'readonly'))}</div><div id="duplicate-hint" class="crm-caption mt" aria-live="polite"></div><div class="between mt"><b>Montant COD</b><span id="order-total" class="crm-total">0 DA</span></div><div class="form-error" role="alert"></div></form>`,btn('Annuler','close')+'<button class="btn primary" type="submit" form="order-form">Enregistrer la commande</button>','wide');
 updateOrderTotal();
}
function readItems(form){return [...form.querySelectorAll('[data-line]')].map(row=>({product_id:row.querySelector('[name=product_id]').value,quantity:Number(row.querySelector('[name=quantity]').value),unit_price:Number(row.querySelector('[name=unit_price]').value)}));}
function updateOrderTotal(){const form=$('#order-form');if(!form)return;$('#order-total').textContent=money(orderAmount(readItems(form),form.elements.fee.value,form.elements.discount.value));}
function productForm(id){const p=productCache.get(id)||{};modal(id?'Modifier le produit':'Nouveau produit',`<form id="product-form" data-form="product" data-id="${p.id||''}" data-version="${p.version||''}"><div class="form-grid">${field('Nom du produit','name',p.name,'text',true,'minlength="2" maxlength="160"')}${field('Référence SKU','sku',p.sku,'text',true,'maxlength="80"')}${field('Prix de vente (DA)','price',p.price??0,'number',true,'min="0" step="0.01"')}${!id?field('Stock physique initial','stock',0,'number',true,'min="0" step="1"'):''}</div><div class="form-error" role="alert"></div></form>`,btn('Annuler','close')+'<button class="btn primary" type="submit" form="product-form">Enregistrer</button>');}
function stockForm(id){const p=productCache.get(id);if(!p)return;modal('Ajuster le stock',`<p><b>${esc(p.name)}</b> · ${f(p.stock)} physiques, ${f(p.reserved)} réservés.</p><form id="stock-form" data-form="stock" data-id="${p.id}" data-version="${p.version}"><div class="form-grid mt">${field('Variation (+ entrée / − sortie)','delta','','number',true,'step="1"')}${field('Motif','reason','','text',true,'minlength="2" maxlength="2000"')}</div><p class="crm-caption mt">Les réservations sont protégées. Chaque ajustement est historisé.</p><div class="form-error" role="alert"></div></form>`,btn('Annuler','close')+'<button class="btn primary" form="stock-form">Mettre à jour</button>');}
async function assignForm(id){const o=id?await rpc('crm_order_detail',{p_id:id}):null;if(id&&!o)throw Error('NOT_FOUND');modal(id?'Affecter #'+code(o):'Affecter les commandes sélectionnées',`<form id="assign-form" data-form="assign" data-id="${id||''}" data-version="${o?.version||''}">${selectField('Agent','assigned_to',[['','Non attribué'],...S.members.filter(m=>m.active).map(m=>[m.user_id,m.display_name])],o?.assigned_to||'')}<div class="form-error" role="alert"></div></form>`,btn('Annuler','close')+'<button class="btn primary" form="assign-form">Affecter</button>');}
async function callbackForm(id){const o=await rpc('crm_order_detail',{p_id:id});if(!o)throw Error('NOT_FOUND');modal('Planifier un rappel',`<form id="callback-form" data-form="callback" data-id="${id}" data-version="${o.version}">${field('Date et heure du rappel','callback_at','','datetime-local',true)}<p class="crm-caption mt">Heure de votre appareil : ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}.</p>${field('Note','note','','text',false,'maxlength="2000"')}<div class="form-error" role="alert"></div></form>`,btn('Annuler','close')+'<button class="btn primary" form="callback-form">Planifier</button>');}
function reasonForm(id,version,status){modal(STATUS[status][0],`<form id="reason-form" data-form="status" data-id="${id}" data-version="${version}" data-status="${status}"><label class="field"><span>Motif *</span><textarea name="reason" required minlength="2" maxlength="2000" rows="3"></textarea></label><div class="form-error" role="alert"></div></form>`,btn('Annuler','close')+'<button class="btn primary" form="reason-form">Enregistrer le statut</button>');}
function inviteForm(){modal('Inviter un membre',`<form id="invite-form" data-form="invite"><div class="form-grid">${field('Nom du membre','display_name','','text',true,'minlength="2" maxlength="100"')}${field('Adresse e-mail','email','','email',true,'maxlength="254"')}${selectField('Rôle','role',S.role==='owner'?[['agent','Agent de confirmation'],['admin','Administrateur']]:[['agent','Agent de confirmation']])}</div><p class="crm-caption mt">Vous obtiendrez un lien à partager personnellement avec ce membre.</p><div class="form-error" role="alert"></div></form>`,btn('Annuler','close')+'<button class="btn primary" form="invite-form">Créer le lien d’invitation</button>');}
function memberForm(id){const m=S.members.find(x=>x.user_id===id);if(!m)return;modal('Accès de '+esc(m.display_name),`<form id="member-form" data-form="member" data-id="${m.user_id}">${selectField('Rôle','role',[['agent','Agent de confirmation'],['admin','Administrateur']],m.role)}${selectField('Accès','active',[['true','Actif'],['false','Désactivé']],String(m.active))}<div class="notice mt">${icon('info')}Une désactivation bloque immédiatement les lectures et modifications. Les anciennes commandes restent historisées.</div><div class="form-error" role="alert"></div></form>`,btn('Annuler','close')+'<button class="btn primary" form="member-form">Enregistrer</button>');}
function switchStore(){modal('Choisir votre boutique',`<div class="stack">${S.stores.map(s=>`<button class="queue-item" data-store="${s.id}">${icon('store')}<span class="grow">${esc(s.name)}</span>${s.id===S.store?badge('Active','orange'):icon('chevron')}</button>`).join('')}${S.workspaces.length>1?`<h3>Changer d’entreprise</h3>${S.workspaces.map(w=>`<button class="btn" data-workspace="${w.id}">${esc(w.name)}</button>`).join('')}`:''}</div>`,btn('Fermer','close'));}
async function exportOrders(){
 const seen=new Map();let page=1,total=Infinity;const started=Date.now();
 while(seen.size<total&&page<=1000){const data=await rpc('crm_list_orders',{p_store:S.store,p_status:S.status,p_query:S.q,p_page:page++,p_size:100,p_agent:S.agent||null,p_ascending:S.ascending});total=data.total;for(const o of data.items)if(!seen.has(o.id)&&Date.parse(o.created_at)<=started)seen.set(o.id,o);if(!data.items.length)break;}
 const rows=[...seen.values()];
 const header=['Commande','Client','Téléphone','Wilaya','Commune','Adresse','Canal','Statut','Agent','Montant COD','Créée le'];
 const csv='\ufeff'+[header,...rows.map(o=>[code(o),o.customer_name,o.phone,o.wilaya,o.commune,o.address,CHANNELS[o.channel],STATUS[o.status][0],memberName(o.assigned_to),o.total,new Date(o.created_at).toLocaleString('fr-FR',{timeZone:'Africa/Algiers'})])].map(row=>row.map(csvCell).join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='WeConvert-commandes.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(rows.length+' commandes exportées.');
}
async function mutate(action,payload,form){
 const result=await command(action,payload);closeModal();toast('Modification enregistrée.');await refresh();return result;
}

document.addEventListener('submit',async e=>{
 const form=e.target.closest('form[data-form]');if(!form)return;e.preventDefault();if(S.busy)return;S.busy=true;
 const d=Object.fromEntries(new FormData(form)),type=form.dataset.form;
 const submitters=[...form.querySelectorAll('button[type=submit],button:not([type])'),...document.querySelectorAll(`button[form="${form.id}"]`)];submitters.forEach(b=>b.disabled=true);form.setAttribute('aria-busy','true');
 try{
  if(type.startsWith('youcan')){await youcanSubmit(type,d);}
  else if(type.startsWith('shopify')){await shopifySubmit(type,d);}
  else if(type.startsWith('woo')){await wooSubmit(type,d);}
  else if(type.startsWith('zr')){await zrSubmit(type,d,form);}
  else if(type==='costProduct'||type==='costShipment'||type==='costExpense'||type==='costExpenseDelete'){await submitCost(type,d,form);}
  else if(type==='performance'){await applyPerformanceFilters(d);}
  else if(type==='auth'){
   let result;
   if(S.authMode==='signup'){result=await supabase.auth.signUp({email:d.email.trim(),password:d.password,options:{emailRedirectTo:location.origin+location.pathname}});if(result.error)throw result.error;if(!result.data.session){S.authMode='login';S.authInfo='Consultez votre e-mail pour confirmer le compte, puis revenez ici vous connecter.';authView();}else{S.user=result.data.user;await loadContext();}}
   else if(S.authMode==='reset'){result=await supabase.auth.resetPasswordForEmail(d.email.trim(),{redirectTo:location.origin+location.pathname});if(result.error)throw result.error;S.authInfo='Si ce compte existe, vous recevrez un lien de réinitialisation.';authView();}
   else if(S.authMode==='password'){result=await supabase.auth.updateUser({password:d.password});if(result.error)throw result.error;S.authMode='login';S.user=result.data.user;await loadContext();}
   else{result=await supabase.auth.signInWithPassword({email:d.email.trim(),password:d.password});if(result.error)throw result.error;S.user=result.data.user;S.authInfo='';await loadContext();}
  }else if(type==='workspace'){
   const key='wc-bootstrap-'+S.user.id;let request=sessionStorage.getItem(key);if(!request){request=requestId();sessionStorage.setItem(key,request);}
   const id=await rpc('crm_bootstrap',{p_name:d.name,p_store:d.store,p_display:d.display,p_request:request});sessionStorage.removeItem(key);await loadContext(id);
  }else if(type==='accept'){
   const id=await rpc('crm_accept_invitation',{p_token:sessionStorage.getItem('wc-invitation')});sessionStorage.removeItem('wc-invitation');closeModal();S.store=null;await loadContext(id);
  }else if(type==='order'){
   const payload={...d,store_id:S.store,items:readItems(form),fee:Number(d.fee),discount:Number(d.discount)};
   if(form.dataset.id){payload.id=form.dataset.id;payload.version=Number(form.dataset.version);}
   await mutate(form.dataset.id?'order.edit':'order.create',payload,form);
  }else if(type==='note'){await mutate('order.note',{id:form.dataset.id,version:Number(form.dataset.version),note:d.note.trim()},form);}
  else if(type==='callback'){await mutate('order.callback',{id:form.dataset.id,version:Number(form.dataset.version),callback_at:localInputToISO(d.callback_at),note:d.note},form);}
  else if(type==='status'){await mutate('order.status',{id:form.dataset.id,version:Number(form.dataset.version),status:form.dataset.status,reason:d.reason},form);}
  else if(type==='product'){await mutate('product.save',{...d,store_id:S.store,id:form.dataset.id||null,version:Number(form.dataset.version)||null,price:Number(d.price),stock:Number(d.stock||0)},form);}
  else if(type==='stock'){await mutate('stock.adjust',{store_id:S.store,id:form.dataset.id,version:Number(form.dataset.version),delta:Number(d.delta),reason:d.reason},form);}
  else if(type==='assign'){
   const orders=form.dataset.id?[{id:form.dataset.id,version:Number(form.dataset.version)}]:S.orders.filter(o=>S.selected.has(o.id));
   let done=0;const failures=[];for(const o of orders){try{await command('order.assign',{id:o.id,version:o.version,assigned_to:d.assigned_to||null});S.selected.delete(o.id);done++;}catch(err){failures.push(err);}}
   closeModal();await refresh();toast(done+' commande(s) affectée(s).');if(failures.length)toast(failures.length+' échec(s). '+safeError(failures[0]),'info');
  }else if(type==='store'){
   const result=await command('store.create',{name:d.name});S.store=result.id;closeModal();await loadContext();toast('Boutique créée.');
  }else if(type==='invite'){
   const result=await command('member.invite',d);const link=location.origin+location.pathname+'#join/'+encodeURIComponent(result.token);
   modal('Invitation prête à partager',`<p>Lien réservé à <b>${esc(d.email)}</b>, valable jusqu’au ${esc(time(result.expires_at))}.</p><label class="field mt"><span>Lien d’invitation</span><textarea id="invitation-link" class="crm-invite" readonly>${esc(link)}</textarea></label><p class="crm-caption mt">Aucun e-mail n’a été envoyé. Partagez ce lien personnellement.</p>`,btn('Fermer','close')+btn('Copier le lien','copyInvite','copy','primary'));
  }else if(type==='member'){await command('member.update',{user_id:form.dataset.id,role:d.role,active:d.active==='true'});closeModal();await loadContext();toast('Accès mis à jour.');}
 }catch(error){showError(error,form);}finally{S.busy=false;form.removeAttribute('aria-busy');submitters.forEach(b=>b.disabled=false);}
});

document.addEventListener('click',async e=>{
 const el=e.target.closest('button,a,tr[data-open-order]');if(!el)return;
 if(e.target.closest('input,select,textarea'))return;
 const d=el.dataset;if(el.disabled)return;
 if(d.action||d.youcanRetry||d.authMode||d.nav||d.tab||d.page||d.shippingPage||d.shippingStatus||d.deliveredPage||d.openOrder||d.queue||d.status||d.store||d.workspace||d.reportPreset||d.zrSend||d.zrTrack||d.zrReconcile||d.zrHistory||d.productCost||d.shipmentCost||d.expenseDelete)e.preventDefault();
 if(S.busy&&d.action!=='dark'&&d.action!=='menu'&&d.action!=='wooStop')return;
 try{
  if(d.youcanRetry){S.busy=true;try{const result=await youcanApi('retry_order',{connection_id:S.youcan.id,external_id:d.youcanRetry});toast(result.outcome==='skipped'?(YOUCAN_LABELS[result.code]||result.code):'Commande YouCan réexaminée.');await refresh();}finally{S.busy=false;}return;}
  if(d.action?.startsWith('youcan')){await youcanAction(d.action);return;}
  if(d.action?.startsWith('shopify')){await shopifyAction(d.action);return;}
  if(d.action?.startsWith('woo')){await wooAction(d.action);return;}
  if(d.action?.startsWith('zr')){S.busy=true;try{await zrAction(d.action);}finally{S.busy=false;}return;}
  if(d.zrSend){await zrSendForm(d.zrSend);return;}
  if(d.zrHistory){zrHistory(d.zrHistory);return;}
  if(d.zrReconcile){zrReconcileForm(d.zrReconcile);return;}
  if(d.zrTrack){S.busy=true;try{await zrApi('track',{connection_id:S.zr.id,shipment_id:d.zrTrack});toast('Statut ZR vérifié.');await refresh();}finally{S.busy=false;}return;}
  if(d.productCost){productCostForm(d.productCost);return;}
  if(d.shipmentCost){shipmentCostForm(d.shipmentCost);return;}
 if(d.expenseDelete){expenseDeleteForm(d.expenseDelete);return;}
  if(d.reportPreset){S.reportPreset=d.reportPreset;S.reportFrom=null;S.reportTo=null;S.deliveredPage=1;await refresh();return;}
  if(d.wooRetry){S.busy=true;try{const result=await wooApi('retry',{connection_id:S.woo.id,external_id:Number(d.wooRetry)});toast(result.outcome==='error'?wooLabel(result.code):'Commande réexaminée. Consultez le journal.');await refresh();}finally{S.busy=false;}return;}
  if(d.sourceAck){S.busy=true;try{await rpc('crm_source_ack',{p_order:d.sourceAck,p_version:Number(d.version)});closeModal();toast('Vérification enregistrée.');await refresh();}finally{S.busy=false;}return;}
  if(d.wooAck){S.busy=true;try{await rpc('crm_woo_ack',{p_order:d.wooAck,p_version:Number(d.version)});closeModal();toast('Vérification enregistrée.');await refresh();}finally{S.busy=false;}return;}
  if(d.authMode){S.authMode=d.authMode;S.authInfo='';authView();return;}
  if(el.matches('a.nav-link,a.brand')){e.preventDefault();closeModal();const [r,t]=el.getAttribute('href').slice(1).split('/');navigate(r,t||'');return;}
  if(d.nav){closeModal();const [r,t]=d.nav.split('/');navigate(r,t||'');return;}
  if(d.tab){S.status=d.tab;S.page=1;S.selected.clear();navigate(route,d.tab);return;}
  if(d.page){S.page=Math.max(1,Number(d.page));S.selected.clear();await refresh();return;}
  if(d.deliveredPage){S.deliveredPage=Math.max(1,Number(d.deliveredPage));await refresh();$('#delivered-period')?.scrollIntoView({block:'start'});return;}
  if(d.shippingPage){S.shippingPage=Math.max(1,Number(d.shippingPage));await refresh();return;}
  if(d.shippingStatus){if(!['all','delivered','returned','other'].includes(d.shippingStatus))return;S.shippingStatus=d.shippingStatus;S.shippingPage=1;await refresh();return;}
  if(d.store){if(!S.stores.some(x=>x.id===d.store))return;S.store=d.store;S.page=1;S.q='';S.queueId=null;S.shippingPage=1;S.shippingStatus='all';S.deliveredPage=1;S.deliveredPeriod=null;S.dashboardDelivered=null;S.zrScanPage=1;S.selected.clear();productCache.clear();localStorage.setItem('wc-store-'+S.user.id+'-'+S.workspace,S.store);closeModal();await refresh();return;}
  if(d.workspace){if(!(S.workspaces||[]).some(w=>w.id===d.workspace))return;S.workspace=d.workspace;S.store=null;S.reportAgent='';S.reportChannel='';S.reportData=null;S.deliveryReport=null;S.expenses=[];S.agent='';S.q='';S.page=1;S.queueId=null;S.detail=null;S.shippingPage=1;S.shippingStatus='all';S.deliveredPage=1;S.deliveredPeriod=null;S.dashboardDelivered=null;S.zrScanPage=1;productCache.clear();S.selected.clear();closeModal();await loadContext(d.workspace);return;}
  if(d.openOrder){await openOrder(d.openOrder);return;}
  if(d.editOrder){await orderForm(d.editOrder);return;}
  if(d.editProduct){productForm(d.editProduct);return;}
  if(d.stock){stockForm(d.stock);return;}
  if(d.member){memberForm(d.member);return;}
  if(d.queue){S.queueId=d.queue;await refresh();return;}
  if(d.assign){await assignForm(d.assign);return;}
  if(d.callback){await callbackForm(d.callback);return;}
  if(d.status){if(['cancelled','duplicate','fake','new'].includes(d.status)){reasonForm(d.id,d.version,d.status);return;}S.busy=true;try{await mutate('order.status',{id:d.id,version:Number(d.version),status:d.status});}finally{S.busy=false;}return;}
  if(d.call){S.busy=true;try{await mutate('order.call',{id:d.call,version:Number(d.version)});}finally{S.busy=false;}return;}
  if(d.removeLine!==undefined){if($$('#order-lines [data-line]').length>1){el.closest('[data-line]').remove();updateOrderTotal();}return;}
  const actions={
   close:closeModal,menu:()=>{const open=$('#sidebar').classList.toggle('open');$('[aria-controls=sidebar]')?.setAttribute('aria-expanded',String(open));},
   dark:()=>{localStorage.setItem('wc-theme',document.body.classList.contains('dark')?'light':'dark');applyTheme();if(S.user&&S.workspace){topbar();if(route==='settings')render();}else if(S.user)onboardingView();else authView();},
   refresh:()=>refresh(),reportExport:exportPerformance,showDeliveredPeriod:()=>{const heading=$('#delivered-period-title');heading?.scrollIntoView({block:'start',behavior:'smooth'});heading?.focus({preventScroll:true});},goDeliveredReport:()=>{S.reportPreset='7';S.reportFrom=null;S.reportTo=null;S.reportChannel='';S.reportAgent='';S.deliveredPage=1;navigate('performance');},newOrder:()=>orderForm(),newProduct:()=>productForm(),invite:inviteForm,switchStore,
   goOrders:()=>navigate('orders'),goTeam:()=>navigate('team'),sort:()=>{S.ascending=!S.ascending;S.page=1;return refresh();},
   clearSelection:()=>{S.selected.clear();render();},bulkAssign:()=>assignForm(),
   newStore:()=>modal('Ajouter une boutique',`<form id="store-form" data-form="store">${field('Nom de la boutique','name','','text',true,'minlength="2" maxlength="100"')}<div class="form-error" role="alert"></div></form>`,btn('Annuler','close')+'<button class="btn primary" form="store-form">Créer la boutique</button>'),
   addLine:async()=>{const products=await searchProducts($('[data-product-search]')?.value||'');$('#order-lines')?.insertAdjacentHTML('beforeend',orderLine({},products));updateOrderTotal();},
   copyInvite:async()=>{const el=$('#invitation-link');try{await navigator.clipboard.writeText(el.value);toast('Lien copié.');}catch{el.select();toast('Sélectionnez puis copiez le lien.','info');}},
   discardInvite:()=>{sessionStorage.removeItem('wc-invitation');onboardingView();},
   logout:async()=>{const {error}=await supabase.auth.signOut({scope:'local'});if(error)throw error;clearSession();authView();},
   exportOrders:async()=>{S.busy=true;try{await exportOrders();}finally{S.busy=false;}}
  };
  if(d.action&&actions[d.action])await actions[d.action]();
 }catch(error){showError(error);}
});
document.addEventListener('change',async e=>{
 const d=e.target.dataset;
 if(e.target.matches('#zr-connect [name=platform]')){zrPlatformFields();return;}
 if(d.zrCity!==undefined){const form=e.target.closest('#zr-send'),id=form?.dataset.id,select=e.target;const box=$('#zr-district');if(!id||!box)return;box.innerHTML=loader('Communes ZR…');try{const r=await zrApi('locations',{connection_id:S.zr.id,order_id:id,city_id:select.value});if(form.isConnected&&select.value===r.cityId)box.innerHTML=zrDistrictField(r.districts,r.districtId);}catch(err){showError(err,form);}return;}
 if(d.wooScope!==undefined){const period=$('#woo-period'),enabled=e.target.value==='period';if(period){period.hidden=!enabled;period.querySelectorAll('input').forEach(input=>input.disabled=!enabled);}return;}
 if(d.select!==undefined){e.target.checked?S.selected.add(d.select):S.selected.delete(d.select);render();}
 if(d.selectAll!==undefined){S.orders.forEach(o=>e.target.checked?S.selected.add(o.id):S.selected.delete(o.id));render();}
 if(d.agentFilter!==undefined){S.agent=e.target.value;S.page=1;S.selected.clear();await refresh();}
 if(e.target.name==='product_id'&&e.target.closest('[data-line]')){const p=productCache.get(e.target.value);e.target.closest('[data-line]').querySelector('[name=unit_price]').value=p?.price??'';updateOrderTotal();}
});
let productSearchTimer,phoneTimer;
document.addEventListener('input',e=>{
 const el=e.target;
 if(el.matches('[data-search]')){clearTimeout(searchTimer);S.q=el.value;searchTimer=setTimeout(async()=>{S.page=1;S.selected.clear();const end=el.selectionStart;await refresh({quiet:true});const next=$('[data-search]');next?.focus();next?.setSelectionRange(end,end);},350);}
 if(el.closest('#order-form'))updateOrderTotal();
 if(el.matches('[data-product-search]')){clearTimeout(productSearchTimer);productSearchTimer=setTimeout(async()=>{try{const text=el.value,products=await searchProducts(text);if(el.value!==text||!el.isConnected)return;$$('#order-lines select[name=product_id]').forEach(select=>{const chosen=productCache.get(select.value);const all=[...new Map([...(chosen?[chosen]:[]),...products].map(p=>[p.id,p])).values()];const value=select.value;select.innerHTML='<option value="">Choisir un produit</option>'+all.map(p=>`<option value="${p.id}" ${p.id===value?'selected':''}>${esc(p.name)} · ${esc(p.sku)}</option>`).join('');});}catch(err){showError(err);}},300);}
 if(el.name==='phone'&&el.closest('#order-form')){clearTimeout(phoneTimer);phoneTimer=setTimeout(async()=>{let phone=el.value.replace(/[\s().-]/g,'');if(/^0[567]\d{8}$/.test(phone))phone='+213'+phone.slice(1);if(!/^\+\d{8,15}$/.test(phone))return;try{const result=await rpc('crm_list_orders',{p_store:S.store,p_query:phone,p_size:100});const own=el.closest('form')?.dataset.id;const others=result.items.filter(o=>o.id!==own);const box=$('#duplicate-hint');if(box)box.textContent=others.length?`${others.length} commande(s) visible(s) utilisent déjà ce numéro. Vérifiez avant de créer un doublon.`:'';}catch{}},450);}
});
document.addEventListener('click',e=>{if(e.target.classList.contains('overlay')&&!S.busy)closeModal();});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&!S.busy)closeModal();
 const modalEl=$('.modal');if(e.key==='Tab'&&modalEl){const list=[...modalEl.querySelectorAll('button:not(:disabled),a,input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(x=>x.offsetParent!==null);const first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
});
function clearSession(){liveSync.stop();++authSequence;++loadSequence;S.user=null;S.workspace=null;S.store=null;S.role=null;S.orders=[];S.products=[];S.members=[];S.stores=[];S.workspaces=[];S.overview={};S.detail=null;S.queueId=null;S.q='';S.selected.clear();productCache.clear();requests.clear();S.woo=null;S.wooEvents=[];S.youcanAlerts=[];S.zr=null;S.shipping=null;S.reportData=null;S.deliveryReport=null;S.deliveredPeriod=null;S.dashboardDelivered=null;S.deliveredPage=1;S.productCosts=[];S.shipmentCosts=[];S.expenses=[];S.shippingPage=1;S.shippingStatus='all';S.shippingTotal=0;S.zrScanPage=1;S.reportAgent='';S.reportChannel='';wooStop=true;$('#content').innerHTML='';$('#sidebar').innerHTML='';$('#topbar').innerHTML='';closeModal();}
window.addEventListener('hashchange',()=>{readRoute();S.status=route==='confirmation'?(tab==='due'?'due':'pending'):route==='orders'?(tab||'all'):'all';S.page=1;S.q='';S.agent='';S.selected.clear();refresh();});
supabase.auth.onAuthStateChange((event,session)=>{
 if(event==='SIGNED_OUT'){clearSession();authView();}
 if(event==='PASSWORD_RECOVERY'){S.user=session?.user;S.authMode='password';setTimeout(authView,0);}
 if(event==='SIGNED_IN'&&session?.user.id!==S.user?.id){setTimeout(async()=>{S.user=session.user;try{await loadContext();}catch(error){S.authInfo=safeError(error);authView();}},0);}
});
window.addEventListener('offline',()=>{updateLiveBadge();toast('Connexion interrompue. Vos saisies ne sont pas envoyées automatiquement.','info');});
window.addEventListener('online',()=>{updateLiveBadge();liveSync.invalidate();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')liveSync.invalidate();});
window.addEventListener('pageshow',()=>liveSync.invalidate());
// Reconcile after reconnects and advance due callbacks; WebSocket events drive immediate updates.
setInterval(()=>{if(S.user&&S.workspace&&document.visibilityState==='visible')liveSync.invalidate();},30000);
async function start(){
 applyTheme();readRoute();S.status=route==='confirmation'?(tab==='due'?'due':'pending'):route==='orders'?(tab||'all'):'all';
 {const oauth=/^#oauth\/(shopify|youcan)\/([a-f0-9]{64})$/.exec(location.hash);if(oauth){try{sessionStorage.setItem('wc-oauth',JSON.stringify({provider:oauth[1],ticket:oauth[2]}));}catch{}history.replaceState(null,'',location.pathname+location.search+'#integrations');readRoute();}}
 if(location.hash.startsWith('#join/')){try{sessionStorage.setItem('wc-invitation',decodeURIComponent(location.hash.slice(6)));}catch{S.authInfo='Lien d’invitation illisible. Demandez un nouveau lien.';}history.replaceState(null,'',location.pathname+location.search+'#dashboard');readRoute();}
 $('#auth-root').innerHTML='<div class="auth-shell"><section class="card auth-card">'+loader('Ouverture de WeConvert…')+'</section></div>';
 try{const {data,error}=await supabase.auth.getSession();if(error)throw error;if(data.session){const result=await supabase.auth.getUser();if(result.error)throw result.error;S.user=result.data.user;if(S.authMode!=='password')await loadContext();}else authView();}catch(error){S.authInfo=safeError(error);authView();}
}
// Patch changing regions only: search/filter controls and modal forms keep their DOM identity.
function renderLive(){
 if(!S.user||!S.workspace||S.error||!$('#content')?.children.length)return false;
 const views={dashboard:dashboardPage,performance:performancePage,orders:ordersPage,confirmation:confirmationPage,products:productsPage,team:teamPage,settings:settingsPage,integrations:integrationsPage};
 const next=document.createElement('div');next.innerHTML=(views[route]||plannedPage)();
 const selectors={orders:['.tabs','[data-live-selection]','.crm-order-list','.table-foot'],dashboard:['.kpis','.overview-row','.crm-order-list','.grid2.mt'],performance:['.report-kpis','.delivered-period','.report-analysis','.report-breakdowns','.delivery-report'],confirmation:['.grid3.mb','.tabs','.queue-list','.table-foot','.panel-columns>section:last-child'],products:['.table-scroll','.table-foot']};
 if(!selectors[route])return false;
 if(route==='orders'){
  const oldAlert=$('#content [data-source-anomalies]'),newAlert=next.querySelector('[data-source-anomalies]');
  if(oldAlert&&newAlert)oldAlert.replaceWith(newAlert);
  else if(oldAlert)oldAlert.remove();
  else if(newAlert)$('#content .tabs')?.before(newAlert);
 }
 for(const selector of selectors[route]){
  const old=$('#content').querySelector(selector),fresh=next.querySelector(selector);if(!old||!fresh)continue;
  const scroller=old.matches('.table-scroll')?old:old.querySelector('.table-scroll');
  const left=scroller?.scrollLeft||0,top=old.scrollTop;
  const focused=document.activeElement;
  const drafts=[...old.querySelectorAll('form[data-form]')].map(form=>({form:form.dataset.form,id:form.dataset.id||'',values:[...form.elements].filter(x=>x.name&&x.type!=='file'&&x.type!=='submit').map(x=>[x.name,x.type==='checkbox'||x.type==='radio'?x.checked:x.value]),focus:form.contains(focused)?focused.name:null,start:form.contains(focused)?focused.selectionStart:null,end:form.contains(focused)?focused.selectionEnd:null}));
  const openDetails=[...old.querySelectorAll('details')].map(x=>x.open);
  old.replaceWith(fresh);
  [...fresh.querySelectorAll('details')].forEach((x,i)=>{if(openDetails[i])x.open=true;});fresh.scrollTop=top;
  const newScroller=fresh.matches('.table-scroll')?fresh:fresh.querySelector('.table-scroll');if(newScroller)newScroller.scrollLeft=left;
  for(const d of drafts){const target=[...fresh.querySelectorAll(`form[data-form="${CSS.escape(d.form)}"]`)].find(x=>(x.dataset.id||'')===d.id);if(!target)continue;for(const [name,value] of d.values){const el=target.elements[name];if(!el||el instanceof RadioNodeList)continue;if(el.type==='checkbox'||el.type==='radio')el.checked=value;else el.value=value;}if(d.focus){const el=target.elements[d.focus];if(el&&!(el instanceof RadioNodeList)){el.focus({preventScroll:true});try{if(d.start!==null)el.setSelectionRange(d.start,d.end);}catch{}}}}
 }
 for(const [id,value] of Object.entries({orders:S.overview.all,confirmation:S.overview.pending})){const el=$(`[data-live-counter="${id}"]`);if(el)el.textContent=f(value);}
 const footer=$('#content .bottom-foot span:last-child');if(footer)footer.textContent='Actualisé à '+new Date(S.lastSync).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+' · '+(manager()?'Boutique sélectionnée':'Vos commandes affectées');
 if(lastLiveSignal){const content=$('#content');content.dataset.liveRevision=lastLiveSignal.revision||'';content.dataset.liveRenderMs=String(Math.round(performance.now()-lastLiveSignal.receivedAt));content.dataset.liveRenderedAt=new Date().toISOString();lastLiveSignal=null;}
 updateLiveBadge();return true;
}

start();
