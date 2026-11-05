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
async function blobSdk(){
 if(!process.env.BLOB_READ_WRITE_TOKEN)throw Error('business_storage_not_configured');
 return import('@vercel/blob');
}
export function createBusinessStore(sdk=null){
 const api=async()=>sdk||await blobSdk();
 async function read(path){
  const r=await(await api()).get(path,{access:'private',useCache:false});
  if(!r||r.statusCode!==200||!r.stream)return null;
  const txt=await new Response(r.stream).text();
  if(txt.length>20000)throw Error('business_record_too_large');
  return JSON.parse(txt);
 }
 async function write(path,value){
  await(await api()).put(path,JSON.stringify(value),{
   access:'private',addRandomSuffix:false,allowOverwrite:true,contentType:'application/json'
  });
 }
 async function scan(prefix,limit=1000){
  const a=await api();let cursor,files=[],hasMore=false;
  // Capped scans: never imply that a large Telegram history was exhaustively searched.
  for(let p=0;p<5;p++){
   const page=await a.list({prefix,limit:Math.min(1000,limit-files.length),...(cursor?{cursor}:{})});
   files.push(...(page.blobs||[]));
   hasMore=!!page.hasMore;
   if(!hasMore||!page.cursor||files.length>=limit)break;
   cursor=page.cursor;
  }
  return {files,hasMore};
 }
 return {
  async saveConnection(c){
   await write(connPath(c.id),c);
   await write(ROOT+'owner-connections/'+c.owner_id+'/'+hashConnection(c.id)+'.json',{
    business_connection_id:c.id,owner_id:c.owner_id,is_enabled:c.is_enabled,
    rights:c.rights,updated_at:c.updated_at
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
   const previous=await read(path);
   if(previous?.deleted)return {stored:false,duplicate:true,reason:'locally_deleted'};
   if(previous&&Number.isSafeInteger(previous.update_id)&&previous.update_id>=e.updateId)return {stored:false,duplicate:true};
   const now=new Date().toISOString();
   await write(path,{
    connection_id:e.connectionId,chat_id:e.chatId,message_id:e.messageId,
    update_id:e.updateId,sender_id:e.senderId,telegram_date:e.timestamp,
    text:storeText?e.text:null,media_type:e.mediaType,
    observed_at:previous?.observed_at||now,updated_at:now
   });
   // Chat index is metadata only and is never publicly accessible.
   const priorChat=await read(chatPath(e.connectionId,e.chatId));
   const stamp=e.incoming&&Number.isSafeInteger(e.timestamp)&&e.timestamp>0&&e.timestamp<4102444800
    ?new Date(e.timestamp*1000).toISOString():null;
   const lastIncoming=[priorChat?.last_incoming_at,stamp].filter(Boolean).sort().at(-1)||null;
   await write(chatPath(e.connectionId,e.chatId),{
    chat_id:e.chatId,label:e.chatLabel||priorChat?.label||'',last_event_at:now,
    last_incoming_at:lastIncoming
   });
   return {stored:true,duplicate:false};
  },
  async deleteMessages(connectionId,chatId,ids,{updateId=null}={}){
   // Redact content immediately, leaving small tombstones to block replayed webhook messages.
   const now=new Date().toISOString();
   for(const id of ids){
    const path=msgPath(connectionId,chatId,id);
    const prev=await read(path);
    await write(path,{connection_id:connectionId,chat_id:chatId,message_id:id,
     deleted:true,text:null,media_type:null,sender_id:null,telegram_date:null,
     update_id:Number.isSafeInteger(updateId)?updateId:prev?.update_id??null,
     observed_at:prev?.observed_at||now,updated_at:now});
   }
   return {content_redacted:ids.length,tombstones:ids.length};
  },
  async getMessage(connectionId,chatId,messageId){return read(msgPath(connectionId,chatId,messageId));},
  async chat(connectionId,chatId){return read(chatPath(connectionId,chatId));},
  async chats(connectionId,{limit=100}={}){
   const s=await scan(ROOT+'chats/'+hashConnection(connectionId)+'/',Math.min(200,Math.max(1,limit)));
   const chats=[];
   for(const f of s.files){
    const c=await read(f.pathname);
    if(c&&numericId(c.chat_id))chats.push(c);
   }
   return {chats:chats.sort((a,b)=>b.last_event_at.localeCompare(a.last_event_at)),partial:s.hasMore};
  },
  async messages(connectionId,chatId,{limit=30,query=''}={}){
   if(!numericId(chatId))throw Error('invalid_chat_id');
   const s=await scan(ROOT+'messages/'+hashConnection(connectionId)+'/'+chatId+'/',2000);
   const docs=[];
   for(const f of s.files){
    const m=await read(f.pathname);
    if(m&&!m.deleted&&m.chat_id===chatId&&(!query||String(m.text||'').toLowerCase().includes(query.toLowerCase())))docs.push(m);
   }
   docs.sort((a,b)=>b.message_id-a.message_id);
   return {messages:docs.slice(0,Math.min(100,Math.max(1,limit))),partial:s.hasMore,
    total_in_scanned_sample:docs.length,retained_history_only:true};
  },
  async forgetChat(connectionId,chatId,{max=1000}={}){
   if(!numericId(chatId))throw Error('invalid_chat_id');
   const s=await scan(ROOT+'messages/'+hashConnection(connectionId)+'/'+chatId+'/',Math.min(1000,max));
   const a=await api();
   if(s.files.length)await a.del(s.files.map(f=>f.pathname));
   if(!s.hasMore)await a.del(chatPath(connectionId,chatId));
   return {deleted:s.files.length,more_remaining:s.hasMore};
  },
  async purgeOld({cutoff,maxDelete=80}={}){
   if(!/^20\d\d-\d\d-\d\d$/.test(cutoff||''))throw Error('invalid_cutoff');
   const s=await scan(ROOT+'messages/',1000);
   const old=s.files.filter(f=>f.uploadedAt&&new Date(f.uploadedAt).toISOString().slice(0,10)<cutoff).slice(0,maxDelete);
   if(old.length)await(await api()).del(old.map(x=>x.pathname));
   return {deleted:old.length,partial:s.hasMore};
  }
 };
}
