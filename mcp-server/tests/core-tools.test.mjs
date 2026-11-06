import test from 'node:test';
import assert from 'node:assert/strict';
import {coreTools,executeCoreTool} from '../lib/core-tools.js';
process.env.TELEGRAM_BOT_TOKEN='123456:AuditFakeToken01234567890123456789';
function client(){
 const calls=[];
 return {calls,fetch:async(url,options)=>{
  const method=url.split('/').at(-1),params=JSON.parse(options.body);calls.push({method,params});
  const result=method==='getMe'?{id:123,username:'MyGptSparks_bot'}:
   method==='getChat'?{id:-100111,username:'psy_money1',type:'channel'}:
   method==='getChatMember'?{status:'administrator',can_post_messages:true,can_edit_messages:true}:
   method==='getChatMemberCount'?50:method==='deleteMessage'?true:{message_id:params.message_id||20,chat:{id:-100111}};
  return {ok:true,status:200,json:async()=>({ok:true,result})};
 }};
}
const cases={check_access:{args:{},methods:['getMe','getChat','getChatMemberCount','getChatMember']},
 publish_text:{args:{text:'Example',format:'HTML'},methods:['sendMessage']},
 publish_photo:{args:{photo_url:'https://example.org/photo.jpg',caption:'Example'},methods:['sendPhoto']},
 publish_rich_article:{args:{content:'# Example',format:'markdown',reply_to_message_id:19},methods:['sendRichMessage']},
 edit_text:{args:{message_id:20,text:'Edited'},methods:['editMessageText']},
 edit_rich_article:{args:{message_id:20,content:'# Edited',format:'markdown'},methods:['editMessageText']},
 delete_post:{args:{message_id:20,confirm:true},methods:['deleteMessage']}};
test('all seven legacy core names have local execution cases',()=>assert.deepEqual(coreTools.map(t=>t.name).sort(),Object.keys(cases).sort()));
for(const [name,c] of Object.entries(cases))test('local core function '+name+' confirms its advertised result',async()=>{
 const f=client(),result=await executeCoreTool(name,c.args,f.fetch);
 assert.equal(result.ok,true);assert.deepEqual(f.calls.map(x=>x.method),c.methods);
 if(name==='check_access'){assert.equal(result.can_post_messages,true);assert.equal(result.channel_username,'psy_money1');}
 else if(name==='delete_post')assert.equal(result.deleted_message_id,20);
 else assert.equal(result.message_id,20);
 if(name==='publish_rich_article')assert.equal(f.calls[0].params.reply_parameters.message_id,19);
 if(name==='edit_rich_article')assert.deepEqual(f.calls[0].params.rich_message,{markdown:'# Edited'});
});
test('core aliases reject bad payloads and unsafe legacy deletion before any Telegram call',async()=>{
 const f=client();
 for(const [name,args] of [['publish_text',{text:''}],['publish_rich_article',{content:'x'.repeat(32769),format:'markdown'}],
  ['publish_photo',{photo_url:'https://user:secret@example.org/photo.jpg'}],['delete_post',{message_id:1}],
  ['delete_post',{message_id:1,confirm:false}],['edit_text',{message_id:-1,text:'Edited'}]])
  await assert.rejects(()=>executeCoreTool(name,args,f.fetch));
 assert.equal(f.calls.length,0);
});
test('core refuses a fabricated edit acknowledgement rather than reporting success',async()=>{
 await assert.rejects(()=>executeCoreTool('edit_text',{message_id:1,text:'Edited'},async()=>({ok:true,status:200,
  json:async()=>({ok:true,result:true})})),/confirmation_unknown/);
});
