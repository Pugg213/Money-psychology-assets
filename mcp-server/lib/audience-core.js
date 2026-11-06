import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
const words={
 'инвестиции':/(?:фонд|акци|облигаци|бирж|комисси|индекс|etf|инвест|дивиденд)/i,
 'бизнес':/(?:бизнес|предприяти|прибы|марж|кассов|выруч|поставщик|дебитор|продаж)/i,
 'работа':/(?:зарплат|работ|труд|карьер|работодател|производительн|сотрудник)/i,
 'семья':/(?:семь|ребен|ребён|детск|садик|нян|родител|уход)/i,
 'экономика':/(?:инфляц|ставк|экономик|цена|доход|кредит|центробанк|цб)/i,
 'криптовалюты':/(?:крипт|биткоин|ton|токен|блокчейн|nft|кошелёк)/i
};
export function webhookToken(botToken){
 if(typeof botToken!=='string'||botToken.length<20)throw Error('bot_token_unavailable');
 return createHmac('sha256',botToken).update('money-psy-telegram-webhook-v1').digest('base64url');
}
export function verifyWebhookToken(received,botToken){
 if(typeof received!=='string'||received.length>256)return false;
 try{const expected=webhookToken(botToken);const a=Buffer.from(received),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}catch{return false;}
}
export function parseCallbackData(value){
 if(typeof value!=='string')return null;
 const m=/^mp:v1:(20\d{6}):(useful|more|less)$/.exec(value);
 return m?{post_key:m[1],choice:m[2]}:null;
}
export function feedbackKeyboard(postKey){
 if(typeof postKey!=='string'||!/^20\d{6}$/.test(postKey))throw Error('invalid_post_key');
 return {inline_keyboard:[[
  {text:'Полезно',callback_data:'mp:v1:'+postKey+':useful'},
  {text:'Хочу продолжение',callback_data:'mp:v1:'+postKey+':more'},
  {text:'Не моя тема',callback_data:'mp:v1:'+postKey+':less'}
 ]]};
}
export function feedbackKeyboardMatches(markup,postKey){
 const rows=markup?.inline_keyboard,expected=feedbackKeyboard(postKey).inline_keyboard[0];
 return Array.isArray(rows)&&rows.length===1&&Array.isArray(rows[0])&&rows[0].length===expected.length&&
  expected.every((b,i)=>rows[0][i]?.text===b.text&&rows[0][i]?.callback_data===b.callback_data);
}
export function feedbackWebhookActive(info,endpoint){
 return info?.url===endpoint&&(!Array.isArray(info.allowed_updates)||!info.allowed_updates.length||info.allowed_updates.includes('callback_query'));
}
function pseudonym(id,secret){
 if(!Number.isSafeInteger(id))return null;
 return createHmac('sha256',secret).update('actor:v1:'+id).digest('hex').slice(0,24);
}
export function summarizeComment(input){
 const raw=String(input||'').slice(0,2000);
 const redacted=raw
  .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[контакт]')
  .replace(/(?:https?:\/\/|t\.me\/)\S+/gi,'[ссылка]')
  .replace(/(?:\+?\d[\d\s()\-]{8,}\d)/g,'[контакт]')
  .replace(/@[\w\d_]{3,}/g,'[упоминание]')
  .replace(/[\x00-\x08\x0B-\x1F]/g,' ')
  .trim().slice(0,550);
 const topics=Object.entries(words).filter(([,p])=>p.test(redacted)).map(([n])=>n);
 const is_question=/\?|？|(?:^|\s)(?:почему|как|зачем|что|можно|сколько|какой|где)(?:\s|$)/i.test(redacted);
 return {text:redacted,is_question,topics,classification:'heuristic_not_ai'};
}
export function normalizeEvent(update,{channelId,discussionId,secret}){
 if(!update||!Number.isSafeInteger(update.update_id)||update.update_id<0||!secret)return null;
 const id=update.update_id,observed_at=new Date().toISOString();
 const c=update.callback_query;
 if(c){
  const choice=parseCallbackData(c.data);
  if(!choice||!c.message||String(c.message.chat?.id)!==String(channelId)||!Number.isSafeInteger(c.from?.id))return null;
  return {type:'feedback_vote',update_id:id,post_key:choice.post_key,choice:choice.choice,
   actor_hash:pseudonym(c.from.id,secret),message_id:c.message.message_id,observed_at};
 }
 const m=update.message;
 if(m && String(m.chat?.id)===String(discussionId) && Number.isSafeInteger(m.from?.id) && !m.from.is_bot){
  const f=m.reply_to_message;
  const origin=f?.forward_origin;
  const sourceVerified=origin?.type==='channel'&&String(origin.chat?.id)===String(channelId)||
   !origin&&String(f?.forward_from_chat?.id)===String(channelId);
  if(!f||!sourceVerified)return null;
  const txt=summarizeComment(m.text||m.caption||'');
  if(!txt.text)return null;
  return {type:'discussion_comment',update_id:id,post_message_id:origin?.message_id??f.forward_from_message_id??null,
    message_id:m.message_id,actor_hash:pseudonym(m.from.id,secret),...txt,observed_at};
 }
 const ch=update.channel_post;
 if(ch && String(ch.chat?.id)===String(channelId) && Number.isSafeInteger(ch.message_id)){
  const rich=ch.rich_message!==undefined&&ch.rich_message!==null;
  const digest_source=rich?'rich_message_json':typeof ch.text==='string'?'text':typeof ch.caption==='string'?'caption':'empty';
  const digest_input=rich?JSON.stringify(ch.rich_message):digest_source==='text'?ch.text:digest_source==='caption'?ch.caption:'';
  const reply=ch.reply_to_message;
  const reply_to_message_id=Number.isSafeInteger(reply?.message_id)&&reply.message_id>0&&
   (!reply.chat||String(reply.chat.id)===String(channelId))?reply.message_id:null;
  return {type:'channel_delivery',update_id:id,message_id:ch.message_id,date:ch.date,
   media_group_id:ch.media_group_id||null,kind:ch.photo?'photo':ch.video?'video':rich?'rich':'text',
   content_digest:createHash('sha256').update(digest_input).digest('hex').slice(0,16),
   digest_source,reply_to_message_id,observed_at};
 }
 const r=update.message_reaction_count;
 if(r && String(r.chat?.id)===String(channelId) && Number.isSafeInteger(r.message_id)){
  return {type:'reaction_count',update_id:id,message_id:r.message_id,date:r.date,
   reactions:(r.reactions||[]).slice(0,20).map(x=>({emoji:x.type?.emoji||x.type?.type||'other',count:Math.max(0,Number(x.total_count)||0)})),
   observed_at};
 }
 // A standalone Poll update contains no chat identity. Do not misattribute polls
 // from another bot context to this channel without a stored scoped association.
 return null;
}
export function aggregateAudience(events=[]){
 const filtered=Array.isArray(events)?events.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)):[];
 const comments=filtered.filter(x=>x.type==='discussion_comment');
 const votes=filtered.filter(x=>x.type==='feedback_vote');
 const feedback_votes={useful:0,more:0,less:0};
 for(const v of votes)if(Object.hasOwn(feedback_votes,v.choice))feedback_votes[v.choice]++;
 const topics={};
 for(const c of comments)for(const k of Array.isArray(c.topics)?c.topics:[])topics[k]=(topics[k]||0)+1;
 const reactions=new Map();
 for(const r of filtered.filter(x=>x.type==='reaction_count'&&Number.isSafeInteger(x.message_id))){
  const before=reactions.get(r.message_id);
  const time=x=>Number(x.date)||Date.parse(x.observed_at)||0;
  if(!before||time(r)>=time(before))reactions.set(r.message_id,r);
 }
 const questions=comments.filter(c=>c.is_question).slice(-10).map(c=>({text:c.text,topics:c.topics,post_message_id:c.post_message_id}));
 return {total_comments:comments.length,feedback_votes,topic_mentions:Object.entries(topics).sort((a,b)=>b[1]-a[1]).map(([topic,count])=>({topic,count})),questions,
   channel_delivery_events:filtered.filter(x=>x.type==='channel_delivery').length,
   latest_reaction_snapshots:reactions.size,
   reactions:[...reactions.values()].map(x=>({message_id:x.message_id,date:x.date,
    reactions:Array.isArray(x.reactions)?x.reactions:[]})),
   views_available:false,methodology:'Counts are collected only while webhook is enabled, from authorized updates; topics are heuristic, not AI; not all comments or reactions may be delivered.'};
}
export function topicIdeas(events=[]){
 const report=aggregateAudience(events);
 return report.topic_mentions.slice(0,6).map(({topic,count})=>({
  topic,reader_mentions:count,source:'читательские вопросы (эвристика)',
  recommendation:'Подготовить исследование по этому направлению, сверить первоисточники и проверить новизну темы в GitHub очереди'
 }));
}
