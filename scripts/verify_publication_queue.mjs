import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {validateQueue,verifyEntryAsset} from '../mcp-server/lib/editorial-source.js';
import {validateJpeg} from '../mcp-server/lib/jpeg-integrity.js';
const root=fileURLToPath(new URL('../',import.meta.url));
try{
 const queue=validateQueue(JSON.parse(readFileSync(resolve(root,'editorial/rich-telegram-queue.json'),'utf8')));
 const ledger=JSON.parse(readFileSync(resolve(root,'editorial/asset-ledger.json'),'utf8'));
 for(const entry of queue.entries){
  const asset=verifyEntryAsset(entry,ledger);
  validateJpeg(readFileSync(resolve(root,asset.github_path)));
  const article=readFileSync(resolve(root,'editorial/articles/'+entry.date_moscow+'.md'),'utf8');
  const expected='![Обложка выпуска]('+entry.photo_url+')\n\n*'+entry.photo_caption+'*\n\n---\n\n'+entry.content;
  if(article.trim()!==expected.trim())throw Error(entry.date_moscow+': article, cover or caption copy differs from canonical queue');
 }
 console.log('Canonical queue validated: '+queue.entries.length+' unique dates, asset bindings and article copies.');
}catch(error){console.error('FAIL:',error.message);process.exitCode=1;}
