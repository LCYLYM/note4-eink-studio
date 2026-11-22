import wasm from '../../wasm/note4_vm.wasm';
import {Note4Vm} from '../../web/vm.js';
import {fontData} from './font';
import {ensureVoiceComponentSource, buildFontPreamble} from './compiler';
import {existsSync, readFileSync} from 'node:fs';

// wasm takes about 8 ms on the benchmark the device runs in 292 ms.
export const DEVICE_SLOWDOWN = 36;
const DEVICE_LIMIT_MS = 1000, NET_LIMIT_MS = 3000, TICK_LIMIT = 300;
const WORKER_WALL_TIMEOUT_MS = 4500, MAX_PENDING_CHECKS = 8;
let vm: Promise<Note4Vm> | undefined;
function loadAaFont(): Uint8Array | undefined {
  for (const rel of ['../firmware/main/js_fonts_aa.bin', '../web/vendor/fonts_aa.bin', 'firmware/main/js_fonts_aa.bin', 'web/vendor/fonts_aa.bin']) {
    if (existsSync(rel)) return new Uint8Array(readFileSync(rel));
  }
  return undefined;
}
const load = () =>
  (vm ??= Note4Vm.create(wasm as any, Uint8Array.from(atob(fontData), c => c.charCodeAt(0)), TICK_LIMIT, loadAaFont()).then(v => {
    // Warm up V8 WASM tier-up once so the first user on_start check does not pay cold-JIT latency.
    v.start('function on_start(){ui.clear(15);ui.glass(16,16,80,40,8,14,2);ui.font("sans");ui.text(24,24,"OK",1,0);ui.present();}', {}, 'clear', 0);
    return v;
  }));

// Coarse layout sketch so the agent can notice blank or misplaced screens.
function sketch(px: Uint8Array) {
  const rows: string[] = [];
  for (let y = 0; y < 300; y += 16) {
    let row = '';
    for (let x = 0; x < 400; x += 8) {
      let dark = 0;
      for (let a = y; a < y + 16 && a < 300; a++)
        for (let b = x; b < x + 8; b++) if (px[a * 400 + b] < 8) dark++;
      row += dark > 24 ? '#' : dark > 0 ? '.' : ' ';
    }
    rows.push(row.trimEnd());
  }
  return rows.join('\n');
}

const fail = (where: string, log: string, srcForCtx?: string) => {
  let msg = `JS ${where} failed on the device engine: ${log.trim().slice(0, 500)}`;
  const m = srcForCtx ? log.match(/app\.js:(\d+)(?::(\d+))?/) : null;
  if (m && srcForCtx) {
    const ln = Number(m[1]), lines = srcForCtx.split('\n');
    const lo = Math.max(1, ln - 1), hi = Math.min(lines.length, ln + 1);
    const snip = [];
    for (let i = lo; i <= hi; i++) snip.push(`${i === ln ? '>' : ' '}${i}: ${(lines[i - 1] ?? '').slice(0, 180)}`);
    msg += `\nOffending source lines:\n${snip.join('\n')}`;
    if (/unexpected character/i.test(log) && /[^\x00-\x7f]/.test(lines[ln - 1] ?? '')) {
      msg += `\nHint: MicroQuickJS (strict ES5) identifiers and unquoted object keys MUST be ASCII (a-zA-Z0-9_$); quote Chinese keys like {'主题': val} or use ASCII keys like {topic: val}!`;
    }
  }
  throw Error(msg);
};

export type MockNetMap = Record<string, {status?: number; body?: unknown}>;

// Preemptive Worker isolation (A1): prevents infinite or heavy drawing loops inside WASM
// from blocking the main HTTP/SSE event loop, terminating hung checks after 4.5s wall time.
let queue: Promise<unknown> = Promise.resolve();
let pendingChecks = 0;
let checkWorker: any = null;
let checkSeq = 0;
let workerEnvPromise: Promise<{Worker: any; workerPath: string} | null> | undefined;

function getWorkerEnv() {
  return (workerEnvPromise ??= (async () => {
    try {
      const wt = await import('node:worker_threads');
      if (!wt.isMainThread) return null;
      const {fileURLToPath} = await import('node:url');
      const p = fileURLToPath(new URL('./vm-check-worker.mjs', import.meta.url));
      return existsSync(p) ? {Worker: wt.Worker, workerPath: p} : null;
    } catch {
      return null;
    }
  })());
}

function runInWorker(WorkerCtor: any, workerPath: string, spec: any, mockNet?: MockNetMap): Promise<any> {
  return new Promise((resolve, reject) => {
    let w = checkWorker;
    if (!w) {
      const created = new WorkerCtor(workerPath, {resourceLimits: {maxOldGenerationSizeMb: 96}});
      created.on('error', () => { if (checkWorker === created) checkWorker = null; });
      created.on('exit', () => { if (checkWorker === created) checkWorker = null; });
      created.unref();
      checkWorker = created;
      w = created;
    }
    const id = ++checkSeq;
    let settled = false;
    w.ref();
    const cleanup = () => {
      clearTimeout(timer);
      w?.off('message', onMsg);
      w?.off('error', onErr);
      w?.off('exit', onExit);
      if (checkWorker === w && pendingChecks <= 1) w.unref();
    };
    const killWorker = () => {
      if (checkWorker === w) checkWorker = null;
      try { w?.terminate(); } catch {}
    };
    const onMsg = (m: any) => {
      if (!m || m.id !== id || settled) return;
      settled = true;
      cleanup();
      if (m.ok) resolve(m.value);
      else reject(Error(m.error || 'JS check failed'));
    };
    const onErr = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      killWorker();
      reject(err);
    };
    const onExit = (code: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (checkWorker === w) checkWorker = null;
      reject(Error(`JS check worker exited unexpectedly (code ${code})`));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      killWorker();
      reject(Error(`JS check timed out after ${WORKER_WALL_TIMEOUT_MS}ms on server: infinite loop or excessive drawing in handler`));
    }, WORKER_WALL_TIMEOUT_MS);

    w.on('message', onMsg);
    w.on('error', onErr);
    w.on('exit', onExit);
    try {
      w.postMessage({id, spec, mockNet});
    } catch (e) {
      settled = true;
      cleanup();
      reject(e);
    }
  });
}

export function checkJs(spec: any, mockNet?: MockNetMap): Promise<any> {
  if (pendingChecks >= MAX_PENDING_CHECKS) {
    return Promise.reject(Object.assign(Error('真机校验队列繁忙，请稍后重试'), {status: 429, code: 'CHECK_BUSY'}));
  }
  pendingChecks++;
  const run = queue.then(async () => {
    const env = await getWorkerEnv();
    return env ? runInWorker(env.Worker, env.workerPath, spec, mockNet) : runCheckDirect(spec, mockNet);
  });
  queue = run.catch(() => {});
  return run.finally(() => { pendingChecks = Math.max(0, pendingChecks - 1); });
}

export async function runCheckDirect(spec: any, mockNet?: MockNetMap) {
  const v = await load();
  const keys = ['ok', 'up', 'down', 'ok', 'down', 'up', ...(spec.js.wave ? ['wave'] : [])];
  const frames = spec.js.asset ? 64 : (spec.js.photos?.length ?? 0);
  let slowest = 0;
  const jsSrc = buildFontPreamble(spec.js.font) + ensureVoiceComponentSource(spec.js.source);
  const timed = (fn: () => number, where: string, retryOnJitter = true, limitMs = DEVICE_LIMIT_MS, ctxSrc = jsSrc) => {
    v.clearLog();
    const t = performance.now(), r = fn();
    let ms = (performance.now() - t) * DEVICE_SLOWDOWN;
    if (r !== 0) fail(where, v.log(), ctxSrc);
    if (ms > limitMs && retryOnJitter && ms < 60000) {
      // Single idempotent retry filters out transient Node GC / OS scheduler hiccups.
      v.clearLog();
      const t2 = performance.now(), r2 = fn();
      const ms2 = (performance.now() - t2) * DEVICE_SLOWDOWN;
      if (r2 !== 0) fail(where, v.log(), ctxSrc);
      ms = Math.min(ms, ms2);
    }
    slowest = Math.max(slowest, ms);
    if (ms > limitMs) {
      throw Error(`${where} would take about ${Math.round(ms)} ms on the device; handlers must stay under ${limitMs} ms`);
    }
  };

  const formatIssues = (m: ReturnType<Note4Vm['layout']>, label?: string) => {
    if (!m || m.maxX < 0 || !m.issues?.length) return [] as string[];
    const pfx = label ? `[${label}] ` : '';
    const seen = new Set<string>();
    const out: string[] = [];
    for (const it of m.issues) {
      let msg = '';
      const sideNames = ['', '左', '右', '上', '下'];
      const sideTips = ['', '请增大文字 x 或左移容器', '请缩短文案/用 ui.measure() 或加宽容器', '请下移文字 y 或上移容器', '请上移文字 y 或增高卡片 h'];
      switch (it.code) {
        case 1: { const s = it.detail >> 12, px = it.detail & 0xfff; msg = `${pfx}文字超出/骑跨卡片${sideNames[s] ?? ''}边框 ${px}px（位置 x=${it.x}, y=${it.y}），${sideTips[s] || '请调整坐标或尺寸'}`; break; }
        case 2: { const s = it.detail >> 12, px = it.detail & 0xfff; msg = `${pfx}文字离卡片${sideNames[s] ?? ''}边框偏近（仅余 ${px}px，位置 x=${it.x}, y=${it.y}），建议留足内边距`; break; }
        case 3: msg = `${pfx}白条/色块/图形(x=${it.x}, y=${it.y})在文字(y=${it.detail})之后绘制并直接遮挡文字！背景框与按钮底条必须先画在文字下面`; break;
        case 4: msg = `${pfx}按钮/浮层框(x=${it.x}, y=${it.y})边缘裁切到旁边文字(y=${it.detail})，请拉开间距或明确遮盖层级`; break;
        case 5: msg = `${pfx}两处文字互相重叠（位置 x=${it.x}, y=${it.y}，重叠宽 ${it.detail}px），请调整坐标与行距`; break;
        case 6: msg = `${pfx}文字(x=${it.x}, y=${it.y})压在分割线/进度条(y=${it.detail})上，请分开垂直位置`; break;
        case 7: msg = `${pfx}文字与背景/白条对比度不足（${it.detail}% 笔画融进底色，位置 x=${it.x}, y=${it.y}），浅底配深字(0..4)、深底配白字(14..15)`; break;
        case 8: msg = `${pfx}文字靠近屏幕物理边框（最小边距 ${it.detail}px，区域 x:${m.minX}..${m.maxX}, y:${m.minY}..${m.maxY}），建议外边距 >= 14px 防外壳遮挡`; break;
      }
      if (msg && !seen.has(msg)) { seen.add(msg); out.push(msg); }
    }
    return out;
  };
  const layoutErrors: string[] = [];
  const layoutHints: string[] = [];
  const mergeLayout = (label?: string) => {
    const m = v.layout?.() ?? null;
    if (!m || m.maxX < 0 || !m.issues?.length) return;
    const pfx = label ? `[${label}] ` : '';
    for (const it of m.issues) {
      const severe = [1, 3, 4, 5, 6, 7].includes(it.code);
      const msgs = formatIssues({...m, issues: [it]}, label);
      const msg = msgs[0];
      if (!msg) continue;
      const target = severe ? layoutErrors : layoutHints;
      if (target.length < 8 && !target.includes(msg)) target.push(msg);
    }
  };

  // 1. Offline + interactive check
  const mode = spec.js.refresh ?? 'fast';
  timed(() => v.start(jsSrc, {}, mode, frames), 'on_start', true);
  if (!v.dirty()) throw Error('on_start must draw the first screen and call ui.present()');
  mergeLayout('on_start');
  const first = sketch(v.pixels(false));
  if (!/[#.]/.test(first)) throw Error('The first screen is blank');
  const responses: string[] = [];
  for (const k of keys) {
    timed(() => v.key(k), `on_key('${k}')`);
    const redrew = v.dirty();
    responses.push(`${k}:${redrew ? 'redraw' : 'no redraw'}`);
    if (redrew) mergeLayout(`key:${k}`);
  }
  if (!responses.some(r => r.endsWith(':redraw'))) {
    throw Error('No key changes the screen; every app must respond to the three keys');
  }
  let dropped = 0;
  for (const q of v.netQueue.splice(0)) {
    timed(() => v.net(q.key, 0, ''), `on_net('${q.key}',0)`, true, NET_LIMIT_MS);
    dropped++;
  }
  const off = v.oob();
  if (off.count) {
    throw Error(
      `The app draws outside the 400x300 screen (for example near x=${off.x}, y=${off.y}, ${off.count} off-screen pixels). Recompute the layout: glyph height is 16*scale, line step 22*scale, and every element must fit inside x 0..399 and y 0..299.`
    );
  }
  const store = v.store();
  const lastSketch = sketch(v.pixels(false));

  // 2. Optional sandboxed mock_net verification (zero real network!)
  let mockTested = 0;
  let mockSketch: string | undefined;
  if (mockNet && typeof mockNet === 'object' && Object.keys(mockNet).length > 0) {
    const mockPreamble =
      'var N4_RELAY="https://sandbox.note4.invalid/api/relay/mock";\n' +
      (spec.js.conn_mode === 'apikey'
        ? 'var SECRET="sandbox-mock-key";\n'
        : 'var SECRET="https://sandbox.note4.invalid/api/relay/mock";\n');
    timed(() => v.start(mockPreamble + jsSrc, {}, mode, frames), 'on_start(mock_net)', true, DEVICE_LIMIT_MS, mockPreamble + jsSrc);
    v.dirty();
    const queued = v.netQueue.splice(0);
    for (const q of queued) {
      const entry = mockNet[q.key] ?? mockNet['*'];
      if (!entry) continue;
      const status = Number.isInteger(entry.status) ? Number(entry.status) : 200;
      const bodyStr = typeof entry.body === 'string' ? entry.body : JSON.stringify(entry.body ?? {});
      timed(() => v.net(q.key, status, bodyStr.slice(0, 65536)), `on_net('${q.key}',${status})`, true, NET_LIMIT_MS);
      mockTested++;
    }
    const mockOff = v.oob();
    if (mockOff.count) {
      throw Error(
        `With mock_net data, the app draws outside 400x300 (near x=${mockOff.x}, y=${mockOff.y}, ${mockOff.count} off-screen pixels). Clip or wrap dynamic text cleanly.`
      );
    }
    if (mockTested > 0) {
      mockSketch = sketch(v.pixels(false));
      mergeLayout('mock_net');
    }
  }

  // 3. Declarative Voice Agent (agent.config) tool-probe & Finish Gate verification
  let agentToolsProbed = 0;
  let agentRole = '';
  timed(() => v.start(jsSrc, {}, mode, frames), 'on_start(agent_probe)', true);
  v.dirty();
  const agInfo = (v as any).agent?.() ?? {configured: false, toolCount: 0, role: '', tools: []};
  if (spec.js.voice && spec.js.voice.mode && spec.js.voice.mode !== 'off' && !agInfo.configured) {
    throw Error(
      'js.voice 已开启语音模式，但源码未在 on_start() 中调用 agent.config({ role, state, tools, on_event }) 注册端侧语音智能体！'
    );
  }
  if (agInfo.configured) {
    agentRole = agInfo.role;
    timed(() => ((v as any).agentState().ok ? 0 : -1), 'agent.state()');
    timed(() => (v as any).agentEmit('listening', '请说话…'), 'agent.on_event(listening)');
    if (v.dirty()) mergeLayout('agent:listening');
    for (let i = 0; i < agInfo.toolCount; i++) {
      const tname = agInfo.tools[i]?.function?.name ?? `tool_${i}`;
      timed(() => ((v as any).agentProbe(i).ok ? 0 : -1), `agent.tool('${tname}')`);
      agentToolsProbed++;
      if (v.dirty()) mergeLayout(`agent:${tname}`);
      const aOff = v.oob();
      if (aOff.count) {
        throw Error(
          `Voice tool '${tname}' drew outside 400x300 (near x=${aOff.x}, y=${aOff.y}, ${aOff.count} off-screen pixels). Clip dynamic text and fit inside 0..399 x 0..299.`
        );
      }
    }
    timed(() => (v as any).agentEmit('done', '已为你更新看板。'), 'agent.on_event(done)');
    if (v.dirty()) mergeLayout('agent:done');
  }

  const srcStr = String(spec.js.source ?? '');
  if (layoutErrors.length > 0 && /ui\.font\(['"](?:sans|serif|display|display_lg)['"]\)[\s\S]{0,160}ui\.text\([^;\n]+,\s*[234]\s*,/.test(srcStr)) {
    layoutErrors.push('排查提示：检测到在 AA 抗锯齿字体（sans/serif/display/display_lg）下给 ui.text 传了 scale>=2！AA 字体自带 20/24/36/48px 原生高度，传 scale=2/3 会变成 72–144px 巨字直接重叠并穿出卡片；请把所有 AA 字体的 ui.text(..., scale, ...) 全部改为 scale=1（要更大字直接切 display 或 display_lg，不要改 scale）！');
  } else if (layoutErrors.length > 0 && /ui\.font\(['"](?:display_lg|display|serif)['"]\)/.test(srcStr)) {
    layoutErrors.push('排查提示：ui.font() 是持久状态，画完 display_lg(48px)/display(36px)/serif(24px) 大字或标题后，务必立刻调用 ui.font(\'sans\') 切回 20px 正文，避免后续文字以超大字号重叠或溢出边框。');
  }

  return {
    engine: 'device-mquickjs-wasm',
    slowest_handler_ms_estimate: Math.round(slowest),
    keys: responses,
    net_requests_tested_offline: dropped,
    mock_net_tested: mockTested,
    ...(agInfo.configured ? {agent_configured: true, agent_role: agentRole, agent_tools_probed: agentToolsProbed} : {}),
    oob_pixels: 0,
    finish_gate_passed: layoutErrors.length === 0,
    ...(layoutErrors.length ? {layout_errors: layoutErrors} : {}),
    ...(layoutHints.length ? {layout_hints: layoutHints} : {}),
    store_keys: Object.keys(store).length,
    store_bytes: Object.values(store).reduce((n, s) => n + new TextEncoder().encode(s).length, 0),
    first_screen_sketch: first,
    last_screen_sketch: lastSketch,
    ...(mockSketch ? {mock_screen_sketch: mockSketch} : {}),
    hardware: 'UNVERIFIED',
  };
}
