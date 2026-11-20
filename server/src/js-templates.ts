/** Worked ES5 apps the agent starts from. Each one runs on the device engine (tools/verify-templates.mjs). */
const KIT=`var W=400,M=14,RELAY=typeof N4_RELAY==='string'?N4_RELAY:'',KEY=typeof SECRET==='string'?SECRET:RELAY,OFF=false;
function clock(){var ms=Date.now(),t=Math.floor(ms/1000)+28800,day=Math.floor(t/86400),s=t-day*86400,z=day+719468,e=Math.floor(z/146097),o=z-e*146097,y=Math.floor((o-Math.floor(o/1460)+Math.floor(o/36524)-Math.floor(o/146096))/365),n=o-(365*y+Math.floor(y/4)-Math.floor(y/100)),p=Math.floor((5*n+2)/153),m=p<10?p+3:p-9;return {ok:ms>1600000000000,y:y+e*400+(m<=2?1:0),m:m,d:n-Math.floor((153*p+2)/5)+1,h:Math.floor(s/3600),mi:Math.floor(s/60)%60,w:(day+4)%7,day:day};}
function mdays(y,m){return m===2?((y%4===0&&y%100!==0)||y%400===0?29:28):(m===4||m===6||m===9||m===11?30:31);}
function pad(n){return (n<10?'0':'')+n;}
function hm(){var c=clock();return c.ok?pad(c.h)+':'+pad(c.mi):'';}
function stamp(at){return OFF?(at?'离线 '+at:'未联网'):(at?'更新 '+at:'等待联网');}
function parse(st,b){if(st<200||st>=300)return null;try{return JSON.parse(b);}catch(e){return null;}}
function cached(k,v){try{store.set(k,JSON.stringify(v));}catch(e){}}
function need(t,a,b){page(t,'待配置','确认重试','重试');ui.text(M,70,a,2,0,W-2*M);ui.rect(M,132,60,2,0);ui.text(M,150,b,1,0,W-2*M);ui.present();}
var HASAA=typeof ui.font==='function'&&typeof ui.measure==='function';
function tw(s,sc){if(HASAA)return ui.measure(String(s),sc||1);var n=0,i;for(i=0;i<s.length;i++)n+=s.charCodeAt(i)<128?9:16;return n*(sc||1);}
function clip(s,px){s=String(s);if(tw(s)<=px)return s;var e=tw('..');while(s.length&&tw(s)+e>px)s=s.slice(0,-1);return s+'..';}
function center(y,s,sc,g){ui.text(Math.floor((W-tw(s,sc))/2),y,s,sc||1,g===undefined?0:g);}
function right(x,y,s,g){ui.text(x-tw(s),y,s,1,g===undefined?0:g);}
function frame(title,info,hint){if(HASAA)ui.font('pixel');ui.clear(15);ui.text(M,8,clip(title,250),1,0);if(info)right(W-M,8,info,5);ui.rect(M,32,W-2*M,2,0);ui.rect(M,266,W-2*M,1,10);ui.text(M,274,clip(hint,W-2*M),1,5);}
function row(y,h,text,sel,info){if(sel)ui.rect(M,y,W-2*M,h,0);var t=y+Math.floor((h-16)/2),room=W-2*M-20-(info?tw(info)+12:0);ui.text(M+10,t,clip(text,room),1,sel?15:0);if(info)right(W-M-10,t,info,sel?15:5);}
function bar(x,y,w,h,v,max){ui.rect(x,y,w,h,10);var f=max>0?Math.min(w,Math.floor(w*v/max)):0;if(f>0)ui.rect(x,y,f,h,0);}
function hand(x,y,g){ui.rect(x+3,y+6,8,7,g);ui.rect(x+3,y+1,2,5,g);ui.rect(x+6,y,2,6,g);ui.rect(x+9,y+2,2,4,g);ui.rect(x,y+6,3,2,g);}
function page(title,info,hint,wv){if(HASAA)ui.font('pixel');ui.clear(15);ui.rect(M,10,5,15,0);ui.text(M+12,8,clip(title,210),1,0);if(info)right(W-M,8,info,0);ui.rect(M,32,W-2*M,2,0);ui.rect(M,266,W-2*M,1,0);var r=W-2*M;if(wv){var k=tw(wv);right(W-M,274,wv,0);hand(W-M-k-19,275,0);r-=k+30;}ui.text(M,274,clip(hint,r),1,0);}
function box(x,y,w,h,g){ui.rect(x,y,w,1,g);ui.rect(x,y+h-1,w,1,g);ui.rect(x,y,1,h,g);ui.rect(x+w-1,y,1,h,g);}
function cx(x,w,y,s,sc,g){ui.text(x+Math.floor((w-tw(s,sc))/2),y,s,sc||1,g===undefined?0:g);}
function tile(x,y,w,h,l,v,on){if(on)ui.rect(x,y,w,h,0);else box(x,y,w,h,0);var c=on?15:0;cx(x,w,y+5,l,1,c);cx(x,w,y+24,v,1,c);}
function fx(v,d){var m=Math.pow(10,d),n=Math.round(Math.abs(v)*m),s=String(Math.floor(n/m));if(d){var f=String(n%m);while(f.length<d)f='0'+f;s+='.'+f;}return (v<0?'-':'')+s;}
function load(k,d){var v=store.get(k);if(v===null)return d;try{return JSON.parse(v);}catch(e){return d;}}
function save(k,v){store.set(k,JSON.stringify(v));}
`;
const list=`var S=load('state',{day:1,items:[{name:'晨跑 20 分钟',done:false,total:0},{name:'读书 30 页',done:false,total:0},{name:'喝八杯水',done:false,total:0}]});
var cur=0,top=0,view='list',ROWS=6;
function count(){var n=0,i;for(i=0;i<S.items.length;i++)if(S.items[i].done)n++;return n;}
function draw(){
 var i,y,n=S.items.length+1;
 if(view==='list'){
  frame('今日打卡','第 '+S.day+' 天  '+count()+'/'+S.items.length,'上下选择  确认打勾');
  if(cur<top)top=cur;if(cur>=top+ROWS)top=cur-ROWS+1;
  for(i=top;i<n&&i<top+ROWS;i++){y=40+(i-top)*37;
   if(i<S.items.length)row(y,35,(S.items[i].done?'[x] ':'[ ] ')+S.items[i].name,i===cur,'累计 '+S.items[i].total);
   else row(y,35,'开始新的一天',i===cur);}
 }else{
  frame('新的一天','','确认开始  上下取消');
  center(110,'今天的勾选会清空',1,0);center(140,'累计次数保留',1,5);
 }
 ui.present();
}
function on_start(){draw();}
function on_key(k){var n=S.items.length+1;
 if(view==='confirm'){if(k==='ok'){var i;for(i=0;i<S.items.length;i++)S.items[i].done=false;S.day++;save('state',S);}view='list';cur=0;top=0;draw();return;}
 if(k==='up')cur=(cur+n-1)%n;
 else if(k==='down')cur=(cur+1)%n;
 else if(k==='ok'){if(cur===n-1)view='confirm';else{var it=S.items[cur];it.done=!it.done;it.total+=it.done?1:-1;save('state',S);}}
 else return;
 draw();}`;
const flashcards=`var DECK=[['abandon','放弃'],['benefit','好处，利益'],['capture','捕获，夺取'],['derive','获得，起源于'],['efficient','高效的'],['flexible','灵活的']];
var S=load('state',{box:{},seen:0,right:0}),queue=[],pos=0,view='home',back=false;
function boxOf(i){return S.box[i]||0;}
function mastered(){var n=0,i;for(i=0;i<DECK.length;i++)if(boxOf(i)>=3)n++;return n;}
function build(){queue=[];var b,i;for(b=0;b<3;b++)for(i=0;i<DECK.length;i++)if(boxOf(i)===b&&queue.length<10)queue.push(i);pos=0;back=false;}
function draw(){
 if(view==='home'){
  frame('背单词','已掌握 '+mastered()+'/'+DECK.length,'确认开始');
  center(70,String(queue.length),4,0);center(164,'本轮待复习',1,5);
  bar(60,210,280,10,mastered(),DECK.length);
 }else if(view==='card'){
  var c=DECK[queue[pos]];
  frame('背单词',(pos+1)+'/'+queue.length,back?'上 不认识  下 认识':'确认 看释义');
  center(84,c[0],2,0);
  if(back)center(160,c[1],1,0);else center(160,'想一想',1,10);
 }else{
  frame('本轮结束','','确认再来一轮');
  center(90,'认识 '+S.right+' / 共 '+S.seen,2,0);
  center(160,'不认识的会优先复习',1,5);
 }
 ui.present();
}
function answer(ok){var i=queue[pos];S.box[i]=ok?Math.min(3,boxOf(i)+1):0;S.seen++;if(ok)S.right++;save('state',S);pos++;back=false;if(pos>=queue.length)view='done';draw();}
function on_start(){build();draw();}
function on_key(k){
 if(view==='card'){if(!back){if(k==='ok'){back=true;draw();}return;}if(k==='up')answer(false);else if(k==='down')answer(true);return;}
 if(k==='ok'){if(view==='done'){S.seen=0;S.right=0;save('state',S);}build();view=queue.length?'card':'home';draw();}}`;
const grid=`var N=4,CELL=54,GAP=2,X=14,Y=40;
var S=load('state',null),horiz=true,over=false;
function spawn(){var e=[],r,c;for(r=0;r<N;r++)for(c=0;c<N;c++)if(!S.g[r][c])e.push([r,c]);if(!e.length)return;var p=e[Math.floor(Math.random()*e.length)];S.g[p[0]][p[1]]=Math.random()<.9?2:4;}
function fresh(){S={g:[],score:0};var r;for(r=0;r<N;r++)S.g.push([0,0,0,0]);spawn();spawn();over=false;save('state',S);}
function line(v){var o=[],i;for(i=0;i<N;i++)if(v[i])o.push(v[i]);for(i=0;i<o.length-1;i++)if(o[i]===o[i+1]){o[i]*=2;S.score+=o[i];o.splice(i+1,1);}while(o.length<N)o.push(0);return o;}
function move(d){var moved=false,i,j,v,o;for(i=0;i<N;i++){v=[];for(j=0;j<N;j++)v.push(d==='l'?S.g[i][j]:d==='r'?S.g[i][N-1-j]:d==='u'?S.g[j][i]:S.g[N-1-j][i]);o=line(v);for(j=0;j<N;j++){if(o[j]!==v[j])moved=true;if(d==='l')S.g[i][j]=o[j];else if(d==='r')S.g[i][N-1-j]=o[j];else if(d==='u')S.g[j][i]=o[j];else S.g[N-1-j][i]=o[j];}}return moved;}
function canMove(){var r,c;for(r=0;r<N;r++)for(c=0;c<N;c++){if(!S.g[r][c])return true;if(c<N-1&&S.g[r][c]===S.g[r][c+1])return true;if(r<N-1&&S.g[r][c]===S.g[r+1][c])return true;}return false;}
function draw(){
 frame('2048','','');
 var r,c,v,x,y,s,sc;
 for(r=0;r<N;r++)for(c=0;c<N;c++){v=S.g[r][c];x=X+c*(CELL+GAP);y=Y+r*(CELL+GAP);ui.rect(x,y,CELL,CELL,v>=64?0:v?10:14);if(v){s=String(v);sc=s.length<3?2:1;ui.text(x+Math.floor((CELL-tw(s,sc))/2),y+Math.floor((CELL-16*sc)/2),s,sc,v>=64?15:0);}}
 var px=X+N*(CELL+GAP)+12;
 ui.text(px,44,'得分',1,5);ui.text(px,68,String(S.score),2,0,W-px-M);
 ui.text(px,130,horiz?'左右模式':'上下模式',1,0);
 ui.text(px,160,horiz?'上键=左':'上键=上',1,5);ui.text(px,184,horiz?'下键=右':'下键=下',1,5);ui.text(px,208,'确认=换向',1,5);
 if(over){ui.rect(90,110,220,70,15);ui.rect(90,110,220,2,0);ui.rect(90,178,220,2,0);center(124,'没有可走的了',1,0);center(150,'确认重开',1,5);}
 ui.present();
}
function on_start(){if(!S)fresh();over=!canMove();draw();}
function on_key(k){
 if(over){if(k==='ok'){fresh();draw();}return;}
 if(k==='ok'){horiz=!horiz;draw();return;}
 if(k!=='up'&&k!=='down')return;
 var d=horiz?(k==='up'?'l':'r'):(k==='up'?'u':'d');
 if(move(d)){spawn();over=!canMove();save('state',S);}
 draw();}`;
const logger=`var UNIT='页',STEP=5,TITLE='读书记录';
var S=load('state',{log:[],now:20}),view='home',cur=0;
function total(){var n=0,i;for(i=0;i<S.log.length;i++)n+=S.log[i];return n;}
function draw(){
 if(view==='home'){
  frame(TITLE,'累计 '+total()+' '+UNIT,'上下选择  确认进入');
  var i,max=1,days=S.log.slice(-7);for(i=0;i<days.length;i++)if(days[i]>max)max=days[i];
  for(i=0;i<days.length;i++){var h=Math.floor(days[i]*96/max),x=30+i*50;ui.rect(x,144-h,30,h,0);var s=String(days[i]);ui.text(x+15-Math.floor(tw(s)/2),150,s,1,5);}
  if(!days.length)center(90,'还没有记录',1,10);
  row(180,36,'记一笔',cur===0);row(222,36,'撤销上一笔',cur===1,S.log.length?(S.log[S.log.length-1]+' '+UNIT):'');
 }else{
  frame('记一笔','','上 减少  下 增加  确认保存');
  center(86,S.now+' '+UNIT,4,0);center(190,'每按一下 '+STEP+' '+UNIT,1,5);
 }
 ui.present();
}
function on_start(){draw();}
function on_key(k){
 if(view==='home'){
  if(k==='up'||k==='down')cur=1-cur;
  else if(k==='ok'){if(cur===0)view='add';else if(S.log.length){S.log.pop();save('state',S);}}
  else return;
 }else{
  if(k==='up')S.now=Math.max(STEP,S.now-STEP);
  else if(k==='down')S.now=Math.min(995,S.now+STEP);
  else if(k==='ok'){S.log.push(S.now);if(S.log.length>60)S.log.shift();save('state',S);view='home';}
  else return;
 }
 draw();}`;
import {GALLERY} from './gallery.ts';
export type SecretGuide={what:string,where:string,placeholder:string,example?:string};
export type Template={id?:string,cat?:string,title:string,use:string,source:string,refresh?:string,conn_mode?:'local'|'public'|'relay'|'apikey'|'url',wave_act?:string,secret?:string,secret_guide?:SecretGuide,photos?:boolean,asset?:string,frames?:number,frame_bytes?:number,seconds?:number};
export const JS_TEMPLATES:Record<string,Template>={
 list:{title:'清单和打卡',use:'清单、待办、打卡、菜单类多条目应用',source:KIT+list,conn_mode:'local'},
 flashcards:{title:'背诵卡片',use:'背单词、背公式、闪卡、任何先想再看答案的记忆应用',source:KIT+flashcards,conn_mode:'local'},
 grid:{title:'棋盘游戏',use:'2048、棋类、扫雷、推箱子、贪吃蛇等格子游戏；展示三键如何操作四个方向',source:KIT+grid,conn_mode:'local'},
 logger:{title:'记录和统计',use:'记账、读书量、喝水、体重等输入数字并看趋势的应用',source:KIT+logger,conn_mode:'local'},
 ...Object.fromEntries(GALLERY.map(({code,...t})=>[t.id,{...t,source:(t.title?`var TITLE=${JSON.stringify(t.title)};\n`:'')+KIT+code}])),
};
export const galleryIndex=()=>GALLERY.map(({code,...t})=>t);
export function pickTemplate(text:string){const t=String(text);if(/中转|电脑|推送|内网|便签|消息|遥控|脚本|监控|状态/.test(t))return 'relay_board';if(/番茄|专注|倒计时|种树/.test(t))return 'pomodoro';if(/木鱼|功德|解压/.test(t))return 'muyu';if(/单词|闪卡|背诵|记忆|词汇|公式|古诗/.test(t))return 'flashcards';if(/2048|棋|格子|数独|扫雷|贪吃蛇|迷宫|推箱子|地牢|游戏/.test(t))return 'grid';if(/记账|记录|统计|读书|页数|体重|喝水|次数|花费|趋势/.test(t))return 'logger';return 'list';}
export const JS_DESIGN=`界面规范（必须遵守）：本应用只有黑白灰、没有触屏，好看靠结构和留白。1. 每个界面都用 frame(标题, 右上状态, 底部按键提示) 或 page(标题, 状态, 按键提示, 挥手动作)，内容只放在 y 40 到 262 之间；底部提示写清当前三个键分别做什么，界面变化时提示也要变。2. 列表用 row，选中项是黑底白字，超过一屏要滚动并保持选中项可见；不要用箭头符号或 Emoji，字库只有 ASCII 和标准中文字符及中文标点，其他符号显示为空白。3. 一个界面只有一个重点，主数字或主内容用 scale 2 到 4 居中，其余用 scale 1；默认快刷只驱动纯黑纯白：文字永远是实心黑或白（灰度小于 11 按黑显示），分层靠字号、线条和反白，不靠文字灰度；灰色只用于较大的色块，会显示成点阵，5 偏深、10 偏浅，分隔线用 0；色块上的文字，5 上用 15，10 上用 0；真实灰阶用 js.refresh 的 gray、tuned、flash（4 级）或 clear（16 级，约 8 秒）。4. 用 view 变量做状态机，draw() 按 view 分支整屏重画，只在结尾 ui.present() 一次；没变化的按键直接 return，不要刷新。5. 三键约定：上下移动或调整，确认执行；要返回就在列表放一项“返回”或在结果页按确认返回。长按下键由系统退出，不要占用。6. 数据用 load 和 save，每次改动后保存，下次打开要恢复现场；第一次打开要有能直接操作的示例内容，绝不能是空白或“暂无数据”。7. 联网用 net.request，回包进 on_net；数据页必须先画缓存或示例再请求，页头用 stamp(at) 显示“更新 HH:MM”或离线，上次结果用 cached 存，断网也有内容。若用户想从内网电脑/脚本/手机发数据上屏或从墨水屏按键回传，优先设 js.conn_mode='relay' 并使用全局 RELAY 地址（GET RELAY 取 {state,messages}，POST RELAY+'/outbox' 加 keep:true 发回传）。8. 写完必须看 check_work 返回的屏幕草图，确认布局均衡且零越界再结束。`;
