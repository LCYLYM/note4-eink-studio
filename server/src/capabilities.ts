import {defaults} from './compiler';
import {LIMITS} from './budget';
export const CAPABILITIES={
 version:'1.2.0',
 templates:[{id:'js',version:'1.0.0',description:'设备端单页应用：ES5 脚本、原生绘制、三键与可选挥手、持久化，适合背单词、小工具、回合制小游戏',configuration:defaults('js')},{id:'reader',version:'1.0.0',description:'完整TXT自动分页、上下翻页、续读；最多20万字符/1024页/4MiB，需ABI2底座',configuration:defaults('reader')},{id:'quiz',version:'1.0.0',description:'2–4选项单选题、正误反馈、计分与重来；最多64题，需ABI2底座',configuration:defaults('quiz')},{id:'runner',version:'1.0.0',description:'原生四灰跑酷：三输入模式、失败、重开、停止',configuration:defaults('runner')},{id:'cards',version:'1.0.0',description:'官方16灰静态卡片，1–8页',configuration:defaults('cards')}],
 device:{size:[400,300],inputs:['buttons','gestures','both'],buttons:{ok:'jump/retry',up:'lane/page up',down:'lane/page down',hold_down:'global stop'},nfc:{mode:'field event and URL tag',card_action:'next_page',arbitrary_card_reader:false,hardware_validation:'UNVERIFIED'},feedback:{styles:['icon','text'],icon_sets:['hand','arrows'],position:{x:[0,304],y:[0,284]}}},
 safety:{fixed:true,stop:'hold DOWN 800ms; preserve USB',cpu_mhz:160,tick_ms:50,temperature:{derate_c:50,recover_c:47,stop_c:55},max_run_seconds:900},
 limits:LIMITS,
 unsupported:['changing display voltages','ultrasonic distance, approach or retreat','guaranteed optical FPS','device timers or background loops']
};
