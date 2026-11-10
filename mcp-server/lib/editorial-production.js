import {verifyReleaseReview,verifyNativeProvenance} from './editorial-policy.js';
// Fixed server policy dates cannot be disabled by editing the writer's queue.
export const RELEASE_POLICY_FROM='2026-11-08',NATIVE_IMAGE_POLICY_FROM='2026-11-09';
export function verifyProductionReadiness(entry,asset,{clock=()=>new Date()}={}){
 if(entry.date_moscow<RELEASE_POLICY_FROM)return {status:'legacy_review_contract'};
 verifyReleaseReview(entry,asset,{clock});
 if(entry.date_moscow>=NATIVE_IMAGE_POLICY_FROM)verifyNativeProvenance(asset,{clock});
 return {status:'reviewed',payload_hash:entry.editorial_review.release_review.payload_hash,
  asset_blob_sha:asset.github_blob_sha,reviewer_run_id:entry.editorial_review.release_review.reviewer_run_id};
}
export function productionPlan(queue,ledger,{as_of,clock=()=>new Date()}={}){
 if(!Array.isArray(queue?.entries))throw Error('invalid_canonical_queue');
 if(!Array.isArray(ledger?.entries))throw Error('invalid_asset_ledger');
 const today=as_of||new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(clock());
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(today)||new Date(today).toISOString().slice(0,10)!==today)throw Error('invalid_plan_date');
 const future_dates=[];let reviewed_continuous_days=0;
 for(let n=1;n<=7;n++){
  const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);const day=d.toISOString().slice(0,10);
  const entry=queue.entries.find(e=>e.date_moscow===day),asset=ledger.entries.find(a=>a.date_moscow===day);
  let stage=entry?.production?.stage||'missing',blocker=entry?.production?.blocker||null,reviewed=false;
  if(entry?.state==='queued'){
   try{verifyProductionReadiness(entry,asset,{clock});reviewed=true;stage='reviewed';}
   catch(error){stage='review';blocker=error.message;}
  }
  const row={date_moscow:day,state:entry?.state||'missing',stage,blocker,reviewed,
   attempts:entry?.production?.attempts||0};future_dates.push(row);
  if(reviewed&&n===reviewed_continuous_days+1)reviewed_continuous_days++;
 }
 return {as_of:today,target_days:7,reviewed_continuous_days,future_dates,
  next_work:future_dates.find(x=>!x.reviewed)||null,
  evidence_scope:'review records only; byte integrity and semantic/pixel review are separate checks'};
}
