import {AGENT_LIMITS, StreamDelta, UserModelRuntime} from './model-router';
import {buildStaticSystemPrompt} from './skills';
import {JS_TEMPLATES, pickTemplate} from './js-templates';
import {suggestPublicApiHint} from './public-apis';
import {modelWork, toolReceipt, compactContext, sanitizeMessages, redactReply, textBytes} from './context';

const enc = new TextEncoder();
const estimate = (v: any) => Math.ceil(enc.encode(JSON.stringify(v)).length / 2) + 128;

function parseToolArgs(raw: unknown): Record<string, any> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>;
  const text = String(raw ?? '').trim();
  if (!text) return {};
  return JSON.parse(text);
}

const isPureQuestion = (m: string) => {
  const s = String(m || '').trim();
  if (!s || s.length > 60) return false;
  if (/做|写|建|生成|改|加|删|换|把|调|修复|接入|设计/.test(s) && !/可以做|能做|能干|可以干|支持做/.test(s)) return false;
  return /你可以|你能|你会|干什么|做什么|干啥|做啥|怎么用|如何使用|有哪些功能|支持什么|是什么|介绍|推荐几个|怎么玩|怎么连|怎么发/.test(s);
};

export async function runAgent(s: any, task: any, auth: any, userRuntime?: UserModelRuntime) {
  const control = new AbortController();
  s.controllers.set(task.id, control);
  const timer = setTimeout(() => control.abort(), AGENT_LIMITS.wall_ms);
  let tokens = task.tokens ?? 0;
  let cachedTokens = task.cached_tokens ?? 0;
  let tools = task.tools_used ?? 0;
  let calls = task.model_calls ?? 0;
  let unknownUsage = task.usage_unknown ?? false;
  const initial = modelWork(s.work(auth.id, task.work_id, auth.works));
  const serviceIds: string[] = task.service_ids ?? [];
  const staticSystem = buildStaticSystemPrompt(initial.spec.kind);
  let messages: any[] = sanitizeMessages(task.context?.messages ?? []);
  const touched = new Set<string>(task.changed_service_ids ?? []);
  const canonical = {
    requirements: task.requirements ?? [{id: 'request', text: task.message}],
    scope: {owner: auth.id, work_id: task.work_id},
    pending_effects: task.inherited_facts?.pending_effects ?? [],
    safety: {stop: 'hold down preserves USB', fixed: true},
  };

  let truncatedRetries = 0;
  let lastFailSig = '';
  let sameSigCount = 0;
  let lastFailErr = '';
  let sameErrCount = 0;
  let lastStreamEmit = 0;

  const live = () => {
    const t = s.get('task', task.id);
    if (!t || t.state === 'cancelled' || control.signal.aborted) throw Error('CANCELLED');
    return t;
  };

  const emitLive = (patch: {live_reply?: string; live_tool?: string; live_bytes?: number}) => {
    const nowMs = Date.now();
    task.live_reply = patch.live_reply ?? '';
    task.live_tool = patch.live_tool ?? '';
    task.live_bytes = patch.live_bytes ?? 0;
    if (nowMs - lastStreamEmit < 120) return;
    lastStreamEmit = nowMs;
    s.notify('task', {...task, tokens, cached_tokens: cachedTokens, tools_used: tools, model_calls: calls});
  };

  const checkpoint = (state = 'running') => {
    live();
    Object.assign(task, {
      state,
      tokens,
      cached_tokens: cachedTokens,
      tools_used: tools,
      model_calls: calls,
      service_ids: serviceIds,
      changed_service_ids: [...touched],
      context: {messages},
      checkpoint: {
        canonical,
        work_rev: s.work(auth.id, task.work_id, auth.works).rev,
        service_ids: serviceIds,
        at: Date.now(),
      },
      updated_at: Date.now(),
      ...(state === 'completed' ? {completed_at: Date.now(), live_reply: '', live_tool: '', live_bytes: 0} : {}),
    });
    s.put('task', task);
  };

  try {
    task.state = 'running';
    task.started_at ??= Date.now();
    task.live_reply = '';
    task.live_tool = '';
    task.live_bytes = 0;
    delete task.error;

    // Never overwrite messages[0] when valid — preserves KV prefix cache!
    // Only seed/upgrade if empty or missing a system message (or legacy dynamic system prompt from pre-v2).
    if (!messages.length) {
      const pureQ = isPureQuestion(task.message);
      const apiHint = !pureQ && initial.spec.kind === 'js' ? suggestPublicApiHint(task.message) : undefined;
      messages = [
        {role: 'system', content: staticSystem},
        {
          role: 'user',
          content: JSON.stringify({
            work_id: task.work_id,
            request: task.message,
            ...(pureQ ? {intent_hint: 'User appears to be asking about capabilities/usage rather than requesting code edits. Answer directly without calling tools.'} : {}),
            ...(task.voice_component && !pureQ
              ? {voice_component_enabled: '请围绕本应用独立设计专属界面（切勿套用待办列表样式），启用 js.voice={mode:"both",long_trigger:"double_click",tts:"stella",search:true} 并用内置无头组件 var V=voice({role,state,tools}) 定义本应用专属工具（保留上下/单击确认/挥手原交互）。'}
              : {}),
            current_work: initial,
            ...(!pureQ && initial.spec.kind === 'js' && String(initial.spec.js?.source ?? '').length < 1500
              ? {reference_template: JS_TEMPLATES[pickTemplate(task.message)]}
              : {}),
            ...(apiHint ? {available_public_apis_hint: apiHint} : {}),
          }),
        },
      ];
    } else if (messages[0]?.role !== 'system') {
      messages.unshift({role: 'system', content: staticSystem});
    } else if (String(messages[0].content ?? '').includes('Canonical contract:')) {
      // One-time migration off legacy dynamic system prompt so future turns hit prefix cache cleanly
      messages[0] = {role: 'system', content: staticSystem};
    }

    checkpoint();

    // Fixed, deterministic tool list across all turns for 100% stable prefix cache
    const toolPayload = s
      .toolDefs()
      .filter((v: any) => v.name !== 'create_work')
      .map((v: any) => ({type: 'function', function: {name: v.name, description: v.description, parameters: v.inputSchema}}));

    while (calls < AGENT_LIMITS.max_calls && tools < AGENT_LIMITS.max_tools) {
      live();
      messages = sanitizeMessages(messages);
      const work = s.work(auth.id, task.work_id, auth.works);
      const backends = userRuntime
        ? [{context_tokens: 131072, max_output_tokens: 16384}]
        : s.router.backends();
      const context = Math.min(AGENT_LIMITS.context_tokens, ...backends.map((b: any) => b.context_tokens));
      const output = Math.min(AGENT_LIMITS.max_output_tokens, ...backends.map((b: any) => b.max_output_tokens));
      const threshold = Math.min(Math.floor(context * 0.72), context - output - 2048);

      if (estimate(messages) >= threshold) {
        messages = compactContext(staticSystem, canonical, work, serviceIds, task.steps, messages);
        task.compactions = (task.compactions ?? 0) + 1;
        if (estimate(messages) > context * 0.5) throw Error('CONTEXT_REQUIRES_SLICES');
        checkpoint();
      }

      const remaining = Math.min(AGENT_LIMITS.total_tokens, task.token_budget ?? AGENT_LIMITS.total_tokens) - tokens;
      if (estimate(messages) >= remaining) throw Error('TOKEN_BUDGET');
      calls++;
      task.live_reply = '';
      task.live_tool = '';
      task.live_bytes = 0;
      checkpoint();

      let data: any;
      let route: any;
      try {
        const res = await s.router.complete(
          auth.id + ':' + task.work_id,
          {
            messages,
            tools: toolPayload,
            max_tokens: Math.min(output, remaining - estimate(messages)),
            temperature: 0.2,
          },
          control.signal,
          Math.min(AGENT_LIMITS.request_ms, Math.max(1000, AGENT_LIMITS.wall_ms - (Date.now() - task.started_at))),
          (delta: StreamDelta) => emitLive({live_reply: delta.content, live_tool: delta.toolName, live_bytes: delta.toolArgBytes}),
          userRuntime
        );
        data = res.data;
        route = res.route;
      } catch (e: any) {
        if (e?.code === 'MODEL_TRUNCATED' && truncatedRetries < 2) {
          truncatedRetries++;
          tokens += e.known_tokens ?? 0;
          cachedTokens += e.cached_tokens ?? 0;
          unknownUsage ||= e.usage_unknown ?? false;
          task.http_requests = (task.http_requests ?? 0) + (e.request_attempts ?? 0);
          messages.push({
            role: 'user',
            content: JSON.stringify({
              source: 'output-truncated-guard',
              error: 'Previous response hit max_tokens and was truncated before finishing.',
              next_action: 'Use edit_source for targeted small edits instead of rewriting the whole file in one turn, or split into smaller steps.',
            }),
          });
          task.steps.push({tool: 'output_truncated', result: {ok: false, error: '输出超长截断，正在改用增量修改重试'}, at: Date.now()});
          checkpoint();
          continue;
        }
        throw e;
      }

      tokens += route.known_tokens;
      cachedTokens += route.cached_tokens ?? 0;
      unknownUsage ||= route.usage_unknown;
      task.http_requests = (task.http_requests ?? 0) + route.request_attempts;
      live();
      task.routes = [...(task.routes ?? []).slice(-31), route];
      task.live_reply = '';
      task.live_tool = '';
      task.live_bytes = 0;
      const rawMsg = data.choices[0].message;
      const msg = {...rawMsg, content: rawMsg.content ?? ''};

      if (!msg.tool_calls?.length) {
        messages.push(msg);
        try {
          const actual = s.work(auth.id, task.work_id, auth.works);
          const editedInThisTask = actual.rev !== initial.rev;
          if (!editedInThisTask && /```(?:js|javascript)?/i.test(String(msg.content))) {
            throw Error('Do not print source code in chat; apply the change with edit_source or patch_fields and verify with check_work.');
          }
          // Auto-provision Cloud Relay channel if the Agent switched the work to conn_mode='relay' or used RELAY outside the KIT header
          const bodySrc = String(actual.spec?.js?.source ?? '').replace(/^.*typeof\s+N4_RELAY.*$/gm, '');
          const usesRelay =
            actual.spec?.js?.conn_mode === 'relay' ||
            /\/\/\s*RELAY_JSON\s*:/.test(bodySrc) ||
            (/\bRELAY\b/.test(bodySrc) && /\bnet\.request\b/.test(bodySrc));
          if (!auth.works && actual.spec?.kind === 'js' && usesRelay && !actual.spec.js.relay_url && task.origin) {
            await s.relay.ensure(auth.id, actual.id, task.origin, false);
          }
          // Auto-enable default non-intrusive Voice+Agent hardware spec if source invokes voice({...}) or agent.config({...})
          const strippedVoiceShim = bodySrc.replace(/function\s+voice\s*\([\s\S]*?return\s+V;\s*\}/g, '');
          const usesVoiceComp = /\b(?:voice|agent\.config)\s*\(\s*\{/.test(strippedVoiceShim);
          if (!auth.works && actual.spec?.kind === 'js' && usesVoiceComp && (!actual.spec.js.voice || actual.spec.js.voice.mode === 'off')) {
            const nextSpec = structuredClone(actual.spec);
            nextSpec.js.voice = {mode: 'both', long_trigger: 'double_click', tts: 'stella', search: true, thinking: false};
            s.save(auth.id, nextSpec, actual.id, actual.rev);
          }
          const latest = s.work(auth.id, task.work_id, auth.works);
          // For pure Q&A (no edit made and no code block), don't fail the conversation if the user's pre-existing manual draft had an error
          let checked: any = null;
          if (editedInThisTask || latest.rev !== initial.rev) {
            checked = await s.checkWork(auth.id, latest.id, latest.rev, auth.works);
          } else {
            checked = await s.checkWork(auth.id, latest.id, latest.rev, auth.works).catch(() => null);
          }
          for (const serviceId of touched) {
            const service = s.hosted.get(auth.id, serviceId);
            const fingerprint = await s.hosted.fingerprint(service);
            const prior = s
              .owned('service_review', auth.id)
              .find((x: any) => x.service_id === serviceId && x.rev === service.rev && x.fingerprint === fingerprint && x.state === 'passed');
            const review = prior ?? (await s.hosted.check(auth.id, serviceId, service.rev, control.signal));
            live();
            task.steps.push({tool: 'platform_final_service_check', result: toolReceipt(review), at: Date.now()});
          }
          task.state = 'completed';
          task.actual_rev = latest.rev;
          task.changed = latest.rev !== initial.rev;
          task.reply = redactReply(msg.content) || '已保存并通过真机引擎核验。';
          task.check = checked;
          task.usage_unknown = unknownUsage;
          checkpoint('completed');
          return;
        } catch (e: any) {
          live();
          messages.push({
            role: 'user',
            content: JSON.stringify({
              source: 'deterministic-final-check',
              error: e.message,
              next_action: 'Repair the concrete error with edit_source or patch_fields and check_work; do not claim completion.',
            }),
          });
          task.steps.push({tool: 'platform_final_check', result: {ok: false, error: e.message}, at: Date.now()});
          checkpoint();
          continue;
        }
      }

      // Transactional tool batch execution: ensure every tool_call_id gets a matching tool reply even if cancelled mid-batch!
      messages.push(msg);
      const pendingToolIds = new Set<string>(msg.tool_calls.map((c: any) => c.id));
      let inReply = 0;
      try {
        for (const call of msg.tool_calls) {
          live();
          let result: any;
          let callSig = call.function.name;
          try {
            if (++inReply > AGENT_LIMITS.tools_per_reply || tools >= AGENT_LIMITS.max_tools) throw Error('TOOL_BUDGET');
            tools++;
            const args = parseToolArgs(call.function.arguments);
            callSig = call.function.name + ':' + JSON.stringify(args);
            if (args.work_id && args.work_id !== task.work_id) throw Error('TASK_SCOPE');
            if (args.service_id && !serviceIds.includes(args.service_id)) {
              throw Error('To create a new service OMIT service_id and base_rev; the server generates the ID. Updates require a returned service_id.');
            }
            result = await s.callTool(call.function.name, args, {...auth, task_work_id: task.work_id, origin: task.origin}, control.signal);
            live();
            if (['draft_service', 'update_service'].includes(call.function.name)) {
              touched.add(result.id);
              if (!serviceIds.includes(result.id)) serviceIds.push(result.id);
            }
            // Reset loop counters on any successful tool call
            lastFailSig = '';
            sameSigCount = 0;
            lastFailErr = '';
            sameErrCount = 0;
          } catch (e: any) {
            if (e?.message === 'CANCELLED') throw e;
            const errStr = String(e?.message ?? 'Validation error');
            sameSigCount = callSig === lastFailSig ? sameSigCount + 1 : 1;
            lastFailSig = callSig;
            sameErrCount = errStr === lastFailErr ? sameErrCount + 1 : 1;
            lastFailErr = errStr;
            const latestRev = s.work(auth.id, task.work_id, auth.works)?.rev;
            result = {
              ok: false,
              error: errStr,
              code: e?.code ?? 'VALIDATION',
              ...(latestRev !== undefined ? {current_rev: latestRev} : {}),
              next_action:
                sameSigCount >= 2
                  ? 'You repeated the exact same failing call. Change your approach, inspect get_work if needed, or simplify the layout.'
                  : 'Fix the specific error using the current_rev and capability contract.',
            };
          }
          const safe = textBytes(result) > 131072 ? {ok: false, code: 'RESULT_TOO_LARGE', next_action: 'Read a smaller artifact slice.'} : result;
          messages.push({role: 'tool', tool_call_id: call.id, content: JSON.stringify(safe)});
          pendingToolIds.delete(call.id);
          task.steps.push({tool: call.function.name, result: toolReceipt(safe), at: Date.now()});
          checkpoint();
        }
      } finally {
        // Fill any unexecuted tool_call_ids so persisted work_context NEVER contains dangling tool_calls!
        for (const missingId of pendingToolIds) {
          messages.push({
            role: 'tool',
            tool_call_id: missingId,
            content: JSON.stringify({ok: false, code: 'INTERRUPTED', error: 'Cancelled or interrupted before execution.'}),
          });
        }
      }

      // Smarter, gentle loop guard: pause cleanly instead of crashing on 2nd retry
      if (sameSigCount >= 3 || sameErrCount >= 4) {
        throw Object.assign(Error('LOOP_GUARD_PAUSED: ' + lastFailErr), {code: 'LOOP_GUARD_PAUSED', pauseInsteadOfFail: true});
      }
    }
    throw Object.assign(Error('TASK_BUDGET_REACHED'), {code: 'TASK_BUDGET_REACHED', pauseInsteadOfFail: true});
  } catch (e: any) {
    tokens += e.known_tokens ?? 0;
    cachedTokens += e.cached_tokens ?? 0;
    unknownUsage ||= e.usage_unknown ?? false;
    task.http_requests = (task.http_requests ?? 0) + (e.request_attempts ?? 0);
    const current = s.get('task', task.id);
    if (current?.state !== 'cancelled') {
      const shouldPause = control.signal.aborted || e.code === 'MODELS_UNAVAILABLE' || e.pauseInsteadOfFail === true;
      task.state = shouldPause ? 'paused' : 'failed';
      task.error = e.message;
      task.tokens = tokens;
      task.cached_tokens = cachedTokens;
      task.tools_used = tools;
      task.model_calls = calls;
      task.live_reply = '';
      task.live_tool = '';
      task.live_bytes = 0;
      task.context = {messages: sanitizeMessages(messages)};
      task.checkpoint = {
        canonical,
        work_rev: s.work(auth.id, task.work_id, auth.works).rev,
        service_ids: serviceIds,
        at: Date.now(),
      };
      task.service_ids = serviceIds;
      task.usage_unknown = unknownUsage;
      task.completed_at = Date.now();
      s.put('task', task);
    }
  } finally {
    clearTimeout(timer);
    s.controllers.delete(task.id);
    const saved = s.get('task', task.id);
    const cleanMessages = sanitizeMessages(saved?.context?.messages ?? messages);
    if (saved?.state === 'cancelled') {
      saved.tokens = tokens;
      saved.cached_tokens = cachedTokens;
      saved.usage_unknown = unknownUsage;
      saved.http_requests = task.http_requests ?? 0;
      saved.live_reply = '';
      saved.live_tool = '';
      saved.live_bytes = 0;
      saved.completed_at = Date.now();
      s.put('task', saved);
    }
    if (saved?.checkpoint) {
      let latestRev: number | undefined;
      try {
        latestRev = s.work(auth.id, task.work_id, auth.works)?.rev;
      } catch {}
      s.put('work_context', {
        id: task.work_id,
        owner: auth.id,
        requirements: task.requirements,
        canonical: saved.checkpoint.canonical,
        messages: cleanMessages,
        last_model_rev: latestRev ?? saved.checkpoint.work_rev,
        last_task_id: task.id,
        updated_at: Date.now(),
      });
    }
    if (task.reservation_id) {
      const charge = s.get('charge', task.reservation_id);
      if (charge?.state === 'reserved') {
        // 0.2x credit discount for KV-cached prompt tokens
        const billableTokens = Math.max(0, tokens - cachedTokens) + Math.round(cachedTokens * 0.2);
        s.budget.settle(task.reservation_id, Math.min(charge.credits, Math.ceil(billableTokens / 1000)));
      }
    }
  }
}
