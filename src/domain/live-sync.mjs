// One protected store signal subscription. Business rows are always fetched through the API/RLS.
export function createLiveSync({client,onChange,onState=()=>{},onSignal=()=>{},schedule=setTimeout,cancel=clearTimeout,delay=16}){
 let context=null,key='',channel=null,epoch=0,timer=null,retry=null,running=false,dirty=false,attempts=0;
 const state=s=>onState(s);
 function remove(){const old=channel;channel=null;if(old)Promise.resolve(client.removeChannel(old)).catch(()=>{});}
 function stop(){++epoch;if(timer!==null)cancel(timer);if(retry!==null)cancel(retry);timer=retry=null;remove();context=null;key='';dirty=false;running=false;attempts=0;state('idle');}
 function plan(wait=delay){if(timer!==null||running||!context)return;const version=epoch;timer=schedule(()=>{timer=null;if(version===epoch)void flush();},wait);}
 function invalidate(){if(!context)return;dirty=true;plan();}
 async function flush(){
  if(running||!dirty||!context)return;const version=epoch,snapshot=context;dirty=false;running=true;let nextDelay=delay;
  try{if(await onChange(snapshot)===false){dirty=true;nextDelay=100;}}catch{if(version===epoch){dirty=true;nextDelay=2000;}}
  finally{if(version===epoch){running=false;if(dirty)plan(nextDelay);}}
 }
 function connect(){
  if(!context)return;if(timer!==null)cancel(timer);timer=null;const version=++epoch;remove();state('connecting');
  const current=()=>version===epoch;
  channel=client.channel('crm-live:'+context.userId+':'+context.storeId+':'+version)
   .on('postgres_changes',{event:'*',schema:'public',table:'crm_live_stores',filter:'store_id=eq.'+context.storeId},payload=>{if(current()){onSignal({revision:payload.new?.revision,commitTimestamp:payload.commit_timestamp});invalidate();}})
   .on('system',{},payload=>{if(current()&&payload.extension==='postgres_changes'&&payload.status==='ok')invalidate();})
   .subscribe(status=>{
    if(!current())return;
    if(status==='SUBSCRIBED'){if(retry!==null)cancel(retry);retry=null;attempts=0;state('connected');invalidate();}
    else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){
     state('retrying');if(retry!==null)return;
     retry=schedule(()=>{retry=null;if(!current())return;running=false;dirty=false;connect();},Math.min(15000,1000*2**Math.min(attempts++,4)));
    }
   });
 }
 function watch(next){
  const nextKey=next&&[next.userId,next.workspaceId,next.storeId].join(':');
  if(!nextKey||!next.userId||!next.workspaceId||!next.storeId){if(key)stop();return;}
  if(key===nextKey)return;stop();context={...next};key=nextKey;connect();
 }
 return {watch,stop,invalidate,get active(){return !!context;}};
}
