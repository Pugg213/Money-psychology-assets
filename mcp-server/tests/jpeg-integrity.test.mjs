import test from 'node:test';
import assert from 'node:assert/strict';
import {validateJpeg} from '../lib/jpeg-integrity.js';

const marker=(code,payload)=>{
 const header=Buffer.from([0xff,code,0,0]);header.writeUInt16BE(payload.length+2,2);
 return Buffer.concat([header,payload]);
};
const qtable=()=>marker(0xdb,Buffer.from([0,...Array(64).fill(1)]));
const htable=(kind=0)=>marker(0xc4,Buffer.from([kind<<4,1,...Array(15).fill(0),0]));
const frame=(width=900,height=1125,code=0xc0)=>{
 const payload=Buffer.from([8,0,0,0,0,1,1,0x11,0]);
 payload.writeUInt16BE(height,1);payload.writeUInt16BE(width,3);
 return marker(code,payload);
};
const scan=(spectralStart=0,spectralEnd=63)=>marker(0xda,Buffer.from([1,1,0,spectralStart,spectralEnd,0]));
// These fixtures exercise JPEG structure, not entropy/pixel decoding.
const jpeg=({width=900,height=1125,progressive=false,entropy=Buffer.from([0x3f]),extra=[]}={})=>Buffer.concat([
 Buffer.from([0xff,0xd8]),qtable(),htable(),htable(1),frame(width,height,progressive?0xc2:0xc0),...extra,
 scan(0,progressive?0:63),entropy,...(progressive?[scan(1,63),Buffer.from([0x3f])]:[]),Buffer.from([0xff,0xd9])
]);

test('JPEG frame/scan validation accepts baseline and progressive containers',()=>{
 assert.deepEqual(validateJpeg(jpeg()),{width:900,height:1125,bytes:jpeg().length,progressive:false,scans:1});
 assert.equal(validateJpeg(jpeg({progressive:true})).scans,2);
 assert.equal(validateJpeg(jpeg({progressive:true})).progressive,true);
});

test('JPEG rejects SOI/EOI-only placeholders, non-JPEG bytes, and trailing data',()=>{
 for(const payload of [Buffer.from([255,216,255,217]),Buffer.from('not a JPEG'),
  Buffer.concat([jpeg(),Buffer.from('junk')]),Buffer.concat([Buffer.from([255,216]),qtable(),Buffer.from([255,217])])])
  assert.throws(()=>validateJpeg(payload),/invalid_original_jpeg/);
});

test('JPEG rejects truncated segment lengths, segment data and premature EOI',()=>{
 const original=jpeg();
 for(let length=2;length<original.length;length++){
  assert.throws(()=>validateJpeg(original.subarray(0,length)),/invalid_original_jpeg/);
 }
 const overlong=Buffer.from(original);overlong.writeUInt16BE(65535,4);
 assert.throws(()=>validateJpeg(overlong),/truncated_or_invalid_segment/);
 const shortened=Buffer.from(original);shortened.writeUInt16BE(1,4);
 assert.throws(()=>validateJpeg(shortened),/truncated_or_invalid_segment/);
});

test('JPEG enforces editorial minimum dimensions and Telegram geometry and file limits',()=>{
 assert.throws(()=>validateJpeg(jpeg({width:899})),/unsupported_geometry/);
 assert.throws(()=>validateJpeg(jpeg({height:899})),/unsupported_geometry/);
 assert.throws(()=>validateJpeg(jpeg({width:6000,height:5000})),/unsupported_geometry/);
 assert.throws(()=>validateJpeg(jpeg({width:2001,height:100}),{minWidth:1,minHeight:1}),/unsupported_geometry/);
 assert.equal(validateJpeg(jpeg({width:2000,height:100}),{minWidth:1,minHeight:1}).width,2000);
 assert.equal(validateJpeg(jpeg({width:5000,height:5000})).width,5000);
 assert.throws(()=>validateJpeg(jpeg(),{maxBytes:jpeg().length-1}),/file_size/);
});

test('JPEG rejects missing frame/tables, duplicate frame and invalid scan components',()=>{
 const absentQuant=Buffer.concat([Buffer.from([255,216]),htable(),htable(1),frame(),scan(),Buffer.from([0x3f,255,217])]);
 const absentHuffman=Buffer.concat([Buffer.from([255,216]),qtable(),frame(),scan(),Buffer.from([0x3f,255,217])]);
 assert.throws(()=>validateJpeg(absentQuant),/undefined_scan_component_or_table/);
 assert.throws(()=>validateJpeg(absentHuffman),/missing_dc_huffman_table/);
 assert.throws(()=>validateJpeg(jpeg({extra:[frame()]})),/unsupported_or_duplicate_frame/);
 const invalidComponent=Buffer.from(jpeg());
 const sos=invalidComponent.indexOf(Buffer.from([255,218]));invalidComponent[sos+5]=99;
 assert.throws(()=>validateJpeg(invalidComponent),/undefined_scan_component_or_table/);
});

test('JPEG handles escaped entropy bytes and rejects unconfigured or unordered restarts',()=>{
 assert.equal(validateJpeg(jpeg({entropy:Buffer.from([0x3f,255,0,0x3f])})).scans,1);
 assert.throws(()=>validateJpeg(jpeg({entropy:Buffer.from([0x3f,255,208,0x3f])})),/invalid_restart_marker/);
 const restart=marker(0xdd,Buffer.from([0,1]));
 assert.equal(validateJpeg(jpeg({extra:[restart],entropy:Buffer.from([0x3f,255,208,0x3f,255,209,0x3f])})).scans,1);
 assert.throws(()=>validateJpeg(jpeg({extra:[restart],entropy:Buffer.from([0x3f,255,209,0x3f])})),/invalid_restart_marker/);
 assert.throws(()=>validateJpeg(jpeg({entropy:Buffer.alloc(0)})),/empty_scan/);
});
