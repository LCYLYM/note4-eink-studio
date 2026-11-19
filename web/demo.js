// One-click guided demo (v2.2): zero network, zero account, showcases Agent + WASM preview + AI push-doc loop.
const MAX_ZOOM = 1.18;
const LOG = [
  '理解需求：桌面天气与电脑留言看板',
  '编写应用代码并接入专属数据推送通道',
  '真机同款引擎核验通过（400x300 零越界）',
];
const MSGS = ['评审会改到 15:00（来自书房电脑）', '本地构建任务已全部通过', '晚上记得取快递 #402'];

const STEPS = [
  {
    title: '1. 说一句你想做什么',
    text: '不用写代码，直接描述想要的桌面应用，或者从模板库挑一款一键改装。',
    at: 'input',
    zoom: 1.16,
    run: async d => { await d.type('做一个能收电脑定时推送留言的天气看板，按确定回传已阅'); },
  },
  {
    title: '2. AI 制作并自动核验',
    text: 'AI 写完后会在设备同款引擎里试跑，确保按键可用且不超出屏幕边界。',
    at: 'log',
    zoom: 1.1,
    run: async d => { for (const line of LOG) { d.log(line); await d.wait(560); } d.screen(0); await d.wait(450); },
  },
  {
    title: '3. 先在网页里试玩按键与挥手',
    text: '实时预览真实画面效果，支持上下键、确定键和隔空挥手操作。',
    at: 'device',
    zoom: 1.18,
    run: async d => { await d.wait(420); d.key('down'); d.screen(1); await d.wait(700); d.key('wave'); d.screen(2); await d.wait(700); },
  },
  {
    title: '4. 电脑推送数据：一份文档交给 AI',
    text: '自动生成带 Token 的专属链接和接入文档，发给你的本地 AI 就能写个定时小服务推 JSON 上屏。',
    at: 'secret',
    zoom: 1.14,
    run: async d => { d.show('secret'); await d.relayFlow(); d.key('ok'); d.replyBack(); await d.wait(800); },
  },
  {
    title: '5. 一键发布，断网也能常显',
    text: '点一下发布，NOTE4 下次同步时自动拉取新应用和推送内容，平时低功耗常显。',
    at: 'pub',
    zoom: 1.12,
    run: async d => { d.show('pub'); await d.wait(600); d.publish(); await d.wait(750); d.flash(); await d.wait(1100); },
  },
];

const paper = (i, replied = false) => `<div class="dm-paper">
  <div class="dm-row"><span>云端桌贴</span><span>${replied ? '已回传确认' : '更新 14:30'}</span></div>
  <div class="dm-sky"><b>21°</b><span>晴 · 空气优<br>推送通道在线</span></div>
  <ul>${MSGS.map((t, n) => `<li class="${n === i ? 'on' : ''}">${t}</li>`).join('')}</ul>
</div>`;

const SHELL = `<div class="dm-stage" inert>
  <section class="dm-left">
    <header class="topbar" style="padding-bottom:8px"><strong class="brand-btn"><span class="brand-mark">N4</span>NOTE4 演示</strong><span class="small">1 分钟交互演示</span></header>
    <h1 style="font-size:22px;font-weight:600">一句话制作，随手连电脑同步</h1>
    <div class="dm-ask" data-t="input"><span class="dm-typed"></span><i class="dm-caret"></i><span class="dm-go">开始制作</span></div>
    <ol class="dm-log" data-t="log"></ol>
    <div class="dm-secret" data-t="secret" hidden>
      <div style="display:flex;justify-content:space-between;gap:8px"><b>专属数据推送通道</b><code class="dm-mask"></code></div>
      <div class="small dm-relay-note">等待本地定时脚本推送 JSON...</div>
    </div>
    <div class="dm-pub" data-t="pub" hidden><span class="btn solid dm-send">发布到设备</span><span class="small dm-state"></span></div>
  </section>
  <section class="dm-right">
    <div class="dm-device" data-t="device"><div class="dm-screen"><div class="dm-empty">NOTE4</div></div>
      <div class="dm-keys"><span data-k="up">上</span><span data-k="ok">确定</span><span data-k="down">下</span><span data-k="wave">挥手</span></div></div>
  </section>
</div>
<aside class="dm-panel" aria-live="polite">
  <div class="dm-count"></div><h2></h2><p></p>
  <div class="dm-acts"><button type="button" data-d="pause">暂停</button><button type="button" data-d="again" hidden>重播</button><button type="button" data-d="close">退出演示</button></div>
</aside>`;

let current = null;

export function startDemo() {
  if (current) return;
  const back = document.activeElement, root = document.createElement('div');
  root.id = 'demo'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', '1分钟交互演示');
  root.innerHTML = SHELL; document.body.append(root); document.documentElement.classList.add('dm-lock');
  const q = s => root.querySelector(s), stage = q('.dm-stage'), panel = q('.dm-panel');
  const state = {token: 0, paused: false, dragged: false, target: null};
  current = state;

  const Cancel = Symbol('cancel');
  async function wait(ms, token = state.token) {
    let left = ms;
    while (left > 0) {
      if (token !== state.token) throw Cancel;
      await new Promise(r => setTimeout(r, 40));
      if (!state.paused) left -= 40;
    }
    if (token !== state.token) throw Cancel;
  }
  const pick = name => q(`[data-t="${name}"]`);
  const driver = {
    wait,
    show: name => { pick(name).hidden = false; },
    log: t => { const li = document.createElement('li'); li.textContent = t; q('.dm-log').append(li); },
    screen: (i, r = false) => { q('.dm-screen').innerHTML = paper(i, r); },
    key: k => { const el = q(`[data-k="${k}"]`); el?.classList.add('down'); setTimeout(() => el?.classList.remove('down'), 240); },
    publish: () => { q('.dm-send').classList.add('down'); q('.dm-state').textContent = '已打包上传，等待墨水屏同步...'; },
    flash: () => { const s = q('.dm-screen'); s.classList.remove('dm-flash'); void s.offsetWidth; s.classList.add('dm-flash'); q('.dm-state').textContent = '设备已同步常显'; },
    async type(text) { for (const c of text) { q('.dm-typed').textContent += c; await wait(65); } q('.dm-go').classList.add('down'); await wait(320); q('.dm-go').classList.remove('down'); q('.dm-caret').hidden = true; },
    async relayFlow() {
      const tok = 'n4r_8f3a9c21...';
      for (const c of tok) { q('.dm-mask').textContent += c; await wait(45); }
      q('.dm-relay-note').textContent = '本地脚本 POST JSON，屏幕内容已更新';
      driver.screen(0, false);
      await wait(550);
    },
    replyBack() {
      q('.dm-relay-note').textContent = '按确定键后，已向推送通道回传「已阅」';
      driver.screen(0, true);
    },
  };

  function offset(el) { let x = 0, y = 0; for (let n = el; n && n !== stage; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } return {x, y, w: el.offsetWidth, h: el.offsetHeight}; }
  function focus(name, zoom) {
    root.querySelectorAll('.dm-on').forEach(e => e.classList.remove('dm-on'));
    const el = pick(name); el.classList.add('dm-on'); state.target = el;
    const o = offset(el);
    root.scrollTo({top: Math.max(0, o.y + o.h / 2 - root.clientHeight / 2), behavior: 'smooth'});
    stage.style.transformOrigin = `${o.x + o.w / 2}px ${o.y + o.h / 2}px`;
    stage.style.transform = innerWidth > 760 ? `scale(${Math.min(MAX_ZOOM, zoom)})` : '';
  }
  function clamp(x, y) { const r = panel.getBoundingClientRect(); return [Math.min(Math.max(8, x), innerWidth - r.width - 8), Math.min(Math.max(8, y), innerHeight - r.height - 8)]; }
  function place(x, y) { [x, y] = clamp(x, y); panel.style.left = x + 'px'; panel.style.top = y + 'px'; }
  function dodge() {
    if (state.dragged || !state.target) return;
    const t = state.target.getBoundingClientRect(), r = panel.getBoundingClientRect(), m = 20;
    const spots = [[innerWidth - r.width - m, innerHeight - r.height - m], [m, innerHeight - r.height - m], [innerWidth - r.width - m, m], [m, m]];
    const cover = ([x, y]) => Math.max(0, Math.min(x + r.width, t.right) - Math.max(x, t.left)) * Math.max(0, Math.min(y + r.height, t.bottom) - Math.max(y, t.top));
    let best = spots[0]; for (const s of spots) if (cover(s) < cover(best)) best = s;
    place(best[0], best[1]);
  }
  function note(i) { const s = STEPS[i]; q('.dm-count').textContent = `步骤 ${i + 1} / ${STEPS.length}`; q('.dm-panel h2').textContent = s.title; q('.dm-panel p').textContent = s.text; }
  function reset() {
    stage.style.transform = ''; root.querySelectorAll('.dm-on').forEach(e => e.classList.remove('dm-on')); state.target = null;
    q('.dm-typed').textContent = ''; q('.dm-caret').hidden = false; q('.dm-log').innerHTML = ''; q('.dm-mask').textContent = ''; q('.dm-state').textContent = '';
    q('.dm-relay-note').textContent = '等待本地定时脚本推送 JSON...';
    q('.dm-send').classList.remove('down'); q('.dm-screen').classList.remove('dm-flash'); q('.dm-screen').innerHTML = '<div class="dm-empty">NOTE4</div>';
    pick('secret').hidden = true; pick('pub').hidden = true; q('[data-d=pause]').hidden = false; q('[data-d=pause]').textContent = '暂停'; q('[data-d=again]').hidden = true; state.paused = false; root.scrollTo(0, 0);
  }
  async function play() {
    const token = ++state.token; reset();
    try {
      for (let i = 0; i < STEPS.length; i++) {
        note(i); focus(STEPS[i].at, STEPS[i].zoom);
        await wait(560, token); dodge();
        await STEPS[i].run(driver);
        await wait(1000, token);
      }
      stage.style.transform = ''; root.querySelectorAll('.dm-on').forEach(e => e.classList.remove('dm-on')); state.target = null;
      q('.dm-count').textContent = '演示完成'; q('.dm-panel h2').textContent = '现在可以动手试试'; q('.dm-panel p').textContent = '退出演示后，可以在首页直接试玩模板，或者输入一句话定制你的桌面应用。';
      q('[data-d=pause]').hidden = true; q('[data-d=again]').hidden = false;
    } catch (e) { if (e !== Cancel) throw e; }
  }
  function close() {
    state.token++; current = null; root.remove(); document.documentElement.classList.remove('dm-lock');
    removeEventListener('keydown', keys, true); removeEventListener('resize', resized);
    back?.focus?.();
  }
  function keys(e) { if (e.key === 'Escape') close(); e.stopPropagation(); }
  function resized() { const r = panel.getBoundingClientRect(); place(r.left, r.top); dodge(); }
  addEventListener('keydown', keys, true); addEventListener('resize', resized);

  panel.addEventListener('click', e => {
    const a = e.target.closest('[data-d]')?.dataset.d; if (!a) return;
    if (a === 'close') close();
    if (a === 'again') play();
    if (a === 'pause') { state.paused = !state.paused; e.target.textContent = state.paused ? '继续' : '暂停'; }
  });
  panel.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = panel.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    panel.setPointerCapture(e.pointerId); panel.classList.add('moving'); state.dragged = true;
    const move = m => place(m.clientX - dx, m.clientY - dy);
    const up = () => { panel.classList.remove('moving'); panel.removeEventListener('pointermove', move); panel.removeEventListener('pointerup', up); panel.removeEventListener('pointercancel', up); };
    panel.addEventListener('pointermove', move); panel.addEventListener('pointerup', up); panel.addEventListener('pointercancel', up);
  });
  note(0);
  { const r = panel.getBoundingClientRect(); place(innerWidth - r.width - 20, innerHeight - r.height - 20); }
  panel.querySelector('[data-d=close]').focus({preventScroll: true});
  play();
}
