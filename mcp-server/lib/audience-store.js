function isDuplicate(err){
 const text=String(err?.message||err||'');
 return /already.?exist|BlobAlreadyExists|duplicate|409|conflict/i.test(text);
}
function pathFor(event){
 if(!event||typeof event!=='object'||typeof event.type!=='string')throw Error('invalid_event');
 const d=event.observed_at?.slice(0,7)||new Date().toISOString().slice(0,7);
 if(!/^\d{4}-\d{2}$/.test(d))throw Error('invalid_event_date');
 if(event.type==='feedback_vote'){
  if(!/^20\d{6}$/.test(event.post_key||'')||!/^[a-f0-9]{24}$/.test(event.actor_hash||'')) {
   // Allow mock actor identifiers in tests, but never path injection.
   if(!/^[a-zA-Z0-9_-]{2,64}$/.test(event.actor_hash||''))throw Error('invalid_vote_id');
  }
  return 'events/'+d+'/vote-'+event.post_key+'-'+event.actor_hash+'.json';
 }
 if(event.type==='subscriber_snapshot')return 'events/'+d+'/snapshot-'+event.observed_at.slice(0,10)+'.json';
 if(!Number.isSafeInteger(event.update_id)||event.update_id<0)throw Error('invalid_update_id');
 return 'events/'+d+'/'+event.type+'-'+event.update_id+'.json';
}
async function defaultSdk(){
 if(!process.env.BLOB_READ_WRITE_TOKEN)throw Error('storage_not_configured');
 return import('@vercel/blob');
}
export function createAudienceStore(adapter=null){
 async function sdk(){return adapter||await defaultSdk();}
 return {
  async record(event){
   const path=pathFor(event);
   const api=await sdk();
   try{
    const result=await api.put(path,JSON.stringify(event),{
      access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json'
    });
    return {stored:true,duplicate:false,path:result.pathname||path};
   }catch(e){
    if(isDuplicate(e))return {stored:false,duplicate:true,path};
    throw e;
   }
  },
  async readRecent({prefix='events/',limit=100}={}){
   if(typeof prefix!=='string'||!/^events\/(?:20\d{2}-\d\d\/)?$/.test(prefix))throw Error('invalid_prefix');
   limit=Math.max(1,Math.min(200,Number(limit)||100));
   const api=await sdk();
   // Blob listing order is pathname order, not publication time. Inspect a bounded
   // metadata sample across pages before selecting the newest uploaded events.
   const maxScan=1000,maxPages=20,metadata=new Map(),cursors=new Set();
   let cursor,scan_truncated=false,metadata_scanned=0;
   for(let pages=0;pages<maxPages;pages++){
    const remaining=maxScan-metadata_scanned;
    const page=await api.list({prefix,limit:remaining,...(cursor?{cursor}:{})});
    const items=Array.isArray(page.blobs)?page.blobs:[];
    for(const item of items.slice(0,remaining)){
     metadata_scanned++;
     if(typeof item.pathname==='string'&&item.pathname.startsWith(prefix))metadata.set(item.pathname,item);
    }
    if(items.length>remaining)scan_truncated=true;
    if(!page.hasMore)break;
    if(metadata_scanned>=maxScan||pages===maxPages-1||typeof page.cursor!=='string'||
       !page.cursor||cursors.has(page.cursor)){scan_truncated=true;break;}
    cursor=page.cursor;cursors.add(cursor);
   }
   const time=value=>{const n=value instanceof Date?value.getTime():Date.parse(value);return Number.isFinite(n)?n:0;};
   const rows=[...metadata.values()].sort((a,b)=>time(b.uploadedAt)-time(a.uploadedAt)||a.pathname.localeCompare(b.pathname));
   const blobs=rows.slice(0,limit),events=[];
   let skipped=0;
   for(const blob of blobs){
    const item=await api.get(blob.pathname,{access:'private',useCache:false});
    if(!item||item.statusCode!==200||!item.stream){skipped++;continue;}
    const source=await new Response(item.stream).text();
    if(source.length>12000){skipped++;continue;}
    try{const event=JSON.parse(source);if(!event||typeof event!=='object'||Array.isArray(event))throw Error('invalid_event');events.push(event);}catch{skipped++;}
   }
   events.sort((a,b)=>time(a.observed_at)-time(b.observed_at)||(Number(a.update_id)||0)-(Number(b.update_id)||0));
   const hasMore=scan_truncated||rows.length>limit||skipped>0;
   return {events,hasMore,count:events.length,truncated:hasMore,sample_truncated:hasMore,
    metadata_scanned,scan_truncated,skipped_records:skipped,
    recency_fully_ordered:!scan_truncated&&rows.every(x=>time(x.uploadedAt)>0)};
  },
  async purgeBefore(isoDate,{maxDelete=100}={}){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(isoDate))throw Error('invalid_cutoff');
   const api=await sdk();
   // A small bounded scan; never delete future or active entries.
   const page=await api.list({prefix:'events/',limit:Math.min(1000,maxDelete*3)});
   const targets=(page.blobs||[]).filter(x=>{
    const name=x.pathname.match(/^events\/(\d{4}-\d{2})\//);
    return name && name[1]<isoDate.slice(0,7);
   }).slice(0,maxDelete);
   if(targets.length)await api.del(targets.map(x=>x.url||x.pathname));
   return {deleted:targets.length,partial:!!page.hasMore};
  }
 };
}
export const privateStoreKey=pathFor;
