import wasm from '../../wasm/note4_vm.wasm';
import {Note4Vm} from '../../web/vm.js';
import {fontData} from './font';
// wasm takes about 8 ms on the benchmark the device runs in 292 ms.
export const DEVICE_SLOWDOWN=36;
const DEVICE_LIMIT_MS=800,TICK_LIMIT=300;
let vm:Promise<Note4Vm>|undefined;
const load=()=>vm??=Note4Vm.create(wasm as any,Uint8Array.from(atob(fontData),c=>c.charCodeAt(0)),TICK_LIMIT);
// Coarse layout sketch so the agent can notice blank or misplaced screens.
function sketch(px:Uint8Array){const rows:string[]=[];for(let y=0;y<300;y+=16){let row='';for(let x=0;x<400;x+=8){let dark=0;for(let a=y;a<y+16&&a<300;a++)for(let b=x;b<x+8;b++)if(px[a*400+b]<8)dark++;row+=dark>24?'#':dark>0?'.':' ';}rows.push(row.trimEnd());}return rows.join('\n');}
const fail=(where:string,log:string)=>{throw Error(`JS ${where} failed on the device engine: ${log.trim().slice(0,600)}`);};
export async function checkJs(spec:any){
 const v=await load(),keys=['ok','up','down','ok','down','up',...(spec.js.wave?['wave']:[])];
 let slowest=0;const timed=(fn:()=>number,where:string)=>{v.clearLog();const t=performance.now(),r=fn(),ms=(performance.now()-t)*DEVICE_SLOWDOWN;slowest=Math.max(slowest,ms);if(r!==0)fail(where,v.log());if(ms>DEVICE_LIMIT_MS)throw Error(`${where} would take about ${Math.round(ms)} ms on the device; handlers must stay under ${DEVICE_LIMIT_MS} ms`);};
 timed(()=>v.start(spec.js.source,{},false,spec.js.asset?64:spec.js.photos?.length??0),'on_start');
 if(!v.dirty())throw Error('on_start must draw the first screen and call ui.present()');
 const first=sketch(v.pixels(false));if(!/[#.]/.test(first))throw Error('The first screen is blank');
 const responses:string[]=[];
 for(const k of keys){timed(()=>v.key(k),`on_key('${k}')`);responses.push(`${k}:${v.dirty()?'redraw':'no redraw'}`);}
 if(!responses.some(r=>r.endsWith(':redraw')))throw Error('No key changes the screen; every app must respond to the three keys');
 let dropped=0;for(const q of v.netQueue.splice(0)){timed(()=>v.net(q.key,0,''),`on_net('${q.key}',0)`);dropped++;}
 const off=v.oob();if(off.count)throw Error(`The app draws outside the 400x300 screen (for example near x=${off.x}, y=${off.y}, ${off.count} off-screen pixels). Recompute the layout: glyph height is 16*scale, line step 22*scale, and every element must fit inside x 0..399 and y 0..299.`);
 const store=v.store();
 return {engine:'device-mquickjs-wasm',slowest_handler_ms_estimate:Math.round(slowest),keys:responses,net_requests_tested_offline:dropped,store_keys:Object.keys(store).length,store_bytes:Object.values(store).reduce((n,s)=>n+new TextEncoder().encode(s).length,0),first_screen_sketch:first,last_screen_sketch:sketch(v.pixels(false)),hardware:'UNVERIFIED'};
}
