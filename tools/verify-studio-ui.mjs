import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
// Real-browser check of the studio UI (dev mode server required):
//   PORT=8811 npm --prefix server run studio   then   node tools/verify-studio-ui.mjs http://127.0.0.1:8811/
// Needs Node 24+ and a local Chrome/Chromium (override with CHROME_PATH). Creates one work and deletes it again.
const base = process.argv[2] || process.env.NOTE4_BASE_URL || 'http://127.0.0.1:8787/';
const chromeBin = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles'] || ''}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)'] || ''}\\Google\\Chrome\\Application\\chrome.exe`,
].find(p => p && existsSync(p));
if (!chromeBin) { console.error('No Chrome/Chromium found. Set CHROME_PATH to your browser binary.'); process.exit(1); }
const profile = mkdtempSync(path.join(tmpdir(), 'n4chrome-'));
const chrome = spawn(chromeBin, ['--headless=new', '--remote-debugging-port=9377', '--user-data-dir=' + profile, '--no-first-run', '--window-size=1440,1000', 'about:blank'], {stdio: 'ignore'});
chrome.on('error', e => { console.error('Cannot launch ' + chromeBin + ': ' + e.message); process.exit(1); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch('http://127.0.0.1:9377/json')).json()).find(t => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let seq = 0; const waits = new Map(); const errors = [];
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && waits.has(d.id)) { waits.get(d.id)(d); waits.delete(d.id); } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console.error: ' + d.params.args.map(a => a.value ?? a.description).join(' ')); };
const send = (method, params = {}) => new Promise(r => { const id = ++seq; waits.set(id, r); ws.send(JSON.stringify({id, method, params})); });
const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); if (r.result.exceptionDetails) throw Error(r.result.exceptionDetails.exception?.description || 'eval failed'); return r.result.result.value; };
const until = async (expr, label, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(150); } throw Error('timeout: ' + label); };
const key = async (k, code, vk, mods = 0) => { for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', {type, key: k, code, windowsVirtualKeyCode: vk, modifiers: mods}); };
const out = {};
try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', {url: base});
  await until(`!!document.querySelector('#heroScreen') && document.querySelectorAll('.tpl-card').length > 0`, 'home render');
  out.templates = await ev(`document.querySelectorAll('.tpl-card').length`);
  await sleep(1200);
  out.heroColors = await ev(`(() => { const d = document.querySelector('#heroScreen').getContext('2d').getImageData(0,0,400,300).data; const s = new Set(); for (let i = 0; i < d.length; i += 4) s.add(d[i]+','+d[i+1]+','+d[i+2]+','+d[i+3]); return [...s].sort(); })()`);
  await ev(`document.querySelector('.tpl-thumb-btn').click()`);
  await until(`!!document.querySelector('#screen') && location.hash.length > 1`, 'open work');
  out.hash = await ev(`location.hash`);
  await ev(`document.querySelector('#detCode').open = true; document.querySelector('#detSettings').open = true`);
  await until(`!!document.querySelector('#source')`, 'source editor');
  await sleep(600);
  out.rev0 = await ev(`document.querySelector('#written').parentElement.textContent.trim().slice(0, 12)`);
  // unsaved draft + focus survive a full render() triggered by a settings change
  await ev(`(() => { const e = document.querySelector('#source'); e.focus(); e.value = '// DRAFT_MARK\\n' + e.value; e.setSelectionRange(3, 3); })()`);
  out.beforeunloadBlocked = await ev(`(() => { const e = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(e); return e.defaultPrevented; })()`);
  await ev(`document.querySelector('[data-act="wave"][aria-pressed="false"]').click()`);
  await sleep(1500);
  out.draftKept = await ev(`document.querySelector('#source').value.startsWith('// DRAFT_MARK')`);
  out.focusKept = await ev(`document.activeElement.id + '@' + document.activeElement.selectionStart`);
  // Tab indents, Cmd+S saves
  await key('Tab', 'Tab', 9);
  out.tabIndent = await ev(`JSON.stringify(document.querySelector('#source').value.slice(0, 7))`);
  out.stillFocused = await ev(`document.activeElement.id`);
  await key('s', 'KeyS', 83, 4);
  await until(`!(() => { const e = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(e); return e.defaultPrevented; })()`, 'saved via Cmd+S');
  out.rev1 = await ev(`document.querySelector('#written').parentElement.textContent.trim().slice(0, 12)`);
  out.savedOnServer = await ev(`fetch('/api/works/' + location.hash.slice(1)).then(r => r.json()).then(w => w.spec.js.source.slice(0, 16))`);
  out.appColors = await ev(`(() => { const d = document.querySelector('#screen').getContext('2d').getImageData(0,0,400,300).data; const s = new Set(); for (let i = 0; i < d.length; i += 4) s.add(d[i]+','+d[i+1]+','+d[i+2]); return s.size; })()`);
  // Back / Forward
  await ev(`history.back()`);
  await until(`!!document.querySelector('#heroScreen') && !document.querySelector('#screen')`, 'back -> home');
  out.backHash = await ev(`JSON.stringify(location.hash)`);
  await ev(`history.forward()`);
  await until(`!!document.querySelector('#screen') && !document.querySelector('#heroScreen')`, 'forward -> app');
  out.forwardHash = await ev(`location.hash`);
  // Esc guard while setup is busy
  await ev(`document.querySelector('[data-act="device"]').click()`);
  await until(`document.querySelector('#dialog').open && !!document.querySelector('#setupBtn')`, 'device dialog');
  await ev(`document.querySelector('#setupBtn').disabled = true; document.querySelector('.dlg-close').click()`);
  out.closeBlockedWhileBusy = await ev(`document.querySelector('#dialog').open`);
  await ev(`document.querySelector('#setupBtn').disabled = false; document.querySelector('.dlg-close').click()`);
  out.closesWhenIdle = await ev(`!document.querySelector('#dialog').open`);
  // cleanup the work this test created
  out.cleanup = await ev(`fetch('/api/works/' + location.hash.slice(1), {method: 'DELETE'}).then(r => r.status)`);
} catch (e) { out.FAILED = e.message; }
out.pageErrors = errors;
console.log(JSON.stringify(out, null, 1));
ws.close(); chrome.kill();
if (out.FAILED || errors.length) process.exitCode = 1;
