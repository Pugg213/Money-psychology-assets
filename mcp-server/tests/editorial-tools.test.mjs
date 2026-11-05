import test from 'node:test';
import assert from 'node:assert/strict';
import {audienceTools,executeAudienceTool,isAudienceTool} from '../lib/audience-tools.js';
const calls=[];
const service={
 status:async()=>({webhook_installed:false,safe_to_enable:true,storage_configured:true}),
 report:async args=>({month:args.month||'2026-11',report:{total_comments:2,feedback_votes:{useful:1,more:1,less:0},views_available:false}}),
 topics:async()=>({topic_ideas:[{topic:'бизнес',source:'читательские вопросы (эвристика)'}],verified_research:false}),
 publicationJournal:async()=>({entries:[{date:'2026-11-05',state:'queued'}]}),
 attachButtons:async args=>{calls.push(args);if(!args.confirm)throw Error('confirmation_required');return {attached:true,no_new_post_sent:true}},
 enable:async args=>{calls.push(args);if(!args.confirm)throw Error('confirmation_required');return {enabled:true}},
 disable:async args=>{calls.push(args);if(!args.confirm)throw Error('confirmation_required');return {enabled:false}}
};
test('catalog exposes read-only report and guarded write tools',()=>{
 assert.ok(isAudienceTool('get_reader_feedback'));
 assert.ok(audienceTools.find(x=>x.name==='get_reader_feedback').annotations.readOnlyHint);
 assert.ok(!audienceTools.find(x=>x.name==='attach_feedback_buttons').annotations.readOnlyHint);
});
test('read tools return transparent coverage and publication ledger',async()=>{
 const f=await executeAudienceTool('get_reader_feedback',{month:'2026-11'},service);
 assert.equal(f.report.total_comments,2);
 assert.equal(f.report.views_available,false);
 const p=await executeAudienceTool('get_publication_journal',{},service);
 assert.equal(p.entries[0].state,'queued');
});
test('button attachment only edits an existing article under explicit confirmation',async()=>{
 await assert.rejects(()=>executeAudienceTool('attach_feedback_buttons',{date_moscow:'2026-11-05',confirm:false},service),/confirmation_required/);
 const a=await executeAudienceTool('attach_feedback_buttons',{date_moscow:'2026-11-05',confirm:true},service);
 assert.equal(a.no_new_post_sent,true);
});
