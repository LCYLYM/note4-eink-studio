import {problem} from './accounts';
import {readJSON} from './http';

export const AGENT_LIMITS = {
  context_tokens: 262144,
  max_output_tokens: 32768,
  max_calls: 32,
  max_tools: 50,
  tools_per_reply: 4,
  wall_ms: 300000,
  request_ms: 90000,
  total_tokens: 2097152,
};

type Backend = {
  id: string;
  model: string;
  context_tokens: number;
  max_output_tokens: number;
  enabled?: boolean;
  thinking?: string;
};

function friendlyModelError(err: any, base: string): string {
  const msg = String(err?.message ?? err ?? '未知错误');
  const code = err?.cause?.code ?? err?.code ?? '';
  console.error('NOTE4_MODEL_ERR', base, code || '-', msg.replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]').slice(0, 240));
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg) || ['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return '模型服务域名解析失败，请稍后重试或联系管理员检查网络';
  }
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR/i.test(msg) || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(code)) {
    return '连接模型服务超时或被拒绝，请稍后点「继续修复」重试';
  }
  if (/MODEL_HTTP_401|MODEL_HTTP_403/.test(msg)) {
    return '模型服务鉴权失败，请联系管理员核对配置';
  }
  if (/MODEL_HTTP_404/.test(msg)) {
    return '模型接口或模型名称不可用，请联系管理员核对配置';
  }
  if (/MODEL_HTTP_429/.test(msg)) {
    return '模型服务当前限流或额度不足，请稍后点「继续修复」重试';
  }
  return '模型服务返回异常，请稍后点「继续修复」重试';
}

export class ModelRouter {
  active = 0;
  queue: Array<any> = [];
  cursor = 0;

  constructor(private s: any) {}

  private runtime() {
    return this.s.get('model_runtime', 'default') ?? null;
  }

  baseUrl() {
    return String(this.s.env.MODEL_BASE_URL || this.runtime()?.base_url || '').trim();
  }

  apiKey() {
    return String(this.s.env.MODEL_API_KEY || this.runtime()?.api_key || '').trim();
  }

  backends(): Backend[] {
    const saved = this.s.get('model_config', 'auto')?.backends;
    if (saved) return saved.filter((b: Backend) => b.enabled !== false);
    if (this.s.env.MODEL_BACKENDS_JSON) {
      return JSON.parse(this.s.env.MODEL_BACKENDS_JSON).filter((b: Backend) => b.enabled !== false);
    }
    const rtModel = this.runtime()?.model;
    const names = (this.s.env.MODEL_CANDIDATES || this.s.env.MODEL_NAME || rtModel || '')
      .split(',')
      .map((x: string) => x.trim())
      .filter((x: string) => x && x !== 'auto');
    return names.map((model: string, i: number) => ({
      id: 'backend_' + i,
      model,
      context_tokens: 131072,
      max_output_tokens: 8192,
    }));
  }

  configured() {
    return !!(this.apiKey() && this.baseUrl() && this.backends().length);
  }

  resetHealth() {
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
    return {
      name: 'auto',
      configured: this.configured(),
      source: this.s.env.MODEL_API_KEY ? 'env' : rt?.api_key ? 'runtime' : 'none',
      base_url: this.baseUrl() || null,
      backends: this.backends().map(b => ({
        id: b.id,
        model: b.model,
        context_tokens: b.context_tokens,
        max_output_tokens: b.max_output_tokens,
        health: this.s.get('model_health', b.id) ?? null,
      })),
      limits: AGENT_LIMITS,
    };
  }

  async slot(signal?: AbortSignal) {
    if (signal?.aborted) throw Error('CANCELLED');
    if (this.active === 0) {
      this.active = 1;
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
      this.active = 0;
    }
  }

  async complete(scope: string, payload: any, signal?: AbortSignal, requestMs = 90000) {
    if (!this.configured()) problem('AI 模型尚未配置，请点击右上角「配置 AI 模型」填入地址与 Key', 503);
    await this.slot(signal);
    const meter = {known_tokens: 0, usage_unknown: false, request_attempts: 0};
    try {
      const base = this.baseUrl().replace(/\/+$/, '');
      const key = this.apiKey();
      const isHttp = base.startsWith('http://');
      if (isHttp && this.s.env.DEV_MODE !== 'true') problem('生产环境模型接口必须使用 HTTPS', 400);
      const doFetch = isHttp ? fetch : (this.s.env.modelFetch ?? fetch);
      const candidates = this.backends();
      const sticky = this.s.get('model_sticky', scope)?.backend;
      const ordered = [...candidates].sort((a, b) => Number(b.id === sticky) - Number(a.id === sticky));
      if (!sticky && ordered.length) {
        const n = this.cursor++ % ordered.length;
        ordered.push(...ordered.splice(0, n));
      }
      const errors: Array<{backend: string; error: string}> = [];
      let lastError = 'NO_BACKEND_AVAILABLE';
      const nowMs = Date.now();
      let toTry = ordered.filter(b => (this.s.get('model_health', b.id)?.retry_at ?? 0) <= nowMs);
      // Never permanently lock out when all backends (e.g. single configured model) are in backoff: try the soonest one.
      if (!toTry.length && ordered.length) {
        const soonest = [...ordered].sort(
          (a, b) => (this.s.get('model_health', a.id)?.retry_at ?? 0) - (this.s.get('model_health', b.id)?.retry_at ?? 0)
        )[0];
        toTry = [soonest];
      }

      for (const backend of toTry) {
        if (signal?.aborted) throw Error('CANCELLED');
        const control = new AbortController();
        const abort = () => control.abort();
        signal?.addEventListener('abort', abort, {once: true});
        const timer = setTimeout(abort, requestMs);
        try {
          const context = Math.min(AGENT_LIMITS.context_tokens, backend.context_tokens);
          const output = Math.min(payload.max_tokens ?? AGENT_LIMITS.max_output_tokens, backend.max_output_tokens, AGENT_LIMITS.max_output_tokens);
          const body = {
            ...payload,
            model: backend.model,
            max_tokens: output,
            ...((backend.thinking ?? this.s.env.MODEL_THINKING) === 'disabled' ? {thinking: {type: 'disabled'}} : {}),
          };
          const endpoint = base.endsWith('/chat/completions') ? base : base + '/chat/completions';
          let response!: Response;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              meter.request_attempts++;
              response = await doFetch(endpoint, {
                method: 'POST',
                headers: {
                  Authorization: 'Bearer ' + key,
                  'Content-Type': 'application/json',
                  'User-Agent': 'NOTE4-Platform/2.0.0',
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
          try {
            data = await readJSON(response);
          } catch (error) {
            meter.usage_unknown = true;
            throw error;
          }
          if (Number.isSafeInteger(data.usage?.total_tokens) && data.usage.total_tokens >= 0) {
            meter.known_tokens += data.usage.total_tokens;
          } else {
            meter.usage_unknown = true;
          }
          if (!data.choices?.[0]?.message) throw Error('MODEL_MESSAGE_MISSING');
          if (['length', 'model_context_window_exceeded', 'network_error'].includes(data.choices[0].finish_reason)) {
            throw Error('MODEL_INCOMPLETE_' + data.choices[0].finish_reason);
          }
          this.s.put('model_health', {id: backend.id, failures: 0, retry_at: 0});
          this.s.put('model_sticky', {id: scope, backend: backend.id});
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
          lastError = friendlyModelError(e, base);
          errors.push({backend: backend.id, error: lastError});
          const failures = (this.s.get('model_health', backend.id)?.failures ?? 0) + 1;
          const capMs = candidates.length <= 1 ? 15000 : 300000;
          this.s.put('model_health', {
            id: backend.id,
            failures,
            retry_at: Date.now() + Math.min(capMs, 1000 * 2 ** Math.min(failures, 6)),
            last_error: lastError,
          });
        } finally {
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
