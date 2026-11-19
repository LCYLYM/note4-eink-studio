// Runs every agent template on the device engine (WASM). Optional argv[2]: write a PNG contact sheet there.
import fs from 'node:fs';import zlib from 'node:zlib';
import {Note4Vm} from '../web/vm.js';
import {JS_TEMPLATES} from '../server/src/js-templates.ts';
const dir=decodeURIComponent(new URL('..',import.meta.url).pathname);
const vm=await Note4Vm.create(fs.readFileSync(dir+'wasm/note4_vm.wasm'),new Uint8Array(fs.readFileSync(dir+'web/vendor/font16.bin')),300);
const scripts={list:['ok','down','ok','down','down','down','ok','ok','down','up'],flashcards:['ok','ok','down','ok','up','ok','down','ok','down','ok','down','ok','down','ok','down','ok','down'],grid:['up','down','ok','up','down','up','down','up'],logger:['ok','down','down','ok','ok','up','down','ok','ok','up','ok']};
const shots=[];
const png=(W,H,gray)=>{const raw=Buffer.alloc((W+1)*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++)raw[y*(W+1)+1+x]=gray(x,y);const crcT=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});const crc=b=>{let c=~0;for(const v of b)c=crcT[(c^v)&255]^(c>>>8);return ~c>>>0;};const chunk=(t,d)=>{const h=Buffer.alloc(4);h.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const e=Buffer.alloc(4);e.writeUInt32BE(crc(b));return Buffer.concat([h,b,e]);};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);};
const reveal=fs.readFileSync(dir+'web/assets/ink-reveal.n4f');
vm.onFrame=(i,to)=>{for(let n=0;n<30000;n++){const b=reveal[(i+20)*30000+n];to[n*2]=((b>>6)*5)<<4|((b>>4&3)*5);to[n*2+1]=((b>>2&3)*5)<<4|((b&3)*5);}};
fs.mkdirSync(dir+'web/thumbs',{recursive:true});
const walk=['wave','down','ok','up','wave','ok','wave','down','up','ok'];
for(const [id,t] of Object.entries(JS_TEMPLATES)){
 if(t.source.length>64*1024)throw Error(id+' too big');
 const fail=w=>{throw Error(`${id} ${w}: ${vm.log()}`);};
 if(vm.start(t.source,{},(t.refresh??'fast')==='fast',t.asset?64:0)!==0)fail('start');
 if(!vm.dirty())fail('no first draw');
 for(let round=0;round<3&&vm.netQueue.length;round++)for(const q of vm.netQueue.splice(0)){let st=0,b='';try{const r=await fetch(q.url,{method:q.method,headers:Object.fromEntries(q.headers.split('\n').filter(Boolean).map(l=>l.split(/:\s*/,2))),signal:AbortSignal.timeout(10000)});st=r.status;b=await r.text();if(Buffer.byteLength(b)>131072){st=-1;b='';}}catch(e){}console.log('  net',q.key,st,b.length,q.url.slice(0,70));if(vm.net(q.key,st,b)!==0)fail('on_net '+q.key);}
 vm.dirty();const first=vm.pixels(false).slice();shots.push(first);
 if(t.cat&&id!=='photo')fs.writeFileSync(dir+'web/thumbs/'+id+'.png',png(400,300,(x,y)=>first[y*400+x]*17));
 (scripts[id]??walk).forEach((k,i)=>{if(vm.key(k)!==0)fail('key '+k);vm.dirty();if(!t.cat&&(i===1||i===scripts[id].length-1))shots.push(vm.pixels(false).slice());});
 for(const q of vm.netQueue.splice(0))if(vm.net(q.key,0,'')!==0)fail('on_net offline '+q.key);
 if(vm.tickMs()>=1000&&vm.tick()!==0)fail('tick');vm.netQueue.length=0;
 const off=vm.oob();if(off.count)throw Error(`${id} off screen near ${off.x},${off.y}`);
 console.log('ok',id,t.source.length,'bytes',Object.keys(vm.store()));
}
if(process.argv[2]){
 const cols=3,gap=8,rows=Math.ceil(shots.length/cols),W=cols*400+(cols+1)*gap,H=rows*300+(rows+1)*gap,raw=Buffer.alloc((W+1)*H,120);
 for(let y=0;y<H;y++)raw[y*(W+1)]=0;
 shots.forEach((p,i)=>{const ox=gap+(i%cols)*(400+gap),oy=gap+Math.floor(i/cols)*(300+gap);for(let y=0;y<300;y++)for(let x=0;x<400;x++)raw[(oy+y)*(W+1)+1+ox+x]=p[y*400+x]*17;});
 const crcT=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});const crc=b=>{let c=~0;for(const v of b)c=crcT[(c^v)&255]^(c>>>8);return ~c>>>0;};
 const chunk=(t,d)=>{const h=Buffer.alloc(4);h.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const e=Buffer.alloc(4);e.writeUInt32BE(crc(b));return Buffer.concat([h,b,e]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;
 fs.writeFileSync(process.argv[2],Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
