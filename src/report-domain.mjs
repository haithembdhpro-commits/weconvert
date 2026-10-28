export function algerToday(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Algiers',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const get=type=>parts.find(x=>x.type===type)?.value;
 return `${get('year')}-${get('month')}-${get('day')}`;
}

export function reportRange(preset='30',today=algerToday()){
 const days=Number(preset);
 if(![7,30,90,365].includes(days))throw Error('INVALID_FILTER');
 const from=new Date(today+'T00:00:00Z');
 from.setUTCDate(from.getUTCDate()-days+1);
 return {from:from.toISOString().slice(0,10),to:today};
}

export function reportRate(n,denominator){
 return Number(denominator)>0?(100*Number(n||0)/Number(denominator)).toFixed(1).replace('.',',')+' %':'—';
}

export function reportBuckets(days=[]){
 const mode=days.length>120?'month':days.length>31?'week':'day',buckets=[];
 for(let i=0;i<days.length;i++){
  const row=days[i],key=mode==='month'?row.date.slice(0,7):mode==='week'?String(Math.floor(i/7)):row.date;
  let bucket=buckets.at(-1);
  if(!bucket||bucket.key!==key){bucket={key,from:row.date,to:row.date,orders:0,confirmed:0,cancelled:0};buckets.push(bucket);}
  bucket.to=row.date;
  for(const metric of ['orders','confirmed','cancelled'])bucket[metric]+=Number(row[metric]||0);
 }
 return buckets;
}
