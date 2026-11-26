import {problem} from './accounts';
import {readJSON} from './http';
import {sanitizeUserBaseUrl} from './dsh-auth';

export const AGENT_LIMITS = {
  context_tokens: 262144,
  max_output_tokens: 32768,
  max_calls: 32,
  max_tools: 50,
  tools_per_reply: 4,
  wall_ms: 300000,
  request_ms: 120000,
  idle_ms: 60000,
  total_tokens: 2097152,
};

type Backend = {
  id: string;
  model: string;
  context_tokens: number;
  max_output_tokens: number;
  enabled?: boolean;
  thinking?: string;
  api_key?: string;
  base_url?: string;
};

export type StreamDelta = {
  content: string;
  toolName: string;
  toolArgBytes: number;
};

export type UserModelRuntime = {
  kind: 'dsh_token' | 'api_key';
  token: string;
  base_url: string;
  model: string;
};

function friendlyModelError(err: any, base: string, isUserRuntime = false): string {
  const msg = String(err?.message ?? err ?? '未知错误');
  const code = err?.cause?.code ?? err?.code ?? '';
  console.error('NOTE4_MODEL_ERR', base, code || '-', msg.replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]').slice(0, 240));
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg) || ['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return '模型服务域名解析失败，请稍后重试或联系管理员检查网络';
  }
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR|IDLE_TIMEOUT/i.test(msg) || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'IDLE_TIMEOUT'].includes(code)) {
    return '连接模型服务超时或被中断，请稍后点「继续修复」重试';
  }
  if (/MODEL_HTTP_401|MODEL_HTTP_403/.test(msg)) {
    return isUserRuntime
      ? 'AI_CRED_REVOKED：你的 DeepSeek 登录态已在官网退出或失效，请重新登录'
      : '模型服务鉴权失败，请联系管理员核对配置';
  }
  if (/MODEL_HTTP_404/.test(msg)) {
    return '模型接口或模型名称不可用，请联系管理员核对配置';
  }
  if (/MODEL_HTTP_429/.test(msg)) {
    return '模型服务当前限流或额度不足，请稍后点「继续修复」重试';
  }
  if (/STREAM_TOO_LARGE/.test(msg) || code === 'STREAM_TOO_LARGE') {
    return '模型返回内容超出安全上限，请精简指令后重试';
  }
  return '模型服务返回异常，请稍后点「继续修复」重试';
}

function extractUsage(usage: any): {total: number; cached: number; known: boolean} {
  if (!usage || typeof usage !== 'object') return {total: 0, cached: 0, known: false};
  const total = Number.isSafeInteger(usage.total_tokens) && usage.total_tokens >= 0
    ? usage.total_tokens
    : Number.isSafeInteger(usage.prompt_tokens) && Number.isSafeInteger(usage.completion_tokens)
      ? usage.prompt_tokens + usage.completion_tokens
      : -1;
  if (total < 0) return {total: 0, cached: 0, known: false};
  const rawCached = Number(
    usage.prompt_tokens_details?.cached_tokens ??
      usage.prompt_cache_hit_tokens ??
      usage.cache_read_input_tokens ??
      0
  );
  const cached = Number.isFinite(rawCached) && rawCached > 0 ? Math.min(total, Math.floor(rawCached)) : 0;
  return {total, cached, known: true};
}

async function consumeSSE(
  response: Response,
  idleMs: number,
  signal: AbortSignal,
  onDelta?: (d: StreamDelta) => void
) {
  if (!response.body) throw Error('STREAM_BODY_MISSING');
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let content = '';
  let finishReason: string | null = null;
  let returnedModel = 'unknown';
  let usage: any = null;
  const toolMap = new Map<number, {id: string; type: 'function'; function: {name: string; arguments: string}}>();
  let toolArgBytes = 0;
  let lastToolName = '';
  let sawDone = false;
  let totalBytes = 0;

  const readWithIdle = async () => {
    let timer: any;
    const onAbort = () => reader.cancel().catch(() => {});
    signal.addEventListener('abort', onAbort, {once: true});
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reader.cancel().catch(() => {});
            reject(Object.assign(Error('STREAM_IDLE_TIMEOUT'), {code: 'IDLE_TIMEOUT'}));
          }, idleMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  };

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || line.startsWith(':')) return;
    if (!line.startsWith('data:')) return;
    const dataStr = line.slice(5).trim();
    if (!dataStr) return;
    if (dataStr === '[DONE]') {
      sawDone = true;
      return;
    }
    let chunk: any;
    try {
      chunk = JSON.parse(dataStr);
    } catch {
      return;
    }
    if (chunk.error) {
      throw Error('MODEL_STREAM_ERROR:' + String(chunk.error?.message ?? chunk.error).slice(0, 200));
    }
    if (chunk.model) returnedModel = String(chunk.model);
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = String(choice.finish_reason);
    const delta = choice.delta ?? choice.message;
    if (!delta) return;
    let changed = false;
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      changed = true;
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = Number.isInteger(tc.index) ? tc.index : tc.id || !toolMap.size ? toolMap.size : toolMap.size - 1;
        let slot = toolMap.get(idx);
        if (!slot) {
          slot = {
            id: tc.id || `call_${idx}_${Date.now().toString(36)}`,
            type: 'function',
            function: {name: '', arguments: ''},
          };
          toolMap.set(idx, slot);
        }
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) {
          slot.function.name += tc.function.name;
          lastToolName = slot.function.name;
          changed = true;
        }
        if (typeof tc.function?.arguments === 'string' && tc.function.arguments) {
          slot.function.arguments += tc.function.arguments;
          toolArgBytes += tc.function.arguments.length;
          changed = true;
        }
      }
    }
    if (changed && onDelta) {
      onDelta({content, toolName: lastToolName, toolArgBytes});
    }
  };

  try {
    for (;;) {
      if (signal.aborted) throw Error('CANCELLED');
      const part = await readWithIdle();
      if (part.done) break;
      totalBytes += part.value.byteLength;
      buf += dec.decode(part.value, {stream: true});
      if (totalBytes > 4 * 1024 * 1024 || buf.length > 262144) {
        throw Object.assign(Error('STREAM_TOO_LARGE'), {code: 'STREAM_TOO_LARGE'});
      }
      let nl = buf.indexOf('\n');
      while (nl !== -1) {
        processLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        nl = buf.indexOf('\n');
      }
    }
    buf += dec.decode();
    if (buf.trim()) {
      for (const l of buf.split('\n')) processLine(l);
    }
  } finally {
    reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  if (!finishReason && !sawDone) {
    throw Object.assign(Error('STREAM_ENDED_EARLY'), {code: 'ECONNRESET'});
  }

  const tool_calls = [...toolMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v)
    .filter(v => v.function.name);

  return {
    model: returnedModel,
    usage,
    choices: [
      {
        finish_reason: finishReason ?? 'stop',
        message: {
          role: 'assistant',
          content,
          ...(tool_calls.length ? {tool_calls} : {}),
        },
      },
    ],
  };
}

export class ModelRouter {
  active = 0;
  queue: Array<any> = [];
  cursor = 0;
  private probing = new Map<string, symbol>();
  private healthEpoch = 0;

  constructor(private s: any) {}

  private maxConcurrent(): number {
    const n = Number(this.s.env.MODEL_MAX_CONCURRENT ?? 4);
    return Number.isFinite(n) && n >= 1 ? Math.min(16, Math.floor(n)) : 4;
  }

  private runtime() {
    return this.s.get('model_runtime', 'default') ?? null;
  }

  baseUrl() {
    return String(this.s.env.MODEL_BASE_URL || this.runtime()?.base_url || '').trim();
  }

  apiKey() {
    return String(this.s.env.MODEL_API_KEY || this.runtime()?.api_key || '').trim();
  }

  private normalizeBackends(raw: any[]): Backend[] {
    const out: Backend[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < raw.length && out.length < 12; i++) {
      const b = raw[i];
      if (!b || typeof b !== 'object' || b.enabled === false) continue;
      const model = String(b.model ?? '').trim();
      if (!model) continue;
      let id = String(b.id ?? ('backend_' + i)).trim() || ('backend_' + i);
      if (seen.has(id)) id = `${id}_${i}`;
      seen.add(id);
      const ctx = Number.isInteger(b.context_tokens) && b.context_tokens >= 8192
        ? Math.min(1048576, b.context_tokens)
        : 131072;
      const maxOut = Number.isInteger(b.max_output_tokens) && b.max_output_tokens >= 256
        ? Math.min(ctx, b.max_output_tokens)
        : Math.min(ctx, 16384);
      out.push({
        id,
        model,
        context_tokens: ctx,
        max_output_tokens: maxOut,
        enabled: true,
        ...(b.thinking === 'disabled' || b.thinking === 'omit' ? {thinking: b.thinking} : {}),
        ...(typeof b.base_url === 'string' && b.base_url.trim() ? {base_url: b.base_url.trim()} : {}),
        ...(typeof b.api_key === 'string' && b.api_key.trim() ? {api_key: b.api_key.trim()} : {}),
      });
    }
    return out;
  }

  backends(): Backend[] {
    const saved = this.s.get('model_config', 'auto')?.backends;
    if (Array.isArray(saved)) return this.normalizeBackends(saved);
    if (this.s.env.MODEL_BACKENDS_JSON) {
      try {
        const parsed = JSON.parse(this.s.env.MODEL_BACKENDS_JSON);
        return Array.isArray(parsed) ? this.normalizeBackends(parsed) : [];
      } catch (e: any) {
        console.error('NOTE4_BACKENDS_JSON_INVALID', String(e?.message ?? e).replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]').slice(0, 160));
        return [];
      }
    }
    const rtModel = this.runtime()?.model;
    const names = (this.s.env.MODEL_CANDIDATES || this.s.env.MODEL_NAME || rtModel || '')
      .split(',')
      .map((x: string) => x.trim())
      .filter((x: string) => x && x !== 'auto');
    return this.normalizeBackends(
      names.map((model: string, i: number) => ({
        id: 'backend_' + i,
        model,
        context_tokens: 131072,
        max_output_tokens: 16384,
      }))
    );
  }

  private backendKey(b: Backend): string {
    return String(b.api_key || this.apiKey() || '').trim();
  }

  private backendBase(b: Backend): string {
    return String(b.base_url || this.baseUrl() || '').trim();
  }

  private normalizeBase(raw: string, forceV1IfMissing: boolean): string {
    const clean = raw.trim().replace(/\/+$/, '');
    if (!clean) return '';
    if (clean.endsWith('/v1') || clean.endsWith('/chat/completions')) return clean;
    if (forceV1IfMissing) return clean + '/v1';
    try {
      if (new URL(clean).pathname === '/') return clean + '/v1';
    } catch {}
    return clean;
  }

  adminTarget(model?: string): {base: string; key: string} {
    const list = this.backends();
    const hit = (model ? list.find(b => b.model === model) : undefined) ?? list[0];
    const rawBase = (hit ? this.backendBase(hit) : '') || this.baseUrl();
    const key = (hit ? this.backendKey(hit) : '') || this.apiKey();
    return {base: this.normalizeBase(rawBase, false), key};
  }

  private routingMode(): 'priority' | 'round_robin' {
    return String(this.s.env.MODEL_ROUTING ?? '').trim().toLowerCase() === 'round_robin' ? 'round_robin' : 'priority';
  }

  configured() {
    return this.backends().some(b => !!(this.backendKey(b) && this.backendBase(b)));
  }

  resetHealth() {
    this.healthEpoch++;
    this.probing.clear();
    this.s.ctx.storage.sql.exec("DELETE FROM records WHERE type IN ('model_health','model_sticky')");
  }

  publicDescribe() {
    const ok = this.configured();
    return {
      configured: ok,
      status: ok ? 'CONFIGURED' : 'UNCONFIGURED',
      limits: AGENT_LIMITS,
    };
  }

  describe() {
    const rt = this.runtime();
    const savedBackends = this.s.get('model_config', 'auto')?.backends;
    const nowMs = Date.now();
    return {
      name: 'auto',
      configured: this.configured(),
      routing: this.routingMode(),
      source: Array.isArray(savedBackends) && savedBackends.length
        ? 'saved_backends'
        : this.s.env.MODEL_BACKENDS_JSON
          ? 'env_backends'
          : this.s.env.MODEL_API_KEY
            ? 'env'
            : rt?.api_key
              ? 'runtime'
              : 'none',
      base_url: this.baseUrl() || null,
      backends: this.backends().map(b => {
        const health = this.s.get('model_health', b.id) ?? null;
        const state = !health || (health.failures ?? 0) <= 0
          ? 'closed'
          : (health.retry_at ?? 0) > nowMs
            ? 'open'
            : 'half_open';
        return {
          id: b.id,
          model: b.model,
          base_url: this.backendBase(b) || null,
          has_api_key: !!b.api_key,
          context_tokens: b.context_tokens,
          max_output_tokens: b.max_output_tokens,
          state,
          health,
        };
      }),
      limits: AGENT_LIMITS,
    };
  }

  async slot(signal?: AbortSignal) {
    if (signal?.aborted) throw Error('CANCELLED');
    if (this.active < this.maxConcurrent()) {
      this.active++;
      return;
    }
    if (this.queue.length >= 64) problem('AI 队列已满，请稍后再试', 429);
    await new Promise<void>((resolve, reject) => {
      const q: any = {resolve, reject};
      q.abort = () => {
        const i = this.queue.indexOf(q);
        if (i >= 0) this.queue.splice(i, 1);
        reject(Error('CANCELLED'));
      };
      q.signal = signal;
      signal?.addEventListener('abort', q.abort, {once: true});
      this.queue.push(q);
    });
  }

  release() {
    const q = this.queue.shift();
    if (q) {
      q.signal?.removeEventListener('abort', q.abort);
      q.resolve();
    } else {
      this.active = Math.max(0, this.active - 1);
    }
  }

  async complete(
    scope: string,
    payload: any,
    signal?: AbortSignal,
    requestMs = AGENT_LIMITS.request_ms,
    onDelta?: (d: StreamDelta) => void,
    userRuntime?: UserModelRuntime
  ) {
    if (!userRuntime && !this.configured()) {
      problem('平台免费公益模型当前未开启，请点击右上角「登录 DeepSeek」使用自己的账号进行对话与制作', 503);
    }
    await this.slot(signal);
    const meter = {known_tokens: 0, cached_tokens: 0, usage_unknown: false, request_attempts: 0};
    try {
      const devMode = this.s.env.DEV_MODE === 'true';
      let userFixedBase = '';
      if (userRuntime) {
        if (userRuntime.kind === 'dsh_token') {
          userFixedBase = 'https://api.deepseek.com/v1';
        } else {
          const safeBase = sanitizeUserBaseUrl(userRuntime.base_url, devMode);
          if (!safeBase) problem('个人模型接口地址无效或不允许访问内网地址', 400);
          userFixedBase = safeBase;
        }
        if (userFixedBase.startsWith('http://') && !devMode) problem('生产环境模型接口必须使用 HTTPS', 400);
        if (userRuntime.kind === 'api_key' && !devMode && !this.s.env.safeFetch) {
          problem('出站安全网关未就绪', 500);
        }
      }
      const userModelName = userRuntime ? (userRuntime.model || 'deepseek-flash') : '';
      const candidates: Backend[] = userRuntime
        ? [{
            id: 'user_self',
            model: userModelName,
            context_tokens: 131072,
            max_output_tokens: 16384,
            thinking: /reasoner|v4-pro/i.test(userModelName) ? 'omit' : 'disabled',
          }]
        : this.backends();
      const roundRobin = !userRuntime && this.routingMode() === 'round_robin';
      const sticky = roundRobin ? this.s.get('model_sticky', scope)?.backend : null;
      const ordered = sticky
        ? [...candidates].sort((a, b) => Number(b.id === sticky) - Number(a.id === sticky))
        : [...candidates];
      if (roundRobin && !sticky && ordered.length) {
        const n = this.cursor++ % ordered.length;
        ordered.push(...ordered.splice(0, n));
      }
      const epoch = this.healthEpoch;
      const MAX_BACKENDS_PER_CALL = 4;
      const MAX_ATTEMPTS_PER_CALL = 8;
      const callDeadline = Date.now() + Math.max(5000, requestMs);
      const errors: Array<{backend: string; error: string}> = [];
      let lastError = '当前没有可用的模型后端，请稍后再试';
      const nowMs = Date.now();
      let toTry = userRuntime
        ? ordered
        : ordered.filter(b => {
            const h = this.s.get('model_health', b.id);
            const fails = h?.failures ?? 0;
            if (fails <= 0) return true; // CLOSED
            if ((h?.retry_at ?? 0) > nowMs) return false; // OPEN (cooling down)
            return !this.probing.has(b.id); // HALF_OPEN: allow single-flight probe only
          });
      if (!userRuntime && !toTry.length && ordered.length) {
        const anyProbing = ordered.some(b => this.probing.has(b.id));
        const soonestRetry = Math.min(
          ...ordered.map(b => this.s.get('model_health', b.id)?.retry_at ?? 0)
        );
        const waitSec = Math.max(1, Math.ceil(Math.max(0, soonestRetry - nowMs) / 1000));
        problem(
          anyProbing
            ? '模型服务正在探测恢复中，请稍候几秒再试'
            : `所有模型后端正在熔断冷却中（约 ${waitSec} 秒后自动探测恢复），请稍后再试`,
          503,
          'MODELS_UNAVAILABLE'
        );
      }
      toTry = toTry.slice(0, MAX_BACKENDS_PER_CALL);

      for (const backend of toTry) {
        if (signal?.aborted) throw Error('CANCELLED');
        const remMs = callDeadline - Date.now();
        if (remMs <= 0 || meter.request_attempts >= MAX_ATTEMPTS_PER_CALL) break;
        const prevHealth = !userRuntime ? this.s.get('model_health', backend.id) : null;
        const isUnhealthy = !userRuntime && (prevHealth?.failures ?? 0) > 0;
        if (isUnhealthy && ((prevHealth?.retry_at ?? 0) > Date.now() || this.probing.has(backend.id))) continue;
        const isHalfOpen = isUnhealthy;
        const base = userRuntime
          ? this.normalizeBase(userFixedBase, true)
          : this.normalizeBase(this.backendBase(backend), false);
        const key = userRuntime ? userRuntime.token : this.backendKey(backend);
        if (!base || !key) {
          lastError = '模型后端缺少接口地址或密钥配置';
          errors.push({backend: backend.id, error: lastError});
          continue;
        }
        const isHttp = base.startsWith('http://');
        if (isHttp && !devMode) {
          if (userRuntime) problem('生产环境模型接口必须使用 HTTPS', 400);
          lastError = '生产环境模型接口必须使用 HTTPS';
          errors.push({backend: backend.id, error: lastError});
          continue;
        }
        const doFetch = isHttp
          ? fetch
          : userRuntime && userRuntime.kind === 'api_key' && !devMode
            ? this.s.env.safeFetch
            : (this.s.env.modelFetch ?? fetch);
        let probeToken: symbol | null = null;
        if (isHalfOpen) {
          probeToken = Symbol(backend.id);
          this.probing.set(backend.id, probeToken);
        }
        const control = new AbortController();
        let timedOut = false;
        const abort = () => control.abort();
        const onTimeout = () => {
          timedOut = true;
          control.abort();
        };
        signal?.addEventListener('abort', abort, {once: true});
        let timer = setTimeout(onTimeout, Math.min(requestMs, remMs));
        try {
          const context = Math.min(AGENT_LIMITS.context_tokens, backend.context_tokens);
          const output = Math.min(
            payload.max_tokens ?? AGENT_LIMITS.max_output_tokens,
            backend.max_output_tokens,
            AGENT_LIMITS.max_output_tokens
          );
          const endpoint = base.endsWith('/chat/completions') ? base : base + '/chat/completions';

          const sendOnce = async (includeStreamOptions: boolean) => {
            const body: any = {
              ...payload,
              model: backend.model,
              max_tokens: output,
              stream: true,
              ...(includeStreamOptions ? {stream_options: {include_usage: true}} : {}),
              ...((backend.thinking ?? this.s.env.MODEL_THINKING) === 'disabled' ? {thinking: {type: 'disabled'}} : {}),
            };
            let res!: Response;
            for (let attempt = 0; attempt < 2; attempt++) {
              if (meter.request_attempts >= MAX_ATTEMPTS_PER_CALL) {
                throw Object.assign(Error('MODEL_ATTEMPT_BUDGET_EXCEEDED'), {code: 'ATTEMPT_BUDGET'});
              }
              try {
                meter.request_attempts++;
                const authHdr: Record<string, string> = userRuntime?.kind === 'dsh_token'
                  ? {'x-dsh-auth-token': key}
                  : {Authorization: 'Bearer ' + key};
                res = await doFetch(endpoint, {
                  method: 'POST',
                  headers: {
                    ...authHdr,
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream, application/json',
                    'User-Agent': 'NOTE4-Platform/2.1.0',
                    Connection: 'close',
                  },
                  body: JSON.stringify(body),
                  signal: control.signal,
                });
                break;
              } catch (e: any) {
                if (e.request_dispatched !== false) meter.usage_unknown = true;
                const code = e.cause?.code ?? e.code;
                if (attempt || control.signal.aborted || !['ECONNRESET', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT'].includes(code)) {
                  throw e;
                }
              }
            }
            return res;
          };

          let response = await sendOnce(true);
          if (response.status === 400) {
            const errBody: any = await readJSON(response, 8192).catch(() => ({}));
            const errMsg = String(errBody.error?.message ?? errBody.message ?? '');
            if (/stream_options/i.test(errMsg)) {
              response = await sendOnce(false);
            } else {
              throw Error('MODEL_HTTP_400:' + errMsg.replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]').slice(0, 240));
            }
          }
          if (!response.ok) {
            const error: any = await readJSON(response, 8192).catch(() => ({}));
            throw Error(
              'MODEL_HTTP_' +
                response.status +
                ':' +
                String(error.error?.message ?? error.message ?? '')
                  .replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]')
                  .slice(0, 240)
            );
          }

          let data: any;
          const ct = String(response.headers.get('content-type') ?? '').toLowerCase();
          try {
            if (ct.includes('text/event-stream')) {
              clearTimeout(timer);
              const streamMaxMs = Math.min(
                AGENT_LIMITS.wall_ms,
                Math.max(requestMs, Math.min(requestMs * 2, 180000))
              );
              timer = setTimeout(onTimeout, streamMaxMs);
              data = await consumeSSE(response, Math.min(AGENT_LIMITS.idle_ms, requestMs), control.signal, onDelta);
            } else {
              data = await readJSON(response, 4 * 1024 * 1024);
            }
          } catch (error) {
            meter.usage_unknown = true;
            throw error;
          }

          const u = extractUsage(data.usage);
          if (u.known) {
            meter.known_tokens += u.total;
            meter.cached_tokens += u.cached;
          } else {
            meter.usage_unknown = true;
            const inBytes = new TextEncoder().encode(JSON.stringify(payload.messages ?? '')).byteLength;
            const outBytes = new TextEncoder().encode(JSON.stringify(data.choices?.[0]?.message ?? '')).byteLength;
            meter.known_tokens += Math.max(1, Math.ceil((inBytes + outBytes) / 3));
          }

          if (!data.choices?.[0]?.message) throw Error('MODEL_MESSAGE_MISSING');
          const finishReason = data.choices[0].finish_reason;
          if (finishReason === 'length') {
            throw Object.assign(Error('MODEL_TRUNCATED'), {
              code: 'MODEL_TRUNCATED',
              nonBackend: true,
              ...meter,
            });
          }
          if (['model_context_window_exceeded', 'network_error'].includes(finishReason)) {
            throw Error('MODEL_INCOMPLETE_' + finishReason);
          }

          if (!userRuntime && this.healthEpoch === epoch) {
            this.s.put('model_health', {id: backend.id, failures: 0, retry_at: 0});
            this.s.put('model_sticky', {id: scope, backend: backend.id});
          }
          return {
            data,
            route: {
              ...meter,
              requested: 'auto',
              backend: backend.id,
              requested_model: backend.model,
              returned_model: data.model ?? 'unknown',
              effective_context: context,
              effective_output: output,
              switches: errors,
            },
          };
        } catch (e: any) {
          if (signal?.aborted) throw Error('CANCELLED');
          const errObj = timedOut ? Object.assign(Error('MODEL_STREAM_TIMEOUT'), {code: 'ETIMEDOUT'}) : e;
          if (errObj?.nonBackend) throw errObj;
          lastError = friendlyModelError(errObj, base, !!userRuntime);
          errors.push({backend: backend.id, error: lastError});
          if (userRuntime && /MODEL_HTTP_401|MODEL_HTTP_403/.test(String(errObj?.message ?? ''))) {
            problem(lastError, 401, 'AI_CRED_REVOKED');
          }
          if (!userRuntime && this.healthEpoch === epoch) {
            const failures = (this.s.get('model_health', backend.id)?.failures ?? 0) + 1;
            const capMs = candidates.length <= 1 ? 15000 : 300000;
            const isConfigAuthErr = /MODEL_HTTP_(401|403|404)/.test(String(errObj?.message ?? ''));
            const backoffMs = isConfigAuthErr ? capMs : Math.min(capMs, 1000 * 2 ** Math.min(failures, 9));
            this.s.put('model_health', {
              id: backend.id,
              failures,
              retry_at: Date.now() + backoffMs,
              last_error: lastError,
            });
          }
        } finally {
          if (probeToken && this.probing.get(backend.id) === probeToken) {
            this.probing.delete(backend.id);
          }
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
        }
      }
      problem('模型调用失败（草稿已保留）：' + lastError, 503, 'MODELS_UNAVAILABLE');
    } catch (error: any) {
      Object.assign(error, meter);
      throw error;
    } finally {
      this.release();
    }
  }
}
