import test from 'node:test';
import assert from 'node:assert/strict';
import {audienceTools,executeAudienceTool} from '../lib/audience-tools.js';
import {createAudienceService,botRequest,UPDATE_TYPES} from '../lib/audience-service.js';
import {aggregateAudience,normalizeEvent,feedbackKeyboard} from '../lib/audience-core.js';
import {privateStoreKey,createAudienceStore} from '../lib/audience-store.js';

const TOKEN='123456:AbCdEfGhIjKlMnOpQrStUvWxYz012345',BASE='https://money-psy-telegram-mcp.vercel.app';
const channelId=-100111,discussionId=-100222;
process.env.TELEGRAM_BUSINESS_OWNER_IDS='';
function fixture({editResult,writeFailure=false,updates=UPDATE_TYPES,serverReceipt=null}={}){
 const calls=[],saved=[],events=[
  {type:'discussion_comment',observed_at:'2026-11-05T09:00:01Z',post_message_id:382,text:'Почему комиссия?',topics:['инвестиции'],is_question:true},
  {type:'feedback_vote',observed_at:'2026-11-05T09:00:02Z',post_key:'20261105',message_id:382,choice:'useful'},
  {type:'reaction_count',observed_at:'2026-11-05T09:00:03Z',date:100,message_id:382,reactions:[{emoji:'👍',count:1}]},
  {type:'reaction_count',observed_at:'2026-11-05T09:00:04Z',date:101,message_id:382,reactions:[{emoji:'👍',count:2}]},
  {type:'subscriber_snapshot',observed_at:'2026-11-05T20:00:00Z',member_count:456}
 ];
 let webhook='';
 const store={async record(e){saved.push(e);return {stored:true,duplicate:false};},
  async readRecent(o){calls.push({store:'readRecent',params:o});return {events,hasMore:true,scan_truncated:false};}};
 const telegramApi=async(method,params)=>{
  calls.push({method,params});
  if(method==='getWebhookInfo')return {url:webhook,allowed_updates:updates};
  if(method==='getChat')return {id:channelId,linked_chat_id:discussionId};
  if(method==='setWebhook'){webhook=params.url;return true;}
  if(method==='deleteWebhook'){webhook='';return true;}
  if(method==='getChatMemberCount')return 457;
  if(method==='editMessageReplyMarkup')return editResult?editResult(params):{message_id:params.message_id,chat:{id:channelId},reply_markup:params.reply_markup};
  throw Error('unexpected method '+method);
 };
 const queue={entries:[{date_moscow:'2026-11-05',title:'test',state:'published',scheduled_at:'2026-11-05T12:00:00+03:00',
  telegram_publication:{article_message_id:382,cover_message_id:381}}]};
 const receipts=new Map();
 const service=createAudienceService({telegramApi,store,botToken:TOKEN,
  editorialSource:{async readQueue(){return {queue,commit:'a'.repeat(40)};}},
  publicationStore:{async summary(){return {...(serverReceipt||{status:'no_server_attempt_record'}),feedback_confirmation:receipts.get('feedback_result')||null};},
   async read(d,s){return receipts.get(s)||null;},async write(d,s,r){if(writeFailure===true||typeof writeFailure==='function'&&writeFailure())throw Error('storage failed');receipts.set(s,r);}}});
 return {service,calls,saved,events,receipts,queue,setWebhook(value){webhook=value;}};
}
const cases={
 get_interaction_status:{args:{},verify:r=>{assert.equal(r.safe_to_enable,true);assert.equal(r.discussion_group_id,discussionId);}},
 get_reader_feedback:{args:{month:'2026-11',post_key:'20261105',limit:20},verify:r=>{
  assert.equal(r.report.total_comments,1);assert.equal(r.report.feedback_votes.useful,1);
  assert.equal(r.report.latest_reaction_snapshots,1);assert.equal(r.report.reactions[0].reactions[0].count,2);
  assert.equal(r.post_filter_mapping_available,true);assert.equal(r.sample_truncated,true);assert.equal(r.report.views_available,false);
 }},
 suggest_reader_topics:{args:{month:'2026-11',limit:20},verify:r=>{
  assert.equal(r.topic_ideas[0].topic,'инвестиции');assert.equal(r.sample_truncated,true);assert.equal(r.verified_research,false);
 }},
 get_publication_journal:{args:{limit:10},verify:r=>{assert.equal(r.entries[0].telegram_publication.article_message_id,382);assert.equal(r.source_commit,'a'.repeat(40));}},
 get_member_trend:{args:{month:'2026-11',limit:20},verify:r=>{assert.equal(r.snapshots[0].member_count,456);assert.equal(r.truncated,true);}},
 enable_reader_feedback:{args:{confirm:true},verify:r=>assert.equal(r.enabled,true)},
 disable_reader_feedback:{args:{confirm:true},webhook:BASE+'/api/updates',verify:r=>assert.equal(r.enabled,false)},
 attach_feedback_buttons:{args:{date_moscow:'2026-11-05',confirm:true},webhook:BASE+'/api/updates',verify:r=>{assert.equal(r.attached,true);assert.equal(r.no_new_post_sent,true);assert.equal(r.article_message_id,382);}},
 capture_member_snapshot:{args:{},verify:r=>{assert.equal(r.member_count,457);assert.equal(r.stored,true);assert.equal(r.not_post_views,true);}}
};
for(const definition of audienceTools)test('audience tool '+definition.name+' executes its advertised scoped function',async()=>{
 const c=cases[definition.name];assert.ok(c,'missing catalog coverage');
 const f=fixture();if(c.webhook)f.setWebhook(c.webhook);
 const result=await executeAudienceTool(definition.name,c.args,f.service);c.verify(result);
 assert.ok(!f.calls.some(x=>/^send|deleteMessage|setBusiness/.test(x.method||'')));
 if(definition.name==='capture_member_snapshot')assert.equal(f.saved[0].type,'subscriber_snapshot');
 if(definition.name==='enable_reader_feedback'){
  const p=f.calls.find(x=>x.method==='setWebhook').params;
  assert.equal(p.drop_pending_updates,false);assert.equal(p.url,BASE+'/api/updates');
  assert.equal(p.allowed_updates.includes('business_message'),false);assert.ok(p.allowed_updates.includes('callback_query'));
 }
});
test('audience tool schema rejects malformed arguments and unknown fields before execution',async()=>{
 const f=fixture();
 for(const [name,args] of [['get_reader_feedback',{limit:0}],['get_publication_journal',{limit:41}],
  ['get_member_trend',{month:202611}],['attach_feedback_buttons',{date_moscow:'2026-11-05',confirm:'true'}],
  ['capture_member_snapshot',{chat_id:123}],['get_interaction_status',[]]]){
  await assert.rejects(()=>executeAudienceTool(name,args,f.service),/invalid_tool_arguments/);
 }
 assert.equal(f.calls.length,0);assert.equal(f.saved.length,0);
 await assert.rejects(()=>executeAudienceTool('unknown',{},f.service),/unknown_audience_tool/);
});
test('webhook and attachment mutations require explicit confirmation and confirmed API results',async()=>{
 const f=fixture();
 for(const name of ['enable_reader_feedback','disable_reader_feedback'])
  await assert.rejects(()=>executeAudienceTool(name,{confirm:false},f.service),/confirmation_required/);
 assert.equal(f.calls.length,0);
 const unconfirmed=createAudienceService({store:{},botToken:TOKEN,telegramApi:async(method)=>method==='getWebhookInfo'?{url:''}:false});
 await assert.rejects(()=>unconfirmed.enable({confirm:true}),/not_confirmed/);
});
test('public feedback refuses invalid months, reports missing post mapping and never fabricates a match',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.service.topics({month:'2026-99'}),/invalid_month/);
 const report=await f.service.report({month:'2026-11',post_key:'20261106'});
 assert.equal(report.post_filter_mapping_available,false);assert.equal(report.checked_events,0);
});
test('event path validation rejects forged post keys, actor paths, type paths and malformed retention dates',async()=>{
 const event={type:'feedback_vote',post_key:'20261105',actor_hash:'a'.repeat(24),observed_at:'2026-11-05T09:00:00Z'};
 assert.ok(privateStoreKey(event).startsWith('events/2026-11/vote-20261105-'));
 for(const corrupt of [{post_key:'../escape'},{actor_hash:'actor'},{type:'../escape'},{observed_at:'invalid'}])
  assert.throws(()=>privateStoreKey({...event,...corrupt}),/invalid_/);
 const s=createAudienceStore({list:async()=>{throw Error('must not call SDK');}});
 await assert.rejects(()=>s.purgeBefore('2026-99-99'),/invalid_cutoff/);
 await assert.rejects(()=>s.purgeBefore('2026-11-01',{maxDelete:-1}),/invalid_retention_limit/);
});
test('unscoped poll updates are not incorrectly attributed to the configured channel',()=>{
 const r=normalizeEvent({update_id:1,poll:{id:'private-poll',options:[{text:'private',voter_count:1}]}},
  {channelId,discussionId,secret:TOKEN});assert.equal(r,null);
});
test('aggregation chooses latest reaction per message and tolerates malformed samples',()=>{
 const r=aggregateAudience([null,[],{type:'discussion_comment',topics:7},
  {type:'reaction_count',message_id:1,date:20,reactions:[{emoji:'👍',count:5}]},
  {type:'reaction_count',message_id:1,date:10,reactions:[{emoji:'👍',count:1}]}]);
 assert.equal(r.latest_reaction_snapshots,1);assert.equal(r.reactions[0].reactions[0].count,5);
});
test('audience Telegram transport rejects HTTP failures and malformed results without leaking descriptions',async()=>{
 process.env.TELEGRAM_BOT_TOKEN=TOKEN;
 await assert.rejects(()=>botRequest('getChat',{},async()=>({ok:false,status:500,json:async()=>({ok:true,result:{}})})),/failed: 500/);
 for(const value of [null,{},'wrong'])await assert.rejects(()=>botRequest('getChat',{},async()=>({ok:true,status:200,json:async()=>value})),/failed/);
 await assert.rejects(()=>botRequest('getChat',{},async()=>({ok:true,status:200,json:async()=>({ok:false,description:TOKEN,error_code:400})})),
  e=>!e.message.includes(TOKEN)&&e.message.includes('400'));
});
test('reader feedback enable never implicitly opts into Business and disable preserves independent subscriptions',async()=>{
 process.env.TELEGRAM_BUSINESS_OWNER_IDS='123';
 let webhook={url:BASE+'/api/updates',allowed_updates:['message','callback_query','inline_query']},calls=[];
 const service=createAudienceService({store:{},botToken:TOKEN,telegramApi:async(method,params)=>{
  if(method==='getWebhookInfo')return webhook;
  calls.push({method,params});return true;
 }});
 await service.enable({confirm:true});
 assert.ok(!calls[0].params.allowed_updates.some(x=>x.startsWith('business_')||x==='deleted_business_messages'));
 calls=[];await service.disable({confirm:true});
 assert.deepEqual(calls[0].params.allowed_updates,['inline_query']);
 assert.equal(calls[0].params.drop_pending_updates,false);
 webhook={url:BASE+'/api/updates',allowed_updates:['message','callback_query']};calls=[];
 await service.disable({confirm:true});assert.equal(calls[0].method,'deleteWebhook');
 process.env.TELEGRAM_BUSINESS_OWNER_IDS='';
});

test('button repair requires actual message, channel and exact keyboard confirmation',async()=>{
 for(const editResult of [()=>true,p=>({message_id:p.message_id}),p=>({message_id:p.message_id,chat:{id:999},reply_markup:p.reply_markup}),
  p=>({message_id:p.message_id,chat:{id:channelId},reply_markup:feedbackKeyboard('20261106')})]){
  const f=fixture({editResult});f.setWebhook(BASE+'/api/updates');
  await assert.rejects(()=>f.service.attachButtons({date_moscow:'2026-11-05',confirm:true}),/feedback_buttons_not_confirmed/);
  assert.equal(f.receipts.size,0);
 }
});
test('button repair persists proof and journal exposes it without inventing a historical send receipt',async()=>{
 const f=fixture();f.setWebhook(BASE+'/api/updates');
 const r=await f.service.attachButtons({date_moscow:'2026-11-05',confirm:true});
 assert.equal(r.feedback_buttons_confirmed,true);assert.equal(r.confirmation_persisted,true);
 assert.equal(f.receipts.get('feedback_result').message_id,382);
 const journal=await f.service.publicationJournal();
 assert.equal(journal.entries[0].server_receipt.status,'no_server_attempt_record');
 assert.equal(journal.entries[0].server_receipt.feedback_confirmation.message_id,382);
});
test('repair receipt failure is reported separately from confirmed Telegram keyboard, no extra posts',async()=>{
 const f=fixture({writeFailure:true});f.setWebhook(BASE+'/api/updates');
 const r=await f.service.attachButtons({date_moscow:'2026-11-05',confirm:true});
 assert.equal(r.feedback_buttons_confirmed,true);assert.equal(r.confirmation_persisted,false);
 assert.equal(r.warning,'feedback_receipt_not_persisted');
 assert.equal(f.calls.filter(x=>x.method==='editMessageReplyMarkup').length,1);
});

test('confirmed partial delivery can repair its existing article without marking or resending it',async()=>{
 const receipt={status:'partial_or_uncertain',cover_message_id:381,article_message_id:382,telegram_chat_id:channelId};
 const f=fixture({serverReceipt:receipt});f.queue.entries[0].state='sending';f.queue.entries[0].telegram_publication=null;
 f.setWebhook(BASE+'/api/updates');
 const r=await f.service.attachButtons({date_moscow:'2026-11-05',confirm:true});
 assert.equal(r.article_message_id,382);assert.equal(r.feedback_buttons_confirmed,true);
 assert.equal(f.queue.entries[0].state,'sending');
 assert.equal(f.calls.filter(x=>x.method?.startsWith('send')).length,0);
 const missing=fixture();missing.queue.entries[0].state='sending';missing.queue.entries[0].telegram_publication=null;
 missing.setWebhook(BASE+'/api/updates');
 await assert.rejects(()=>missing.service.attachButtons({date_moscow:'2026-11-05',confirm:true}),/article_not_confirmed/);
 assert.equal(missing.calls.filter(x=>x.method==='editMessageReplyMarkup').length,0);
});
test('manual attachment refuses webhook without callback subscription',async()=>{
 const f=fixture({updates:['message']});f.setWebhook(BASE+'/api/updates');
 await assert.rejects(()=>f.service.attachButtons({date_moscow:'2026-11-05',confirm:true}),/interactive_webhook_not_active/);
 assert.equal(f.calls.filter(x=>x.method==='editMessageReplyMarkup').length,0);
});

test('repair retry recovers persistence after Telegram reports that the exact keyboard is unchanged',async()=>{
 let edits=0,writes=0;
 const f=fixture({writeFailure:()=>++writes===1,editResult:p=>{
  if(++edits===2)throw Object.assign(Error('telegram_editMessageReplyMarkup_failed: 400'),{category:'reply_markup_not_modified'});
  return {message_id:p.message_id,chat:{id:channelId},reply_markup:p.reply_markup};
 }});f.setWebhook(BASE+'/api/updates');
 const first=await f.service.attachButtons({date_moscow:'2026-11-05',confirm:true});assert.equal(first.confirmation_persisted,false);
 const second=await f.service.attachButtons({date_moscow:'2026-11-05',confirm:true});
 assert.equal(second.confirmation_persisted,true);assert.equal(second.confirmation_source,'telegram_reply_markup_unchanged');
 assert.equal(second.telegram_result,null);assert.equal(f.calls.filter(x=>x.method?.startsWith('send')).length,0);
});
test('only exact Telegram not-modified rejection for reply-markup edits receives a safe category',async()=>{
 process.env.TELEGRAM_BOT_TOKEN=TOKEN;
 const description='Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message';
 const response=(desc,code=400)=>async()=>({ok:false,status:code,json:async()=>({ok:false,error_code:code,description:desc})});
 await assert.rejects(()=>botRequest('editMessageReplyMarkup',{},response(description)),e=>e.category==='reply_markup_not_modified'&&!e.message.includes(description));
 for(const [method,desc,code] of [['editMessageText',description,400],['editMessageReplyMarkup','Bad Request: not enough rights',400],
  ['editMessageReplyMarkup',description,500]])
  await assert.rejects(()=>botRequest(method,{},response(desc,code)),e=>!e.category);
});
