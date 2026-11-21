// Modular Voice Agent & DeepSeek DSH 3-in-1 Auth UI for NOTE4 Studio v2.0

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

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
  const titles = {off: '状态灯：待机熄灭', ptt: '状态灯：短录 60% 常亮', long: '状态灯：长录 100% 满亮', breathe: '状态灯：思考呼吸灯', speaking: '状态灯：语音播报中', err: '状态灯：异常三连闪'};
  el.title = titles[mode] || titles.off;
}

export async function openVoiceCredDialog({api, dialog, tell, usb, onUpdated}) {
  let st = {configured: false, rev: 0};
  try { st = await api('/ai-cred/status?refresh=1'); } catch {}

  const statusHtml = st.configured
    ? `<div class="vcred-badge ok">
        <div><b>已就绪 · ${st.kind === 'dsh_token' ? 'DeepSeek 官方账号（全家桶已通）' : 'API Key 模式'}</b>
        <div class="small" style="margin-top:2px">${esc(st.user?.name ? st.user.name + ' · ' : '')}${esc(st.masked || '')}${st.balance ? ' · 余额 ' + esc(st.balance) : ''}</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn sm soft" id="vcSyncWifi">同步至设备</button>
          ${usb?.opened ? '<button type="button" class="btn sm solid" id="vcSyncUsb">USB 立即写入</button>' : ''}
          <button type="button" class="btn sm" id="vcUnbind">解绑</button>
        </div>
      </div>`
    : `<div class="vcred-badge"><span>尚未绑定端侧语音与模型凭证（绑定后墨水屏可独立离线平台直连 DeepSeek）</span></div>`;

  dialog('端侧语音与 DeepSeek 账号设置', `
    <div id="vcRoot" style="display:flex;flex-direction:column;gap:14px">
      ${statusHtml}
      <div class="vcred-card">
        <b>方式一：DeepSeek 官方账号一键登录（推荐）</b>
        <p class="small" style="margin:4px 0 10px;color:#555">复用 DSH 官方 PKCE 授权，一次登录自动开通语音转文字(ASR)、人声播报(TTS)、联网搜索与 V4.1-Flash 对话。</p>
        <button type="button" class="btn solid" id="vcStartDsh">打开 DeepSeek 官方页扫码 / 登录</button>
        <div id="vcDshStep" hidden style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
          <label class="small" style="font-weight:600">登录点确认后，复制浏览器地址栏跳转的 <code>http://127.0.0.1.../oauth/callback?code=...</code> 粘贴到下方（自动识别）：</label>
          <input id="vcPasteUrl" type="text" placeholder="在此粘贴回调链接，自动完成绑定…" autocomplete="off">
          <div id="vcBridgeRow" style="display:flex;gap:8px;align-items:center">
            <button type="button" class="btn sm soft" id="vcCopyBridge">复制本机一行自动回调命令</button>
            <span class="small" style="color:#666">（电脑装有 Node 时免手动粘贴）</span>
          </div>
        </div>
      </div>
      <details class="vcred-card" ${st.kind === 'api_key' ? 'open' : ''}>
        <summary style="cursor:pointer;font-weight:600">方式二：直接填写 API Key（sk-... 或兼容网关）</summary>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
          <input id="vcApiKey" type="password" placeholder="sk-..." autocomplete="off">
          <div style="display:grid;grid-template-columns:1fr 140px;gap:8px">
            <input id="vcBaseUrl" type="url" value="${esc(st.base_url || 'https://api.deepseek.com')}" placeholder="https://api.deepseek.com">
            <input id="vcModel" type="text" value="${esc(st.model || 'deepseek-flash')}" placeholder="deepseek-flash">
          </div>
          <button type="button" class="btn soft" id="vcSaveKey">验证并保存 API Key</button>
        </div>
      </details>
    </div>
  `);

  let bridgeCmd = '', pollTimer = null;
  const finish = async msg => {
    if (pollTimer) clearInterval(pollTimer);
    tell(msg);
    await onUpdated?.();
    openVoiceCredDialog({api, dialog, tell, usb, onUpdated});
  };

  const onMsg = e => { if (e.data?.type === 'note4_dsh_ok') { window.removeEventListener('message', onMsg); finish('DeepSeek 账号授权成功！'); } };
  window.addEventListener('message', onMsg);

  document.getElementById('vcStartDsh')?.addEventListener('click', async e => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = '正在请求官方授权链接…';
    try {
      const r = await api('/ai-cred/dsh/init', 'POST', {});
      bridgeCmd = r.bridge_cmd || '';
      window.open(r.authorize_url, '_blank', 'noopener');
      btn.textContent = '已打开官方登录页（可重新打开）'; btn.disabled = false;
      if (!r.is_local) {
        const box = document.getElementById('vcDshStep');
        if (box) box.hidden = false;
        document.getElementById('vcPasteUrl')?.focus();
        // Poll status lightly in case user ran the 1-line local bridge command
        pollTimer = setInterval(async () => {
          const cur = await api('/ai-cred/status').catch(() => null);
          if (cur?.configured && cur.rev > (st.rev || 0)) finish('已通过本机桥接完成 DeepSeek 授权！');
        }, 2500);
      }
    } catch (err) {
      btn.disabled = false; btn.textContent = '打开 DeepSeek 官方页扫码 / 登录';
      tell(err.message || '发起授权失败');
    }
  });

  const submitPaste = async val => {
    if (!val || !val.includes('code=')) return;
    try {
      await api('/ai-cred/dsh/complete', 'POST', {callback_url: val});
      await finish('DeepSeek 账号绑定成功！');
    } catch (err) { tell(err.message || '回调解析失败'); }
  };
  const pasteInput = document.getElementById('vcPasteUrl');
  pasteInput?.addEventListener('paste', e => { setTimeout(() => submitPaste(pasteInput.value.trim()), 20); });
  pasteInput?.addEventListener('change', () => submitPaste(pasteInput.value.trim()));

  document.getElementById('vcCopyBridge')?.addEventListener('click', async () => {
    if (!bridgeCmd) return;
    await navigator.clipboard.writeText(bridgeCmd);
    tell('已复制本机自动桥接命令，在终端粘贴运行即可自动完成回调');
  });

  document.getElementById('vcSaveKey')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    const api_key = document.getElementById('vcApiKey')?.value.trim() || '';
    const base_url = document.getElementById('vcBaseUrl')?.value.trim() || 'https://api.deepseek.com';
    const model = document.getElementById('vcModel')?.value.trim() || 'deepseek-flash';
    btn.disabled = true; btn.textContent = '正在校验连通性…';
    try {
      await api('/ai-cred/apikey', 'POST', {api_key, base_url, model});
      await finish('API Key 验证通过并已加密保存！');
    } catch (err) {
      btn.disabled = false; btn.textContent = '验证并保存 API Key';
      tell(err.message || '校验失败');
    }
  });

  document.getElementById('vcUnbind')?.addEventListener('click', async () => {
    await api('/ai-cred', 'DELETE');
    await finish('已解绑凭证，设备下次同步将自动清除');
  });

  document.getElementById('vcSyncWifi')?.addEventListener('click', async () => {
    const r = await api('/ai-cred/sync-devices', 'POST', {});
    tell(`已标记同步（版本 #${r.rev}），墨水屏下次联网将自动拉取`);
  });

  document.getElementById('vcSyncUsb')?.addEventListener('click', async () => {
    try {
      const p = await api('/ai-cred/usb-payload', 'POST', {});
      await usb.command({op: 'set_ai_cred', ...p}, 'set_ai_cred');
      tell('已通过 USB 数据线直写墨水屏 NVS 安全分区！');
    } catch (err) { tell(err.message || 'USB 写入失败'); }
  });
}

const simHist = [];
export async function runSimulatorVoiceTurn({utterance, vm, work, api, paint, tell, usb}) {
  const text = String(utterance || '').trim();
  if (!text || !vm) return;
  if (usb?.opened) {
    usb.command({op: 'voice_sim', text}, 'voice_sim').catch(() => {});
  }
  const ag = vm.agent();
  if (!ag.configured) {
    tell('当前应用尚未调用 agent.config(...) 注册端侧语音工具');
    return;
  }
  playSimTone(880, 1175, 65);
  setSimLed('breathe');
  vm.agentEmit('thinking', '思考中…');
  if (vm.dirty()) paint();

  const vcfg = work?.spec?.js?.voice || {tts: 'stella', search: true, thinking: false};
  const stateJson = vm.agentState().json || '{}';
  const sysPrompt = '你是运行在NOTE4墨水屏上的端侧语音管家。收到用户语音指令后，优先调用工具完成增删改查或联网查询，最后用一句45字以内的自然纯文本口语汇报结果（严禁Markdown符号、列表、Emoji或套话）。应用职责：' + ag.role;
  const msgs = [{role: 'system', content: sysPrompt}, ...simHist.slice(-6), {role: 'user', content: `[看板状态]: ${stateJson}\n[用户语音]: ${text}`}];
  const tools = [...ag.tools];
  if (vcfg.search !== false) {
    tools.push({type: 'function', function: {name: 'web_search', description: '联网搜索实时资讯天气百科', parameters: {type: 'object', properties: {query: {type: 'string'}}, required: ['query']}}});
  }

  let finalReply = '';
  try {
    for (let step = 0; step < 4; step++) {
      const r = await api('/ai-cred/sim-step', 'POST', {messages: msgs, tools, thinking: !!vcfg.thinking});
      const m = r.message || {};
      const tcs = Array.isArray(m.tool_calls) ? m.tool_calls : [];
      if (!tcs.length) { finalReply = String(m.content || '').trim(); break; }
      msgs.push({role: 'assistant', content: m.content || '', ...(m.reasoning_content ? {reasoning_content: m.reasoning_content} : {}), tool_calls: tcs});
      for (const tc of tcs.slice(0, 4)) {
        const nm = tc.function?.name || '', aj = tc.function?.arguments || '{}';
        let out = '{}';
        if (nm === 'web_search') {
          let q = ''; try { q = JSON.parse(aj).query || ''; } catch {}
          const sr = await api('/ai-cred/sim-step', 'POST', {builtin_tool: 'web_search', query: q});
          out = JSON.stringify(sr).slice(0, 2048);
        } else {
          out = vm.agentCall(nm, aj).json;
          if (vm.dirty()) paint();
        }
        msgs.push({role: 'tool', tool_call_id: tc.id || 'call_0', content: out});
      }
    }
    if (!finalReply) finalReply = '已为你更新看板。';
    simHist.push({role: 'user', content: text}, {role: 'assistant', content: finalReply});
    if (simHist.length > 6) simHist.splice(0, simHist.length - 6);
    vm.agentEmit('done', finalReply);
    if (vm.dirty()) paint();
    setSimLed('speaking');
    playSimTone(1047, 1319, 85);
    if (vcfg.tts !== 'off' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(finalReply);
        u.lang = 'zh-CN'; u.rate = 1.08;
        u.onend = () => setSimLed('off');
        window.speechSynthesis.speak(u);
      } catch { setTimeout(() => setSimLed('off'), 800); }
    } else {
      setTimeout(() => setSimLed('off'), 600);
    }
    tell('语音管家：' + finalReply);
  } catch (err) {
    setSimLed('err');
    vm.agentEmit('error', '语音调用失败');
    if (vm.dirty()) paint();
    setTimeout(() => setSimLed('off'), 900);
    tell(err.message || '模拟语音执行失败');
  }
}
