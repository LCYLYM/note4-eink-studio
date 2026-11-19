import {problem, randomToken, sha} from './accounts';
import {readJSON} from './http';

const now = () => Date.now();
const enc = new TextEncoder();
const byteLen = (v: unknown) => enc.encode(typeof v === 'string' ? v : JSON.stringify(v)).length;

export interface RelayInboxItem {
  id: string;
  at: number;
  from: string;
  who: string;
  text: string;
}

export interface RelayOutboxItem {
  id: string;
  at: number;
  action: string;
  text: string;
  reply_to?: string;
  data?: Record<string, unknown>;
  acked?: boolean;
}

export class RelayHub {
  constructor(private s: any) {}

  private makeToken() {
    return 'n4r_' + randomToken().slice(0, 32);
  }

  private defaultSeed() {
    const t = now();
    return {
      state: {
        title: '桌面中转已连通',
        note: '在网页中转台或任意内网电脑发送一条数据，墨水屏同步时就会更新。',
        status: 'IDLE',
        task: '等待新任务推送',
        progress: 65,
        cpu: 18,
        mem: 42,
        swap: 8,
        disk: 54,
        cpu_name: 'Intranet Host',
      },
      inbox: [
        {
          id: 'msg_welcome',
          at: t,
          from: '中转站',
          who: 'NOTE4',
          text: '通道已就绪！支持从内网电脑推送状态，也支持墨水屏按键回传。',
        },
      ] as RelayInboxItem[],
      outbox: [] as RelayOutboxItem[],
    };
  }

  getByWork(owner: string, workId: string) {
    const w = this.s.work(owner, workId);
    const row = this.s.get('relay', w.id);
    return row && row.owner === owner ? row : null;
  }

  async ensure(owner: string, workId: string, origin: string, rotate = false) {
    const w = this.s.work(owner, workId);
    const existing = this.s.get('relay', w.id);
    if (existing && !rotate) {
      return this.describe(existing, origin);
    }
    const token = this.makeToken();
    const keyHash = await sha(token);
    if (existing?.key_hash) {
      this.s.ctx.storage.sql.exec('DELETE FROM records WHERE type=? AND id=?', 'relay_index', existing.key_hash);
    }
    const seed = existing ? {state: existing.state ?? {}, inbox: existing.inbox ?? [], outbox: existing.outbox ?? []} : this.defaultSeed();
    const record = {
      id: w.id,
      work_id: w.id,
      owner,
      token,
      key_hash: keyHash,
      created_at: existing?.created_at ?? now(),
      updated_at: now(),
      last_push_at: existing?.last_push_at ?? now(),
      last_pull_at: existing?.last_pull_at ?? null,
      last_reply_at: existing?.last_reply_at ?? null,
      push_count: existing?.push_count ?? 0,
      pull_count: existing?.pull_count ?? 0,
      reply_count: existing?.reply_count ?? 0,
      ...seed,
    };
    const relayUrl = `${origin}/api/relay/${token}`;
    this.s.ctx.storage.transactionSync(() => {
      this.s.put('relay', record, w.id);
      this.s.put('relay_index', {id: keyHash, work_id: w.id, owner}, keyHash);
      if (w.spec?.kind === 'js') {
        const nextSpec = structuredClone(w.spec);
        nextSpec.js.relay_url = relayUrl;
        if (!nextSpec.js.secret) {
          nextSpec.js.conn_mode = 'relay';
        }
        this.s.save(owner, nextSpec, w.id, w.rev);
      }
    });
    return this.describe(record, origin);
  }

  clear(owner: string, workId: string, origin: string, target: 'all' | 'inbox' | 'outbox' = 'all') {
    const row = this.getByWork(owner, workId);
    if (!row) problem('尚未开启云端中转', 404);
    if (target === 'all' || target === 'inbox') row.inbox = [];
    if (target === 'all' || target === 'outbox') row.outbox = [];
    row.updated_at = now();
    this.s.put('relay', row, row.id);
    return this.describe(row, origin);
  }

  private parseRelayJsonHint(src: string): Record<string, unknown> | null {
    const head = src.split('\n').slice(0, 8).join('\n');
    const m = head.match(/\/\/\s*RELAY_JSON\s*:\s*(\{[^\r\n]*\})/);
    if (!m) return null;
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
        return parsed as Record<string, unknown>;
      }
    } catch {}
    return null;
  }

  private samplePayload(work: any): Record<string, unknown> {
    const gallery = work?.spec?.js?.gallery || '';
    const src = String(work?.spec?.js?.source || '');
    const hint = this.parseRelayJsonHint(src);
    if (hint) return hint;
    if (gallery === 'monitor' || /\bcpu_name\b|\bmem\b/.test(src)) {
      return {cpu_name: 'My-Mac', cpu: 28, mem: 62, swap: 8, disk: 51};
    }
    if (gallery === 'claude_hud' || /\btokens\b|\bprogress\b/.test(src)) {
      return {status: 'RUNNING', task: '当前执行的任务名称', progress: 75, note: '最新一步状态摘要', tokens: '18.4k', queue: 2};
    }
    if (gallery === 'robot') {
      return {from: '微信', who: '张三', text: '下午三点开会，记得带资料'};
    }
    if (gallery === 'relay_board') {
      return {from: '我的电脑', who: '书房', text: '下午三点开会，记得带上设备'};
    }
    return {from: '我的电脑', title: '桌面提醒', note: '显示在屏幕上的主要内容', text: '追加一条新消息（可选）'};
  }

  private buildAiDoc(row: any, url: string) {
    const work = this.s.get('work', row.work_id);
    const title = work?.spec?.title || '墨水屏应用';
    const src = String(work?.spec?.js?.source || '');
    const sampleObj = this.samplePayload(work);
    const hasOutbox = /\/outbox|\/reply|method:\s*['"]POST['"]/i.test(src);
    const outboxSec = hasOutbox
      ? `\n\n## 读取墨水屏按键回传（可选）\n墨水屏上按「确定」或「挥手」后，动作会存入回传队列：\n- 查询：\`GET ${url}/outbox\`\n- 确认消费：\`GET ${url}/outbox?ack=<item.id>\``
      : '';
    const ai_doc = `# 给 NOTE4 墨水屏「${title}」推送数据的接入说明\n\n请帮我在本机写一个轻量定时小服务（Python 3 或 Node.js 均可，优先零第三方依赖），定期采集我的数据并以 HTTP POST JSON 推送到下面这个公网专属链接（链接已自带鉴权 Token，内网可直接访问，无需内网穿透）：\n\n- 推送接口：\`POST ${url}\`\n- 请求头：\`Content-Type: application/json\`\n\n## 推送 JSON 格式示例\n\`\`\`json\n${JSON.stringify(sampleObj, null, 2)}\n\`\`\`\n\n> 说明：顶层字段会自动合并为墨水屏展示状态；传入 \`text\` 字段会同时追加一条新消息。${outboxSec}\n\n## 实现要求\n1. 先问我具体想同步本机哪类数据、多久推送一次（默认每 5 分钟或事件触发）。\n2. 推送失败时静默重试，不要阻塞主程序，不要泄露或硬编码无关凭据。\n3. 写完后先跑一次真实推送验证返回 \`{"ok":true}\`，再告诉我怎么设为后台常驻或定时任务。`;
    return {ai_doc, sample_payload: sampleObj};
  }

  describe(row: any, origin: string) {
    const url = `${origin}/api/relay/${row.token}`;
    const {ai_doc, sample_payload} = this.buildAiDoc(row, url);
    return {
      enabled: true,
      work_id: row.work_id,
      token: row.token,
      url,
      outbox_url: `${url}/outbox`,
      ai_doc,
      sample_payload,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_push_at: row.last_push_at,
      last_pull_at: row.last_pull_at,
      last_reply_at: row.last_reply_at,
      push_count: row.push_count ?? 0,
      pull_count: row.pull_count ?? 0,
      reply_count: row.reply_count ?? 0,
      state: row.state ?? {},
      inbox: row.inbox ?? [],
      outbox: row.outbox ?? [],
    };
  }

  private async resolveToken(token: string) {
    if (!token || !/^n4r_[a-f0-9]{24,64}$/.test(token)) problem('中转密钥格式无效', 401, 'RELAY_UNAUTHORIZED');
    const keyHash = await sha(token);
    this.s.accounts.rate('relay:' + keyHash, 60);
    const idx = this.s.get('relay_index', keyHash);
    if (!idx) problem('中转通道不存在或密钥已重置', 401, 'RELAY_UNAUTHORIZED');
    const row = this.s.get('relay', idx.work_id);
    if (!row || row.token !== token) problem('中转密钥已失效', 401, 'RELAY_UNAUTHORIZED');
    return row;
  }

  applyPush(row: any, payload: any) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      problem('推送内容需为 JSON 对象');
    }
    if (byteLen(payload) > 24576) problem('单次推送数据不能超过 24KB', 413);
    const t = now();
    const nextState = payload.replace_state === true ? {} : structuredClone(row.state ?? {});
    if (payload.state && typeof payload.state === 'object' && !Array.isArray(payload.state)) {
      Object.assign(nextState, payload.state);
    } else {
      for (const [k, v] of Object.entries(payload)) {
        if (!['messages', 'clear_inbox', 'replace_state'].includes(k)) {
          nextState[k] = v;
        }
      }
    }
    if (byteLen(nextState) > 12288) problem('中转状态累计超过 12KB，请精简字段', 413);
    row.state = nextState;

    if (payload.clear_inbox === true) row.inbox = [];
    const inbox: RelayInboxItem[] = Array.isArray(row.inbox) ? [...row.inbox] : [];
    if (Array.isArray(payload.messages)) {
      row.inbox = payload.messages.slice(0, 12).map((m: any, idx: number) => ({
        id: String(m?.id ?? `m_${t}_${idx}`).slice(0, 40),
        at: Number(m?.at) || t,
        from: String(m?.from ?? '中转').slice(0, 20),
        who: String(m?.who ?? '内网').slice(0, 32),
        text: String(m?.text ?? '').slice(0, 200),
      })).filter((m: RelayInboxItem) => m.text);
    } else if (typeof payload.text === 'string' && payload.text.trim()) {
      inbox.unshift({
        id: String(payload.id ?? `m_${t.toString(36)}`).slice(0, 40),
        at: t,
        from: String(payload.from ?? '电脑推送').slice(0, 20),
        who: String(payload.who ?? '内网终端').slice(0, 32),
        text: payload.text.trim().slice(0, 200),
      });
      row.inbox = inbox.slice(0, 12);
    }

    row.last_push_at = t;
    row.updated_at = t;
    row.push_count = (row.push_count ?? 0) + 1;
    this.s.put('relay', row, row.id);
    return row;
  }

  applyOutbox(row: any, payload: any) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      problem('回传内容需为 JSON 对象');
    }
    if (byteLen(payload) > 8192) problem('回传数据过大', 413);
    const t = now();
    const replyTo = typeof payload.id === 'string' ? payload.id.slice(0, 40) : undefined;
    const item: RelayOutboxItem = {
      id: `out_${t.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      at: t,
      action: String(payload.action ?? (replyTo ? 'reply' : 'event')).slice(0, 32),
      text: String(payload.text ?? payload.value ?? payload.action ?? '已确认').slice(0, 200),
      ...(replyTo ? {reply_to: replyTo} : {}),
      ...(payload.data && typeof payload.data === 'object' ? {data: payload.data as Record<string, unknown>} : {}),
    };
    const outbox: RelayOutboxItem[] = Array.isArray(row.outbox) ? [...row.outbox] : [];
    outbox.unshift(item);
    row.outbox = outbox.slice(0, 20);
    if (replyTo && Array.isArray(row.inbox)) {
      row.inbox = row.inbox.filter((m: RelayInboxItem) => m.id !== replyTo);
    }
    row.last_reply_at = t;
    row.updated_at = t;
    row.reply_count = (row.reply_count ?? 0) + 1;
    this.s.put('relay', row, row.id);
    return item;
  }

  private cors(res: Response) {
    res.headers.set('Access-Control-Allow-Origin', '*');
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  async publicRoute(r: Request): Promise<Response | null> {
    const u = new URL(r.url);
    const p = u.pathname.split('/').filter(Boolean);
    if (p[0] !== 'api' || p[1] !== 'relay') return null;
    if (r.method === 'OPTIONS') {
      return this.cors(new Response(null, {status: 204}));
    }
    const token = p[2] || r.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
    const sub = p[3] ?? '';
    const row = await this.resolveToken(token);

    if (r.method === 'GET' && !sub) {
      row.last_pull_at = now();
      row.pull_count = (row.pull_count ?? 0) + 1;
      this.s.put('relay', row, row.id);
      return this.cors(Response.json({
        ok: true,
        at: row.last_push_at,
        push_count: row.push_count ?? 0,
        state: row.state ?? {},
        messages: row.inbox ?? [],
      }));
    }

    if (r.method === 'GET' && sub === 'outbox') {
      const ack = u.searchParams.get('ack');
      if (ack && Array.isArray(row.outbox)) {
        row.outbox = row.outbox.filter((x: RelayOutboxItem) => x.id !== ack);
        this.s.put('relay', row, row.id);
      }
      return this.cors(Response.json({
        ok: true,
        last_reply_at: row.last_reply_at,
        reply_count: row.reply_count ?? 0,
        outbox: row.outbox ?? [],
      }));
    }

    if (r.method === 'POST' && (sub === 'outbox' || sub === 'reply')) {
      const body = await readJSON(r, 16384);
      const item = this.applyOutbox(row, body);
      return this.cors(Response.json({ok: true, item}, {status: 201}));
    }

    if (r.method === 'POST' && !sub) {
      const body: any = await readJSON(r, 32768);
      // Compatibility: if a device posts {id, text} directly to the base relay URL (like the robot template), route to outbox when reply_mode or matching inbox id is detected.
      if (body && typeof body === 'object' && body.from_device === true || (typeof body?.id === 'string' && typeof body?.text === 'string' && !body.from && !body.who && Array.isArray(row.inbox) && row.inbox.some((m: RelayInboxItem) => m.id === body.id))) {
        const item = this.applyOutbox(row, body);
        return this.cors(Response.json({ok: true, direction: 'outbox', item}, {status: 201}));
      }
      this.applyPush(row, body);
      return this.cors(Response.json({
        ok: true,
        direction: 'inbox',
        at: row.last_push_at,
        push_count: row.push_count,
        inbox_length: row.inbox?.length ?? 0,
      }));
    }

    problem('未知的中转站接口路径', 404);
  }

  async ownerRoute(r: Request, uid: string): Promise<Response | null> {
    const u = new URL(r.url);
    const p = u.pathname.split('/').filter(Boolean);
    // /api/works/:id/relay[/rotate|/push|/clear]
    if (!(p[0] === 'api' && p[1] === 'works' && p[3] === 'relay')) return null;
    const workId = p[2];
    const action = p[4] ?? '';
    const origin = u.origin;

    if (r.method === 'GET' && !action) {
      const row = this.getByWork(uid, workId);
      if (!row) return Response.json({enabled: false, work_id: workId});
      return Response.json(this.describe(row, origin));
    }
    if (r.method === 'POST' && (!action || action === 'rotate')) {
      return Response.json(await this.ensure(uid, workId, origin, action === 'rotate'));
    }
    if (r.method === 'POST' && action === 'push') {
      const body = await readJSON(r, 32768);
      let row = this.getByWork(uid, workId);
      if (!row) {
        await this.ensure(uid, workId, origin, false);
        row = this.getByWork(uid, workId);
      }
      this.applyPush(row, body);
      return Response.json(this.describe(row, origin));
    }
    if (r.method === 'POST' && action === 'clear') {
      const body: any = await readJSON(r, 4096).catch(() => ({}));
      const target = ['all', 'inbox', 'outbox'].includes(body?.target) ? body.target : 'all';
      return Response.json(this.clear(uid, workId, origin, target));
    }
    return null;
  }
}
