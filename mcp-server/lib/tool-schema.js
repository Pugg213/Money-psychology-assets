const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=path=>{throw Error('invalid_tool_arguments: '+path);};
function check(value,schema,path,depth=0){
 if(!schema||typeof schema!=='object'||depth>16)fail(path);
 if(schema.anyOf){
  if(!schema.anyOf.some(s=>{try{check(value,s,path,depth+1);return true;}catch{return false;}}))fail(path);
  return;
 }
 if(schema.oneOf){
  if(schema.oneOf.filter(s=>{try{check(value,s,path,depth+1);return true;}catch{return false;}}).length!==1)fail(path);
  return;
 }
 if(schema.enum&&!schema.enum.some(x=>JSON.stringify(x)===JSON.stringify(value)))fail(path);
 if(schema.const!==undefined&&JSON.stringify(schema.const)!==JSON.stringify(value))fail(path);
 const type=schema.type;
 if(Array.isArray(type)){
  if(!type.some(t=>{try{check(value,{...schema,type:t},path,depth+1);return true;}catch{return false;}}))fail(path);
  return;
 }
 if(type==='object'){
  if(!object(value))fail(path);
  for(const key of schema.required||[])if(!Object.hasOwn(value,key))fail(path+'.'+key);
  const properties=schema.properties||{};
  for(const [key,item] of Object.entries(value)){
   if(Object.hasOwn(properties,key))check(item,properties[key],path+'.'+key,depth+1);
   else if(schema.additionalProperties===false)fail(path+'.'+key);
   else if(object(schema.additionalProperties))check(item,schema.additionalProperties,path+'.'+key,depth+1);
  }
 }else if(type==='array'){
  if(!Array.isArray(value)||value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity))fail(path);
  if(schema.items)value.forEach((item,i)=>check(item,schema.items,path+'['+i+']',depth+1));
 }else if(type==='string'){
  if(typeof value!=='string')fail(path);
  const length=Array.from(value).length;
  if(length<(schema.minLength??0)||length>(schema.maxLength??Infinity))fail(path);
  if(schema.pattern&&!new RegExp(schema.pattern).test(value))fail(path);
 }else if(type==='integer'||type==='number'){
  if(typeof value!=='number'||!Number.isFinite(value)||(type==='integer'&&!Number.isSafeInteger(value))||
   value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity))fail(path);
 }else if(type==='boolean'){
  if(typeof value!=='boolean')fail(path);
 }else if(type==='null'&&value!==null)fail(path);
}
export function validateToolArgs(definition,args){
 if(!definition?.inputSchema)throw Error('tool_schema_unavailable');
 let serialized;
 try{serialized=JSON.stringify(args);}catch{fail('arguments');}
 if(typeof serialized!=='string'||Buffer.byteLength(serialized,'utf8')>131072)fail('arguments');
 check(args,definition.inputSchema,'arguments');
 return args;
}
