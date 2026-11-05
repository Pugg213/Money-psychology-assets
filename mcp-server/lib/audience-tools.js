import {createAudienceService,botRequest} from './audience-service.js';
import {createAudienceStore} from './audience-store.js';
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const textField={type:'string'},yes={type:'boolean'};
const P=(name,description,props={},required=[],readOnly=true)=>({name,description,inputSchema:schema(props,required),annotations:readOnly?{readOnlyHint:true}:{}});
export const audienceTools=[
 P('get_interaction_status','Read-only: inspect current webhook owner, linked discussion group and private storage readiness. Does not change configuration.'),
 P('get_reader_feedback','Read-only: summarize only reader comments, callbacks and reactions actually delivered to the authorized webhook; no fabricated views.',{month:textField,post_key:textField,limit:{type:'integer',minimum:1,maximum:200}}),
 P('suggest_reader_topics','Read-only: extract candidate topics from collected reader questions. Heuristic; not AI, not automatically fact checked.',{month:textField,limit:{type:'integer',minimum:1,maximum:200}}),
 P('get_publication_journal','Read-only: look at the single GitHub editorial queue, statuses and confirmed Telegram IDs. Does not send posts.',{limit:{type:'integer',minimum:1,maximum:40}}),
 P('get_member_trend','Read-only: list stored daily subscriber-count snapshots. Counts are NOT post reach or views.',{month:textField,limit:{type:'integer',minimum:1,maximum:200}}),
 P('enable_reader_feedback','Explicitly opt in to Telegram webhook (only when no foreign webhook is installed), private audience capture and inline feedback. Does not publish a message.',{confirm:yes},['confirm'],false),
 P('disable_reader_feedback','Disable the webhook ONLY if it belongs to this service; pending updates are preserved.',{confirm:yes},['confirm'],false),
 P('attach_feedback_buttons','Edit an existing, confirmed published article to show three inline buttons; no second publication, requires enabled webhook.',{date_moscow:textField,confirm:yes},['date_moscow','confirm'],false),
 P('capture_member_snapshot','Record current subscriber count privately, without generating a channel message.',{},[],false)
];
const names=new Set(audienceTools.map(x=>x.name));
export function isAudienceTool(name){return names.has(name);}
export async function executeAudienceTool(name,args={},service=createAudienceService()){
 switch(name){
  case 'get_interaction_status':return service.status();
  case 'get_reader_feedback':return service.report(args);
  case 'suggest_reader_topics':return service.topics(args);
  case 'get_publication_journal':return service.publicationJournal(args);
  case 'get_member_trend':{
   const month=args.month||new Date().toISOString().slice(0,7);
   if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw Error('invalid_month');
   const store=createAudienceStore();
   const data=await store.readRecent({prefix:'events/'+month+'/',limit:args.limit||150});
   return {month,snapshots:data.events.filter(x=>x.type==='subscriber_snapshot').map(x=>({
    date:x.observed_at.slice(0,10),member_count:x.member_count
   })).sort((a,b)=>a.date.localeCompare(b.date)),truncated:data.hasMore,
   note:'Subscriber count from getChatMemberCount, not message views or reach.'};
  }
  case 'enable_reader_feedback':return service.enable(args);
  case 'disable_reader_feedback':return service.disable(args);
  case 'attach_feedback_buttons':return service.attachButtons(args);
  case 'capture_member_snapshot':{
   const raw=await botRequest('getChatMemberCount',{chat_id:process.env.TELEGRAM_CHAT_ID||'@psy_money1'});
   if(!Number.isSafeInteger(raw)||raw<0)throw Error('invalid_member_count');
   const event={type:'subscriber_snapshot',member_count:raw,observed_at:new Date().toISOString()};
   const saved=await createAudienceStore().record(event);
   return {member_count:raw,stored:saved.stored,duplicate:saved.duplicate,not_post_views:true};
  }
  default:throw Error('unknown_audience_tool');
 }
}
