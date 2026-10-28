import test from 'node:test';
import assert from 'node:assert/strict';
import {algerToday,reportRange,reportRate,reportBuckets} from '../src/report-domain.mjs';

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
