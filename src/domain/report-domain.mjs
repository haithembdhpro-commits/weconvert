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

// Market reference points for COD in Algeria (habitual levels, not this account's history): shown as hints,
// never as verdicts. They are defaults, kept in one place so they can become a per-company setting.
export const REPORT_MARKS={confirmation:65,delivery:72,firstCallMinutes:30,wilayaReturns:30,wilayaMinParcels:5};

/** Delivery rate on parcels that reached an outcome: delivered ÷ (delivered + returned). */
export function deliveryRate(delivered,returned){
 return reportRate(delivered,Number(delivered||0)+Number(returned||0));
}

/** Readable duration from minutes: « 12 min », « 2 h 05 », « 3 j 4 h ». */
export function minutesLabel(m){
 if(m===null||m===undefined||m===''||!Number.isFinite(Number(m)))return '—';
 const v=Math.max(0,Math.round(Number(m)));
 if(v<60)return v+' min';
 if(v<1440)return Math.floor(v/60)+' h '+String(v%60).padStart(2,'0');
 const d=Math.floor(v/1440),h=Math.floor((v%1440)/60);
 return d+' j'+(h?' '+h+' h':'');
}

/** Wilaya rows sorted for reading: most orders, most returns (share), or weakest delivery rate. */
export function sortWilayas(rows=[],mode='orders',marks=REPORT_MARKS){
 const share=r=>{const done=Number(r.delivered||0)+Number(r.returned||0);return done?Number(r.returned||0)/done:-1};
 const list=[...rows];
 if(mode==='returns')return list.sort((a,b)=>(Number(b.delivered||0)+Number(b.returned||0)>=marks.wilayaMinParcels)-(Number(a.delivered||0)+Number(a.returned||0)>=marks.wilayaMinParcels)||share(b)-share(a)||Number(b.orders)-Number(a.orders));
 return list.sort((a,b)=>Number(b.orders)-Number(a.orders)||String(a.wilaya).localeCompare(String(b.wilaya),'fr'));
}

/**
 * Points to watch, in plain words. Only raised with enough data to mean something
 * (at least 20 decided orders, or 10 parcels with an outcome), so a quiet week never cries wolf.
 */
export function reportAlerts(x,marks=REPORT_MARKS){
 const out=[];if(!x)return out;
 const fu=x.funnel||{},base=Number(fu.rate_base||0),conf=Number(fu.confirmed||0);
 const done=Number(fu.delivered||0)+Number(fu.returned||0);
 if(base>=20&&100*conf/base<marks.confirmation)out.push({key:'confirmation',tone:'warning',
  title:'Taux de confirmation bas : '+reportRate(conf,base),
  detail:'Repère habituel : '+marks.confirmation+' % ou plus. Regardez d’abord les motifs de perte et la rapidité du premier appel.'});
 if(done>=10&&100*Number(fu.delivered||0)/done<marks.delivery)out.push({key:'delivery',tone:'danger',
  title:'Trop de retours : '+deliveryRate(fu.delivered,fu.returned)+' livrées',
  detail:'Repère habituel : '+marks.delivery+' % ou plus. Regardez les wilayas qui retournent le plus et la qualité des confirmations par agent.'});
 const sp=x.speed||{};
 if(Number(sp.handled||0)>=20&&Number(sp.median_first_minutes)>marks.firstCallMinutes)out.push({key:'speed',tone:'warning',
  title:'Premier appel trop tardif : '+minutesLabel(sp.median_first_minutes)+' en général',
  detail:'Appeler dans les '+marks.firstCallMinutes+' minutes après la commande augmente nettement la confirmation.'});
 const bad=(x.wilayas||[]).filter(w=>{const d=Number(w.delivered||0)+Number(w.returned||0);return d>=marks.wilayaMinParcels&&100*Number(w.returned||0)/d>marks.wilayaReturns});
 if(bad.length)out.push({key:'wilayas',tone:'danger',
  title:bad.length+(bad.length>1?' wilayas retournent':' wilaya retourne')+' plus de '+marks.wilayaReturns+' % des colis',
  detail:bad.slice(0,4).map(w=>w.wilaya+' ('+reportRate(w.returned,Number(w.delivered||0)+Number(w.returned||0))+')').join(' · ')+(bad.length>4?' et '+(bad.length-4)+' autres':'')+'. À vérifier avant d’y dépenser en publicité.'});
 return out;
}

/** Same-length window right before [from, to] (both inclusive, YYYY-MM-DD). */
export function previousRange(from,to){
 const a=Date.parse(from+'T00:00:00Z'),b=Date.parse(to+'T00:00:00Z'),days=Math.round((b-a)/864e5)+1;
 const pt=new Date(a-864e5),pf=new Date(a-days*864e5);
 return {from:pf.toISOString().slice(0,10),to:pt.toISOString().slice(0,10),days};
}

/**
 * Change versus the previous period, in plain words. 'count': relative change in %;
 * 'rate': difference in points between two rates n/base. Returns null when the comparison means nothing.
 */
export function periodDelta(kind,now,before,nowBase,beforeBase){
 if(kind==='rate'){
  if(!(Number(nowBase)>0)||!(Number(beforeBase)>0))return null;
  const d=100*Number(now||0)/Number(nowBase)-100*Number(before||0)/Number(beforeBase);
  return {value:d,text:(d>0?'+':'')+d.toFixed(1).replace('.',',')+' pt'};
 }
 const n=Number(now||0),b=Number(before||0);
 if(!b)return n?{value:Infinity,text:'nouveau'}:null;
 const d=100*(n-b)/b;
 return {value:d,text:(d>0?'+':'')+d.toFixed(0)+' %'};
}
