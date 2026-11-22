import {readJSON} from './http';

const enc = new TextEncoder();
const DSH_PLATFORM = 'https://platform.deepseek.com';
const DSH_CLIENT_HEADERS: Record<string, string> = {
  'User-Agent': 'sy-note4/2.1.0',
  'x-client-bundle-id': '',
  'x-client-platform': 'web',
  'x-client-version': '2.1.0',
  'x-client-locale': 'zh_CN',
  'x-client-timezone-offset': '28800',
};

// Volatile RAM-only one-time device handoff map (NEVER persisted to SQLite/disk; auto-expires <= 180s & self-deletes on first device read!)
type DeviceDrop = {owner: string; payload: any; rev: number; expiresAt: number};
const ramDeviceDrops = new Map<string, DeviceDrop>();

function sweepEphemeral() {
  const t = Date.now();
  for (const [k, v] of ramDeviceDrops) if (v.expiresAt <= t) ramDeviceDrops.delete(k);
}

/** Ensures zero user AI credentials ever remain in server SQLite storage. */
export function purgeLegacyServerAiCred(platform: any) {
  try {
    platform.ctx.storage.sql.exec("DELETE FROM records WHERE type='ai_cred'");
    platform.ctx.storage.sql.exec("DELETE FROM records WHERE type='dsh_pkce'");
  } catch {}
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function maskToken(kind: string, token: string): string {
  if (!token) return '';
  if (token.length <= 10) return '***';
  return (kind === 'api_key' ? token.slice(0, 6) : 'dsh_' + token.slice(0, 4)) + '…' + token.slice(-4);
}

function isPrivateOrLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!h || h === 'localhost' || h === '::1' || h === '::' || h === '0.0.0.0' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^(fc|fd|fe80):/i.test(h)) return true;
  // WHATWG URL normalizes IPv4-mapped IPv6 to ::ffff:XXXX:XXXX hex — unwrap it (and the
  // deprecated ::/96 compatible form) so the IPv4 range table still applies.
  let v4 = h;
  const mapped = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) || h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  const compat = h.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) || h.match(/^::(\d{1,3}(?:\.\d{1,3}){3})$/);
  const embedded = mapped || compat;
  if (embedded) {
    if (embedded.length === 3) {
      const hi = parseInt(embedded[1], 16), lo = parseInt(embedded[2], 16);
      v4 = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    } else {
      v4 = embedded[1];
    }
  }
  const m = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export function sanitizeUserBaseUrl(raw?: string, allowLocalHttp = false): string | null {
  let u: URL;
  try {
    u = new URL(String(raw || 'https://api.deepseek.com').trim());
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  u.search = '';
  u.hash = '';
  if (u.protocol === 'https:') {
    if (!allowLocalHttp && isPrivateOrLocalHost(u.hostname)) return null;
    return u.toString().replace(/\/+$/, '');
  }
  if (allowLocalHttp && u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname)) {
    return u.toString().replace(/\/+$/, '');
  }
  return null;
}

function buildV1(baseUrl: string, sub: string): string {
  const b = String(baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  return (b.endsWith('/v1') ? b : b + '/v1') + sub;
}

async function extFetch(platform: any, url: string, init: RequestInit, userCustomBase = false): Promise<Response> {
  if (userCustomBase && platform.env.DEV_MODE !== 'true' && !platform.env.safeFetch) {
    throw Error('SAFE_FETCH_REQUIRED');
  }
  const fn = userCustomBase && platform.env.DEV_MODE !== 'true'
    ? platform.env.safeFetch
    : (platform.env.modelFetch ?? fetch);
  return fn(url, {...init, signal: init.signal ?? AbortSignal.timeout(15000)});
}

type TokenVerifyResult = {status: 'valid' | 'revoked' | 'unknown'; balance: string | null; reason?: string};

async function verifyDshToken(platform: any, dshToken: string): Promise<TokenVerifyResult> {
  try {
    const res = await extFetch(platform, DSH_PLATFORM + '/api/v0/users/get_user_summary', {
      method: 'GET',
      headers: {...DSH_CLIENT_HEADERS, 'x-dsh-auth-token': dshToken},
    });
    if (res.status === 401 || res.status === 403) {
      return {status: 'revoked', balance: null, reason: 'HTTP_' + res.status};
    }
    const j: any = await res.json().catch(() => null);
    if (!j) return {status: 'unknown', balance: null};
    const code = Number(j?.code ?? 0);
    const bizCode = Number(j?.data?.biz_code ?? 0);
    const msg = String(j?.msg || j?.data?.biz_msg || '');
    if (
      code === 40003 || code === 401 || code === 403 ||
      bizCode === 40003 || bizCode === 401 || bizCode === 403 ||
      /authorization failed|invalid token|invalid dsh|unauthoriz|expired|revoked/i.test(msg)
    ) {
      return {status: 'revoked', balance: null, reason: msg || 'TOKEN_REVOKED'};
    }
    if (!res.ok || code !== 0) return {status: 'unknown', balance: null};
    const d = j?.data?.biz_data ?? j?.data ?? j;
    const wallets = [...(d?.normal_wallets ?? []), ...(d?.bonus_wallets ?? [])];
    if (!wallets.length) return {status: 'valid', balance: null};
    const totals = new Map<string, number>();
    for (const w of wallets) {
      const cur = String(w?.currency ?? 'CNY');
      const v = Number(w?.balance ?? w?.total_balance ?? 0);
      if (Number.isFinite(v)) totals.set(cur, (totals.get(cur) ?? 0) + v);
    }
    return {status: 'valid', balance: [...totals.entries()].map(([cur, sum]) => `${cur} ${sum.toFixed(2)}`).join(' / ')};
  } catch {
    return {status: 'unknown', balance: null};
  }
}

async function verifyApiKey(platform: any, baseUrl: string, apiKey: string): Promise<TokenVerifyResult> {
  try {
    const res = await extFetch(platform, buildV1(baseUrl, '/models'), {
      method: 'GET',
      headers: {Authorization: 'Bearer ' + apiKey, 'User-Agent': 'sy-note4/2.1.0'},
    }, true);
    if (res.status === 401 || res.status === 403) {
      return {status: 'revoked', balance: null, reason: 'HTTP_' + res.status};
    }
    return {status: res.ok ? 'valid' : 'unknown', balance: null};
  } catch {
    return {status: 'unknown', balance: null};
  }
}

async function fetchDshBalance(platform: any, dshToken: string): Promise<string | null> {
  const v = await verifyDshToken(platform, dshToken);
  return v.balance;
}

export function readCallerBrowserCred(r: Request, allowLocalHttp = false) {
  const token = String(r.headers.get('x-n4-ai-token') || '').trim();
  if (!token || token.length < 6 || token.length > 2048 || /[^\x20-\x7e]/.test(token)) return null;
  const kind: 'dsh_token' | 'api_key' = r.headers.get('x-n4-ai-kind') === 'api_key' ? 'api_key' : 'dsh_token';
  // For DSH official login, base_url is strictly locked to https://api.deepseek.com; custom api_key base_url is SSRF-validated!
  const base_url = kind === 'dsh_token'
    ? 'https://api.deepseek.com'
    : sanitizeUserBaseUrl(r.headers.get('x-n4-ai-base') || 'https://api.deepseek.com', allowLocalHttp);
  if (!base_url) return null;
  const model = String(r.headers.get('x-n4-ai-model') || 'deepseek-flash').trim().slice(0, 96) || 'deepseek-flash';
  return {kind, token, base_url, model};
}

export function pendingDeviceAiCredRev(deviceId: string, deviceOwner?: string): number {
  sweepEphemeral();
  if (!deviceOwner) return 0;
  const drop = ramDeviceDrops.get(deviceId);
  return drop && drop.owner === deviceOwner ? drop.rev : 0;
}

/** One-time volatile RAM delivery bound strictly to (deviceId, deviceOwner); immediately wiped on read! */
export async function getDeviceAiCredPayload(_platform: any, deviceOwner: string, deviceId?: string): Promise<any> {
  sweepEphemeral();
  if (!deviceId || !deviceOwner) return {rev: 0, cleared: true};
  const drop = ramDeviceDrops.get(deviceId);
  if (!drop || drop.owner !== deviceOwner) return {rev: 0, cleared: true};
  ramDeviceDrops.delete(deviceId); // Self-destruct immediately on single device read!
  return drop.payload;
}

async function completePkceExchange(platform: any, code: string, state: string): Promise<{uid: string; cred: any}> {
  sweepEphemeral();
  if (!code || !state) throw Object.assign(Error('缺少授权码 code 或 state'), {status: 400});
  const pkce = platform.get('dsh_pkce', state);
  if (!pkce || pkce.expires_at < Date.now()) {
    try { platform.ctx.storage.sql.exec("DELETE FROM records WHERE type='dsh_pkce' AND id=?", state); } catch {}
    throw Object.assign(Error('授权会话已过期，请重新点击发起登录'), {status: 400});
  }
  // Delete single-use PKCE verifier immediately before exchange so it can never be replayed
  platform.ctx.storage.sql.exec("DELETE FROM records WHERE type='dsh_pkce' AND id=?", state);

  const res = await extFetch(platform, DSH_PLATFORM + '/auth-api/v0/dsh/auth_exchange', {
    method: 'POST',
    headers: {...DSH_CLIENT_HEADERS, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      code,
      code_verifier: pkce.code_verifier,
      redirect_uri: pkce.redirect_uri,
      device_id: pkce.device_id,
      device_model: 'sy-note4',
      os_version: 'NOTE4-OS 2.1',
    }),
  });
  const data: any = await res.json().catch(() => ({}));
  const biz = data?.data?.biz_data;
  if (!res.ok || data?.code !== 0 || (data?.data?.biz_code ?? 0) !== 0 || !biz?.token) {
    const msg = data?.data?.biz_msg || data?.msg || ('HTTP ' + res.status);
    throw Object.assign(Error('DeepSeek 授权交换失败：' + String(msg).slice(0, 160)), {status: 400});
  }
  const tok = String(biz.token);
  const balance = await fetchDshBalance(platform, tok);
  const rev = Math.floor(Date.now() / 1000);
  const cred = {
    configured: true,
    storage: 'browser_only',
    kind: 'dsh_token',
    token: tok,
    masked: maskToken('dsh_token', tok),
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    user: biz.user ? {name: biz.user.name || biz.user.email || biz.user.mobile_number || 'DeepSeek 用户', id: biz.user.id} : {name: 'DeepSeek 账号'},
    balance,
    rev,
    verified_at: Date.now(),
    updated_at: Date.now(),
  };
  return {uid: pkce.owner, cred};
}

function parseOAuthCallback(rawInput: unknown, fallbackCode: string, fallbackState: string): {code: string; state: string} {
  const cleaned = String(rawInput ?? '').trim().replace(/^['"`<>]+|['"`<>]+$/g, '').trim();
  if (!cleaned) return {code: fallbackCode, state: fallbackState};
  const hit = cleaned.match(/https?:\/\/[^\s'"`<>]+/i);
  const candidate = hit
    ? hit[0]
    : /^https?/i.test(cleaned)
      ? ''
      : cleaned.includes('?')
        ? 'http://127.0.0.1/' + cleaned.replace(/^\/+/, '')
        : 'http://127.0.0.1/?' + cleaned.replace(/^[/?&]+/, '');
  if (!candidate) {
    throw Object.assign(Error('回调链接格式无效，请粘贴完整的 http://127.0.0.1:54321/oauth/callback?code=... 网址'), {status: 400});
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw Object.assign(Error('回调链接格式无效，请粘贴完整的 http://127.0.0.1:54321/oauth/callback?code=... 网址'), {status: 400});
  }
  return {
    code: (parsed.searchParams.get('code') || fallbackCode).trim(),
    state: (parsed.searchParams.get('state') || fallbackState).trim(),
  };
}

export async function handleAiCredRoute(platform: any, r: Request, uid: string): Promise<Response | null> {
  const u = new URL(r.url);
  if (!u.pathname.startsWith('/api/ai-cred')) return null;
  const sub = u.pathname.slice('/api/ai-cred'.length);
  const method = r.method;
  const devLocal = platform.env.DEV_MODE === 'true';
  sweepEphemeral();

  if (sub === '/models' && method === 'GET') {
    const caller = readCallerBrowserCred(r, devLocal);
    if (!caller) return Response.json({models: ['deepseek-flash'], default_model: 'deepseek-flash', locked_official: true});
    const authHeader: Record<string, string> = caller.kind === 'dsh_token' ? {'x-dsh-auth-token': caller.token} : {Authorization: 'Bearer ' + caller.token};
    let models: string[] = [];
    try {
      const mr = await extFetch(platform, buildV1(caller.base_url, '/models'), {
        method: 'GET',
        headers: {...authHeader, 'User-Agent': 'sy-note4/2.1.0'},
      }, caller.kind === 'api_key');
      if (mr.status === 401 || mr.status === 403) {
        return Response.json(
          {error: 'DeepSeek 登录态已在官网退出或失效，请重新登录', code: 'AI_CRED_REVOKED', revoked: true},
          {status: 401, headers: {'Cache-Control': 'no-store'}}
        );
      }
      if (mr.ok) {
        const j: any = await mr.json();
        models = (j?.data ?? []).map((x: any) => String(x?.id || '').trim()).filter(Boolean);
      }
    } catch {}
    if (!models.includes('deepseek-flash')) models.unshift('deepseek-flash');
    else models = ['deepseek-flash', ...models.filter(m => m !== 'deepseek-flash')];
    return Response.json({
      models: models.slice(0, 20),
      default_model: 'deepseek-flash',
      selected_model: caller.model || 'deepseek-flash',
      locked_official: caller.kind === 'dsh_token',
    }, {headers: {'Cache-Control': 'no-store'}});
  }

  if ((sub === '' || sub === '/status') && method === 'GET') {
    const caller = readCallerBrowserCred(r, devLocal);
    if (!caller) return Response.json({configured: false, revoked: false, storage: 'browser_only', rev: 0});
    let balance: string | null = null;
    if (u.searchParams.get('refresh') === '1') {
      const v = caller.kind === 'dsh_token'
        ? await verifyDshToken(platform, caller.token)
        : await verifyApiKey(platform, caller.base_url, caller.token);
      if (v.status === 'revoked') {
        return Response.json({
          configured: false,
          revoked: true,
          code: 'AI_CRED_REVOKED',
          reason: v.reason || '官网登录态已退出或失效',
          storage: 'browser_only',
          rev: 0,
        }, {headers: {'Cache-Control': 'no-store'}});
      }
      balance = v.balance;
    }
    return Response.json({
      configured: true,
      revoked: false,
      storage: 'browser_only',
      kind: caller.kind,
      masked: maskToken(caller.kind, caller.token),
      base_url: caller.base_url,
      model: caller.model,
      balance,
    }, {headers: {'Cache-Control': 'no-store'}});
  }

  if (sub === '/dsh/init' && method === 'POST') {
    try {
      platform.ctx.storage.sql.exec("DELETE FROM records WHERE type='dsh_pkce' AND json_extract(data,'$.expires_at') < ?", Date.now());
    } catch {}
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
    const state = b64url(crypto.getRandomValues(new Uint8Array(18)));
    const deviceId = crypto.randomUUID();
    const redirectUri = 'http://127.0.0.1:54321/oauth/callback';

    const res = await extFetch(platform, DSH_PLATFORM + '/auth-api/v0/dsh/auth_init', {
      method: 'POST',
      headers: {...DSH_CLIENT_HEADERS, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        redirect_uri: redirectUri,
        locale: 'zh_CN',
        login_source: 'web',
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    const biz = data?.data?.biz_data;
    if (!res.ok || data?.code !== 0 || !biz?.authorize_url) {
      throw Object.assign(Error('发起 DeepSeek 官方授权失败，请稍后重试'), {status: 502});
    }
    platform.put('dsh_pkce', {
      id: state,
      owner: uid,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      device_id: deviceId,
      expires_at: Date.now() + 300000,
    }, state);

    return Response.json({
      state,
      authorize_url: biz.authorize_url,
      redirect_uri: redirectUri,
      expires_in: biz.expires_in ?? 300,
    }, {headers: {'Cache-Control': 'no-store'}});
  }

  if (sub === '/dsh/complete' && method === 'POST') {
    const b: any = await readJSON(r, 16384);
    let code = String(b.code || '').trim();
    let state = String(b.state || '').trim();
    if (b.callback_url) {
      ({code, state} = parseOAuthCallback(b.callback_url, code, state));
    }
    const pkce = platform.get('dsh_pkce', state);
    if (!pkce || pkce.owner !== uid) throw Object.assign(Error('未找到匹配的授权请求，请重新发起授权'), {status: 400});
    const {cred} = await completePkceExchange(platform, code, state);
    return Response.json({ok: true, configured: true, cred}, {headers: {'Cache-Control': 'no-store'}});
  }

  if (sub === '/apikey' && method === 'POST') {
    const b: any = await readJSON(r, 16384);
    const key = String(b.api_key || '').trim();
    const baseUrl = sanitizeUserBaseUrl(b.base_url, devLocal);
    const model = String(b.model || 'deepseek-flash').trim() || 'deepseek-flash';
    if (key.length < 8 || key.length > 2048 || /[^\x20-\x7e]/.test(key) || !baseUrl) {
      throw Object.assign(Error('请填写有效的 API Key 与公网 https:// 接口地址'), {status: 400});
    }
    const mRes = await extFetch(platform, buildV1(baseUrl, '/models'), {
      method: 'GET',
      headers: {Authorization: 'Bearer ' + key, 'User-Agent': 'NOTE4-Studio/2.1.0'},
    }, true);
    if (!mRes.ok) {
      const cRes = await extFetch(platform, buildV1(baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'User-Agent': 'NOTE4-Studio/2.1.0'},
        body: JSON.stringify({model, messages: [{role: 'user', content: 'OK'}], max_tokens: 4}),
      }, true);
      if (!cRes.ok) throw Object.assign(Error(`API Key 连通校验失败（HTTP ${cRes.status}），请检查密钥与地址`), {status: 400});
    }
    const rev = Math.floor(Date.now() / 1000);
    const cred = {
      configured: true,
      storage: 'browser_only',
      kind: 'api_key',
      token: key,
      masked: maskToken('api_key', key),
      base_url: baseUrl,
      model,
      user: null,
      balance: null,
      rev,
      verified_at: Date.now(),
      updated_at: Date.now(),
    };
    return Response.json({ok: true, configured: true, cred}, {headers: {'Cache-Control': 'no-store'}});
  }

  if ((sub === '' || sub === '/logout') && (method === 'DELETE' || method === 'POST')) {
    const caller = readCallerBrowserCred(r, devLocal);
    if (caller?.kind === 'dsh_token' && caller.token) {
      try {
        await extFetch(platform, DSH_PLATFORM + '/auth-api/v0/users/logout', {
          method: 'POST',
          headers: {...DSH_CLIENT_HEADERS, 'x-dsh-auth-token': caller.token},
        });
      } catch {}
    }
    const rev = Math.floor(Date.now() / 1000);
    for (const d of platform.owned('device', uid)) {
      ramDeviceDrops.set(d.id, {owner: uid, rev, payload: {rev, cleared: true}, expiresAt: Date.now() + 180000});
    }
    return Response.json({ok: true, configured: false, rev}, {headers: {'Cache-Control': 'no-store'}});
  }

  if (sub === '/sync-devices' && method === 'POST') {
    const caller = readCallerBrowserCred(r, devLocal);
    if (!caller) throw Object.assign(Error('请先在当前浏览器登录 DeepSeek 账号或填写 API Key'), {status: 400});
    const rev = Math.floor(Date.now() / 1000);
    const ownedDevs = platform.owned('device', uid);
    for (const d of ownedDevs) {
      ramDeviceDrops.set(d.id, {
        owner: uid,
        rev,
        payload: {rev, cleared: false, kind: caller.kind, token: caller.token, base_url: caller.base_url, model: caller.model},
        expiresAt: Date.now() + 180000,
      });
    }
    return Response.json({ok: true, rev, devices: ownedDevs.length, ttl_seconds: 180}, {headers: {'Cache-Control': 'no-store'}});
  }

  if (sub === '/sim-step' && method === 'POST') {
    const caller = readCallerBrowserCred(r, devLocal);
    // Strict multi-user boundary: NEVER fall back to server/admin model_runtime API keys!
    if (!caller) {
      return Response.json({error: '请先在右上角「语音登录」绑定你自己的 DeepSeek 账号（凭证仅存浏览器本地）', code: 'AI_CRED_UNBOUND'}, {status: 401});
    }
    const b: any = await readJSON(r, 65536);
    const authHeader: Record<string, string> = caller.kind === 'dsh_token' ? {'x-dsh-auth-token': caller.token} : {Authorization: 'Bearer ' + caller.token};
    if (b.builtin_tool === 'web_search') {
      if (caller.kind === 'dsh_token') {
        const sr = await extFetch(platform, buildV1(caller.base_url, '/tools/search'), {
          method: 'POST',
          headers: {...authHeader, 'Content-Type': 'application/json'},
          body: JSON.stringify({query: String(b.query || '').slice(0, 120), count: 4, need_content: false}),
        });
        if (sr.status === 401 || sr.status === 403) {
          return Response.json({error: 'DeepSeek 登录态已在官网退出或失效，请重新登录', code: 'AI_CRED_REVOKED', revoked: true}, {status: 401});
        }
        if (sr.ok) return Response.json(await sr.json());
      }
      return Response.json({results: [{title: `检索: ${String(b.query || '')}`, summary: '网页预览检索完成；写入墨水屏后由设备直连 DeepSeek 官方搜索。'}]});
    }
    const chatBody: any = {
      model: caller.model,
      messages: Array.isArray(b.messages) ? b.messages.slice(0, 16) : [],
      max_tokens: 240,
      temperature: 0.35,
    };
    if (Array.isArray(b.tools) && b.tools.length > 0) chatBody.tools = b.tools;
    const isCustom = caller.kind === 'api_key';
    let cr = await extFetch(platform, buildV1(caller.base_url, '/chat/completions'), {
      method: 'POST',
      headers: {...authHeader, 'Content-Type': 'application/json'},
      body: JSON.stringify({...chatBody, thinking: {type: b.thinking ? 'enabled' : 'disabled'}}),
    }, isCustom);
    if (cr.status === 400) {
      cr = await extFetch(platform, buildV1(caller.base_url, '/chat/completions'), {
        method: 'POST',
        headers: {...authHeader, 'Content-Type': 'application/json'},
        body: JSON.stringify(chatBody),
      }, isCustom);
    }
    const cj: any = await cr.json().catch(() => ({}));
    if (cr.status === 401 || cr.status === 403) {
      return Response.json({error: 'DeepSeek 登录态已在官网退出或失效，请重新登录', code: 'AI_CRED_REVOKED', revoked: true}, {status: 401});
    }
    if (!cr.ok) throw Object.assign(Error('模型调用失败：' + String(cj?.error?.message || cr.status).slice(0, 160)), {status: 502});
    return Response.json({message: cj?.choices?.[0]?.message ?? {role: 'assistant', content: ''}}, {headers: {'Cache-Control': 'no-store'}});
  }

  if (sub === '/asr' && method === 'POST') {
    const caller = readCallerBrowserCred(r);
    if (!caller) {
      return Response.json({error: '请先绑定个人 DeepSeek 账号后再使用实时语音识别', code: 'AI_CRED_UNBOUND'}, {status: 401});
    }
    if (caller.kind !== 'dsh_token') {
      return Response.json({error: '端侧同款语音识别需要 DeepSeek 官方账号登录态', code: 'ASR_REQUIRES_DSH'}, {status: 400});
    }
    const raw = new Uint8Array(await r.arrayBuffer());
    if (raw.byteLength < 1024) {
      return Response.json({text: '', empty: true}, {headers: {'Cache-Control': 'no-store'}});
    }
    if (raw.byteLength > 4 * 1024 * 1024) {
      return Response.json({error: '录音文件超出上限，请缩短单次说话时长', code: 'ASR_TOO_LARGE'}, {status: 413, headers: {'Cache-Control': 'no-store'}});
    }
    const boundary = '----N4SimAsrBoundary7e9a';
    const head = enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="chunk.wav"\r\nContent-Type: audio/wav\r\n\r\n`);
    const tail = enc.encode(`\r\n--${boundary}--\r\n`);
    const mp = new Uint8Array(head.length + raw.length + tail.length);
    mp.set(head, 0);
    mp.set(raw, head.length);
    mp.set(tail, head.length + raw.length);
    const ar = await extFetch(platform, buildV1(caller.base_url, '/tools/asr'), {
      method: 'POST',
      headers: {'x-dsh-auth-token': caller.token, 'User-Agent': 'sy-note4/2.1.0', 'Content-Type': `multipart/form-data; boundary=${boundary}`},
      body: mp,
    });
    if (ar.status === 401 || ar.status === 403) {
      return Response.json({error: 'DeepSeek 登录态已在官网退出或失效，请重新登录', code: 'AI_CRED_REVOKED', revoked: true}, {status: 401});
    }
    const aj: any = await ar.json().catch(() => ({}));
    if (!ar.ok) {
      const detail = String(aj?.error?.message || aj?.msg || '').slice(0, 120);
      return Response.json(
        {error: '语音识别服务暂不可用（HTTP ' + ar.status + '）' + (detail ? '：' + detail : ''), status: ar.status, detail},
        {status: ar.status === 429 ? 429 : 502, headers: {'Cache-Control': 'no-store'}}
      );
    }
    return Response.json({text: String(aj?.text || '').trim()}, {headers: {'Cache-Control': 'no-store'}});
  }

  if (sub === '/tts' && method === 'POST') {
    const caller = readCallerBrowserCred(r);
    if (!caller || caller.kind !== 'dsh_token') {
      return Response.json({error: 'TTS requires DSH account', code: 'TTS_REQUIRES_DSH'}, {status: 401});
    }
    const b: any = await readJSON(r, 8192);
    const text = String(b?.text || '').trim().slice(0, 260);
    const voiceId = b?.voice_id === 'tide' ? 'tide' : 'stella';
    if (!text) return new Response(null, {status: 204});
    const tr = await extFetch(platform, buildV1(caller.base_url, '/tools/tts'), {
      method: 'POST',
      headers: {'x-dsh-auth-token': caller.token, 'User-Agent': 'sy-note4/2.1.0', 'Content-Type': 'application/json'},
      body: JSON.stringify({text, voice_id: voiceId, format: 'pcm', filter_markdown: true}),
    });
    if (tr.status === 401 || tr.status === 403) {
      return Response.json({error: 'DeepSeek 登录态已在官网退出或失效，请重新登录', code: 'AI_CRED_REVOKED', revoked: true}, {status: 401});
    }
    if (!tr.ok) return new Response(null, {status: 502});
    const pcm = new Uint8Array(await tr.arrayBuffer());
    if (pcm.byteLength < 64) return new Response(null, {status: 204});
    // Wrap 24kHz mono 16-bit PCM (identical to NOTE4 firmware) in a 44-byte WAV header for instant browser playback
    const wav = new Uint8Array(44 + pcm.byteLength);
    const dv = new DataView(wav.buffer);
    wav.set([82, 73, 70, 70], 0); // RIFF
    dv.setUint32(4, 36 + pcm.byteLength, true);
    wav.set([87, 65, 86, 69, 102, 109, 116, 32], 8); // WAVEfmt
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); // PCM
    dv.setUint16(22, 1, true); // mono
    dv.setUint32(24, 24000, true); // 24kHz
    dv.setUint32(28, 48000, true); // byte rate
    dv.setUint16(32, 2, true); // block align
    dv.setUint16(34, 16, true); // 16-bit
    wav.set([100, 97, 116, 97], 36); // data
    dv.setUint32(40, pcm.byteLength, true);
    wav.set(pcm, 44);
    return new Response(wav, {headers: {'Content-Type': 'audio/wav', 'Cache-Control': 'no-store'}});
  }

  return null;
}
