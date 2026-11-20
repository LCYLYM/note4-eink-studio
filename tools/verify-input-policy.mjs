import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {filterInput,canRetry} from '../web/input-policy.js';
import {Preview} from '../web/preview.js';
import {step} from '../web/core.js';
const root=fileURLToPath(new URL('../',import.meta.url)),exe=root+'evidence/input_policy_test';
fs.mkdirSync(root+'evidence',{recursive:true});
execFileSync('c++',['-std=c++17','-I'+root+'firmware/main',root+'firmware/tests/input_policy_test.cpp','-o',exe]);
const rows=execFileSync(exe,{encoding:'utf8'}).trim().split('\n');
const modes=[['ok.short'],['gesture.wave'],['ok.short','gesture.wave']];
for(const row of rows){const [mode,mask,filtered,retry]=row.split(',').map(Number);assert.equal(filterInput(mask,modes[mode]),filtered);assert.equal(+canRetry(mask,modes[mode]),retry);}
globalThis.document={addEventListener(){}};
const context=new Proxy({getImageData(){return {data:new Uint8ClampedArray(480000)};}},{get(t,p){return t[p]??(()=>{});},set(t,p,v){t[p]=v;return true;}});
const canvas={getContext(){return context;}};
for(const [mode,mapping] of modes.entries()){
 const p=new Preview(canvas);p.set({kind:'runner',title:'Test',game:{seed:1,speed:4,jump:18,gravity:3,obstacle_every:400},inputs:{jump:mapping},run_policy:{max_run_seconds:600},gesture_feedback:{enabled:false,x:280,y:8}});
 while(p.state.alive)step(p.state,0,p.config);
 const bad=mode===0?8:mode===1?1:0;if(bad){p.input(bad);assert.equal(p.state.alive,false);}
 p.input(mode===1?8:4);assert(p.state.alive);assert(p.timer);p.pause();
 while(p.state.alive)step(p.state,0,p.config);
 p.input(128);p.input(mode===1?8:1);assert(p.state.paused);assert.equal(p.timer,null);
}
const result={status:'PASS',cross_language_cases:rows.length,modes:['buttons','gestures','both'],checks:['disabled sources ignored for jump and lane','STOP always preserved','retry respects selected source','preview retries after collision','STOP cannot be undone by a gesture or short press']};
fs.writeFileSync(root+'evidence/input-policy.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
