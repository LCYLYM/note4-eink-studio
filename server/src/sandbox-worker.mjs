import {parentPort} from 'node:worker_threads';
import {newQuickJSWASMModuleFromVariant} from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';
const module=await newQuickJSWASMModuleFromVariant(variant);
let active=null;
parentPort.on('message',message=>{
 if(message.type==='run')run(message);
 else if(message.type==='cancel'&&active?.id===message.id)active.cancel();
 else if(message.type==='reply'&&active?.id===message.id)active.reply(message);
});
async function run(q){
 const runtime=module.newRuntime();runtime.setMemoryLimit(16*1024*1024);runtime.setMaxStackSize(256*1024);
 const ctx=runtime.newContext();let closed=false,polls=0,request=0,http=0,ai=0,operations=0,waiting=0,compute=0,pumping=false;
 const pending=new Map(),handles=[],logs=[];const started=performance.now();
 runtime.setInterruptHandler(()=>++polls>500||compute>50);
 const timed=fn=>{const t=performance.now();parentPort.postMessage({type:'busy',id:q.id,at_ns:process.hrtime.bigint().toString()});try{return fn();}finally{const elapsed=performance.now()-t;compute+=elapsed;parentPort.postMessage({type:'idle',id:q.id,elapsed});}};
 const pump=()=>{if(closed)return;const jobs=timed(()=>runtime.executePendingJobs(64));if(jobs.error)jobs.error.dispose();if(runtime.hasPendingJob()&&!pumping){pumping=true;setImmediate(()=>{pumping=false;pump();});}};
 const reject=(deferred,message)=>{const error=ctx.newError(message);deferred.reject(error);error.dispose();};
 active={id:q.id,cancel(){for(const {deferred} of pending.values())reject(deferred,'EXECUTION_CANCELLED');pending.clear();pump();},reply(m){const p=pending.get(m.request);if(!p||closed)return;pending.delete(m.request);waiting+=performance.now()-p.start;if(m.error)reject(p.deferred,m.error);else{const value=ctx.newString(JSON.stringify(m.value??null));p.deferred.resolve(value);value.dispose();}pump();}};
 const callback=ctx.newFunction('__call',(nameHandle,argsHandle)=>{
  try{const name=ctx.getString(nameHandle),args=JSON.parse(ctx.getString(argsHandle));
   if(name==='log'){if(logs.length<20)logs.push(String(args).slice(0,60));return ctx.newString('null');}
   if(!['http','aiJSON','stateGet','statePut'].includes(name))throw Error('CAPABILITY_DENIED');
   if(++operations>32||name==='http'&&++http>3||name==='aiJSON'&&++ai>1)throw Error('CALL_BUDGET');
   const deferred=ctx.newPromise();handles.push(deferred);const n=++request;pending.set(n,{deferred,start:performance.now()});parentPort.postMessage({type:'call',id:q.id,request:n,method:name,args});return deferred.handle;
  }catch(e){return {error:ctx.newError(String(e.message))};}
 });ctx.setProp(ctx.global,'__call',callback);callback.dispose();
 let promise;
 try{
  const wrapper=`(async()=>{const call=async(n,a)=>JSON.parse(await __call(n,JSON.stringify(a??null)));const rt=Object.freeze({http:a=>call('http',a),aiJSON:a=>call('aiJSON',a),state:Object.freeze({get:()=>call('stateGet'),put:a=>call('statePut',a)}),log:a=>__call('log',JSON.stringify(a))});const input=${JSON.stringify(q.input)};return await (async function(rt,input){'use strict';\n${q.source}\n})(rt,input);})()`;
  const result=timed(()=>ctx.evalCode(wrapper,'service.js'));
  if(result.error){const error=timed(()=>ctx.dump(result.error));result.error.dispose();throw Error(error.message);}
  promise=result.value;const ready=ctx.resolvePromise(promise);pump();const result2=await ready;
  if(result2.error){const error=timed(()=>ctx.dump(result2.error));result2.error.dispose();throw Error(error.message);}
  const value=timed(()=>ctx.dump(result2.value));result2.value.dispose();
  if(pending.size)throw Error('AWAIT_REQUIRED: await every rt SDK call');
  if(!value||typeof value!=='object'||Array.isArray(value)||!('body'in value))throw Error('RESULT_CONTRACT');
  const output=timed(()=>JSON.stringify(value));if(Buffer.byteLength(output)>32768)throw Error('OUTPUT_BYTES');
  const status=value.status??200;if(!Number.isInteger(status)||status<200||status>599)throw Error('RESULT_STATUS');
  parentPort.postMessage({type:'result',id:q.id,value:{status,body:value.body,logs,metrics:{wall_ms:performance.now()-started,compute_ms:compute,waiting_ms:waiting,interrupt_polls:polls,http_calls:http,ai_calls:ai}}});
 }catch(e){parentPort.postMessage({type:'error',id:q.id,error:String(e.message).slice(0,500)});}
 finally{closed=true;if(promise?.alive)promise.dispose();for(const d of handles)d.dispose();ctx.dispose();runtime.dispose();active=null;}
}
