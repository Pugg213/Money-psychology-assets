import {createHash} from 'node:crypto';

const dimensions=['originality','evidence','depth','language','practical_value','visual'];
const placeholder=/^(?:todo|tbd|unknown|none|null|undefined|n\/?a|placeholder|example|writer|reviewer)$/i;
const text=value=>typeof value==='string'&&value.trim().length>0&&!placeholder.test(value.trim());
const identity=value=>text(value)&&value===value.trim()&&!/[\u0000-\u001f]/.test(value);
const blobSha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const payloadHash=entry=>createHash('sha256').update(JSON.stringify([
 entry.photo_url,entry.photo_caption||'',entry.content,entry.format
])).digest('hex');
function timestamp(value,now){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return false;
 const parsed=Date.parse(value),day=Date.parse(value.slice(0,10)+'T00:00:00Z');
 return Number.isFinite(parsed)&&Number.isFinite(day)&&
  new Date(day).toISOString().slice(0,10)===value.slice(0,10)&&parsed<=now+30000;
}
function nowFrom(clock){
 const now=Number(clock());
 if(!Number.isFinite(now))throw Error('invalid_editorial_clock');
 return now;
}
function primarySource(source,now){
 if(!source||source.kind!=='primary_source'||!text(source.claim)||!text(source.scope)||
    !(timestamp(source.checked_at,now)||typeof source.checked_at==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(source.checked_at)&&new Date(source.checked_at).toISOString().slice(0,10)===source.checked_at&&Date.parse(source.checked_at)<=now))return false;
 try{
  const url=new URL(source.url),host=url.hostname.toLowerCase();
  return url.protocol==='https:'&&!url.username&&!url.password&&host.includes('.')&&
   !/(^|\.)(?:localhost|invalid|example|test|local|internal)$/.test(host)&&
   !/(^|\.)example\.(?:com|net|org)$/.test(host)&&
   !/^(?:127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
 }catch{return false;}
}

// Input order: difference/ratio [a,b]; percent_change [old,new]; annuity
// [principal,annual nominal decimal,months]; simple_interest [principal,
// annual decimal,days,year_days]; weighted_mean [value,weight,...].
function calculated(operator,x){
 switch(operator){
 case 'sum':return x.reduce((a,b)=>a+b,0);
 case 'difference':return x.length===2?x[0]-x[1]:NaN;
 case 'product':return x.reduce((a,b)=>a*b,1);
 case 'ratio':return x.length===2&&x[1]!==0?x[0]/x[1]:NaN;
 case 'percent_change':return x.length===2&&x[0]!==0?100*(x[1]-x[0])/x[0]:NaN;
 case 'annuity':{
  if(x.length!==3||x[0]<0||x[1]<0||!Number.isSafeInteger(x[2])||x[2]<1)return NaN;
  const monthly=x[1]/12;
  return monthly===0?x[0]/x[2]:x[0]*monthly/(1-Math.pow(1+monthly,-x[2]));
 }
 case 'simple_interest':return x.length===4&&x[0]>=0&&x[2]>=0&&x[3]>0?x[0]*x[1]*x[2]/x[3]:NaN;
 case 'weighted_mean':{
  if(x.length%2||x.some((v,i)=>i%2&&v<0))return NaN;
  let total=0,weight=0;
  for(let i=0;i<x.length;i+=2){total+=x[i]*x[i+1];weight+=x[i+1];}
  return weight>0?total/weight:NaN;
 }
 default:return NaN;
 }
}
function validCalculation(check,content){
 if(!check||!text(check.label)||!text(check.excerpt)||!content.includes(check.excerpt)||
    !Array.isArray(check.inputs)||!check.inputs.length||!check.inputs.every(Number.isFinite)||
    !Number.isFinite(check.expected)||!Number.isFinite(check.tolerance)||check.tolerance<0||check.tolerance>0.5)return false;
 const actual=calculated(check.operator,check.inputs);
 return Number.isFinite(actual)&&Math.abs(actual-check.expected)<=check.tolerance;
}

// These records are review evidence. Schema validation does not authenticate a
// reviewer, prove a source was reopened, or establish the truth of a claim.
export function verifyReleaseReview(entry,asset,{clock=()=>new Date(),required=true}={}){
 const review=entry?.editorial_review?.release_review;
 if(review==null){if(required)throw Error('release_review_missing');return null;}
 const now=nowFrom(clock);
 if(review.version!==1||review.decision!=='approved'||review.reviewer_role!=='independent_editor'||
    !identity(review.reviewer_run_id)||!identity(review.writer_run_id)||
    review.reviewer_run_id===review.writer_run_id||!text(review.assessment))
  throw Error('release_review_identity_failed');
 if(typeof entry.content!=='string'||!blobSha(asset?.github_blob_sha)||
    review.payload_hash!==payloadHash(entry)||review.asset_blob_sha!==asset.github_blob_sha)
  throw Error('release_review_binding_failed');
 if(!timestamp(review.checked_at,now))throw Error('release_review_timestamp_failed');
 const scores=dimensions.map(key=>review.scores?.[key]);
 if(scores.some(value=>!Number.isInteger(value)||value<1||value>2)||scores.reduce((a,b)=>a+b,0)<10)
  throw Error('release_review_scores_failed');
 if(!Array.isArray(review.source_checks)||!review.source_checks.length||
    !review.source_checks.every(source=>primarySource(source,now)))throw Error('release_review_sources_failed');
 if(!Array.isArray(review.findings)||review.findings.some(finding=>!finding||typeof finding!=='object'||
    (['blocking','critical'].includes(finding.severity)&&finding.resolved!==true)))
  throw Error('release_review_findings_failed');
 if(!Array.isArray(review.calculations)||!review.calculations.length||
    !review.calculations.every(check=>validCalculation(check,entry.content)))
  throw Error('release_review_calculations_failed');
 return review;
}

export function verifyNativeProvenance(asset,{clock=()=>new Date()}={}){
 const now=nowFrom(clock),generation=asset?.generation,review=asset?.pixel_review;
 if(generation?.method!=='chatgpt_image_gen'||typeof generation.source_sha256!=='string'||
    !/^[a-f0-9]{64}$/.test(generation.source_sha256)||!text(generation.source_ref)||
    !/^editorial\/originals\/[A-Za-z0-9_-]+\.png$/.test(generation.source_ref)||
    !timestamp(generation.generated_at||generation.observed_at,now)||
    !(text(generation.prompt)||text(generation.prompt_unavailable_reason)&&identity(generation.source_run_id)&&text(generation.source_file_ref)))throw Error('native_provenance_failed');
 if(!blobSha(asset.github_blob_sha)||review?.decision!=='approved'||review.asset_blob_sha!==asset.github_blob_sha||
    !timestamp(review.checked_at,now)||!identity(review.reviewer_run_id)||!text(review.assessment))
  throw Error('pixel_review_failed');
 return asset;
}
