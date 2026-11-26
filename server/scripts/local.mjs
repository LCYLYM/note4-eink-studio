// Same business core used by deployment. No Miniflare process in this production path.
import {build} from 'esbuild';
import {safeFetch,modelFetch} from './egress.mjs';
import {createStorage} from './storage.mjs';
import {diagnoseModel} from './model-probe.mjs';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {Readable,Transform} from 'node:stream';
import {createReadStream,openSync,writeFileSync,closeSync,readFileSync,unlinkSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
process.on('unhandledRejection',err=>console.error('NOTE4_UNHANDLED_REJECTION',err));
const host=process.env.HOST||'127.0.0.1';if(!['127.0.0.1','localhost','::1'].includes(host)&&!process.env.BOOTSTRAP_TOKEN)throw Error('Public binding requires BOOTSTRAP_TOKEN');const publicOrigin=process.env.PUBLIC_ORIGIN;if(publicOrigin&&new URL(publicOrigin).protocol!=='https:')throw Error('PUBLIC_ORIGIN must use HTTPS');
const stateDir=path.resolve(process.env.NOTE4_STATE_DIR||'.local/production');await mkdir(stateDir,{recursive:true,mode:0o700});await mkdir('.local',{recursive:true});
const lockFile=path.join(stateDir,'host.lock');let lock;try{lock=openSync(lockFile,'wx',0o600);}catch(error){if(error.code!=='EEXIST')throw error;const pid=Number(readFileSync(lockFile,'utf8'));if(!Number.isSafeInteger(pid)||pid<1)throw Error('Invalid startup lock; confirm the old host exited before removing host.lock');try{process.kill(pid,0);throw Error('State directory already has a running host');}catch(alive){if(alive.code!=='ESRCH')throw alive;}unlinkSync(lockFile);lock=openSync(lockFile,'wx',0o600);}writeFileSync(lock,String(process.pid));closeSync(lock);process.on('exit',()=>{try{if(Number(readFileSync(lockFile,'utf8'))===process.pid)unlinkSync(lockFile);}catch{}});
await build({entryPoints:['src/index.ts'],bundle:true,platform:'node',format:'esm',target:'node24',outfile:path.join(stateDir,'platform.mjs'),external:['./sandbox-pool.mjs'],loader:{'.wasm':'binary'}});
await build({entryPoints:['src/vm-check-worker.ts'],bundle:true,platform:'node',format:'esm',target:'node24',outfile:path.join(stateDir,'vm-check-worker.mjs'),loader:{'.wasm':'binary'}});
await mkdir('../web/vendor',{recursive:true});for(const [from,to] of [['../wasm/note4_vm.wasm','note4_vm.wasm'],['../firmware/main/js_font16.bin','font16.bin'],['../firmware/main/js_fonts_aa.bin','fonts_aa.bin']])await (await import('node:fs/promises')).copyFile(from,'../web/vendor/'+to).catch(()=>{});
await mkdir('../web/vendor',{recursive:true});await build({entryPoints:['node_modules/esptool-js/lib/index.js'],bundle:true,platform:'browser',format:'esm',target:'es2022',outfile:'../web/vendor/esptool.js',minify:true});
const {copyFile}=await import('node:fs/promises');for(const f of ['sandbox-pool.mjs','sandbox-worker.mjs'])await copyFile('src/'+f,path.join(stateDir,f));
const {Platform}=await import(pathToFileURL(path.join(stateDir,'platform.mjs')).href+'?v='+Date.now());
const storage=createStorage(path.join(stateDir,'platform.sqlite'));const {db,ctx,pending}=storage;let platform;
const env={safeFetch,modelFetch,hostMetrics:async()=>{const {poolStats}=await import(pathToFileURL(path.join(stateDir,'sandbox-pool.mjs')).href);return {memory:process.memoryUsage(),cpu:process.cpuUsage(),uptime_s:process.uptime(),sandbox:poolStats()};},DEV_MODE:process.env.NOTE4_LEGACY_DEV==='true'?'true':'false'};for(const key of ['API_TOKEN','DEVICE_TOKENS','MODEL_API_KEY','MODEL_BASE_URL','MODEL_NAME','MODEL_CANDIDATES','MODEL_BACKENDS_JSON','MODEL_THINKING','MODEL_MAX_CONCURRENT','MODEL_ROUTING','MAX_ACCOUNTS','MCP_GRANTS','BOOTSTRAP_TOKEN','APP_SEAL_KEY','SSO_ISSUER','SSO_CLIENT_ID','SSO_KEY_ID','SSO_REDIRECT_URI','SSO_CLIENT_HMAC_SECRET'])if(process.env[key])env[key]=process.env[key];
if(env.APP_SEAL_KEY)env.APP_SEAL_KEY=String(env.APP_SEAL_KEY).trim();
if(!env.APP_SEAL_KEY){const keyFile=path.join(stateDir,'seal.key');try{env.APP_SEAL_KEY=(await readFile(keyFile,'utf8')).trim();}catch{env.APP_SEAL_KEY=randomBytes(32).toString('hex');await writeFile(keyFile,env.APP_SEAL_KEY,{mode:0o600});}}
if(!/^[0-9a-f]{64}$/i.test(env.APP_SEAL_KEY))throw Error('APP_SEAL_KEY must be 64 hex chars');
env.modelProbe=(model,transport)=>{const t=platform?.router.adminTarget(model);return diagnoseModel({base:t?.base||env.MODEL_BASE_URL,key:t?.key||env.MODEL_API_KEY,model,transport});};
platform=new Platform(ctx,env);storage.bind(platform);
const web=path.resolve('../web');
const types={'.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.bin':'application/octet-stream','.wasm':'application/wasm','.n4f':'application/octet-stream','.woff2':'font/woff2'};
let active=0,controls=0,devActive=0,inFlightBodies=0;
const server=createServer(async(req,res)=>{
  const rawUrl=req.url||'/';
  const events=req.method==='GET'&&/\/events(?:\?|$)/.test(rawUrl);
  if(events)res.setTimeout(0);
  try{
    const hostHdr=req.headers.host||'127.0.0.1';
    const url=new URL(rawUrl,publicOrigin||'http://'+hostHdr);
    if(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&!/^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress||'')){res.writeHead(421);return res.end();}
    if(!url.pathname.startsWith('/api/')&&url.pathname!=='/mcp'){
      let decPath;try{decPath=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);}catch{res.writeHead(400);return res.end();}
      if(decPath.split('/').some(seg=>seg.startsWith('.'))){res.writeHead(403);return res.end();}
      const p=path.resolve(web,'.'+decPath);
      if(!p.startsWith(web+'/')){res.writeHead(403);return res.end();}
      const ext=path.extname(p).toLowerCase();
      if(!Object.hasOwn(types,ext)){res.writeHead(404);return res.end();}
      const cache=ext==='.html'?'no-cache':['.png','.bin','.wasm','.n4f','.svg'].includes(ext)?'public, max-age=86400':'public, max-age=3600';
      const bytes=await readFile(p);
      res.writeHead(200,{'Content-Type':types[ext],'X-Content-Type-Options':'nosniff','Cache-Control':cache});
      return res.end(bytes);
    }
    let received=0;
    const limit=(url.pathname==='/api/releases'||url.pathname==='/api/ai-cred/asr')?4*1024*1024:1500000;
    let body;
    if(!['GET','HEAD'].includes(req.method)){
      if(inFlightBodies>=24){res.writeHead(503,{'Content-Type':'application/json','Connection':'close','Retry-After':'1'});return res.end(JSON.stringify({error:'服务繁忙，请稍后重试',code:'HOST_BUSY'}));}
      inFlightBodies++;
      let bodyTimedOut=false;
      const bodyTimer=setTimeout(()=>{bodyTimedOut=true;req.destroy();},15000);
      try{
        const chunks=[];
        for await(const chunk of req){received+=chunk.byteLength;if(received>limit){const e=Error('Request body limit');e.status=413;throw e;}chunks.push(chunk);}
        body=Buffer.concat(chunks);
      }catch(err){
        if(bodyTimedOut){const e=Error('Request body timeout');e.status=408;throw e;}
        throw err;
      }finally{clearTimeout(bodyTimer);inFlightBodies--;}
    }
    const isControl=/\/(?:cancel|pause|stop)(?:\?|$)/.test(rawUrl);
    const isDevice=url.pathname.startsWith('/api/device/');
    if(!events){
      const cur=isControl?controls:isDevice?devActive:active;
      const cap=isControl?4:isDevice?12:8;
      if(cur>=cap){res.writeHead(503,{'Content-Type':'application/json','Connection':'close','Retry-After':'1'});return res.end(JSON.stringify({error:'服务繁忙，请稍后重试',code:'HOST_BUSY'}));}
      if(isControl)controls++;else if(isDevice)devActive++;else active++;
      let released=false;
      const release=()=>{if(!released){released=true;if(isControl)controls--;else if(isDevice)devActive--;else active--;}};
      res.once('close',release);res.once('finish',release);
      if(res.destroyed||res.writableEnded)release();
    }
    const ac=new AbortController();res.once('close',()=>ac.abort());
    const request=new Request(url,{method:req.method,headers:req.headers,signal:ac.signal,...(body?{body,duplex:'half'}:{})});
    if(url.pathname.startsWith('/api/firmware/usb/')){await platform.principal(request);const v2Dir=path.resolve('../artifacts/usb-production-v2.0.0');const directory=existsSync(path.join(v2Dir,'manifest.json'))?v2Dir:path.resolve('../artifacts/usb-production-v1.8.0');if(url.pathname.endsWith('/manifest')){res.writeHead(200,{'Content-Type':'application/json'});return res.end(await readFile(path.join(directory,'manifest.json')));}const name=url.pathname.split('/').at(-1);if(!['app.bin','bootloader.bin','partitions.bin','otadata.bin','works.bin'].includes(name))throw Error('Invalid firmware file');res.writeHead(200,{'Content-Type':'application/octet-stream'});return createReadStream(path.join(directory,name)).pipe(res);}
    const response=await platform.fetch(request);
    if(request.body&&!request.body.locked)request.body.cancel().catch(()=>{});
    const head=Object.fromEntries(response.headers);const cookies=response.headers.getSetCookie();if(cookies.length)head['set-cookie']=cookies;
    res.writeHead(response.status,head);if(events&&res.flushHeaders)res.flushHeaders();
    if(response.body){const reader=response.body.getReader();res.once('close',()=>reader.cancel().catch(()=>{}));try{for(;;){const part=await reader.read();if(part.done)break;if(!res.write(part.value)){const open=await new Promise(resolve=>{const done=value=>{res.removeListener('drain',drain);res.removeListener('close',close);resolve(value);};const drain=()=>done(true),close=()=>done(false);res.once('drain',drain);res.once('close',close);});if(!open)break;}}}finally{res.end();}}else res.end();
  }catch(e){if(res.destroyed||res.writableEnded)return;if(!res.headersSent)res.writeHead(e.status??(e.code==='ENOENT'?404:500),{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.code==='ENOENT'?'Not found':'Request failed'}));}
});
server.requestTimeout=30000;server.headersTimeout=10000;server.maxConnections=128;server.maxRequestsPerSocket=100;
const port=Number(process.env.PORT||8787);await writeFile(path.join(stateDir,'runtime.json'),JSON.stringify({pid:process.pid,port,host}));server.listen(port,host,()=>console.log('NOTE4 production core: http://'+host+':'+port));
for(const signal of ['SIGINT','SIGTERM','SIGUSR2'])process.on(signal,async()=>{for(const c of [...platform.controllers.values(),...platform.hosted.controllers.values()])c.abort();server.closeAllConnections();server.close();const {closeSandboxPool}=await import(pathToFileURL(path.join(stateDir,'sandbox-pool.mjs')).href);await closeSandboxPool();await Promise.allSettled([...pending]);storage.close();process.exit(signal==='SIGUSR2'?75:0);});
