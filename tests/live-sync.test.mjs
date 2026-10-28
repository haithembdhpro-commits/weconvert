import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveSync} from '../src/live-sync.mjs';
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function setup(onChange=async()=>{}){
 let id=0;const tasks=new Map(),channels=[],states=[];
 const client={channel(name){const c={name,events:{},on(event,filter,callback){c.events[event]={filter,callback};return c;},subscribe(callback){c.status=callback;return c;}};channels.push(c);return c;},removeChannel(c){c.removed=true;return Promise.resolve();}};
 const sync=createLiveSync({client,onChange,onState:s=>states.push(s),schedule:(fn,delay)=>{tasks.set(++id,{fn,delay});return id;},cancel:key=>tasks.delete(key)});
 const run=async()=>{const entry=tasks.entries().next().value;if(entry){tasks.delete(entry[0]);entry[1].fn();await tick();}};
 return {sync,channels,states,tasks,run};
}
const context={userId:'user-a',workspaceId:'w-a',storeId:'s-a'};
test('events refresh through the API with a store filter; bursts coalesce',async()=>{
 let calls=0;const t=setup(async c=>{assert.deepEqual(c,context);calls++;});t.sync.watch(context);
 const c=t.channels[0];assert.equal(c.events.postgres_changes.filter.table,'crm_live_stores');assert.equal(c.events.postgres_changes.filter.filter,'store_id=eq.s-a');
 for(let i=0;i<50;i++)c.events.postgres_changes.callback({new:{}});
 assert.equal(t.tasks.size,1);assert.equal([...t.tasks.values()][0].delay,16);await t.run();assert.equal(calls,1);
});
test('one catch-up runs after an event received during an in-flight refresh',async()=>{
 let done,calls=0;const t=setup(()=>{calls++;return new Promise(resolve=>{done=resolve;});});t.sync.watch(context);t.sync.invalidate();await t.run();
 t.channels[0].events.postgres_changes.callback({});assert.equal(t.tasks.size,0);done();await tick();assert.equal(t.tasks.size,1);
 await t.run();assert.equal(calls,2);done();await tick();t.sync.stop();
});
test('subscription/reconnection catches up; a late SDK reconnect cancels the extra retry',async()=>{
 let calls=0;const t=setup(async()=>{calls++;});t.sync.watch(context);const c=t.channels[0];c.status('SUBSCRIBED');await t.run();assert.equal(calls,1);
 c.status('CHANNEL_ERROR');assert.equal(t.states.at(-1),'retrying');c.status('SUBSCRIBED');assert.equal(t.tasks.size,1);await t.run();assert.equal(calls,2);assert.equal(t.channels.length,1);
 c.status('CLOSED');await t.run();assert.equal(t.channels.length,2);assert.equal(c.removed,true);
});
test('switching store/user or signing out stops previous subscriptions and queued callbacks',async()=>{
 let calls=0;const t=setup(async()=>{calls++;});t.sync.watch(context);const old=t.channels[0];old.events.postgres_changes.callback({});
 t.sync.watch({...context,storeId:'s-b'});assert.equal(old.removed,true);assert.equal(t.channels.length,2);old.events.postgres_changes.callback({});assert.equal(t.tasks.size,0);
 t.sync.watch({...context,storeId:'s-b'});assert.equal(t.channels.length,2);t.sync.stop();t.channels[1].status('SUBSCRIBED');assert.equal(t.tasks.size,0);assert.equal(calls,0);
});
test('a busy screen defers shortly; an API failure retries with backoff and remains recoverable',async()=>{
 let outcome=false;const t=setup(async()=>{if(outcome==='error')throw Error('offline');return outcome;});t.sync.watch(context);t.sync.invalidate();await t.run();assert.equal([...t.tasks.values()][0].delay,100);
 outcome='error';await t.run();assert.equal([...t.tasks.values()][0].delay,2000);outcome=true;await t.run();assert.equal(t.tasks.size,0);
});
