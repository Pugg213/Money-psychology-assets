import test from 'node:test';
import assert from 'node:assert/strict';
import {executeTool,extensions,security} from '../lib/extensions.js';

process.env.TELEGRAM_BOT_TOKEN='123456:ChannelAuditFakeToken012345678901';
const channel=security.CHANNEL;
function client(handler=()=>undefined){
 const calls=[];
 const fetch=async(url,options)=>{
  const method=url.split('/').at(-1),params=JSON.parse(options.body);calls.push({method,params});
  let result=handler(method,params);
  if(result===undefined)result=method==='getMe'?{id:123,username:'MyGptSparks_bot'}:
   method==='getChatMemberCount'?321:method==='getChatMember'?{status:'administrator',can_post_messages:true}:
   method==='getFile'?{file_id:'file',file_unique_id:'unique',file_size:123,file_path:'photos/test.jpg'}:
   method==='sendMediaGroup'?[{message_id:11},{message_id:12}]:
   ['deleteMessage','deleteMessages','pinChatMessage','unpinChatMessage','unpinAllChatMessages','setChatDescription','setChatTitle',
    'setMessageReaction','deleteMessageReaction','deleteAllMessageReactions'].includes(method)?true:{message_id:10};
  return {ok:true,status:200,json:async()=>({ok:true,result})};
 };
 return {fetch,calls};
}
const cases={
 get_capabilities:[{},[]],
 validate_rich_message:[{content:'# Test',format:'markdown'},[]],
 get_channel_overview:[{},['getMe','getChat','getChatMemberCount','getChatMember']],
 get_chat_info:[{},['getChat']],
 get_member_count:[{},['getChatMemberCount']],
 get_chat_admins:[{},['getChatAdministrators']],
 get_chat_member_info:[{user_id:12},['getChatMember']],
 get_webhook_status:[{},['getWebhookInfo']],
 get_bot_profile:[{},['getMe','getMyCommands','getMyDescription','getMyShortDescription']],
 get_bot_stars:[{limit:5},['getMyStarBalance','getStarTransactions']],
 get_telegram_message_link:[{message_id:10},[]],
 send_rich_message:[{content:'# Test',format:'markdown',reply_to_message_id:9},['sendRichMessage']],
 send_media:[{type:'photo',url:'https://example.org/original.jpg',caption:'Caption'},['sendPhoto']],
 send_album:[{media:[{type:'photo',url:'https://example.org/a.jpg'},{type:'video',url:'https://example.org/b.mp4'}]},['sendMediaGroup']],
 send_poll:[{question:'Which?',options:['A','B'],quiz:true,correct_option_id:1},['sendPoll']],
 send_buttons:[{text:'Choose',rows:[[{text:'One',callback_data:'vote:1'}]]},['sendMessage']],
 edit_caption:[{message_id:10,caption:'Edited'},['editMessageCaption']],
 edit_buttons:[{message_id:10,rows:[]},['editMessageReplyMarkup']],
 set_reaction:[{message_id:10,emoji:'👍'},['setMessageReaction']],
 pin_message:[{message_id:10,silent:true},['pinChatMessage']],
 unpin_message:[{message_id:10},['unpinChatMessage']],
 copy_channel_message:[{message_id:10,caption:'Copied'},['copyMessage']],
 delete_channel_message:[{message_id:10,confirm:true},['deleteMessage']],
 set_channel_description:[{description:'Description',confirm:true},['setChatDescription']],
 create_invite_link:[{name:'Audit',member_limit:3},['createChatInviteLink']],
 revoke_invite_link:[{invite_link:'https://t.me/+example',confirm:true},['revokeChatInviteLink']],
 get_file_metadata:[{file_id:'file'},['getFile']],
 bot_api_call:[{method:'getMe'},['getMe']]
};
test('every declared channel typed tool has a successful mocked execution case',()=>{
 assert.deepEqual(extensions.map(t=>t.name).sort(),Object.keys(cases).sort());
});
for(const [name,[args,methods]] of Object.entries(cases))test('channel tool routes correctly: '+name,async()=>{
 const f=client();const result=await executeTool(name,structuredClone(args),f.fetch);
 assert.ok(result!==undefined);assert.deepEqual(f.calls.map(c=>c.method),methods);
 for(const call of f.calls){
  if(call.params.chat_id!==undefined)assert.equal(call.params.chat_id,channel);
  assert.ok(!Object.hasOwn(call.params,'business_connection_id'));
 }
 if(name==='send_rich_message')assert.deepEqual(f.calls[0].params.reply_parameters,{message_id:9,allow_sending_without_reply:false});
 if(name==='send_poll'){
  assert.deepEqual(f.calls[0].params.correct_option_ids,[1]);assert.equal(f.calls[0].params.correct_option_id,undefined);
 }
 if(name==='copy_channel_message')assert.equal(f.calls[0].params.from_chat_id,channel);
 if(name==='get_file_metadata')assert.equal(result.download_url_not_exposed,true);
});
test('every enabled generic method rejects a foreign chat and every special method is disabled',()=>{
 for(const [group,names] of Object.entries(security.methods))for(const method of names){
  assert.throws(()=>security.validateMethod(method,{chat_id:'@unapproved_chat'},true),
   group==='special'?/method_disabled_for_safety/:/chat_not_allowed/,method);
 }
 assert.equal(new Set(Object.values(security.methods).flat()).size,Object.values(security.methods).flat().length);
});
test('inline, business and ephemeral alternate targets cannot bypass the channel gateway',async()=>{
 const f=client();
 for(const method of ['editMessageText','editMessageCaption','editMessageMedia','editMessageReplyMarkup','setGameScore','getGameHighScores'])
  await assert.rejects(()=>executeTool('bot_api_call',{method,params:{inline_message_id:'foreign-inline',message_id:1,user_id:1}},f.fetch),/unscoped_target_not_allowed/);
 await assert.rejects(()=>executeTool('bot_api_call',{method:'sendMessage',params:{text:'Test',business_connection_id:'connection'}},f.fetch),/business_connection_requires_dedicated_tool/);
 await assert.rejects(()=>executeTool('bot_api_call',{method:'sendMessage',params:{text:'Test',ephemeral_message_parameters:{receiver_user_id:123}}},f.fetch),/unscoped_target/);
 assert.equal(f.calls.length,0);
});
test('nested chat scope is checked even when the Telegram object arrives as serialized JSON',async()=>{
 const f=client();
 for(const scope of [{type:'chat',chat_id:'@unapproved_chat'},JSON.stringify({type:'chat',chat_id:'@unapproved_chat'})])
  await assert.rejects(()=>executeTool('bot_api_call',{method:'setMyCommands',confirm_dangerous:true,params:{commands:[],scope}},f.fetch),/chat_not_allowed/);
 await assert.rejects(()=>executeTool('bot_api_call',{method:'sendMessage',params:{text:'X',reply_parameters:JSON.stringify({chat_id:'@unapproved_chat',message_id:1})}},f.fetch),/chat_not_allowed/);
 assert.equal(f.calls.length,0);
});
test('moderation actor IDs are allowed under a scoped destination, not mistaken for destinations',async()=>{
 const f=client();
 await executeTool('bot_api_call',{method:'banChatSenderChat',confirm_dangerous:true,params:{sender_chat_id:-100987654321}},f.fetch);
 assert.equal(f.calls[0].params.chat_id,channel);assert.equal(f.calls[0].params.sender_chat_id,-100987654321);
});
test('all chat management operations receive the configured chat default; bot menu keeps its API default',async()=>{
 const f=client();
 for(const method of ['createForumTopic','editGeneralForumTopic','setChatStickerSet','setChatMemberTag','banChatSenderChat','getChatGifts']){
  await executeTool('bot_api_call',{method,params:{},confirm_dangerous:true},f.fetch);
  assert.equal(f.calls.at(-1).params.chat_id,channel,method);
 }
 for(const method of ['getChatMenuButton','setChatMenuButton']){
  await executeTool('bot_api_call',{method,confirm_dangerous:true},f.fetch);
  assert.equal(f.calls.at(-1).params.chat_id,undefined,method);
 }
});
test('channel source is mandatory for generic copy/forward and paid broadcasting is removed',async()=>{
 const f=client();
 for(const method of ['copyMessage','copyMessages','forwardMessage','forwardMessages'])
  await assert.rejects(()=>executeTool('bot_api_call',{method,params:{message_id:1}},f.fetch),/from_chat_id_required/);
 await executeTool('bot_api_call',{method:'sendMessage',params:{text:'X',allow_paid_broadcast:true}},f.fetch);
 assert.equal(f.calls[0].params.allow_paid_broadcast,undefined);
});
test('typed arguments reject wrong types, unknown fields, invalid IDs and destructive calls without confirmation',async()=>{
 const f=client();
 for(const [name,args] of [['edit_caption',{message_id:0,caption:'X'}],['send_media',{type:'photo',url:'https://example.org/a.jpg',silent:'false'}],
  ['get_member_count',{extra:true}],['send_album',{media:[null,null]}],['get_bot_stars',{limit:0}],['edit_buttons',{message_id:1,rows:null}]])
  await assert.rejects(()=>executeTool(name,args,f.fetch),/invalid_arguments/);
 for(const [name,args] of [['delete_channel_message',{message_id:1,confirm:false}],['set_channel_description',{description:'X',confirm:false}],
  ['revoke_invite_link',{invite_link:'https://t.me/+a',confirm:false}]])
  await assert.rejects(()=>executeTool(name,args,f.fetch),/explicit_confirmation_required/);
 assert.equal(f.calls.length,0);
});
test('poll adapter supports current quiz IDs, one-option regular polls and longer official open period',async()=>{
 const f=client();
 await executeTool('send_poll',{question:'Single option',options:['A'],open_period:86400},f.fetch);
 assert.equal(f.calls.at(-1).params.open_period,86400);
 await executeTool('send_poll',{question:'Multiple quiz',options:['A','B'],quiz:true,correct_option_ids:[0,1],multiple_answers:true},f.fetch);
 assert.deepEqual(f.calls.at(-1).params.correct_option_ids,[0,1]);
 for(const args of [
  {quiz:true,correct_option_id:4},
  {quiz:true,correct_option_ids:[1,0],multiple_answers:true},
  {quiz:true,correct_option_ids:[0,1]},
  {quiz:true,correct_option_id:1,explanation:'x'.repeat(201)},
  {quiz:true,correct_option_id:1,explanation:'a\nb\nc\nd'},
  {correct_option_id:1},
  {quiz:true,correct_option_id:1,correct_option_ids:[1]}
 ])await assert.rejects(()=>executeTool('send_poll',{question:'Q',options:['A','B'],...args},f.fetch));
 assert.equal(f.calls.length,2);
});
test('all seven typed media kinds use the correct Telegram file field',async()=>{
 const f=client();
 const methods={photo:'sendPhoto',video:'sendVideo',document:'sendDocument',audio:'sendAudio',animation:'sendAnimation',voice:'sendVoice',sticker:'sendSticker'};
 for(const [type,method] of Object.entries(methods)){
  await executeTool('send_media',{type,url:'https://example.org/file'+(type==='sticker'?'.webp':'.bin')},f.fetch);
  const call=f.calls.at(-1);assert.equal(call.method,method);assert.equal(call.params[type].startsWith('https://'),true);
 }
 await assert.rejects(()=>executeTool('send_media',{type:'sticker',url:'https://example.org/a.webm'},f.fetch),/static_webp/);
 await assert.rejects(()=>executeTool('send_media',{type:'photo',url:'https://secret:password@example.org/a.jpg'},f.fetch),/public_https/);
});
test('button target conflicts, oversized captions and malformed rich blocks fail before any send',async()=>{
 const f=client();
 for(const [name,args] of [
  ['send_buttons',{text:'X',rows:[[{text:'X',url:'https://example.org',callback_data:'x'}]]}],
  ['send_buttons',{text:'X',rows:[[{text:'X',callback_data:'я'.repeat(33)}]]}],
  ['send_media',{type:'photo',url:'https://example.org/a.jpg',caption:'X'.repeat(1025)}],
  ['send_rich_message',{blocks:[{}]}],
  ['send_rich_message',{blocks:[null]}],
  ['send_rich_message',{content:'X',blocks:[{type:'paragraph',text:'Y'}]}],
  ['create_invite_link',{name:'X'.repeat(33)}]
 ])await assert.rejects(()=>executeTool(name,args,f.fetch));
 assert.equal(f.calls.length,0);
 await executeTool('send_rich_message',{content:'Default Markdown'},f.fetch);
 assert.equal(f.calls[0].params.rich_message.markdown,'Default Markdown');
});
test('malformed, failed and lost Telegram responses remain errors without upstream secret leakage',async()=>{
 const token=process.env.TELEGRAM_BOT_TOKEN;
 for(const j of [null,[],{},'ok',{ok:true},{ok:true,result:null}])
  await assert.rejects(()=>executeTool('get_chat_info',{},async()=>({ok:true,status:200,json:async()=>j})),e=>e.category==='transport_unknown');
 await assert.rejects(()=>executeTool('get_chat_info',{},async()=>{throw Error('https://api.telegram.org/bot'+token+'/getChat');}),
  e=>e.category==='transport_unknown'&&!e.message.includes(token));
 await assert.rejects(()=>executeTool('get_chat_info',{},async()=>({ok:false,status:429,json:async()=>({ok:false,error_code:429,description:token,parameters:{retry_after:7}})})),
  e=>e.category==='api_rejected'&&e.retry_after===7&&!e.message.includes(token));
 for(const result of [{},true,{message_id:0},{message_id:'1'}])
  await assert.rejects(()=>executeTool('send_buttons',{text:'X',rows:[]},async()=>({ok:true,status:200,json:async()=>({ok:true,result})})),
   e=>e.category==='transport_unknown'&&/confirmation_missing/.test(e.message));
});
test('read-only classification is exact and cannot misclassify Business or unknown methods',()=>{
 for(const method of security.methods.read)assert.equal(security.isReadOnlyGenericCall({method}),true,method);
 for(const method of [...security.methods.publish,...security.methods.manage,...security.methods.special,'getUnknown','business_connections'])
  assert.equal(security.isReadOnlyGenericCall({method}),false,method);
});
test('HTTP500 remains uncertain even with an inconsistent400 body and boolean mutations need true confirmation',async()=>{
 await assert.rejects(()=>executeTool('get_chat_info',{},async()=>({ok:false,status:500,json:async()=>({ok:false,error_code:400})})),
  e=>e.category==='transport_unknown');
 for(const result of [false,{},null])await assert.rejects(()=>executeTool('pin_message',{message_id:1},async()=>({ok:true,status:200,
  json:async()=>({ok:true,result})})),e=>e.category==='transport_unknown');
});
