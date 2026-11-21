/** Built-in v2.0 On-Device Voice Agent Templates (verified by WASM Finish Gate & agent.config tool probe). */

export const voice_board = `var S=load('vb',{memo:'按住确认键说话，双击进入免提长录',items:[{t:'下午三点产品方案评审',tag:'15:00',done:false},{t:'给家里买两袋咖啡豆',tag:'生活',done:false},{t:'整理本周研发周报要点',tag:'今日',done:true}]}),cur=0,ST='按住说话 · 双击长录';
function leftCnt(){var n=0,i;for(i=0;i<S.items.length;i++)if(!S.items[i].done)n++;return n;}
function draw(){
 ui.clear(15);ui.rrect(16,14,368,68,10,15);ui.rbox(16,14,368,68,10,5,1);
 ui.font('display');ui.text(30,24,String(leftCnt()),1,0);
 ui.font('sans');ui.text(72,24,clip('语音待办管家',160),1,0);
 right(370,24,clip(ST,135),5);
 ui.text(72,50,clip(S.memo,296),1,5);
 if(cur>=S.items.length)cur=Math.max(0,S.items.length-1);
 var top=cur>2?cur-2:0,i;
 for(i=0;i<3&&top+i<S.items.length;i++){
  var idx=top+i,it=S.items[idx],y=92+i*54,sel=idx===cur;
  ui.rrect(16,y,368,46,8,sel?0:15);if(!sel)ui.rbox(16,y,368,46,8,10,1);
  var fg=sel?15:0,sub=sel?15:5;
  ui.rbox(30,y+15,16,16,4,fg,1);if(it.done)ui.rrect(34,y+19,8,8,2,fg);
  var label=clip(it.t,236);ui.text(56,y+13,label,1,fg);
  if(it.done)ui.rect(56,y+23,Math.min(236,tw(label,1)),2,fg);
  if(it.tag)right(370,y+13,clip(it.tag,66),sub);
 }
 if(!S.items.length)ui.text(124,148,'按住确认键说一句新增待办',1,5);
 ui.rect(16,262,368,1,10);
 ui.text(16,268,'上下选择 · 确认勾选 · 按住说话/双击长录',1,5);
 ui.present();
}
function registerAgent(){
 agent.config({
  role:'桌面语音待办与备忘管家。听到增删改待办、勾选完成或记备忘指令时先调用对应工具，再用25字内自然口语告知结果。',
  state:function(){return {pending:leftCnt(),memo:S.memo,items:S.items};},
  tools:[
   {name:'add_todo',desc:'新增一条待办事项',params:{text:'string:待办内容',tag:'string?:时间或分类标签'},run:function(a){
    var tx=String(a.text||'新事项').slice(0,36);
    S.items.unshift({t:tx,tag:String(a.tag||'待办').slice(0,10),done:false});
    if(S.items.length>16)S.items.pop();
    cur=0;save('vb',S);draw();return {ok:true,added:tx,left:leftCnt()};
   }},
   {name:'complete_todo',desc:'按序号或关键词将待办标为已完成',params:{index:'integer?:从0开始的序号',match:'string?:关键词'},run:function(a){
    var i,hit=-1,m=String(a.match||'');
    if(typeof a.index==='number'&&a.index>=0&&a.index<S.items.length)hit=a.index;
    else if(m){for(i=0;i<S.items.length;i++)if(S.items[i].t.indexOf(m)>=0){hit=i;break;}}
    if(hit<0&&S.items.length)hit=0;
    if(hit>=0){S.items[hit].done=true;save('vb',S);draw();return {ok:true,done:S.items[hit].t};}
    return {ok:false};
   }},
   {name:'set_memo',desc:'更新顶部一句话备忘提醒或天气出行提示',params:{memo:'string:精炼备忘内容'},run:function(a){
    S.memo=String(a.memo||'').slice(0,42);save('vb',S);draw();return {ok:true,memo:S.memo};
   }}
  ],
  on_event:function(ev){ST=ev.text||(ev.phase==='listening'?'正在聆听…':'按住说话 · 双击长录');draw();}
 });
}
function on_start(){registerAgent();draw();}
function on_key(k){
 if(!S.items.length)return;
 if(k==='up')cur=(cur+S.items.length-1)%S.items.length;
 else if(k==='down')cur=(cur+1)%S.items.length;
 else if(k==='ok'||k==='wave'){S.items[cur].done=!S.items[cur].done;save('vb',S);}
 else return;
 draw();
}`;

export const meeting_minuteman = `var S=load('mm',{idx:0,notes:[{title:'v2.0 端侧语音方案定稿会',conc:'确认双字库压缩省出740KB，长录分片直连ASR落盘。',acts:['固件联调双缓冲录音 @研发','云端上线DSH一键登录 @平台','真机三分钟会议压测 @测试']}]}),ST='单击确认长录 · 再按总结';
function draw(){
 var n=S.notes[S.idx]||S.notes[0];
 ui.clear(15);ui.font('sans');
 ui.rrect(16,14,368,36,8,0);
 ui.text(28,22,clip(n.title,220),1,15);
 right(372,22,(S.idx+1)+'/'+S.notes.length,15);
 ui.rrect(16,58,368,58,8,15);ui.rbox(16,58,368,58,8,5,1);
 ui.text(28,64,clip('核心结论：'+n.conc,640),1,0,340);
 var i;
 for(i=0;i<3;i++){
  var y=124+i*42,act=n.acts[i]||'待补充行动项';
  ui.rrect(16,y,368,36,6,15);ui.rbox(16,y,368,36,6,10,1);
  ui.text(28,y+8,clip((i+1)+'. '+act,340),1,0);
 }
 ui.rect(16,258,368,1,10);
 ui.text(16,266,clip(ST+' · 上下翻历史纪要',368),1,5);
 ui.present();
}
function on_start(){
 agent.config({
  role:'会议长录纪要秘书。将整段会议语音提炼为简短标题、一句核心结论和最多3条可执行行动项（含负责人），调用 save_minutes 落盘并用30字内口语总结。',
  state:function(){return {count:S.notes.length,latest:S.notes[0]};},
  tools:[
   {name:'save_minutes',desc:'保存提炼后的结构化会议纪要',params:{title:'string:会议标题',conclusion:'string:核心结论(<=36字)',act1:'string:行动项1',act2:'string?:行动项2',act3:'string?:行动项3'},run:function(a){
    S.notes.unshift({title:String(a.title||'会议纪要').slice(0,22),conc:String(a.conclusion||'已提炼核心要点').slice(0,42),acts:[String(a.act1||'跟进落实').slice(0,28),String(a.act2||'同步进展').slice(0,28),String(a.act3||'复盘验收').slice(0,28)]});
    if(S.notes.length>8)S.notes.pop();
    S.idx=0;save('mm',S);draw();return {ok:true,saved:S.notes[0].title};
   }}
  ],
  on_event:function(ev){ST=ev.text||'单击确认长录 · 再按总结';draw();}
 });
 draw();
}
function on_key(k){
 if(k==='up'||k==='left')S.idx=(S.idx+S.notes.length-1)%S.notes.length;
 else if(k==='down'||k==='ok'||k==='wave')S.idx=(S.idx+1)%S.notes.length;
 else return;
 save('mm',S);draw();
}`;

export const voice_ledger = `var S=load('vl',{budget:3000,month:426,items:[{t:'手冲咖啡豆',cat:'餐饮',amt:68},{t:'地铁通勤卡',cat:'交通',amt:30},{t:'墨水屏保护套',cat:'数码',amt:58}]}),cur=0,ST='按住说花销 · 自动归类';
function draw(){
 var rem=Math.max(0,S.budget-S.month);
 ui.clear(15);ui.rrect(16,14,368,78,10,15);ui.rbox(16,14,368,78,10,5,1);
 ui.font('sans');ui.text(28,22,'本月支出 (元)',1,5);right(370,22,clip(ST,180),5);
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
 ui.text(16,266,'上下选择 · 确认删单笔 · 按住语音记账',1,5);
 ui.present();
}
function on_start(){
 agent.config({
  role:'桌面语音记账管家。识别用户说的商品、金额与分类（餐饮/交通/购物/居家/数码），调用 add_expense 记账，口语简报本月累计与剩余预算。',
  state:function(){return {budget:S.budget,month_spent:S.month,recent:S.items.slice(0,4)};},
  tools:[
   {name:'add_expense',desc:'记一笔日常开销',params:{item:'string:消费名称',amount:'number:金额(元)',category:'string?:二字分类'},run:function(a){
    var v=Math.max(1,Math.round(Number(a.amount)||10));
    S.items.unshift({t:String(a.item||'日常消费').slice(0,18),cat:String(a.category||'日常').slice(0,4),amt:v});
    if(S.items.length>15)S.items.pop();
    S.month+=v;cur=0;save('vl',S);draw();return {ok:true,month_spent:S.month,budget_left:S.budget-S.month};
   }},
   {name:'set_budget',desc:'修改月度总预算金额',params:{budget:'number:月预算(元)'},run:function(a){
    S.budget=Math.max(100,Math.round(Number(a.budget)||3000));save('vl',S);draw();return {ok:true,budget:S.budget};
   }}
  ],
  on_event:function(ev){ST=ev.text||'按住说花销 · 自动归类';draw();}
 });
 draw();
}
function on_key(k){
 if(!S.items.length)return;
 if(k==='up')cur=(cur+Math.min(3,S.items.length)-1)%Math.min(3,S.items.length);
 else if(k==='down'||k==='wave')cur=(cur+1)%Math.min(3,S.items.length);
 else if(k==='ok'){S.month=Math.max(0,S.month-S.items[cur].amt);S.items.splice(cur,1);cur=0;save('vl',S);}
 else return;
 draw();
}`;

export const desk_oracle = `var S=load('do',{idx:0,cards:[{q:'为什么墨水屏阳光下越晒越清晰？',a:'电子墨水微胶囊依靠环境反射光成像而非自发光背光，户外自然光越充足漫反射对比度越高，阅读体验越接近真实纸张。',tag:'科普百科'},{q:'按住确认键直接提问',a:'支持实时天气、汇率、新闻热搜与百科问答。提问后自动联网检索，浓缩成纸感卡片展示并语音播报答案。',tag:'语音助手'}]}),ST='按住或单击提问 · 联网解答';
function draw(){
 var c=S.cards[S.idx]||S.cards[0];
 ui.clear(14);ui.glass(16,14,368,236,12,15,2);
 ui.font('sans');ui.text(32,26,clip(c.tag||'百科解答',180),1,6);
 right(368,26,(S.idx+1)+' / '+S.cards.length,6);
 ui.font('serif');ui.text(32,54,clip(c.q,336),1,0);
 ui.rect(32,86,48,2,4);
 ui.font('sans');ui.text(32,100,clip(c.a,1200),1,2,336);
 ui.text(20,264,'按住或单击提问 · 联网解答 · 上下翻卡',1,5);
 ui.present();
}
function on_start(){
 agent.config({
  role:'桌面百科与实时资讯语音顾问。对实时问题先调 web_search 查证，再调 show_answer 将精炼问题与80字内清晰解答写上屏幕，最后用35字内口语播报结论。',
  state:function(){return {current:S.cards[S.idx]};},
  tools:[
   {name:'show_answer',desc:'在墨水屏展示问答卡片',params:{question:'string:精炼问题标题(<=18字)',answer:'string:清晰解答正文(<=85字)',tag:'string?:四字分类'},run:function(a){
    S.cards.unshift({q:String(a.question||'语音问答').slice(0,20),a:String(a.answer||'').slice(0,96),tag:String(a.tag||'实时解答').slice(0,8)});
    if(S.cards.length>10)S.cards.pop();
    S.idx=0;save('do',S);draw();return {ok:true};
   }}
  ],
  on_event:function(ev){ST=ev.text||'按住或单击提问 · 联网解答';draw();}
 });
 draw();
}
function on_key(k){
 if(k==='up')S.idx=(S.idx+S.cards.length-1)%S.cards.length;
 else if(k==='down'||k==='ok'||k==='wave')S.idx=(S.idx+1)%S.cards.length;
 else return;
 save('do',S);draw();
}`;
