import {createAudienceService} from './audience-service.js';
import {validateToolArgs} from './tool-schema.js';
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
 const definition=audienceTools.find(x=>x.name===name);
 if(!definition)throw Error('unknown_audience_tool');
 validateToolArgs(definition,args);
 switch(name){
  case 'get_interaction_status':return service.status();
  case 'get_reader_feedback':return service.report(args);
  case 'suggest_reader_topics':return service.topics(args);
  case 'get_publication_journal':return service.publicationJournal(args);
  case 'get_member_trend':return service.memberTrend(args);
  case 'enable_reader_feedback':return service.enable(args);
  case 'disable_reader_feedback':return service.disable(args);
  case 'attach_feedback_buttons':return service.attachButtons(args);
  case 'capture_member_snapshot':return service.captureSnapshot();
  default:throw Error('unknown_audience_tool');
 }
}
