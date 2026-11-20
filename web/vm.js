// Thin loader for wasm/note4_vm.wasm; runs in the browser and on the server.
// Keeps WASM imports to the handful of WASI calls the C runtime needs.
const enc = new TextEncoder(), dec = new TextDecoder();
export const KEYS = ['up', 'ok', 'down', 'wave'];
const MODE_MAP = {fast: 0, gray: 1, tuned: 2, flash: 3, clear: 4};

export class Note4Vm {
  static async create(wasmBytes, fontBytes, tickLimit, aaFontBytes) {
    const vm = new Note4Vm(); vm.stdout = ''; vm.netQueue = []; vm.gen = 0;
    const wasi = new Proxy({
      fd_write: (fd, iov, n, out) => { let t = 0; const v = new DataView(vm.m.memory.buffer); for (let i = 0; i < n; i++) { const p = v.getUint32(iov + i * 8, true), l = v.getUint32(iov + i * 8 + 4, true); vm.stdout += dec.decode(new Uint8Array(vm.m.memory.buffer, p, l)); t += l; } v.setUint32(out, t, true); return 0; },
      clock_time_get: (id, prec, out) => { new DataView(vm.m.memory.buffer).setBigUint64(out, BigInt(Date.now()) * 1000000n, true); return 0; },
    }, { get: (t, k) => t[k] ?? (() => 0) });
    const instance = await WebAssembly.instantiate(wasmBytes instanceof WebAssembly.Module ? wasmBytes : await WebAssembly.compile(wasmBytes), { wasi_snapshot_preview1: wasi, env: new Proxy({n4_frame: (i, p) => vm.onFrame?.(i, new Uint8Array(vm.m.memory.buffer, p, 60000)), n4_net: (k, u, m, h, b, n, keep) => { const s = p => { const a = new Uint8Array(vm.m.memory.buffer); if (!p) return ''; let e = p; while (a[e]) e++; return dec.decode(a.subarray(p, e)); }; const q = {key: s(k), url: s(u), method: s(m) || 'GET', headers: s(h), body: b && n ? dec.decode(new Uint8Array(vm.m.memory.buffer, b, n)) : '', keep: !!keep, gen: vm.gen}; vm.netQueue.push(q); vm.onNet?.(q); return 1; }}, { get: (t, k) => t[k] ?? (() => 0) }) });
    vm.m = instance.exports;
    vm.m._initialize?.();
    const p = vm.m.vm_alloc(fontBytes.length);
    new Uint8Array(vm.m.memory.buffer, p, fontBytes.length).set(fontBytes);
    vm.m.vm_set_font(p);
    if (aaFontBytes && aaFontBytes.length && vm.m.vm_set_aa_font) {
      const ap = vm.m.vm_alloc(aaFontBytes.length);
      new Uint8Array(vm.m.memory.buffer, ap, aaFontBytes.length).set(aaFontBytes);
      vm.m.vm_set_aa_font(ap);
    }
    if (tickLimit) vm.m.vm_set_tick_limit(tickLimit);
    return vm;
  }
  cstr(s) { const b = enc.encode(s), p = this.m.vm_alloc(b.length + 1), u = new Uint8Array(this.m.memory.buffer, p, b.length + 1); u.set(b); u[b.length] = 0; return [p, b.length]; }
  start(source, store = {}, fastOrMode = false, frames = 0) {
    if (typeof fastOrMode === 'string' && this.m.vm_mode) {
      this.m.vm_mode(MODE_MAP[fastOrMode] ?? 0);
    } else if (typeof fastOrMode === 'number' && this.m.vm_mode) {
      this.m.vm_mode(fastOrMode);
    } else {
      this.m.vm_fast(fastOrMode ? 1 : 0);
    }
    this.m.vm_frames(frames); this.m.vm_store_clear(); this.clearLog(); this.m.vm_oob_clear(); this.netQueue = []; this.gen++;
    for (const [k, v] of Object.entries(store)) { const [kp] = this.cstr(k), [vp, n] = this.cstr(v); this.m.vm_store_put(kp, vp, n); this.m.vm_free(kp); this.m.vm_free(vp); }
    const [p, n] = this.cstr(source); const r = this.m.vm_start(p, n); this.m.vm_free(p); return r;
  }
  tick() { return this.m.vm_tick(); }
  net(key, status, body = '') { const [k] = this.cstr(key), [p, n] = this.cstr(body); const r = this.m.vm_net(k, status, p, n); this.m.vm_free(k); this.m.vm_free(p); return r; }
  tickMs() { return this.m.vm_tick_ms(); }
  key(k) { const [p] = this.cstr(k); const r = this.m.vm_key(p); this.m.vm_free(p); return r; }
  log() { const p = this.m.vm_log(), n = this.m.vm_log_len(); return this.stdout + dec.decode(new Uint8Array(this.m.memory.buffer, p, n)); }
  clearLog() { this.m.vm_log_clear(); this.stdout = ''; }
  oob() { return {count: this.m.vm_oob(), x: this.m.vm_oob_x(), y: this.m.vm_oob_y()}; }
  layout() {
    if (!this.m.vm_layout) return null;
    const g = i => this.m.vm_layout(i), n = g(4);
    const issues = [];
    if (this.m.vm_issue) {
      for (let i = 0; i < n; i++) issues.push({code: this.m.vm_issue(i, 0), x: this.m.vm_issue(i, 1), y: this.m.vm_issue(i, 2), detail: this.m.vm_issue(i, 3)});
    }
    return {minX: g(0), minY: g(1), maxX: g(2), maxY: g(3), issues};
  }
  dirty() { return !!this.m.vm_take_dirty(); }
  // 400x300 grays, 0 black to 15 white; fast=true applies the device's 4-level partial mapping.
  pixels(fast) {
    const f = new Uint8Array(this.m.memory.buffer, this.m.vm_frame(), 60000), out = new Uint8Array(120000);
    for (let i = 0; i < 120000; i++) { const g = i & 1 ? f[i >> 1] & 15 : f[i >> 1] >> 4; out[i] = fast ? Math.floor((g + 2) / 5) * 5 : g; }
    return out;
  }
  store() { const o = {}, m = this.m, n = m.vm_store_count(), s = p => { const u = new Uint8Array(m.memory.buffer, p); return dec.decode(u.subarray(0, u.indexOf(0))); }; for (let i = 0; i < n; i++) { const p = m.vm_store_value(i), l = m.vm_store_value_len(i); o[s(m.vm_store_key(i))] = dec.decode(new Uint8Array(m.memory.buffer, p, l)); } return o; }
  ticks() { return this.m.vm_ticks(); }
}
