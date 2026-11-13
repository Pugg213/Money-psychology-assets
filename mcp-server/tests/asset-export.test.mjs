import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const helper=new URL('../../scripts/read_asset_base64.py',import.meta.url);
const original=new URL('../../editorial/originals/2026-11-15-imagegen.png',import.meta.url);
test('PNG crosses the bounded helper bridge unchanged, including final short chunk',()=>{
 let offset=0,encoded='',sha,size,record;
 do{
  const r=spawnSync('python3',[helper.pathname,original.pathname,'--offset',String(offset)],{encoding:'utf8',maxBuffer:800000});
  assert.equal(r.status,0,r.stderr);record=JSON.parse(r.stdout);
  assert.equal(record.offset,offset);assert.ok(record.data.length<=12000);assert.ok(record.next_offset>offset);
  sha??=record.git_blob_sha;size??=record.size_bytes;assert.equal(record.git_blob_sha,sha);assert.equal(record.size_bytes,size);
  encoded+=record.data;offset=record.next_offset;
 }while(!record.complete);
 const actual=Buffer.from(encoded,'base64'),bytes=readFileSync(original);
 assert.deepEqual(actual,bytes);assert.equal(actual.length,size);
 assert.equal(createHash('sha1').update('blob '+actual.length+'\0').update(actual).digest('hex'),sha);
});
test('asset export rejects out-of-range offsets and unbounded output requests',()=>{
 for(const args of [['--offset','-1'],['--count','12001'],['--offset','99999999']]){
  const r=spawnSync('python3',[helper.pathname,original.pathname,...args],{encoding:'utf8'});
  assert.notEqual(r.status,0);assert.equal(r.stdout,'');
 }
});
