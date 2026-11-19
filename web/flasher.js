// USB system install. Every exit path resets the board, so a failure never leaves it in download mode.
const NOTE4 = {usbVendorId: 0x303a};
const checksum = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
const isNote4 = p => p.getInfo().usbVendorId === NOTE4.usbVendorId;
const limit = (p, ms, message) => { let t; return Promise.race([p, new Promise((_, j) => { t = setTimeout(() => j(Error(message)), ms); })]).finally(() => clearTimeout(t)); };
const delay = ms => new Promise(r => setTimeout(r, ms));
export const MANUAL_BOOT = '设备没有进入刷机状态。请拔掉 USB 线，按住确认键不放，再插回 USB 线，然后松开确认键，点重试。';

// Asks for the port without opening it: the bootloader session must be the first thing that opens the port.
export const pickPort = async usb => usb.port ?? (await navigator.serial.getPorts()).find(isNote4) ?? navigator.serial.requestPort({filters: [NOTE4]});
async function open(usb, say, picked) {
  let port = picked ?? usb.port ?? (await navigator.serial.getPorts()).find(isNote4);
  await usb.disconnect();
  port ??= await navigator.serial.requestPort({filters: [NOTE4]});
  const {ESPLoader, Transport} = await import('./vendor/esptool.js?v=20');
  const terminal = {clean() {}, write() {}, writeLine() {}};
  for (let attempt = 1; attempt <= 3; attempt++) {
    say(attempt === 1 ? '正在让设备进入刷机状态' : `正在让设备进入刷机状态（第 ${attempt} 次）`);
    for (let i = 0; i < 50 && (port.readable || port.writable); i++) await delay(200);
    if (port.readable || port.writable) throw Error('串口没有释放。请拔插一次 USB 线，再点重试');
    const transport = new Transport(port);
    // Baud is meaningless on the chip's USB port, and keeping it avoids a close and reopen mid-session.
    const loader = new ESPLoader({transport, baudrate: 115200, romBaudrate: 115200, terminal});
    const session = {loader, transport};
    try {
      // Resetting re-enumerates USB, so a retry first tries talking to a chip that is already in download mode.
      const name = await limit(loader.main(attempt === 2 ? 'no_reset' : 'default_reset'), 15000, MANUAL_BOOT);
      if (String(name).includes('ESP32-S3')) return session;
      await close(session);
      throw Object.assign(Error('这不是 NOTE4 的芯片，已停止'), {fatal: true});
    } catch (e) {
      if (e.fatal) throw e;
      if (attempt === 3) { await close(session); throw Error(MANUAL_BOOT); }
      await limit(transport.disconnect(), 3000, 'close').catch(() => {});
      await delay(1500);
      for (let i = 0; i < 20; i++) { const fresh = (await navigator.serial.getPorts()).find(isNote4); if (fresh) { port = fresh; break; } await delay(250); }
    }
  }
}
export const LOST = '刷机中断了：设备和电脑的连接断开，或者很久没有进度。请拔插一次 USB 线，再点重试。设备不会变砖，USB 随时能重新刷。';
// esptool can wait forever once the port is gone, so a lost device or a stalled transfer ends the job instead.
export function guarded(port, say, work, stallMs = 45000) {
  let timer, lost; const off = () => { clearTimeout(timer); port.removeEventListener('disconnect', lost); };
  return new Promise((resolve, reject) => {
    const fail = () => { off(); reject(Error(LOST)); }, beat = () => { clearTimeout(timer); timer = setTimeout(fail, stallMs); };
    lost = fail; port.addEventListener('disconnect', lost); beat();
    work((m, p) => { beat(); say(m, p); }).then(v => { off(); resolve(v); }, e => { off(); reject(e); });
  });
}
async function close({loader, transport}) {
  await limit(loader.after('hard_reset'), 4000, 'reset').catch(() => {});
  // The sequence that reliably leaves ROM download mode on the USB-JTAG port: boot strap released, then pulse reset.
  await limit((async () => { await transport.setDTR(false); await transport.setRTS(true); await delay(100); await transport.setRTS(false); await delay(50); })(), 3000, 'reset').catch(() => {});
  await limit(transport.disconnect(), 4000, 'close').catch(() => {});
}
async function compatible(loader, manifest) {
  const table = manifest.files.find(f => f.name === 'partitions.bin');
  return await checksum(await loader.readFlash(table.offset, table.bytes)) === table.sha256;
}
async function write(loader, selected, say) {
  const fileArray = [], total = selected.reduce((n, f) => n + f.bytes, 0);
  let index = 0;
  say('正在下载系统', 2);
  for (const file of selected) {
    const response = await fetch('/api/firmware/usb/file/' + file.name);
    if (!response.ok) throw Error('固件文件下载失败');
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length !== file.bytes || await checksum(data) !== file.sha256) throw Error('固件摘要不匹配');
    let text = ''; for (let at = 0; at < data.length; at += 8192) text += String.fromCharCode(...data.subarray(at, at + 8192));
    fileArray.push({data: text, address: file.offset});
    say('正在下载系统', 2 + Math.round(8 * ++index / selected.length));
  }
  say('正在写入系统，请不要拔线', 10);
  await loader.writeFlash({fileArray, flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep', eraseAll: false, compress: true,
    reportProgress(i, written, size) { const done = selected.slice(0, i).reduce((n, f) => n + f.bytes, 0) + written / size * selected[i].bytes, pct = Math.min(100, Math.round(done / total * 100)); say(`正在写入系统 ${pct}%，请不要拔线`, 10 + Math.round(pct * .85)); }});
  say('正在校验', 96);
  for (const file of selected) {
    const md5 = await loader.flashMd5sum(file.offset, file.bytes);
    if (md5.toLowerCase() !== file.md5) throw Error('写入校验失败：' + file.name);
  }
}
// Updates only the app slot, so apps already on the device stay. Returns whether anything was written.
export async function flashApp({usb, manifest, say, port}) {
  const session = await open(usb, say, port);
  try {
    return await guarded(session.transport.device, say, async s => {
      if (!await compatible(session.loader, manifest)) throw Error('这台设备的分区是旧版，请先在「高级：备份和首次安装」里做首次安装');
      const app = manifest.files.find(f => f.name === 'app.bin');
      s('正在检查系统版本', 1);
      if ((await limit(session.loader.flashMd5sum(app.offset, app.bytes), 30000, MANUAL_BOOT)).toLowerCase() === app.md5) { s('系统已是最新', 100); return false; }
      await write(session.loader, [app], s);
      return true;
    });
  } finally { await close(session); }
}
export async function showFlasher({usb, api, dialog, tell}) {
  if (!navigator.serial) throw Error('安装系统需要电脑上的 Chrome 或 Edge');
  const manifest = await api('/firmware/usb/manifest');
  dialog('备份和首次安装', `<p>NOTE4 · ESP32-S3 · ${manifest.version}</p><p class="small">首次安装会写入分区并清空设备上的应用，请先备份。备份只保存在你的电脑里，不要分享。</p><label><input id="firstInstall" type="checkbox"> 已备份，或确认是空设备</label><div class="row"><button class="btn" id="flashBackup">备份到本机</button><button class="btn solid" id="flashWrite">安装</button></div><progress id="flashBar" max="100" value="0"></progress><p id="flashProgress" class="small" role="status">尚未开始</p>`);
  let busy = false;
  const progress = document.querySelector('#flashProgress'), say = (m, p) => { progress.textContent = m; if (p !== undefined) document.querySelector('#flashBar').value = p; };
  document.querySelector('#flashBackup').onclick = async () => {
    if (busy) return; busy = true;
    let session;
    try {
      session = await open(usb, say);
      const bytes = await session.loader.readFlash(0, manifest.flash_bytes, (_, received) => { const p = Math.round(received / manifest.flash_bytes * 100); say('正在备份 ' + p + '%', p); });
      const url = URL.createObjectURL(new Blob([bytes])), a = document.createElement('a');
      a.href = url; a.download = 'NOTE4-private-full-backup.bin'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      say('备份已下载到你的电脑');
    } catch (e) { say('备份没有完成：' + e.message); tell(e.message); } finally { if (session) await close(session); busy = false; }
  };
  document.querySelector('#flashWrite').onclick = async () => {
    if (busy) return; busy = true;
    let session;
    try {
      session = await open(usb, say);
      const first = document.querySelector('#firstInstall').checked;
      if (!first && !await compatible(session.loader, manifest)) throw Error('现有分区不兼容，请先备份并勾选上面的确认');
      await guarded(session.transport.device, say, s => write(session.loader, first ? manifest.files : manifest.files.filter(f => f.name === 'app.bin'), s));
      say('安装完成，设备正在重启，屏幕会自动刷新。关闭这个窗口，再到「添加设备」填 WiFi。', 100);
    } catch (e) { say('安装没有完成：' + e.message); tell(e.message); } finally { if (session) await close(session); busy = false; }
  };
}
