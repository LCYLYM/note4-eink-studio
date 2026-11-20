/** Persistent facts are authoritative; transcript compaction never rewrites them. */
export const textBytes = (value: any) => new TextEncoder().encode(JSON.stringify(value)).length;

export function modelWork(work: any) {
  const result = structuredClone(work);
  if (result.spec?.js?.secret) {
    delete result.spec.js.secret;
    result.spec.js.stored_secret = true;
  }
  if (result.spec?.js?.relay_url) {
    delete result.spec.js.relay_url;
    result.spec.js.stored_relay = true;
  }
  if (result.spec?.js?.photos) {
    result.spec.js.stored_photos = result.spec.js.photos.length;
    delete result.spec.js.photos;
  }
  for (const page of result.spec?.pages ?? []) {
    if (page.image_data_url) {
      delete page.image_data_url;
      page.stored_image_preserved = true;
    }
  }
  if (result.spec?.reader?.text?.length > 4096) {
    const text = result.spec.reader.text;
    result.spec.reader = {
      stored_text_preserved: true,
      character_count: text.length,
      preview: text.slice(0, 512),
    };
  }
  return result;
}

export function workWriteReceipt(work: any, changedFields: string[], extra: Record<string, any> = {}) {
  return {
    ok: true,
    id: work.id,
    rev: work.rev,
    title: work.spec?.title,
    kind: work.spec?.kind,
    ...(work.spec?.js ? {source_bytes: new TextEncoder().encode(String(work.spec.js.source ?? '')).length} : {}),
    changed_fields: changedFields,
    ...extra,
  };
}

export function toolReceipt(value: any) {
  if (!value || typeof value !== 'object') return value;
  const keep = [
    'ok', 'id', 'rev', 'state', 'revision', 'error', 'code', 'next_action',
    'checks', 'results', 'byte_length', 'source_bytes', 'edits_applied',
    'changed_fields', 'build_id', 'service_id', 'fingerprint', 'network', 'hardware',
  ];
  const out: Record<string, any> = Object.fromEntries(
    keep.filter(k => value[k] !== undefined).map(k => [k, value[k]])
  );
  if (value.js && typeof value.js === 'object') {
    out.engine_check = {
      ms: value.js.slowest_handler_ms_estimate,
      keys: value.js.keys,
      net: value.js.net_requests_tested_offline,
      mock_net: value.js.mock_net_tested ?? 0,
      oob: value.js.oob_pixels ?? 0,
      store_keys: value.js.store_keys,
      store_bytes: value.js.store_bytes,
    };
  }
  return out;
}

/**
 * Self-healing transcript sanitizer:
 * Guarantees every assistant message with tool_calls is immediately followed by
 * matching role:"tool" messages for every tool_call_id, and drops orphan tool
 * messages. Preserves valid prefix messages byte-for-byte so KV prefix cache stays hot.
 */
export function sanitizeMessages(raw: any[]): any[] {
  if (!Array.isArray(raw) || !raw.length) return [];
  const out: any[] = [];
  let i = 0;
  while (i < raw.length) {
    const m = raw[i];
    if (!m || typeof m !== 'object' || typeof m.role !== 'string') {
      i++;
      continue;
    }
    if (m.role === 'tool') {
      // Orphan tool message not immediately following its assistant tool_calls
      i++;
      continue;
    }
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const validCalls = m.tool_calls.filter((c: any) => c && typeof c.id === 'string' && c.id && c.function?.name);
      if (!validCalls.length) {
        if (m.content) out.push({role: 'assistant', content: String(m.content)});
        i++;
        continue;
      }
      const expected = new Set<string>(validCalls.map((c: any) => c.id));
      const collected = new Map<string, any>();
      let j = i + 1;
      while (j < raw.length && raw[j]?.role === 'tool') {
        const tm = raw[j];
        if (typeof tm.tool_call_id === 'string' && expected.has(tm.tool_call_id) && !collected.has(tm.tool_call_id)) {
          collected.set(tm.tool_call_id, {
            role: 'tool',
            tool_call_id: tm.tool_call_id,
            content: typeof tm.content === 'string' ? tm.content : JSON.stringify(tm.content ?? {}),
          });
        }
        j++;
      }
      out.push(validCalls.length === m.tool_calls.length ? m : {...m, tool_calls: validCalls});
      for (const c of validCalls) {
        out.push(
          collected.get(c.id) ?? {
            role: 'tool',
            tool_call_id: c.id,
            content: JSON.stringify({ok: false, code: 'INTERRUPTED', error: 'Tool execution was interrupted before completion.'}),
          }
        );
      }
      i = j;
      continue;
    }
    out.push(m);
    i++;
  }
  return out;
}

/**
 * Smooth tiered compaction:
 * Keeps the static system prompt untouched, packs a concise structured summary
 * + latest work snapshot, and retains the last 2 completed user/assistant turns
 * (stripped of bulky code payloads) so multi-turn nuance is never lost.
 */
export function compactContext(
  system: string,
  canonical: any,
  work: any,
  serviceIds: string[],
  steps: any[],
  oldMessages: any[] = []
) {
  const reqs = (canonical?.requirements ?? [])
    .slice(-12)
    .map((r: any) => String(r?.text ?? '').replace(/\s+/g, ' ').slice(0, 160))
    .filter(Boolean);

  // Extract concise recent dialogue turns (user request text + assistant plain reply)
  const recentTurns: Array<{user: string; assistant?: string}> = [];
  for (const m of oldMessages) {
    if (m?.role === 'user') {
      let text = '';
      if (typeof m.content === 'string') {
        try {
          const parsed = JSON.parse(m.content);
          if (parsed?.source === 'persistent-checkpoint' || parsed?.source === 'deterministic-final-check') continue;
          text = String(parsed?.request ?? '').trim();
        } catch {
          text = m.content.trim();
        }
      }
      if (text) recentTurns.push({user: text.slice(0, 240)});
    } else if (m?.role === 'assistant' && !m.tool_calls?.length && m.content && recentTurns.length) {
      recentTurns[recentTurns.length - 1].assistant = String(m.content).slice(0, 240);
    }
  }

  return [
    {role: 'system', content: system},
    {
      role: 'user',
      content: JSON.stringify({
        source: 'persistent-checkpoint',
        work_id: work.id,
        pinned_requirements: reqs,
        recent_dialogue: recentTurns.slice(-3),
        current_work: modelWork(work),
        service_ids: serviceIds,
        recent_checks: steps.slice(-6).map(s => ({tool: s.tool, result: toolReceipt(s.result)})),
      }),
    },
  ];
}

export function redactReply(text: string): string {
  return String(text ?? '')
    .replace(/sk-[a-zA-Z0-9_-]{16,}/g, '[redacted]')
    .replace(/n4r_[a-f0-9]{20,}/g, '[redacted]')
    .trim();
}
