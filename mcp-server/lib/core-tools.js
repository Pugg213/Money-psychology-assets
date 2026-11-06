import {executeTool,security} from './extensions.js';
import {validateToolArgs} from './tool-schema.js';
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const text={type:'string'},id={type:'integer',minimum:1};
const plain={type:'string',enum:['plain','HTML']},rich={type:'string',enum:['markdown','html']};
const tool=(name,description,properties={},required=[],readOnly=false)=>({name,description,
 inputSchema:schema(properties,required),annotations:readOnly?{readOnlyHint:true}:{}});
export const coreTools=[
 tool('check_access','Read-only: verify configured bot identity, channel and live publishing rights.',{},[],true),
 tool('publish_text','Immediately publish plain or HTML text, at most 4096 characters.',{text,format:plain},['text']),
 tool('publish_rich_article','Immediately publish a Markdown/HTML rich article, at most32768 UTF-8 bytes.',
  {content:text,format:rich,reply_to_message_id:id},['content','format']),
 tool('publish_photo','Immediately publish a public HTTPS photo and optional caption, at most1024 characters.',
  {photo_url:text,caption:text,caption_format:plain},['photo_url']),
 tool('edit_text','Edit a channel text message using its verified message ID.',{message_id:id,text,format:plain},['message_id','text']),
 tool('edit_rich_article','Edit a channel rich article using its verified message ID.',{message_id:id,content:text,format:rich},['message_id','content','format']),
 tool('delete_post','Legacy deletion alias. Requires confirm=true; cached clients should use delete_channel_message with confirm=true.',
  {message_id:id,confirm:{type:'boolean'}},['message_id'])
];
export const isCoreTool=name=>coreTools.some(t=>t.name===name);
function message(result,expected){
 const r=result?.result;
 if(!Number.isSafeInteger(r?.message_id)||r.message_id<1||expected!==undefined&&r.message_id!==expected)
  throw Error('telegram_message_confirmation_unknown_do_not_retry');
 return {ok:true,message_id:r.message_id,chat_id:r.chat?.id??security.CHANNEL,
  message_url:result.message_link||null,automatic_retry_allowed:false};
}
function nonempty(value,max){
 if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('invalid_text_length');
}
export async function executeCoreTool(name,args={},clientFetch=fetch){
 const definition=coreTools.find(t=>t.name===name);
 if(!definition)throw Error('unknown_core_tool');
 validateToolArgs(definition,args);
 const extension=(tool,a)=>executeTool(tool,a,clientFetch);
 const api=(method,params={},confirm=false)=>extension('bot_api_call',{method,params,confirm_dangerous:confirm});
 switch(name){
  case 'check_access':{
   const overview=await extension('get_channel_overview',{}),me=overview.bot,chat=overview.chat,own=overview.bot_membership;
   if(!Number.isSafeInteger(me?.id)||!Number.isSafeInteger(chat?.id)||typeof chat.username!=='string'||
      !own||own.error)throw Error('telegram_access_check_incomplete');
   const allowed=own.status==='creator'||own.status==='administrator'&&own.can_post_messages===true;
   return {ok:allowed,bot_username:me.username,bot_id:me.id,channel_username:chat.username,channel_id:chat.id,
    status:own.status,can_post_messages:allowed,
    can_edit_messages:own.status==='creator'||own.status==='administrator'&&own.can_edit_messages===true};
  }
  case 'publish_text':{
   nonempty(args.text,4096);const params={text:args.text,link_preview_options:{is_disabled:true}};
   if(args.format==='HTML')params.parse_mode='HTML';
   return message(await api('sendMessage',params));
  }
  case 'publish_photo':return message(await extension('send_media',{
   type:'photo',url:args.photo_url,...(args.caption!==undefined?{caption:args.caption}:{}),
   ...(args.caption_format?{caption_format:args.caption_format}:{})}));
  case 'publish_rich_article':return message(await extension('send_rich_message',args));
  case 'edit_text':{
   nonempty(args.text,4096);const params={message_id:args.message_id,text:args.text};
   if(args.format==='HTML')params.parse_mode='HTML';
   return message(await api('editMessageText',params),args.message_id);
  }
  case 'edit_rich_article':{
   security.validateRich(args.content,args.format);
   return message(await api('editMessageText',{message_id:args.message_id,rich_message:{[args.format]:args.content}}),args.message_id);
  }
  case 'delete_post':{
   if(args.confirm!==true)throw Error('explicit_confirmation_required_use_delete_channel_message');
   const r=await extension('delete_channel_message',{message_id:args.message_id,confirm:true});
   if(r.result!==true)throw Error('telegram_delete_confirmation_unknown_do_not_retry');
   return {ok:true,deleted_message_id:args.message_id,automatic_retry_allowed:false};
  }
 }
}
