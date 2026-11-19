#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),url=new URL(process.env.NOTE4_URL||'http://127.0.0.1:8787'),token=process.env.NOTE4_ADMIN_TOKEN;
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&(!token||url.protocol!=='https:'))throw Error('Remote publication requires explicit HTTPS NOTE4_URL and NOTE4_ADMIN_TOKEN');
const file=path.resolve(process.argv[2]||path.join(root,'artifacts/production-v1.1.3/note4_joint.bin')),metadata=JSON.parse(fs.readFileSync(process.argv[3]||path.join(root,'artifacts/production-v1.1.3/ota-release.json'),'utf8'));
const form=new FormData();form.set('metadata',JSON.stringify({version:metadata.version,model:metadata.model,layout:metadata.layout,abi:metadata.abi,byte_length:metadata.byte_length,sha256:metadata.sha256}));form.set('image',new File([fs.readFileSync(file)],path.basename(file)));
const r=await fetch(new URL('/api/releases',url),{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:form});const result=await r.json();if(!r.ok)throw Error('Release rejected: '+JSON.stringify(result));console.log(JSON.stringify({release_id:result.release_id,version:result.version,url:result.url,byte_length:result.byte_length},null,2));
