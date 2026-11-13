function isDuplicate(err){
 const text=String(err?.message||err||'');
 return /already.?exist|BlobAlreadyExists|duplicate|409|conflict/i.test(text);
}
function pathFor(event){
 if(!event||typeof event!=='object'||typeof event.type!=='string')throw Error('invalid_event');
 if(!['feedback_vote','subscriber_snapshot','discussion_comment','channel_delivery','reaction_count','poll_snapshot'].includes(event.type))throw Error('invalid_event_type');
 if(typeof event.observed_at!=='string'||!Number.isFinite(Date.parse(event.observed_at)))throw Error('invalid_event_date');
 const d=event.observed_at?.slice(0,7)||new Date().toISOString().slice(0,7);
 if(!/^\d{4}-\d{2}$/.test(d))throw Error('invalid_event_date');
 if(event.type==='feedback_vote'){
  if(!/^20\d{6}$/.test(event.post_key||'')||!/^[a-f0-9]{24}$/.test(event.actor_hash||''))throw Error('invalid_vote_id');
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
  async recordMaintenance(receipt){
   if(!/^20\d{2}-\d\d-\d\d$/.test(receipt?.date_moscow||'')||
    !Number.isFinite(Date.parse(receipt.observed_at)))throw Error('invalid_maintenance_receipt');
   const body=JSON.stringify(receipt);
   if(body.length>2000)throw Error('maintenance_receipt_too_large');
   await(await sdk()).put('maintenance/daily/'+receipt.date_moscow+'.json',body,
    {access:'private',addRandomSuffix:false,allowOverwrite:true,contentType:'application/json'});
   return {stored:true};
  },
  async recentMaintenance({now=new Date()}={}){
   const api=await sdk();
   // Seven known date keys; no unbounded list, no assumption about older history.
   for(let ago=0;ago<7;ago++){
    const day=new Date(now.getTime()+3*3600000-ago*86400000).toISOString().slice(0,10);
    const item=await api.get('maintenance/daily/'+day+'.json',{access:'private',useCache:false});
    if(!item)continue;
    if(item.statusCode!==200||!item.stream)throw Error('maintenance_receipt_unavailable');
    const body=await new Response(item.stream).text();
    if(body.length>2000)throw Error('maintenance_receipt_invalid');
    const receipt=JSON.parse(body);
    if(receipt?.date_moscow!==day||!Number.isFinite(Date.parse(receipt.observed_at)))throw Error('maintenance_receipt_invalid');
    return {state:'receipt_available',latest_receipt:receipt,lookback_days:7,
     note:'Evidence for a past authorized daily handler run only; does not prove future scheduled execution.'};
   }
   return {state:'no_recent_receipt',latest_receipt:null,lookback_days:7,historical_evidence_available:false};
  },
  async rememberDiscussionMessage({channelId,discussionId,messageId,postMessageId}){
   const path=discussionPath(channelId,discussionId,messageId);
   if(!Number.isSafeInteger(postMessageId)||postMessageId<1)throw Error('invalid_discussion_post');
   const api=await sdk();
   try{await api.put(path,JSON.stringify({channel_id:channelId,discussion_id:discussionId,message_id:messageId,post_message_id:postMessageId}),
    {access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json'});}
   catch(error){if(!isDuplicate(error)&&!/BlobPreconditionFailed|\b412\b/i.test(String(error?.name)+' '+String(error?.message)))throw error;
    const prior=await this.discussionPost(channelId,discussionId,messageId);
    if(prior!==postMessageId)throw Error('discussion_mapping_conflict');}
  },
  async discussionPost(channelId,discussionId,messageId){
   const path=discussionPath(channelId,discussionId,messageId),api=await sdk();
   const item=await api.get(path,{access:'private',useCache:false});
   if(!item)return null;
   if(item.statusCode!==200||!item.stream)throw Error('discussion_mapping_unavailable');
   const body=await new Response(item.stream).text();
   if(body.length>1000)throw Error('discussion_mapping_invalid');
   const row=JSON.parse(body);
   if(row.channel_id!==channelId||row.discussion_id!==discussionId||row.message_id!==messageId||
    !Number.isSafeInteger(row.post_message_id)||row.post_message_id<1)throw Error('discussion_mapping_invalid');
   return row.post_message_id;
  },
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
   if(!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)||!Number.isFinite(Date.parse(isoDate))||
    new Date(isoDate).toISOString().slice(0,10)!==isoDate)throw Error('invalid_cutoff');
   if(!Number.isSafeInteger(maxDelete)||maxDelete<1||maxDelete>1000)throw Error('invalid_retention_limit');
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

function discussionPath(channelId,discussionId,messageId){
 if(!Number.isSafeInteger(channelId)||channelId===0||!Number.isSafeInteger(discussionId)||discussionId===0||
  !Number.isSafeInteger(messageId)||messageId<1)throw Error('invalid_discussion_identity');
 return 'discussion/v1/'+channelId+'/'+discussionId+'/'+messageId+'.json';
}
