import {AGENT_LIMITS} from './model-router';
import {taskSkills} from './skills';
import {JS_TEMPLATES, pickTemplate} from './js-templates';
import {modelWork, toolReceipt, compactContext, textBytes} from './context';

const enc = new TextEncoder();
const estimate = (v: any) => Math.ceil(enc.encode(JSON.stringify(v)).length / 2) + 128;

function parseToolArgs(raw: unknown): Record<string, any> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>;
  const text = String(raw ?? '').trim();
  if (!text) return {};
  return JSON.parse(text);
}

export async function runAgent(s: any, task: any, auth: any) {
  const control = new AbortController();
  s.controllers.set(task.id, control);
  const timer = setTimeout(() => control.abort(), AGENT_LIMITS.wall_ms);
  let tokens = task.tokens ?? 0;
  let tools = task.tools_used ?? 0;
  let calls = task.model_calls ?? 0;
  let unknownUsage = task.usage_unknown ?? false;
  const initial = modelWork(s.work(auth.id, task.work_id, auth.works));
  const serviceIds = task.service_ids ?? [];
  let messages: any[] = task.context?.messages ?? [];
  const touched = new Set<string>(task.changed_service_ids ?? []);
  const canonical = {
    requirements: task.requirements ?? [{id: 'request', text: task.message}],
    scope: {owner: auth.id, work_id: task.work_id},
    pending_effects: task.inherited_facts?.pending_effects ?? [],
    safety: {stop: 'hold down preserves USB', fixed: true},
  };

  const system = () =>
    taskSkills(initial.spec.kind).map((v: any) => v.text).join('\n') +
    '\nYou create NOTE4 e-ink works AND optional short hosted JS services. Always use tools to write changes—never just paste code in text replies. Never claim physical device verification. The current work is already provided: do not re-read unchanged data. Prefer patch_fields then check_work and finish. Do not repeat successful checks or build unless requested; the user web button builds. Keep the final user reply in plain, friendly Chinese within three short sentences, NO emojis, no raw IDs, source code, markdown headings or checklists. Final next action is the actual web button「发布到设备」or「写入设备」(and for conn_mode="relay" apps, briefly tell the user they can click「获取推送文档」and send it to their local AI to automatically push JSON data to this screen). When a js work still has its default title, also set title to a short Chinese name in the same patch_fields call. Keep user requirements and fix every validation error returned by check_work. Use async/await for rt HTTP/state/AI SDK. Write no polling, setInterval, permanent connections or agent loops in services. Work scope ' +
    task.work_id +
    '. Inputs jump [ok.short,gesture.wave] determine buttons/gestures/both; gesture_feedback supports enabled,x,y,style icon/text,icon_set hand/arrows. Only modify this work. Canonical contract: ' +
    JSON.stringify(canonical);

  const live = () => {
    const t = s.get('task', task.id);
    if (!t || t.state === 'cancelled' || control.signal.aborted) throw Error('CANCELLED');
    return t;
  };

  const checkpoint = (state = 'running') => {
    live();
    Object.assign(task, {
      state,
      tokens,
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
      ...(state === 'completed' ? {completed_at: Date.now()} : {}),
    });
    s.put('task', task);
  };

  try {
    task.state = 'running';
    task.started_at ??= Date.now();
    delete task.error;
    if (messages.length) messages[0] = {role: 'system', content: system()};
    checkpoint();

    if (!messages.length) {
      messages = [
        {role: 'system', content: system()},
        {
          role: 'user',
          content: JSON.stringify({
            request: task.message,
            current_work: initial,
            ...(initial.spec.kind === 'js' && String(initial.spec.js?.source ?? '').length < 1500
              ? {reference_template: JS_TEMPLATES[pickTemplate(task.message)]}
              : {}),
          }),
        },
      ];
    }

    while (calls < AGENT_LIMITS.max_calls && tools < AGENT_LIMITS.max_tools) {
      live();
      const work = s.work(auth.id, task.work_id, auth.works);
      const backends = s.router.backends();
      const context = Math.min(AGENT_LIMITS.context_tokens, ...backends.map((b: any) => b.context_tokens));
      const output = Math.min(AGENT_LIMITS.max_output_tokens, ...backends.map((b: any) => b.max_output_tokens));
      const threshold = Math.min(Math.floor(context * 0.7), context - output - 2048);

      if (estimate(messages) >= threshold) {
        messages = compactContext(system(), canonical, work, serviceIds, task.steps);
        task.compactions = (task.compactions ?? 0) + 1;
        if (estimate(messages) > context * 0.45) throw Error('CONTEXT_REQUIRES_SLICES');
        checkpoint();
      }

      const remaining = Math.min(AGENT_LIMITS.total_tokens, task.token_budget ?? AGENT_LIMITS.total_tokens) - tokens;
      if (estimate(messages) >= remaining) throw Error('TOKEN_BUDGET');
      calls++;
      checkpoint();

      const {data, route} = await s.router.complete(
        auth.id + ':' + task.work_id,
        {
          messages,
          tools: s
            .toolDefs()
            .filter((v: any) => v.name !== 'create_work')
            .map((v: any) => ({type: 'function', function: {name: v.name, description: v.description, parameters: v.inputSchema}})),
          max_tokens: Math.min(output, remaining - estimate(messages)),
          temperature: 0.2,
        },
        control.signal,
        Math.min(AGENT_LIMITS.request_ms, Math.max(1, AGENT_LIMITS.wall_ms - (Date.now() - task.started_at)))
      );

      tokens += route.known_tokens;
      unknownUsage ||= route.usage_unknown;
      task.http_requests = (task.http_requests ?? 0) + route.request_attempts;
      live();
      task.routes = [...(task.routes ?? []).slice(-31), route];
      const rawMsg = data.choices[0].message;
      const msg = {...rawMsg, content: rawMsg.content ?? ''};
      messages.push(msg);

      if (!msg.tool_calls?.length) {
        try {
          const actual = s.work(auth.id, task.work_id, auth.works);
          if (actual.rev === initial.rev && /```(?:js|javascript)?/i.test(String(msg.content))) {
            throw Error('Do not print source code in chat; apply the change with patch_fields and verify with check_work.');
          }
          // Auto-provision Cloud Relay channel if the Agent switched the work to conn_mode='relay' or used RELAY outside the KIT header
          const bodySrc = String(actual.spec?.js?.source ?? '').replace(/^.*typeof\s+N4_RELAY.*$/gm, '');
          const usesRelay =
            actual.spec?.js?.conn_mode === 'relay' ||
            /\/\/\s*RELAY_JSON\s*:/.test(bodySrc) ||
            (/\bRELAY\b/.test(bodySrc) && /\bnet\.request\b/.test(bodySrc));
          if (
            !auth.works &&
            actual.spec?.kind === 'js' &&
            usesRelay &&
            !actual.spec.js.relay_url &&
            task.origin
          ) {
            await s.relay.ensure(auth.id, actual.id, task.origin, false);
          }
          const latest = s.work(auth.id, task.work_id, auth.works);
          const checked = await s.checkWork(auth.id, latest.id, latest.rev, auth.works);
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
          task.reply = msg.content || '已保存并通过真机引擎核验。';
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
              next_action: 'Repair the concrete error with patch_fields and check_work; do not claim completion.',
            }),
          });
          task.steps.push({tool: 'platform_final_check', result: {ok: false, error: e.message}, at: Date.now()});
          checkpoint();
          continue;
        }
      }

      let inReply = 0;
      for (const call of msg.tool_calls) {
        live();
        let result;
        try {
          if (++inReply > AGENT_LIMITS.tools_per_reply || tools >= AGENT_LIMITS.max_tools) throw Error('TOOL_BUDGET');
          tools++;
          const args = parseToolArgs(call.function.arguments);
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
        } catch (e: any) {
          result = {
            ok: false,
            error: e.message,
            code: e.code ?? 'VALIDATION',
            next_action: 'Fix the specific error, use current revision and capability contract.',
          };
        }
        const safe = textBytes(result) > 131072 ? {ok: false, code: 'RESULT_TOO_LARGE', next_action: 'Read a smaller artifact slice.'} : result;
        messages.push({role: 'tool', tool_call_id: call.id, content: JSON.stringify(safe)});
        task.steps.push({tool: call.function.name, result: toolReceipt(safe), at: Date.now()});
        checkpoint();
      }

      const recent = task.steps.slice(-2);
      if (recent.length === 2 && recent.every((x: any) => x.result.ok === false) && recent[0].result.error === recent[1].result.error) {
        throw Error('REPEATED_TOOL_FAILURE: ' + recent[1].result.error);
      }
    }
    throw Error('TASK_BUDGET_REACHED');
  } catch (e: any) {
    tokens += e.known_tokens ?? 0;
    unknownUsage ||= e.usage_unknown ?? false;
    task.http_requests = (task.http_requests ?? 0) + (e.request_attempts ?? 0);
    const current = s.get('task', task.id);
    if (current?.state !== 'cancelled') {
      task.state = control.signal.aborted || e.code === 'MODELS_UNAVAILABLE' ? 'paused' : 'failed';
      task.error = e.message;
      task.tokens = tokens;
      task.tools_used = tools;
      task.model_calls = calls;
      task.context = {messages};
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
    if (saved?.state === 'cancelled') {
      saved.tokens = tokens;
      saved.usage_unknown = unknownUsage;
      saved.http_requests = task.http_requests ?? 0;
      saved.completed_at = Date.now();
      s.put('task', saved);
    }
    if (saved?.checkpoint) {
      s.put('work_context', {
        id: task.work_id,
        owner: auth.id,
        requirements: task.requirements,
        canonical: saved.checkpoint.canonical,
        messages: saved.context?.messages ?? messages,
        last_task_id: task.id,
        updated_at: Date.now(),
      });
    }
    if (task.reservation_id) {
      const charge = s.get('charge', task.reservation_id);
      if (charge?.state === 'reserved') s.budget.settle(task.reservation_id, Math.min(charge.credits, Math.ceil(tokens / 1000)));
    }
  }
}
