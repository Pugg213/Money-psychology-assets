import { Buffer } from 'node:buffer';
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
 'getGameHighScores','getBusinessConnection'
 ],
 publish:[
 'sendMessage','sendRichMessage','sendPhoto','sendVideo','sendDocument','sendAudio','sendVoice',
 'sendAnimation','sendSticker','sendVideoNote','sendMediaGroup','sendPoll','sendLocation',
 'sendVenue','sendContact','sendDice','sendChecklist','sendLivePhoto',
 'copyMessage','copyMessages','forwardMessage','forwardMessages','sendChatAction'
 ],
 manage:[
 'editMessageText','editMessageCaption','editMessageMedia','editMessageReplyMarkup',
 'deleteMessage','deleteMessages','pinChatMessage','unpinChatMessage','unpinAllChatMessages',
 'stopPoll','setMessageReaction','deleteMessageReaction','deleteAllMessageReactions',
 'setChatTitle','setChatDescription','setChatPhoto','deleteChatPhoto',
 'createChatInviteLink','editChatInviteLink','revokeChatInviteLink',
 'approveChatJoinRequest','declineChatJoinRequest','banChatMember','unbanChatMember',
 'restrictChatMember','promoteChatMember','setChatAdministratorCustomTitle',
 'setChatPermissions','setChatStickerSet','deleteChatStickerSet','setChatMemberTag',
 'banChatSenderChat','unbanChatSenderChat','exportChatInviteLink','editGeneralForumTopic',
 'answerCallbackQuery','setMyProfilePhoto','removeMyProfilePhoto','sendGame','setGameScore',
 'setMyCommands','deleteMyCommands','setMyName','setMyDescription',
 'setMyShortDescription','setChatMenuButton','setMyDefaultAdministratorRights',
 'createForumTopic','editForumTopic','closeForumTopic','reopenForumTopic',
 'deleteForumTopic','unpinAllForumTopicMessages','hideGeneralForumTopic',
 'unhideGeneralForumTopic','closeGeneralForumTopic','reopenGeneralForumTopic',
 'unpinAllGeneralForumTopicMessages'
 ],
 special:[
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
]);
const permits = new Map(Object.entries(methods).flatMap(([group,names])=>names.map(m=>[m,group])));
const clamp = (value,min,max)=>Math.max(min,Math.min(max,value));
const messageLink = (id)=> 'https://t.me/'+CHANNEL.replace(/^@/,'')+'/'+id;
function enforceChat(params, method){
  const p={...params};
  const chatFields=['chat_id','from_chat_id','sender_chat_id'];
  for (const field of chatFields) {
    if (p[field]===undefined || p[field]===null || p[field]==='') {
      if (field==='chat_id' && requiresChannel(method)) p[field]=CHANNEL;
      continue;
    }
    if(!ALLOWED.has(norm(p[field]))) throw Error('chat_not_allowed: '+field+' must match configured channel or TELEGRAM_ALLOWED_CHATS');
  }
  delete p.business_connection_id;
  delete p.allow_paid_broadcast;
  return p;
}
function requiresChannel(method){
  return /^(getChat|getChatMember|getChatAdministrators|getChatMemberCount|send|editMessage|deleteMessage|deleteMessages|pinChat|unpin|stopPoll|setMessageReaction|deleteMessageReaction|deleteAllMessageReactions|setChat|createChatInviteLink|editChatInviteLink|revokeChatInviteLink|approveChatJoinRequest|declineChatJoinRequest|banChatMember|unbanChatMember|restrictChatMember|promoteChatMember|copyMessage|forwardMessage)/.test(method);
}
function validateMethod(method,params,confirm){
  const group=permits.get(method);
  if (!group) throw Error('unsupported_method: '+method);
  if(group==='special') throw Error('method_disabled_for_safety: '+method+' (requires a separately reviewed integration)');
  if(group==='manage' && risky.has(method) && confirm!==true) throw Error('explicit_confirmation_required: '+method);
  if(!params || typeof params!=='object'||Array.isArray(params)) throw Error('invalid_params: object required');
  if(JSON.stringify(params).length>64000) throw Error('params_too_large');
  const p=enforceChat(params,method);
  if(method==='getFile' && !p.file_id)throw Error('file_id required');
  return p;
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
    const j=await resp.json();
    if(!j.ok) {
      const code=Number(j.error_code)||resp.status;
      throw Error('telegram_api_error '+code+': '+String(j.description||'unknown').slice(0,500));
    }
    return j.result;
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
 P('send_media','Immediately publish a public HTTPS photo/video/document/audio/animation/voice/sticker.',{
   type:{type:'string',enum:['photo','video','document','audio','animation','voice','sticker']},
   url:str,caption:str,caption_format:{type:'string',enum:['plain','HTML']},silent:bool,protect_content:bool
 },['type','url']),
 P('send_album','Immediately publish a 2–10 media album (photos/videos) in the configured channel.',{
   media:arr(schema({type:{type:'string',enum:['photo','video']},url:str,caption:str},['type','url'])),
   silent:bool,protect_content:bool
 },['media']),
 P('send_poll','Immediately publish a native Telegram poll or quiz.',{
   question:str,options:arr(str),quiz:bool,correct_option_id:{type:'integer',minimum:0},
   explanation:str,anonymous:bool,multiple_answers:bool,open_period:{type:'integer',minimum:5,maximum:600}
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
function formatCaption(s){return typeof s==='string'?s:'';}
function checkUrl(u){if(typeof u!=='string'||!/^https:\/\/[^/?#\s]+(?:[/?#][^\s]*)?$/i.test(u)||u.length>2000)throw Error('public_https_media_url_required');return u;}
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
 return args.reply_to_message_id?{reply_parameters:{message_id:args.reply_to_message_id}}:{};
}
function mkButtons(rows){
 if(!Array.isArray(rows)||rows.length>8)throw Error('keyboard_rows_1_to_8');
 return {inline_keyboard:rows.map(row=>{
  if(!Array.isArray(row)||!row.length||row.length>8)throw Error('keyboard_row_limit');
  return row.map(b=>{
   if(!b||typeof b.text!=='string'||b.text.length>64||!b.text)throw Error('button_text_invalid');
   const item={text:b.text};
   if(b.url!==undefined){if(!/^https:\/\/|^tg:\/\//.test(b.url))throw Error('button_url_must_be_https_or_tg');item.url=b.url;}
   else if(b.callback_data!==undefined){if(!b.callback_data||Buffer.byteLength(b.callback_data,'utf8')>64)throw Error('callback_data_limit');item.callback_data=b.callback_data;}
   else throw Error('button_target_missing');
   return item;
  });
 })};
}
function summaryResult(method,result){
 const out={method,channel:CHANNEL,result};
 if(result && typeof result==='object' && result.message_id)out.message_link=messageLink(result.message_id);
 if(Array.isArray(result))out.message_links=result.map(m=>m.message_id?messageLink(m.message_id):null).filter(Boolean);
 return out;
}
export async function executeTool(name,args={},clientFetch=fetch){
 const api=(method,params,confirmed)=>tg(method,params,confirmed,clientFetch);
 switch(name){
  case 'get_capabilities':return {version:'2.2.0',channel:CHANNEL,methods,
    typed_tools:[...toolList.map(t=>t.name),...audienceTools.map(t=>t.name),...businessTools.map(t=>t.name)],
    business:{
     available:true,requires_explicit_activation:true,
     owner_allowlist_configured:!!String(process.env.TELEGRAM_BUSINESS_OWNER_IDS||'').trim(),
     text_storage_enabled:process.env.TELEGRAM_BUSINESS_STORE_TEXT==='true',
     webhook_commands:['enable_business_updates','disable_business_updates'],
     note:'Dedicated business_* tools require explicit Telegram Business connection, live rights, owner allowlist and observed private chats; generic bot_api_call remains channel-only.'
    },
    rules:['Channel-scoped generic Bot API method allowlist and separate opt-in Business tools',
      'No unrestricted Telegram user session or access to arbitrary chat histories',
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
     short_description:shortDescription.status==='fulfilled'?shortDescription.value:null};
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
    if(!Array.isArray(args.blocks)||args.blocks.length>500||!args.blocks.length)throw Error('invalid_rich_blocks');
    rich={blocks:args.blocks};
   }else{
    validateRich(args.content,args.format);
    rich={[args.format]:args.content};
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
   const p={chat_id:CHANNEL,[args.type]:u,disable_notification:!!args.silent,protect_content:!!args.protect_content};
   if(args.caption!==undefined){
    if(args.type==='sticker')throw Error('stickers_cannot_have_caption');
    if(formatCaption(args.caption).length>1024)throw Error('caption_limit');
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
   if(!Array.isArray(args.options)||args.options.length<2||args.options.length>12
    ||args.options.some(s=>typeof s!=='string'||!s||s.length>100))throw Error('invalid_poll_options');
   const options=args.options.map(text=>({text}));
   const p={chat_id:CHANNEL,question:args.question,options,
     type:args.quiz?'quiz':'regular',is_anonymous:args.anonymous!==false,
     allows_multiple_answers:!!args.multiple_answers};
   if(args.quiz){
    if(!Number.isInteger(args.correct_option_id)||args.correct_option_id<0||args.correct_option_id>=options.length)
      throw Error('correct_option_id_required_for_quiz');
    p.correct_option_id=args.correct_option_id;
    if(args.explanation)p.explanation=args.explanation.slice(0,200);
    delete p.allows_multiple_answers;
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
   chat_id:CHANNEL,...(args.name?{name:args.name.slice(0,32)}:{}),
   ...(args.expire_date?{expire_date:args.expire_date}:{}),
   ...(args.member_limit?{member_limit:args.member_limit}:{})
  });
  case 'revoke_invite_link':return await api('revokeChatInviteLink',{
   chat_id:CHANNEL,invite_link:args.invite_link
  },args.confirm);
  case 'get_file_metadata':{
   const x=await api('getFile',{file_id:args.file_id});
   return {file_id:x.file_id,file_unique_id:x.file_unique_id,file_size:x.file_size,
    file_path:x.file_path,download_url_not_exposed:true};
  }
  case 'bot_api_call':{
   if(typeof args.method!=='string')throw Error('method_required');
   return summaryResult(args.method,await api(args.method,args.params||{},args.confirm_dangerous));
  }
  default:throw Error('unknown_extension_tool: '+name);
 }
}
export const extensions=toolList;
export function isExtension(name){return toolList.some(x=>x.name===name);}
export const security={CHANNEL,ALLOWED,methods,validateRich,validateMethod};
