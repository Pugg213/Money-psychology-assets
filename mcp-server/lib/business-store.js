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
   const previous=await record(path),next=await transform(previous.value);
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
 async function invalidateIndex(id,chatId,messageIds=null){
  // This key is the shared CAS fence for every index writer and redaction.
  // Keep it even when no chat has been indexed yet: deleting it permits ABA.
  const ids=messageIds&&new Set(messageIds);
  await mutate(chatPath(id,chatId),previous=>{
   const sources=previous?.source_message_ids;
   const keep=ids&&sources&&['label','last_event_at','last_incoming_at','last_message_at']
    .every(field=>Object.hasOwn(sources,field)&&(sources[field]===null||Number.isSafeInteger(sources[field])&&!ids.has(sources[field])));
   return {value:{...(keep?previous:{chat_id:chatId,index_invalidated:true,
    chat_observed:!!ids&&(previous?.chat_observed===true||!!previous?.last_event_at)}),
    index_generation:(previous?.index_generation||0)+1}};
  });
 }
 function visibleChat(value){
  if(!value)return null;
  if(value.index_invalidated)return value.chat_observed
   ?{chat_id:value.chat_id,label:'',last_event_at:'',last_incoming_at:null,last_message_at:null}:null;
  const {index_generation,source_message_ids,chat_observed,index_invalidated,...chat}=value;
  return chat;
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
    sender_id:e.senderId,telegram_date:e.timestamp,chat_label:e.chatLabel||previous?.chat_label||'',
    text:storeText?e.text:null,media_type:e.mediaType,
    sent_by_bot:e.sentByBot===true||previous?.sent_by_bot===true,
    incoming:e.incoming===true,observed_at:previous?.observed_at||now,updated_at:now
   }};
   });
   if(saved.skip&&saved.value?.deleted)return saved.result;
   const redactForgotten=marker=>mutate(path,prior=>!prior||prior.deleted||!coveredByForget(marker,prior)
    ?{skip:true}:{value:{...prior,deleted:true,text:null,chat_label:null,sender_id:null,
     media_type:null,telegram_date:null,updated_at:new Date().toISOString()}});
   // A concurrent forget may finish while the source write is in flight.
   // Clean up that source before touching the separately fallible index store.
   const afterSourceMarker=await read(forgetPath(e.connectionId,e.chatId));
   if(coveredByForget(afterSourceMarker,saved.value)){
    await redactForgotten(afterSourceMarker);
    return {stored:false,duplicate:true,reason:'chat_history_forgotten'};
   }
   // Read dependencies AFTER obtaining the chat CAS version, on every retry.
   // Delete/forget/retention advance that same key after redacting the source.
   // Thus a stale write either commits before their fence and is invalidated,
   // or loses CAS and observes the tombstone/cutoff before attempting again.
   const indexed=await mutate(chatPath(e.connectionId,e.chatId),async previous=>{
    const current=await read(path);
    if(!current||current.deleted)return {skip:true,result:{stored:false,duplicate:true,reason:'locally_deleted'}};
    const marker=await read(forgetPath(e.connectionId,e.chatId));
    if(coveredByForget(marker,current)){
     await redactForgotten(marker);
     return {skip:true,result:{stored:false,duplicate:true,reason:'chat_history_forgotten'}};
    }
    const priorChat=previous?.index_invalidated?null:previous;
    const stamp=Number.isSafeInteger(current.telegram_date)&&current.telegram_date>0&&current.telegram_date<4102444800
     ?new Date(current.telegram_date*1000).toISOString():null;
    const newer=!priorChat||(Number.isSafeInteger(current.update_id)&&Number.isSafeInteger(priorChat.last_update_id)
     ?current.update_id>=priorChat.last_update_id
     :!!stamp&&(!priorChat.last_message_at||stamp>=priorChat.last_message_at));
    const sources={...priorChat?.source_message_ids};
    const newest=(field,value)=>{
     if(value&&(!priorChat?.[field]||value>=priorChat[field])){sources[field]=current.message_id;return value;}
     if(!priorChat?.[field])sources[field]=null;
     return priorChat?.[field]||null;
    };
    const label=newer?(current.chat_label||priorChat?.label||''):priorChat.label;
    if((newer&&current.chat_label)||!priorChat)sources.label=current.message_id;
    return {value:{
     ...priorChat,chat_id:e.chatId,label,chat_observed:true,index_generation:previous?.index_generation||0,
     last_update_id:newer?current.update_id:priorChat.last_update_id,
     last_event_at:newest('last_event_at',current.updated_at)||now,
     last_incoming_at:newest('last_incoming_at',current.incoming?stamp:null),
     last_message_at:newest('last_message_at',stamp),source_message_ids:sources
    }};
   });
   if(indexed.skip)return indexed.result;
   return saved.skip?saved.result:{stored:true,duplicate:false};
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
   await invalidateIndex(connectionId,chatId,ids);
   return {content_redacted:ids.length,tombstones:ids.length};
  },
  async getMessage(connectionId,chatId,messageId){
   const value=await read(msgPath(connectionId,chatId,messageId));
   return value&&await forgotten(connectionId,chatId,value)?null:value;
  },
  async chat(connectionId,chatId){
   const value=visibleChat(await read(chatPath(connectionId,chatId)));
   if(!value)return null;
   const stamp=Date.parse(value.last_message_at||value.last_incoming_at||'');
   return await forgotten(connectionId,chatId,{telegram_date:Number.isFinite(stamp)?Math.floor(stamp/1000):null})?null:value;
  },
  async chats(connectionId,{limit=100}={}){
   const s=await scan(ROOT+'chats/'+hashConnection(connectionId)+'/',Math.min(200,Math.max(1,limit)));
   const chats=[];
   for(const f of s.files){
    const c=visibleChat(await read(f.pathname));
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
   const cutoff=Math.floor(Date.now()/1000),now=new Date().toISOString();
   await mutate(forgetPath(connectionId,chatId),previous=>({value:{
    telegram_cutoff:Math.max(cutoff,previous?.telegram_cutoff||0),
    forgotten_at:[now,previous?.forgotten_at].filter(Boolean).sort().at(-1)}}));
   await invalidateIndex(connectionId,chatId);
   const s=await scan(ROOT+'messages/'+hashConnection(connectionId)+'/'+chatId+'/',Math.min(1000,max));
   const a=await api();
   if(s.files.length)await a.del(s.files.map(f=>f.pathname));
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
    if(!item||item.deleted&&!item.index_invalidation_pending||!item.observed_at||item.observed_at.slice(0,10)>=cutoff)continue;
    if(redacted>=maxDelete){remainingInPage=true;break;}
    const result=await mutate(file.pathname,previous=>{
     if(previous?.deleted&&previous.index_invalidation_pending)return {value:previous};
     if(!previous||previous.deleted||!previous.observed_at||previous.observed_at.slice(0,10)>=cutoff)return {skip:true};
     return {value:{connection_id:previous.connection_id,chat_id:previous.chat_id,message_id:previous.message_id,
      deleted:true,retention_redacted:true,index_invalidation_pending:true,text:null,sender_id:null,media_type:null,telegram_date:null,
      update_id:previous.update_id??null,observed_at:previous.observed_at,updated_at:new Date().toISOString()}};
    });
    if(!result.skip){
     await invalidateIndex(result.value.connection_id,result.value.chat_id,[result.value.message_id]);
     await mutate(file.pathname,previous=>!previous?{skip:true}:{value:{...previous,index_invalidation_pending:false}});
     redacted++;
    }
   }
   await write(cursorPath,{cursor:remainingInPage?cursor||null:page.hasMore?page.cursor||null:null,updated_at:new Date().toISOString()});
   return {deleted:0,content_redacted:redacted,tombstones_retained:true,partial:remainingInPage||page.hasMore===true};
  }
 };
}
