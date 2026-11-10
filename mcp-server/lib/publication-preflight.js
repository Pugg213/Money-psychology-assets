import {productionPlan,verifyProductionReadiness} from './editorial-production.js';
import {createEditorialSource,publicationDate,payloadHash,validateQueue,verifyAssetIdentity,verifyEntryAsset,RAW} from './editorial-source.js';

const validDate=value=>typeof value==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(value)&&
 Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const markdownFor=entry=>'![Обложка выпуска]('+entry.photo_url+')\n\n*'+entry.photo_caption+'*\n\n---\n\n'+entry.content;

/** Read-only integrity evidence. A passed result never represents semantic or pixel approval. */
export function createPublicationPreflight({source=createEditorialSource(),clock=()=>new Date()}={}){
 async function run({date_moscow,include_image=false,include_content=false}={}){
  const result={ok:false,date_moscow:date_moscow??null,checks:{semantic_review:'not_performed',pixel_review:'not_performed'},errors:[]};
  const fail=(check,error)=>{
   const message=String(error?.message||error).slice(0,500);
   result.checks[check]={status:'failed',error:message};
   result.errors.push({check,error:message});
  };
  const pass=check=>{result.checks[check]={status:'passed'};};
  let day;
  try{
   day=date_moscow===undefined?publicationDate(clock()):date_moscow;
   if(!validDate(day))throw Error('invalid_date_moscow');
   result.date_moscow=day;pass('date');
  }catch(error){fail('date',error);return result;}
  let queue,ledger,commit;
  try{
   ({queue,ledger,commit}=await source.snapshot());
   if(typeof commit!=='string'||!/^[a-f0-9]{40}$/.test(commit))throw Error('invalid_source_revision');
   result.source_commit=commit;pass('snapshot');
  }catch(error){fail('snapshot',error);return result;}
  try{validateQueue(queue);pass('canonical_queue');}
  catch(error){fail('canonical_queue',error);return result;}
  // A missing current issue must not hide the independently inspectable future reserve.
  try{result.production_plan=productionPlan(queue,ledger,{as_of:day,clock});}
  catch(error){
   fail('production_plan',error);
   result.release_readiness={status:'unknown',reason:String(error?.message||error)};
   return result;
  }
  const entries=queue.entries.filter(entry=>entry.date_moscow===day);
  if(entries.length!==1){fail('entry',Error('entry_missing_or_duplicate'));return result;}
  const entry=entries[0];pass('entry');
  Object.assign(result,{title:entry.title,content:entry.content,format:entry.format,
   photo_url:entry.photo_url,photo_caption:entry.photo_caption,publication_state:entry.state,
   payload_hash:payloadHash({photo_url:entry.photo_url,caption:entry.photo_caption,content:entry.content,format:entry.format}),
   full_markdown:markdownFor(entry),canonical_entry:structuredClone(entry)});
  let asset;
  try{
   asset=verifyAssetIdentity(entry,ledger);
   result.asset_record=structuredClone(asset);pass('asset_identity');
  }catch(error){
   fail('asset_identity',error);
   result.release_readiness={status:'not_released',reason:String(error?.message||error)};
  }
  if(asset){
   // Byte inspection must remain available before an editor approves the media.
   try{
    verifyEntryAsset(entry,ledger);pass('recorded_editorial_binding');
    try{result.release_readiness=verifyProductionReadiness(entry,asset,{clock});}
    catch(error){result.release_readiness={status:'not_released',reason:error.message};}
   }catch(error){
    fail('recorded_editorial_binding',error);
    result.release_readiness={status:'not_released',reason:error.message};
   }
   const pinned=RAW+commit+'/'+asset.github_path;
   result.asset_pinned_url=pinned;
   try{
    if(typeof source.inspectMedia!=='function')throw Error('media_inspection_not_supported');
    const media=await source.inspectMedia(asset,commit);
    if(!media||media.url!==pinned||media.github_blob_sha!==asset.github_blob_sha||
       !/^[a-f0-9]{64}$/.test(media.jpeg_sha256)||media.size_bytes!==asset.github_size_bytes||
       !Number.isSafeInteger(media.width)||!Number.isSafeInteger(media.height)||media.width<900||media.height<900||
       media.width+media.height>10000||Math.max(media.width,media.height)/Math.min(media.width,media.height)>20)
     throw Error('media_evidence_binding_failed');
    result.media_evidence={url:media.url,github_blob_sha:media.github_blob_sha,jpeg_sha256:media.jpeg_sha256,
     source_evidence:media.source_evidence||null,size_bytes:media.size_bytes,width:media.width,height:media.height};
    if(include_image&&typeof media.image_base64==='string')result.image_content={type:'image',mimeType:'image/jpeg',data:media.image_base64};
    pass('media');
   }catch(error){fail('media',error);}
  }else{
   result.checks.recorded_editorial_binding={status:'blocked',reason:'asset_identity_failed'};
   result.checks.media={status:'blocked',reason:'asset_identity_failed'};
  }
  if(typeof source.readArticle==='function'){
   try{
    const article=await source.readArticle(day,commit);
    if(typeof article!=='string'||article.trimEnd()!==result.full_markdown.trimEnd())throw Error('article_copy_mismatch');
    pass('article_copy');
   }catch(error){fail('article_copy',error);}
  }else result.checks.article_copy={status:'not_supported'};
  result.ok=result.errors.length===0;
  // Text and imagery are requested separately: cached clients must receive a small readiness object.
  delete result.canonical_entry;delete result.asset_record;delete result.full_markdown;
  if(!include_content)delete result.content;
  return result;
 }
 return {run};
}
