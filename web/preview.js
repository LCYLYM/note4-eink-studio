import {readerStep,quizStep} from './interactive.js';
import {gestureIcons} from './gesture-icons.js';
import {filterInput,canRetry} from './input-policy.js';
import {characters} from './characters.js';
import {defaults,initial,step,cardStep,TICK_MS} from './core.js';
export class Preview{
 constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d',{willReadFrequently:true});this.spec=null;this.state=initial();this.timer=null;this.pending=0;this.frames=[];this.gestureLabel="SIM:IDLE";this.gestureUntil=0;document.addEventListener('visibilitychange',()=>{if(document.hidden)this.pause();});}
 set(spec){this.pause();this.spec=spec;this.config={...defaults,...spec?.game};this.state=initial(this.config);this.frames=[];this.pageCache=new Map();this.pageCount=0;this.draw();}
 setPacked(pages){this.frames=pages.map(b64=>{const raw=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));if(raw.length!==60000)throw Error('16 灰页面必须为 60000 字节');const im=this.ctx.createImageData(400,300);for(let i=0;i<120000;i++){let v=((i%2?raw[i>>1]&15:raw[i>>1]>>4))*17;im.data.set([v,v,v,255],i*4);}return im;});this.draw();}
 setInteractivePage(index,b64,count){const raw=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));if(raw.length!==60000)throw Error('Invalid preview page');const im=this.ctx.createImageData(400,300);for(let i=0;i<120000;i++){const v=((i%2?raw[i>>1]&15:raw[i>>1]>>4))*17;im.data.set([v,v,v,255],i*4);}this.pageCount=count;this.pageCache.set(index,im);if(this.pageCache.size>8)this.pageCache.delete(this.pageCache.keys().next().value);this.draw();}
 start(){this.pause();this.state=initial(this.config);this.pending=0;if(this.spec.kind==='runner')this.timer=setInterval(()=>{step(this.state,this.state.tick>=this.spec.run_policy.max_run_seconds*20?128:this.pending,this.config);this.pending=0;this.draw();if(!this.state.alive||this.state.paused)this.pause();},TICK_MS);this.draw();}
 pause(){clearInterval(this.timer);this.timer=null;}
 input(mask){
  if(!this.spec)return;
  if(this.spec.kind==='runner'){
   mask=filterInput(mask,this.spec.inputs?.jump);
   if(mask&56){this.gestureLabel=mask&8?'SIM:WAVE':mask&16?'SIM:NEAR':'SIM:AWAY';this.gestureUntil=Date.now()+450;}
  }
  if(['reader','quiz'].includes(this.spec.kind)){if(mask&128){this.state.paused=true;this.draw();return;}if(this.spec.kind==='reader')readerStep(this.state,mask,this.pageCount||1);else quizStep(this.state,mask,this.spec.quiz.questions);this.draw();this.onPage?.(this.state.page);return;}
  if(this.spec.kind==='cards'){cardStep(this.state,mask,this.spec.pages.length);this.draw();}
  else if(mask&128){step(this.state,mask,this.config);this.pause();this.draw();}
  else if(!this.state.alive&&!this.state.paused&&canRetry(mask,this.spec.inputs?.jump))this.start();
  else if(this.timer)this.pending|=mask;
 }

 draw(){const c=this.ctx,s=this.state;c.fillStyle='#fff';c.fillRect(0,0,400,300);if(!this.spec){c.fillStyle='#555';c.font='16px sans-serif';c.fillText('新建一份作品，开始创作',90,150);return;}if(['reader','quiz'].includes(this.spec.kind)){const im=this.pageCache?.get(s.page);if(im)c.putImageData(im,0,0);else{c.fillStyle='#555';c.font='16px sans-serif';c.fillText('加载当前页…',140,150);}if(this.spec.kind==='quiz'){c.fillStyle='#000';c.font='14px monospace';c.fillText(`Score ${s.score}/${this.spec.quiz.questions.length}`,24,287);if(s.page<this.spec.quiz.questions.length*3&&s.page%3===0)c.fillText(`Choice ${s.choice+1}`,280,287);}return;}if(this.spec.kind==='cards'){if(this.frames.length){c.putImageData(this.frames[s.page%this.frames.length],0,0);return;}c.fillStyle='#555';c.font='16px sans-serif';c.fillText('请构建以预览实际 16 灰资源',70,150);return;}
 c.fillStyle='#aaa';for(let i=0;i<3;i++){c.fillRect(0,100+i*65,400,2);}c.fillStyle='#555';c.font='bold 17px sans-serif';c.fillText(this.spec.title,20,29);c.font='12px monospace';c.fillText(`SCORE ${s.score}   TICK ${s.tick}`,20,49);
 const y=99+s.lane*65-s.y;c.fillStyle='#aaa';c.fillRect(34,99+s.lane*65,28,4);const rows=characters.characters[this.spec.game?.character||'fox'];for(let yy=0;yy<24;yy++)for(let xx=0;xx<16;xx++){const n=rows[yy][xx];if(n!=='0'){c.fillStyle=characters.palette[n];c.fillRect(40+xx,y-23+yy,1,1);}}c.fillStyle='#555';c.fillRect(s.obstacleX,76+s.obstacleLane*65,18,24);c.fillStyle='#000';c.fillRect(s.obstacleX+4,76+s.obstacleLane*65,10,5);c.font='12px sans-serif';c.fillText('● / 挥动 跳跃   ▲ ▼ 换道',20,283);
 if(this.spec.gesture_feedback?.enabled!==false){const hud=this.spec.gesture_feedback??{x:280,y:8};const label=this.spec.inputs?.jump?.includes('gesture.wave')?(Date.now()<this.gestureUntil?this.gestureLabel:'SIM:IDLE'):'SIM:OFF';if(hud.style==='text'){c.font='11px monospace';c.fillText(label,hud.x,hud.y+12);}else{let name=label.split(':')[1].toLowerCase();if(hud.icon_set==='arrows'&&name==='wave')name='near';const rows=gestureIcons[name]||gestureIcons.idle;c.fillStyle='#000';for(let y=0;y<16;y++)for(let x=0;x<16;x++)if(rows[y][x]==='1')c.fillRect(hud.x+x,hud.y+y,1,1)};}
 if(!s.alive||s.paused){c.fillStyle='#fff';c.fillRect(93,119,218,51);c.strokeStyle='#000';c.strokeRect(93,119,218,51);c.fillStyle='#000';c.font='16px sans-serif';c.fillText(!s.alive?'失败 · 按所选输入重来':'预览已停止',119,150);}
 const im=c.getImageData(0,0,400,300);for(let i=0;i<im.data.length;i+=4){const v=Math.round(im.data[i]/85)*85;im.data[i]=im.data[i+1]=im.data[i+2]=v;}c.putImageData(im,0,0);
 }
}
// Native 400×300 4bpp compiler contract: left pixel high nibble, 0 black / 15 white.
export function packRGBA(data){if(data.length!==480000)throw Error('需要 400×300 RGBA');const out=new Uint8Array(60000);for(let i=0;i<120000;i++){const a=data[i*4+3]/255;const gray=Math.round((a*(.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2])+(1-a)*255)/17);out[i>>1]|=gray<<(i%2?0:4);}return out;}
export async function normalizeImage(file){if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('请选择 PNG / JPEG / WebP 图片');if(file.size>8*1024*1024)throw Error('图片需小于 8 MB');const img=await createImageBitmap(file);const c=document.createElement('canvas');c.width=400;c.height=300;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,400,300);const scale=Math.min(400/img.width,300/img.height);x.drawImage(img,(400-img.width*scale)/2,(300-img.height*scale)/2,img.width*scale,img.height*scale);img.close();return c.toDataURL('image/png');}
