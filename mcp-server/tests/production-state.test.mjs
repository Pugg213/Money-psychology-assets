import test from 'node:test';
import assert from 'node:assert/strict';
import {validateQueue} from '../lib/editorial-source.js';
import {verifyProductionReadiness,productionPlan} from '../lib/editorial-production.js';
// Keep state-machine cases independent of the growing production queue.
const fixture={schema_version:2,channel:'@psy_money1',timezone:'Europe/Moscow',
 publish_time:'12:00',publisher:'Money Psy Telegram MCP',entries:[]};
const draft=()=>({date_moscow:'2026-11-20',scheduled_at:'2026-11-20T12:00:00+03:00',publisher:'Money Psy Telegram MCP',migrated_and_deduplicated:true,
 state:'draft',title:'A researched angle',format:'markdown',content:'',photo_caption:'',telegram_publication:null,
 production:{stage:'research',run_id:'actual-producer-run',attempts:1,updated_at:'2026-11-07T08:00:00Z',blocker:null}});
test('incomplete work is resumable inside the same canonical queue without pretending it is queued',()=>{
 const q=structuredClone(fixture);q.entries.push(draft());assert.equal(validateQueue(q),q);
 q.entries.at(-1).send_attempts=1;assert.throws(()=>validateQueue(q),/draft_has_delivery_attempt/);
});
test('future publication requires a separate review; legacy day remains compatible',()=>{
 const e={date_moscow:'2026-11-08',editorial_review:{}};
 assert.throws(()=>verifyProductionReadiness(e,{}),/release_review_missing/);
 assert.equal(verifyProductionReadiness({...e,date_moscow:'2026-11-07'},{}).status,'legacy_review_contract');
});
test('production plan reports exact gaps and draft blockers without counting unapproved entries as released reserve',()=>{
 const q=structuredClone(fixture);q.entries=[draft()];q.entries[0].date_moscow='2026-11-08';q.entries[0].scheduled_at='2026-11-08T12:00:00+03:00';
 q.entries[0].production.stage='blocked';q.entries[0].production.blocker='image_gen_not_exposed';
 const plan=productionPlan(q,{entries:[]},{as_of:'2026-11-07'});
 assert.equal(plan.reviewed_continuous_days,0);assert.equal(plan.future_dates.length,7);
 assert.equal(plan.next_work.date_moscow,'2026-11-08');assert.equal(plan.next_work.stage,'blocked');
 assert.equal(plan.next_work.blocker,'image_gen_not_exposed');
});
