import test from 'node:test';
import assert from 'node:assert/strict';
import {
  webhookToken, verifyWebhookToken, parseCallbackData, summarizeComment,
  normalizeEvent, aggregateAudience, feedbackKeyboard, topicIdeas
} from '../lib/audience-core.js';
import {createAudienceStore} from '../lib/audience-store.js';

const secret='123456:AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const channelId=-100111;const discussionId=-100222;

test('webhook secret is deterministic, opaque, and rejects impostors',()=>{
 const key=webhookToken(secret);
 assert.match(key,/^[a-zA-Z0-9_-]{32,128}$/);
 assert.notEqual(key,secret);
 assert.equal(verifyWebhookToken(key,secret),true);
 assert.equal(verifyWebhookToken(key+'x',secret),false);
 assert.equal(verifyWebhookToken('',secret),false);
});

test('only scoped callback votes are accepted; identity is pseudonymized',()=>{
 const parsed=parseCallbackData('mp:v1:20261107:useful');
 assert.deepEqual(parsed,{post_key:'20261107',choice:'useful'});
 assert.equal(parseCallbackData('not-mp:20261107:useful'),null);
 assert.equal(parseCallbackData('mp:v1:../../:useful'),null);
 const event=normalizeEvent({update_id:10,callback_query:{id:'abc',data:'mp:v1:20261107:useful',from:{id:9152,username:'never-store'},message:{message_id:71,chat:{id:channelId}}}}, {channelId,discussionId,secret});
 assert.equal(event.type,'feedback_vote');
 assert.equal(event.post_key,'20261107');
 assert.ok(event.actor_hash);
 assert.ok(!JSON.stringify(event).includes('9152'));
 assert.ok(!JSON.stringify(event).includes('never-store'));
});

test('foreign callback and unrelated group message are rejected',()=>{
 const ctx={channelId,discussionId,secret};
 assert.equal(normalizeEvent({update_id:12,callback_query:{id:'X',data:'mp:v1:20261107:more',from:{id:2},message:{chat:{id:-100987},message_id:2}}},ctx),null);
 assert.equal(normalizeEvent({update_id:13,message:{chat:{id:-100999},message_id:3,from:{id:2},text:'my private message'}},ctx),null);
});

test('comment text redacts contacts, strips private names and maps useful questions',()=>{
 const c=summarizeComment('Почему комиссии такие высокие? Напишите me@site.ru и +7 999 123 45 67!');
 assert.match(c.text,/\[контакт\]/);
 assert.ok(!c.text.includes('me@site.ru'));
 assert.ok(!c.text.includes('+7 999'));
 assert.equal(c.is_question,true);
 assert.ok(c.topics.includes('инвестиции'));
 const event=normalizeEvent({update_id:14,message:{
   chat:{id:discussionId},message_id:54,from:{id:22,username:'private'},
   text:'Почему комиссии такие высокие?',
   reply_to_message:{is_automatic_forward:true,forward_origin:{type:'channel',chat:{id:channelId},message_id:32}}
 }},{channelId,discussionId,secret});
 assert.equal(event.type,'discussion_comment');
 assert.equal(event.post_message_id,32);
 assert.ok(!JSON.stringify(event).includes('private'));
});

test('channel post has only metadata, not entire author text',()=>{
 const event=normalizeEvent({update_id:15,channel_post:{chat:{id:channelId},message_id:80,date:1793860000,text:'full user-facing text'}},{channelId,discussionId,secret});
 assert.equal(event.type,'channel_delivery');
 assert.equal(event.message_id,80);
 assert.ok(!JSON.stringify(event).includes('full user-facing text'));
});

test('reaction totals are anonymous aggregate, no invented views',()=>{
 const event=normalizeEvent({update_id:16,message_reaction_count:{chat:{id:channelId},message_id:82,date:1793860000,reactions:[{type:{type:'emoji',emoji:'👍'},total_count:9}]}},{channelId,discussionId,secret});
 assert.equal(event.type,'reaction_count');
 assert.equal(event.reactions[0].count,9);
 assert.equal(event.views,undefined);
});

test('report and topics are honest heuristic summaries',()=>{
 const e=[{type:'discussion_comment',text:'Почему комиссия фонда выше?',is_question:true,topics:['инвестиции']},
 {type:'discussion_comment',text:'Как рассчитать маржу предприятия?',is_question:true,topics:['бизнес']},
 {type:'feedback_vote',post_key:'20261107',choice:'useful',actor_hash:'h1'},
 {type:'feedback_vote',post_key:'20261107',choice:'more',actor_hash:'h2'}];
 const report=aggregateAudience(e);
 assert.equal(report.total_comments,2);
 assert.equal(report.feedback_votes.useful,1);
 assert.equal(report.views_available,false);
 const ideas=topicIdeas(e);
 assert.ok(ideas.some(x=>x.topic==='инвестиции'));
 assert.ok(ideas.every(x=>x.source==='читательские вопросы (эвристика)'));
});

test('feedback keyboard attaches 3 buttons to same article, no new post',()=>{
 const kb=feedbackKeyboard('20261107');
 assert.equal(kb.inline_keyboard.flat().length,3);
 assert.equal(kb.inline_keyboard[0][0].callback_data,'mp:v1:20261107:useful');
});

test('private immutable events are idempotent, storage missing fails closed',async()=>{
 const db=new Map();
 const adapter={
   async put(path,text,opts){if(db.has(path))throw new Error('BlobAlreadyExistsError');db.set(path,JSON.parse(text));return {pathname:path};},
   async list(opts){return {blobs:[...db.keys()].filter(k=>k.startsWith(opts.prefix)).map(pathname=>({pathname})),hasMore:false}},
   async get(path){if(!db.has(path))return null;return {statusCode:200,stream:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify(db.get(path))));c.close();}}),blob:{pathname:path}}},
   async del(paths){for(const p of [].concat(paths))db.delete(p);}
 };
 const store=createAudienceStore(adapter);
 const event={type:'feedback_vote',update_id:444,post_key:'20261107',choice:'more',actor_hash:'abc',observed_at:'2026-11-05T09:00:00Z'};
 assert.equal((await store.record(event)).stored,true);
 assert.equal((await store.record(event)).duplicate,true);
 const r=await store.readRecent({prefix:'events/2026-11/',limit:20});
 assert.equal(r.events.length,1);
 const noToken=createAudienceStore(null);
 await assert.rejects(()=>noToken.record(event),/storage_not_configured/);
});

test('rich channel deliveries keep distinct JSON digests and reply metadata without text',()=>{
 const ctx={channelId,discussionId,secret};
 const delivery=(text,id=81)=>normalizeEvent({update_id:id,channel_post:{
  chat:{id:channelId},message_id:id,date:1793860000,
  rich_message:{blocks:[{type:'paragraph',text}]},
  reply_to_message:{message_id:80,chat:{id:channelId},caption:'cover caption never stored'}
 }},ctx);
 const first=delivery('first rich article secret content');
 const second=delivery('second rich article secret content',82);
 assert.equal(first.kind,'rich');
 assert.equal(first.digest_source,'rich_message_json');
 assert.equal(first.reply_to_message_id,80);
 assert.notEqual(first.content_digest,second.content_digest);
 const stored=JSON.stringify(first);
 assert.ok(!stored.includes('first rich article secret content'));
 assert.ok(!stored.includes('cover caption never stored'));
 const text=normalizeEvent({update_id:83,channel_post:{chat:{id:channelId},message_id:83,text:'private author text'}},ctx);
 assert.equal(text.digest_source,'text');
 assert.equal(text.reply_to_message_id,null);
 const foreign=normalizeEvent({update_id:84,channel_post:{chat:{id:channelId},message_id:84,
  reply_to_message:{message_id:99,chat:{id:-999}}}},ctx);
 assert.equal(foreign.reply_to_message_id,null);
});
