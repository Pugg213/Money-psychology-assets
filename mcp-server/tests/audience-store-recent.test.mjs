import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudienceStore} from '../lib/audience-store.js';

const prefix='events/2026-11/';
const blob=(name,uploadedAt)=>({pathname:prefix+name+'.json',uploadedAt});
const stream=value=>new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));controller.close();}});

test('recent audience events include newest records from later list pages and aggregate chronologically',async()=>{
 const requests=[],reads=[];
 const old=blob('a-old','2026-11-01T08:00:00Z');
 const newest=blob('z-newest','2026-11-06T10:00:00Z');
 const newer=blob('y-newer','2026-11-06T09:00:00Z');
 const events=new Map([
  [old.pathname,{update_id:1,observed_at:'2026-11-01T08:00:00Z'}],
  [newest.pathname,{update_id:3,observed_at:'2026-11-06T10:00:00Z'}],
  [newer.pathname,{update_id:2,observed_at:'2026-11-06T09:00:00Z'}]
 ]);
 const adapter={
  async list(options){requests.push(options);return options.cursor?
   {blobs:[newest,newer],hasMore:false}:{blobs:[old],hasMore:true,cursor:'page-two'};},
  async get(path){reads.push(path);return {statusCode:200,stream:stream(events.get(path))};}
 };
 const result=await createAudienceStore(adapter).readRecent({prefix,limit:2});
 assert.equal(requests[1].cursor,'page-two');
 assert.deepEqual(reads,[newest.pathname,newer.pathname]);
 assert.deepEqual(result.events.map(x=>x.update_id),[2,3]);
 assert.equal(result.metadata_scanned,3);
 assert.equal(result.scan_truncated,false);
 assert.equal(result.sample_truncated,true);
 assert.equal(result.hasMore,true);
 assert.equal(result.recency_fully_ordered,true);
});

test('recent audience scan stops at 1000 metadata records and admits incomplete sampling',async()=>{
 let lists=0;
 const adapter={
  async list(options){lists++;assert.equal(options.limit,1000);return {
   blobs:Array.from({length:1000},(_,i)=>blob('record-'+i,'2026-11-06T09:00:00Z')),
   hasMore:true,cursor:'more'
  };},
  async get(){return {statusCode:200,stream:stream({observed_at:'2026-11-06T09:00:00Z'})};}
 };
 const result=await createAudienceStore(adapter).readRecent({prefix,limit:1});
 assert.equal(lists,1);
 assert.equal(result.metadata_scanned,1000);
 assert.equal(result.scan_truncated,true);
 assert.equal(result.sample_truncated,true);
 assert.equal(result.recency_fully_ordered,false);
});

test('recent audience listing cannot loop indefinitely on repeated or missing cursors',async()=>{
 for(const repeated of [false,true]){
  let lists=0;
  const adapter={
   async list(){lists++;return {blobs:[],hasMore:true,...(repeated?{cursor:'same'}:{})};},
   async get(){throw Error('no body reads expected');}
  };
  const result=await createAudienceStore(adapter).readRecent({prefix});
  assert.equal(lists,repeated?2:1);
  assert.equal(result.scan_truncated,true);
  assert.equal(result.sample_truncated,true);
 }
});

test('recent audience result exposes missing or corrupt records as incomplete data',async()=>{
 const items=[blob('a','2026-11-06T09:00:00Z'),blob('b','2026-11-06T08:00:00Z')];
 const result=await createAudienceStore({
  async list(){return {blobs:items,hasMore:false};},
  async get(path){return path===items[0].pathname?null:{statusCode:200,stream:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{bad json'));c.close();}})};}
 }).readRecent({prefix});
 assert.equal(result.events.length,0);
 assert.equal(result.skipped_records,2);
 assert.equal(result.sample_truncated,true);
});

test('recent audience ordering retains millisecond precision from SDK Date objects',async()=>{
 const older=blob('a-older',new Date('2026-11-06T10:00:00.001Z'));
 const newer=blob('z-newer',new Date('2026-11-06T10:00:00.002Z'));
 const reads=[];
 await createAudienceStore({
  async list(){return {blobs:[older,newer],hasMore:false};},
  async get(path){reads.push(path);return {statusCode:200,stream:stream({observed_at:'2026-11-06T10:00:00Z'})};}
 }).readRecent({prefix,limit:1});
 assert.deepEqual(reads,[newer.pathname]);
});

test('recent audience storage rejects JSON null and arrays rather than treating them as events',async()=>{
 const rows=[blob('null','2026-11-06T09:00:00Z'),blob('array','2026-11-06T08:00:00Z')];
 const result=await createAudienceStore({
  async list(){return {blobs:rows,hasMore:false};},
  async get(path){return {statusCode:200,stream:stream(path===rows[0].pathname?null:[])};}
 }).readRecent({prefix});
 assert.equal(result.skipped_records,2);
 assert.equal(result.sample_truncated,true);
});
