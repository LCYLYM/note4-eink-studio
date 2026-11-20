/** Ready-to-run sample apps shown in the template gallery. Network samples fetch real public data or use the built-in Relay Hub; nothing is faked. */
const todo=(style:number,items:string)=>`var STYLE=${style},REMOTE=STYLE===0&&KEY,S=load('s',{t:${items}}),at=load('at',''),cur=0,top=0,R=4,AUTH='Authorization: Bearer '+KEY;
function left(){var n=0,i;for(i=0;i<S.t.length;i++)if(!S.t[i][2])n++;return n;}
function head(){var n=S.t.length,l=left(),d=n-l;
 if(STYLE===0){ui.text(M,42,String(l),3,0);ui.text(M+tw(String(l),3)+10,46,'项待办',1,0);ui.text(M+tw(String(l),3)+10,68,'今天 '+d+'/'+n,1,0);bar(220,62,166,10,d,n||1);}
 else if(STYLE===1){ui.text(M,44,'我的一天',2,0);ui.text(M,90-8,'专注今天最重要的事',1,0);right(W-M,48,Math.round(d*100/(n||1))+'%',0);bar(296,74,90,8,d,n||1);}
 else{var f=[['待办',l],['完成',d],['全部',n]],i;for(i=0;i<3;i++)tile(M+i*126,42,120,58,f[i][0],String(f[i][1]),i===0);}
}
function item(y,t,sel){var c=sel?15:0,bx=M+10,by=y+10;if(sel)ui.rect(M,y,W-2*M,34,0);box(bx,by,14,14,c);if(t[2])ui.rect(bx+3,by+3,8,8,c);var s=clip(t[0],230);ui.text(M+34,y+9,s,1,c);right(W-M-10,y+9,t[1],c);if(t[2])ui.rect(M+34,y+17,tw(s),1,c);}
function draw(){var i;page(TITLE,REMOTE?stamp(at):STYLE===0?'演示数据':'本地清单','上下选择  确认勾选','完成');head();if(cur<top)top=cur;if(cur>=top+R)top=cur-R+1;for(i=top;i<S.t.length&&i<top+R;i++)item(112+(i-top)*37,S.t[i],i===cur);ui.present();}
function pull(){if(REMOTE)net.request({key:'t',url:'https://api.dida365.com/open/v1/project/inbox/data',headers:AUTH});}
function on_net(k,st,b){if(k!=='t')return;var j=parse(st,b),a=[],i,t;if(!j||!j.tasks){OFF=true;draw();return;}OFF=false;for(i=0;i<j.tasks.length&&i<12;i++){t=j.tasks[i];a.push([clip(t.title,230),t.dueDate?t.dueDate.slice(5,10):'',t.status===2,t.id,t.projectId]);}S.t=a;at=hm();cur=0;top=0;cached('s',S);save('at',at);draw();}
function on_tick(){pull();}
function on_start(){draw();pull();ui.tick(60000);}
function next(){var i,n=S.t.length;for(i=1;i<=n;i++)if(!S.t[(cur+i)%n][2]){cur=(cur+i)%n;return;}}
function finish(on){var t=S.t[cur];if(REMOTE&&t[2])return;t[2]=on;if(REMOTE&&t[3])net.request({key:'done',url:'https://api.dida365.com/open/v1/project/'+t[4]+'/task/'+t[3]+'/complete',method:'POST',headers:AUTH,keep:true});cached('s',S);}
function on_key(k){var n=S.t.length;if(!n){pull();draw();return;}if(k==='up')cur=(cur+n-1)%n;else if(k==='down')cur=(cur+1)%n;else if(k==='ok')finish(!S.t[cur][2]);else if(k==='wave'){finish(true);next();}else return;draw();}`;
const calendar=`var C=clock(),URL=KEY.replace('webcal://','https://'),EV=load('ev',{3:[['10:00','周会',1]],9:[['09:30','产品评审',1],['14:00','牙医复诊',0]],15:[['全天','爸爸生日',0]],27:[['18:00','朋友聚餐',0]]}),at=load('at',''),
DAYS=mdays(C.y,C.m),FIRST=((C.w-(C.d-1))%7+7)%7,TODAY=C.d,d=TODAY,WK='日一二三四五六';
function cell(day){var p=day+FIRST-1;return [M+(p%7)*31,62+Math.floor(p/7)*33];}
function draw(){var i,k,a;page(C.ok?'日历 '+C.y+' 年 '+C.m+' 月':'日历 等待校时',URL?stamp(at):'本地日程','上下换一天  确认回今天','下个日程');
 for(i=0;i<7;i++)cx(M+i*31,31,42,WK.charAt(i),1,0);
 for(i=1;i<=DAYS;i++){a=cell(i);var on=i===d,s=String(i);if(on)ui.rect(a[0]+1,a[1],29,30,0);else if(i===TODAY)box(a[0]+1,a[1],29,30,0);cx(a[0],31,a[1]+3,s,1,on?15:0);var e=EV[i];if(e)for(k=0;k<e.length&&k<3;k++){var dx=a[0]+15-e.length*3+k*6;if(e[k][2])ui.rect(dx,a[1]+23,4,4,on?15:0);else box(dx,a[1]+23,4,4,on?15:0);}}
 ui.rect(236,44,1,214,0);ui.text(248,42,C.m+'/'+d,2,0);var list=EV[d]||[];
 if(!list.length)ui.text(248,100,'这天没有安排',1,0);
 for(i=0;i<list.length&&i<3;i++){var y=92+i*54;ui.text(248,y,list[i][0],1,0);ui.text(248,y+20,clip(list[i][1],130),1,0);if(list[i][2])ui.rect(248,y+40,20,3,0);else box(248,y+40,20,3,0);}
 ui.present();}
function line(m,n){var a=m.indexOf(n);if(a<0)return '';var e=m.indexOf('\\n',a);return m.slice(a,e<0?m.length:e).replace('\\r','');}
function pull(){if(URL&&URL.indexOf('http')===0)net.request({key:'ics',url:URL});}
function on_net(k,st,b){if(st<200||st>=300){OFF=true;draw();return;}OFF=false;var p=b.split('BEGIN:VEVENT'),E={},i,ym=''+C.y+pad(C.m);for(i=1;i<p.length&&i<600;i++){var l=line(p[i],'DTSTART'),v=l.slice(l.lastIndexOf(':')+1),t=line(p[i],'SUMMARY');if(v.slice(0,6)!==ym)continue;var dd=+v.slice(6,8),tm='全天';if(v.length>8){var h=+v.slice(9,11);if(v.charAt(v.length-1)==='Z')h=(h+8)%24;tm=pad(h)+':'+v.slice(11,13);}(E[dd]=E[dd]||[]).push([tm,t.slice(t.indexOf(':')+1).slice(0,24),1]);}EV=E;at=hm();cached('ev',EV);save('at',at);draw();}
function on_tick(){var n=clock();if(n.ok&&n.day!==C.day){C=n;DAYS=mdays(C.y,C.m);FIRST=((C.w-(C.d-1))%7+7)%7;TODAY=C.d;d=TODAY;draw();}pull();}
function on_start(){draw();pull();ui.tick(60000);}
function on_key(k){var i;if(k==='up')d=d>1?d-1:DAYS;else if(k==='down')d=d<DAYS?d+1:1;else if(k==='ok')d=TODAY;else if(k==='wave'){for(i=1;i<=DAYS;i++){var t=(d+i-1)%DAYS+1;if(EV[t]){d=t;break;}}}else return;draw();}`;
const ebbinghaus=`var IV=[1,3,7,14,30],S=load('s',{day:1,base:0,c:[['resilience','韧性，复原力',0,1],['勾股定理','a^2 + b^2 = c^2',0,1],['ephemeral','短暂的',1,1],['《静夜思》作者','李白',2,1],['牛顿第二定律','F = ma',3,2]]}),back=false;
function today(){var c=clock();if(!c.ok)return S.day;if(!S.base)S.base=c.day-1;return c.day-S.base;}
function due(){var a=[],i;for(i=0;i<S.c.length;i++)if(S.c[i][3]<=S.day&&S.c[i][2]<5)a.push(i);return a;}
function draw(){var q=due(),i,n=[0,0,0,0,0];for(i=0;i<S.c.length;i++)if(S.c[i][2]<5)n[S.c[i][2]]++;
 page('艾宾浩斯复习','第 '+S.day+' 天  待复习 '+q.length,q.length?(back?'上 忘了  下或确认 记住':'确认看答案'):(clock().ok?'明天再来':'确认进入明天'),'记住了');
 for(i=0;i<5;i++){var x=M+i*75;tile(x,42,70,54,IV[i]+' 天',String(n[i]),q.length>0&&S.c[q[0]][2]===i);}
 if(!q.length){center(130,'今天复习完了',2,0);center(190,'间隔越拉越长，记得越久',1,0);ui.present();return;}
 var c=S.c[q[0]];center(118,clip(c[0],360),2,0);if(back){ui.rect(120,168,160,1,0);center(186,clip(c[1],360),2,0);}else center(186,'先在心里答一遍',1,0);ui.present();}
function pass(q){var c=S.c[q];c[2]++;if(c[2]<5)c[3]=S.day+IV[c[2]];save('s',S);back=false;}
function on_start(){S.day=today();draw();}
function on_key(k){var q=due();if(!q.length){if((k==='ok'||k==='wave')&&!clock().ok){S.day++;save('s',S);draw();}return;}
 if(k==='wave')pass(q[0]);else if(!back){if(k==='ok')back=true;else return;}else if(k==='up'){S.c[q[0]][2]=0;S.c[q[0]][3]=S.day+1;save('s',S);back=false;}else if(k==='ok'||k==='down')pass(q[0]);else return;draw();}`;
const words=`var D=[['abandon','a-ban-don','放弃','never abandon a dream'],['benefit','ben-e-fit','好处，益处','the benefit of reading'],['capture','cap-ture','捕捉，夺取','capture the moment'],['derive','de-rive','获得，源于','derive joy from work'],['efficient','ef-fi-cient','高效的','an efficient plan'],['flexible','flex-i-ble','灵活的','a flexible schedule'],['genuine','gen-u-ine','真正的','a genuine smile'],['humble','hum-ble','谦逊的','a humble beginning']],
S=load('s',{i:0,k:0,n:0}),back=false;
function draw(){var w=D[S.i];page('英语单词机','认识 '+S.k+' / 看过 '+S.n,back?'上 不认识  下或确认 认识':'确认翻面',back?'认识':'翻面');bar(M,42,W-2*M,6,S.i+1,D.length);
 center(78,w[0],3,0);center(146,w[1],1,0);
 if(back){ui.rect(M+40,176,W-2*M-80,1,0);center(188,w[2],2,0);center(238,w[3],1,0);}else center(208,(S.i+1)+' / '+D.length,1,0);ui.present();}
function mv(known){S.n++;if(known)S.k++;S.i=(S.i+1)%D.length;back=false;save('s',S);}
function on_start(){draw();}
function on_key(k){if(!back){if(k==='ok'||k==='wave')back=true;else return;}else if(k==='up')mv(false);else if(k==='down'||k==='ok'||k==='wave')mv(true);else return;draw();}`;
const timetable=`var P=['早自习','第一节','第二节','第三节','第四节','晚自习'],WD='一二三四五',T=[['语文','数学','英语','物理','化学','自习'],['英语','语文','数学','历史','体育','数学'],['语文','物理','化学','英语','生物','自习'],['英语','数学','语文','地理','音乐','语文'],['语文','英语','数学','班会','美术','放假']],
S=load('s',{d:0,p:0});
function draw(){var i,j,X=70,CW=63;page('课程表','本周','上下换节  确认换天','下一节');
 for(i=0;i<5;i++){if(i===S.d)ui.rect(X+i*CW,38,CW-2,22,0);cx(X+i*CW,CW-2,41,'周'+WD.charAt(i),1,i===S.d?15:0);}
 for(j=0;j<6;j++){var y=64+j*28;ui.text(M,y+5,P[j],1,0);if(j>0)ui.rect(M,y-1,W-2*M,1,10);
  for(i=0;i<5;i++){var on=i===S.d&&j===S.p;if(on)ui.rect(X+i*CW,y+1,CW-2,25,0);cx(X+i*CW,CW-2,y+5,T[i][j],1,on?15:0);}}
 ui.text(M,240,'接下来 周'+WD.charAt(S.d)+' '+P[S.p]+' '+T[S.d][S.p],1,0);ui.present();}
function on_start(){var c=clock();if(c.ok&&c.w>=1&&c.w<=5)S.d=c.w-1;draw();}
function on_key(k){if(k==='up')S.p=(S.p+5)%6;else if(k==='down')S.p=(S.p+1)%6;else if(k==='ok')S.d=(S.d+1)%5;else if(k==='wave'){S.p++;if(S.p>5){S.p=0;S.d=(S.d+1)%5;}}else return;save('s',S);draw();}`;
const water=`var S=load('s',{c:0,m:0,day:0}),G=8;
function fresh(){var c=clock();if(c.ok&&c.day!==S.day){S.day=c.day;S.c=0;S.m=0;save('s',S);}}
function draw(){var i;page('喝水和起身',(clock().ok?clock().m+'/'+clock().d+'  ':'')+'目标 '+G+' 杯','确认喝一杯  上撤销  下起身','喝一杯');
 ui.text(M,46,String(S.c),4,0);ui.text(M+tw(String(S.c),4)+10,92,'/ '+G+' 杯',1,0);ui.text(232,50,'已起身活动',1,0);ui.text(232,74,S.m+' 次',2,0);
 for(i=0;i<G;i++){var x=M+i*47,y=150,w=38,h=72;box(x,y,w,h,0);ui.rect(x+6,y-5,w-12,5,0);if(i<S.c)ui.rect(x+4,y+4,w-8,h-8,0);}
 center(236,S.c>=G?'今天喝够了':(S.c*2<G?'坐久了，起来倒杯水':'过半了，再接再厉'),1,0);ui.present();}
function on_tick(){var d=S.day;fresh();if(d!==S.day)draw();}
function on_start(){fresh();draw();ui.tick(60000);}
function on_key(k){if(k==='ok'||k==='wave')S.c=Math.min(G,S.c+1);else if(k==='up')S.c=Math.max(0,S.c-1);else if(k==='down')S.m++;else return;save('s',S);draw();}`;
const gantt=`var T=[['需求调研',0,3,100],['原型设计',2,3,80],['固件开发',3,6,45],['网页制作',5,5,20],['联调验收',9,3,0]],S=load('s',{start:0}),NOW=5,cur=0,zoom=0;
function week(){var c=clock();if(!c.ok)return;if(!S.start){S.start=c.day-35;save('s',S);}NOW=Math.max(0,Math.min(11,Math.floor((c.day-S.start)/7)));}
function draw(){var i,X=104,AW=282,f=zoom?NOW-1:0,n=zoom?5:12,c=Math.floor(AW/n);page(zoom?'甘特图 本月切片':'甘特图 季度总览','第 '+(NOW+1)+' 周','上下选择  确认缩放','下个任务');
 for(i=0;i<n;i++)if(i%(zoom?1:2)===0)ui.text(X+i*c,40,'W'+(f+i+1),1,0);
 for(i=0;i<T.length;i++){var y=64+i*30,t=T[i],on=i===cur;if(on)ui.rect(M,y,84,26,0);ui.text(M+6,y+5,t[0],1,on?15:0);
  var a=Math.max(t[1],f),b=Math.min(t[1]+t[2],f+n);if(b>a){var bx=X+(a-f)*c,bw=(b-a)*c-3;ui.rect(bx,y+5,bw,16,10);var dn=Math.floor(bw*t[3]/100);if(dn>0)ui.rect(bx,y+5,dn,16,0);box(bx,y+5,bw,16,0);}}
 var lx=X+(NOW-f)*c;ui.rect(lx,60,2,152,0);var s=T[cur];ui.rect(M,218,W-2*M,1,0);ui.text(M,228,s[0],2,0);right(W-M,240,'进度 '+s[3]+'%  共 '+s[2]+' 周',0);ui.present();}
function on_start(){week();draw();}
function on_key(k){var n=T.length;if(k==='up')cur=(cur+n-1)%n;else if(k==='down'||k==='wave')cur=(cur+1)%n;else if(k==='ok')zoom=1-zoom;else return;draw();}`;
const stock=`var A=[['沪深300ETF','sh510300',3],['招商银行','sh600036',2],['贵州茅台','sh600519',2]],D=[load('k0',[]),load('k1',[]),load('k2',[])],at=load('at',''),cur=0,line=false;
function draw(){var t=A[cur],all=D[cur],D2=all.slice(-(line?60:26)),n=D2.length,i,lo=1e12,hi=0;
 if(!n){page(t[0],stamp(at),'上下换标的','刷新');center(130,'正在获取行情',2,0);ui.present();return;}
 for(i=0;i<n;i++){lo=Math.min(lo,D2[i][2]);hi=Math.max(hi,D2[i][1]);}if(hi<=lo)hi=lo+1;
 var last=all[all.length-1][3],prev=all.length>1?all[all.length-2][3]:all[0][0],pct=(last-prev)*100/prev;
 page(t[0]+' '+t[1].slice(2),stamp(at),'上下换标的','切换'+(line?'K线':'收盘'));ui.text(M,42,fx(last,t[2]),2,0);var ps=(pct>=0?'+':'')+fx(pct,2)+'%',pw=tw(ps)+16;if(pct>=0)box(W-M-pw,46,pw,26,0);else ui.rect(W-M-pw,46,pw,26,0);ui.text(W-M-pw+8,51,ps,1,pct>=0?0:15);
 var Y0=92,H=166,Y=function(v){return Y0+Math.round((hi-v)*H/(hi-lo));};
 ui.rect(M,Y0-4,W-2*M,1,10);ui.rect(M,Y0+H+2,W-2*M,1,0);
 if(line){var c=(W-2*M-4)/n;for(i=0;i<n;i++){var x=M+Math.floor(i*c),y=Y(D2[i][3]),w=Math.ceil(c);ui.rect(x,y,w,Y0+H-y+1,10);ui.rect(x,y,w,2,0);}}
 else for(i=0;i<n;i++){var d=D2[i],x2=M+2+i*14,up=d[3]>=d[0],t1=Y(Math.max(d[0],d[3])),b1=Y(Math.min(d[0],d[3]));ui.rect(x2+4,Y(d[1]),1,t1-Y(d[1]),0);ui.rect(x2+4,b1,1,Y(d[2])-b1+1,0);var bh=Math.max(2,b1-t1);if(up)box(x2,t1,9,bh,0);else ui.rect(x2,t1,9,bh,0);}
 ui.present();}
function pull(){var i;for(i=0;i<A.length;i++)net.request({key:'k'+i,url:'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param='+A[i][1]+',day,,,60,qfq'});}
function on_net(k,st,b){var i=+k.slice(1),j=parse(st,b),d=j&&j.data&&j.data[A[i][1]],q=d&&(d.qfqday||d.day),a=[],n;if(!q){OFF=true;if(i===cur)draw();return;}OFF=false;for(n=0;n<q.length;n++)a.push([+q[n][1],+q[n][3],+q[n][4],+q[n][2]]);D[i]=a;at=hm();cached('k'+i,a);save('at',at);if(i===cur)draw();}
function on_tick(){pull();}
function on_start(){draw();pull();ui.tick(60000);}
function on_key(k){var n=A.length;if(k==='up')cur=(cur+n-1)%n;else if(k==='down')cur=(cur+1)%n;else if(k==='ok'||k==='wave')line=!line;else return;draw();}`;
const stripe=`var AUTH='Authorization: Bearer '+KEY,S=load('s',{b:1280,c:'USD',d:[60,95,40,120,85,150,110,90,180,140,75,210,165,240]}),at=load('at',''),wk=false;
function sum(a){var s=0,i;for(i=0;i<a.length;i++)s+=a[i];return s;}
function draw(){var d=S.d,a=wk?d.slice(-7):d,i,max=1;for(i=0;i<a.length;i++)if(a[i]>max)max=a[i];page('收入看板',KEY?stamp(at):'示例数据','确认切换周期','切换周期');
 ui.text(M,42,S.c+' '+fx(sum(a),0),3,0);right(W-M,48,wk?'近 7 天':'近 14 天',0);right(W-M,72,'可用余额 '+fx(S.b,0),0);
 if(a.length){var bw=Math.floor(372/a.length);for(i=0;i<a.length;i++){var h=Math.floor(a[i]*140/max),x=M+i*bw;ui.rect(x+2,256-h,bw-4,h,i===a.length-1?0:10);box(x+2,256-h,bw-4,h,0);}}
 ui.present();}
function pull(){if(!KEY)return;net.request({key:'b',url:'https://api.stripe.com/v1/balance',headers:AUTH});net.request({key:'c',url:'https://api.stripe.com/v1/charges?limit=30',headers:AUTH});}
function on_net(k,st,b){var j=parse(st,b),i;if(!j){OFF=true;draw();return;}OFF=false;if(k==='b'&&j.available&&j.available[0]){S.b=j.available[0].amount/100;S.c=j.available[0].currency.toUpperCase();}else if(k==='c'&&j.data){var a=[],t=clock().day;for(i=0;i<14;i++)a.push(0);for(i=0;i<j.data.length;i++){var c=j.data[i],n=13-(t-Math.floor((c.created+28800)/86400));if(c.paid&&!c.refunded&&n>=0&&n<14)a[n]+=c.amount/100;}S.d=a;}at=hm();cached('s',S);save('at',at);draw();}
function on_tick(){pull();}
function on_start(){draw();pull();ui.tick(60000);}
function on_key(k){if(k==='ok'||k==='wave')wk=!wk;else if(k==='up'||k==='down')pull();else return;draw();}`;
const quota=`var S=load('s',{t:48.6,p:50,g:0,c:'CNY',h:[56,54.8,53.2,51.9,50.5,49.4,48.6],day:0}),at=load('at','');
function draw(){var i,max=1;page('AI 余额',KEY?stamp(at):'示例余额','确认立即刷新','刷新');ui.text(M,46,'DeepSeek',2,0);var s=fx(S.t,2);ui.text(W-M-tw(s,3)-6,44,s,3,0);right(W-M,108,S.c+' 余额',0);ui.text(M,88,'充值 '+fx(S.p,2)+'  赠送 '+fx(S.g,2),1,0);box(M,132,W-2*M,1,0);
 ui.text(M,146,KEY?'最近 7 天余额':'填 API Key 后同步真实余额',1,0);for(i=0;i<S.h.length;i++)if(S.h[i]>max)max=S.h[i];for(i=0;i<S.h.length;i++){var h=Math.floor(S.h[i]*80/max);ui.rect(M+i*54,256-h,40,h,i===S.h.length-1?0:10);box(M+i*54,256-h,40,h,0);}ui.present();}
function pull(){if(KEY)net.request({key:'b',url:'https://api.deepseek.com/user/balance',headers:'Authorization: Bearer '+KEY});}
function on_net(k,st,b){var j=parse(st,b),o=j&&j.balance_infos&&j.balance_infos[0];if(!o){OFF=true;draw();return;}OFF=false;S.t=+o.total_balance;S.p=+o.topped_up_balance;S.g=+o.granted_balance;S.c=o.currency;var c=clock();if(c.day!==S.day){S.day=c.day;S.h.push(S.t);if(S.h.length>7)S.h.shift();}else if(S.h.length)S.h[S.h.length-1]=S.t;at=hm();cached('s',S);save('at',at);draw();}
function on_tick(){pull();}
function on_start(){draw();pull();ui.tick(60000);}
function on_key(k){if(k==='ok'||k==='wave'||k==='up'||k==='down'){pull();draw();}}`;
const monitor=`var B=KEY.replace(/\\/$/,''),IS_RELAY=B.indexOf('/api/relay/')>=0,S=load('m',{v:[['CPU',22,[16,20,18,28,24,19,22]],['内存',46,[42,44,45,48,47,46,46]],['交换',8,[8,8,9,8,8,8,8]],['磁盘',54,[53,53,54,54,54,54,54]]],nm:'中转监控台',at:''});
function put(i,v){if(typeof v!=='number'||isNaN(v))return;var t=S.v[i];t[1]=Math.max(0,Math.min(100,Math.round(v)));t[2].push(t[1]);if(t[2].length>7)t[2].shift();}
function draw(){var i,k;page('电脑副屏',B?stamp(S.at):'演示状态','确认立即刷新','刷新');
 for(i=0;i<4;i++){var t=S.v[i],y2=40+i*55;ui.text(M,y2,t[0],1,0);ui.text(M,y2+20,t[1]+'%',2,0);bar(110,y2+26,160,14,t[1],100);box(110,y2+26,160,14,0);ui.text(110,y2,i===0?clip(S.nm,160):'',1,0);for(k=0;k<t[2].length;k++){var h=Math.max(2,Math.floor(t[2][k]*46/100));ui.rect(290+k*14,y2+48-h,10,h,0);}}
 ui.present();}
function pull(){if(!B)return;if(IS_RELAY)net.request({key:'r',url:B});else{net.request({key:'q',url:B+'/api/4/quicklook'});net.request({key:'f',url:B+'/api/4/fs'});}}
function on_net(k,st,b){var j=parse(st,b);if(!j){OFF=true;draw();return;}OFF=false;if(k==='r'){var s=j.state||{};put(0,s.cpu);put(1,s.mem);put(2,s.swap);put(3,s.disk);if(s.cpu_name)S.nm=String(s.cpu_name);}else if(k==='q'){put(0,j.cpu);put(1,j.mem);put(2,j.swap);S.nm=j.cpu_name||'LAN Host';}else if(j[0])put(3,j[0].percent);S.at=hm();cached('m',S);draw();}
function on_tick(){pull();}
function on_start(){draw();pull();ui.tick(60000);}
function on_key(k){if(k==='ok'||k==='wave'||k==='up'||k==='down'){pull();draw();}}`;
const hot=`var T=[['微博','weibo'],['知乎','zhihu'],['百度','baidu']],B=[load('h0',[]),load('h1',[]),load('h2',[])],at=load('at',''),t=0,cur=0;
function draw(){var L=B[t],i;page('热搜榜',stamp(at),'上下选择','换榜单');for(i=0;i<T.length;i++){var on=i===t,x=M+i*70;if(on)ui.rect(x,38,64,24,0);else box(x,38,64,24,0);cx(x,64,42,T[i][0],1,on?15:0);}
 if(!L.length)center(150,'正在获取榜单',1,0);
 for(i=0;i<L.length;i++){var y=68+i*32,s=i===cur;if(s)ui.rect(M,y,W-2*M,30,0);var c=s?15:0,r=String(i+1);if(i<3&&!s)ui.rect(M+6,y+5,20,20,0);cx(M+6,20,y+7,r,1,i<3&&!s?15:c);ui.text(M+36,y+7,clip(L[i][0],L[i][1]?250:320),1,c);right(W-M-10,y+7,L[i][1],c);}ui.present();}
function pull(){var i;for(i=0;i<T.length;i++)net.request({key:'h'+i,url:'https://uapis.cn/api/v1/misc/hotboard?type='+T[i][1]});}
function on_net(k,st,b){var n=+k.slice(1),j=parse(st,b),a=[],i;if(!j||!j.list){OFF=true;if(n===t)draw();return;}OFF=false;for(i=0;i<j.list.length&&i<6;i++)a.push([j.list[i].title.slice(0,24),String(j.list[i].hot_value||'').slice(0,6)]);B[n]=a;at=hm();cached('h'+n,a);save('at',at);if(n===t)draw();}
function on_tick(){pull();}
function on_start(){draw();pull();ui.tick(60000);}
function on_key(k){var n=B[t].length||1;if(k==='up')cur=(cur+n-1)%n;else if(k==='down')cur=(cur+1)%n;else if(k==='ok'||k==='wave'){t=(t+1)%T.length;cur=0;}else return;draw();}`;
const news=`var T=[['澎湃','thepaper'],['36氪','36kr']],D=[load('n0',[]),load('n1',[])],at=load('at',''),i=0;
function all(){var a=[],n,k;for(k=0;k<D.length;k++)for(n=0;n<D[k].length;n++)a.push([T[k][0],D[k][n]]);return a;}
function draw(){var N=all(),t;page('每日新闻',stamp(at),'上下翻条','下一条');if(!N.length){center(130,'正在获取新闻',2,0);ui.present();return;}if(i>=N.length)i=0;t=N[i];ui.rect(M,44,tw(t[0])+16,24,0);ui.text(M+8,48,t[0],1,15);right(W-M,48,(i+1)+' / '+N.length,0);ui.text(M,84,t[1],2,0,W-2*M);bar(M,252,W-2*M,4,i+1,N.length);ui.present();}
function pull(){var k;for(k=0;k<T.length;k++)net.request({key:'n'+k,url:'https://uapis.cn/api/v1/misc/hotboard?type='+T[k][1]});}
function on_net(k,st,b){var n=+k.slice(1),j=parse(st,b),a=[],q;if(!j||!j.list){OFF=true;draw();return;}OFF=false;for(q=0;q<j.list.length&&q<10;q++)a.push(j.list[q].title.slice(0,33));D[n]=a;at=hm();cached('n'+n,a);save('at',at);draw();}
function on_tick(){pull();}
function on_start(){draw();pull();ui.tick(600000);}
function on_key(k){var n=all().length||1;if(k==='up')i=(i+n-1)%n;else if(k==='down'||k==='ok'||k==='wave')i=(i+1)%n;else return;draw();}`;
const oil=`var S=load('s',{l:[],d:''}),at=load('at',''),cur=load('c',-1);
function tile2(x,n,v){box(x,158,88,88,0);cx(x,88,170,n,1,0);cx(x,88,200,fx(v,2),1,0);}
function draw(){if(!S.l.length){page('今日油价',stamp(at),'上下换地区','下个地区');center(130,'正在获取油价',2,0);ui.present();return;}if(cur<0||cur>=S.l.length)cur=0;var t=S.l[cur];page('今日油价 '+t[0],stamp(at),'上下换地区','下个地区');ui.text(M,50,'92 号',1,0);ui.text(M,74,fx(t[1],2),4,0);right(W-M,56,'元/升',0);right(W-M,84,(t[5]>=0?'上调 ':'下调 ')+fx(Math.abs(t[5]),2),0);right(W-M,112,'调价 '+S.d,0);tile2(M,'95 号',t[2]);tile2(M+96,'98 号',t[3]);tile2(M+192,'0 号柴',t[4]);ui.present();}
function pull(){net.request({key:'o',url:'https://v2.xxapi.cn/api/oilPrice'});}
function on_net(k,st,b){var j=parse(st,b),a=[],i,o;if(!j||!j.data){OFF=true;draw();return;}OFF=false;for(i=0;i<j.data.length;i++){o=j.data[i];a.push([o.regionName.replace('省','').replace('市',''),o.n92,o.n95,o.n98,o.n0,o.n92Change]);if(cur<0&&o.regionName.indexOf('北京')===0)cur=i;}S={l:a,d:j.data[0].date.slice(5)};at=hm();cached('s',S);save('at',at);draw();}
function on_tick(){pull();}
function on_start(){draw();pull();ui.tick(3600000);}
function on_key(k){var n=S.l.length||1;if(k==='up')cur=(cur+n-1)%n;else if(k==='down'||k==='ok'||k==='wave')cur=(cur+1)%n;else return;save('c',cur);draw();}`;
const horoscope=`var Z=['白羊','金牛','双子','巨蟹','狮子','处女','天秤','天蝎','射手','摩羯','水瓶','双鱼'],E=['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'],F=['综合','爱情','事业','财运'],i=load('i',0),D={};
function draw(){var k,j,d=D[i];page('星座运势 '+Z[i]+'座',d?stamp(d.at):stamp(''),'上下换星座','下一个');cx(M,130,62,Z[i],3,0);cx(M,130,132,d?'幸运数字 '+d.n:'',1,0);ui.rect(150,46,1,114,0);
 for(k=0;k<4;k++){var y=46+k*29;ui.text(166,y,F[k],1,0);for(j=0;j<5;j++){if(d&&j<d.f[k])ui.rect(220+j*32,y+1,26,14,0);else box(220+j*32,y+1,26,14,0);}}
 ui.rect(M,176,W-2*M,1,0);ui.text(M,194,d?d.t:'正在获取今日运势',1,0,W-2*M);ui.present();}
function pull(){net.request({key:'z',url:'https://v2.xxapi.cn/api/horoscope?type='+E[i]+'&time=today'});}
function on_net(k,st,b){var j=parse(st,b),d=j&&j.data;if(!d||!d.fortune){OFF=true;draw();return;}OFF=false;var t=d.fortunetext.all,c=t.lastIndexOf('星');if(c>t.length-8)t=t.slice(0,c);D[i]={at:hm(),n:d.luckynumber,f:[d.fortune.all,d.fortune.love,d.fortune.work,d.fortune.money],t:t.slice(0,66)};draw();}
function on_tick(){pull();}
function on_start(){draw();pull();ui.tick(3600000);}
function on_key(k){if(k==='up')i=(i+11)%12;else if(k==='down'||k==='ok'||k==='wave')i=(i+1)%12;else return;save('i',i);draw();if(!D[i])pull();}`;
const fridge=`var S=load('s',{t:[['牛奶',1],['鸡蛋',6],['菠菜',2],['酸奶',4],['豆腐',3],['排骨',12]],last:0}),cur=0,top=0,R=5,EX=clock().ok?0:1;
function age(){var c=clock(),i;if(!c.ok)return;if(S.last&&c.day>S.last)for(i=0;i<S.t.length;i++)S.t[i][1]-=c.day-S.last;if(S.last!==c.day){S.last=c.day;save('s',S);}}
function sort(){S.t.sort(function(a,b){return a[1]-b[1];});}
function draw(){var i,n=S.t.length+EX,soon=0;for(i=0;i<S.t.length;i++)if(S.t[i][1]<=2)soon++;page('冰箱保质期','共 '+S.t.length+' 样','上下选择  确认吃掉','吃掉最急的');ui.text(M,42,String(soon),2,0);ui.text(M+tw(String(soon),2)+8,54,'样两天内到期',1,0);
 if(cur<top)top=cur;if(cur>=top+R)top=cur-R+1;for(i=top;i<n&&i<top+R;i++){var y=84+(i-top)*35,on=i===cur,c=on?15:0;if(on)ui.rect(M,y,W-2*M,33,0);if(i===S.t.length){ui.text(M+10,y+8,'过了一天',1,c);continue;}var t=S.t[i],k,lab=t[1]<=0?'已过期':t[1]+' 天';ui.text(M+10,y+8,t[0],1,c);for(k=0;k<7;k++){if(k<Math.min(7,t[1]))ui.rect(150+k*20,y+11,16,10,c);else box(150+k*20,y+11,16,10,c);}right(W-M-10,y+8,lab,c);}ui.present();}
function eat(i){S.t.splice(i,1);save('s',S);if(cur>S.t.length)cur=S.t.length;}
function on_start(){age();sort();draw();}
function on_key(k){var n=S.t.length+EX,i;if(!n)return;if(k==='up')cur=(cur+n-1)%n;else if(k==='down')cur=(cur+1)%n;else if(k==='ok'){if(cur<S.t.length)eat(cur);else{for(i=0;i<S.t.length;i++)S.t[i][1]--;save('s',S);}}else if(k==='wave'){if(S.t.length)eat(0);}else return;draw();}`;
const ledger=`var C=['餐饮','交通','购物','居家','娱乐','医疗'],AC=['微信','支付宝','银行卡'],S=load('s',{m:1286,mo:0,l:[['餐饮',38,'微信'],['交通',12,'支付宝'],['购物',199,'银行卡']]}),v='home',c=0,a=30,ac=0;
function draw(){var i;if(v==='home'){page('家庭记账',clock().ok?clock().m+' 月':'','确认记一笔','再记一笔');ui.text(M,44,'本月支出',1,0);ui.text(M,66,S.m+' 元',3,0);var pb=Math.min(S.m,5000);right(W-M,48,'预算 5000',0);bar(240,76,146,12,pb,5000);box(240,76,146,12,0);ui.rect(M,132,W-2*M,1,0);for(i=0;i<S.l.length&&i<3;i++){var y=142+i*38,t=S.l[S.l.length-1-i];ui.text(M,y+6,t[0],1,0);ui.text(120,y+6,t[2]+' 付款',1,0);right(W-M,y+6,'-'+t[1],0);}}
 else if(v==='cat'){page('记一笔 选类别','','上下选择  确认下一步','换账户');for(i=0;i<6;i++){var x=M+(i%3)*126,y2=46+Math.floor(i/3)*82,on=i===c;if(on)ui.rect(x,y2,120,74,0);else box(x,y2,120,74,0);cx(x,120,y2+28,C[i],1,on?15:0);}center(218,AC[ac]+' 付给 '+C[c],2,0);}
 else{page('记一笔 输金额','','上减  下加  确认保存','加 10');center(64,C[c]+'  '+AC[ac],1,0);center(104,a+' 元',4,0);center(204,'复式：'+AC[ac]+' 减少，'+C[c]+' 增加',1,0);}ui.present();}
function add(t){S.m+=t[1];S.l.push(t);if(S.l.length>12)S.l.shift();save('s',S);}
function on_start(){var cl=clock();if(cl.ok&&S.mo!==cl.m){if(S.mo){S.m=0;S.l=[];}S.mo=cl.m;save('s',S);}draw();}
function on_key(k){var n=C.length;if(v==='home'){if(k==='ok')v='cat';else if(k==='wave'&&S.l.length)add(S.l[S.l.length-1].slice(0));else return;}else if(v==='cat'){if(k==='up')c=(c+n-1)%n;else if(k==='down')c=(c+1)%n;else if(k==='ok')v='amt';else if(k==='wave')ac=(ac+1)%AC.length;else return;}else{if(k==='up')a=Math.max(1,a-5);else if(k==='down')a=Math.min(9999,a+5);else if(k==='wave')a=Math.min(9999,a+10);else if(k==='ok'){add([C[c],a,AC[ac]]);v='home';}else return;}draw();}`;
const photo=`var N=ui.frame(),i=load('i',0);
function draw(){if(!N){frame('随机相框','','');center(130,'还没有照片',2,0);center(180,'回到网页点换一批',1,0);ui.present();return;}if(i>=N)i=0;ui.frame(i);var s=(i+1)+' / '+N,w=tw(s)+16;ui.rect(W-w-8,268,w,24,15);ui.text(W-w,272,s,1,0);ui.present();}
function on_start(){draw();}
function on_key(k){if(!N)return;if(k==='up')i=(i+N-1)%N;else if(k==='down'||k==='ok'||k==='wave')i=(i+1)%N;else return;save('i',i);draw();}`;
const onthisday=`var S=load('s',{e:[],k:''}),i=0;
function title(){var c=clock();return c.ok?c.m+' 月 '+c.d+' 日':'';}
function draw(){var t=S.e[i];page('历史上的今天',title(),'上下翻条','下一条');if(!t){center(130,'正在获取',2,0);ui.present();return;}ui.text(M,44,t[0],4,0);right(W-M,60,(i+1)+' / '+S.e.length,0);ui.text(M,130,t[1],2,0,W-2*M);ui.present();}
function pull(){net.request({key:'h',url:'https://v2.xxapi.cn/api/history'});}
function on_net(k,st,b){var j=parse(st,b),a=[],q,x;if(!j||!j.data){OFF=true;draw();return;}OFF=false;for(q=0;q<j.data.length&&q<12;q++){x=j.data[q];a.push([x.slice(0,4),x.slice(x.indexOf(' ')+1).slice(0,30)]);}S={e:a,k:title()};i=0;cached('s',S);draw();}
function on_tick(){if(S.k!==title())pull();}
function on_start(){draw();if(S.k!==title()||!S.e.length)pull();ui.tick(600000);}
function on_key(k){var n=S.e.length||1;if(k==='up')i=(i+n-1)%n;else if(k==='down'||k==='ok'||k==='wave')i=(i+1)%n;else return;draw();}`;
const door=`var ST=[['在工位','欢迎直接来找我'],['会议中','散会后回复你'],['专注中','有事请挥手留言'],['外出','下午回来']],MSG=['我稍后找你','东西放桌上了','急事请打电话'],S=load('s',{s:1,n:0}),m=0;
function draw(){var t=ST[S.s];ui.clear(15);ui.rect(0,0,W,186,0);ui.text(20,16,'工位 A-207  产品部',1,15);cx(0,W,62,t[0],4,15);cx(0,W,146,t[1],1,15);
 ui.text(20,204,'留言',1,0);ui.text(66,198,String(S.n),2,0);ui.text(120,204,MSG[m],1,0);ui.rect(M,240,W-2*M,1,0);ui.text(M,250,'确认换状态  上下换留言',1,0);var w='敲门留言',k=tw(w);right(W-M,250,w,0);hand(W-M-k-19,251,0);ui.present();}
function on_start(){draw();}
function on_key(k){if(k==='ok')S.s=(S.s+1)%ST.length;else if(k==='up')m=(m+MSG.length-1)%MSG.length;else if(k==='down')m=(m+1)%MSG.length;else if(k==='wave')S.n++;else return;save('s',S);draw();}`;
const friday=`var WK='一二三四五六日',S=load('s',{d:4}),T=-1;
function real(){var c=clock();return c.ok?(c.w+6)%7:-1;}
function draw(){var i,yes=S.d===4,left=(4-S.d+7)%7;ui.clear(15);center(16,T===S.d?'今天是周五吗？':'如果今天是这天',1,0);if(yes){ui.rect(M,48,W-2*M,142,0);center(68,'是！',4,15);center(150,'下班去快活',1,15);}else{box(M,48,W-2*M,142,0);center(68,'不是',4,0);center(150,'距离周五还有 '+left+' 天',1,0);}
 for(i=0;i<7;i++){var x=M+i*53,on=i===S.d;if(on)ui.rect(x,202,48,44,0);else box(x,202,48,44,0);if(i===T&&!on)ui.rect(x+18,240,12,3,0);cx(x,48,216,WK.charAt(i),1,on?15:0);}ui.text(M,262,'上下拨日子  确认回今天',1,0);var w='过一天',k=tw(w);right(W-M,262,w,0);hand(W-M-k-19,263,0);ui.present();}
function sync(){var t=real();if(t!==T){T=t;if(t>=0)S.d=t;draw();}}
function on_tick(){sync();}
function on_start(){T=real();if(T>=0)S.d=T;draw();ui.tick(60000);}
function on_key(k){if(k==='up')S.d=(S.d+6)%7;else if(k==='down'||k==='wave')S.d=(S.d+1)%7;else if(k==='ok'){if(T>=0)S.d=T;else S.d=(S.d+1)%7;}else return;save('s',S);draw();}`;
const pet=`var S=load('s',{f:60,j:70,e:80,n:3}),say='今天也请多指教',petted=false;
function body(x,y){ui.rect(x+20,y,120,10,0);ui.rect(x+8,y+10,144,12,0);ui.rect(x,y+22,160,88,0);ui.rect(x+8,y+110,144,10,0);ui.rect(x+20,y+120,120,8,0);ui.rect(x+20,y+128,28,10,0);ui.rect(x+112,y+128,28,10,0);
 var eye=S.e<30?2:petted?4:14;ui.rect(x+40,y+44-Math.floor(eye/2),20,eye,15);ui.rect(x+100,y+44-Math.floor(eye/2),20,eye,15);
 if(S.j>=50){ui.rect(x+60,y+78,40,6,15);ui.rect(x+54,y+72,8,8,15);ui.rect(x+98,y+72,8,8,15);}else{ui.rect(x+62,y+78,36,6,15);}
 if(petted){ui.rect(x+22,y+64,14,6,10);ui.rect(x+124,y+64,14,6,10);}}
function stat(y,n,v){ui.text(258,y,n,1,0);bar(296,y+3,90,10,v,100);box(296,y+3,90,10,0);}
function draw(){page('墨团','养了 '+S.n+' 天','确认喂食  上玩耍  下睡觉','摸摸');body(44,70);center(40,say,1,0);stat(90,'饱腹',S.f);stat(124,'开心',S.j);stat(158,'精力',S.e);ui.present();}
function cap(v){return Math.max(0,Math.min(100,v));}
function on_start(){draw();}
function on_key(k){petted=false;if(k==='ok'){S.f=cap(S.f+20);S.e=cap(S.e-5);say='好吃！再来一口';}else if(k==='up'){S.j=cap(S.j+20);S.f=cap(S.f-10);S.e=cap(S.e-10);say='再玩一会儿嘛';}else if(k==='down'){S.e=cap(S.e+30);S.f=cap(S.f-5);say='呼噜噜';}else if(k==='wave'){S.j=cap(S.j+8);petted=true;say='蹭蹭你的手';}else return;save('s',S);draw();}`;
const robot=`var S=load('s',{m:[{id:'m1',from:'中转台',who:'内网助手',text:'今晚八点发版，确认后按确定键回执'},{id:'m2',from:'微信',who:'设计师',text:'新版桌面组件已对齐，请查收'}],at:''}),cur=0,r=0,RE=['好的，收到','稍后回复','现在不方便'];
function draw(){var t=S.m[cur],i;page('消息遥控台',(KEY?stamp(S.at):'演示模式')+'  未读 '+S.m.length,'上下换回复  确认发送','下一条');if(!t){center(116,'全部处理完啦',2,0);center(168,'内网新消息推送后会出现在这里',1,0);ui.present();return;}ui.rect(M,42,tw(t.from)+16,24,0);ui.text(M+8,46,t.from,1,15);ui.text(M+tw(t.from)+26,46,clip(t.who,200),1,0);right(W-M,46,(cur+1)+' / '+S.m.length,0);ui.text(M,84,t.text.slice(0,36),2,0,W-2*M);
 ui.rect(M,176,W-2*M,1,0);for(i=0;i<3;i++){var x=M+i*126,on=i===r;if(on)ui.rect(x,190,120,56,0);else box(x,190,120,56,0);cx(x,120,210,RE[i],1,on?15:0);}ui.present();}
function pull(){if(KEY)net.request({key:'m',url:KEY});}
function on_net(k,st,b){if(k!=='m')return;var j=parse(st,b);if(!j||!j.messages){OFF=true;draw();return;}OFF=false;S={m:j.messages.slice(0,8),at:hm()};if(cur>=S.m.length)cur=0;cached('s',S);draw();}
function send(){var t=S.m[cur],dst=RELAY?RELAY+'/outbox':KEY;if(dst)net.request({key:'reply',url:dst,method:'POST',headers:'Content-Type: application/json',body:JSON.stringify({id:t.id,action:'reply',text:RE[r]}),keep:true});S.m.splice(cur,1);if(cur>=S.m.length)cur=0;cached('s',S);}
function on_tick(){pull();}
function on_start(){draw();pull();ui.tick(60000);}
function on_key(k){if(!S.m.length){pull();draw();return;}if(k==='up')r=(r+2)%3;else if(k==='down')r=(r+1)%3;else if(k==='ok')send();else if(k==='wave')cur=(cur+1)%S.m.length;else return;draw();}`;
const WX=['晴',1,'少云',2,'多云',3,'阴',45,'雾',51,'毛毛雨',61,'小雨',63,'中雨',65,'大雨',71,'小雪',73,'中雪',75,'大雪',80,'阵雨',95,'雷雨'];
const weather=`var CT=[['北京',39.9,116.4],['上海',31.23,121.47],['广州',23.13,113.26],['深圳',22.54,114.06],['成都',30.57,104.07],['杭州',30.27,120.15]],WX=${JSON.stringify(WX)},i=load('i',0),D={},WD='日一二三四五六';
function wx(c){var n,s='晴';for(n=0;n<WX.length;n+=2){if(c>=WX[n+1])s=WX[n+2]||s;}return c===0?'晴':s;}
function draw(){var d=D[i],k;page('天气 '+CT[i][0],d?stamp(d.at):stamp(''),'上下换城市','下个城市');if(!d){center(130,'正在获取天气',2,0);ui.present();return;}ui.text(M,50,d.t+'度',4,0);right(W-M,60,wx(d.c),0);right(W-M,88,'今日 '+d.d[0][1]+' 到 '+d.d[0][2]+' 度',0);ui.rect(M,146,W-2*M,1,0);
 for(k=0;k<3;k++){var x=M+k*126,e=d.d[k];box(x,158,120,88,0);cx(x,120,168,k===0?'今天':k===1?'明天':'后天',1,0);cx(x,120,194,wx(e[0]),1,0);cx(x,120,218,e[2]+' / '+e[1],1,0);}ui.present();}
function pull(){net.request({key:'w',url:'https://api.open-meteo.com/v1/forecast?latitude='+CT[i][1]+'&longitude='+CT[i][2]+'&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FShanghai&forecast_days=3'});}
function on_net(k,st,b){var j=parse(st,b),q,a=[];if(!j||!j.current){OFF=true;draw();return;}OFF=false;for(q=0;q<3;q++)a.push([j.daily.weather_code[q],Math.round(j.daily.temperature_2m_max[q]),Math.round(j.daily.temperature_2m_min[q])]);D[i]={at:hm(),t:Math.round(j.current.temperature_2m),c:j.current.weather_code,d:a};draw();}
function on_tick(){pull();}
function on_start(){draw();pull();ui.tick(600000);}
function on_key(k){var n=CT.length;if(k==='up')i=(i+n-1)%n;else if(k==='down'||k==='ok'||k==='wave')i=(i+1)%n;else return;save('i',i);draw();if(!D[i])pull();}`;
const reveal=`var N=ui.frame(),i=0,play=true,SP=[400,200,130,100],sp=2;
function draw(){if(!N){frame('墨迹显影','','');center(130,'动图帧没有附带',1,0);ui.present();return;}ui.frame(i);ui.text(10,14,'墨迹',2,0);ui.text(10,58,'显影',2,0);ui.text(10,116,(i+1)+'/'+N,1,0);bar(10,140,84,6,i+1,N);ui.text(10,160,play?'播放中':'已暂停',1,0);ui.text(10,186,'速度 '+(sp+1),1,0);ui.text(10,226,'上下 快慢',1,0);ui.text(10,248,'确认 暂停',1,0);hand(10,271,0);ui.text(28,270,'暂停',1,0);ui.present();}
function on_tick(){i=(i+1)%N;draw();}
function run(){ui.tick(play&&N?SP[sp]:0);}
function on_start(){draw();run();}
function on_key(k){if(k==='ok'||k==='wave')play=!play;else if(k==='up')sp=Math.min(3,sp+1);else if(k==='down')sp=Math.max(0,sp-1);else return;run();draw();}`;

// ---- 10 Imaginative New Templates (v2.0) ----
const relay_board=`var S=load('rb',{m:[{id:'n1',from:'电脑便签',who:'内网终端',text:'下午三点前把接口文档发群里，顺便买杯热美式'},{id:'n2',from:'手机投递',who:'备忘',text:'回家记得拿丰巢快递，取件码 6-2-8810'}],ack:{},at:''}),cur=0;
function draw(){var list=S.m,n=list.length,t=list[cur];
 page('云端桌贴',KEY?stamp(S.at):'中转就绪','上下翻便签  确认回执','盖章已阅');
 if(!n){center(122,'桌贴信箱空空如也',2,0);center(172,'从网页或内网电脑发一句就会贴在桌上',1,0);ui.present();return;}
 box(M,42,372,172,0);ui.rect(M+3,214,372,3,0);ui.rect(386,45,3,172,0);
 var tag=clip(t.from||'投递',80),tw1=tw(tag)+16;ui.rect(26,54,tw1,22,0);ui.text(34,57,tag,1,15);
 ui.text(34+tw1+8,57,clip(t.who||'',140),1,0);right(374,57,(cur+1)+'/'+n,0);
 ui.text(26,90,t.text.slice(0,28),2,0,344);
 if(S.ack[t.id]){ui.rect(306,178,68,24,0);cx(306,68,182,'已阅',1,15);}else{box(306,178,68,24,0);cx(306,68,182,'待确认',1,0);}
 ui.text(M,232,S.ack[t.id]?'已向中转站回传已阅回执':'按确认或挥手回传「已阅」到电脑收件箱',1,0);
 ui.present();}
function pull(){if(KEY)net.request({key:'rb',url:KEY});}
function on_net(k,st,b){if(k!=='rb')return;var j=parse(st,b);if(!j){OFF=true;draw();return;}OFF=false;if(j.messages&&j.messages.length)S.m=j.messages.slice(0,10);else if(j.state&&j.state.note)S.m=[{id:'st',from:'状态推送',who:'中转台',text:String(j.state.note)}];if(cur>=S.m.length)cur=0;S.at=hm();cached('rb',S);draw();}
function ack(){if(!S.m.length)return;var t=S.m[cur],dst=RELAY?RELAY+'/outbox':(KEY?KEY+'/outbox':'');S.ack[t.id]=1;if(dst)net.request({key:'ack',url:dst,method:'POST',headers:'Content-Type: application/json',body:JSON.stringify({action:'ack',text:'已阅: '+t.text.slice(0,24)}),keep:true});cached('rb',S);}
function on_tick(){pull();}
function on_start(){draw();pull();ui.tick(60000);}
function on_key(k){var n=S.m.length||1;if(k==='up')cur=(cur+n-1)%n;else if(k==='down')cur=(cur+1)%n;else if(k==='ok'||k==='wave')ack();else return;draw();}`;

const claude_hud=`var S=load('hud',{task:'重构墨水屏中转引擎',st:'RUNNING',pct:72,step:'WASM 边界与离线回放通过',tok:'18.4k',q:2,at:'',ok:0});
function draw(){page('AI 任务盯盘',KEY?stamp(S.at):'中转演示','确认批准继续  上下刷新','批准放行');
 var st=clip(S.st,96),sw=tw(st)+16;ui.rect(M,42,sw,24,0);ui.text(M+8,46,st,1,15);ui.text(M+sw+10,46,clip(S.task,250),1,0);
 ui.text(M,76,S.pct+'%',3,0);ui.text(136,80,clip(S.step,250),1,0);bar(136,106,250,14,S.pct,100);box(136,106,250,14,0);
 tile(M,138,120,54,'阶段进度',S.pct+'%',false);tile(M+126,138,120,54,'Token 用量',S.tok,false);tile(M+252,138,120,54,'待办队列',S.q+' 项',S.ok>0);
 row(208,38,S.ok?'已向内网任务发送放行指令':'挥手或按确认：向内网 Agent 发送放行信号',S.ok>0);
 ui.present();}
function pull(){if(KEY)net.request({key:'h',url:KEY});}
function on_net(k,st,b){if(k!=='h')return;var j=parse(st,b),s=j&&j.state;if(!s){OFF=true;draw();return;}OFF=false;if(s.task)S.task=String(s.task);if(s.status)S.st=String(s.status);if(typeof s.progress==='number')S.pct=Math.max(0,Math.min(100,Math.round(s.progress)));if(s.step||s.note)S.step=String(s.step||s.note);if(s.tokens)S.tok=String(s.tokens);if(typeof s.queue==='number')S.q=s.queue;S.ok=0;S.at=hm();cached('hud',S);draw();}
function approve(){var dst=RELAY?RELAY+'/outbox':(KEY?KEY+'/outbox':'');S.ok=1;if(dst)net.request({key:'go',url:dst,method:'POST',headers:'Content-Type: application/json',body:JSON.stringify({action:'approve',text:'墨水屏拍板：批准继续执行下一步'}),keep:true});cached('hud',S);}
function on_tick(){pull();}
function on_start(){draw();pull();ui.tick(60000);}
function on_key(k){if(k==='ok'||k==='wave')approve();else if(k==='up'||k==='down')pull();else return;draw();}`;

const pomodoro=`var MINS=[25,45,15,5],NAMES=['标准专注','深度心流','快冲刺','小憩休息'],S=load('pm',{m:0,left:25,run:true,trees:3});
function tree(st){ui.rect(50,208,88,8,0);ui.rect(58,216,72,26,0);ui.rect(88,176,12,32,0);
 if(st>=1)ui.rect(68,154,52,22,0);
 if(st>=2)ui.rect(54,128,80,28,0);
 if(st>=3)ui.rect(64,102,60,28,0);
 if(st>=4){ui.rect(78,80,32,24,0);ui.rect(88,68,12,12,0);}}
function draw(){var tot=MINS[S.m],done=tot-S.left,st=Math.min(4,Math.floor(done*4/(tot||1))+1),i;
 page('种树番茄钟',NAMES[S.m],'确认暂停或继续  上下换档','完成种树');
 tree(S.left===0?4:st);
 ui.text(186,52,S.left+' 分钟',3,0);
 ui.text(186,112,S.m===3?'放松眼睛看远处':(S.run?'专注生长中':'已暂停，按确认继续'),1,0);
 bar(186,140,196,12,done,tot);box(186,140,196,12,0);
 ui.text(186,170,'今日森林 '+S.trees+' 棵',1,0);
 for(i=0;i<Math.min(8,S.trees);i++){var x=186+i*24;ui.rect(x+4,204,12,10,0);ui.rect(x+2,214,16,10,0);ui.rect(x+8,224,4,8,0);}
 ui.present();}
function step(){if(!S.run)return;if(S.left>0){S.left--;if(S.left===0&&S.m<3)S.trees++;save('pm',S);draw();}}
function on_tick(){step();}
function on_start(){draw();ui.tick(60000);}
function on_key(k){if(k==='ok')S.run=!S.run;else if(k==='up'){S.m=(S.m+3)%4;S.left=MINS[S.m];S.run=true;}else if(k==='down'){S.m=(S.m+1)%4;S.left=MINS[S.m];S.run=true;}else if(k==='wave'){if(S.m<3)S.trees++;S.m=S.m===3?0:3;S.left=MINS[S.m];S.run=true;}else return;save('pm',S);draw();}`;

const muyu=`var CH=['功德 +1','Bug 退散','心平气和','需求不改','编译全过'],S=load('my',{t:108,d:12,c:0}),hit=false;
function fish(){ui.rect(56,96,104,12,0);ui.rect(40,108,136,16,0);ui.rect(30,124,154,56,0);ui.rect(42,180,130,16,0);ui.rect(62,196,90,10,0);
 ui.rect(128,138,16,12,15);ui.rect(52,154,96,8,15);ui.rect(44,148,14,20,15);
 if(hit){ui.rect(158,72,14,40,0);ui.rect(150,64,30,14,0);box(34,46,114,30,0);cx(34,114,53,CH[S.c],1,0);}
 else{ui.rect(172,56,10,40,0);ui.rect(164,48,26,12,0);}}
function draw(){var i;page('赛博木鱼','心愿: '+CH[S.c],'确认敲击  上下换心愿','敲木鱼');
 fish();
 ui.text(214,50,'今日功德',1,0);ui.text(214,74,String(S.d),3,0);
 ui.text(214,138,'累计修行 '+S.t,1,0);ui.text(214,166,'十念成珠 '+(S.d%10)+'/10',1,0);
 for(i=0;i<10;i++){var x=214+i*17;if(i<(S.d%10||10)&&S.d>0)ui.rect(x,202,13,13,0);else box(x,202,13,13,0);}
 ui.present();}
function on_start(){draw();}
function on_key(k){if(k==='ok'||k==='wave'){S.d++;S.t++;hit=true;}else if(k==='up'){S.c=(S.c+CH.length-1)%CH.length;hit=false;}else if(k==='down'){S.c=(S.c+1)%CH.length;hit=false;}else return;save('my',S);draw();}`;

const iching=`var TRI=['坤','震','坎','兑','艮','离','巽','乾'],NAT=['地','雷','水','泽','山','火','风','天'],
NAMES=['坤为地','地雷复','地水师','地泽临','地山谦','地火明夷','地风升','地天泰','雷地豫','震为雷','雷水解','雷泽归妹','雷山小过','雷火丰','雷风恒','雷天大壮','水地比','水雷屯','坎为水','水泽节','水山蹇','水火既济','水风井','水天需','泽地萃','泽雷随','泽水困','兑为泽','泽山咸','泽火革','泽风大过','泽天夬','山地剥','山雷颐','山水蒙','山泽损','艮为山','山火贲','山风蛊','山天大畜','火地晋','火雷噬嗑','火水未济','火泽睽','火山旅','离为火','火风鼎','火天大有','风地观','风雷益','风水涣','风泽中孚','风山渐','风火家人','巽为风','风天小畜','天地否','天雷无妄','天水讼','天泽履','天山遁','天火同人','天风姤','乾为天'],
MOTTO=['厚德载物，顺势而行','一阳来复，生机渐显','行险而顺，步步为营','居高临下，宽以待人','谦谦君子，卑以自牧','韬光养晦，静待天明','积小成大，稳步上升','天地交泰，万事亨通'],
S=load('ic',{n:11});
function draw(){var n=S.n&63,lo=n&7,hi=(n>>3)&7,i;
 page('周易六十四卦','第 '+(n+1)+' 卦','上下翻阅卦象  确认起卦','诚心起卦');
 for(i=0;i<6;i++){var y=204-i*28,yang=(n>>i)&1;if(yang)ui.rect(28,y,126,14,0);else{ui.rect(28,y,52,14,0);ui.rect(102,y,52,14,0);}}
 ui.text(180,52,NAMES[n],2,0);
 ui.text(180,96,'上'+TRI[hi]+'('+NAT[hi]+')  下'+TRI[lo]+'('+NAT[lo]+')',1,0);
 ui.rect(180,124,206,1,0);
 ui.text(180,140,MOTTO[(lo+hi)%8],1,0,204);
 ui.text(180,192,'静心思考一事，挥手得新卦',1,0,204);
 ui.present();}
function cast(){var r=0,i;for(i=0;i<6;i++)if(Math.random()>=0.5)r|=(1<<i);if(r===S.n)r=(r+7)&63;S.n=r;}
function on_start(){draw();}
function on_key(k){if(k==='up')S.n=(S.n+63)%64;else if(k==='down')S.n=(S.n+1)%64;else if(k==='ok'||k==='wave')cast();else return;save('ic',S);draw();}`;

const coffee=`var REC=[['果香浅烘 15g',[30,120,225,225],['闷蒸 30 秒，唤醒香气','中心绕圈慢注至 120g','拉高水柱注满至 225g','移开滤杯，摇匀享用']],['醇厚拼配 20g',[40,160,300,300],['90度热水闷蒸 40g','均匀绕圈注水至 160g','中心定点注水至 300g','萃取完成，风味饱满']],['夏日冰冲 16g',[32,100,160,160],['壶底先放 80g 冰块','浓萃一段注水至 100g','缓慢收尾注水至 160g','摇晃融冰，冰爽出品']]],
S=load('cf',{r:0,st:1});
function cup(st){box(36,56,96,68,0);ui.rect(52,124,64,10,0);box(32,138,104,96,0);ui.rect(136,156,14,8,0);ui.rect(142,164,8,38,0);ui.rect(136,202,14,8,0);
 var h=st*20;if(h>0)ui.rect(36,230-h,96,h,st>=3?0:10);}
function draw(){var r=REC[S.r],st=S.st,i;
 page('手冲咖啡师',r[0],'确认下一段  上下换豆子','下一段');
 cup(st);
 ui.text(168,46,'第 '+(st+1)+' / 4 步',1,0);
 ui.text(168,72,r[1][st]+' g',3,0);
 ui.text(168,136,r[2][st],1,0,216);
 for(i=0;i<4;i++){var x=168+i*54,on=i===st;if(on)ui.rect(x,200,48,32,0);else box(x,200,48,32,0);cx(x,48,208,'P'+(i+1),1,on?15:0);}
 ui.present();}
function on_start(){draw();}
function on_key(k){if(k==='ok'||k==='wave')S.st=(S.st+1)%4;else if(k==='up'){S.r=(S.r+2)%3;S.st=0;}else if(k==='down'){S.r=(S.r+1)%3;S.st=0;}else return;save('cf',S);draw();}`;

const habit_grid=`var H=['早起','运动','阅读'],S=load('hg',{g:[1,2,3,1,0,2,3,3,2,1,3,2,0,1,2,3,2,3,1,2,3,3,2,1,2,3,3,1,2,3,0,2,3,1,2,3,2,3,3,1,2,0,1,3,2,3,3,2,1,3,2,3,1,2,3,3,2,1,3,2,3,2,1,3,3,2,3,1,2,3,2,1,3,3,2,3,1,2,3,2],t:[1,1,0],cur:0});
function draw(){var i,r,c,done=S.t[0]+S.t[1]+S.t[2],str=0;
 for(i=S.g.length-1;i>=0;i--){if(S.g[i]>0)str++;else break;}
 page('百日热力格','连续 '+str+' 天','上下选习惯  确认打卡','一键打卡');
 for(i=0;i<3;i++)tile(M+i*126,42,120,48,H[i],S.t[i]?'已打卡':'未打卡',i===S.cur);
 for(r=0;r<5;r++)for(c=0;c<16;c++){var idx=r*16+c,v=idx===79?done:S.g[idx],x=M+c*23,y=104+r*23;
  if(v>=3)ui.rect(x,y,20,20,0);else if(v===2){ui.rect(x,y,20,20,5);box(x,y,20,20,0);}else if(v===1){ui.rect(x,y,20,20,10);box(x,y,20,20,0);}else box(x,y,20,20,0);}
 ui.text(M,230,'右下格为今日热力  已完成 '+done+' / 3 项',1,0);
 ui.present();}
function on_start(){draw();}
function on_key(k){if(k==='up')S.cur=(S.cur+2)%3;else if(k==='down')S.cur=(S.cur+1)%3;else if(k==='ok')S.t[S.cur]=1-S.t[S.cur];else if(k==='wave')S.t=[1,1,1];else return;S.g[79]=S.t[0]+S.t[1]+S.t[2];save('hg',S);draw();}`;

const dungeon=`var W2=8,H2=5,CELL=33,S=load('dg',null),hz=true,msg='探索地牢，搜集宝箱与楼梯';
function gen(fl,hp,gd,pot){var m=[],r,c;for(r=0;r<H2;r++){m[r]=[];for(c=0;c<W2;c++)m[r][c]=0;}
 m[1][2]=1;m[3][5]=1;m[0][5]=2;m[4][2]=2;m[2][4]=3;m[2][6]=3;m[0][7]=4;m[4][7]=5;
 S={fl:fl,hp:hp,gd:gd,pot:pot,px:0,py:2,m:m};save('dg',S);}
function cell(x,y,t,me){var px=M+x*CELL,py=48+y*CELL;box(px,py,CELL-1,CELL-1,0);
 if(me){ui.rect(px+3,py+3,CELL-7,CELL-7,0);cx(px,CELL,py+8,'我',1,15);return;}
 if(t===1)ui.rect(px+2,py+2,CELL-5,CELL-5,5);
 else if(t===2)cx(px,CELL,py+8,'宝',1,0);
 else if(t===3)cx(px,CELL,py+8,'怪',1,0);
 else if(t===4)cx(px,CELL,py+8,'药',1,0);
 else if(t===5)cx(px,CELL,py+8,'梯',1,0);}
function draw(){var r,c;page('三键地牢 B'+S.fl,'金币 '+S.gd,hz?'上左 下右  确认改纵移':'上上 下下  确认改横移','喝药回血');
 for(r=0;r<H2;r++)for(c=0;c<W2;c++)cell(c,r,S.m[r][c],S.px===c&&S.py===r);
 tile(290,48,96,50,'生命值',S.hp+' / 10',false);
 tile(290,106,96,50,'移动方向',hz?'左右':'上下',true);
 tile(290,164,96,50,'随身药水',S.pot+' 瓶',false);
 ui.text(M,228,clip(msg,372),1,0);ui.present();}
function step(dx,dy){var nx=S.px+dx,ny=S.py+dy;if(nx<0||nx>=W2||ny<0||ny>=H2||S.m[ny][nx]===1){msg='前面是石墙，换个方向吧';return;}
 var t=S.m[ny][nx];if(t===3){S.hp=Math.max(1,S.hp-2);S.gd+=5;S.m[ny][nx]=0;msg='击败史莱姆！金币 +5，生命 -2';}
 else if(t===2){S.gd+=15;S.m[ny][nx]=0;S.px=nx;S.py=ny;msg='打开宝箱，获得 15 枚金币！';}
 else if(t===4){S.pot++;S.m[ny][nx]=0;S.px=nx;S.py=ny;msg='捡到恢复药水，挥手可饮用';}
 else if(t===5){gen(S.fl+1,S.hp,S.gd+10,S.pot);msg='踏入下一层 B'+S.fl+'，奖励 10 金币！';return;}
 else{S.px=nx;S.py=ny;msg='向前探索了一步';}save('dg',S);}
function on_start(){if(!S)gen(1,10,0,1);draw();}
function on_key(k){if(k==='ok')hz=!hz;else if(k==='wave'){if(S.pot>0){S.pot--;S.hp=Math.min(10,S.hp+4);msg='喝下药水，生命恢复 +4';save('dg',S);}else msg='药水已经喝完了';}
 else if(k==='up')step(hz?-1:0,hz?0:-1);else if(k==='down')step(hz?1:0,hz?0:1);else return;draw();}`;

const almanac=`var YI=['提交代码  一气呵成','准点下班  散步吹风','清理桌面  专注当下','早睡早起  读十页书','泡杯好茶  慢想方案','主动沟通  化繁为简','备份数据  稳字当头'],
JI=['深夜强改线上配置','空腹猛灌冰美式','开会不写结论纪要','同时开二十个标签','纠结一像素到凌晨','久坐三小时不起身','带着情绪回消息'],
LUCK=['今日签语：慢即是快，日拱一卒','今日签语：删繁就简，自有回响','今日签语：先做完，再做好','今日签语：心定则事成'],
WK='日一二三四五六',C=clock(),S=load('alm',{off:0,lk:0});
function draw(){var d=((C.d-1+S.off)%28+28)%28+1,w=((C.w+S.off)%7+7)%7,idx=(d+C.m)%7;
 page('桌面老黄历',C.m+' 月  周'+WK.charAt(w),'上下翻日子  确认回今天','抽今日签');
 ui.rect(M,40,372,26,0);cx(M,372,45,C.y+' 年 '+C.m+' 月  星期'+WK.charAt(w),1,15);
 center(76,String(d),4,0);
 box(M,150,180,68,0);ui.rect(M,150,40,68,0);cx(M,40,176,'宜',2,15);ui.text(62,162,YI[idx].slice(0,4),1,0);ui.text(62,188,YI[idx].slice(6),1,0);
 box(206,150,180,68,0);box(206,150,40,68,0);cx(206,40,176,'忌',2,0);ui.text(254,162,JI[idx].slice(0,8),1,0);ui.text(254,188,'诸事从容莫急躁',1,0);
 center(232,LUCK[S.lk%LUCK.length],1,0);ui.present();}
function on_start(){draw();}
function on_key(k){if(k==='up')S.off--;else if(k==='down')S.off++;else if(k==='ok')S.off=0;else if(k==='wave')S.lk++;else return;save('alm',S);draw();}`;

const fx_rates=`var CUR=[['美元','USD',0.138],['欧元','EUR',0.128],['日元','JPY',21.4],['港币','HKD',1.076],['英镑','GBP',0.109],['新元','SGD',0.186]],AMT=[100,1000,10000],
S=load('fx',{r:{},ai:0,rev:false,cur:0,at:''});
function rateOf(i){var c=CUR[i][1];return S.r[c]||CUR[i][2];}
function draw(){var base=AMT[S.ai],i;
 page('实时汇率换算',stamp(S.at),'上下选币种  确认换金额','切换方向');
 ui.rect(M,40,372,32,0);ui.text(24,48,S.rev?('外币 '+base+' 折合人民币'):('人民币 '+base+' 元可换外币'),1,15);right(376,48,'基准 '+base,15);
 for(i=0;i<6;i++){var x=M+(i%3)*126,y=82+Math.floor(i/3)*90,on=i===S.cur,rt=rateOf(i),val=S.rev?(base/rt):(base*rt),vs=fx(val,val>=100?0:2);
  if(on)ui.rect(x,y,120,80,0);else box(x,y,120,80,0);
  var c=on?15:0;ui.text(x+10,y+10,CUR[i][0]+' '+(S.rev?'折CNY':CUR[i][1]),1,c);ui.text(x+10,y+38,vs,2,c);}
 ui.present();}
function pull(){net.request({key:'fx',url:'https://open.er-api.com/v6/latest/CNY'});}
function on_net(k,st,b){if(k!=='fx')return;var j=parse(st,b);if(!j||!j.rates){OFF=true;draw();return;}OFF=false;var i,c;for(i=0;i<CUR.length;i++){c=CUR[i][1];if(j.rates[c])S.r[c]=j.rates[c];}S.at=hm();cached('fx',S);draw();}
function on_tick(){pull();}
function on_start(){draw();pull();ui.tick(3600000);}
function on_key(k){if(k==='up')S.cur=(S.cur+5)%6;else if(k==='down')S.cur=(S.cur+1)%6;else if(k==='ok')S.ai=(S.ai+1)%3;else if(k==='wave')S.rev=!S.rev;else return;save('fx',S);draw();}`;

const glass_clock=`var S=load('gc',{th:0,m:25,f:4}),WK=['周日','周一','周二','周三','周四','周五','周六'];
var QUOTES=['一寸光阴，静观纸墨流转','光影折射之间，保持内心澄明','慢下来，听见思考的声音'];
function tstr(){var c=clock();return c.ok?pad(c.h)+':'+pad(c.mi):'18:30';}
function dstr(){var c=clock();return c.ok?(c.y+'.'+pad(c.m)+'.'+pad(c.d)+'  '+WK[c.w]):'2026.11.20  周五';}
function draw(){
 var th=S.th,dark=th===1,paper=th===2;
 if(paper){
  ui.clear(15);
  ui.rbox(22,20,356,260,20,10,1);
  ui.font('sans');ui.text(42,36,dstr(),1,5);
  var ptag='纸墨社论',ptw=ui.measure(ptag)+24;
  ui.rrect(358-ptw,34,ptw,26,13,14);ui.text(358-ptw+12,37,ptag,1,4);
  ui.font('display_lg');var ts=tstr(),tw0=ui.measure(ts);
  ui.text(Math.floor((W-tw0)/2),76,ts,1,0);
  ui.line(104,142,296,142,10,1);
  ui.font('serif');var q=QUOTES[th%3],qw=ui.measure(q);
  ui.text(Math.floor((W-qw)/2),162,q,1,2);
  ui.rrect(42,216,150,44,12,14);ui.rrect(208,216,150,44,12,14);
  ui.font('sans');
  var s1='今日专注 '+S.f+' 次',s2='轻按切换风格';
  ui.text(42+Math.floor((150-ui.measure(s1))/2),228,s1,1,2);
  ui.text(208+Math.floor((150-ui.measure(s2))/2),228,s2,1,5);
  ui.font('pixel');ui.present('clear');return;
 }
 if(!dark){
  ui.grad(0,0,400,300,14,8,2);
  ui.circle(64,56,74,4);ui.circle(344,236,90,5);ui.circle(316,58,48,15);ui.circle(110,260,44,12);
 }else{
  ui.grad(0,0,400,300,15,10,2);
  ui.circle(86,70,78,6);ui.circle(324,218,86,4);ui.circle(290,64,46,12);
 }
 ui.glass(22,20,356,162,22,dark?2:14,7);
 var fg=dark?15:0,sub=dark?12:4;
 ui.font('sans');ui.text(42,36,dstr(),1,sub);
 var tag=dark?'黑曜玻璃':'冰霜玻璃',tgw=ui.measure(tag)+24;
 ui.rrect(358-tgw,34,tgw,26,13,dark?5:11);
 ui.text(358-tgw+12,37,tag,1,dark?15:1);
 ui.font('display_lg');var ts2=tstr(),tw2=ui.measure(ts2);
 ui.text(Math.floor((W-tw2)/2),70,ts2,1,fg);
 ui.font('serif');var q2=QUOTES[th%3],qw2=ui.measure(q2);
 ui.text(Math.floor((W-qw2)/2),136,q2,1,sub);
 ui.glass(22,194,172,86,18,dark?3:14,6);
 ui.glass(206,194,172,86,18,dark?3:14,6);
 ui.font('sans');ui.text(40,208,'今日专注',1,sub);ui.text(224,208,'轻按切风格',1,sub);
 ui.font('display');ui.text(40,232,S.f+'x'+S.m+'m',1,fg);
 ui.font('serif');ui.text(224,238,'16 灰精显',1,fg);
 ui.font('pixel');ui.present('clear');
}
function on_start(){draw();ui.tick(60000);}
function on_tick(){draw();}
function on_key(k){if(k==='up'||k==='down'||k==='wave')S.th=(S.th+1)%3;else if(k==='ok')S.f=(S.f%9)+1;else return;save('gc',S);draw();}`;

const glass_hub=`var S=load('gh',{tab:0,done:3,total:5,mins:75}),TABS=['专注概览','今日清单','运行状态'];
var TODOS=['打磨 16 灰液态玻璃','验证 4 灰快刷流畅度','实机测温与功耗检查','整理视觉组件规范'];
function draw(){
 ui.clear(14);
 ui.font('serif');ui.text(20,18,'NOTE4 视觉台',1,0);
 ui.font('sans');var modeTag='4 灰快刷',mtw=ui.measure(modeTag)+22;
 ui.rrect(380-mtw,18,mtw,26,13,5);ui.text(380-mtw+11,21,modeTag,1,15);
 var i;for(i=0;i<3;i++){var tx=20+i*123,on=S.tab===i;ui.rrect(tx,54,114,30,15,on?0:15);if(!on)ui.rbox(tx,54,114,30,15,8,1);var tw1=ui.measure(TABS[i]);ui.text(tx+Math.floor((114-tw1)/2),59,TABS[i],1,on?15:0);}
 ui.glass(20,96,360,152,18,15,3);
 if(S.tab===0){
  ui.font('display_lg');ui.text(40,112,S.mins+'m',1,0);
  ui.font('sans');ui.text(206,116,'今日心流达成',1,5);ui.text(206,144,'完成度 '+Math.round(S.done*100/S.total)+'%',1,0);
  ui.rrect(40,178,320,14,7,10);ui.rrect(40,178,Math.floor(320*S.done/S.total),14,7,0);
  ui.text(40,208,'按确定 +15 分钟专注 · 上下切换面板',1,5);
 }else if(S.tab===1){
  ui.font('sans');
  for(i=0;i<TODOS.length;i++){var y=112+i*31,fin=i<S.done;ui.circle(44,y+10,6,fin?0:10);ui.text(60,y,TODOS[i],1,fin?5:0);}
 }else{
  ui.font('display');ui.text(40,112,'0.5s',1,0);ui.text(196,112,'4-GRAY',1,0);
  ui.font('sans');ui.text(40,164,'调优 4 灰快刷 · 无黑闪响应',1,5);ui.text(40,196,'思源黑体 + 4-bit 粗宋体抗锯齿',1,0);
 }
 ui.font('pixel');ui.text(20,264,'上下 切标签   确认 互动   挥手 快切',1,5);
 ui.present();
}
function on_start(){draw();}
function on_key(k){if(k==='up')S.tab=(S.tab+2)%3;else if(k==='down'||k==='wave')S.tab=(S.tab+1)%3;else if(k==='ok'){if(S.tab===0)S.mins=(S.mins+15)%180||15;else if(S.tab===1)S.done=(S.done+1)%(TODOS.length+1);else S.tab=0;}else return;save('gh',S);draw();}`;

const typo_gallery=`var S=load('tg',{p:0}),NAMES=['16灰液态玻璃','字体排版对比','4灰快刷卡片','几何与渐变'];
function draw(){
 var p=S.p;
 if(p===0){
  ui.grad(0,0,400,300,14,7,2);
  ui.circle(68,64,72,3);ui.circle(336,226,88,4);ui.circle(312,56,42,11);ui.circle(96,246,42,13);
  ui.glass(20,20,218,166,20,14,7);
  ui.glass(250,20,130,166,20,1,7);
  ui.font('serif');ui.text(38,34,'液态玻璃',1,0);
  ui.font('display_lg');ui.text(38,68,'16:48',1,0);
  ui.font('sans');ui.text(38,128,'磨砂折射 · 柔影',1,2);ui.text(38,154,'16 级原生灰阶',1,4);
  ui.font('sans');ui.text(266,36,'黑曜透光',1,15);
  ui.font('display');ui.text(266,72,'24 °C',1,15);
  ui.font('sans');ui.text(266,128,'高光折边',1,13);ui.text(266,154,'清晰反白',1,15);
  ui.glass(20,200,360,78,18,14,6);
  ui.font('sans');ui.text(38,214,'1/4 · 16 灰液态玻璃实机演示',1,0);
  ui.text(38,244,'按 上 / 下 / 确定 切换 4 套视觉展板',1,4);
 }else if(p===1){
  ui.clear(15);
  ui.rrect(20,18,360,36,12,14);
  ui.font('serif');ui.text(34,24,'字体排版对比 · 2/4',1,0);
  ui.font('pixel');ui.text(22,64,'[旧] pixel 16px: 墨水屏视觉与文字 12:34',1,5);
  ui.line(22,88,378,88,12,1);
  ui.font('sans');ui.text(22,96,'[新] sans 20px 黑体：清晰均衡 12:34',1,0);
  ui.line(22,126,378,126,12,1);
  ui.font('serif');ui.text(22,134,'[新] serif 24px 宋体：纸墨书卷气',1,0);
  ui.line(22,170,378,170,12,1);
  ui.font('display');ui.text(22,178,'36px: 09:41  26 °C',1,2);
  ui.font('display_lg');ui.text(22,222,'48px: 18:30',1,0);
 }else if(p===2){
  ui.clear(14);
  ui.font('serif');ui.text(20,18,'4 灰阶快刷风格 · 3/4',1,0);
  ui.glass(20,56,174,120,16,15,3);ui.glass(206,56,174,120,16,15,3);
  ui.font('sans');ui.text(38,70,'今日步数',1,5);ui.text(224,70,'系统内存',1,5);
  ui.font('display');ui.text(38,98,'8,420',1,0);ui.text(224,98,'6.9M',1,0);
  ui.rrect(38,146,138,12,6,10);ui.rrect(38,146,104,12,6,0);
  ui.rrect(224,146,138,12,6,10);ui.rrect(224,146,92,12,6,5);
  ui.glass(20,190,360,88,16,15,3);
  ui.font('sans');ui.text(38,208,'0.5 秒无黑闪，4 级真灰保留层次',1,0);
  ui.text(38,240,'适合仪表盘、日程与日常高频交互',1,5);
 }else{
  ui.clear(15);
  ui.font('serif');ui.text(20,18,'16 灰阶光影与几何 · 4/4',1,0);
  ui.grad(20,56,360,44,0,15,1);ui.rbox(20,56,360,44,0,5,1);
  ui.font('sans');ui.text(34,68,'0 黑 · 连续微抖动',1,15);
  var rlbl='15 白',rw=ui.measure(rlbl);
  ui.text(366-rw,68,rlbl,1,0);
  ui.circle(80,166,46,13);ui.circle(80,166,32,9);ui.circle(80,166,16,3);
  ui.line(80,166,104,146,15,2);ui.line(80,166,80,132,0,2);
  ui.glass(150,114,230,102,18,14,6);
  ui.font('serif');ui.text(168,128,'原生圆角与抗锯齿',1,0);
  ui.font('sans');ui.text(168,162,'rrect / circle / line',1,3);
  ui.text(168,186,'glass 自动适配多波形',1,5);
  ui.rrect(20,232,360,46,14,14);ui.rbox(20,232,360,46,14,10,1);
  ui.font('sans');ui.text(38,245,'上 / 下 / 确定 循环查看 4 套展板',1,2);
 }
 ui.font('pixel');ui.present('clear');
}
function on_start(){draw();}
function on_key(k){if(k==='up')S.p=(S.p+3)%4;else if(k==='down'||k==='ok'||k==='wave')S.p=(S.p+1)%4;else return;save('tg',S);draw();}`;

const zen_breath=`var MODES=[['方盒专注',[4,4,4,4],['吸气','屏息','呼气','屏息']],['4-7-8 助眠',[4,7,8],['慢吸','静屏','长呼']],['5-5 放松',[5,5],['深吸','缓呼']]];
var S=load('zb',{m:0,ph:0,rem:4,run:false});
function draw(){
 var md=MODES[S.m],dur=md[1][S.ph],lbl=md[2][S.ph];
 ui.grad(0,0,400,300,15,9,2);
 // Concentric 16-gray breathing halo (expands on inhale, holds full, softens on exhale)
 var prog=S.ph===0?1-(S.rem-1)/Math.max(1,dur):S.ph===1&&md[1].length>2?1:(S.rem)/Math.max(1,dur);
 var rOuter=Math.round(52+prog*22),rMid=Math.round(rOuter*0.68),rCore=Math.round(rOuter*0.36);
 ui.circle(106,118,rOuter,12);ui.circle(106,118,rMid,8);ui.circle(106,118,rCore,3);
 ui.circle(106,118,8,15);
 ui.glass(198,22,180,184,20,14,7);
 ui.font('sans');ui.text(216,38,md[0],1,4);
 ui.font('serif');ui.text(216,68,lbl,1,0);
 ui.font('display_lg');ui.text(216,104,pad(S.rem)+'s',1,0);
 var i,n=md[1].length,dw=Math.floor((144-(n-1)*8)/n);
 for(i=0;i<n;i++)ui.rrect(216+i*(dw+8),174,dw,10,5,i===S.ph?0:11);
 ui.glass(22,220,356,58,16,14,6);
 ui.font('sans');var hint=S.run?'按确定 暂停 · 上下 换节律':'按确定 开始呼吸 · 上下 换节律';
 ui.text(40,239,hint,1,2);
 ui.font('pixel');ui.present('clear');
}
function step(){var md=MODES[S.m];S.rem--;if(S.rem<=0){S.ph=(S.ph+1)%md[1].length;S.rem=md[1][S.ph];}}
function on_start(){draw();ui.tick(S.run?2000:0);}
function on_tick(){if(!S.run)return;step();draw();}
function on_key(k){
 if(k==='up'){S.m=(S.m+MODES.length-1)%MODES.length;S.ph=0;S.rem=MODES[S.m][1][0];S.run=false;ui.tick(0);}
 else if(k==='down'){S.m=(S.m+1)%MODES.length;S.ph=0;S.rem=MODES[S.m][1][0];S.run=false;ui.tick(0);}
 else if(k==='ok'){S.run=!S.run;if(!S.run)ui.tick(0);else ui.tick(2000);}
 else if(k==='wave'){step();}
 else return;
 save('zb',S);draw();
}`;

const studio_weather=`var CITIES=[['北京',39.9,116.4,22,13,25,0,12,42],['上海',31.2,121.5,24,17,27,2,15,61],['杭州',30.3,120.2,23,15,26,1,11,58],['深圳',22.5,114.1,28,23,31,2,14,72],['成都',30.6,104.1,20,14,23,3,8,68]];
var S=load('sw',{i:0}),D={},WK=['周日','周一','周二','周三','周四','周五','周六'];
function wname(c){if(c===0)return '晴朗';if(c<=2)return '多云';if(c<=3)return '阴天';if(c<=48)return '轻雾';if(c<=67)return '小雨';if(c<=77)return '微雪';return '阵雨';}
function icon(cx,cy,c){
 if(c===0){ui.circle(cx,cy,14,2);ui.circle(cx,cy,9,14);ui.line(cx,cy-22,cx,cy-17,2,2);ui.line(cx,cy+17,cx,cy+22,2,2);ui.line(cx-22,cy,cx-17,cy,2,2);ui.line(cx+17,cy,cx+22,cy,2,2);}
 else if(c<=3){ui.circle(cx-6,cy+4,11,5);ui.circle(cx+6,cy+2,13,3);ui.rrect(cx-16,cy+4,32,12,6,4);}
 else{ui.circle(cx-5,cy-2,10,4);ui.circle(cx+6,cy-4,12,2);ui.rrect(cx-15,cy-2,30,10,5,3);ui.line(cx-8,cy+12,cx-11,cy+20,2,2);ui.line(cx+1,cy+12,cx-2,cy+20,2,2);ui.line(cx+10,cy+12,cx+7,cy+20,2,2);}
}
function draw(){
 var c=CITIES[S.i],d=D[S.i];
 var cur=d?d.cur:c[3],wc=d?d.wc:c[6],wd=d?d.wd:c[7],hm2=d?d.hm:c[8];
 var f3=d?d.f3:[['明天',c[6],c[4],c[5]],['后天',Math.min(3,c[6]+1),c[4]-1,c[5]-1],['大后天',0,c[4]+1,c[5]+2]];
 ui.grad(0,0,400,300,14,8,2);
 ui.circle(72,56,66,4);ui.circle(344,228,82,5);ui.circle(310,58,42,15);
 ui.glass(20,20,360,152,22,14,7);
 ui.font('serif');ui.text(38,34,c[0]+' · '+wname(wc),1,0);
 ui.font('sans');var tag=d?'实时气象':'示例天气',tgw=ui.measure(tag)+22;
 ui.rrect(362-tgw,34,tgw,26,13,11);ui.text(362-tgw+11,37,tag,1,1);
 ui.font('display_lg');ui.text(38,76,cur+' °C',1,0);
 icon(206,116,wc);
 ui.font('sans');
 var wl='风速 '+wd+' km/h',hl='湿度 '+hm2+' %';
 ui.text(362-ui.measure(wl),94,wl,1,4);ui.text(362-ui.measure(hl),124,hl,1,4);
 var k;for(k=0;k<3;k++){
  var bx=20+k*124,row=f3[k];
  ui.glass(bx,186,112,94,18,14,6);
  ui.font('sans');var n1=row[0];ui.text(bx+Math.floor((112-ui.measure(n1))/2),198,n1,1,4);
  ui.font('serif');var n2=wname(row[1]);ui.text(bx+Math.floor((112-ui.measure(n2))/2),222,n2,1,0);
  ui.font('sans');var n3=row[2]+'° / '+row[3]+'°';ui.text(bx+Math.floor((112-ui.measure(n3))/2),250,n3,1,3);
 }
 ui.font('pixel');ui.present('clear');
}
function pull(){var c=CITIES[S.i];net.request({key:'w'+S.i,url:'https://api.open-meteo.com/v1/forecast?latitude='+c[1]+'&longitude='+c[2]+'&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FShanghai&forecast_days=4'});}
function on_net(k,st,b){
 var idx=+k.slice(1),j=parse(st,b),cu=j&&j.current,dl=j&&j.daily;if(!cu||!dl)return;
 var c0=clock(),f3=[],n;for(n=1;n<=3&&n<dl.time.length;n++){var lbl=n===1?'明天':(c0.ok?WK[(c0.w+n)%7]:(n===2?'后天':'大后天'));f3.push([lbl,dl.weather_code[n],Math.round(dl.temperature_2m_min[n]),Math.round(dl.temperature_2m_max[n])]);}
 D[idx]={cur:Math.round(cu.temperature_2m),wc:cu.weather_code,wd:Math.round(cu.wind_speed_10m),hm:Math.round(cu.relative_humidity_2m),f3:f3};
 if(idx===S.i)draw();
}
function on_start(){draw();pull();ui.tick(1800000);}
function on_tick(){pull();}
function on_key(k){if(k==='up')S.i=(S.i+CITIES.length-1)%CITIES.length;else if(k==='down'||k==='wave')S.i=(S.i+1)%CITIES.length;else if(k==='ok'){pull();return;}else return;save('sw',S);draw();if(!D[S.i])pull();}`;

const paper_quote=`var Q=[
 ['慢下来，','听见思考的声音','纸墨随笔'],
 ['人间有味是清欢，','且把浮名换浅斟','苏轼'],
 ['一寸光阴一寸心，','静观云卷与风轻','桌面日签'],
 ['好的设计，','是尽可能少的设计','Dieter Rams'],
 ['生活是很好玩的，','只要你不急着赶路','汪曾祺'],
 ['把时间还给专注，','把喧嚣留给窗外','静心录'],
 ['万物皆有裂痕，','那是光照进来的地方','Leonard Cohen'],
 ['知止而后有定，','定而后能静','大学']
];
var S=load('pq',{i:0,dark:false}),WK=['周日','周一','周二','周三','周四','周五','周六'];
function dstr(){var c=clock();return c.ok?(c.y+'.'+pad(c.m)+'.'+pad(c.d)+' · '+WK[c.w]):'2026.11.20 · 周五';}
function draw(){
 var d=S.dark,bg=d?1:15,fg=d?15:0,sub=d?11:5,pill=d?3:14,rim=d?5:11,q=Q[S.i];
 ui.clear(bg);
 ui.rbox(22,20,356,260,20,rim,1);
 ui.font('sans');ui.text(42,36,dstr(),1,sub);
 var tag=d?'墨夜一签':'纸墨一签',tw1=ui.measure(tag)+24;
 ui.rrect(358-tw1,34,tw1,26,13,pill);ui.text(358-tw1+12,37,tag,1,d?14:3);
 ui.line(42,72,358,72,rim,1);
 ui.font('serif');
 var w1=ui.measure(q[0]),w2=ui.measure(q[1]);
 ui.text(Math.floor((W-w1)/2),98,q[0],1,fg);
 ui.text(Math.floor((W-w2)/2),134,q[1],1,fg);
 ui.font('sans');var au='—— '+q[2],aw=ui.measure(au);
 ui.text(Math.floor((W-aw)/2),178,au,1,sub);
 ui.rrect(42,218,150,42,12,pill);ui.rrect(208,218,150,42,12,pill);
 var l1='第 '+(S.i+1)+' / '+Q.length+' 签',l2=d?'按确定 切亮纸':'按确定 切墨夜';
 ui.text(42+Math.floor((150-ui.measure(l1))/2),229,l1,1,d?14:2);
 ui.text(208+Math.floor((150-ui.measure(l2))/2),229,l2,1,sub);
 ui.font('pixel');ui.present('clear');
}
function on_start(){draw();}
function on_key(k){if(k==='up')S.i=(S.i+Q.length-1)%Q.length;else if(k==='down'||k==='wave')S.i=(S.i+1)%Q.length;else if(k==='ok')S.dark=!S.dark;else return;save('pq',S);draw();}`;

const focus_deck=`var S=load('fd',{sec:1500,brk:false,run:false,done:4});
function draw(){
 var tot=S.brk?300:1500,el=tot-S.sec,mm=Math.floor(S.sec/60),ss=S.sec%60;
 ui.clear(14);
 ui.glass(20,20,224,218,18,15,3);
 ui.font('serif');ui.text(38,36,S.brk?'轻度休息':'深度专注',1,0);
 ui.font('sans');var st=S.run?'进行中':'已暂停',stw=ui.measure(st)+20;
 ui.rrect(226-stw,36,stw,26,13,S.run?0:10);ui.text(226-stw+10,39,st,1,S.run?15:0);
 ui.font('display_lg');ui.text(38,84,pad(mm)+':'+pad(ss),1,0);
 ui.rrect(38,158,188,14,7,10);
 var fw=Math.floor(188*el/tot);if(fw>8)ui.rrect(38,158,fw,14,7,0);
 ui.font('sans');ui.text(38,194,S.brk?'5 分钟放松目力':'25 分钟心流时段',1,5);
 ui.glass(256,20,124,103,18,15,3);
 ui.font('sans');ui.text(274,34,'今日番茄',1,5);
 ui.font('display');ui.text(274,64,pad(S.done),1,0);
 ui.glass(256,135,124,103,18,15,3);
 ui.font('sans');ui.text(274,149,'当前状态',1,5);
 ui.font('serif');ui.text(274,182,S.brk?'休整中':'专注中',1,0);
 ui.font('pixel');ui.text(20,258,'确认 开始/暂停   上 切休息   下 重置',1,5);
 ui.present();
}
function on_start(){draw();ui.tick(S.run?5000:0);}
function on_tick(){if(!S.run)return;S.sec-=5;if(S.sec<=0){if(!S.brk)S.done++;S.brk=!S.brk;S.sec=S.brk?300:1500;S.run=false;ui.tick(0);}save('fd',S);draw();}
function on_key(k){
 if(k==='ok'||k==='wave'){S.run=!S.run;ui.tick(S.run?5000:0);}
 else if(k==='up'){S.brk=!S.brk;S.sec=S.brk?300:1500;S.run=false;ui.tick(0);}
 else if(k==='down'){S.sec=S.brk?300:1500;S.run=false;ui.tick(0);}
 else return;
 save('fd',S);draw();
}`;

const cat={
 relay:'电脑同步',
 work:'效率专注',
 board:'信息看板',
 home:'生活日常',
 fun:'桌面小玩意',
};
const g=(id:string,c:string,title:string,use:string,refresh:string,code:string,extra:any={})=>({id,cat:c,title,use,refresh,conn_mode:'local',wave_act:'快捷操作',code,...extra});

export const GALLERY=[
 // 0. 视觉与液态玻璃展厅 (v1.8 Visual Craft!)
 g('typo_gallery',cat.home,'视觉与字体展厅','一屏实机对比 16 灰液态玻璃、新黑体/宋体抗锯齿、4 灰快刷与微抖动渐变','clear',typo_gallery,{conn_mode:'local',wave_act:'切换下一展板'}),
 g('glass_clock',cat.home,'液态玻璃时钟','16 灰原生磨砂透光玻璃卡片配 48px 几何大时钟，支持冰霜/黑曜/纸墨三风格','clear',glass_clock,{conn_mode:'local',wave_act:'切换玻璃风格'}),
 g('studio_weather',cat.board,'液态玻璃天气画报','16 灰磨砂主卡配 48px 超大温度与三日玻璃预报，免配置直连实时气象','clear',studio_weather,{conn_mode:'public',wave_act:'切换下个城市'}),
 g('paper_quote',cat.home,'纸墨每日一签','Kindle 杂志社论风 4-bit 粗宋体金句日签，支持亮纸与墨夜双主题','clear',paper_quote,{conn_mode:'local',wave_act:'翻看下一签'}),
 g('zen_breath',cat.home,'静心呼吸引导','16 灰同心呼吸光晕配液态玻璃倒计时，内置 4-4-4-4 与 4-7-8 呼吸节律','clear',zen_breath,{conn_mode:'local',wave_act:'切入下一拍'}),
 g('focus_deck',cat.work,'4灰专注仪表台','TRMNL 风格 0.5 秒 4 灰快刷番茄台，超大等宽倒计时配今日统计卡片','tuned',focus_deck,{conn_mode:'local',wave_act:'开始或暂停'}),
 g('glass_hub',cat.work,'4灰阶快刷仪表盘','0.5 秒 4 灰快刷下用柔影玻璃卡与新抗锯齿黑体打造现代桌面看板','tuned',glass_hub,{conn_mode:'local',wave_act:'切换看板标签'}),
 // 1. 内网中转与遥控 (Platform Relay Hub showcase!)
 g('relay_board',cat.relay,'云端桌贴','从内网电脑或手机发一句话直达桌面，挥手盖章「已阅」回传电脑','fast',relay_board,{conn_mode:'relay',wave_act:'盖章回传已阅'}),
 g('claude_hud',cat.relay,'AI 任务盯盘','盯盘内网 Claude 或训练任务进度，墨水屏挥手一键拍板放行','fast',claude_hud,{conn_mode:'relay',wave_act:'批准继续执行'}),
 g('monitor',cat.relay,'电脑副屏','支持本站云端中转免穿透推送电脑 CPU 与内存，也兼容局域网 Glances','gray',monitor,{conn_mode:'relay',wave_act:'立即刷新状态',secret:'可选：局域网 Glances 地址',secret_guide:{what:'默认已走本站云端中转（无需填此项）！仅当你改用局域网 Glances 直连时填写。',where:'在同 WiFi 电脑运行 glances -w 后，填写 http://电脑局域网IP:61208',placeholder:'http://192.168.1.50:61208'}}),
 g('robot',cat.relay,'消息遥控台','内网脚本或微信机器人把消息推到屏幕，按确定键发回快捷回复','fast',robot,{conn_mode:'relay',wave_act:'切下一条消息',secret:'可选：自定义机器人 Webhook',secret_guide:{what:'默认已接入本站云端中转信箱！也可填写你自己的机器人接口地址覆盖。',where:'填入你自建的 HTTP/HTTPS 消息收发接口地址',placeholder:'https://your-bot.example.com/hook'}}),

 // 2. 效率与专注
 g('pomodoro',cat.work,'种树番茄钟','低打扰每分钟一刷，专注时像素松树慢慢长高，收获今日森林','fast',pomodoro,{conn_mode:'local',wave_act:'完成并切换休息'}),
 g('habit_grid',cat.work,'百日热力格','GitHub 风格 80 天像素打卡热力图，一眼看清坚持轨迹','fast',habit_grid,{conn_mode:'local',wave_act:'今日全部打卡'}),
 g('dida',cat.work,'滴答清单','内置演示清单可直接使用，填入 Token 后同步滴答收集箱','fast',todo(0,"[['写周报','17:00',false],['给房东转账','今天',false],['取快递','今天',true],['约牙医','明天',false],['买猫粮','周六',false]]"),{conn_mode:'apikey',wave_act:'完成并跳下一项',secret:'滴答清单 Access Token',secret_guide:{what:'滴答清单开放平台用于读取收集箱和完成任务的授权令牌（不填也可当本地清单用）。',where:'登录 dida365.com 开发者中心创建应用并获取 OAuth Access Token',placeholder:'粘贴 Bearer 之后的令牌字符串'}}),
 g('mstodo',cat.work,'我的一天','清爽聚焦今日最重要的四件事，内容可让 Agent 随时定制','fast',todo(1,"[['回复设计反馈','10:00',false],['整理会议纪要','14:00',false],['跑步 30 分钟','18:00',true],['看完第三章','22:00',false]]"),{conn_mode:'local',wave_act:'完成当前待办'}),
 g('reminders',cat.work,'提醒事项','三栏汇总统计的桌面提醒板，断电断网进度也不丢','fast',todo(2,"[['交水电费','今天',false],['给妈妈打电话','今天',false],['续签证件','周三',false],['还信用卡','15 日',false]]"),{conn_mode:'local',wave_act:'勾选完成'}),
 g('calendar',cat.work,'月历日程','真实月视图与每日安排，可选填日历 ICS 链接自动同步日程','fast',calendar,{conn_mode:'url',wave_act:'跳到下个日程日',secret:'日历 ICS 订阅链接',secret_guide:{what:'苹果日历、飞书、Outlook 或 Google 日历导出的公开只读日程订阅网址（不填可用本地日程）。',where:'在日历软件点「共享/公开日历」复制 webcal:// 或 https:// 结尾为 .ics 的链接',placeholder:'https://p01-caldav.icloud.com/.../calendar.ics'}}),
 g('ebbinghaus',cat.work,'艾宾浩斯复习','按 1/3/7/14/30 天记忆曲线自动排期复习闪卡','fast',ebbinghaus,{conn_mode:'local',wave_act:'标记记住了'}),
 g('words',cat.work,'英语单词机','正反面记单词配例句，挥手翻面或秒标认识','fast',words,{conn_mode:'local',wave_act:'翻面或认识'}),
 g('timetable',cat.work,'周课程表','含早晚自习的五日课表，自动定位当天星期','fast',timetable,{conn_mode:'local',wave_act:'跳到下一节课'}),
 g('water',cat.work,'喝水和起身','八杯水可视化水位杯，顺手记录久坐起身次数','fast',water,{conn_mode:'local',wave_act:'喝一杯水'}),
 g('gantt',cat.work,'项目甘特图','季度总览与本月切片一键缩放，桌面看清里程碑','tuned',gantt,{conn_mode:'local',wave_act:'看下个任务'}),

 // 3. 数据看板
 g('weather',cat.board,'城市天气','免配置直连公开气象站，实时温度与未来三天预报','fast',weather,{conn_mode:'public',wave_act:'切换下个城市'}),
 g('stock',cat.board,'A 股行情 K 线','免配置拉取真实日 K，空心阳线与收盘折线自由切换','tuned',stock,{conn_mode:'public',wave_act:'切换 K 线与分时'}),
 g('fx_rates',cat.board,'实时汇率换算','免配置直连全球汇率，支持百元千元档与正反向折算','fast',fx_rates,{conn_mode:'public',wave_act:'切换正反向换算'}),
 g('stripe',cat.board,'Stripe 收入看板','内置演示柱状图，填入只读密钥显示近 14 天真实收款','flash',stripe,{conn_mode:'apikey',wave_act:'切换 7 天或 14 天',secret:'Stripe 只读密钥 (rk_live_...)',secret_guide:{what:'Stripe 后台生成的仅具 Balance 与 Charges 读取权限的受限密钥。',where:'打开 Stripe Dashboard -> Developers -> API keys -> Create restricted key（只勾选 Read）',placeholder:'rk_live_...'}}),
 g('quota',cat.board,'AI 额度看板','内置趋势图，填入 API Key 后实时追踪真实账户余额','flash',quota,{conn_mode:'apikey',wave_act:'立即刷新余额',secret:'DeepSeek API Key',secret_guide:{what:'用于查询账户剩余额度的 API 密钥，加密保存，Agent 对话不可见。',where:'登录 platform.deepseek.com -> API Keys 页面创建并复制 sk- 开头的密钥',placeholder:'sk-...'}}),
 g('hot',cat.board,'全网热搜榜','免配置一次联网取回微博、知乎、百度实时热榜','fast',hot,{conn_mode:'public',wave_act:'切换热搜平台'}),
 g('news',cat.board,'每日商业快讯','澎湃与 36 氪头条大字报，抬手一挥翻看下一条','fast',news,{conn_mode:'public',wave_act:'翻看下一条'}),
 g('oil',cat.board,'今日全国油价','31 省市 92/95/98/柴油实时价格与调价幅度','flash',oil,{conn_mode:'public',wave_act:'切换省市地区'}),
 g('horoscope',cat.board,'今日星座运势','十二星座综合、爱情、事业、财运星级与每日寄语','tuned',horoscope,{conn_mode:'public',wave_act:'换下一个星座'}),

 // 4. 生活与家庭
 g('almanac',cat.home,'桌面老黄历','复古大字撕页台历配打工人每日宜忌，挥手抽今日好签','flash',almanac,{conn_mode:'local',wave_act:'抽取今日签语'}),
 g('coffee',cat.home,'手冲咖啡师','果香浅烘、醇厚拼配与冰手冲三套分段注水克重指引','fast',coffee,{conn_mode:'local',wave_act:'进入下一注水段'}),
 g('fridge',cat.home,'冰箱保质期','食材按剩余天数自动排前面，吃掉一样挥手销账','fast',fridge,{conn_mode:'local',wave_act:'吃掉最快到期的'}),
 g('ledger',cat.home,'家庭复式记账','类别与账户联动记账，挥手一键复刻上一笔常花开销','fast',ledger,{conn_mode:'local',wave_act:'快速再记一笔'}),
 g('photo',cat.home,'16 灰阶随机相框','浏览器抖动生成 6 张细腻灰度摄影画，装点书桌','clear',photo,{conn_mode:'local',wave_act:'切换下一张画',photos:true}),
 g('onthisday',cat.home,'历史上的今天','按当天月日联网拉取历史大事件编年卡片','flash',onthisday,{conn_mode:'public',wave_act:'翻看下一件往事'}),
 g('door',cat.home,'工位状态门牌','在岗、会议、专注大字反白门牌，同事路过挥手即可留数','flash',door,{conn_mode:'local',wave_act:'访客挥手敲门留言'}),

 // 5. 奇物与游戏
 g('muyu',cat.fun,'赛博木鱼','超声波隔空挥手敲木鱼，切换「Bug 退散」「功德 +1」攒满十念珠','fast',muyu,{conn_mode:'local',wave_act:'隔空敲击木鱼'}),
 g('iching',cat.fun,'周易六十四卦','完整八经卦与六十四卦辞，静心挥手诚起一卦看卦象','tuned',iching,{conn_mode:'local',wave_act:'诚心起新卦'}),
 g('dungeon',cat.fun,'三键像素地牢','专为三键设计的回合制寻宝肉鸽，打怪开箱下层闯关','fast',dungeon,{conn_mode:'local',wave_act:'饮用药水回血'}),
 g('pet',cat.fun,'电子宠物 墨团','桌面像素小团子，喂食玩耍睡觉，伸手挥一挥就眯眼撒娇','gray',pet,{conn_mode:'local',wave_act:'隔空摸摸墨团'}),
 g('friday',cat.fun,'今天是周五吗','全宇宙打工人最关心的灵魂大字牌，随时拨日子预演周末','flash',friday,{conn_mode:'local',wave_act:'快进过一天'}),
 g('reveal',cat.fun,'墨迹显影动图','64 帧连续水墨动图高刷演示，可调四档帧速与挥手定格','gray',reveal,{conn_mode:'local',wave_act:'播放或定格动图',asset:'ink-reveal',frames:64,frame_bytes:30000,seconds:300}),
];
