import {hashConnection,numericId} from './business-core.js';
const ROOT='business/v1/';
const msgPath=(id,chatId,messageId)=>{
 if(!numericId(chatId)||!Number.isSafeInteger(messageId)||messageId<1)throw Error('invalid_message_identity');
 return ROOT+'messages/'+hashConnection(id)+'/'+chatId+'/'+String(messageId).padStart(16,'0')+'.json';
};
const chatPath=(id,chatId)=>{
 if(!numericId(chatId))throw Error('invalid_chat_id');
 return ROOT+'chats/'+hashConnection(id)+'/'+chatId+'.json';
};
const connPath=(id)=>ROOT+'connections/'+hashConnection(id)+'.json';
const forgetPath=(id,chatId)=>{
 if(!numericId(chatId))throw Error('invalid_chat_id');
 return ROOT+'forget-markers/'+hashConnection(id)+'/'+chatId+'.json';
};
const coveredByForget=(marker,message)=>!!marker&&(!Number.isSafeInteger(message.telegram_date)||message.telegram_date<=marker.telegram_cutoff);
async function blobSdk(){
 if(!process.env.BLOB_READ_WRITE_TOKEN)throw Error('business_storage_not_configured');
 return import('@vercel/blob');
}
export function createBusinessStore(sdk=null){
 const api=async()=>sdk||await blobSdk();
 async function record(path){
  const r=await(await api()).get(path,{access:'private',useCache:false,abortSignal:AbortSignal.timeout(5000)});
  if(!r)return {value:null,etag:null};
  if(r.statusCode!==200||!r.stream)throw Error('business_record_unavailable');
  const txt=await new Response(r.stream).text();
  if(txt.length>20000)throw Error('business_record_too_large');
  const value=JSON.parse(txt);
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('business_record_invalid');
  return {value,etag:r.blob?.etag||r.headers?.get?.('etag')||null};
 }
 async function read(path){return (await record(path)).value;}
 async function mutate(path,transform){
  const a=await api();
  for(let attempt=0;attempt<4;attempt++){
   const previous=await record(path),next=transform(previous.value);
   if(next.skip)return {...next,value:previous.value};
   if(previous.value&&!previous.etag)throw Error('business_record_version_missing');
   try{
    await a.put(path,JSON.stringify(next.value),{access:'private',addRandomSuffix:false,
     allowOverwrite:!!previous.value,...(previous.value?{ifMatch:previous.etag}:{}),
     contentType:'application/json',abortSignal:AbortSignal.timeout(5000)});
    return next;
   }catch(error){
    if(!/BlobPreconditionFailed|BlobAlreadyExists|precondition|already.?exist|\b409\b|\b412\b|conflict/i.test(String(error?.name)+' '+String(error?.message)))throw error;
   }
  }
  throw Error('business_record_concurrent_update');
 }
 async function write(path,value){return mutate(path,()=>({value}));}
 async function forgotten(id,chatId,message){
  const marker=await read(forgetPath(id,chatId));
  return coveredByForget(marker,message);
 }
 async function scan(prefix,limit=1000){
  const a=await api();let cursor,files=[],hasMore=false;
  // Capped scans: never imply that a large Telegram history was exhaustively searched.
  const cursors=new Set();
  for(let p=0;p<20&&files.length<limit;p++){
   const page=await a.list({prefix,limit:Math.min(1000,limit-files.length),...(cursor?{cursor}:{}),abortSignal:AbortSignal.timeout(5000)});
   if(!page||!Array.isArray(page.blobs))throw Error('business_listing_unavailable');
   files.push(...page.blobs.slice(0,limit-files.length));
   hasMore=!!page.hasMore;
   if(!hasMore||!page.cursor||cursors.has(page.cursor)||files.length>=limit)break;
   cursors.add(page.cursor);
   cursor=page.cursor;
  }
  return {files,hasMore};
 }
 return {
  async saveConnection(c){
   const stored=await mutate(connPath(c.id),previous=>{
    if(Number.isSafeInteger(c.observed_update_id)&&Number.isSafeInteger(previous?.observed_update_id)&&
       c.observed_update_id<previous.observed_update_id)return {skip:true};
    return {value:{...c,observed_update_id:c.observed_update_id??previous?.observed_update_id??null}};
   });
   const saved=stored.value;
   await write(ROOT+'owner-connections/'+saved.owner_id+'/'+hashConnection(saved.id)+'.json',{
    business_connection_id:saved.id,owner_id:saved.owner_id,is_enabled:saved.is_enabled,
    rights:saved.rights,updated_at:saved.updated_at
   });
  },
  async connections(ownerId,{limit=50}={}){
   if(!numericId(ownerId))throw Error('invalid_owner_id');
   const s=await scan(ROOT+'owner-connections/'+ownerId+'/',Math.min(100,Math.max(1,limit)));
   const rows=[];for(const f of s.files){const item=await read(f.pathname);if(item?.owner_id===ownerId)rows.push(item);}
   return {connections:rows,partial:s.hasMore};
  },
  async connection(id){return read(connPath(id));},
  async saveMessage(e,{storeText=false}={}){
   const path=msgPath(e.connectionId,e.chatId,e.messageId);
   if(await forgotten(e.connectionId,e.chatId,{telegram_date:e.timestamp}))
    return {stored:false,duplicate:true,reason:'chat_history_forgotten'};
   const now=new Date().toISOString();
   const saved=await mutate(path,previous=>{
    if(previous?.deleted)return {skip:true,result:{stored:false,duplicate:true,reason:'locally_deleted'}};
    if(previous&&Number.isSafeInteger(previous.update_id)&&Number.isSafeInteger(e.updateId)&&previous.update_id>=e.updateId)
     return {skip:true,result:{stored:false,duplicate:true}};
    return {value:{
    connection_id:e.connectionId,chat_id:e.chatId,message_id:e.messageId,
    update_id:Number.isSafeInteger(e.updateId)?e.updateId:previous?.update_id??null,
    sender_id:e.senderId,telegram_date:e.timestamp,
    text:storeText?e.text:null,media_type:e.mediaType,
    sent_by_bot:e.sentByBot===true||previous?.sent_by_bot===true,
    incoming:e.incoming===true,observed_at:previous?.observed_at||now,updated_at:now
   }};
   });
   if(saved.skip)return saved.result;
   if(await forgotten(e.connectionId,e.chatId,{telegram_date:e.timestamp})){
    await mutate(path,previous=>({value:{...previous,deleted:true,text:null,sender_id:null,
     media_type:null,telegram_date:null,updated_at:new Date().toISOString()}}));
    return {stored:false,duplicate:true,reason:'chat_history_forgotten'};
   }
   // Chat index is metadata only and is never publicly accessible.
   const stamp=Number.isSafeInteger(e.timestamp)&&e.timestamp>0&&e.timestamp<4102444800
    ?new Date(e.timestamp*1000).toISOString():null;
   await mutate(chatPath(e.connectionId,e.chatId),priorChat=>({value:{
     chat_id:e.chatId,label:e.chatLabel||priorChat?.label||'',last_event_at:now,
     last_incoming_at:[priorChat?.last_incoming_at,e.incoming?stamp:null].filter(Boolean).sort().at(-1)||null,
     last_message_at:[priorChat?.last_message_at,stamp].filter(Boolean).sort().at(-1)||null
   }}));
   return {stored:true,duplicate:false};
  },
  async deleteMessages(connectionId,chatId,ids,{updateId=null}={}){
   // Redact content immediately, leaving small tombstones to block replayed webhook messages.
   const now=new Date().toISOString();
   for(const id of ids){
    const path=msgPath(connectionId,chatId,id);
    await mutate(path,prev=>({value:{connection_id:connectionId,chat_id:chatId,message_id:id,
     deleted:true,text:null,media_type:null,sender_id:null,telegram_date:null,
     update_id:Number.isSafeInteger(updateId)?updateId:prev?.update_id??null,
     observed_at:prev?.observed_at||now,updated_at:now}}));
   }
   return {content_redacted:ids.length,tombstones:ids.length};
  },
  async getMessage(connectionId,chatId,messageId){
   const value=await read(msgPath(connectionId,chatId,messageId));
   return value&&await forgotten(connectionId,chatId,value)?null:value;
  },
  async chat(connectionId,chatId){
   const value=await read(chatPath(connectionId,chatId));
   if(!value)return null;
   const stamp=Date.parse(value.last_message_at||value.last_incoming_at||'');
   return await forgotten(connectionId,chatId,{telegram_date:Number.isFinite(stamp)?Math.floor(stamp/1000):null})?null:value;
  },
  async chats(connectionId,{limit=100}={}){
   const s=await scan(ROOT+'chats/'+hashConnection(connectionId)+'/',Math.min(200,Math.max(1,limit)));
   const chats=[];
   for(const f of s.files){
    const c=await read(f.pathname);
    if(c&&numericId(c.chat_id)){
     const stamp=Date.parse(c.last_message_at||c.last_incoming_at||'');
     if(!await forgotten(connectionId,c.chat_id,{telegram_date:Number.isFinite(stamp)?Math.floor(stamp/1000):null}))chats.push(c);
    }
   }
   return {chats:chats.sort((a,b)=>b.last_event_at.localeCompare(a.last_event_at)),partial:s.hasMore};
  },
  async messages(connectionId,chatId,{limit=30,query=''}={}){
   if(!numericId(chatId))throw Error('invalid_chat_id');
   const s=await scan(ROOT+'messages/'+hashConnection(connectionId)+'/'+chatId+'/',2000);
   const forgetMarker=await read(forgetPath(connectionId,chatId));
   const docs=[];
   for(const f of s.files){
    const m=await read(f.pathname);
    if(m&&!m.deleted&&m.connection_id===connectionId&&m.chat_id===chatId&&
       !coveredByForget(forgetMarker,m)&&(!query||String(m.text||'').toLowerCase().includes(query.toLowerCase())))docs.push(m);
   }
   docs.sort((a,b)=>b.message_id-a.message_id);
   const count=Math.min(100,Math.max(1,limit));
   return {messages:docs.slice(0,count),partial:s.hasMore||docs.length>count,scan_truncated:s.hasMore,
    latest_complete:!s.hasMore,total_in_scanned_sample:docs.length,retained_history_only:true};
  },
  async forgetChat(connectionId,chatId,{max=1000}={}){
   if(!numericId(chatId))throw Error('invalid_chat_id');
   if(!Number.isInteger(max)||max<1||max>1000)throw Error('invalid_forget_limit');
   // Keep only an opaque cutoff marker so delayed old webhook events cannot restore erased history.
   await write(forgetPath(connectionId,chatId),{telegram_cutoff:Math.floor(Date.now()/1000),forgotten_at:new Date().toISOString()});
   const s=await scan(ROOT+'messages/'+hashConnection(connectionId)+'/'+chatId+'/',Math.min(1000,max));
   const a=await api();
   if(s.files.length)await a.del(s.files.map(f=>f.pathname));
   if(!s.hasMore)await a.del(chatPath(connectionId,chatId));
   return {deleted:s.files.length,more_remaining:s.hasMore};
  },
  async purgeOld({cutoff,maxDelete=80}={}){
   if(!/^20\d\d-\d\d-\d\d$/.test(cutoff||''))throw Error('invalid_cutoff');
   if(!Number.isInteger(maxDelete)||maxDelete<1||maxDelete>200)throw Error('invalid_retention_limit');
   const a=await api(),cursorPath=ROOT+'maintenance/retention-cursor.json';
   const cursor=(await read(cursorPath))?.cursor;
   let page;
   try{page=await a.list({prefix:ROOT+'messages/',limit:200,...(cursor?{cursor}:{}),abortSignal:AbortSignal.timeout(5000)});}
   catch(error){if(!cursor)throw error;page=await a.list({prefix:ROOT+'messages/',limit:200,abortSignal:AbortSignal.timeout(5000)});}
   if(!page||!Array.isArray(page.blobs))throw Error('business_listing_unavailable');
   let redacted=0,remainingInPage=false;
   for(const file of page.blobs){
    const item=await read(file.pathname);
    if(!item||item.deleted||!item.observed_at||item.observed_at.slice(0,10)>=cutoff)continue;
    if(redacted>=maxDelete){remainingInPage=true;break;}
    const result=await mutate(file.pathname,previous=>{
     if(!previous||previous.deleted||!previous.observed_at||previous.observed_at.slice(0,10)>=cutoff)return {skip:true};
     return {value:{connection_id:previous.connection_id,chat_id:previous.chat_id,message_id:previous.message_id,
      deleted:true,retention_redacted:true,text:null,sender_id:null,media_type:null,telegram_date:null,
      update_id:previous.update_id??null,observed_at:previous.observed_at,updated_at:new Date().toISOString()}};
    });
    if(!result.skip)redacted++;
   }
   await write(cursorPath,{cursor:remainingInPage?cursor||null:page.hasMore?page.cursor||null:null,updated_at:new Date().toISOString()});
   return {deleted:0,content_redacted:redacted,tombstones_retained:true,partial:remainingInPage||page.hasMore===true};
  }
 };
}
