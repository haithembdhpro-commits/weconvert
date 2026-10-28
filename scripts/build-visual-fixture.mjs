/* Local preview only. dist/_qa-visual.* is ignored and never deployed. */
import {readFile,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
const root=new URL('../',import.meta.url);
const get=path=>readFile(new URL(path,root),'utf8');
const fixture=String.raw`
const CONFIG={url:'https://visual.invalid',key:'visual-only'};
const qaUser={id:'visual-owner',email:'visual@weconvert.invalid'};
const qaStore='visual-store',qaWorkspace='visual-workspace';
const today=new Date();
const day=i=>{const d=new Date(today);d.setDate(d.getDate()+i);return d.toISOString().slice(0,10)};
const sample=(number,name,status,amount,channel,wilaya,product)=>({
 id:'40000000-0000-4000-8000-'+String(number).padStart(12,'0'),number,
 customer_name:name,phone:'+2135550000'+String(number).padStart(2,'0'),
 wilaya,commune:'Commune de test',address:'Adresse de test',delivery_type:'home',channel,
 status,total:amount,fee:500,discount:0,version:1,
 created_at:new Date(today.getTime()-number*600000).toISOString(),
 callback_at:status==='reported'?new Date(today.getTime()-3600000).toISOString():null,
 assigned_to:'visual-owner',events:[],items:[{product_name:product,quantity:1,unit_price:amount-500,sku:'VIS-'+number}]
});
const records=[
 sample(24,'Client de démonstration A','new',4600,'website','Alger','Pack livres'),
 sample(23,'Client de démonstration B','call1',3900,'whatsapp','Oran','Coffret édition'),
 sample(22,'Client de démonstration C','reported',5500,'phone','Constantine','Collection'),
 sample(21,'Client de démonstration D','confirmed',6800,'website','Blida','Pack premium'),
 sample(20,'Client de démonstration E','cancelled',2900,'instagram','Tizi Ouzou','Livre relié')
];
const tables={
 crm_members:[{user_id:qaUser.id,workspace_id:qaWorkspace,display_name:'Haithem',role:'owner',active:true}],
 crm_workspaces:[{id:qaWorkspace,name:'WeConvert'}],
 crm_stores:[{id:qaStore,name:'Boutique COD',workspace_id:qaWorkspace}],
 crm_products:[{id:'p1',store_id:qaStore,name:'Pack livres',sku:'VIS-24',price:4100,stock:25,reserved:3},{id:'p2',store_id:qaStore,name:'Collection',sku:'VIS-22',price:5000,stock:13,reserved:1}],
 crm_integrations:[{id:'50000000-0000-4000-8000-000000000001',store_id:qaStore,active:true,base_url:'https://boutique.example',last_test_at:new Date().toISOString(),last_sync_at:new Date().toISOString(),last_catalog_sync_at:new Date().toISOString(),last_webhook_at:new Date().toISOString(),import_done:true,catalog_done:true,import_scanned:128,catalog_scanned:46}],
 crm_integration_events:[{store_id:qaStore,connection_id:'50000000-0000-4000-8000-000000000001',entity:'order',external_id:204,created_at:new Date().toISOString(),outcome:'imported',code:'ORDER_IMPORTED',order_id:records[0].id},{store_id:qaStore,connection_id:'50000000-0000-4000-8000-000000000001',entity:'product',external_id:42,created_at:new Date().toISOString(),outcome:'updated',code:'PRODUCT_UPDATED'}],
 crm_shipping_connections:[{id:'50000000-0000-4000-8000-000000000002',store_id:qaStore,active:true,platform:'new',last_test_at:new Date().toISOString()}],
 crm_product_costs:[{product_id:'p1',store_id:qaStore,unit_cost:2300}],
 crm_shipment_costs:[{shipment_id:'50000000-0000-4000-8000-000000000003',store_id:qaStore,delivery_cost:450,return_cost:0,other_cost:0}],
 crm_cost_entries:[{id:'exp1',store_id:qaStore,spent_on:day(-2),kind:'ads',amount:2500,note:'Campagne test'}]
};
function sampleReport(args){
 const days=[];let cursor=new Date(args.p_from+'T00:00:00Z');const end=new Date(args.p_to+'T00:00:00Z');
 for(let i=0;cursor<=end&&i<366;i++,cursor=new Date(cursor.getTime()+86400000)){
  const orders=(i%7===0?14:4+i%5)*(args.p_channel?0.45:1);
  const count=Math.round(orders),confirmed=Math.round(count*.65),cancelled=Math.floor(count*.12);
  days.push({date:cursor.toISOString().slice(0,10),orders:count,confirmed,cancelled});
 }
 const orders=days.reduce((n,x)=>n+x.orders,0),confirmed=days.reduce((n,x)=>n+x.confirmed,0),cancelled=days.reduce((n,x)=>n+x.cancelled,0);
 const summary={orders,confirmed,cancelled,pending:orders-confirmed-cancelled,duplicate:0,fake:0,confirmed_amount:confirmed*4600};
 const channels=args.p_channel?[{channel:args.p_channel,orders,confirmed,cancelled,confirmed_amount:summary.confirmed_amount}]:[
  {channel:'website',orders:Math.round(orders*.7),confirmed:Math.round(confirmed*.7),cancelled:Math.round(cancelled*.7),confirmed_amount:Math.round(summary.confirmed_amount*.7)},
  {channel:'whatsapp',orders:Math.round(orders*.2),confirmed:Math.round(confirmed*.2),cancelled:Math.round(cancelled*.2),confirmed_amount:Math.round(summary.confirmed_amount*.2)},
  {channel:'phone',orders:orders-Math.round(orders*.7)-Math.round(orders*.2),confirmed:confirmed-Math.round(confirmed*.7)-Math.round(confirmed*.2),cancelled:cancelled-Math.round(cancelled*.7)-Math.round(cancelled*.2),confirmed_amount:summary.confirmed_amount-Math.round(summary.confirmed_amount*.7)-Math.round(summary.confirmed_amount*.2)}
 ];
 return {period:{from:args.p_from,to:args.p_to,timezone:'Africa/Algiers'},summary,days,channels,
  wilayas:[{wilaya:'Alger',orders:Math.round(orders*.5),confirmed:Math.round(confirmed*.5)},{wilaya:'Oran',orders:Math.round(orders*.3),confirmed:Math.round(confirmed*.3)},{wilaya:'Constantine',orders:Math.round(orders*.2),confirmed:Math.round(confirmed*.2)}],
  products:[{product_id:'p1',name:'Pack livres',sku:'VIS-24',orders:64,units:71,confirmed_units:49,confirmed_lines_amount:200900},{product_id:'p2',name:'Collection',sku:'VIS-22',orders:32,units:35,confirmed_units:24,confirmed_lines_amount:120000}],
  agents:[{assigned_to:qaUser.id,name:'Haithem',orders:Math.round(orders*.6),confirmed:Math.round(confirmed*.6),cancelled:Math.round(cancelled*.6),confirmed_amount:Math.round(summary.confirmed_amount*.6)},{assigned_to:null,name:'Non attribué',orders:orders-Math.round(orders*.6),confirmed:confirmed-Math.round(confirmed*.6),cancelled:cancelled-Math.round(cancelled*.6),confirmed_amount:summary.confirmed_amount-Math.round(summary.confirmed_amount*.6)}]};
}
function createClient(){return {
 functions:{invoke:async()=>({data:{error:'Action désactivée dans la prévisualisation locale'},error:null})},
 auth:{getSession:async()=>({data:{session:{user:qaUser}},error:null}),getUser:async()=>({data:{user:qaUser},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 channel(){const channel={on(){return channel},subscribe(callback){setTimeout(()=>callback('SUBSCRIBED'),0);return channel}};return channel},
 removeChannel(){return Promise.resolve()},
 from(table){let rows=[...(tables[table]||[])],single=false;
  const q={select(){return q},eq(key,value){rows=rows.filter(item=>item[key]===value);return q},
   ilike(key,pattern){const term=pattern.replaceAll('%','').toLowerCase();rows=rows.filter(item=>String(item[key]||'').toLowerCase().includes(term));return q},
   order(){return q},gte(key,value){rows=rows.filter(item=>item[key]>=value);return q},lte(key,value){rows=rows.filter(item=>item[key]<=value);return q},
   range(start,end){rows=rows.slice(start,end+1);return q},limit(count){rows=rows.slice(0,count);return q},
   maybeSingle(){single=true;return q},then(resolve){return Promise.resolve({data:single?rows[0]??null:rows,count:rows.length,error:null}).then(resolve)}};
  return q;
 },
 rpc:async(name,args)=>{
  if(name==='crm_shipping_dashboard')return {data:{queue:[{...records[3],items:[{name:'Pack premium',quantity:1}]}],shipments:[{id:'50000000-0000-4000-8000-000000000003',order_id:records[2].id,number:22,customer_name:records[2].customer_name,wilaya:'Constantine',commune:'Centre',reference:'WC22-visual',platform:'legacy',state:'in_transit',tracking:'WC22-visual',raw_status:'En transit',cod_amount:5500,sent_at:new Date(today.getTime()-86400000).toISOString(),last_checked_at:new Date().toISOString(),events:[{state:'in_transit',raw_status:'En transit',kind:'status.changed',created_at:new Date().toISOString()},{state:'submitted',raw_status:'En préparation',kind:'send.accepted',created_at:new Date(today.getTime()-86400000).toISOString()}]}]},error:null};
  if(name==='crm_shipping_filtered_page')return {data:{total:args.p_status==='all'?51:args.p_status==='delivered'?1:0,shipments:args.p_status==='returned'||args.p_status==='other'?[]:[{id:'50000000-0000-4000-8000-000000000003',order_id:records[2].id,number:22,woo_number:'345',customer_name:records[2].customer_name,wilaya:'Constantine',commune:'Centre',reference:'WC22-visual',platform:'new',state:args.p_status==='delivered'||args.p_page===2?'delivered':'in_transit',tracking:'WC22-visual',raw_status:args.p_status==='delivered'||args.p_page===2?'Livré':'En transit',cod_amount:5500,delivery_cost:args.p_page===1?450:null,return_cost:0,other_cost:0,sent_at:new Date(today.getTime()-86400000).toISOString(),last_checked_at:new Date().toISOString(),events:[{state:'in_transit',raw_status:'En transit',kind:'status.changed',created_at:new Date().toISOString()}]}]},error:null};
  if(name==='crm_delivered_period_page'){
   const orderDay=algerToday(new Date(records[2].created_at));
   const inPeriod=args.p_from<=orderDay&&args.p_to>=orderDay,allowedChannel=!args.p_channel||args.p_channel==='phone',allowedAgent=!args.p_agent||args.p_agent===qaUser.id;
   const row={id:'50000000-0000-4000-8000-000000000003',order_id:records[2].id,number:22,woo_number:'345',customer_name:records[2].customer_name,wilaya:'Constantine',channel:'phone',state:'delivered',cod_amount:5500,created_at:records[2].created_at};
   return {data:{total:inPeriod&&allowedChannel&&allowedAgent?1:0,orders:inPeriod&&allowedChannel&&allowedAgent&&args.p_page===1?[row]:[]},error:null};
  }
  if(name==='crm_performance')return {data:sampleReport(args),error:null};
  if(name==='crm_delivery_performance'){
   const perf=sampleReport(args),orderDay=algerToday(new Date(records[2].created_at));
   const delivered=args.p_from<=orderDay&&args.p_to>=orderDay&&(!args.p_channel||args.p_channel==='phone')?1:0;
   return {data:{summary:{orders:perf.summary.orders,woo_orders:Math.round(perf.summary.orders*.7),shipped:delivered,delivered,woo_delivered:delivered,returned:0,delivery_issues:0,delivered_cod:5500*delivered,known_product_cost:0,known_shipping_cost:450*delivered,missing_product_cost:delivered,missing_shipping_cost:0,contribution:null,after_recorded_expenses:null,ads_recorded:2500,operations_recorded:0},channels:perf.channels.map(x=>({channel:x.channel,orders:x.orders,shipped:x.channel==='phone'?delivered:0,delivered:x.channel==='phone'?delivered:0,returned:0,delivered_cod:x.channel==='phone'?5500*delivered:0}))},error:null};
  }
  if(name==='crm_overview')return {data:{all:128,new:18,pending:23,confirmed:83,cancelled:4,today:12,due:7,callbacks:14,confirmed_amount:381800,
   days:[5,8,4,10,7,12,9].map((count,i)=>({date:day(i-6),count}))},error:null};
  if(name==='crm_list_orders'){
   let rows=records.filter(o=>args.p_status==='all'||!args.p_status||args.p_status==='pending'&&['new','call1','call2','call3','reported','check'].includes(o.status)||args.p_status==='due'&&o.callback_at||args.p_status===o.status||args.p_status==='cancelled_all'&&o.status==='cancelled');
   if(args.p_query)rows=rows.filter(o=>[o.customer_name,o.phone,o.wilaya,String(o.number)].some(x=>x.toLowerCase().includes(args.p_query.toLowerCase())));
   return {data:{items:rows.slice(0,args.p_size||20),total:rows.length},error:null};
  }
  if(name==='crm_order_detail')return {data:records.find(o=>o.id===args.p_id)||null,error:null};
  return {data:null,error:{message:'Action désactivée dans la prévisualisation locale'}};
 }
}}
`;
const entry="import {createLiveSync} from './src/live-sync.mjs';\nimport {renderIcon} from './src/icon-registry.mjs';\nimport {STATUS,PENDING,CHANNELS,initialsOf,orderAmount,csvCell,localInputToISO,errorMessage,requestId} from './src/domain.mjs';\nimport {algerToday,reportRange,reportRate,reportBuckets} from './src/report-domain.mjs';\n"+fixture+'\n'+await get('src/ui.js')+'\n'+await get('src/woocommerce-ui.js')+'\n'+await get('src/performance-ui.js')+'\n'+await get('src/finance-ui.js')+'\n'+await get('src/shipping-ui.js')+'\n'+await get('src/crm.js');
await build({stdin:{contents:entry,resolveDir:new URL('../',import.meta.url).pathname,sourcefile:'visual-qa-entry.js'},bundle:true,format:'iife',target:['es2022'],outfile:new URL('dist/_qa-visual.js',root).pathname,minify:false});
await writeFile(new URL('dist/_qa-visual.html',root),(await get('dist/index.html')).replace('./app.js','./_qa-visual.js'));
console.log('Built local visual QA fixture; no hosted connection.');
