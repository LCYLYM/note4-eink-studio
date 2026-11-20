// NOTE4 Studio v2.3: Minimalist Paper-Style E-Ink Co-Pilot, Streaming Harness & AI Push-Doc Relay.
import {Note4Vm} from './vm.js?v=24';
import {Note4USB} from './usb.js?v=23';
import {showFlasher, flashApp, pickPort} from './flasher.js?v=23';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const kb = n => (n / 1024 < 10 ? (n / 1024).toFixed(1) : Math.round(n / 1024)).toString();
const tokFmt = n => (!n || n <= 0 ? '' : n < 1000 ? `${n} tok` : `${(n / 1000).toFixed(1)}K`);
const renderReplyHtml = text => esc(text ?? '').replace(/`([^`\n]{1,80})`/g, '<code>$1</code>');
function friendlyTaskError(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '制作未完成，请点「继续修复」重试';
  if (/LOOP_GUARD_PAUSED|REPEATED_TOOL_FAILURE/.test(s)) return 'AI 遇到反复报错已自动暂停，可点「继续修复」或补充一句调整方向';
  if (/TASK_BUDGET_REACHED/.test(s)) return '本轮修改步骤较多已自动暂停，草稿已保存，点「继续修复」可接着完成';
  if (/TOKEN_BUDGET/.test(s)) return '本轮额度上限已到，草稿已保留，可点「新开对话」继续轻量修改';
  if (/CONTEXT_REQUIRES_SLICES/.test(s)) return '对话内容偏长，建议点「新开对话」清空旧上下文后再继续（代码会完整保留）';
  if (/MODEL_TRUNCATED/.test(s)) return '模型单次输出过长被截断，点「继续修复」会改为小步增量修改';
  if (/Service restarted/.test(s)) return '服务刚刚重启更新，草稿已保留，点「继续修复」即可接着做';
  return s;
}
const bytes = s => new TextEncoder().encode(String(s ?? '')).length;
const ACTIVE = ['queued', 'running'];
const PHASES = ['理解需求', '编写代码', '真机核验'];
const STEPS = {
  get_work: ['理解需求', '读取当前应用'],
  get_template: ['理解需求', '参考已有模板'],
  discover_capabilities: ['理解需求', '核对屏幕边界'],
  edit_source: ['编写代码', '精准微调代码'],
  patch_fields: ['编写代码', '更新应用代码'],
  patch_work: ['编写代码', '写入应用代码'],
  output_truncated: ['编写代码', '改为增量微调重试'],
  check_work: ['真机核验', '在设备同款引擎试跑核验'],
  build_work: ['真机核验', '编译设备安装包'],
  draft_service: ['编写代码', '起草后台服务'],
  update_service: ['编写代码', '更新后台服务'],
  check_service: ['真机核验', '验证后台服务'],
};

const HERO_PICKS = [
  {id: 'muyu', label: '赛博木鱼'},
  {id: 'relay_board', label: '云端桌贴'},
  {id: 'claude_hud', label: 'AI 任务盯盘'},
  {id: 'pomodoro', label: '种树番茄钟'},
  {id: 'iching', label: '周易六十四卦'},
  {id: 'pet', label: '电子宠物'},
];

const STARTER_CHIPS = [
  {label: '电脑任务盯盘', prompt: '做一个电脑任务盯盘看板，通过数据推送通道接收我的电脑任务名、进度和状态，按确定键回传确认'},
  {label: '桌面便签留言板', prompt: '做一个桌面留言板，通过数据推送通道接收我从电脑或手机发来的文字大字展示，挥手刷新，按确定回传已阅'},
  {label: '25 分钟种树番茄钟', prompt: '做一个 25 分钟种树番茄钟，随专注进度长出一棵像素小树，挥手暂停或继续，记录本周专注次数'},
  {label: '四级单词闪卡', prompt: '做一个英语单词记忆卡片，先显示英文，按确定翻看中文和例句，区分认识和待复习并记录进度'},
];

const MODEL_PRESETS = [
  {label: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat'},
  {label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4.1'},
  {label: '硅基流动', url: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-Coder-32B-Instruct'},
  {label: '本地 Ollama', url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-coder:14b'},
];

const SYNC = [
  [5, '每 5 分钟'],
  [15, '每 15 分钟'],
  [30, '每 30 分钟'],
  [60, '每 1 小时（推荐）'],
  [360, '每 6 小时'],
  [1440, '每天一次'],
  [0, '仅手动检查更新'],
];
const syncName = m => m === undefined || m === null ? '每 1 小时' : m === 0 ? '仅手动' : m === 65535 ? '持久连接' : m < 60 ? `每 ${m} 分钟` : m < 1440 ? `每 ${m / 60} 小时` : '每天';
function ago(t) {
  if (!t) return '尚未同步';
  const m = Math.floor((Date.now() - new Date(t).getTime()) / 60000);
  return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.floor(m / 60)} 小时前` : `${Math.floor(m / 1440)} 天前`;
}
function clockFmt(t) {
  if (!t) return '--:--';
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
const UPDATE_TIP = '长按设备音量加，选「立即检查更新」可马上同步';
const INK = [36, 35, 31], PAPER = [236, 231, 218];

const S = {
  devices: [],
  user: null,
  view: 'home',
  works: [],
  templates: null,
  tplCache: new Map(),
  heroId: 'muyu',
  heroStore: {},
  catFilter: '全部',
  search: '',
  work: null,
  relay: null,
  inspectorTab: 'code',
  openDet: {settings: false, code: false},
  netLogs: [],
  task: null,
  pendingMsg: '',
  cancelling: false,
  liveDraftRev: 0,
  config: null,
  openSteps: false,
  error: '',
  revisions: [],
  tasks: [],
  push: '',
  store: {},
};

const usb = new Note4USB();
let vm, tickTimer, elapsedTimer, pollTimer, taskES = null, frameCache, inAutoTick = false;
const previewAutoNetAt = new Map();

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method,
    headers: body === undefined ? {} : {'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({error: 'HTTP ' + r.status}));
  if (!r.ok) throw Object.assign(Error(data.error || data.message || data.detail || 'HTTP ' + r.status), {status: r.status});
  return data;
}

function tell(m) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(tell.t);
  tell.t = setTimeout(() => t.classList.remove('show'), 3600);
}

function openModal(title, html, narrow = false) {
  const d = $('#dialog');
  d.className = narrow ? 'narrow' : '';
  d.innerHTML = `<div class="dlg-head"><h2>${esc(title)}</h2><button type="button" class="dlg-close" data-act="close" aria-label="关闭">×</button></div>${html}`;
  if (!d.open) d.showModal();
  requestAnimationFrame(() => syncClipPills(d));
}
function dialog(title, html) {
  openModal(title, `${html}<p style="margin-top:16px"><button class="link under" data-act="close">关闭</button></p>`, true);
}

const recall = k => { try { return JSON.parse(localStorage.getItem('note4.' + k)); } catch { return null; } };
const remember = (k, v) => { try { localStorage.setItem('note4.' + k, JSON.stringify(v)); } catch {} };

async function copyText(text, label = '已复制到剪贴板') {
  try {
    await navigator.clipboard.writeText(text);
    tell(label);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    tell(label);
  }
}

function syncClipPills(root = document) {
  root.querySelectorAll('.clip-tabs').forEach(bar => {
    const active = bar.querySelector('.clip-tab[aria-selected="true"]');
    let pill = bar.querySelector('.clip-pill');
    if (!active) { if (pill) pill.style.opacity = '0'; return; }
    const firstMount = !pill;
    if (!pill) {
      pill = document.createElement('span');
      pill.className = 'clip-pill';
      bar.prepend(pill);
    }
    if (firstMount) pill.style.transition = 'none';
    pill.style.opacity = '1';
    pill.style.width = `${active.offsetWidth}px`;
    pill.style.transform = `translate3d(${active.offsetLeft}px, 0, 0)`;
    if (firstMount) requestAnimationFrame(() => { pill.style.transition = ''; });
  });
}

const stripKit = src => String(src ?? '').replace(/^.*typeof\s+N4_RELAY.*$/gm, '');
const templateMeta = id => (S.templates ?? []).find(t => t.id === id) || null;

function resolveConnMode(specJs, tpl) {
  if (!specJs) return tpl?.conn_mode || 'local';
  if (specJs.conn_mode && specJs.conn_mode !== 'auto') return specJs.conn_mode;
  if (specJs.relay_url) return 'relay';
  if (tpl?.conn_mode) return tpl.conn_mode;
  if (specJs.secret_label) return /地址|链接|URL|订阅|Webhook/i.test(specJs.secret_label) ? 'url' : 'apikey';
  const body = stripKit(specJs.source);
  if (/\/\/\s*RELAY_JSON\s*:/.test(body) || (/\bRELAY\b/.test(body) && /\bnet\.request\b/.test(body))) return 'relay';
  if (/\bKEY\b|\bSECRET\b/.test(body) && /\bnet\.request\b/.test(body)) return 'apikey';
  if (/\bnet\.request\b/.test(body)) return 'public';
  return 'local';
}

function usesRelayCode(src) {
  const body = stripKit(src);
  return /\bnet\.request\b/.test(body) && /\b(RELAY|N4_RELAY|KEY)\b/.test(body);
}

// ---- WASM Device Engine ----
async function engine() {
  if (vm) return vm;
  const [w, f, af] = await Promise.all([
    fetch('vendor/note4_vm.wasm?v=24'),
    fetch('vendor/font16.bin'),
    fetch('vendor/fonts_aa.bin?v=24').catch(() => null),
  ]);
  if (!w.ok || !f.ok) throw Error('真机预览引擎加载失败，请刷新重试');
  const aaBytes = af && af.ok ? new Uint8Array(await af.arrayBuffer()) : undefined;
  return vm = await Note4Vm.create(await w.arrayBuffer(), new Uint8Array(await f.arrayBuffer()), 300, aaBytes);
}

function paintCanvas(canvasId, fastMode) {
  const c = $(canvasId);
  if (!c || !vm) return;
  const px = vm.pixels(fastMode), ctx = c.getContext('2d'), img = ctx.createImageData(400, 300);
  for (let i = 0; i < 120000; i++) {
    const t = px[i] / 15;
    for (let n = 0; n < 3; n++) img.data[i * 4 + n] = INK[n] + (PAPER[n] - INK[n]) * t;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function paint() {
  if (S.view === 'home') {
    const tpl = S.tplCache.get(S.heroId);
    paintCanvas('#heroScreen', (tpl?.refresh ?? 'fast') !== 'clear');
  } else if (S.work) {
    paintCanvas('#screen', S.work.spec.js.refresh !== 'clear');
  }
}

async function attachFrames(j) {
  if (!j?.asset && !j?.photos?.length) { vm.onFrame = null; return; }
  if (j.asset) {
    frameCache ??= new Uint8Array(await (await fetch('assets/ink-reveal.n4f?v=22')).arrayBuffer());
    const data = frameCache;
    vm.onFrame = (i, to) => {
      for (let n = 0; n < 30000; n++) {
        const b = data[i * 30000 + n];
        to[n * 2] = ((b >> 6) * 5) << 4 | ((b >> 4 & 3) * 5);
        to[n * 2 + 1] = ((b >> 2 & 3) * 5) << 4 | ((b & 3) * 5);
      }
    };
  } else {
    vm.onFrame = (i, to) => {
      const s = atob(j.photos[i]);
      for (let n = 0; n < 60000; n++) to[n] = s.charCodeAt(n);
    };
  }
}

function afterRun(code, where) {
  if (S.view === 'home') {
    S.heroStore = vm.store();
    paint();
    return;
  }
  const off = vm.oob();
  S.error = code !== 0
    ? `${where}出错：` + vm.log().trim().slice(0, 600)
    : off.count
      ? `画面超出 400x300 边界（约 x=${off.x}, y=${off.y}，共 ${off.count} 像素），点右侧「让 AI 修复」即可`
      : '';
  S.store = vm.store();
  paint();
  renderLive();
}

async function pump(q) {
  // In browser preview, throttle background on_tick() auto-GETs to at most once per 5 min so open tabs never burn quota.
  if (inAutoTick && q.method === 'GET') {
    const last = previewAutoNetAt.get(q.url) || 0;
    if (Date.now() - last < 300000) return;
    previewAutoNetAt.set(q.url, Date.now());
  }
  const started = performance.now();
  let st = 0, body = '', note = '';
  try {
    const r = await fetch(q.url, {
      method: q.method,
      body: q.body || undefined,
      headers: Object.fromEntries(q.headers.split('\n').filter(Boolean).map(l => {
        const i = l.indexOf(':');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })),
    });
    st = r.status;
    body = await r.text();
    if (new Blob([body]).size > 131072) { st = -1; body = ''; note = '响应超过 128KB 上限'; }
  } catch {
    note = '浏览器跨域拦截（真机联网不受影响）';
  }
  const ms = Math.round(performance.now() - started);
  if (S.view === 'app') {
    S.netLogs.unshift({at: Date.now(), key: q.key, method: q.method, url: q.url, status: st, bytes: bytes(body), ms, note});
    S.netLogs = S.netLogs.slice(0, 20);
  }
  if (q.gen !== vm.gen) return;
  afterRun(vm.net(q.key, st, body), '网络回调');
  vm.dirty();
  if (S.view === 'app' && S.work && q.method === 'POST' && q.url.includes('/api/relay/')) {
    loadRelay().then(() => {
      renderDataBar();
      if ($('#dialog')?.open && $('#relayModalRoot')) renderRelayModalBody();
      tell('已向推送通道回传屏幕动作');
    }).catch(() => {});
  }
}

function buildPreamble(j) {
  const effSecret = j.secret || (j.conn_mode === 'relay' && j.relay_url ? j.relay_url : '');
  return (j.relay_url ? `var N4_RELAY=${JSON.stringify(j.relay_url)};\n` : '') +
         (effSecret ? `var SECRET=${JSON.stringify(effSecret)};\n` : '');
}

async function runHero(id = S.heroId, keepStore = false) {
  S.heroId = id;
  if (!keepStore) S.heroStore = {};
  await engine();
  let tpl = S.tplCache.get(id);
  if (!tpl) {
    tpl = await api('/templates/' + encodeURIComponent(id));
    S.tplCache.set(id, tpl);
  }
  if (S.view !== 'home' || S.heroId !== id) return;
  await attachFrames(tpl);
  vm.onNet = q => pump(q);
  vm.start(tpl.source, keepStore ? S.heroStore : {}, tpl.refresh ?? 'fast', tpl.asset ? 64 : 0);
  S.heroStore = vm.store();
  vm.dirty();
  paint();
  updateHeroMeta();
  animateLoop();
}

async function run(keepStore) {
  if (S.work?.spec.kind !== 'js') return;
  await engine();
  const store = keepStore ? S.store : {};
  if (!keepStore) S.netLogs = [];
  const j = S.work.spec.js;
  await attachFrames(j);
  vm.onNet = q => pump(q);
  const code = vm.start(buildPreamble(j) + j.source, store, j.refresh ?? 'fast', j.asset ? 64 : j.photos?.length ?? 0);
  afterRun(code, '启动');
  vm.dirty();
  animateLoop();
}

function animateLoop() {
  clearTimeout(tickTimer);
  const step = () => {
    if (!vm) return;
    const ms = vm.tickMs();
    if (ms && !document.hidden) {
      inAutoTick = true;
      let r = 0;
      try { r = vm.tick(); } finally { inAutoTick = false; }
      if (r !== 0) return afterRun(r, '定时刷新');
      if (vm.dirty()) paint();
    }
    tickTimer = setTimeout(step, document.hidden ? 2000 : Math.max(ms || 250, 250));
  };
  tickTimer = setTimeout(step, 250);
}

function press(k) {
  if (!vm) return;
  if (S.view === 'app') {
    if (k === 'wave' && !S.work?.spec.js.wave) return;
    afterRun(vm.key(k), '按键 ' + k);
    vm.dirty();
  } else if (S.view === 'home') {
    vm.key(k);
    S.heroStore = vm.store();
    vm.dirty();
    paint();
  }
  const btn = document.querySelector(`[data-key="${k}"]`);
  if (btn) {
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 130);
  }
}

// ---- Data Loading & Agent Co-Pilot ----
async function loadWorks() {
  S.templates ??= (await api('/templates')).templates;
  S.works = (await api('/works')).works.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
}

async function loadRelay() {
  if (!S.work || S.work.spec.kind !== 'js') { S.relay = null; return null; }
  S.relay = await api(`/works/${S.work.id}/relay`).catch(() => null);
  return S.relay;
}

async function ensureRelay(rotate = false) {
  const res = await api(`/works/${S.work.id}/relay${rotate ? '/rotate' : ''}`, 'POST', {});
  S.relay = res;
  S.work = await api('/works/' + S.work.id);
  await history();
  return res;
}

async function history() {
  if (!S.work) return;
  const [r, t] = await Promise.all([api(`/works/${S.work.id}/revisions`), api('/ai/tasks')]);
  S.revisions = r.revisions.sort((a, b) => b.rev - a.rev).slice(0, 12);
  S.tasks = t.tasks.filter(x => x.work_id === S.work.id).sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
}

async function openWork(id, known) {
  if (S.task && S.task.work_id !== id) {
    stopFollow();
    S.task = null;
  }
  S.pendingMsg = '';
  S.cancelling = false;
  S.work = known ?? await api('/works/' + id);
  S.view = 'app';
  S.push = '';
  S.store = {};
  S.netLogs = [];
  S.error = '';
  S.revisions = [];
  S.tasks = [];
  S.relay = null;
  S.openDet = {settings: false, code: false};
  S.liveDraftRev = S.work.rev;
  location.hash = id;
  render();
  Promise.all([run(), history(), loadRelay()])
    .then(() => {
      if (S.work?.id === id) {
        const running = S.tasks.find(t => ACTIVE.includes(t.state));
        if (running && (!S.task || S.task.id !== running.id)) follow(running);
        render();
        paint();
        scrollChatBottom();
      }
    })
    .catch(e => tell(e.message));
}

async function save(mut) {
  const attempt = async () => {
    const spec = structuredClone(S.work.spec);
    mut(spec);
    S.work = await api('/works/' + S.work.id, 'PATCH', {base_rev: S.work.rev, spec});
    S.liveDraftRev = S.work.rev;
  };
  try {
    await attempt();
  } catch (e) {
    if (e.status !== 409) throw e;
    S.work = await api('/works/' + S.work.id);
    await attempt();
  }
  await history();
}

async function reload(keepStore) {
  S.work = await api('/works/' + S.work.id);
  S.liveDraftRev = S.work.rev;
  await Promise.all([history(), loadRelay()]);
  render();
  await run(keepStore);
  paint();
}

function parseSteps(t) {
  return (t?.steps ?? []).map(s => {
    const [phase, text] = STEPS[s.tool] ?? ['编写代码', s.tool];
    const r = s.result, bad = r?.ok === false || !!r?.error;
    return {
      tool: s.tool,
      phase,
      text: bad ? `${text}（修正中：${String(r.error ?? '').slice(0, 120)}）` : text,
      bad,
    };
  });
}

function startTaskClock() {
  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    const el = $('#taskTimer');
    if (!el || !S.task || !ACTIVE.includes(S.task.state)) {
      clearInterval(elapsedTimer);
      return;
    }
    const sec = Math.max(0, (Date.now() - (S.task.created_at || Date.now())) / 1000);
    el.textContent = `${sec.toFixed(1)}s`;
  }, 200);
}

let pollVisHandler;
function stopFollow() {
  clearTimeout(pollTimer);
  clearInterval(elapsedTimer);
  if (taskES) {
    try { taskES.close(); } catch {}
    taskES = null;
  }
  if (pollVisHandler) {
    document.removeEventListener('visibilitychange', pollVisHandler);
    pollVisHandler = null;
  }
}

function scrollChatBottom() {
  const list = $('.chat-list');
  if (list) list.scrollTop = list.scrollHeight;
}

function updateTimelineOnly() {
  const mount = $('#timelineMount');
  if (mount) {
    mount.innerHTML = renderTimelineHtml();
    scrollChatBottom();
  }
}

function follow(t) {
  stopFollow();
  S.task = t;
  S.pendingMsg = '';
  S.cancelling = false;
  S.openSteps = false;
  renderStream();
  renderLive();
  if (!ACTIVE.includes(t.state)) return finish(t);
  startTaskClock();

  let syncingDraft = false;
  let handledTerminal = false;
  const handleUpdate = async v => {
    if (!v || (S.task && S.task.id !== v.id)) return false;
    S.task = v;
    renderStream();
    if (S.work?.id === v.work_id && ACTIVE.includes(v.state) && !syncingDraft) {
      const patchedRev = [...(v.steps ?? [])]
        .reverse()
        .find(s => ['edit_source', 'patch_fields', 'patch_work'].includes(s.tool) && s.result?.rev)?.result?.rev;
      if (patchedRev && patchedRev > S.liveDraftRev) {
        S.liveDraftRev = patchedRev;
        syncingDraft = true;
        try {
          S.work = await api('/works/' + S.work.id);
          await run(true);
        } catch {} finally {
          syncingDraft = false;
        }
      }
    }
    if (!ACTIVE.includes(v.state)) {
      if (handledTerminal) return true;
      handledTerminal = true;
      stopFollow();
      S.cancelling = false;
      finish(v);
      return true;
    }
    return false;
  };

  // Fallback adaptive polling (only activated if SSE EventSource fails or is unsupported)
  const nextDelay = () => {
    const elapsed = Date.now() - (S.task?.created_at || Date.now());
    return elapsed < 15000 ? 1800 : elapsed < 45000 ? 2800 : 4000;
  };
  let pollingStarted = false;
  const poll = async () => {
    if (S.task?.id !== t.id || !ACTIVE.includes(S.task.state)) return;
    if (document.hidden) return;
    try {
      const v = await api(`/ai/tasks/${t.id}`);
      if (!(await handleUpdate(v))) pollTimer = setTimeout(poll, nextDelay());
    } catch {
      pollTimer = setTimeout(poll, 4000);
    }
  };
  const startPollingFallback = () => {
    if (pollingStarted || handledTerminal) return;
    pollingStarted = true;
    if (taskES) {
      try { taskES.close(); } catch {}
      taskES = null;
    }
    pollTimer = setTimeout(poll, 1200);
  };

  pollVisHandler = () => {
    if (!document.hidden && S.task?.id === t.id && ACTIVE.includes(S.task.state)) {
      if (pollingStarted) {
        clearTimeout(pollTimer);
        poll();
      } else if (!taskES || taskES.readyState === 2) {
        startPollingFallback();
      }
    }
  };
  document.addEventListener('visibilitychange', pollVisHandler);

  // Primary: true real-time SSE stream for instant token/step/reply streaming
  if (typeof EventSource !== 'undefined') {
    try {
      const es = new EventSource(`/api/ai/tasks/${encodeURIComponent(t.id)}/events`);
      taskES = es;
      es.onmessage = ev => {
        try {
          const v = JSON.parse(ev.data);
          // Never leave the rejection dangling: on a terminal event the ES is
          // already torn down, so a failed follow-up reload must not strand the UI.
          void handleUpdate(v).catch(() => {});
        } catch {}
      };
      es.onerror = () => {
        if (!handledTerminal && S.task?.id === t.id && ACTIVE.includes(S.task.state)) {
          startPollingFallback();
        }
      };
      return;
    } catch {}
  }
  startPollingFallback();
}

async function finish(t) {
  if (S.work?.id === t.work_id) {
    try {
      await reload(true);
    } catch {}
    scrollChatBottom();
    if (t.state === 'completed') tell('已完成制作并通过核验');
  } else {
    renderStream();
  }
}

async function ask(text) {
  if (S.config?.model?.status !== 'CONFIGURED') {
    modelDialog();
    return;
  }
  if (ACTIVE.includes(S.task?.state)) {
    tell('AI 正在制作中，请等它完成或先点停止');
    return;
  }
  // Optimistic UI: show user's message & streaming indicator immediately
  S.pendingMsg = text;
  updateTimelineOnly();
  renderStream();

  const sendTask = async () => {
    const fresh = await api('/works/' + S.work.id);
    S.work = fresh;
    S.liveDraftRev = fresh.rev;
    return api('/ai/tasks', 'POST', {work_id: S.work.id, base_rev: S.work.rev, message: text});
  };
  let task;
  try {
    task = await sendTask();
  } catch (e) {
    S.pendingMsg = '';
    if (e.status === 409) {
      try {
        task = await sendTask();
      } catch (e2) {
        const p = $('#prompt'); if (p && !p.value) p.value = text;
        updateTimelineOnly(); renderStream();
        throw e2;
      }
    } else if (e.status === 429) {
      const running = (await api('/ai/tasks').catch(() => ({tasks: []}))).tasks.find(t => ACTIVE.includes(t.state));
      if (running && running.work_id === S.work.id) {
        follow(running);
        render();
      } else {
        updateTimelineOnly(); renderStream();
      }
      tell(running ? '已有 AI 任务正在运行，请稍候或先点停止' : e.message);
      return;
    } else {
      const p = $('#prompt'); if (p && !p.value) p.value = text;
      updateTimelineOnly(); renderStream();
      throw e;
    }
  }
  follow(task);
  await history();
  render();
  scrollChatBottom();
}

async function create(text) {
  if (text && S.config?.model?.status !== 'CONFIGURED') {
    remember('pendingPrompt', text);
    modelDialog(true);
    return;
  }
  const w = await api('/works', 'POST', {kind: 'js'});
  await openWork(w.id, w);
  if (text) await ask(text);
  loadWorks().catch(() => {});
}

// ---- USB & Device Provisioning ----
async function connect() {
  if (!navigator.serial) throw Error('USB 连接需要电脑端 Chrome 或 Edge 浏览器');
  try {
    if (!usb.port) await usb.connect();
    const identity = await again(() => usb.command({op: 'usb_identity'}, 'identity', 3000)), status = await usb.status();
    usb.device = await api('/usb/attach', 'POST', {identity, status});
    usb.firmware = status.firmware;
    renderTopbar();
    renderLive();
    if ($('#dialog')?.open) $('#dialog').close();
    tell(`USB 已连接（固件 ${usb.firmware || '就绪'}），可以直接写入设备`);
  } catch (e) {
    if (/设备未确认/.test(e.message)) {
      throw Error('未收到 NOTE4 固件响应。如果是首次使用或固件较旧，请点顶部「连接设备」进入「备份与首次刷机」。');
    }
    throw e;
  }
}
const device = () => S.devices.find(d => d.wifi) ?? S.devices[0];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const again = async f => { for (let i = 0; ; i++) try { return await f(); } catch (e) { if (i >= 3) throw e; await sleep(1000); } };
async function loadDevices() { S.devices = (await api('/devices')).devices; }

const SETUP_STEPS = ['连接设备', '检查固件', '写入 2.4GHz WiFi', '等待联网'];
const setupStep = p => p < 5 ? 0 : p < 85 ? 1 : p < 92 ? 2 : 3;
const wifiHelp = r => r === 201 ? '找不到该 WiFi。NOTE4 仅支持 2.4GHz，手机热点请开启「最大兼容性」。' : [2, 15, 204, 205].includes(r) ? 'WiFi 密码不正确，请核对后重试。' : `无法连接该 WiFi（错误码 ${r}），请换一个 2.4GHz 网络重试。`;
function setupHelp(e) {
  if (e.name === 'NotFoundError') return '未选中串口设备。请使用数据线并在弹窗选择 USB JTAG/serial debug unit。';
  if (e.name === 'SecurityError') return '浏览器拦截了串口选择窗口，请再点一次重试。';
  if (e.name === 'NetworkError' || e.name === 'InvalidStateError' || /打不开|already open|Failed to open/i.test(e.message)) return '串口正被其他页面或终端占用，请关闭后重新插拔 USB 线。';
  return e.message || '配网未完成，请重新插拔 USB 线后重试。';
}

function deviceDialog() {
  const d = device();
  const form = `<form data-form="device" class="wifi"><label>2.4GHz WiFi 名称<input id="ssid" required maxlength="32" autocomplete="off" value="${esc(recall('ssid') ?? '')}"></label><label>WiFi 密码<input id="wifipw" type="password" maxlength="64" autocomplete="off" value="${esc(recall('wifipw') ?? '')}"></label><label>自动同步频率<select id="syncMin">${SYNC.map(([m, t]) => `<option value="${m}"${m === (recall('syncMin') ?? 60) ? ' selected' : ''}>${t}</option>`).join('')}</select></label><button class="btn solid" id="setupBtn">连接并配网</button><ol class="steps" id="setupSteps" hidden>${SETUP_STEPS.map(t => `<li>${t}</li>`).join('')}</ol><progress id="setupBar" max="100" value="0" hidden></progress><p id="setupState" class="small" role="status"></p></form><p class="small">仅首次配网需要插一次 USB 线。WiFi 密码只保存在浏览器和硬件本地，不上传云端。</p>`;
  const how = `<ol class="how"><li>用支持数据传输的 USB-C 线连接 NOTE4 与电脑</li><li>填写 2.4GHz WiFi 名称和密码，点击「连接并配网」</li><li>在弹窗中选择 <code>USB JTAG/serial debug unit</code></li></ol>`;
  if (S.config?.dev_mode) {
    const usbCard = usb.device
      ? `<div class="notice-bar accent"><div><div style="font-weight:600;font-size:13.5px">USB 设备已连接</div><div class="small">固件 ${esc(usb.firmware || '已就绪')} · 可在应用页直接点击「写入设备」</div></div><button type="button" class="btn sm soft" data-act="disconnect">断开连接</button></div>`
      : `<div style="display:flex;flex-direction:column;gap:10px"><ol class="how"><li>用可传数据的 USB-C 线将 NOTE4 连到电脑</li><li>点击下方按钮，在串口弹窗选择 <code>USB JTAG/serial debug unit</code></li><li>连接后在任意应用页点「写入设备」即可上屏</li></ol><div class="row"><button type="button" class="btn solid" data-act="connect">通过 USB 连接设备</button><button type="button" class="btn soft" data-act="flash">首次刷机与备份</button></div></div>`;
    return openModal('连接 NOTE4 设备', `<div style="display:flex;flex-direction:column;gap:12px">${usbCard}<details style="padding-top:8px;border-top:1px solid var(--line)"><summary style="cursor:pointer;font-size:13px;font-weight:500">高级：WiFi 配网或刷入最新系统</summary><div style="margin-top:10px">${how}${form}<p style="margin-top:10px"><button class="link under" data-act="flash">打开固件备份与首次安装</button></p></div></details></div>`, true);
  }
  if (!d?.wifi) return openModal('添加设备', `${how}${form}<p style="margin-top:10px"><button class="link under" data-act="flash">高级：固件备份与首次刷机</button></p>`, true);
  openModal('我的设备', `<div class="kv-row"><span>状态</span><span>${esc(ago(d.last_seen))}同步 · ${esc(syncName(d.sync_minutes))} · 固件 ${esc(d.firmware?.version ?? '未知')}</span></div><p class="small" style="margin-top:8px">发布新应用或推送新数据后，设备会在下次同步时更新；也可长按设备音量加选「立即检查更新」。</p><details style="margin-top:10px"><summary style="cursor:pointer;font-weight:500">通过 USB 修改 WiFi 或升级固件</summary>${how}${form}</details><p style="margin-top:10px"><button class="link under" data-act="flash">高级：固件备份与首次刷机</button></p>`, true);
}

async function ensureFirmware(say) {
  if (!usb.port && !(await navigator.serial.getPorts()).some(p => p.getInfo().usbVendorId === 0x303a)) say('请在弹窗中选择 USB JTAG/serial debug unit 并点击连接', 2);
  const chosen = await pickPort(usb);
  const manifest = await api('/firmware/usb/manifest');
  say('正在核对固件版本', 3);
  try {
    const now = await Promise.race([usb.connect(chosen), sleep(8000).then(() => { throw Error('timeout'); })]);
    if (now.firmware === manifest.version && !/initializing/.test(now.startup_error || '')) { say('固件已是最新', 84); return; }
  } catch {}
  await usb.disconnect().catch(() => {});
  const wrote = await flashApp({usb, manifest, port: chosen, say: (m, p) => say(m, p === undefined ? undefined : 5 + p * 0.75)});
  say(wrote ? '新固件已写入，等待重启...' : '固件就绪，等待重启...', 82);
  const end = Date.now() + 40000;
  while (Date.now() < end) {
    await sleep(1500);
    try {
      const port = (await navigator.serial.getPorts()).find(p => p.getInfo().usbVendorId === 0x303a);
      if (!port) continue;
      const now = await usb.connect(port);
      if (/initializing/.test(now.startup_error || '')) continue;
      if (now.firmware === manifest.version) { say('系统就绪', 84); return; }
      throw Error('VERSION');
    } catch (e) { if (e.message === 'VERSION') throw Error('固件版本未更新，请通过「高级：固件备份与首次刷机」重试'); }
  }
  throw Error('设备重启超时，请重新插拔 USB 线后重试');
}

async function setupDevice() {
  if (!navigator.serial) throw Error('配网需要电脑端 Chrome 或 Edge');
  const ssid = $('#ssid').value.trim(), password = $('#wifipw').value, sync_minutes = Number($('#syncMin').value), btn = $('#setupBtn'), bar = $('#setupBar');
  const mark = (at, failed) => { const list = $('#setupSteps'); list.hidden = false; [...list.children].forEach((li, i) => { li.className = i < at ? 'done' : i > at ? '' : failed ? 'bad' : 'now'; }); };
  let reached = 0;
  const report = (m, p) => { $('#setupState').textContent = m; if (p !== undefined) { reached = setupStep(p); bar.hidden = false; bar.value = p; mark(reached); } };
  if (!ssid) throw Error('请填写 2.4GHz WiFi 名称');
  btn.disabled = true;
  try {
    report('正在连接设备...', 2);
    await ensureFirmware(report);
    const identity = await again(() => usb.command({op: 'usb_identity'}, 'identity', 3000)), status = await usb.status();
    const d = usb.device = await api('/usb/attach', 'POST', {identity, status});
    report('正在写入 WiFi 信息...', 88);
    const grant = await api('/usb/wifi', 'POST', {identity});
    const reply = await usb.command({op: 'provision', ssid, password, base_url: grant.base_url, device_token: grant.device_token, device_id: grant.device_id, sync_minutes}, 'reply');
    if (!reply.provisioned) throw Error('设备未接受配网参数');
    remember('ssid', ssid); remember('syncMin', sync_minutes); remember('wifipw', password);
    await usb.disconnect();
    report('设备正在重启并连接 WiFi（约 15-45 秒）...', 92);
    for (let i = 0; i < 12; i++) {
      await sleep(5000);
      try { const port = (await navigator.serial.getPorts()).find(p => p.getInfo().usbVendorId === 0x303a); const s = port && await usb.connect(port); if (s?.wifi_error) throw Object.assign(Error(wifiHelp(s.wifi_error)), {wifi: true}); else await usb.disconnect(); } catch (e) { if (e.wifi) throw e; }
      await loadDevices();
      const now = S.devices.find(x => x.id === d.id);
      if (now?.online && now.boot_id !== d.boot_id) { report('配网成功，现在可以拔下 USB 线无线使用。', 100); await loadDevices(); renderTopbar(); return; }
      report('正在等待设备联网...', 92 + i * 0.6);
    }
    throw Error('1 分钟内未收到设备联网，请确认 WiFi 为 2.4GHz 且密码无误');
  } catch (e) {
    await usb.disconnect().catch(() => {});
    mark(reached, true); $('#setupState').textContent = setupHelp(e); btn.textContent = '重试'; renderTopbar();
  } finally { btn.disabled = false; }
}

async function publish() {
  if (S.error) throw Error('当前预览有报错或越界，请先修复再发布');
  const d = device();
  if (!d?.wifi) return deviceDialog();
  S.push = '正在发布...'; renderLive();
  try {
    const w = S.work, built = await api(`/works/${w.id}/build`, 'POST', {base_rev: w.rev});
    await api(`/devices/${encodeURIComponent(d.id)}/install`, 'POST', {build_id: built.build_id});
    await loadDevices();
    tell(`已发布 v${w.rev}，设备将在下次同步（${syncName(d.sync_minutes)}）更新，${UPDATE_TIP}`);
  } finally { S.push = ''; render(); }
}

async function push() {
  if (!S.config.dev_mode) return publish();
  if (S.error) throw Error('当前预览有错误，请先修复再写入');
  if (!usb.device) await connect();
  const setPush = m => { S.push = m; renderLive(); };
  setPush('正在编译...');
  const w = S.work, built = await api(`/works/${w.id}/build`, 'POST', {base_rev: w.rev});
  const op = await api(`/devices/${encodeURIComponent(usb.device.id)}/install`, 'POST', {build_id: built.build_id});
  const file = await fetch(built.artifact_url); if (!file.ok) throw Error('安装包下载失败');
  try {
    const state = await usb.upload(new Uint8Array(await file.arrayBuffer()), {buildId: built.build_id, commandId: op.command_id, onProgress: p => setPush(p < 1 ? `写入 ${Math.round(p * 100)}%` : '等待确认')});
    await api('/usb/observed', 'POST', {device_id: usb.device.id, command_id: op.command_id, status: state});
    const on = recall('written') ?? {}; on[w.id] = w.rev; remember('written', on);
    setPush(''); tell('已写入设备并开始运行'); render();
  } catch (e) {
    setPush('');
    await api('/usb/observed', 'POST', {device_id: usb.device.id, command_id: op.command_id, error: e.message}).catch(() => {});
    throw e;
  }
}
usb.addEventListener('disconnected', () => { usb.device = null; render(); });

// ---- Dithered Photos ----
function photoBytes(im) {
  const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(im, 0, 0, 400, 300);
  const d = x.getImageData(0, 0, 400, 300).data, g = new Float32Array(120000), out = new Uint8Array(60000);
  for (let i = 0; i < 120000; i++) g[i] = d[i * 4];
  for (let y = 0; y < 300; y++) for (let a = 0; a < 400; a++) { const i = y * 400 + a, v = Math.max(0, Math.min(15, Math.round(g[i] / 17))), e = g[i] - v * 17; if (a < 399) g[i + 1] += e * 7 / 16; if (y < 299) { if (a) g[i + 399] += e * 3 / 16; g[i + 400] += e * 5 / 16; if (a < 399) g[i + 401] += e / 16; } out[i >> 1] |= i & 1 ? v : v << 4; }
  let s = ''; for (let i = 0; i < 60000; i += 6000) s += String.fromCharCode(...out.subarray(i, i + 6000));
  return btoa(s);
}
function randomPhotos(n = 6) {
  const seed = Date.now();
  return Promise.all(Array.from({length: n}, (_, i) => new Promise((ok, no) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => ok(photoBytes(im)); im.onerror = () => no(Error('随机图片拉取失败，请再试一次')); im.src = `https://picsum.photos/seed/${seed + i}/400/300?grayscale`; })));
}

// ---- Modals: AI Push Doc, Secret / URL & Model Config ----
function renderRelayModalBody() {
  const root = $('#relayModalRoot');
  if (!root || !S.relay) return;
  const r = S.relay;
  const wired = usesRelayCode(S.work?.spec?.js?.source);
  const outbox = r.outbox ?? [];

  root.innerHTML = `<div style="display:flex;flex-direction:column;gap:14px">
    ${!wired ? `<div class="notice-bar warn"><span class="small">当前应用代码还未读取推送数据，点击右侧让 AI 自动接入。</span><button type="button" class="btn sm solid" data-act="agentWireRelay">让 AI 接入</button></div>` : ''}
    <p class="small">把下面这份文档直接发给你的 AI（如 Claude、Cursor），让它在本机写一个定时小服务，往这个带 Token 的公网链接发 JSON 即可。</p>
    <div class="link-bar">
      <code title="${esc(r.url)}">${esc(r.url)}</code>
      <button type="button" class="btn sm soft" data-act="copy" data-text="${esc(r.url)}">复制链接</button>
    </div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <button type="button" class="btn solid" data-act="copyAiDoc">一键复制推送文档</button>
      <span class="small num">已推送 ${r.push_count} 次${r.last_push_at ? ` · 最近 ${esc(ago(r.last_push_at))}` : ''}</span>
      <button type="button" class="del" data-act="relayRotate" style="margin-left:auto">重置链接</button>
    </div>
    <pre class="doc-preview">${esc(r.ai_doc || '')}</pre>
    <form class="quick-send" data-form="relayQuickSend">
      <input id="quickPushText" maxlength="400" placeholder="发一句话或 JSON 直接测试上屏（留空发送示例数据）">
      <button class="btn sm soft">发送测试</button>
    </form>
    ${outbox.length ? `<div style="display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid var(--line)">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span class="small">屏幕按键回传（${outbox.length} 条）</span>
        <span><button type="button" class="link under" data-act="relayRefresh">刷新</button> <button type="button" class="link" data-act="relayClearOutbox">清空</button></span>
      </div>
      ${outbox.slice(0, 5).map(item => `<div class="kv-row"><span>${esc(item.text)}</span><span class="small num">${esc(clockFmt(item.at))}</span></div>`).join('')}
    </div>` : ''}
  </div>`;
}

async function openRelayDialog() {
  if (!S.relay?.enabled) {
    await ensureRelay(false);
    render();
    await run(true);
  } else {
    await loadRelay();
  }
  openModal(`获取推送文档 · ${S.work.spec.title}`, `<div id="relayModalRoot"></div>`);
  renderRelayModalBody();
}

function secretDialog() {
  const j = S.work.spec.js;
  const tpl = templateMeta(j.gallery);
  const mode = resolveConnMode(j, tpl);
  const guide = tpl?.secret_guide;
  const isUrl = mode === 'url' || /地址|链接|URL|订阅|Webhook/i.test(j.secret_label ?? '');
  const label = j.secret_label || (isUrl ? '订阅或接口链接' : '第三方平台密钥');

  openModal(isUrl ? '填写数据链接' : '填写接口密钥', `<div style="display:flex;flex-direction:column;gap:12px">
    <p class="small">${esc(guide?.what || label)}${guide?.where ? ' ' + esc(guide.where) : ''}</p>
    <div class="field-grid">
      <label>${esc(label)}
        <div style="display:flex;gap:8px">
          <input id="secretVal" type="${isUrl ? 'url' : 'password'}" autocomplete="off" maxlength="2048" placeholder="${esc(guide?.placeholder || (isUrl ? 'https://...' : '粘贴 Token，留空保存可清除'))}" value="${esc(j.secret ?? '')}">
          ${!isUrl ? `<button type="button" class="btn sm soft" data-act="toggleSecretVis">显示</button>` : ''}
        </div>
      </label>
    </div>
    <p class="small">凭证仅加密保存在你的账号中，打包时写入你的设备，AI 无法读取。</p>
    <div style="display:flex;align-items:center;gap:10px">
      <button type="button" class="btn solid" data-act="secretSave">保存并刷新</button>
    </div>
  </div>`, true);
}

async function modelDialog(fromPrompt = false) {
  let m = S.config?.model ?? {};
  if (S.user?.role === 'admin') {
    const detail = await api('/admin/models').catch(() => null);
    if (detail) m = {...m, ...detail};
  }
  const curBase = m.base_url || '';
  const curModel = m.backends?.[0]?.model || '';
  openModal('配置 AI 模型', `<form data-form="modelConfig" style="display:flex;flex-direction:column;gap:12px">
    ${fromPrompt ? `<div class="notice-bar warn"><span class="small">先配置好模型接口即可开始制作，你刚才的想法已自动暂存。</span></div>` : ''}
    <p class="small">兼容任意 OpenAI 格式接口，可点选下方常用预设：</p>
    <div class="prompt-chips">
      ${MODEL_PRESETS.map((p, idx) => `<button type="button" class="chip" data-act="modelPreset" data-idx="${idx}">${esc(p.label)}</button>`).join('')}
    </div>
    <div class="field-grid">
      <label>接口地址 (Base URL)<input id="mBaseUrl" required placeholder="https://api.deepseek.com/v1" value="${esc(curBase)}"></label>
      <label>模型名称 (Model ID)<input id="mModel" required placeholder="deepseek-chat" value="${esc(curModel)}"></label>
      <label>API Key ${m.status === 'CONFIGURED' ? '（已配置，留空保持不变）' : ''}<input id="mApiKey" type="password" autocomplete="off" placeholder="sk-..." ${m.status === 'CONFIGURED' ? '' : 'required'}></label>
    </div>
    <p id="modelProbeMsg" class="small"></p>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn solid" id="modelSaveBtn">测试并保存</button>
      <span class="small">仅保存于服务端数据库，绝不返回前端</span>
    </div>
  </form>`, true);
}

// ---- Renderers ----
function topbarHtml() {
  const d = device();
  const modelOk = S.config?.model?.status === 'CONFIGURED';
  const devBtn = S.config?.dev_mode
    ? `<button class="pill-btn" data-act="device"><span class="dot ${usb.device ? 'on' : ''}"></span>${usb.device ? 'USB 已连接' : '连接设备'}</button>`
    : `<button class="pill-btn" data-act="device"><span class="dot ${d?.wifi && d.online ? 'on' : d?.wifi ? 'warn' : ''}"></span>${!d ? '添加设备' : !d.wifi ? '待配网' : `设备 · ${ago(d.last_seen)}`}</button>`;
  const modelBtn = S.user?.role === 'admin'
    ? `<button class="pill-btn" data-act="modelCfg"><span class="dot ${modelOk ? 'on' : 'warn'}"></span>${modelOk ? 'AI 已就绪' : '配置 AI'}</button>`
    : '';
  return `<header class="topbar" id="topbar">
    <button type="button" class="brand-btn" data-act="home"><span class="brand-mark">N4</span><span>NOTE4 创作台</span></button>
    <div class="top-end">
      ${S.view === 'app' ? `<button type="button" class="link under" data-act="home">返回首页</button>` : ''}
      <button type="button" class="link" data-act="demo">1 分钟演示</button>
      ${modelBtn}
      ${devBtn}
      ${S.user && !S.config?.dev_mode ? '<button type="button" class="link" data-act="logout">退出</button>' : ''}
    </div>
  </header>`;
}

function renderTopbar() {
  const el = $('#topbar');
  if (el) el.outerHTML = topbarHtml();
}

function updateHeroMeta() {
  const meta = templateMeta(S.heroId) || S.tplCache.get(S.heroId);
  const el = $('#heroSimMeta');
  if (!el || !meta) return;
  el.innerHTML = `<b>${esc(meta.title)}</b><span>${esc(meta.use)}</span>`;
  $$('.sim-pick').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === S.heroId)));
}

function renderGalleryCards() {
  const all = S.templates ?? [];
  const q = S.search.trim().toLowerCase();
  const filtered = all.filter(t => {
    if (S.catFilter !== '全部' && t.cat !== S.catFilter) return false;
    if (q && !`${t.title} ${t.use} ${t.cat}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (!filtered.length) {
    return `<div class="notice-bar"><span class="small">没有找到匹配的模板，试试换个关键词或直接在上方用一句话定制。</span><button type="button" class="btn sm soft" data-act="resetFilter">重置筛选</button></div>`;
  }
  return `<div class="tpls">${filtered.map(t => `<article class="tpl-card">
    <button type="button" class="tpl-thumb-btn" data-act="tpl" data-id="${esc(t.id)}" aria-label="打开并改装 ${esc(t.title)}">
      <img src="thumbs/${esc(t.id)}.png?v=22" alt="${esc(t.title)}" loading="lazy" width="400" height="300">
    </button>
    <div class="tpl-body">
      <div class="tpl-top">
        <b>${esc(t.title)}</b>
        <button type="button" class="link" data-act="tryTpl" data-id="${esc(t.id)}">试玩</button>
      </div>
      <p class="tpl-desc">${esc(t.use)}</p>
    </div>
  </article>`).join('')}</div>`;
}

function homeHtml() {
  const jsWorks = S.works.filter(w => w.spec.kind === 'js');
  const cats = ['全部', ...new Set((S.templates ?? []).map(t => t.cat).filter(Boolean))];
  const modelOk = S.config?.model?.status === 'CONFIGURED';

  const worksShelf = jsWorks.length ? `<section class="section-block">
    <div class="sec-bar">
      <h2>我的应用</h2>
      <button type="button" class="link under" data-act="blank">新建空白应用</button>
    </div>
    <div class="works-grid">
      ${jsWorks.map(w => {
        const tpl = templateMeta(w.spec.js.gallery);
        const mode = w.has_relay ? 'relay' : resolveConnMode(w.spec.js, tpl);
        return `<div class="work-card">
          <button type="button" class="work-card-main" data-act="open" data-id="${esc(w.id)}">
            <b>${esc(w.spec.title)}</b>
            <span class="num">${esc(ago(w.updated_at))}更新 · v${w.rev}${mode === 'relay' ? ' · 支持推送' : ''}</span>
          </button>
          <button type="button" class="del" data-act="del" data-id="${esc(w.id)}">删除</button>
        </div>`;
      }).join('')}
    </div>
  </section>` : '';

  return `<main class="shell">
    ${topbarHtml()}
    ${!S.config?.dev_mode && !device()?.wifi ? `<div class="notice-bar"><span class="small">还没有绑定设备，不妨先在网页里做应用并试玩；设备到手配网后就能无线发布。</span><button type="button" class="btn sm solid" data-act="device">添加设备</button></div>` : ''}
    <section class="hero">
      <div class="hero-copy">
        <h1>说一句话，给墨水屏做个小应用。</h1>
        <p class="hero-sub">直接说出你的想法，或从下面挑一款模板改装。网页里先试玩，满意后发布到墨水屏；需要从自己电脑同步数据时，一键拿文档发给 AI 即可。</p>
        <form data-form="new" class="composer">
          <textarea id="prompt" rows="2" aria-label="描述你想做的墨水屏应用" placeholder="例如：做一个桌面番茄钟、每日天气，或接收电脑推送状态的看板..."></textarea>
          <div class="composer-foot">
            <span class="small" style="display:inline-flex;align-items:center;gap:6px">
              <span class="dot ${modelOk ? 'on' : 'warn'}"></span>
              ${modelOk ? 'AI 已就绪' : 'AI 模型待配置'}
              ${!modelOk ? `<button type="button" class="link under" data-act="modelCfg">去配置</button>` : ''}
            </span>
            <button class="btn solid">开始制作</button>
          </div>
        </form>
        <div class="prompt-chips">
          ${STARTER_CHIPS.map(c => `<button type="button" class="chip" data-act="hint" data-prompt="${esc(c.prompt)}">${esc(c.label)}</button>`).join('')}
        </div>
      </div>

      <div class="hero-sim">
        <div class="sim-picks">
          ${HERO_PICKS.map(p => `<button type="button" class="sim-pick" data-act="tryTpl" data-id="${p.id}" aria-pressed="${p.id === S.heroId}">${esc(p.label)}</button>`).join('')}
        </div>
        <div class="bezel">
          <div class="screen-well">
            <canvas id="heroScreen" class="eink" width="400" height="300" aria-label="NOTE4 实时模拟器"></canvas>
          </div>
          <div class="hw-bar">
            <button type="button" class="hw-key" data-key="up">上</button>
            <button type="button" class="hw-key" data-key="ok">确定</button>
            <button type="button" class="hw-key" data-key="down">下</button>
            <button type="button" class="hw-key" data-key="wave">挥手</button>
            <span class="spacer"></span>
            <button type="button" class="hw-restart" data-act="heroRestart">重置</button>
          </div>
        </div>
        <div class="sim-foot">
          <div class="sim-meta" id="heroSimMeta"></div>
          <button type="button" class="btn sm solid" data-act="forkHero">打开改装</button>
        </div>
      </div>
    </section>

    ${worksShelf}

    <section class="section-block" id="gallerySec">
      <div class="sec-bar">
        <h2>模板库</h2>
        <span class="small num">${(S.templates ?? []).length} 款模板，点开即可改装</span>
      </div>
      <div class="filter-row">
        <div class="clip-tabs" id="catTabs" role="tablist">
          ${cats.map(c => `<button type="button" class="clip-tab" role="tab" data-act="catFilter" data-cat="${esc(c)}" aria-selected="${S.catFilter === c}">${esc(c)}</button>`).join('')}
        </div>
        <label class="search-box" aria-label="搜索模板">
          <input id="tplSearch" type="search" placeholder="搜索模板..." value="${esc(S.search)}">
        </label>
      </div>
      <div id="galleryMount">${renderGalleryCards()}</div>
    </section>
  </main>`;
}

function dataBarHtml() {
  if (!S.work) return '';
  const j = S.work.spec.js, tpl = templateMeta(j.gallery);
  const mode = S.relay?.enabled ? 'relay' : resolveConnMode(j, tpl);
  const r = S.relay;

  if (mode === 'relay') {
    const stat = r?.push_count
      ? `已收到 ${r.push_count} 次推送${r.reply_count ? ` · 屏幕回传 ${r.reply_count} 条` : ''}`
      : '复制接入文档发给你的 AI，即可从电脑定时推 JSON 上屏';
    return `<div class="notice-bar accent">
      <div>
        <div style="font-weight:600;font-size:13.5px">数据推送通道已就绪</div>
        <div class="small num">${stat}</div>
      </div>
      <button type="button" class="btn sm solid" data-act="relayOpen">获取推送文档</button>
    </div>`;
  }

  if (mode === 'apikey' || mode === 'url') {
    const isUrl = mode === 'url';
    const filled = !!j.secret;
    return `<div class="notice-bar${filled ? '' : ' warn'}">
      <div>
        <div style="font-weight:600;font-size:13.5px">${esc(j.secret_label || (isUrl ? '数据链接' : '接口密钥'))}</div>
        <div class="small">${filled ? '已配置，发布到设备时自动生效' : '未填写，当前预览显示示例数据'}</div>
      </div>
      <button type="button" class="btn sm soft" data-act="secret">${filled ? '修改' : (isUrl ? '填写链接' : '填写密钥')}</button>
    </div>`;
  }

  return '';
}

function renderDataBar() {
  const el = $('#connBar');
  if (el) el.innerHTML = dataBarHtml();
}

function smartFollowupChips() {
  if (!S.work) return [];
  const j = S.work.spec.js, tpl = templateMeta(j.gallery);
  const mode = S.relay?.enabled ? 'relay' : resolveConnMode(j, tpl);
  const chips = [];
  if (mode !== 'relay') chips.push({label: '改成支持电脑定时推送', prompt: '帮我把这个应用接入数据推送通道 RELAY，支持从电脑定时推送 JSON 数据更新画面，并在源码首行写明 RELAY_JSON 字段示例'});
  if (!j.wave) chips.push({label: '加上隔空挥手操作', prompt: '开启隔空挥手支持，挥手时触发最常用的快捷动作，并在底部提示里写清楚'});
  chips.push(
    {label: '主内容字号放大一点', prompt: '把主焦点数字或核心文字放大一档并优化排版留白，确保不超出 400x300 边界'},
    {label: '加一页历史统计', prompt: '增加一个可切换的历史统计视图，用简洁的黑白柱状条展示最近记录'},
  );
  return chips.slice(0, 3);
}

function renderTimelineHtml() {
  const doneTasks = S.tasks.filter(t => t.id !== S.task?.id || !ACTIVE.includes(t.state));
  const busy = ACTIVE.includes(S.task?.state) || !!S.pendingMsg;
  if (!doneTasks.length && !S.pendingMsg) {
    return `<p class="small">直接说你想怎么改，AI 会自动调整代码并在右侧预览屏运行。</p>`;
  }
  const latestDone = doneTasks.at(-1);
  const items = doneTasks.slice(-12).map(t => {
    const ok = t.state === 'completed';
    const isLatestRecoverable = t === latestDone && !busy && ['failed', 'paused'].includes(t.state) && t.id !== S.task?.id;
    const tok = tokFmt(t.tokens);
    const meta = [t.actual_rev ? `v${t.actual_rev}` : '', tok, ago(t.created_at)].filter(Boolean).join(' · ');
    const answerHtml = t.reply
      ? renderReplyHtml(t.reply)
      : ok
        ? '已完成修改并通过核验。'
        : t.error
          ? esc('未完成：' + friendlyTaskError(t.error))
          : '已停止';
    return `<div class="chat-turn${!ok && t.state !== 'cancelled' ? ' err-turn' : ''}">
      <div class="chat-q">${esc(t.message)}</div>
      <div class="chat-a">${answerHtml}</div>
      <div class="chat-foot">
        <span class="num">${esc(meta)}</span>
        <span style="display:inline-flex;gap:10px;align-items:center">
          ${isLatestRecoverable ? `<button type="button" class="link under" data-act="resumeTask" data-id="${esc(t.id)}">继续修复</button>` : ''}
          ${t.actual_rev && t.actual_rev !== S.work.rev ? `<button type="button" class="link under" data-act="restore" data-rev="${t.actual_rev}">恢复到 v${t.actual_rev}</button>` : ''}
        </span>
      </div>
    </div>`;
  });
  if (S.pendingMsg) {
    items.push(`<div class="chat-turn pending-turn">
      <div class="chat-q">${esc(S.pendingMsg)}</div>
      <div class="chat-a">正在发送请求...</div>
    </div>`);
  }
  const header = doneTasks.length >= 2 && !busy
    ? `<div class="chat-bar"><span class="small num">对话记录（${doneTasks.length} 轮）</span><button type="button" class="link" data-act="resetContext">新开对话</button></div>`
    : '';
  return `${header}<div class="chat-list">${items.join('')}</div>`;
}

function renderStream() {
  const el = $('#stream'), t = S.task;
  if (!el) return;
  if (S.pendingMsg && (!t || !ACTIVE.includes(t.state))) {
    el.innerHTML = `<div class="stream-card"><div class="phases"><span class="now"><span class="dot"></span>理解需求</span><span><span class="dot"></span>编写代码</span><span><span class="dot"></span>真机核验</span><span class="timer num">0.0s</span></div><div style="font-size:13px">正在连接 AI 引擎...</div></div>`;
    return;
  }
  if (!t || t.work_id !== S.work?.id) { el.innerHTML = ''; return; }
  const list = parseSteps(t), active = ACTIVE.includes(t.state), done = t.state === 'completed';
  if (!active && done && S.tasks.some(x => x.id === t.id)) { el.innerHTML = ''; return; }

  const liveToolPhase = t.live_tool ? (STEPS[t.live_tool]?.[0] ?? '编写代码') : null;
  const cur = active ? PHASES.indexOf(liveToolPhase ?? list.at(-1)?.phase ?? '理解需求') : -1;

  let lineHtml = '';
  if (active) {
    if (S.cancelling) {
      lineHtml = '正在停止本次制作...';
    } else if (t.live_reply && !t.live_tool) {
      lineHtml = `<div class="stream-live">${renderReplyHtml(t.live_reply)}</div>`;
    } else if (t.live_tool) {
      const toolLabel = STEPS[t.live_tool]?.[1] ?? t.live_tool;
      const sz = t.live_bytes > 200 ? `（${kb(t.live_bytes)} KB）` : '';
      lineHtml = esc(`正在${toolLabel}${sz}...`);
    } else {
      lineHtml = esc(list.at(-1)?.text ?? (t.state === 'queued' ? '排队中...' : '正在思考方案...'));
    }
  } else if (done) {
    lineHtml = renderReplyHtml(t.reply || '已完成制作，右侧预览已更新。');
  } else if (t.state === 'cancelled') {
    lineHtml = '已停止本次制作';
  } else if (t.state === 'unconfigured') {
    lineHtml = '请先配置 AI 模型接口';
  } else {
    lineHtml = esc((t.state === 'paused' ? '已暂停：' : '制作失败：') + friendlyTaskError(t.error));
  }

  const sec = Math.max(0, ((t.completed_at || Date.now()) - (t.created_at || Date.now())) / 1000).toFixed(1);
  const tok = tokFmt(t.tokens);

  el.innerHTML = `<div class="stream-card ${['failed', 'unconfigured'].includes(t.state) ? 'err-card' : ''}">
    <div class="phases">
      ${PHASES.map((p, i) => `<span class="${done || i < cur ? 'done' : i === cur ? 'now' : ''}"><span class="dot"></span>${p}</span>`).join('')}
      <span class="timer num" id="taskTimer">${sec}s</span>
      ${tok ? `<span class="small num">${esc(tok)}</span>` : ''}
      <button type="button" class="link under" data-act="toggleSteps">${S.openSteps ? '收起' : `明细 (${list.length})`}</button>
    </div>
    <div style="font-size:13px">${lineHtml}</div>
    ${active && S.liveDraftRev > (t.base_rev ?? 0) ? `<div class="small" style="color:var(--ok)">草稿 v${S.liveDraftRev} 已同步到右侧预览屏</div>` : ''}
    ${S.openSteps ? `<ol class="steps-log">${list.map(s => `<li${s.bad ? ' style="color:var(--bad)"' : ''}>${esc(s.phase)} · ${esc(s.text)}</li>`).join('') || '<li>等待开始...</li>'}</ol>` : ''}
    ${['failed', 'paused'].includes(t.state) ? `<div style="display:flex;gap:8px;align-items:center"><button type="button" class="btn sm soft" data-act="resume">继续修复</button><button type="button" class="link" data-act="resetContext">新开对话</button></div>` : ''}
    ${t.state === 'unconfigured' ? `<div><button type="button" class="btn sm solid" data-act="modelCfg">配置 AI 模型</button></div>` : ''}
  </div>`;
}

function renderInspectorBody() {
  const box = $('#inspectorBody');
  if (!box || !S.work) return;
  const tab = S.inspectorTab, j = S.work.spec.js;

  if (tab === 'code') {
    box.innerHTML = `<div class="setting-row">
      <span class="small num">代码大小 ${kb(bytes(j.source))} / 64 KB（ES5）</span>
      <button type="button" class="btn sm soft" data-act="saveSource">保存并运行</button>
    </div>
    <textarea id="source" class="code-ed" spellcheck="false" aria-label="应用源码">${esc(j.source)}</textarea>`;
    return;
  }

  if (tab === 'rev') {
    const byRev = new Map(S.tasks.filter(t => t.actual_rev).map(t => [t.actual_rev, t.message]));
    box.innerHTML = S.revisions.length ? S.revisions.map((r, i) => `<div class="kv-row">
      <div style="min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        <b class="num">v${r.rev}</b> · ${esc(byRev.get(r.rev) ?? (r.rev === 1 ? '初始版本' : '手动修改'))}
      </div>
      ${i === 0 ? '<span class="small">当前</span>' : `<button type="button" class="link under" data-act="restore" data-rev="${r.rev}">恢复</button>`}
    </div>`).join('') : `<p class="small">暂无更多历史版本</p>`;
    return;
  }

  const entries = Object.entries(S.store);
  const used = entries.reduce((n, [k, v]) => n + bytes(k) + bytes(v), 0);
  box.innerHTML = `<div class="setting-row">
    <span class="small num">本地记忆 ${kb(used)} / 256 KB · 请求 ${S.netLogs.length} 条</span>
    <button type="button" class="link under" data-act="restart">清空重跑</button>
  </div>
  ${entries.map(([k, v]) => `<div class="kv-row"><span class="mono">${esc(k)}</span><span class="mono small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:68%">${esc(v)}</span></div>`).join('') || '<p class="small">操作按键后，应用保存的本地数据会显示在这里。</p>'}
  ${S.netLogs.slice(0, 6).map(n => `<div class="kv-row"><span class="mono num">${esc(n.method)} ${n.status || '离线'}</span><span class="mono small" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0 8px" title="${esc(n.url)}">${esc(n.url)}</span><span class="small num">${n.ms}ms</span></div>`).join('')}`;
}

function appHtml() {
  const w = S.work, j = w.spec.js, busy = ACTIVE.includes(S.task?.state);
  const tpl = templateMeta(j.gallery);
  const isRelay = S.relay?.enabled || resolveConnMode(j, tpl) === 'relay';
  const chips = smartFollowupChips();

  return `<main class="shell">
    ${topbarHtml()}
    <div class="workspace">
      <div class="ws-left">
        <div class="app-head">
          <input class="title-input" id="title" aria-label="应用名称" value="${esc(w.spec.title)}" maxlength="100">
          <button type="button" class="btn solid" id="pushBtn" data-act="push">发布到设备</button>
        </div>

        <div id="connBar">${dataBarHtml()}</div>

        <section class="chat-box">
          <div id="timelineMount">${renderTimelineHtml()}</div>
          <div id="stream"></div>
          <form data-form="change" class="composer">
            <textarea id="prompt" rows="2" aria-label="告诉 AI 想怎么改这个应用" placeholder="${busy ? 'AI 正在制作中...' : '想怎么改？比如「把字放大」「多加一页统计」「改一下配色层次」...'}" ${busy ? 'disabled' : ''}></textarea>
            <div class="composer-foot">
              <span class="small">${S.config?.model?.status === 'CONFIGURED' ? 'Cmd/Ctrl + Enter 发送' : '请先配置 AI 模型'}</span>
              ${busy
                ? `<button type="button" class="btn sm" data-act="cancel"${S.cancelling ? ' disabled' : ''}>${S.cancelling ? '正在停止...' : '停止'}</button>`
                : '<button class="btn sm solid">发送</button>'}
            </div>
          </form>
          ${!busy ? `<div class="prompt-chips">${chips.map(c => `<button type="button" class="chip" data-act="hint" data-prompt="${esc(c.prompt)}">${esc(c.label)}</button>`).join('')}</div>` : ''}
        </section>
      </div>

      <div class="ws-right">
        <div class="bezel">
          <div class="screen-well">
            <canvas id="screen" class="eink" width="400" height="300" aria-label="设备实时预览"></canvas>
          </div>
          <div class="hw-bar">
            <button type="button" class="hw-key" data-key="up">上</button>
            <button type="button" class="hw-key" data-key="ok">确定</button>
            <button type="button" class="hw-key" data-key="down">下</button>
            ${j.wave ? '<button type="button" class="hw-key" data-key="wave">挥手</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="hw-restart" data-act="restart">重置</button>
          </div>
        </div>

        <div class="err-box" id="errBox" hidden>
          <pre id="log"></pre>
          <button type="button" class="btn sm solid" data-act="fixError">让 AI 修复</button>
        </div>

        <div class="quiet-panel">
          <details id="detSettings"${S.openDet.settings ? ' open' : ''}>
            <summary>应用设置</summary>
            <div class="quiet-body">
              <div class="setting-row">
                <span>刷新模式</span>
                <div class="seg">
                  ${[['fast', '快刷'], ['gray', '原灰阶'], ['tuned', '调优灰阶'], ['flash', '全刷'], ['clear', '16灰']].map(([v, t]) => `<button type="button" data-act="refresh" data-v="${v}" aria-pressed="${j.refresh === v}">${t}</button>`).join('')}
                </div>
              </div>
              <div class="setting-row">
                <span>隔空挥手</span>
                <div class="seg">
                  <button type="button" data-act="wave" data-v="1" aria-pressed="${!!j.wave}">开启</button>
                  <button type="button" data-act="wave" data-v="" aria-pressed="${!j.wave}">关闭</button>
                </div>
              </div>
              ${j.gallery === 'photo' ? `<div class="setting-row"><span>随机相册图片</span><button type="button" class="btn sm soft" data-act="shuffle">换一批</button></div>` : ''}
              <div class="setting-row">
                <span>电脑数据推送</span>
                <button type="button" class="btn sm soft" data-act="relayOpen">${isRelay ? '获取推送文档' : '开启推送通道'}</button>
              </div>
              <div class="setting-row">
                <span class="small num">v${w.rev} · ${kb(bytes(j.source))} KB · <span id="written"></span></span>
                <button type="button" class="del" data-act="del" data-id="${esc(w.id)}">删除应用</button>
              </div>
            </div>
          </details>

          <details id="detCode"${S.openDet.code ? ' open' : ''}>
            <summary>源码、历史与运行状态</summary>
            <div class="quiet-body">
              <div class="clip-tabs" id="inspectorTabs" role="tablist">
                <button type="button" class="clip-tab" role="tab" data-act="inspTab" data-tab="code" aria-selected="${S.inspectorTab === 'code'}">源码</button>
                <button type="button" class="clip-tab" role="tab" data-act="inspTab" data-tab="rev" aria-selected="${S.inspectorTab === 'rev'}">历史 (${S.revisions.length})</button>
                <button type="button" class="clip-tab" role="tab" data-act="inspTab" data-tab="state" aria-selected="${S.inspectorTab === 'state'}">运行状态</button>
              </div>
              <div id="inspectorBody" style="display:flex;flex-direction:column;gap:8px"></div>
            </div>
          </details>
        </div>
      </div>
    </div>
  </main>`;
}

function renderLive() {
  if (S.view !== 'app' || !S.work) return;
  const aiBusy = ACTIVE.includes(S.task?.state) && S.task.work_id === S.work.id;
  const errBox = $('#errBox'), log = $('#log');
  if (errBox && log) {
    errBox.hidden = !S.error || aiBusy;
    log.textContent = S.error;
  }
  if (S.inspectorTab !== 'code') renderInspectorBody();

  const on = recall('written')?.[S.work.id], dv = device(), pub = dv?.published?.work_id === S.work.id ? dv.published : null;
  const writtenEl = $('#written');
  if (writtenEl) {
    writtenEl.textContent = S.config.dev_mode
      ? (on === S.work.rev ? `设备已装 v${on}` : on ? `设备是 v${on}` : '未写入设备')
      : !dv?.wifi
        ? '未绑定设备'
        : !pub
          ? '未发布'
          : ['failed', 'cancelled'].includes(pub.state)
            ? `v${pub.rev} 发布失败`
            : ['running', 'completed', 'stopped', 'duplicate'].includes(pub.state)
              ? `设备运行 v${pub.rev}`
              : `v${pub.rev} 等待同步`;
  }
  const b = $('#pushBtn');
  if (b) {
    b.textContent = S.push || (aiBusy ? 'AI 制作中...' : S.config.dev_mode ? (usb.device ? '写入设备' : '连接并写入') : dv?.wifi ? '发布到设备' : '绑定并发布');
    b.disabled = !!S.push || !!S.error || aiBusy;
  }
}

function render() {
  const typed = $('#prompt')?.value;
  const at = S.view + (S.work?.id ?? '');
  const enter = render.at !== at;
  render.at = at;

  $('#root').innerHTML = S.view === 'home' ? homeHtml() : appHtml();
  if (typed && $('#prompt')) $('#prompt').value = typed;
  if (enter) $('#root').firstElementChild?.classList.add('enter');

  requestAnimationFrame(() => syncClipPills());

  if (S.view === 'home') {
    runHero(S.heroId, true).catch(() => {});
  } else {
    renderStream();
    renderInspectorBody();
    renderLive();
    paint();
  }
}

// ---- Actions & Event Delegation ----
async function guard(fn) {
  try { await fn(); } catch (e) { if (e.name !== 'NotFoundError') tell(e.message); }
}

const NAV = new Set(['tpl', 'forkHero', 'open', 'blank', 'new', 'home']);
const inflight = new Set();
let pending = 0;
document.body.insertAdjacentHTML('beforeend', '<div id="bar"></div>');

function act(key, el, fn) {
  if (inflight.has(key)) return;
  inflight.add(key);
  pending++;
  el?.classList.add('busy');
  el?.setAttribute('aria-busy', 'true');
  if (key === 'nav') document.body.classList.add('nav');
  document.documentElement.classList.add('loading');
  return guard(fn).finally(() => {
    inflight.delete(key);
    el?.classList.remove('busy');
    el?.removeAttribute('aria-busy');
    if (key === 'nav') document.body.classList.remove('nav');
    if (!--pending) document.documentElement.classList.remove('loading');
  });
}

const ACTS = {
  connect,
  disconnect: async () => { await usb.disconnect(); renderTopbar(); renderLive(); if ($('#dialog')?.open) deviceDialog(); tell('已断开 USB 连接'); },
  push,
  device: () => deviceDialog(),
  modelCfg: () => modelDialog(false),
  logout: async () => { await api('/auth/logout', 'POST', {}); location.href = '/'; },
  close: () => $('#dialog').close(),

  hint: b => {
    const p = $('#prompt');
    if (!p) return;
    p.value = b.dataset.prompt || b.textContent;
    p.focus();
  },

  modelPreset: b => {
    const p = MODEL_PRESETS[Number(b.dataset.idx)];
    if (!p) return;
    $('#mBaseUrl').value = p.url;
    $('#mModel').value = p.model;
    $('#mApiKey')?.focus();
  },

  tryTpl: async b => {
    await runHero(b.dataset.id, false);
    const heroEl = $('.hero-sim');
    if (heroEl && heroEl.getBoundingClientRect().top < -40) {
      heroEl.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    }
  },
  heroRestart: () => runHero(S.heroId, false),
  forkHero: async () => {
    const id = S.heroId;
    const photos = id === 'photo' ? await randomPhotos() : undefined;
    const w = await api('/works', 'POST', {template: id, photos});
    await openWork(w.id, w);
    loadWorks().catch(() => {});
  },

  catFilter: b => {
    S.catFilter = b.dataset.cat;
    $$('#catTabs .clip-tab').forEach(t => t.setAttribute('aria-selected', String(t === b)));
    syncClipPills($('#catTabs')?.parentElement || document);
    const mount = $('#galleryMount');
    if (mount) mount.innerHTML = renderGalleryCards();
  },
  resetFilter: () => {
    S.catFilter = '全部';
    S.search = '';
    render();
  },

  blank: () => create(''),
  tpl: async b => {
    const photos = b.dataset.id === 'photo' ? await randomPhotos() : undefined;
    const w = await api('/works', 'POST', {template: b.dataset.id, photos});
    await openWork(w.id, w);
    loadWorks().catch(() => {});
  },

  // Push Doc & Relay actions
  relayOpen: () => openRelayDialog(),
  copyAiDoc: () => S.relay?.ai_doc && copyText(S.relay.ai_doc, '推送文档已复制，直接发给你的 AI 即可'),
  relayRefresh: async () => {
    await loadRelay();
    renderDataBar();
    renderRelayModalBody();
    tell('已刷新');
  },
  relayClearOutbox: async () => {
    S.relay = await api(`/works/${S.work.id}/relay/clear`, 'POST', {target: 'outbox'});
    renderDataBar();
    renderRelayModalBody();
    tell('已清空回传记录');
  },
  relayRotate: async b => {
    if (b.dataset.armed !== '1') {
      b.dataset.armed = '1';
      b.textContent = '确认重置？';
      b.classList.add('armed');
      setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = '重置链接'; b.classList.remove('armed'); } }, 3200);
      return;
    }
    await ensureRelay(true);
    render();
    await run(true);
    openRelayDialog();
    tell('已重置推送链接，重新发布后生效');
  },
  agentWireRelay: async () => {
    $('#dialog').close();
    await ask('帮我把这个应用接入数据推送通道 RELAY：在源码首行写上 // RELAY_JSON: {...} 字段示例，启动和挥手时通过 GET RELAY 拉取最新内容展示，按确定键时通过 POST RELAY+"/outbox"（设 keep:true）回传确认');
  },

  // Secret / URL actions
  secret: () => secretDialog(),
  toggleSecretVis: b => {
    const inp = $('#secretVal');
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    b.textContent = inp.type === 'password' ? '显示' : '隐藏';
  },
  secretSave: async () => {
    const v = $('#secretVal').value.trim();
    await save(s => { if (v) s.js.secret = v; else delete s.js.secret; });
    $('#dialog').close();
    render();
    await run(true);
    tell(v ? '已保存，发布后在设备上生效' : '已清除');
  },

  copy: b => copyText(b.dataset.text, '已复制到剪贴板'),
  shuffle: async () => {
    const p = await randomPhotos();
    await save(s => { s.js.photos = p; });
    render();
    await run(true);
    tell('已换一批随机黑白画作');
  },

  new: async () => {
    stopFollow();
    S.view = 'home';
    S.work = null;
    S.relay = null;
    S.pendingMsg = '';
    location.hash = '';
    render();
    await loadWorks();
    if (S.view === 'home') render();
  },
  home: async () => ACTS.new(),
  open: b => openWork(b.dataset.id),

  del: async b => {
    if (b.dataset.armed !== '1') {
      const label = b.textContent;
      b.dataset.armed = '1';
      b.dataset.at = Date.now();
      b.textContent = '确认删除？';
      b.classList.add('armed');
      setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = label; b.classList.remove('armed'); } }, 3000);
      return;
    }
    if (Date.now() - b.dataset.at < 350) return;
    await api('/works/' + b.dataset.id, 'DELETE');
    S.works = S.works?.filter(w => w.id !== b.dataset.id);
    if (S.view === 'app') { await ACTS.new(); tell('已删除'); return; }
    b.closest('.work-card')?.classList.add('gone');
    setTimeout(render, 180);
    tell('已删除');
  },

  toggleSteps: () => { S.openSteps = !S.openSteps; renderStream(); },
  cancel: async () => {
    if (!S.task) return;
    S.cancelling = true;
    renderStream();
    const res = await api(`/ai/tasks/${S.task.id}/cancel`, 'POST', {});
    S.task = res;
    if (!ACTIVE.includes(res.state)) {
      stopFollow();
      S.cancelling = false;
      await finish(res);
    } else {
      renderStream();
    }
  },
  resume: async () => { follow(await api(`/ai/tasks/${S.task.id}/resume`, 'POST', {})); render(); },
  resumeTask: async b => {
    const id = b?.dataset?.id || S.task?.id;
    if (!id) return;
    follow(await api(`/ai/tasks/${encodeURIComponent(id)}/resume`, 'POST', {}));
    render();
  },
  resetContext: async b => {
    if (!S.work) return;
    if (b && b.dataset.armed !== '1') {
      b.dataset.armed = '1';
      b.textContent = '确认清空记忆？';
      setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = '新开对话'; } }, 3200);
      return;
    }
    await api(`/works/${S.work.id}/context/reset`, 'POST', {});
    if (S.task && !ACTIVE.includes(S.task.state)) S.task = null;
    renderStream();
    tell('已清空旧对话记忆，当前应用代码与历史版本均完整保留');
  },
  fixError: async () => {
    if (!S.error) return;
    await ask(`请修复当前应用在预览引擎中的报错或越界问题：${S.error}`);
  },

  restart: () => { run(false); tell('已重置并从头运行'); },
  refresh: async b => {
    const mode = b.dataset.v;
    await save(s => { s.js.refresh = mode; });
    render();
    await run(true);
    if (['flash', 'clear'].includes(mode)) {
      const cv = $('#screen');
      cv?.classList.remove('ink-flash');
      void cv?.offsetWidth;
      cv?.classList.add('ink-flash');
    }
  },
  wave: async b => {
    await save(s => { s.js.wave = !!b.dataset.v; });
    render();
    paint();
  },
  inspTab: b => {
    S.inspectorTab = b.dataset.tab;
    $$('#inspectorTabs .clip-tab').forEach(t => t.setAttribute('aria-selected', String(t === b)));
    syncClipPills($('#inspectorTabs')?.parentElement || document);
    renderInspectorBody();
  },
  restore: async b => {
    await api(`/works/${S.work.id}/restore`, 'POST', {rev: Number(b.dataset.rev), base_rev: S.work.rev});
    await reload(false);
    tell(`已恢复到 v${b.dataset.rev}`);
  },
  saveSource: async () => {
    const src = $('#source')?.value ?? '';
    await save(s => { s.js.source = src; });
    render();
    await run(false);
    paint();
    tell('代码已保存并重新运行');
  },
  flash: () => showFlasher({usb, api, dialog, tell}),
  demo: async () => (await import('./demo.js?v=23')).startDemo(),
};

document.addEventListener('click', e => {
  const key = e.target.closest('[data-key]');
  if (key) return press(key.dataset.key);
  const b = e.target.closest('[data-act]');
  if (b && ACTS[b.dataset.act]) {
    act(NAV.has(b.dataset.act) ? 'nav' : b.dataset.act, b, () => ACTS[b.dataset.act](b));
  }
});

document.addEventListener('toggle', e => {
  if (e.target.id === 'detSettings') S.openDet.settings = e.target.open;
  if (e.target.id === 'detCode') {
    S.openDet.code = e.target.open;
    if (e.target.open) requestAnimationFrame(() => syncClipPills(e.target));
  }
}, true);

document.addEventListener('input', e => {
  if (e.target.id === 'tplSearch') {
    S.search = e.target.value;
    const mount = $('#galleryMount');
    if (mount) mount.innerHTML = renderGalleryCards();
  }
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target.dataset.form;
  if (f === 'device') return act('setup', e.submitter, setupDevice);

  if (f === 'modelConfig') {
    return act('modelSave', e.submitter, async () => {
      const msg = $('#modelProbeMsg');
      if (msg) msg.textContent = '正在测试连通性...';
      const base_url = $('#mBaseUrl').value.trim();
      const model = $('#mModel').value.trim();
      const api_key = $('#mApiKey').value.trim();
      await api('/admin/model-runtime', 'POST', {base_url, model, api_key, probe: true});
      S.config = await api('/config');
      $('#dialog').close();
      render();
      tell('模型已连通并保存');
      const pendingPrompt = recall('pendingPrompt');
      if (pendingPrompt) {
        remember('pendingPrompt', null);
        await create(pendingPrompt);
      }
    });
  }

  if (f === 'relayQuickSend') {
    return act('relayPush', e.submitter, async () => {
      const raw = ($('#quickPushText')?.value ?? '').trim();
      let payload;
      if (!raw) {
        payload = structuredClone(S.relay?.sample_payload || {from: '测试推送', title: '测试消息', note: '已收到测试数据', text: '测试推送成功'});
      } else if (raw.startsWith('{')) {
        try { payload = JSON.parse(raw); } catch { throw Error('JSON 格式有误，请检查引号和括号'); }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('请输入有效的 JSON 对象');
      } else {
        payload = structuredClone(S.relay?.sample_payload || {});
        payload.text = raw;
        if (payload.note !== undefined || payload.title === undefined) payload.note = raw;
        if (payload.title !== undefined) payload.title = raw.slice(0, 32);
        if (payload.task !== undefined) payload.task = raw.slice(0, 32);
        if (payload.from === undefined) payload.from = '网页测试';
      }
      S.relay = await api(`/works/${S.work.id}/relay/push`, 'POST', payload);
      renderDataBar();
      renderRelayModalBody();
      await run(true);
      tell('测试数据已推送，预览屏已更新');
    });
  }

  const text = $('#prompt')?.value.trim();
  if (!text) return;
  $('#prompt').value = '';
  act(f === 'new' ? 'nav' : 'ask', e.submitter, () => f === 'new' ? create(text) : ask(text));
});

document.addEventListener('change', e => {
  if (e.target.id !== 'title' || !e.target.value.trim()) return;
  guard(() => save(s => { s.title = e.target.value.trim(); }));
});

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && e.target.id === 'prompt') {
    e.preventDefault();
    e.target.form?.requestSubmit();
    return;
  }
  if ($('#dialog')?.open || e.target.matches('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = {ArrowUp: 'up', ArrowDown: 'down', Enter: 'ok', w: 'wave', W: 'wave'}[e.key];
  if (k && !e.target.closest('button')) {
    e.preventDefault();
    press(k);
  }
});

window.addEventListener('resize', () => syncClipPills());

// ---- Login Page ----
const INK_TILES = [[96,120,250,232,44,'#2B2A26','天气','2.3 KB','#EFEAE0',30],[354,120,190,132,38,'#4A463E','云端桌贴','4.8 KB','#EFEAE0',20],[354,260,110,92,28,'#8A8478','背单词','3.1 KB','#EFEAE0',15],[472,260,72,92,24,'#BDB6A7','木鱼','','#2B2A26',14],[96,360,148,160,36,'#6B665C','番茄钟','4.5 KB','#EFEAE0',20],[252,360,168,160,40,'#A39C8E','AI 盯盘','4.7 KB','#2B2A26',19],[428,360,116,160,30,'#D3CCBC','周易','4.5 KB','#2B2A26',16]];
function inkArt() {
  const ring = i => { const pts = []; for (let k = 0; k < 96; k++) { const a = k / 96 * Math.PI * 2, r = (258 + i * 27) * (1 + 0.07 * Math.sin(3 * a + i * 0.35) + 0.04 * Math.cos(5 * a - 1.1)); pts.push(`${(320 + r * Math.cos(a)).toFixed(1)} ${(320 + r * Math.sin(a) * 0.94).toFixed(1)}`); } return `<path d="M${pts.join('L')}Z" style="--i:${i}"/>`; };
  const tiles = INK_TILES.map(([x, y, w, h, r, fill], i) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" style="--i:${i}"/>`).join('');
  const words = INK_TILES.map(([x, y, , , , , name, size, ink, font], i) => `<g fill="${ink}" style="--i:${i}"><text x="${x + 22}" y="${y + 24 + font}" font-size="${font}" font-weight="300">${name}</text>${size ? `<text x="${x + 22}" y="${y + 46 + font}" font-size="12" opacity=".7">${size}</text>` : ''}</g>`).join('');
  return `<svg viewBox="0 0 640 640" role="img" aria-label="墨水屏桌面小应用"><defs><filter id="wob" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".011" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="15"/></filter></defs><g class="lg-rings">${Array.from({length: 13}, (_, i) => ring(i)).join('')}</g><g class="lg-tiles" filter="url(#wob)">${tiles}</g><g class="lg-words">${words}</g></svg>`;
}
function loginPage() {
  const q = new URLSearchParams(location.search).get('login_error');
  $('#root').innerHTML = `<main class="lg"><section class="lg-copy"><strong class="brand-btn"><span class="brand-mark">N4</span>NOTE4 创作台</strong><div class="lg-mid"><div class="lg-num num"><b>64</b><i>KB</i><span>装下一整块桌面墨水屏</span></div><h1>说一句话，给墨水屏做个小应用。</h1><p>番茄钟、天气看板、电脑定时同步桌贴。网页里先试玩，发布后断网也能常显。</p>${q ? `<p class="err">${esc(q)}</p>` : ''}<div class="lg-go"><a class="btn solid" href="/api/auth/sso">微信登录</a><button class="btn" data-act="demo">1 分钟演示</button></div></div></section><figure class="lg-art">${inkArt()}</figure></main>`;
}

let lastFocusSync = 0;
window.addEventListener('focus', () => {
  if (!S.user || S.config?.dev_mode) return;
  if (Date.now() - lastFocusSync < 30000) return;
  lastFocusSync = Date.now();
  loadDevices().then(renderTopbar).catch(() => {});
});

async function boot() {
  S.config = await api('/config');
  S.user = (await api('/auth/me')).user;
  await loadWorks();
  await loadDevices().catch(() => {});
  const active = (await api('/ai/tasks')).tasks.find(t => ACTIVE.includes(t.state));
  const id = active?.work_id ?? location.hash.slice(1);
  if (id && S.works.some(w => w.id === id && w.spec.kind === 'js')) await openWork(id);
  else render();
  if (active) follow(active);
}

boot().catch(e => {
  if (e.status === 401) return loginPage();
  $('#root').innerHTML = `<main class="shell"><div class="notice-bar warn"><span class="small">暂时无法打开创作台：${esc(e.message)}，请检查本地服务是否已启动。</span></div></main>`;
});
