import test from 'node:test';
import assert from 'node:assert/strict';
import {algerToday,reportRange,reportRate,reportBuckets} from '../src/domain/report-domain.mjs';

test('report dates follow Algeria rather than browser UTC and include both ends',()=>{
 assert.equal(algerToday(new Date('2026-10-25T23:15:00Z')),'2026-10-26');
 assert.deepEqual(reportRange('7','2026-10-26'),{from:'2026-10-20',to:'2026-10-26'});
 assert.deepEqual(reportRange('30','2026-01-05'),{from:'2025-12-07',to:'2026-01-05'});
 assert.throws(()=>reportRange('400','2026-10-26'),/INVALID_FILTER/);
});

test('daily and grouped charts preserve order and confirmed totals',()=>{
 const days=Array.from({length:35},(_,i)=>({date:new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10),orders:3,confirmed:i%2, cancelled:1}));
 const weeks=reportBuckets(days);
 assert.equal(weeks.length,5);
 assert.deepEqual(weeks.map(x=>x.orders),[21,21,21,21,21]);
 assert.equal(weeks.reduce((n,x)=>n+x.confirmed,0),17);
 assert.equal(reportBuckets(days.slice(0,7)).length,7);
 assert.equal(reportRate(2,4),'50,0 %');
 assert.equal(reportRate(0,0),'—');
});

test('delivery rate, durations and wilaya ordering read plainly',async()=>{
 const {deliveryRate,minutesLabel,sortWilayas}=await import('../src/domain/report-domain.mjs');
 assert.equal(deliveryRate(3,1),'75,0 %');
 assert.equal(deliveryRate(0,0),'—');
 assert.equal(minutesLabel(12),'12 min');
 assert.equal(minutesLabel(125),'2 h 05');
 assert.equal(minutesLabel(60*27),'1 j 3 h');
 assert.equal(minutesLabel(null),'—');
 const rows=[{wilaya:'16 - Alger',orders:9,delivered:8,returned:1},{wilaya:'31 - Oran',orders:5,delivered:2,returned:3},{wilaya:'01 - Adrar',orders:1,delivered:0,returned:1}];
 assert.deepEqual(sortWilayas(rows).map(r=>r.wilaya),['16 - Alger','31 - Oran','01 - Adrar']);
 // Most returns first, but a wilaya with too few parcels never jumps ahead on one return.
 assert.deepEqual(sortWilayas(rows,'returns').map(r=>r.wilaya),['31 - Oran','16 - Alger','01 - Adrar']);
});

test('alerts need enough data and use the market reference points',async()=>{
 const {reportAlerts}=await import('../src/domain/report-domain.mjs');
 assert.deepEqual(reportAlerts({funnel:{rate_base:5,confirmed:1,delivered:1,returned:3}}),[],'too little data: no alert');
 const a=reportAlerts({funnel:{rate_base:40,confirmed:20,delivered:6,returned:6},speed:{handled:30,median_first_minutes:95},
  wilayas:[{wilaya:'31 - Oran',delivered:2,returned:4},{wilaya:'16 - Alger',delivered:9,returned:1}]});
 assert.deepEqual(a.map(x=>x.key),['confirmation','delivery','speed','wilayas']);
 assert.match(a[0].title,/50,0 %/);
 assert.match(a[2].title,/1 h 35/);
 assert.match(a[3].detail,/31 - Oran/);
 assert.doesNotMatch(a[3].detail,/Alger/);
});

test('previous period and deltas compare like with like',async()=>{
 const {previousRange,periodDelta}=await import('../src/domain/report-domain.mjs');
 assert.deepEqual(previousRange('2026-10-23','2026-10-29'),{from:'2026-10-16',to:'2026-10-22',days:7});
 assert.deepEqual(previousRange('2026-03-01','2026-03-01'),{from:'2026-02-28',to:'2026-02-28',days:1});
 assert.equal(periodDelta('count',120,100).text,'+20 %');
 assert.equal(periodDelta('count',80,100).text,'-20 %');
 assert.equal(periodDelta('count',5,0).text,'nouveau');
 assert.equal(periodDelta('count',0,0),null);
 assert.equal(periodDelta('rate',70,60,100,100).text,'+10,0 pt');
 assert.equal(periodDelta('rate',1,1,0,10),null);
});
