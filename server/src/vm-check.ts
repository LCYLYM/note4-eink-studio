import wasm from '../../wasm/note4_vm.wasm';
import {Note4Vm} from '../../web/vm.js';
import {fontData} from './font';
import {existsSync, readFileSync} from 'node:fs';

// wasm takes about 8 ms on the benchmark the device runs in 292 ms.
export const DEVICE_SLOWDOWN = 36;
const DEVICE_LIMIT_MS = 1000, TICK_LIMIT = 300;
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

const fail = (where: string, log: string) => {
  throw Error(`JS ${where} failed on the device engine: ${log.trim().slice(0, 600)}`);
};

export type MockNetMap = Record<string, {status?: number; body?: unknown}>;

// The WASM VM holds global state (framebuffer, store, netQueue); concurrent
// checks would interleave and corrupt each other's results, so serialize them.
let queue: Promise<unknown> = Promise.resolve();
export function checkJs(spec: any, mockNet?: MockNetMap) {
  const run = queue.then(() => runCheck(spec, mockNet));
  queue = run.catch(() => {});
  return run;
}

async function runCheck(spec: any, mockNet?: MockNetMap) {
  const v = await load();
  const keys = ['ok', 'up', 'down', 'ok', 'down', 'up', ...(spec.js.wave ? ['wave'] : [])];
  const frames = spec.js.asset ? 64 : (spec.js.photos?.length ?? 0);
  let slowest = 0;
  const timed = (fn: () => number, where: string, retryOnJitter = false) => {
    v.clearLog();
    const t = performance.now(), r = fn();
    let ms = (performance.now() - t) * DEVICE_SLOWDOWN;
    if (r !== 0) fail(where, v.log());
    if (ms > DEVICE_LIMIT_MS && retryOnJitter && ms < 60000) {
      // Single idempotent retry filters out transient Node GC / OS scheduler hiccups.
      v.clearLog();
      const t2 = performance.now(), r2 = fn();
      const ms2 = (performance.now() - t2) * DEVICE_SLOWDOWN;
      if (r2 !== 0) fail(where, v.log());
      ms = Math.min(ms, ms2);
    }
    slowest = Math.max(slowest, ms);
    if (ms > DEVICE_LIMIT_MS) {
      throw Error(`${where} would take about ${Math.round(ms)} ms on the device; handlers must stay under ${DEVICE_LIMIT_MS} ms`);
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
  timed(() => v.start(spec.js.source, {}, mode, frames), 'on_start', true);
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
    timed(() => v.net(q.key, 0, ''), `on_net('${q.key}',0)`);
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
    timed(() => v.start(mockPreamble + spec.js.source, {}, mode, frames), 'on_start(mock_net)', true);
    v.dirty();
    const queued = v.netQueue.splice(0);
    for (const q of queued) {
      const entry = mockNet[q.key] ?? mockNet['*'];
      if (!entry) continue;
      const status = Number.isInteger(entry.status) ? Number(entry.status) : 200;
      const bodyStr = typeof entry.body === 'string' ? entry.body : JSON.stringify(entry.body ?? {});
      timed(() => v.net(q.key, status, bodyStr.slice(0, 65536)), `on_net('${q.key}',${status})`);
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
