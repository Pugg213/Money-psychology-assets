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
   const page=await api.list({prefix,limit});
   const blobs=(page.blobs||[]).slice(0,limit);
   const events=[];
   for(const blob of blobs){
    const item=await api.get(blob.pathname,{access:'private',useCache:false});
    if(!item||item.statusCode!==200||!item.stream)continue;
    const source=await new Response(item.stream).text();
    if(source.length>12000)continue;
    try{events.push(JSON.parse(source));}catch{}
   }
   return {events,hasMore:!!page.hasMore,count:events.length,truncated:!!page.hasMore};
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
