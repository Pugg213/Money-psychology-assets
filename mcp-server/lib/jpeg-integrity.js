// JPEG container/frame/scan validation; this does not decode image pixels.
// Telegram geometry limits: https://core.telegram.org/bots/api#sendphoto
const SOF=new Set([0xc0,0xc1,0xc2]);
const allSof=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
const invalid=reason=>{throw Error('invalid_original_jpeg: '+reason);};
export function validateJpeg(input,{
 minWidth=900,minHeight=900,maxDimensionSum=10000,maxAspectRatio=20,maxBytes=10*1024*1024
}={}){
 if(!(input instanceof Uint8Array))invalid('bytes_required');
 const bytes=Buffer.from(input.buffer,input.byteOffset,input.byteLength);
 if(bytes.length<4||bytes.length>maxBytes)invalid('file_size');
 if(bytes[0]!==0xff||bytes[1]!==0xd8)invalid('missing_soi');
 if(bytes.at(-2)!==0xff||bytes.at(-1)!==0xd9)invalid('missing_final_eoi');
 let p=2,frame=null,scans=0,entropy=0,restartInterval=0;
 const quant=new Set(),huffman=new Set();
 while(p<bytes.length){
  if(bytes[p]!==0xff)invalid('expected_marker');
  while(bytes[p]===0xff)p++;
  if(p>=bytes.length)invalid('truncated_marker');
  const marker=bytes[p++];
  if(marker===0xd9){
   if(p!==bytes.length)invalid('trailing_data');
   if(!frame||!scans||!entropy)invalid('missing_frame_or_scan');
   return {width:frame.width,height:frame.height,bytes:bytes.length,progressive:frame.marker===0xc2,scans};
  }
  if(marker===0x00||marker===0xd8||marker===0x01||(marker>=0xd0&&marker<=0xd7))invalid('unexpected_standalone_marker');
  if(p+2>bytes.length)invalid('truncated_segment_length');
  const length=bytes.readUInt16BE(p),start=p+2,end=p+length;
  if(length<2||end>bytes.length)invalid('truncated_or_invalid_segment');
  if(allSof.has(marker)){
   if(!SOF.has(marker)||frame)invalid('unsupported_or_duplicate_frame');
   if(length<11)invalid('short_frame');
   const precision=bytes[start],height=bytes.readUInt16BE(start+1),width=bytes.readUInt16BE(start+3),count=bytes[start+5];
   if(precision!==8||count<1||count>4||length!==8+3*count)invalid('invalid_frame_header');
   if(width<minWidth||height<minHeight||width+height>maxDimensionSum||
      Math.max(width,height)/Math.min(width,height)>maxAspectRatio)invalid('unsupported_geometry');
   const components=new Map();
   for(let i=0;i<count;i++){
    const at=start+6+3*i,id=bytes[at],sampling=bytes[at+1],table=bytes[at+2];
    const horizontal=sampling>>4,vertical=sampling&15;
    if(components.has(id)||horizontal<1||horizontal>4||vertical<1||vertical>4||table>3)invalid('invalid_frame_component');
    components.set(id,{quant:table});
   }
   frame={marker,width,height,components};
  }else if(marker===0xdb){
   let at=start;
   while(at<end){
    const info=bytes[at++],precision=info>>4,id=info&15;
    if(precision>1||id>3)invalid('invalid_quantization_table');
    const size=64*(precision+1);
    if(at+size>end)invalid('truncated_quantization_table');
    for(let i=0;i<64;i++){
     const value=precision?bytes.readUInt16BE(at+2*i):bytes[at+i];
     if(!value)invalid('zero_quantization_value');
    }
    at+=size;quant.add(id);
   }
   if(at!==end||start===end)invalid('invalid_quantization_segment');
  }else if(marker===0xc4){
   let at=start;
   while(at<end){
    const info=bytes[at++],kind=info>>4,id=info&15;
    if(kind>1||id>3||at+16>end)invalid('invalid_huffman_table');
    let count=0,slots=1;
    for(let i=0;i<16;i++){
     const n=bytes[at+i];count+=n;slots=slots*2-n;
     if(slots<0)invalid('oversubscribed_huffman_table');
    }
    at+=16;
    if(count<1||count>256||at+count>end)invalid('truncated_huffman_table');
    at+=count;huffman.add(kind+':'+id);
   }
   if(at!==end||start===end)invalid('invalid_huffman_segment');
  }else if(marker===0xdd){
   if(length!==4)invalid('invalid_restart_interval');
   restartInterval=bytes.readUInt16BE(start);
  }else if(marker===0xda){
   if(!frame||length<8)invalid('scan_before_frame');
   const count=bytes[start];
   if(count<1||count>frame.components.size||length!==6+2*count)invalid('invalid_scan_header');
   const spectralStart=bytes[end-3],spectralEnd=bytes[end-2],approx=bytes[end-1];
   if(frame.marker!==0xc2&&(spectralStart!==0||spectralEnd!==63||approx!==0))invalid('invalid_sequential_scan');
   if(frame.marker===0xc2&&(spectralStart>spectralEnd||spectralEnd>63||
      (spectralStart===0&&spectralEnd!==0)||(spectralStart>0&&count!==1)||
      (approx>>4)>13||(approx&15)>13||((approx>>4)!==0&&(approx>>4)!==(approx&15)+1)))invalid('invalid_progressive_scan');
   const selected=new Set();
   for(let i=0;i<count;i++){
    const id=bytes[start+1+2*i],tables=bytes[start+2+2*i],dc=tables>>4,ac=tables&15;
    const component=frame.components.get(id);
    if(!component||selected.has(id)||dc>3||ac>3||!quant.has(component.quant))invalid('undefined_scan_component_or_table');
    if((frame.marker!==0xc2||spectralStart===0)&&!huffman.has('0:'+dc))invalid('missing_dc_huffman_table');
    if((frame.marker!==0xc2||spectralStart>0)&&!huffman.has('1:'+ac))invalid('missing_ac_huffman_table');
    selected.add(id);
   }
   p=end;scans++;let scanBytes=0,nextRestart=0;
   while(p<bytes.length){
    if(bytes[p]!==0xff){p++;scanBytes++;continue;}
    const markerStart=p;
    while(bytes[p]===0xff)p++;
    if(p>=bytes.length)invalid('truncated_entropy_marker');
    const code=bytes[p];
    if(code===0x00){
     if(p!==markerStart+1)invalid('invalid_stuffed_byte');
     p++;scanBytes++;continue;
    }
    if(code>=0xd0&&code<=0xd7){
     if(!restartInterval||code!==0xd0+nextRestart)invalid('invalid_restart_marker');
     nextRestart=(nextRestart+1)%8;p++;continue;
    }
    p=markerStart;break;
   }
   if(!scanBytes)invalid('empty_scan');
   entropy+=scanBytes;
   continue;
  }else if(!(marker>=0xe0&&marker<=0xef)&&marker!==0xfe){
   invalid('unsupported_marker');
  }
  p=end;
 }
 invalid('missing_eoi');
}
