import { Buffer } from 'node:buffer';
import {validateToolArgs} from './tool-schema.js';
import {audienceTools} from './audience-tools.js';
import {businessTools} from './business-tools.js';

const CHANNEL = process.env.TELEGRAM_CHAT_ID || '@psy_money1';
const norm = (s) => String(s).trim().toLowerCase();
const ALLOWED = new Set([norm(CHANNEL), ...(process.env.TELEGRAM_ALLOWED_CHATS || '').split(',').map(norm).filter(Boolean)]);
const schema = (properties={},required=[]) => ({type:'object',properties,required,additionalProperties:false});
const str = {type:'string'}, int={type:'integer',minimum:1}, bool={type:'boolean'};
const arr = (items)=>({type:'array',items});
const obj = {type:'object',additionalProperties:true};
const P = (name,description,properties={},required=[],readOnly=false) => ({
  name,description,inputSchema:schema(properties,required),
  annotations:readOnly?{readOnlyHint:true}:{}
});
const methods = Object.freeze({
 read:[
 'getMe','getChat','getChatMember','getChatMemberCount','getChatAdministrators','getWebhookInfo',
 'getMyCommands','getMyName','getMyDescription','getMyShortDescription','getChatMenuButton',
 'getUserProfilePhotos','getFile','getAvailableGifts','getMyStarBalance','getStarTransactions',
 'getChatGifts','getUserChatBoosts','getUserProfileAudios','getMyDefaultAdministratorRights',
 'getForumTopicIconStickers','getStickerSet','getCustomEmojiStickers',
 'getGameHighScores'
 ],
 publish:[
 'sendMessage','sendRichMessage','sendPhoto','sendVideo','sendDocument','sendAudio','sendVoice',
 'sendAnimation','sendSticker','sendVideoNote','sendMediaGroup','sendPoll','sendLocation',
 'sendVenue','sendContact','sendDice','sendLivePhoto',
 'copyMessage','copyMessages','forwardMessage','forwardMessages','sendChatAction'
 ],
 manage:[
 'editMessageText','editMessageCaption','editMessageMedia','editMessageReplyMarkup',
 'deleteMessage','deleteMessages','pinChatMessage','unpinChatMessage','unpinAllChatMessages',
 'stopPoll','setMessageReaction','deleteMessageReaction','deleteAllMessageReactions',
 'setChatTitle','setChatDescription','deleteChatPhoto',
 'createChatInviteLink','editChatInviteLink','revokeChatInviteLink',
 'approveChatJoinRequest','declineChatJoinRequest','banChatMember','unbanChatMember',
 'restrictChatMember','promoteChatMember','setChatAdministratorCustomTitle',
 'setChatPermissions','setChatStickerSet','deleteChatStickerSet','setChatMemberTag',
 'banChatSenderChat','unbanChatSenderChat','exportChatInviteLink','editGeneralForumTopic',
 'answerCallbackQuery','removeMyProfilePhoto','sendGame','setGameScore',
 'setMyCommands','deleteMyCommands','setMyName','setMyDescription',
 'setMyShortDescription','setChatMenuButton','setMyDefaultAdministratorRights',
 'createForumTopic','editForumTopic','closeForumTopic','reopenForumTopic',
 'deleteForumTopic','unpinAllForumTopicMessages','hideGeneralForumTopic',
 'unhideGeneralForumTopic','closeGeneralForumTopic','reopenGeneralForumTopic',
 'unpinAllGeneralForumTopicMessages'
 ],
 special:[
 'getBusinessConnection','sendChecklist','setChatPhoto','setMyProfilePhoto',
 'setWebhook','deleteWebhook','getUpdates','logOut','close',
 'getUserPersonalChatMessages','getManagedBotToken','replaceManagedBotToken',
 'getManagedBotAccessSettings','setManagedBotAccessSettings','setUserEmojiStatus',
 'createChatSubscriptionInviteLink','editChatSubscriptionInviteLink',
 'answerChatJoinRequestQuery','sendChatJoinRequestWebApp','leaveChat',
 'giftPremiumSubscription','verifyUser','verifyChat','removeUserVerification','removeChatVerification',
 'readBusinessMessage','deleteBusinessMessages','getBusinessAccountStarBalance',
 'getBusinessAccountGifts','getUserGifts','repostStory','answerGuestQuery','answerWebAppQuery',
 'savePreparedInlineMessage','savePreparedKeyboardButton',
 'editMessageLiveLocation','stopMessageLiveLocation','editMessageChecklist',
 'editEphemeralMessageText','editEphemeralMessageMedia','editEphemeralMessageCaption',
 'editEphemeralMessageReplyMarkup','approveSuggestedPost','declineSuggestedPost','deleteEphemeralMessage',
 'uploadStickerFile','createNewStickerSet','addStickerToSet','setStickerPositionInSet',
 'deleteStickerFromSet','replaceStickerInSet','setStickerEmojiList','setStickerKeywords',
 'setStickerMaskPosition','setStickerSetTitle','setStickerSetThumbnail',
 'setCustomEmojiStickerSetThumbnail','deleteStickerSet','answerInlineQuery',
 'editUserStarSubscription','setPassportDataErrors',
 'sendInvoice','createInvoiceLink','sendPaidMedia','sendGift','transferBusinessAccountStars',
 'refundStarPayment',
 'transferGift','upgradeGift','convertGiftToStars','sendMessageDraft',
 'sendRichMessageDraft','setBusinessAccountName','setBusinessAccountBio',
 'setBusinessAccountUsername','setBusinessAccountProfilePhoto','removeBusinessAccountProfilePhoto',
 'setBusinessAccountGiftSettings','postStory',
 'editStory','deleteStory','answerPreCheckoutQuery','answerShippingQuery'
 ]
});
const risky = new Set([
 'deleteMessage','deleteMessages','unpinAllChatMessages','banChatMember','restrictChatMember',
 'promoteChatMember','setChatPermissions','setChatTitle','setChatDescription','setChatPhoto','deleteChatPhoto',
 'revokeChatInviteLink','deleteForumTopic','deleteChatStickerSet','stopPoll',
 'setMyCommands','deleteMyCommands','setMyDefaultAdministratorRights','deleteAllMessageReactions',
 'exportChatInviteLink','banChatSenderChat','unbanChatSenderChat','setChatMemberTag',
 'setMyProfilePhoto','removeMyProfilePhoto'
 ,'unbanChatMember','deleteMessageReaction','setMyName','setMyDescription','setMyShortDescription',
 'setChatMenuButton','setChatAdministratorCustomTitle','editGeneralForumTopic','editForumTopic',
 'closeForumTopic','reopenForumTopic','unpinAllForumTopicMessages','hideGeneralForumTopic',
 'unhideGeneralForumTopic','closeGeneralForumTopic','reopenGeneralForumTopic','unpinAllGeneralForumTopicMessages'
]);
const permits = new Map(Object.entries(methods).flatMap(([group,names])=>names.map(m=>[m,group])));
const clamp = (value,min,max)=>Math.max(min,Math.min(max,value));
function messageLink(id,chat=CHANNEL){
 if(typeof chat==='string'&&/^@[A-Za-z0-9_]+$/.test(chat))return 'https://t.me/'+chat.slice(1)+'/'+id;
 const n=String(chat);return /^-100\d+$/.test(n)?'https://t.me/c/'+n.slice(4)+'/'+id:null;
}
function enforceChat(params, method){
  const p=normalizeStructured({...params});
  for (const field of ['inline_message_id','business_connection_id','receiver_user_id','ephemeral_message_parameters'])
    if(Object.hasOwn(p,field))throw Error(field==='business_connection_id'?'business_connection_requires_dedicated_tool':'unscoped_target_not_allowed: '+field);
  const chatFields=['chat_id','from_chat_id'];
  for (const field of chatFields) {
    if (p[field]===undefined || p[field]===null || p[field]==='') {
      if (field==='chat_id' && requiresChannel(method)) p[field]=CHANNEL;
      continue;
    }
    requireAllowedChat(p[field],field);
  }
  if(/^(copy|forward)Messages?$/.test(method)&&p.from_chat_id===undefined)throw Error('from_chat_id_required');
  for(const field of ['sender_chat_id','actor_chat_id'])if(p[field]!==undefined&&(!Number.isSafeInteger(p[field])||p[field]===0))throw Error('invalid_'+field);
  inspectNestedTargets(p);
  delete p.allow_paid_broadcast;
  return p;
}
function requireAllowedChat(value,field){
 if(!['string','number'].includes(typeof value)||typeof value==='number'&&!Number.isSafeInteger(value)||!ALLOWED.has(norm(value)))
  throw Error('chat_not_allowed: '+field+' must match configured channel or TELEGRAM_ALLOWED_CHATS');
}
const structuredFields=new Set(['scope','reply_parameters','reply_markup','rich_message','media','options','reaction',
 'entities','caption_entities','permissions','rights','menu_button','commands','checklist','photo']);
function normalizeStructured(p){
 for(const [key,value] of Object.entries(p)){
  if(structuredFields.has(key)&&typeof value==='string'&&/^[\s]*[\[{]/.test(value)){
   try{p[key]=JSON.parse(value);}catch{throw Error('invalid_structured_parameter: '+key);}
  }
 }
 return p;
}
function inspectNestedTargets(value,depth=0){
 if(depth>20)throw Error('params_too_deep');
 if(!value||typeof value!=='object')return;
 for(const [key,item] of Object.entries(value)){
  if(['__proto__','prototype','constructor'].includes(key))throw Error('unsafe_parameter_key');
  if(['chat_id','from_chat_id'].includes(key)&&item!==undefined&&item!==null&&item!=='')requireAllowedChat(item,key);
  if(['inline_message_id','business_connection_id','receiver_user_id','ephemeral_message_parameters'].includes(key))
   throw Error('unscoped_target_not_allowed: '+key);
  inspectNestedTargets(item,depth+1);
 }
}
function requiresChannel(method){
  const botWide=new Set(['answerCallbackQuery','setMyCommands','deleteMyCommands','setMyName','setMyDescription',
   'setMyShortDescription','setChatMenuButton','setMyDefaultAdministratorRights','removeMyProfilePhoto']);
  return methods.publish.includes(method)||(methods.manage.includes(method)&&!botWide.has(method))||
   ['getChat','getChatMember','getChatAdministrators','getChatMemberCount','getChatGifts','getUserChatBoosts','getGameHighScores'].includes(method);
}
function validateMethod(method,params,confirm){
  const group=permits.get(method);
  if (!group) throw Error('unsupported_method: '+method);
  if(group==='special') throw Error('method_disabled_for_safety: '+method+' (requires a separately reviewed integration)');
  if(group==='manage' && risky.has(method) && confirm!==true) throw Error('explicit_confirmation_required: '+method);
  if(!params || typeof params!=='object'||Array.isArray(params)) throw Error('invalid_params: object required');
  if(JSON.stringify(params).length>64000) throw Error('params_too_large');
  const p=enforceChat(params,method);
  validateCommon(method,p);
  return p;
}
function positive(value,label){if(!Number.isSafeInteger(value)||value<1)throw Error('invalid_'+label);return value;}
function textValue(value,label,max,min=0){if(typeof value!=='string'||value.length<min||value.length>max)throw Error('invalid_'+label);return value;}
function validateCommon(method,p){
 for(const key of ['message_id','user_id','reply_to_message_id','message_thread_id'])
  if(p[key]!==undefined)positive(p[key],key);
 if(p.message_ids!==undefined){
  if(!Array.isArray(p.message_ids)||p.message_ids.length<1||p.message_ids.length>100||p.message_ids.some(x=>!Number.isSafeInteger(x)||x<1))throw Error('invalid_message_ids');
 }
 if(p.caption!==undefined)textValue(p.caption,'caption',1024);
 if(['getFile'].includes(method))textValue(p.file_id,'file_id',4096,1);
 if(['getChatMember','getUserChatBoosts','getUserProfilePhotos','getUserProfileAudios','getGameHighScores','setGameScore'].includes(method))positive(p.user_id,'user_id');
 if(['getUserProfilePhotos','getUserProfileAudios','getStarTransactions'].includes(method)&&p.limit!==undefined&&(!Number.isInteger(p.limit)||p.limit<1||p.limit>100))throw Error('invalid_limit');
 if(method==='sendMessage')textValue(p.text,'text',4096,1);
 if(method==='setChatDescription')textValue(p.description??'','description',255);
 if(method==='setChatTitle')textValue(p.title,'title',128,1);
 if(method==='sendRichMessage'){
  if(!p.rich_message||typeof p.rich_message!=='object'||Array.isArray(p.rich_message))throw Error('invalid_rich_message');
  const kinds=['html','markdown','blocks'].filter(k=>p.rich_message[k]!==undefined);
  if(kinds.length!==1)throw Error('one_rich_content_field_required');
  if(kinds[0]==='blocks')validateBlocks(p.rich_message.blocks);
  else validateRich(p.rich_message[kinds[0]],kinds[0]);
 }
 if(method==='sendPoll')validatePoll(p);
 if(method==='setMessageReaction'&&p.reaction!==undefined&&(!Array.isArray(p.reaction)||p.reaction.length>1||p.reaction.some(x=>!x||!['emoji','custom_emoji'].includes(x.type))))throw Error('invalid_reaction');
}
function validateBlocks(blocks){
 if(!Array.isArray(blocks)||blocks.length<1||blocks.length>500||blocks.some(x=>!x||typeof x!=='object'||Array.isArray(x)||typeof x.type!=='string'||!x.type))throw Error('invalid_rich_blocks');
}
function validatePoll(p){
 textValue(p.question,'poll_question',300,1);
 if(!Array.isArray(p.options)||p.options.length<1||p.options.length>12||p.options.some(x=>!x||typeof x!=='object'||typeof x.text!=='string'||!x.text||x.text.length>100))throw Error('invalid_poll_options');
 if(p.correct_option_id!==undefined){
  if(p.correct_option_ids!==undefined)throw Error('conflicting_quiz_answers');
  p.correct_option_ids=[p.correct_option_id];delete p.correct_option_id;
 }
 if(p.type==='quiz'){
  const answers=p.correct_option_ids;
  if(!Array.isArray(answers)||!answers.length||answers.some((x,i)=>!Number.isInteger(x)||x<0||x>=p.options.length||i>0&&x<=answers[i-1]))throw Error('correct_option_ids_required_for_quiz');
  if(answers.length>1&&p.allows_multiple_answers!==true)throw Error('multiple_quiz_answers_require_multiple_answers');
 }else if(p.correct_option_ids!==undefined||p.explanation!==undefined)throw Error('quiz_fields_require_quiz');
 if(p.explanation!==undefined&&(typeof p.explanation!=='string'||p.explanation.length>200||(p.explanation.match(/\n/g)||[]).length>2))throw Error('invalid_poll_explanation');
 if(p.open_period!==undefined&&(!Number.isInteger(p.open_period)||p.open_period<5||p.open_period>2628000))throw Error('invalid_poll_open_period');
 if(p.open_period!==undefined&&p.close_date!==undefined)throw Error('poll_time_fields_conflict');
}
async function tg(method,params={},confirmed=false,clientFetch=fetch){
  const p=validateMethod(method,params,confirmed);
  const token=process.env.TELEGRAM_BOT_TOKEN;
  if(!token) throw Error('bot_token_not_configured');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),18000);
  try{
    const resp=await clientFetch('https://api.telegram.org/bot'+token+'/'+method,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p),signal:controller.signal
    });
    let j;
    try{j=await resp.json();}catch{throw Object.assign(Error('telegram_response_invalid'),{category:'transport_unknown'});}
    if(!j||typeof j!=='object'||Array.isArray(j)||typeof j.ok!=='boolean')throw Object.assign(Error('telegram_response_invalid'),{category:'transport_unknown'});
    if(resp.ok===false||j.ok!==true) {
      const code=Number(j.error_code)||resp.status;
      throw Object.assign(Error('telegram_api_error '+code),{category:j.ok===false&&code>=400&&code<500&&resp.status<500?'api_rejected':'transport_unknown',
       api_code:code,retry_after:Number.isSafeInteger(j.parameters?.retry_after)?j.parameters.retry_after:undefined});
    }
    if(j.result===undefined||j.result===null)throw Object.assign(Error('telegram_result_missing'),{category:'transport_unknown'});
    const booleanMethods=new Set(['deleteMessage','deleteMessages','pinChatMessage','unpinChatMessage','unpinAllChatMessages',
     'setChatDescription','setChatTitle','setMessageReaction','deleteMessageReaction','deleteAllMessageReactions']);
    if(booleanMethods.has(method)&&j.result!==true)
     throw Object.assign(Error('telegram_boolean_confirmation_missing'),{category:'transport_unknown'});
    const messageMethods=new Set(['sendMessage','sendRichMessage','sendPhoto','sendVideo','sendDocument','sendAudio','sendVoice',
     'sendAnimation','sendSticker','sendVideoNote','sendPoll','sendLocation','sendVenue','sendContact','sendDice','sendLivePhoto','sendGame','copyMessage','forwardMessage']);
    const confirmedMessage=x=>Number.isSafeInteger(x?.message_id)&&x.message_id>0;
    if(messageMethods.has(method)&&!confirmedMessage(j.result)||
      ['sendMediaGroup','copyMessages','forwardMessages'].includes(method)&&(!Array.isArray(j.result)||!j.result.length||!j.result.every(confirmedMessage)))
     throw Object.assign(Error('telegram_message_confirmation_missing'),{category:'transport_unknown'});
    return j.result;
  }catch(error){
    if(error.category)throw error;
    throw Object.assign(Error(controller.signal.aborted?'telegram_timeout_unknown':'telegram_transport_unknown'),{category:'transport_unknown'});
  }finally{clearTimeout(timer);}
}
const toolList=[
 P('get_capabilities','Read-only: inspect channel-only generic methods and separately permissioned opt-in Telegram Business MCP tools.',{},[],true),
 P('validate_rich_message','Read-only: preflight Telegram rich Markdown/HTML without sending anything.',
   {content:str,format:{type:'string',enum:['markdown','html']},caption:str},['content','format'],true),
 P('get_channel_overview','Read-only: get bot identity, channel details, member count and own administrator rights.',{},[],true),
 P('get_chat_info','Read-only: get details of the configured channel.',{},[],true),
 P('get_member_count','Read-only: channel subscriber count according to getChatMemberCount (not post views).',{},[],true),
 P('get_chat_admins','Read-only: administrator rights of the configured channel.',{},[],true),
 P('get_chat_member_info','Read-only: membership information for a user in the configured channel.',{user_id:int},['user_id'],true),
 P('get_webhook_status','Read-only: active Telegram webhook diagnostic information.',{},[],true),
 P('get_bot_profile','Read-only: bot profile, commands, description and short description.',{},[],true),
 P('get_bot_stars','Read-only: bot Stars balance and recent transactions.',{limit:{type:'integer',minimum:1,maximum:100}},[],true),
 P('get_telegram_message_link','Read-only: construct public canonical link, not a proof that message exists.',{message_id:int},['message_id'],true),
 P('send_rich_message','Publish advanced Telegram Rich Message via sendRichMessage using Markdown, HTML, or supplied block structure. Immediately sends.',{
   content:str,format:{type:'string',enum:['markdown','html']},blocks:arr(obj),reply_to_message_id:int,
   buttons:arr(arr(obj)),silent:bool,protect_content:bool
 },[]),
 P('send_media','Immediately publish HTTPS media. URL stickers must be static WEBP; document URL and voice format limitations follow Telegram.',{
   type:{type:'string',enum:['photo','video','document','audio','animation','voice','sticker']},
   url:str,caption:str,caption_format:{type:'string',enum:['plain','HTML']},silent:bool,protect_content:bool
 },['type','url']),
 P('send_album','Immediately publish a 2–10 media album (photos/videos) in the configured channel.',{
   media:arr(schema({type:{type:'string',enum:['photo','video']},url:str,caption:str},['type','url'])),
   silent:bool,protect_content:bool
 },['media']),
 P('send_poll','Immediately publish a native Telegram poll or quiz.',{
   question:str,options:arr(str),quiz:bool,correct_option_id:{type:'integer',minimum:0},correct_option_ids:arr({type:'integer',minimum:0}),
   explanation:str,anonymous:bool,multiple_answers:bool,open_period:{type:'integer',minimum:5,maximum:2628000}
 },['question','options']),
 P('send_buttons','Immediately publish text with an inline URL/callback keyboard.',{
   text:str,rows:arr(arr(schema({text:str,url:str,callback_data:str},['text']))),
   format:{type:'string',enum:['plain','HTML']},silent:bool
 },['text','rows']),
 P('edit_caption','Edit caption of an existing bot message in channel.',{message_id:int,caption:str,format:{type:'string',enum:['plain','HTML']}},['message_id','caption']),
 P('edit_buttons','Edit inline keyboard for an existing bot message.',{message_id:int,rows:arr(arr(obj))},['message_id','rows']),
 P('set_reaction','Add or remove one standard emoji reaction to a channel message.',{message_id:int,emoji:str},['message_id']),
 P('pin_message','Pin an existing channel message.',{message_id:int,silent:bool},['message_id']),
 P('unpin_message','Unpin an existing channel message.',{message_id:int},['message_id']),
 P('copy_channel_message','Copy an earlier message within the configured channel.',{message_id:int,caption:str},['message_id']),
 P('delete_channel_message','Permanently delete an existing channel message; requires confirm=true.',{message_id:int,confirm:bool},['message_id','confirm']),
 P('set_channel_description','Change the channel description; requires confirm=true.',{description:str,confirm:bool},['description','confirm']),
 P('create_invite_link','Create an extra invite link for channel; no mass invitations.',{name:str,expire_date:int,member_limit:{type:'integer',minimum:1,maximum:99999}},[]),
 P('revoke_invite_link','Revoke a channel invite link; requires confirm=true.',{invite_link:str,confirm:bool},['invite_link','confirm']),
 P('get_file_metadata','Read Telegram file metadata. Does not reveal bot token or construct token-bearing download URL.',{file_id:str},['file_id'],true),
 P('bot_api_call','Advanced safe allowlisted Telegram Bot API operation. Consult get_capabilities first; method is scoped to configured chats; destructive management requires confirm_dangerous=true. Does not support payments, login/logout or webhook mutation.',{
   method:str,params:obj,confirm_dangerous:bool
 },['method'])
];
function checkUrl(u){
 if(typeof u!=='string'||u.length>2000||/\s/.test(u))throw Error('public_https_media_url_required');
 let url;try{url=new URL(u);}catch{throw Error('public_https_media_url_required');}
 if(url.protocol!=='https:'||url.username||url.password||!url.hostname||['localhost','127.0.0.1','[::1]'].includes(url.hostname.toLowerCase()))throw Error('public_https_media_url_required');
 return u;
}
function validateRich(content,format,caption){
 if(!['html','markdown'].includes(format))throw Error('invalid_rich_format');
 if(typeof content!=='string'||!content.trim())throw Error('content_required');
 const bytes=Buffer.byteLength(content,'utf8');
 if(bytes>32768)throw Error('rich_content_limit: '+bytes+' UTF-8 bytes');
 const blocks=content.split(/\n/).filter(x=>/^\s*(?:#{1,6}\s|[>|*+-]\s|\d+\.\s|\|)/.test(x)).length;
 if(blocks>500)throw Error('possible_rich_block_limit');
 if(caption!==undefined && (typeof caption!=='string'||caption.length>1024))throw Error('photo_caption_limit');
 return {valid:true,format,utf8_bytes:bytes,estimated_structural_lines:blocks,caption_characters:caption?.length||0,warnings:['Static inspection only: Telegram rendering and media cannot be verified before publication.']};
}
function replyParams(args){
 return args.reply_to_message_id?{reply_parameters:{message_id:args.reply_to_message_id,allow_sending_without_reply:false}}:{};
}
function mkButtons(rows){
 if(!Array.isArray(rows)||rows.length>8)throw Error('keyboard_rows_1_to_8');
 return {inline_keyboard:rows.map(row=>{
  if(!Array.isArray(row)||!row.length||row.length>8)throw Error('keyboard_row_limit');
  return row.map(b=>{
   if(!b||typeof b.text!=='string'||b.text.length>64||!b.text)throw Error('button_text_invalid');
   const item={text:b.text};
   if(b.url!==undefined&&b.callback_data!==undefined)throw Error('one_button_target_required');
   if(b.url!==undefined){if(typeof b.url!=='string'||!/^(?:https:\/\/|tg:\/\/)[^\s]+$/.test(b.url))throw Error('button_url_must_be_https_or_tg');item.url=b.url;}
   else if(b.callback_data!==undefined){if(typeof b.callback_data!=='string'||!b.callback_data||Buffer.byteLength(b.callback_data,'utf8')>64)throw Error('callback_data_limit');item.callback_data=b.callback_data;}
   else throw Error('button_target_missing');
   return item;
  });
 })};
}
function summaryResult(method,result,chat=CHANNEL){
 const target=result?.chat?.username?'@'+result.chat.username:result?.chat?.id??chat;
 const out={method,channel:target,result};
 if(result && typeof result==='object' && result.message_id)out.message_link=messageLink(result.message_id,target);
 if(Array.isArray(result))out.message_links=result.map(m=>m.message_id?messageLink(m.message_id,m.chat?.username?'@'+m.chat.username:m.chat?.id??chat):null).filter(Boolean);
 return out;
}
export async function executeTool(name,args={},clientFetch=fetch){
 const definition=toolList.find(x=>x.name===name);
 if(!definition)throw Error('unknown_extension_tool: '+name);
 validateToolArgs(definition,args);
 const api=(method,params,confirmed)=>tg(method,params,confirmed,clientFetch);
 switch(name){
  case 'get_capabilities':return {version:'2.5.1',channel:CHANNEL,methods,
    method_policy:{read: 'Bot/profile reads and configured-chat reads only; no arbitrary histories',publish:'Configured-chat mutations',
     manage:'Configured-chat or bot-setting mutations; confirmation required for high-impact management',special:'Disabled generic methods; Business operations use guarded dedicated tools',
     disabled_reason:{getBusinessConnection:'Use owner-checked business_connection_info',sendChecklist:'Business-only method is not available in the channel gateway',
      setChatPhoto:'Requires a separately implemented multipart file upload',setMyProfilePhoto:'Requires a separately implemented multipart file upload'}},
    daily_publication:{tool:'publish_cover_then_article',implementation:'local_durable_v1',
     requires_canonical_github_claim:true,create_only_day_lock:true,stage_receipts:true,
     immutable_source_revision:true,retries_send_no_new_messages:true,
     journal_tool:'get_publication_journal',not_an_exact_time_scheduler:true},
    typed_tools:[...toolList.map(t=>t.name),...audienceTools.map(t=>t.name),...businessTools.map(t=>t.name)],
    business:{
     available:true,requires_explicit_activation:true,
     owner_allowlist_configured:!!String(process.env.TELEGRAM_BUSINESS_OWNER_IDS||'').trim(),
     text_storage_enabled:process.env.TELEGRAM_BUSINESS_STORE_TEXT==='true',
     webhook_commands:['enable_business_updates','disable_business_updates'],
     note:'Dedicated business_* tools require explicit Telegram Business connection, live rights, owner allowlist and observed private chats. Generic Bot API methods remain channel-only; cached ChatGPT app clients may use the strictly named compatibility commands below.',
     cached_chatgpt_tool_compatibility:{
      tool:'bot_api_call',
      read_example:{method:'business_connections',params:{}},
      chat_example:{method:'business_chats',params:{business_connection_id:'<verified connection ID>'}},
      write_example:{method:'business_send_message',
       params:{business_connection_id:'<verified connection ID>',chat_id:123456789,text:'Example only',confirm:true},
       confirm_dangerous:true},
      note:'Named compatibility commands are routed through the same guarded Business MCP handlers. Writes require both params.confirm=true and confirm_dangerous=true. No arbitrary Telegram API Business bypass is enabled.'
     }
    },
    rules:['Channel-scoped generic Bot API method allowlist and separate opt-in Business tools',
      'No unrestricted Telegram user session or access to arbitrary chat histories; public user profile lookups require a supplied user ID',
      'No native post-view analytics through Bot API',
      'Mutations require telegram:write OAuth scope; destructive and Business actions require explicit confirmation, but send_* publication tools execute immediately',
      'Payments, generic webhook mutation, getUpdates and logout disabled',
      'Business read/mark/delete/profile operations have additional live rights checks']};
  case 'validate_rich_message':return validateRich(args.content,args.format,args.caption);
  case 'get_channel_overview':{
   const me=await api('getMe');
   const [chat,count,own]=await Promise.allSettled([
    api('getChat',{chat_id:CHANNEL}),api('getChatMemberCount',{chat_id:CHANNEL}),api('getChatMember',{chat_id:CHANNEL,user_id:me.id})
   ]);
   return {bot:{id:me.id,username:me.username},channel:CHANNEL,
     chat:chat.status==='fulfilled'?chat.value:{error:String(chat.reason)},
     member_count:count.status==='fulfilled'?count.value:null,
     bot_membership:own.status==='fulfilled'?own.value:{error:String(own.reason)},
     partial:[chat,count,own].some(x=>x.status==='rejected'),
     note:'Member count is not a measure of views, reach or conversion.'};
  }
  case 'get_chat_info':return await api('getChat',{chat_id:CHANNEL});
  case 'get_member_count':return {channel:CHANNEL,member_count:await api('getChatMemberCount',{chat_id:CHANNEL})};
  case 'get_chat_admins':return await api('getChatAdministrators',{chat_id:CHANNEL});
  case 'get_chat_member_info':return await api('getChatMember',{chat_id:CHANNEL,user_id:args.user_id});
  case 'get_webhook_status':return await api('getWebhookInfo');
  case 'get_bot_profile':{
   const [me,commands,description,shortDescription]=await Promise.allSettled([
     api('getMe'),api('getMyCommands'),api('getMyDescription'),api('getMyShortDescription')
   ]);
   return {bot:me.status==='fulfilled'?me.value:null,
     commands:commands.status==='fulfilled'?commands.value:null,
     description:description.status==='fulfilled'?description.value:null,
     short_description:shortDescription.status==='fulfilled'?shortDescription.value:null,
     partial:[me,commands,description,shortDescription].some(x=>x.status==='rejected'),
     errors:Object.fromEntries([['bot',me],['commands',commands],['description',description],['short_description',shortDescription]]
      .filter(([,r])=>r.status==='rejected').map(([key,r])=>[key,String(r.reason?.message||'telegram_read_failed')]))};
  }
  case 'get_bot_stars':{
   const [balance,transactions]=await Promise.allSettled([
    api('getMyStarBalance'),api('getStarTransactions',{limit:clamp(args.limit||20,1,100)})
   ]);
   return {balance:balance.status==='fulfilled'?balance.value:{unavailable:String(balance.reason)},
   transactions:transactions.status==='fulfilled'?transactions.value:{unavailable:String(transactions.reason)}};
  }
  case 'get_telegram_message_link':{
   if(!Number.isSafeInteger(args.message_id)||args.message_id<1)throw Error('invalid_message_id');
   return {url:messageLink(args.message_id),verified_exists:false};
  }
  case 'send_rich_message':{
   if(args.blocks!==undefined && args.content!==undefined)throw Error('use either blocks or content, not both');
   let rich;
   if(args.blocks!==undefined){
    validateBlocks(args.blocks);
    rich={blocks:args.blocks};
   }else{
    validateRich(args.content,args.format||'markdown');
    rich={[args.format||'markdown']:args.content};
   }
   const p={chat_id:CHANNEL,rich_message:rich,...replyParams(args),
     disable_notification:!!args.silent,protect_content:!!args.protect_content};
   if(args.buttons)p.reply_markup=mkButtons(args.buttons);
   return summaryResult('sendRichMessage',await api('sendRichMessage',p));
  }
  case 'send_media':{
   const map={photo:'sendPhoto',video:'sendVideo',document:'sendDocument',audio:'sendAudio',
     animation:'sendAnimation',voice:'sendVoice',sticker:'sendSticker'};
   if(!map[args.type])throw Error('invalid_media_type');
   const u=checkUrl(args.url);
   if(args.type==='sticker'&&/\.(?:tgs|webm)(?:[?#]|$)/i.test(u))throw Error('url_sticker_must_be_static_webp');
   const p={chat_id:CHANNEL,[args.type]:u,disable_notification:!!args.silent,protect_content:!!args.protect_content};
   if(args.caption!==undefined){
    if(args.type==='sticker')throw Error('stickers_cannot_have_caption');
    if(args.caption.length>1024)throw Error('caption_limit');
    p.caption=args.caption;
    if(args.caption_format==='HTML')p.parse_mode='HTML';
   }
   return summaryResult(map[args.type],await api(map[args.type],p));
  }
  case 'send_album':{
   if(!Array.isArray(args.media)||args.media.length<2||args.media.length>10)throw Error('album_requires_2_to_10');
   const media=args.media.map(m=>{
    if(!['photo','video'].includes(m.type))throw Error('album_type_only_photo_or_video');
    const item={type:m.type,media:checkUrl(m.url)};
    if(m.caption){if(m.caption.length>1024)throw Error('caption_limit');item.caption=m.caption;}
    return item;
   });
   return summaryResult('sendMediaGroup',await api('sendMediaGroup',{
    chat_id:CHANNEL,media,disable_notification:!!args.silent,protect_content:!!args.protect_content
   }));
  }
  case 'send_poll':{
   if(typeof args.question!=='string'||args.question.length<1||args.question.length>300)throw Error('invalid_poll_question');
   if(!Array.isArray(args.options)||args.options.length<1||args.options.length>12
    ||args.options.some(s=>typeof s!=='string'||!s||s.length>100))throw Error('invalid_poll_options');
   const options=args.options.map(text=>({text}));
   const p={chat_id:CHANNEL,question:args.question,options,
     type:args.quiz?'quiz':'regular',is_anonymous:args.anonymous!==false,
     allows_multiple_answers:!!args.multiple_answers};
   if(args.quiz){
    if(args.correct_option_id!==undefined&&args.correct_option_ids!==undefined)throw Error('conflicting_quiz_answers');
    p.correct_option_ids=args.correct_option_ids??(args.correct_option_id!==undefined?[args.correct_option_id]:undefined);
    if(args.explanation!==undefined)p.explanation=args.explanation;
   }else if(args.correct_option_id!==undefined||args.correct_option_ids!==undefined||args.explanation!==undefined){
    throw Error('quiz_fields_require_quiz');
   }
   if(args.open_period)p.open_period=args.open_period;
   return summaryResult('sendPoll',await api('sendPoll',p));
  }
  case 'send_buttons':{
   if(typeof args.text!=='string'||args.text.length<1||args.text.length>4096)throw Error('text_length_1_to_4096');
   const p={chat_id:CHANNEL,text:args.text,reply_markup:mkButtons(args.rows),
     disable_notification:!!args.silent};
   if(args.format==='HTML')p.parse_mode='HTML';
   return summaryResult('sendMessage',await api('sendMessage',p));
  }
  case 'edit_caption':{
   if(args.caption.length>1024)throw Error('caption_limit');
   const p={chat_id:CHANNEL,message_id:args.message_id,caption:args.caption};
   if(args.format==='HTML')p.parse_mode='HTML';
   return summaryResult('editMessageCaption',await api('editMessageCaption',p));
  }
  case 'edit_buttons':return summaryResult('editMessageReplyMarkup',await api('editMessageReplyMarkup',{
   chat_id:CHANNEL,message_id:args.message_id,reply_markup:mkButtons(args.rows)
  }));
  case 'set_reaction':{
   if(args.emoji && args.emoji.length>12)throw Error('invalid_emoji');
   return summaryResult('setMessageReaction',await api('setMessageReaction',{
    chat_id:CHANNEL,message_id:args.message_id,
    reaction:args.emoji?[{type:'emoji',emoji:args.emoji}]:[]
   }));
  }
  case 'pin_message':return summaryResult('pinChatMessage',await api('pinChatMessage',{
   chat_id:CHANNEL,message_id:args.message_id,disable_notification:!!args.silent
  }));
  case 'unpin_message':return summaryResult('unpinChatMessage',await api('unpinChatMessage',{
   chat_id:CHANNEL,message_id:args.message_id
  }));
  case 'copy_channel_message':{
   const p={chat_id:CHANNEL,from_chat_id:CHANNEL,message_id:args.message_id};
   if(args.caption!==undefined)p.caption=args.caption;
   return summaryResult('copyMessage',await api('copyMessage',p));
  }
  case 'delete_channel_message':return summaryResult('deleteMessage',await api('deleteMessage',{
   chat_id:CHANNEL,message_id:args.message_id
  },args.confirm));
  case 'set_channel_description':return summaryResult('setChatDescription',await api('setChatDescription',{
   chat_id:CHANNEL,description:args.description
  },args.confirm));
  case 'create_invite_link':return await api('createChatInviteLink',{
   chat_id:CHANNEL,...(args.name?{name:textValue(args.name,'invite_name',32)}:{}),
   ...(args.expire_date?{expire_date:args.expire_date}:{}),
   ...(args.member_limit?{member_limit:args.member_limit}:{})
  });
  case 'revoke_invite_link':return await api('revokeChatInviteLink',{
   chat_id:CHANNEL,invite_link:args.invite_link
  },args.confirm);
  case 'get_file_metadata':{
   const x=await api('getFile',{file_id:args.file_id});
   if(typeof x?.file_id!=='string'||!x.file_id)throw Error('telegram_file_confirmation_missing');
   return {file_id:x.file_id,file_unique_id:x.file_unique_id,file_size:x.file_size,
    file_path:x.file_path,download_url_not_exposed:true};
  }
  case 'bot_api_call':{
   if(typeof args.method!=='string')throw Error('method_required');
   return summaryResult(args.method,await api(args.method,args.params||{},args.confirm_dangerous),args.params?.chat_id??CHANNEL);
  }
  default:throw Error('unknown_extension_tool: '+name);
 }
}
export const extensions=toolList;
export function isExtension(name){return toolList.some(x=>x.name===name);}
export const security={CHANNEL,ALLOWED,methods,validateRich,validateMethod,
 isReadOnlyGenericCall:args=>!!args&&typeof args.method==='string'&&methods.read.includes(args.method)};
