// Modular Voice+Agent Component UI & Browser-Only Isolated Auth for NOTE4 Studio v2.1
// Security invariant: User DSH tokens & API keys live ONLY in browser localStorage + user's own firmware NVS — NEVER stored on server DB.

const CRED_KEY = 'n4_voice_cred_v2';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function readLocalVoiceCred() {
  try {
    const raw = localStorage.getItem(CRED_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || typeof c.token !== 'string' || c.token.length < 6) return null;
    return c;
  } catch {
    return null;
  }
}

export function saveLocalVoiceCred(cred) {
  if (!cred || !cred.token) return null;
  const isDsh = cred.kind !== 'api_key';
  const clean = {
    configured: true,
    storage: 'browser_only',
    kind: isDsh ? 'dsh_token' : 'api_key',
    token: String(cred.token),
    masked: cred.masked || (cred.token.slice(0, 6) + '…' + cred.token.slice(-4)),
    // Official DSH login locks base_url to https://api.deepseek.com; only model is selectable (default deepseek-flash)
    base_url: isDsh ? 'https://api.deepseek.com' : (cred.base_url || 'https://api.deepseek.com'),
    model: cred.model || 'deepseek-flash',
    user: cred.user || null,
    balance: cred.balance || null,
    rev: cred.rev || Math.floor(Date.now() / 1000),
    verified_at: cred.verified_at || Date.now(),
    updated_at: Date.now(),
  };
  try { localStorage.setItem(CRED_KEY, JSON.stringify(clean)); } catch {}
  return clean;
}

export function clearLocalVoiceCred() {
  try { localStorage.removeItem(CRED_KEY); sessionStorage.removeItem('n4_models_cache_v1'); } catch {}
}

export function voiceCredHeaders() {
  const c = readLocalVoiceCred();
  if (!c) return {};
  return {
    'x-n4-ai-kind': c.kind,
    'x-n4-ai-token': c.token,
    'x-n4-ai-base': c.base_url || 'https://api.deepseek.com',
    'x-n4-ai-model': c.model || 'deepseek-flash',
  };
}

export async function syncVoiceCredOverUsb(usb) {
  const c = readLocalVoiceCred();
  if (!c || !usb?.port) return false;
  await usb.command({
    op: 'set_ai_cred',
    kind: c.kind,
    token: c.token,
    base_url: c.base_url || 'https://api.deepseek.com',
    model: c.model || 'deepseek-flash',
    rev: c.rev || Math.floor(Date.now() / 1000),
  }, 'set_ai_cred');
  return true;
}

function playSimTone(freq1 = 880, freq2 = 1175, ms = 80) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx(), osc = ac.createOscillator(), g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq1, ac.currentTime);
    osc.frequency.setValueAtTime(freq2, ac.currentTime + ms / 2000);
    g.gain.setValueAtTime(0.08, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + ms / 1000);
    osc.connect(g); g.connect(ac.destination);
    osc.start(); osc.stop(ac.currentTime + ms / 1000);
    setTimeout(() => ac.close().catch(() => {}), ms + 80);
  } catch {}
}

export function setSimLed(mode = 'off') {
  const el = document.getElementById('simLed');
  if (!el) return;
  el.dataset.mode = mode;
  const titles = {off: '状态灯：待机熄灭', ptt: '状态灯：短录常亮', long: '状态灯：长录 100% 满亮', breathe: '状态灯：思考呼吸灯', speaking: '状态灯：语音播报中', err: '状态灯：异常三连闪'};
  el.title = titles[mode] || titles.off;
}

let verifyInflight = null;
export async function verifyLocalVoiceCred({api, usb, onRevoked, tell, minAgeMs = 180000} = {}) {
  const local = readLocalVoiceCred();
  if (!local) return {valid: false, revoked: false, cred: null};
  if (minAgeMs > 0 && local.verified_at && Date.now() - local.verified_at < minAgeMs) {
    return {valid: true, revoked: false, cred: local, cached: true};
  }
  if (verifyInflight) return verifyInflight;
  verifyInflight = (async () => {
    try {
      const fresh = await api('/ai-cred/status?refresh=1');
      if (fresh?.revoked) {
        clearLocalVoiceCred();
        if (usb?.port) await usb.command({op: 'set_ai_cred', clear: true, rev: Math.floor(Date.now() / 1000)}, 'set_ai_cred').catch(() => {});
        await onRevoked?.();
        tell?.('检测到 DeepSeek 账号已在官网退出或失效，已自动清除本地登录态，请重新登录');
        return {valid: false, revoked: true, cred: null};
      }
      if (fresh?.configured) {
        const updated = saveLocalVoiceCred({...local, balance: fresh.balance ?? local.balance, verified_at: Date.now()});
        return {valid: true, revoked: false, cred: updated};
      }
      return {valid: true, revoked: false, cred: local};
    } catch (err) {
      if (err?.status === 401 || err?.code === 'AI_CRED_REVOKED') {
        clearLocalVoiceCred();
        if (usb?.port) await usb.command({op: 'set_ai_cred', clear: true, rev: Math.floor(Date.now() / 1000)}, 'set_ai_cred').catch(() => {});
        await onRevoked?.();
        tell?.('检测到 DeepSeek 账号已在官网退出或失效，已自动清除本地登录态，请重新登录');
        return {valid: false, revoked: true, cred: null};
      }
      return {valid: true, revoked: false, cred: local};
    } finally {
      verifyInflight = null;
    }
  })();
  return verifyInflight;
}

export async function openVoiceCredDialog({api, dialog, tell, usb, onUpdated}) {
  let local = readLocalVoiceCred();
  let modelChoices = ['deepseek-flash'];
  let revokedNotice = false;
  if (local) {
    try {
      // Single explicit liveness check when user opens the account dialog (short-circuits /models if revoked)
      const fresh = await api('/ai-cred/status?refresh=1').catch(err => (err?.status === 401 || err?.code === 'AI_CRED_REVOKED' ? {revoked: true} : null));
      if (fresh?.revoked) {
        clearLocalVoiceCred();
        if (usb?.port) await usb.command({op: 'set_ai_cred', clear: true, rev: Math.floor(Date.now() / 1000)}, 'set_ai_cred').catch(() => {});
        local = null;
        revokedNotice = true;
        await onUpdated?.();
      } else {
        if (fresh?.configured) local = saveLocalVoiceCred({...local, balance: fresh.balance ?? local.balance, verified_at: Date.now()});
        let cachedModels = null;
        try {
          const mc = JSON.parse(sessionStorage.getItem('n4_models_cache_v1') || 'null');
          if (mc && mc.masked === local.masked && Date.now() - mc.at < 600000 && Array.isArray(mc.models)) cachedModels = mc.models;
        } catch {}
        if (cachedModels) {
          modelChoices = cachedModels;
        } else {
          let mRevoked = false;
          const mList = await api('/ai-cred/models').catch(err => {
            if (err?.status === 401 || err?.code === 'AI_CRED_REVOKED') mRevoked = true;
            return null;
          });
          if (mRevoked) {
            clearLocalVoiceCred();
            if (usb?.port) await usb.command({op: 'set_ai_cred', clear: true, rev: Math.floor(Date.now() / 1000)}, 'set_ai_cred').catch(() => {});
            local = null;
            revokedNotice = true;
            await onUpdated?.();
          } else if (Array.isArray(mList?.models) && mList.models.length) {
            modelChoices = mList.models;
            try { sessionStorage.setItem('n4_models_cache_v1', JSON.stringify({masked: local.masked, at: Date.now(), models: modelChoices})); } catch {}
          }
        }
      }
    } catch {}
    if (local?.model && !modelChoices.includes(local.model)) modelChoices.unshift(local.model);
  }

  const curModel = local?.model || 'deepseek-flash';
  const statusHtml = local
    ? `<div class="vcred-badge ok" style="flex-direction:column;align-items:stretch;gap:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
          <div>
            <b>已登录 · ${local.kind === 'dsh_token' ? 'DeepSeek 官方账号（已接管创作台 AI 与语音）' : '个人 API Key（已接管创作台 AI）'}</b>
            <div class="small" style="margin-top:2px">${esc(local.user?.name ? local.user.name + ' · ' : '')}${esc(local.masked || '')}${local.balance ? ' · 余额 ' + esc(local.balance) : ''}</div>
            <div class="small" style="margin-top:2px;color:#4a5568">自负盈亏直连官方网关，凭证仅存本浏览器与你的硬件，不经由服务器存储</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${usb?.port ? '<button type="button" class="btn sm solid" id="vcSyncUsb">USB 直写固件</button>' : ''}
            <button type="button" class="btn sm soft" id="vcSyncWifi">无线单次下发</button>
            <button type="button" class="btn sm" id="vcUnbind">退出登录</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:8px;border-top:1px solid rgba(0,0,0,.08)">
          <span class="small" style="font-weight:600">对话与制作模型（官方列表 · 默认 deepseek-flash）</span>
          <select id="vcModelSelect" style="min-width:180px;padding:5px 8px;border-radius:6px;border:1px solid #ccc;font:inherit;font-size:13px">
            ${modelChoices.map(m => `<option value="${esc(m)}"${m === curModel ? ' selected' : ''}>${esc(m)}${m === 'deepseek-flash' ? '（推荐）' : ''}</option>`).join('')}
          </select>
        </div>
      </div>`
    : revokedNotice
      ? `<div class="vcred-badge" style="background:#fff7ed;border-color:#fdba74;color:#9a3412"><span>检测到原 DeepSeek 账号已在官网退出或令牌失效，已自动清除本浏览器登录态，请重新扫码登录。</span></div>`
      : `<div class="vcred-badge"><span>当前使用平台限量公益通道（不保证稳定供应） · 登录后自动切换为你自己的 DeepSeek 账号，仅存浏览器本地</span></div>`;

  dialog('DeepSeek 个人账号与语音设置', `
    <div id="vcRoot" style="display:flex;flex-direction:column;gap:14px">
      ${statusHtml}
      <div class="vcred-card">
        <b>方式一：DeepSeek 官方账号一键登录（推荐）</b>
        <p class="small" style="margin:4px 0 10px;color:#555">一次授权开通端侧 ASR 语音识别、人声 TTS 播报、实时搜索与 V4.1-Flash 工具推理。凭证仅存当前浏览器本地，写入设备后墨水屏独立直连官方接口。</p>
        <button type="button" class="btn solid" id="vcStartDsh">打开 DeepSeek 官方页扫码 / 登录</button>
        <div id="vcDshStep" hidden style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
          <label class="small" style="font-weight:600">登录确认后，复制浏览器地址栏跳转的 <code>http://127.0.0.1.../oauth/callback?code=...</code> 粘贴到下方（自动识别）：</label>
          <input id="vcPasteUrl" type="text" placeholder="在此粘贴回调链接，自动保存在本浏览器…" autocomplete="off">
          <div id="vcBridgeRow" style="display:flex;gap:8px;align-items:center">
            <button type="button" class="btn sm soft" id="vcCopyBridge">复制本机一行自动回调命令</button>
            <span class="small" style="color:#666">（电脑装有 Node 时免手动粘贴）</span>
          </div>
        </div>
      </div>
      <details class="vcred-card" ${local?.kind === 'api_key' ? 'open' : ''}>
        <summary style="cursor:pointer;font-weight:600">方式二：填写个人 API Key（sk-...）</summary>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
          <input id="vcApiKey" type="password" placeholder="sk-..." autocomplete="off">
          <div style="display:grid;grid-template-columns:1fr 140px;gap:8px">
            <input id="vcBaseUrl" type="url" value="${esc(local?.base_url || 'https://api.deepseek.com')}" placeholder="https://api.deepseek.com">
            <input id="vcModel" type="text" value="${esc(local?.model || 'deepseek-flash')}" placeholder="deepseek-flash">
          </div>
          <button type="button" class="btn soft" id="vcSaveKey">校验并保存到本浏览器</button>
        </div>
      </details>
    </div>
  `);

  let bridgeCmd = '', authState = '', pollTimer = null;
  const cleanupModal = () => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    window.removeEventListener('message', onMsg);
  };
  const finish = async (msg, newCred) => {
    cleanupModal();
    if (newCred) {
      saveLocalVoiceCred(newCred);
      if (usb?.port) await syncVoiceCredOverUsb(usb).catch(() => {});
    }
    tell(msg);
    await onUpdated?.();
    openVoiceCredDialog({api, dialog, tell, usb, onUpdated});
  };

  function onMsg(e) {
    if (e.origin === window.location.origin && e.data?.type === 'note4_dsh_cred' && e.data.cred) {
      finish('DeepSeek 账号已保存在本机浏览器！', e.data.cred);
    }
  }
  window.addEventListener('message', onMsg);
  document.getElementById('dialog')?.addEventListener('close', cleanupModal, {once: true});

  document.getElementById('vcStartDsh')?.addEventListener('click', async e => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = '正在请求官方授权链接…';
    try {
      const r = await api('/ai-cred/dsh/init', 'POST', {});
      bridgeCmd = r.bridge_cmd || '';
      authState = r.state || '';
      const win = window.open(r.authorize_url, '_blank');
      if (!win && r.is_local) location.href = r.authorize_url;
      btn.textContent = '已打开官方登录页（可重新打开）'; btn.disabled = false;
      if (!r.is_local) {
        const box = document.getElementById('vcDshStep');
        if (box) box.hidden = false;
        document.getElementById('vcPasteUrl')?.focus();
      }
      if (pollTimer) clearInterval(pollTimer);
      const pollDeadline = Date.now() + 180000;
      pollTimer = setInterval(async () => {
        if (Date.now() > pollDeadline || !document.getElementById('dialog')?.open) {
          cleanupModal();
          return;
        }
        const fromLs = readLocalVoiceCred();
        if (fromLs && (!local || fromLs.rev !== local.rev)) return finish('DeepSeek 账号已保存在本机浏览器！', fromLs);
        if (!authState) return;
        const cl = await api('/ai-cred/dsh/claim', 'POST', {state: authState}).catch(() => null);
        if (cl?.ready && cl.cred) finish('DeepSeek 账号授权完成（已存本机浏览器）！', cl.cred);
      }, 1800);
    } catch (err) {
      btn.disabled = false; btn.textContent = '打开 DeepSeek 官方页扫码 / 登录';
      tell(err.message || '发起授权失败');
    }
  });

  const submitPaste = async val => {
    if (!val || !val.includes('code=')) return;
    try {
      const r = await api('/ai-cred/dsh/complete', 'POST', {callback_url: val});
      if (r?.cred) await finish('DeepSeek 账号已保存在本机浏览器！', r.cred);
    } catch (err) { tell(err.message || '回调解析失败'); }
  };
  const pasteInput = document.getElementById('vcPasteUrl');
  pasteInput?.addEventListener('paste', () => { setTimeout(() => submitPaste(pasteInput.value.trim()), 20); });
  pasteInput?.addEventListener('change', () => submitPaste(pasteInput.value.trim()));

  document.getElementById('vcCopyBridge')?.addEventListener('click', async () => {
    if (!bridgeCmd) return;
    await navigator.clipboard.writeText(bridgeCmd);
    tell('已复制本机自动桥接命令，在终端粘贴运行即可完成回调');
  });

  document.getElementById('vcSaveKey')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    const api_key = document.getElementById('vcApiKey')?.value.trim() || '';
    const base_url = document.getElementById('vcBaseUrl')?.value.trim() || 'https://api.deepseek.com';
    const model = document.getElementById('vcModel')?.value.trim() || 'deepseek-flash';
    btn.disabled = true; btn.textContent = '正在校验连通性…';
    try {
      const r = await api('/ai-cred/apikey', 'POST', {api_key, base_url, model});
      if (r?.cred) await finish('API Key 校验通过并已保存在本浏览器！', r.cred);
    } catch (err) {
      btn.disabled = false; btn.textContent = '校验并保存到本浏览器';
      tell(err.message || '校验失败');
    }
  });

  document.getElementById('vcModelSelect')?.addEventListener('change', async e => {
    const chosen = e.currentTarget.value || 'deepseek-flash';
    if (!local) return;
    local = saveLocalVoiceCred({...local, model: chosen, rev: Math.floor(Date.now() / 1000)});
    if (usb?.port) await syncVoiceCredOverUsb(usb).catch(() => {});
    await onUpdated?.();
    tell(`已切换个人模型为 ${chosen}`);
  });

  document.getElementById('vcUnbind')?.addEventListener('click', async () => {
    await api('/ai-cred/logout', 'POST', {}).catch(() => {});
    clearLocalVoiceCred();
    if (usb?.port) await usb.command({op: 'set_ai_cred', clear: true, rev: Math.floor(Date.now() / 1000)}, 'set_ai_cred').catch(() => {});
    await finish('已吊销并清除本浏览器与设备上的个人语音凭证');
  });

  document.getElementById('vcSyncWifi')?.addEventListener('click', async () => {
    try {
      const r = await api('/ai-cred/sync-devices', 'POST', {});
      tell(`已建立 ${r.ttl_seconds || 180} 秒一次性无线投递信箱（设备拉取即焚，服务器零落盘）`);
    } catch (err) { tell(err.message || '下发失败'); }
  });

  document.getElementById('vcSyncUsb')?.addEventListener('click', async () => {
    try {
      await syncVoiceCredOverUsb(usb);
      tell('已通过 USB 数据线直写墨水屏 NVS 安全分区（全程零经由服务器）！');
    } catch (err) { tell(err.message || 'USB 写入失败'); }
  });
}

const simHist = [];
let activeAudio = null, activeAudioUrl = '', activeTurnAbort = null, simTurnGen = 0;

function setHwStrip(state, text, showCancel = false) {
  const el = document.getElementById('hwVoiceStrip');
  if (!el) return;
  el.dataset.state = state;
  const tx = el.querySelector('.hw-voice-txt');
  if (tx) tx.textContent = text;
  const bars = el.querySelector('.mic-bars');
  if (bars) bars.hidden = !['ptt', 'long', 'speaking'].includes(state);
  const can = el.querySelector('[data-act="hwVoiceCancel"]');
  if (can) can.hidden = !showCancel;
  const txtBtn = el.querySelector('[data-act="toggleSimText"]');
  if (txtBtn) txtBtn.hidden = showCancel;
}

export function interruptSimulatorVoice() {
  simTurnGen++;
  if (activeTurnAbort) { try { activeTurnAbort.abort(); } catch {} activeTurnAbort = null; }
  if (activeAudio) {
    try { activeAudio.pause(); activeAudio.src = ''; } catch {}
    activeAudio = null;
  }
  if (activeAudioUrl) { try { URL.revokeObjectURL(activeAudioUrl); } catch {} activeAudioUrl = ''; }
  try { window.speechSynthesis?.cancel(); } catch {}
}

function encodeWav16k(chunks, srcRate) {
  const totalIn = chunks.reduce((n, c) => n + c.length, 0);
  if (!totalIn) return null;
  const ratio = srcRate / 16000;
  const outLen = Math.max(1, Math.floor(totalIn / ratio));
  const merged = new Float32Array(totalIn);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }
  const wav = new ArrayBuffer(44 + outLen * 2);
  const v = new DataView(wav);
  const ws = (p, s) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + outLen * 2, true); ws(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, outLen * 2, true);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio, i0 = Math.floor(idx), i1 = Math.min(totalIn - 1, i0 + 1), frac = idx - i0;
    const s = Math.max(-1, Math.min(1, merged[i0] * (1 - frac) + merged[i1] * frac));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(wav);
}

async function playReplyTts({text, vcfg, localCred, myGen, onDone}) {
  if (vcfg.tts === 'off') { setTimeout(onDone, 500); return; }
  // 1:1 with NOTE4 firmware: stream real DeepSeek neural TTS (stella/tide) when DSH logged in!
  if (localCred?.kind === 'dsh_token') {
    try {
      const ctrl = new AbortController();
      activeTurnAbort = ctrl;
      const r = await fetch('/api/ai-cred/tts', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', ...voiceCredHeaders()},
        body: JSON.stringify({text, voice_id: vcfg.tts === 'tide' ? 'tide' : 'stella'}),
        signal: ctrl.signal,
      });
      if (myGen !== simTurnGen) return;
      if (r.ok && r.status === 200) {
        const blob = await r.blob();
        if (myGen !== simTurnGen) return;
        const blobUrl = URL.createObjectURL(blob);
        activeAudioUrl = blobUrl;
        const audio = new Audio(blobUrl);
        activeAudio = audio;
        const revokeNow = () => {
          try { URL.revokeObjectURL(blobUrl); } catch {}
          if (activeAudioUrl === blobUrl) activeAudioUrl = '';
        };
        audio.onended = audio.onerror = () => {
          revokeNow();
          if (myGen === simTurnGen) { activeAudio = null; onDone(); }
        };
        try {
          await audio.play();
          return;
        } catch (playErr) {
          revokeNow();
          activeAudio = null;
          throw playErr;
        }
      }
    } catch {
      if (myGen !== simTurnGen) return;
    }
  }
  if (window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN'; u.rate = 1.08;
      u.onend = u.onerror = () => { if (myGen === simTurnGen) onDone(); };
      window.speechSynthesis.speak(u);
      return;
    } catch {}
  }
  setTimeout(() => { if (myGen === simTurnGen) onDone(); }, 700);
}

export async function runSimulatorVoiceTurn({utterance, vm, work, api, paint, tell, usb, onRevoked, idleLabel}) {
  const text = String(utterance || '').trim();
  if (!text || !vm) return;
  interruptSimulatorVoice();
  const myGen = simTurnGen;
  if (usb?.port) usb.command({op: 'voice_sim', text}, 'voice_sim').catch(() => {});
  const ag = vm.agent();
  const resetIdle = () => {
    setSimLed('off');
    setHwStrip('idle', idleLabel || '单击确认 · 按住「确定」说话 · 双击免提长录', false);
  };
  if (!ag.configured) {
    resetIdle();
    tell('当前应用尚未接入语音工具，可点左侧「一键接入语音+Agent组件」自动生成');
    return;
  }
  const localCred = readLocalVoiceCred();
  if (!localCred) {
    playSimTone(880, 1175, 55);
    if (ag.toolCount > 0) vm.agentProbe(0);
    vm.agentEmit('done', '演示已执行（点顶部「登录 DeepSeek」绑个人账号可真实对话）');
    if (vm.dirty()) paint();
    resetIdle();
    tell('已在本地零消耗演示工具效果；绑定你自己的 DeepSeek 账号后即可真实语音转写与播报');
    return;
  }

  playSimTone(880, 1175, 60);
  setSimLed('breathe');
  setHwStrip('busy', `思考中：「${text.slice(0, 16)}${text.length > 16 ? '…' : ''}」`, true);
  vm.agentEmit('thinking', '思考中…');
  if (vm.dirty()) paint();

  const vcfg = work?.spec?.js?.voice || {tts: 'stella', search: true, thinking: false};
  const stateJson = vm.agentState().json || '{}';
  const sysPrompt = '你是用户桌面上贴心、自然、有人情味的墨水屏随身搭档。收到语音后，先干脆调用工具把事办妥，再用一句8到22字以内的自然口语回应（像熟人轻声搭话一样温暖利落，禁止Markdown星号井号、列表、Emoji、机械套话或逐条复读）。应用职责：' + ag.role;
  const msgs = [{role: 'system', content: sysPrompt}, ...simHist.slice(-6), {role: 'user', content: `[看板状态]: ${stateJson}\n[用户语音]: ${text}`}];
  const tools = [...ag.tools];
  if (vcfg.search !== false) {
    tools.push({type: 'function', function: {name: 'web_search', description: '联网搜索实时资讯天气百科', parameters: {type: 'object', properties: {query: {type: 'string'}}, required: ['query']}}});
  }

  let finalReply = '', totalTools = 0, lastSig = '', rep = 0;
  try {
    for (let step = 0; step < 3; step++) {
      if (myGen !== simTurnGen) return;
      const allowTools = step < 2 && totalTools < 4 && rep < 2 && tools.length > 0;
      const r = await api('/ai-cred/sim-step', 'POST', {messages: msgs, tools: allowTools ? tools : [], thinking: !!(vcfg.thinking && allowTools)});
      if (myGen !== simTurnGen) return;
      const m = r.message || {};
      const tcs = Array.isArray(m.tool_calls) ? m.tool_calls : [];
      if (!tcs.length) { finalReply = String(m.content || '').trim(); break; }
      msgs.push({role: 'assistant', content: m.content || '', ...(m.reasoning_content ? {reasoning_content: m.reasoning_content} : {}), tool_calls: tcs});
      for (const tc of tcs) {
        if (myGen !== simTurnGen) return;
        const nm = tc.function?.name || '', aj = tc.function?.arguments || '{}';
        const sig = nm + ':' + aj;
        rep = sig === lastSig ? rep + 1 : 1; lastSig = sig;
        let out = '{}';
        if (totalTools >= 4) out = '{"capped":"max_4_tools_per_turn_reached_reply_now"}';
        else if (rep >= 3) out = '{"blocked":"identical_tool_called_3_times"}';
        else if (nm === 'web_search') {
          totalTools++;
          let q = ''; try { q = JSON.parse(aj).query || ''; } catch {}
          const sr = await api('/ai-cred/sim-step', 'POST', {builtin_tool: 'web_search', query: q});
          out = JSON.stringify(sr).slice(0, 2048);
        } else {
          totalTools++;
          out = vm.agentCall(nm, aj).json;
          if (vm.dirty()) paint();
        }
        msgs.push({role: 'tool', tool_call_id: tc.id || 'call_0', content: out});
      }
    }
    if (myGen !== simTurnGen) return;
    if (!finalReply) finalReply = '好嘞，已经帮你更新好啦。';
    simHist.push({role: 'user', content: text}, {role: 'assistant', content: finalReply});
    if (simHist.length > 6) simHist.splice(0, simHist.length - 6);
    vm.agentEmit('speaking', finalReply);
    if (vm.dirty()) paint();
    setSimLed('speaking');
    setHwStrip('speaking', '播报中 · 按住「确定」可随时插话', true);
    tell('语音搭档：' + finalReply);
    await playReplyTts({
      text: finalReply, vcfg, localCred, myGen,
      onDone: () => {
        if (myGen !== simTurnGen) return;
        vm.agentEmit('done', finalReply);
        if (vm.dirty()) paint();
        resetIdle();
      },
    });
  } catch (err) {
    if (myGen !== simTurnGen) return;
    setSimLed('err');
    const isRevoked = err?.status === 401 || err?.code === 'AI_CRED_REVOKED' || /AI_CRED_REVOKED|官网退出|失效/.test(String(err?.message || ''));
    if (isRevoked) {
      clearLocalVoiceCred();
      if (usb?.port) usb.command({op: 'set_ai_cred', clear: true, rev: Math.floor(Date.now() / 1000)}, 'set_ai_cred').catch(() => {});
      onRevoked?.();
      vm.agentEmit('error', '请重登');
      if (vm.dirty()) paint();
      setTimeout(resetIdle, 900);
      tell('DeepSeek 登录态已在官网退出或失效，已自动清除本地登录态，请重新登录');
      return;
    }
    vm.agentEmit('error', '请重试');
    if (vm.dirty()) paint();
    setTimeout(resetIdle, 900);
    tell(err.message || '模拟语音执行失败');
  }
}

// 1:1 NOTE4 Physical OK Button + Real Mic Recorder (Hold = PTT/Barge-in, Double-Click = Long Record, Tap = OK)
export function createSimHardwareVoice({getCtx, onKeyOk, onRevoked, api, paint, tell, usb}) {
  const HOLD_MS = 380, DBL_MS = 300, MAX_REC_MS = 55000;
  let downAt = 0, holdTimer = null, clickTimer = null, lastTapAt = 0;
  let recMode = null; // null | 'ptt' | 'long'
  let stream = null, ac = null, proc = null, srcNode = null, chunks = [], recRate = 48000, recStarted = 0;
  let meterTimer = null, maxTimer = null, peakRms = 0, fallbackSR = null, fallbackTxt = '';

  const idleHint = mode => mode === 'ptt'
    ? '单击确认 · 按住「确定」说话'
    : mode === 'long'
      ? '单击确认 · 双击「确定」免提长录'
      : '单击确认 · 按住「确定」说话 · 双击免提长录';

  const setOkUi = (cls, label) => {
    const btn = document.getElementById('hwOkBtn');
    if (!btn) return;
    btn.classList.remove('arming', 'rec-ptt', 'rec-long');
    if (cls) btn.classList.add(cls);
    const lb = btn.querySelector('.hw-ok-lbl');
    if (lb && label) lb.textContent = label;
  };

  const stopMicHardware = () => {
    clearInterval(meterTimer); meterTimer = null;
    clearTimeout(maxTimer); maxTimer = null;
    try { proc?.disconnect(); } catch {}
    try { srcNode?.disconnect(); } catch {}
    try { ac?.close(); } catch {}
    try { stream?.getTracks().forEach(t => t.stop()); } catch {}
    try { fallbackSR?.stop(); } catch {}
    proc = srcNode = ac = stream = fallbackSR = null;
  };

  const resetAll = (emitIdle = false) => {
    clearTimeout(holdTimer); holdTimer = null;
    recMode = null;
    stopMicHardware();
    setOkUi('', '确定');
    setSimLed('off');
    const ctx = getCtx();
    setHwStrip('idle', idleHint(ctx?.voiceMode || 'both'), false);
    if (emitIdle && ctx?.vm) { ctx.vm.agentEmit('idle', ''); if (ctx.vm.dirty()) paint(); }
  };

  const updateMeter = () => {
    const bars = document.querySelectorAll('#hwVoiceStrip .mic-bars i');
    const lvl = Math.min(1, peakRms * 5.2);
    peakRms *= 0.45;
    const weights = [0.55, 0.85, 1.0, 0.8, 0.5];
    bars.forEach((b, i) => {
      const h = Math.round(3 + lvl * 11 * weights[i] * (0.78 + Math.random() * 0.25));
      b.style.height = Math.max(3, Math.min(14, h)) + 'px';
    });
    const sec = Math.floor((Date.now() - recStarted) / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    const tx = document.querySelector('#hwVoiceStrip .hw-voice-txt');
    if (tx) tx.textContent = recMode === 'long' ? `长录中 ${mm}:${ss} · 单击「确定」结束` : `录音中 ${mm}:${ss} · 松手发送`;
  };

  const startMic = async mode => {
    const ctx = getCtx();
    if (!ctx?.vm) return;
    interruptSimulatorVoice();
    recMode = mode;
    chunks = [];
    fallbackTxt = '';
    recStarted = Date.now();
    playSimTone(mode === 'long' ? 784 : 880, mode === 'long' ? 1319 : 1175, mode === 'long' ? 110 : 65);
    setSimLed(mode === 'long' ? 'long' : 'ptt');
    setOkUi(mode === 'long' ? 'rec-long' : 'rec-ptt', mode === 'long' ? '结束长录' : '松手发送');
    setHwStrip(mode, mode === 'long' ? '长录中 00:00 · 单击「确定」结束' : '录音中 00:00 · 松手发送', true);
    ctx.vm.agentEmit('listening', mode === 'long' ? '长录中' : '松手结束');
    if (ctx.vm.dirty()) paint();

    // Start real browser microphone (16kHz PCM WAV path identical to NOTE4 firmware!)
    if (!navigator.mediaDevices?.getUserMedia) {
      tell('当前浏览器不支持麦克风权限，请使用 localhost 或 HTTPS 打开，或点右侧「打字」模拟');
      resetAll(true);
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
      if (!recMode) { stopMicHardware(); return; } // Released before permission resolved
      const Ctx = window.AudioContext || window.webkitAudioContext;
      ac = new Ctx();
      recRate = ac.sampleRate || 48000;
      srcNode = ac.createMediaStreamSource(stream);
      proc = ac.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = ev => {
        if (!recMode) return;
        const ch = ev.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(ch));
        let sum = 0;
        for (let i = 0; i < ch.length; i += 4) sum += ch[i] * ch[i];
        const rms = Math.sqrt(sum / (ch.length / 4));
        if (rms > peakRms) peakRms = rms;
      };
      srcNode.connect(proc);
      proc.connect(ac.destination);
      meterTimer = setInterval(updateMeter, 75);
      maxTimer = setTimeout(() => { if (recMode) stopMicAndSend(); }, MAX_REC_MS);

      // If user hasn't logged into DSH yet, also run browser SpeechRecognition as zero-cost fallback
      const localCred = readLocalVoiceCred();
      if (!localCred || localCred.kind !== 'dsh_token') {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SR) {
          try {
            fallbackSR = new SR();
            fallbackSR.lang = 'zh-CN';
            fallbackSR.continuous = mode === 'long';
            fallbackSR.interimResults = false;
            fallbackSR.onresult = ev => {
              for (let i = ev.resultIndex; i < ev.results.length; i++) {
                if (ev.results[i].isFinal) fallbackTxt += ev.results[i][0]?.transcript || '';
              }
            };
            fallbackSR.start();
          } catch {}
        }
      }
    } catch (err) {
      tell(err?.name === 'NotAllowedError' ? '浏览器麦克风权限被拒绝，请在地址栏允许麦克风，或点右侧「打字」模拟' : '无法启动麦克风：' + (err?.message || '请检查设备'));
      resetAll(true);
    }
  };

  const stopMicAndSend = async () => {
    if (!recMode) return;
    const durMs = Date.now() - recStarted;
    const savedChunks = chunks;
    const savedRate = recRate;
    const savedFallback = fallbackTxt;
    recMode = null;
    stopMicHardware();
    setOkUi('', '确定');
    playSimTone(1047, 880, 55);

    const ctx = getCtx();
    if (!ctx?.vm) return;
    const label = idleHint(ctx.voiceMode);
    if (durMs < 260 && !savedFallback) {
      setHwStrip('idle', label, false);
      setSimLed('off');
      ctx.vm.agentEmit('idle', '');
      if (ctx.vm.dirty()) paint();
      tell('说话时间太短，请按住「确定」说完再松手');
      return;
    }

    const localCred = readLocalVoiceCred();
    if (!localCred || localCred.kind !== 'dsh_token') {
      if (savedFallback.trim()) {
        await runSimulatorVoiceTurn({utterance: savedFallback.trim(), vm: ctx.vm, work: ctx.work, api, paint, tell, usb, onRevoked, idleLabel: label});
      } else {
        resetAll(true);
        tell('已录制真实麦克风音频；点顶部「登录 DeepSeek」即可使用端侧同款语音识别与人声播报');
      }
      return;
    }

    const wav = encodeWav16k(savedChunks, savedRate);
    if (!wav || wav.byteLength < 1200) {
      resetAll(true);
      tell('未采集到有效声音，请检查电脑麦克风输入');
      return;
    }

    setSimLed('breathe');
    setHwStrip('busy', '正在转写语音（DeepSeek ASR）…', true);
    ctx.vm.agentEmit('uploading', '识别中');
    if (ctx.vm.dirty()) paint();

    try {
      const ctrl = new AbortController();
      activeTurnAbort = ctrl;
      const r = await fetch('/api/ai-cred/asr', {
        method: 'POST',
        headers: {'Content-Type': 'audio/wav', ...voiceCredHeaders()},
        body: wav,
        signal: ctrl.signal,
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 401 || data?.code === 'AI_CRED_REVOKED') {
        clearLocalVoiceCred();
        onRevoked?.();
        resetAll(true);
        tell('DeepSeek 登录态已在官网退出或失效，已自动清除本地登录态，请重新登录');
        return;
      }
      const heard = String(data?.text || '').trim();
      if (!heard) {
        setSimLed('off');
        setHwStrip('idle', label, false);
        ctx.vm.agentEmit('done', '没听清，请再说一次');
        if (ctx.vm.dirty()) paint();
        tell('没有听清语音内容，请凑近麦克风再试一次');
        return;
      }
      await runSimulatorVoiceTurn({utterance: heard, vm: ctx.vm, work: ctx.work, api, paint, tell, usb, onRevoked, idleLabel: label});
    } catch (err) {
      if (err?.name === 'AbortError') return;
      resetAll(true);
      tell('语音转写失败：' + (err?.message || '请稍后重试'));
    }
  };

  return {
    onOkDown(e) {
      const ctx = getCtx();
      const mode = ctx?.voiceMode || 'off';
      if (e?.pointerId != null) { try { e.target?.closest?.('[data-hw-ok]')?.setPointerCapture?.(e.pointerId); } catch {} }
      if (mode === 'off') { downAt = Date.now(); return; }
      // If already in hands-free long-record mode, single press stops & sends immediately!
      if (recMode === 'long') { stopMicAndSend(); downAt = 0; return; }
      downAt = Date.now();
      if (mode === 'ptt' || mode === 'both') {
        setOkUi('arming', '确定');
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
          holdTimer = null;
          clearTimeout(clickTimer); clickTimer = null;
          startMic('ptt');
        }, HOLD_MS);
      }
    },
    onOkUp() {
      if (!downAt) return;
      downAt = 0;
      clearTimeout(holdTimer); holdTimer = null;
      const ctx = getCtx();
      const mode = ctx?.voiceMode || 'off';
      if (recMode === 'ptt') { stopMicAndSend(); return; }
      setOkUi('', '确定');
      if (mode === 'off' || mode === 'ptt') {
        onKeyOk();
        return;
      }
      // Double-click detection for hands-free long-record (mode === 'both' || 'long')
      const now = Date.now();
      if (now - lastTapAt <= DBL_MS) {
        lastTapAt = 0;
        clearTimeout(clickTimer); clickTimer = null;
        startMic('long');
      } else {
        lastTapAt = now;
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => {
          clickTimer = null;
          lastTapAt = 0;
          onKeyOk();
        }, DBL_MS);
      }
    },
    onOkCancel() {
      downAt = 0;
      clearTimeout(holdTimer); holdTimer = null;
      if (recMode === 'ptt') stopMicAndSend();
      else if (!recMode) setOkUi('', '确定');
    },
    cancelVoice() {
      interruptSimulatorVoice();
      resetAll(true);
      tell('已取消本次语音');
    },
    idleHint,
    syncStrip() {
      if (recMode) return;
      const ctx = getCtx();
      if (ctx?.voiceMode && ctx.voiceMode !== 'off') setHwStrip('idle', idleHint(ctx.voiceMode), false);
    },
  };
}
