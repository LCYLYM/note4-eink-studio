import {readJSON} from './http';

const enc = new TextEncoder();
const dec = new TextDecoder();
const DSH_PLATFORM = 'https://platform.deepseek.com';

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveSealKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('note4-ai-cred-v1:' + (secret || 'dev-local-seal')));
  return crypto.subtle.importKey('raw', raw, {name: 'AES-GCM'}, false, ['encrypt', 'decrypt']);
}

export async function sealSecret(secretKey: string, plaintext: string): Promise<string> {
  const key = await deriveSealKey(secretKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, enc.encode(plaintext)));
  return btoa(String.fromCharCode(...iv)) + '.' + btoa(String.fromCharCode(...ct));
}

export async function unsealSecret(secretKey: string, sealed: string): Promise<string> {
  const [ivB64, ctB64] = String(sealed || '').split('.');
  if (!ivB64 || !ctB64) throw Error('Invalid sealed credential');
  const key = await deriveSealKey(secretKey);
  const pt = await crypto.subtle.decrypt({name: 'AES-GCM', iv: fromB64(ivB64)}, key, fromB64(ctB64));
  return dec.decode(pt);
}

function maskToken(kind: string, token: string): string {
  if (!token) return '';
  if (token.length <= 10) return '***';
  return (kind === 'api_key' ? token.slice(0, 6) : 'dsh_' + token.slice(0, 4)) + '…' + token.slice(-4);
}

function normBaseUrl(u?: string): string {
  const s = String(u || 'https://api.deepseek.com').trim().replace(/\/+$/, '');
  return s || 'https://api.deepseek.com';
}
function buildV1(baseUrl: string, sub: string): string {
  const b = normBaseUrl(baseUrl);
  return (b.endsWith('/v1') ? b : b + '/v1') + sub;
}

async function extFetch(platform: any, url: string, init: RequestInit): Promise<Response> {
  const fn = platform.env.modelFetch ?? fetch;
  return fn(url, {...init, signal: init.signal ?? AbortSignal.timeout(15000)});
}

async function fetchDshBalance(platform: any, dshToken: string): Promise<string | null> {
  try {
    const res = await extFetch(platform, DSH_PLATFORM + '/api/v0/users/get_user_summary', {
      method: 'GET',
      headers: {'x-dsh-auth-token': dshToken, 'User-Agent': 'NOTE4-Studio/2.0.0'},
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    const d = j?.data?.biz_data ?? j?.data ?? j;
    const wallets = [...(d?.normal_wallets ?? []), ...(d?.bonus_wallets ?? [])];
    if (!wallets.length) return null;
    return wallets.map((w: any) => `${w.currency ?? 'CNY'} ${w.balance ?? w.total_balance ?? '0.00'}`).join(' / ');
  } catch {
    return null;
  }
}

function bumpUserDevicesCredRev(platform: any, uid: string, rev: number) {
  for (const d of platform.owned('device', uid)) {
    d.ai_cred_rev = rev;
    platform.put('device', d);
  }
}

export async function getDeviceAiCredPayload(platform: any, deviceOwner: string): Promise<any> {
  const rec = platform.get('ai_cred', deviceOwner);
  if (!rec) return {rev: 0, cleared: true};
  if (rec.cleared || !rec.sealed) return {rev: rec.rev ?? 1, cleared: true};
  const token = await unsealSecret(platform.env.APP_SEAL_KEY || '', rec.sealed);
  return {
    rev: rec.rev ?? 1,
    cleared: false,
    kind: rec.kind,
    token,
    base_url: rec.base_url || 'https://api.deepseek.com',
    model: rec.model || 'deepseek-flash',
  };
}

async function completePkceExchange(platform: any, code: string, state: string): Promise<any> {
  if (!code || !state) throw Object.assign(Error('缺少授权码 code 或 state'), {status: 400});
  const pkce = platform.get('dsh_pkce', state);
  if (!pkce || pkce.expires_at < Date.now()) throw Object.assign(Error('授权会话已过期，请重新点击发起登录'), {status: 400});

  const res = await extFetch(platform, DSH_PLATFORM + '/auth-api/v0/dsh/auth_exchange', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'User-Agent': 'NOTE4-Studio/2.0.0'},
    body: JSON.stringify({
      code,
      code_verifier: pkce.code_verifier,
      redirect_uri: pkce.redirect_uri,
      device_id: pkce.device_id,
      device_model: 'NOTE4-EInk-Studio',
      os_version: 'NOTE4-v2.0',
    }),
  });
  const data: any = await res.json().catch(() => ({}));
  const biz = data?.data?.biz_data;
  if (!res.ok || data?.code !== 0 || (data?.data?.biz_code ?? 0) !== 0 || !biz?.token) {
    const msg = data?.data?.biz_msg || data?.msg || ('HTTP ' + res.status);
    throw Object.assign(Error('DeepSeek 授权交换失败：' + String(msg).slice(0, 160)), {status: 400});
  }
  const uid = pkce.owner;
  const prior = platform.get('ai_cred', uid);
  const rev = (prior?.rev ?? 0) + 1;
  const sealed = await sealSecret(platform.env.APP_SEAL_KEY || '', String(biz.token));
  const rec = {
    id: uid,
    owner: uid,
    kind: 'dsh_token',
    sealed,
    masked: maskToken('dsh_token', String(biz.token)),
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    user: biz.user ? {name: biz.user.name || biz.user.email || biz.user.mobile_number || 'DeepSeek 用户', id: biz.user.id} : {name: 'DeepSeek 账号'},
    cleared: false,
    rev,
    updated_at: Date.now(),
  };
  platform.ctx.storage.transactionSync(() => {
    platform.put('ai_cred', rec, uid);
    platform.ctx.storage.sql.exec("DELETE FROM records WHERE type='dsh_pkce' AND id=?", state);
  });
  bumpUserDevicesCredRev(platform, uid, rev);
  const balance = await fetchDshBalance(platform, String(biz.token));
  return {ok: true, configured: true, kind: rec.kind, masked: rec.masked, user: rec.user, balance, rev};
}

export async function handlePublicOAuthRoute(platform: any, r: Request): Promise<Response | null> {
  const u = new URL(r.url);
  if (u.pathname === '/oauth/callback' && r.method === 'GET') {
    const code = u.searchParams.get('code') || '';
    const state = u.searchParams.get('state') || '';
    try {
      await completePkceExchange(platform, code, state);
      return new Response(
        '<!doctype html><meta charset=utf-8><title>授权成功</title><body style="font:16px system-ui;padding:40px;text-align:center"><h2>DeepSeek 账号授权成功</h2><p>已同步至 NOTE4 创作台，此窗口将自动关闭。</p><script>try{window.opener?.postMessage({type:"note4_dsh_ok"},"*");setTimeout(()=>window.close(),800);}catch{}</script>',
        {headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}}
      );
    } catch (e: any) {
      return new Response(
        `<!doctype html><meta charset=utf-8><title>授权失败</title><body style="font:16px system-ui;padding:40px;text-align:center"><h2>授权未完成</h2><p>${String(e.message || '请返回重试').replace(/[<>&]/g, '')}</p>`,
        {status: 400, headers: {'Content-Type': 'text/html; charset=utf-8'}}
      );
    }
  }
  if (u.pathname === '/api/ai-cred/dsh/bridge-complete' && r.method === 'POST') {
    const b: any = await readJSON(r, 16384);
    const pkce = platform.get('dsh_pkce', String(b.state || ''));
    if (!pkce || !b.bridge_token || pkce.bridge_token !== b.bridge_token) {
      return Response.json({error: 'Invalid bridge token'}, {status: 403, headers: {'Access-Control-Allow-Origin': '*'}});
    }
    const out = await completePkceExchange(platform, String(b.code || ''), String(b.state || ''));
    return Response.json(out, {headers: {'Access-Control-Allow-Origin': '*'}});
  }
  if (u.pathname === '/api/ai-cred/dsh/bridge-complete' && r.method === 'OPTIONS') {
    return new Response(null, {status: 204, headers: {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'}});
  }
  return null;
}

export async function handleAiCredRoute(platform: any, r: Request, uid: string): Promise<Response | null> {
  const u = new URL(r.url);
  if (!u.pathname.startsWith('/api/ai-cred')) return null;
  const sub = u.pathname.slice('/api/ai-cred'.length);
  const method = r.method;

  if ((sub === '' || sub === '/status') && method === 'GET') {
    const rec = platform.get('ai_cred', uid);
    if (!rec || rec.cleared || !rec.sealed) return Response.json({configured: false, rev: rec?.rev ?? 0});
    let balance: string | null = null;
    if (rec.kind === 'dsh_token' && u.searchParams.get('refresh') === '1') {
      try {
        const tok = await unsealSecret(platform.env.APP_SEAL_KEY || '', rec.sealed);
        balance = await fetchDshBalance(platform, tok);
      } catch {}
    }
    return Response.json({
      configured: true,
      kind: rec.kind,
      masked: rec.masked,
      base_url: rec.base_url,
      model: rec.model,
      user: rec.user ?? null,
      balance,
      rev: rec.rev ?? 1,
      updated_at: rec.updated_at,
    });
  }

  if (sub === '/dsh/init' && method === 'POST') {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
    const state = b64url(crypto.getRandomValues(new Uint8Array(18)));
    const bridgeToken = b64url(crypto.getRandomValues(new Uint8Array(24)));
    const deviceId = 'note4_' + b64url(crypto.getRandomValues(new Uint8Array(12)));
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    const cbPort = isLocal ? (u.port || '8787') : '54321';
    const redirectUri = `http://127.0.0.1:${cbPort}/oauth/callback`;

    const res = await extFetch(platform, DSH_PLATFORM + '/auth-api/v0/dsh/auth_init', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'User-Agent': 'NOTE4-Studio/2.0.0'},
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
      bridge_token: bridgeToken,
      expires_at: Date.now() + 600000,
    }, state);

    const completeEndpoint = `${u.origin}/api/ai-cred/dsh/bridge-complete`;
    const bridgeCmd = isLocal
      ? ''
      : `node -e 'const h=require("http"),s=h.createServer(async(q,r)=>{const u=new URL(q.url,"http://127.0.0.1:54321");if(u.pathname!=="/oauth/callback"){r.end();return;}const x=await fetch(${JSON.stringify(completeEndpoint)},{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code:u.searchParams.get("code"),state:u.searchParams.get("state"),bridge_token:${JSON.stringify(bridgeToken)}})});r.setHeader("content-type","text/html;charset=utf-8");r.end(x.ok?"<h2>NOTE4 授权已完成，可关闭此页</h2>":"<h2>授权失败</h2>");s.close();}).listen(54321,"127.0.0.1",()=>console.log("请在浏览器完成登录:",${JSON.stringify(biz.authorize_url)}))'`;

    return Response.json({
      state,
      authorize_url: biz.authorize_url,
      redirect_uri: redirectUri,
      is_local: isLocal,
      bridge_cmd: bridgeCmd,
      expires_in: biz.expires_in ?? 600,
    });
  }

  if (sub === '/dsh/complete' && method === 'POST') {
    const b: any = await readJSON(r, 16384);
    let code = String(b.code || '').trim();
    let state = String(b.state || '').trim();
    if (b.callback_url) {
      const raw = String(b.callback_url).trim();
      const parsed = new URL(raw.startsWith('http') ? raw : 'http://127.0.0.1/' + raw.replace(/^\/+/, ''));
      code = parsed.searchParams.get('code') || code;
      state = parsed.searchParams.get('state') || state;
    }
    const pkce = platform.get('dsh_pkce', state);
    if (!pkce || pkce.owner !== uid) throw Object.assign(Error('未找到匹配的授权请求，请重新发起授权'), {status: 400});
    return Response.json(await completePkceExchange(platform, code, state));
  }

  if (sub === '/apikey' && method === 'POST') {
    const b: any = await readJSON(r, 16384);
    const key = String(b.api_key || '').trim();
    const baseUrl = normBaseUrl(b.base_url);
    const model = String(b.model || 'deepseek-flash').trim() || 'deepseek-flash';
    if (key.length < 8 || key.length > 512 || !baseUrl.startsWith('https://')) {
      throw Object.assign(Error('请填写有效的 API Key 与 https:// 接口地址'), {status: 400});
    }
    const mRes = await extFetch(platform, buildV1(baseUrl, '/models'), {
      method: 'GET',
      headers: {Authorization: 'Bearer ' + key, 'User-Agent': 'NOTE4-Studio/2.0.0'},
    });
    if (!mRes.ok) {
      const cRes = await extFetch(platform, buildV1(baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'User-Agent': 'NOTE4-Studio/2.0.0'},
        body: JSON.stringify({model, messages: [{role: 'user', content: 'OK'}], max_tokens: 4}),
      });
      if (!cRes.ok) throw Object.assign(Error(`API Key 连通校验失败（HTTP ${cRes.status}），请检查密钥与地址`), {status: 400});
    }
    const prior = platform.get('ai_cred', uid);
    const rev = (prior?.rev ?? 0) + 1;
    const sealed = await sealSecret(platform.env.APP_SEAL_KEY || '', key);
    const rec = {
      id: uid,
      owner: uid,
      kind: 'api_key',
      sealed,
      masked: maskToken('api_key', key),
      base_url: baseUrl,
      model,
      user: null,
      cleared: false,
      rev,
      updated_at: Date.now(),
    };
    platform.put('ai_cred', rec, uid);
    bumpUserDevicesCredRev(platform, uid, rev);
    return Response.json({ok: true, configured: true, kind: rec.kind, masked: rec.masked, base_url: baseUrl, model, rev});
  }

  if (sub === '' && method === 'DELETE') {
    const prior = platform.get('ai_cred', uid);
    if (prior?.kind === 'dsh_token' && prior?.sealed && !prior?.cleared) {
      try {
        const tok = await unsealSecret(platform.env.APP_SEAL_KEY || '', prior.sealed);
        await extFetch(platform, DSH_PLATFORM + '/auth-api/v0/users/logout', {
          method: 'POST',
          headers: {'x-dsh-auth-token': tok, 'Content-Type': 'application/json'},
          body: '{}',
        });
      } catch {}
    }
    const rev = (prior?.rev ?? 0) + 1;
    platform.put('ai_cred', {id: uid, owner: uid, cleared: true, rev, updated_at: Date.now()}, uid);
    bumpUserDevicesCredRev(platform, uid, rev);
    return Response.json({ok: true, configured: false, rev});
  }

  if (sub === '/usb-payload' && method === 'POST') {
    const p = await getDeviceAiCredPayload(platform, uid);
    return Response.json(p.cleared ? {clear: true, rev: p.rev} : p);
  }

  if (sub === '/sync-devices' && method === 'POST') {
    const rec = platform.get('ai_cred', uid);
    const rev = (rec?.rev ?? 0) + 1;
    if (rec) { rec.rev = rev; platform.put('ai_cred', rec, uid); }
    bumpUserDevicesCredRev(platform, uid, rev);
    return Response.json({ok: true, rev, devices: platform.owned('device', uid).length});
  }

  if (sub === '/sim-step' && method === 'POST') {
    const b: any = await readJSON(r, 65536);
    const p = await getDeviceAiCredPayload(platform, uid);
    let authHeader: Record<string, string>;
    let baseUrl = 'https://api.deepseek.com';
    let model = 'deepseek-flash';
    if (!p.cleared && p.token) {
      baseUrl = p.base_url;
      model = p.model;
      authHeader = p.kind === 'dsh_token' ? {'x-dsh-auth-token': p.token} : {Authorization: 'Bearer ' + p.token};
    } else if (platform.router?.configured()) {
      baseUrl = platform.router.baseUrl();
      model = platform.router.primaryModel?.() || 'deepseek-flash';
      authHeader = {Authorization: 'Bearer ' + platform.router.apiKey()};
    } else {
      throw Object.assign(Error('请先点击右上角「语音与DeepSeek设置」绑定账号或 API Key'), {status: 400});
    }
    if (b.builtin_tool === 'web_search') {
      if (!p.cleared && p.kind === 'dsh_token') {
        const sr = await extFetch(platform, buildV1(baseUrl, '/tools/search'), {
          method: 'POST',
          headers: {...authHeader, 'Content-Type': 'application/json'},
          body: JSON.stringify({query: String(b.query || '').slice(0, 120), count: 4, need_content: false}),
        });
        if (sr.ok) return Response.json(await sr.json());
      }
      return Response.json({results: [{title: `实时检索: ${String(b.query || '')}`, summary: '网页预览沙箱检索结果就绪，写入真机绑定 DeepSeek 账号后将调用官方实时搜索。'}]});
    }
    const chatBody: any = {
      model,
      messages: Array.isArray(b.messages) ? b.messages.slice(0, 16) : [],
      max_tokens: 640,
      temperature: 0.2,
    };
    if (Array.isArray(b.tools) && b.tools.length > 0) chatBody.tools = b.tools;
    let cr = await extFetch(platform, buildV1(baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {...authHeader, 'Content-Type': 'application/json'},
      body: JSON.stringify({...chatBody, thinking: {type: b.thinking ? 'enabled' : 'disabled'}}),
    });
    if (cr.status === 400) {
      cr = await extFetch(platform, buildV1(baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: {...authHeader, 'Content-Type': 'application/json'},
        body: JSON.stringify(chatBody),
      });
    }
    const cj: any = await cr.json().catch(() => ({}));
    if (!cr.ok) throw Object.assign(Error('模型调用失败：' + String(cj?.error?.message || cr.status).slice(0, 160)), {status: 502});
    return Response.json({message: cj?.choices?.[0]?.message ?? {role: 'assistant', content: ''}});
  }

  return null;
}
