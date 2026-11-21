/** Built-in v2.1 On-Device Voice Agent Templates using standard `voice({role,state,tools})` component. */

export const voice_board = `var S=load('vb',{memo:'按住说话增删待办，双击确认开启免提长录',arc:0,items:[{t:'下午产品方案评审',tag:'15:00',pri:2,done:false},{t:'给家里买两袋咖啡豆',tag:'今日',pri:1,done:false},{t:'顺路取驿站包裹',tag:'低调',pri:0,done:false},{t:'整理本周研发周报',tag:'昨日',pri:1,done:true}]}),cur=0;
function pVal(it){return typeof it.pri==='number'?it.pri:1;}
function hmMin(s){
 if(!s)return -1;var i,h=-1,m=-1;
 for(i=0;i+4<=s.length;i++){
  if(s.charAt(i+2)===':'||s.charAt(i+1)===':'){
   var p=s.slice(i,i+5).split(':');h=parseInt(p[0],10);m=parseInt(p[1],10);
   if(h>=0&&h<24&&m>=0&&m<60)return h*60+m;
  }
 }
 return -1;
}
function urgScore(it,nowM){
 var tg=String(it.tag||'')+String(it.t||''),tm=hmMin(tg),prox=0;
 if(tm>=0&&nowM>=0){var d=tm-nowM;if(d<-60)d+=1440;prox=Math.max(20,240-Math.floor(d/3));}
 else if(tg.indexOf('马上')>=0||tg.indexOf('立刻')>=0||tg.indexOf('紧急')>=0)prox=220;
 else if(tg.indexOf('今')>=0||tg.indexOf('下午')>=0||tg.indexOf('晚')>=0)prox=110;
 else if(tg.indexOf('明')>=0)prox=55;
 var p=pVal(it);
 return (p===2?150:p===1?55:0)+prox;
}
function tidy(){
 var nowM=hmMin(hm()),i;
 for(i=0;i<S.items.length;i++)S.items[i]._k=i;
 S.items.sort(function(a,b){
  if(!!a.done!==!!b.done)return a.done?1:-1;
  if(a.done)return a._k-b._k;
  var d=urgScore(b,nowM)-urgScore(a,nowM);
  return d!==0?d:(a._k-b._k);
 });
 var dCnt=0,kept=[];
 for(i=0;i<S.items.length;i++){
  delete S.items[i]._k;
  if(S.items[i].done){dCnt++;if(dCnt>2||kept.length>=10){S.arc=(S.arc||0)+1;continue;}}
  if(kept.length<12)kept.push(S.items[i]);
 }
 S.items=kept;
 if(cur>=S.items.length)cur=Math.max(0,S.items.length-1);
}
function leftCnt(){var n=0,i;for(i=0;i<S.items.length;i++)if(!S.items[i].done)n++;return n;}
var V=voice({
 role:'贴心干练的桌面待办搭档。根据语音调用工具增删改查、设重要度(2高优/1普通/0低调)或批量改完成状态；回复自然有人情味但极简利落(8到20字内一句话)。',
 state:function(){return {now:hm(),left:leftCnt(),archived:S.arc||0,memo:S.memo,items:S.items};},
 tools:[
  {name:'add_todo',desc:'新增待办(支持时间标签与重要度2高1中0低)',params:{text:'string:事项内容',tag:'string?:时间如15:00或今日',pri:'integer?:2高优1普通0低调'},run:function(a){
   var tx=String(a.text||'新事项').slice(0,34),pr=typeof a.pri==='number'?Math.max(0,Math.min(2,Math.round(a.pri))):1;
   S.items.unshift({t:tx,tag:String(a.tag||(pr===2?'高优':pr===0?'低调':'待办')).slice(0,10),pri:pr,done:false});
   tidy();cur=0;save('vb',S);return {ok:true,added:tx,pri:pr,left:leftCnt()};
  }},
  {name:'complete_todo',desc:'将匹配或全部待办标为完成或恢复未完成',params:{index:'integer?:序号',match:'string?:关键词',done:'boolean?:默认true完成,传false恢复未完成',all:'boolean?:是否操作全部'},run:function(a){
   var targetDone=(a.done!==false),i,cnt=0,m=String(a.match||'');
   if(a.all){for(i=0;i<S.items.length;i++){S.items[i].done=targetDone;cnt++;}}
   else if(typeof a.index==='number'&&a.index>=0&&a.index<S.items.length){S.items[a.index].done=targetDone;cnt=1;}
   else if(m){for(i=0;i<S.items.length;i++)if(S.items[i].t.indexOf(m)>=0){S.items[i].done=targetDone;cnt++;break;}}
   else if(S.items.length){S.items[0].done=targetDone;cnt=1;}
   if(cnt>0){tidy();save('vb',S);return {ok:true,updated:cnt,done:targetDone,archived:S.arc||0};}
   return {ok:false};
  }},
  {name:'set_priority',desc:'调整某条待办的重要等级(2高优/1普通/0低调)',params:{match:'string:关键词',pri:'integer:2高优1普通0低调'},run:function(a){
   var i,m=String(a.match||''),pr=Math.max(0,Math.min(2,Math.round(Number(a.pri)||1)));
   for(i=0;i<S.items.length;i++)if(!m||S.items[i].t.indexOf(m)>=0){S.items[i].pri=pr;tidy();save('vb',S);return {ok:true,item:S.items[i].t,pri:pr};}
   return {ok:false};
  }},
  {name:'set_memo',desc:'更新顶部常驻备忘或天气出行提示',params:{memo:'string:备忘内容'},run:function(a){
   S.memo=String(a.memo||'').slice(0,72);V.msg='';V.off=0;save('vb',S);return {ok:true,memo:S.memo};
  }}
 ]
});
function draw(){
 ui.clear(15);ui.rrect(16,10,368,78,10,15);ui.rbox(16,10,368,78,10,5,1);
 ui.font('display');ui.text(28,18,String(leftCnt()),1,0);
 ui.font('sans');ui.text(68,18,'待办管家',1,0);
 if(S.arc>0)ui.text(156,18,'归档 '+S.arc,1,5);
 right(372,18,V.badge(),0);
 V.box(68,42,302,S.memo||'按住说话 · 双击长录',5);
 var top=cur>2?cur-2:0,i;
 for(i=0;i<3&&top+i<S.items.length;i++){
  var idx=top+i,it=S.items[idx],y=96+i*52,sel=idx===cur,p=pVal(it);
  ui.rrect(16,y,368,44,8,sel?0:15);if(!sel)ui.rbox(16,y,368,44,8,it.done?12:8,1);
  var fg=sel?15:(it.done?6:0),sub=sel?15:5;
  ui.rbox(28,y+14,16,16,4,fg,1);if(it.done)ui.rrect(32,y+18,8,8,2,fg);
  var pfx=it.done?'':(p===2?'[!] ':p===0?'[-] ':'');
  var label=clip(pfx+it.t,238);ui.text(52,y+12,label,1,fg);
  if(it.done)ui.rect(52,y+21,Math.min(238,tw(label,1)),2,fg);
  if(it.tag)right(372,y+12,clip(it.tag,66),sub);
 }
 if(!S.items.length)ui.text(112,148,'按住确认键说一句新增待办',1,5);
 ui.rect(16,260,368,1,10);
 ui.text(16,268,clip('上下选 · 确认勾 · 挥手调重要度 · 按住说',368),1,5);
 ui.present();
}
function on_start(){tidy();ui.tick(4200);draw();}
function on_key(k){
 if(!S.items.length)return;
 if(k==='up')cur=(cur+S.items.length-1)%S.items.length;
 else if(k==='down')cur=(cur+1)%S.items.length;
 else if(k==='ok'){S.items[cur].done=!S.items[cur].done;tidy();save('vb',S);}
 else if(k==='wave'){var it=S.items[cur],np=pVal(it)===1?2:(pVal(it)===2?0:1);it.pri=np;V.msg='已设为'+(np===2?'高优':np===0?'低调':'普通')+'：'+it.t;V.off=0;tidy();save('vb',S);}
 else return;
 draw();
}`;

export const meeting_minuteman = `var S=load('mm',{idx:0,notes:[{title:'v2.1 端侧语音方案定稿会',conc:'确认长短录静音解耦不断麦，语音组件一键接入。',acts:['固件落盘动态调频80/240MHz @研发','浏览器本地隔离存储凭证 @平台','多应用AI自建验证 @测试']}]}),V=voice({
 role:'会议长录纪要秘书。将整段会议语音提炼为简短标题、一句核心结论和最多3条可执行行动项（含负责人），调用 save_minutes 落盘并用20字内人味口语简报。',
 state:function(){return {count:S.notes.length,latest:S.notes[0]};},
 tools:[
  {name:'save_minutes',desc:'保存提炼后的结构化会议纪要',params:{title:'string:会议标题',conclusion:'string:核心结论(<=36字)',act1:'string:行动项1',act2:'string?:行动项2',act3:'string?:行动项3'},run:function(a){
   S.notes.unshift({title:String(a.title||'会议纪要').slice(0,22),conc:String(a.conclusion||'已提炼核心要点').slice(0,42),acts:[String(a.act1||'跟进落实').slice(0,28),String(a.act2||'同步进展').slice(0,28),String(a.act3||'复盘验收').slice(0,28)]});
   if(S.notes.length>8)S.notes.pop();
   S.idx=0;save('mm',S);return {ok:true,saved:S.notes[0].title};
  }}
 ]
});
function draw(){
 var n=S.notes[S.idx]||S.notes[0];
 ui.clear(15);ui.font('sans');
 ui.rrect(16,14,368,36,8,0);
 ui.text(28,22,clip(n.title,220),1,15);
 right(372,22,V.badge()==='就绪'?(S.idx+1)+'/'+S.notes.length:V.badge(),15);
 ui.rrect(16,58,368,58,8,15);ui.rbox(16,58,368,58,8,5,1);
 ui.text(28,64,clip('核心结论：'+n.conc,640),1,0,340);
 var i;
 for(i=0;i<3;i++){
  var y=124+i*42,act=n.acts[i]||'待补充行动项';
  ui.rrect(16,y,368,36,6,15);ui.rbox(16,y,368,36,6,10,1);
  ui.text(28,y+8,clip((i+1)+'. '+act,340),1,0);
 }
 ui.rect(16,258,368,1,10);
 ui.text(16,266,clip(V.reply('双击确认长录 · 单击翻看历史纪要'),368),1,5);
 ui.present();
}
function on_start(){draw();}
function on_key(k){
 if(k==='up'||k==='left')S.idx=(S.idx+S.notes.length-1)%S.notes.length;
 else if(k==='down'||k==='ok'||k==='wave')S.idx=(S.idx+1)%S.notes.length;
 else return;
 save('mm',S);draw();
}`;

export const voice_ledger = `var S=load('vl',{budget:3000,month:426,items:[{t:'手冲咖啡豆',cat:'餐饮',amt:68},{t:'地铁通勤卡',cat:'交通',amt:30},{t:'墨水屏保护套',cat:'数码',amt:58}]}),cur=0,V=voice({
 role:'贴心干练的语音记账搭档。识别商品、金额与分类(餐饮/交通/购物/居家/数码)，调用 add_expense 记账，用18字内自然口语简报花费与余量。',
 state:function(){return {budget:S.budget,month_spent:S.month,recent:S.items.slice(0,4)};},
 tools:[
  {name:'add_expense',desc:'记一笔日常开销',params:{item:'string:消费名称',amount:'number:金额(元)',category:'string?:二字分类'},run:function(a){
   var v=Math.max(1,Math.round(Number(a.amount)||10));
   S.items.unshift({t:String(a.item||'日常消费').slice(0,18),cat:String(a.category||'日常').slice(0,4),amt:v});
   if(S.items.length>15)S.items.pop();
   S.month+=v;cur=0;save('vl',S);return {ok:true,month_spent:S.month,budget_left:S.budget-S.month};
  }},
  {name:'set_budget',desc:'修改月度总预算金额',params:{budget:'number:月预算(元)'},run:function(a){
   S.budget=Math.max(100,Math.round(Number(a.budget)||3000));save('vl',S);return {ok:true,budget:S.budget};
  }}
 ]
});
function draw(){
 var rem=Math.max(0,S.budget-S.month);
 ui.clear(15);ui.rrect(16,14,368,78,10,15);ui.rbox(16,14,368,78,10,5,1);
 ui.font('sans');ui.text(28,22,'本月支出 (元)',1,5);right(370,22,V.badge(),0);
 ui.font('display');ui.text(28,46,String(S.month),1,0);
 ui.font('sans');right(370,56,'预算余 '+rem,0);
 var i;
 for(i=0;i<3&&i<S.items.length;i++){
  var it=S.items[i],y=102+i*48,sel=i===cur;
  ui.rrect(16,y,368,40,8,sel?0:15);if(!sel)ui.rbox(16,y,368,40,8,10,1);
  var fg=sel?15:0;
  ui.text(28,y+10,clip('['+it.cat+'] '+it.t,245),1,fg);
  right(370,y+10,'- '+it.amt+' 元',fg);
 }
 ui.rect(16,258,368,1,10);
 ui.text(16,266,clip(V.reply('上下选 · 确认删单笔 · 按住语音记账'),368),1,5);
 ui.present();
}
function on_start(){draw();}
function on_key(k){
 if(!S.items.length)return;
 if(k==='up')cur=(cur+Math.min(3,S.items.length)-1)%Math.min(3,S.items.length);
 else if(k==='down'||k==='wave')cur=(cur+1)%Math.min(3,S.items.length);
 else if(k==='ok'){S.month=Math.max(0,S.month-S.items[cur].amt);S.items.splice(cur,1);cur=0;save('vl',S);}
 else return;
 draw();
}`;

export const desk_oracle = `var S=load('do',{idx:0,cards:[{q:'为什么墨水屏阳光下越晒越清晰？',a:'电子墨水微胶囊依靠环境反射光成像而非自发光背光，户外自然光越充足漫反射对比度越高，阅读体验越接近真实纸张。',tag:'科普百科'},{q:'按住确认键直接提问',a:'支持实时天气、汇率、新闻热搜与百科问答。提问后自动联网检索，浓缩成纸感卡片展示并语音播报答案。',tag:'语音助手'}]}),V=voice({
 role:'桌面百科与实时资讯语音顾问。对实时问题先调 web_search 查证，再调 show_answer 将精炼问题与80字内清晰解答写上屏幕，最后用22字内人味口语播报结论。',
 state:function(){return {current:S.cards[S.idx]};},
 tools:[
  {name:'show_answer',desc:'在墨水屏展示问答卡片',params:{question:'string:精炼问题标题(<=18字)',answer:'string:清晰解答正文(<=85字)',tag:'string?:四字分类'},run:function(a){
   S.cards.unshift({q:String(a.question||'语音问答').slice(0,20),a:String(a.answer||'').slice(0,96),tag:String(a.tag||'实时解答').slice(0,8)});
   if(S.cards.length>10)S.cards.pop();
   S.idx=0;save('do',S);return {ok:true};
  }}
 ]
});
function draw(){
 var c=S.cards[S.idx]||S.cards[0];
 ui.clear(14);ui.glass(16,14,368,236,12,15,2);
 ui.font('sans');ui.text(32,26,clip(c.tag||'百科解答',180),1,6);
 right(368,26,V.badge()==='就绪'?(S.idx+1)+' / '+S.cards.length:V.badge(),6);
 ui.font('serif');ui.text(32,54,clip(c.q,336),1,0);
 ui.rect(32,86,48,2,4);
 ui.font('sans');ui.text(32,100,clip(c.a,1200),1,2,336);
 ui.text(20,264,clip(V.reply('按住提问 · 联网解答 · 上下或确认翻卡'),360),1,5);
 ui.present();
}
function on_start(){draw();}
function on_key(k){
 if(k==='up')S.idx=(S.idx+S.cards.length-1)%S.cards.length;
 else if(k==='down'||k==='ok'||k==='wave')S.idx=(S.idx+1)%S.cards.length;
 else return;
 save('do',S);draw();
}`;
