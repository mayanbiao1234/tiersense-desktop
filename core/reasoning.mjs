import { createHash } from 'node:crypto';

const CAPTURE_LIMIT = 1024 * 1024;
const complete = choice => ['stop', 'tool_calls', 'function_call'].includes(choice?.finish_reason);
const hash = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function visible(message) {
  const copy = { ...message };
  // Harnesses often rebuild strings as text blocks, or reserialize tool arguments.
  // Normalize only equivalent representations for hashing; never change the wire messages.
  if (Array.isArray(copy.content) && copy.content.every(part => part?.type === 'text' && typeof part.text === 'string' && Object.keys(part).every(key => ['type', 'text'].includes(key)))) copy.content = copy.content.map(part => part.text).join('');
  if (copy.role === 'assistant') {
    delete copy.reasoning_content;
    delete copy.reasoning;
    copy.content ??= '';
    if (copy.refusal == null) delete copy.refusal;
    if (Array.isArray(copy.annotations) && !copy.annotations.length) delete copy.annotations;
    if (!copy.tool_calls?.length) delete copy.tool_calls;
    else copy.tool_calls = copy.tool_calls.map(({ index, ...call }) => {
      const result = { ...call, function: { ...call.function } };
      if (typeof result.function.arguments === 'string') {
        // Keep number tokens exact (JSON.parse would round large integers). Strip only
        // insignificant JSON whitespace outside strings; key order remains conservative.
        result.function.arguments = result.function.arguments.replace(/"(?:[^"\\]|\\.)*"|\s+/g, token => token.startsWith('"') ? token : '');
      }
      return result;
    });
    if (copy.function_call == null) delete copy.function_call;
  }
  // Local WorkBuddy bookkeeping is not part of the conversation sent to a model.
  for (const key of ['agent', 'messageId', 'model', 'requestModelId', 'requestModelName', 'traceId', 'conversationRequestId', 'argumentsDisplayText', 'rawUsage', 'usage', 'toolResult']) delete copy[key];
  return JSON.stringify(canonical(copy));
}
function append(digest, message) {
  const text = visible(message);
  digest.update(`${Buffer.byteLength(text)}:`).update(text);
  return digest;
}

// Models in the same local routing pool share one conversation. Changing the selected
// model must not discard the previous model's original reasoning. Account changes do.
export function reasoningScope(config, body) {
  const accounts = config.providers.map(p => [p.id, p.baseUrl, config.secrets.providers[p.id]]).sort(([a], [b]) => a.localeCompare(b));
  return hash(JSON.stringify([accounts, config.secrets.gatewayKey, body.user ?? null]));
}

const missing = message => message.reasoning_content == null || message.reasoning_content === '';
const contentHash = message => hash(visible({ role: 'assistant', content: message.content }));
function anchor(scope, messages) {
  const user = messages.find(message => message.role === 'user');
  return user ? hash(scope + visible(user)) : null;
}
function fragmentKey(scopeAnchor, tool) {
  if (!scopeAnchor || typeof tool?.id !== 'string' || !tool.id || typeof tool.function?.name !== 'string' || !tool.function.name || typeof tool.function.arguments !== 'string') return null;
  return hash(scopeAnchor + visible({ role: 'assistant', tool_calls: [tool] }));
}

export class ReasoningCache {
  constructor({ ttlMs = 86400000, maxEntries = 1024, maxBytes = 32 * 1024 * 1024, now = Date.now } = {}) {
    this.ttlMs = ttlMs; this.maxEntries = maxEntries; this.maxBytes = maxBytes; this.now = now;
    this.entries = new Map(); this.fragments = new Map(); this.bytes = 0; this.epoch = 0; this.onChange = () => {};
  }
  delete(key) {
    const entry = this.entries.get(key);
    if (entry) {
      this.bytes -= entry.bytes;
      for (const fragment of entry.fragmentKeys) {
        const group = this.fragments.get(fragment); group?.delete(key);
        if (!group?.size) this.fragments.delete(fragment);
      }
    }
    this.entries.delete(key);
    if (entry) this.onChange();
  }
  clear(notify = true) { this.entries.clear(); this.fragments.clear(); this.bytes = 0; this.epoch++; if (notify) this.onChange(); }
  prune() { for (const [key, entry] of this.entries) if (entry.expires <= this.now()) this.delete(key); }
  snapshot() { this.prune(); return { version: 1, entries: [...this.entries].map(([key, entry]) => [key, { ...entry }]) }; }
  hydrate(data) {
    if (data?.version !== 1 || !Array.isArray(data.entries) || data.entries.length > this.maxEntries) throw new Error('invalid cache');
    const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    const loaded = new Map(); let bytes = 0;
    for (const pair of data.entries) {
      if (!Array.isArray(pair) || pair.length !== 2) throw new Error('invalid cache');
      const [key, e] = pair;
      if (!hex(key) || loaded.has(key) || !e || !(e.reasoning === null || typeof e.reasoning === 'string') || !hex(e.contentHash) || typeof e.fragmentAmbiguous !== 'boolean' || !Array.isArray(e.fragmentKeys) || e.fragmentKeys.length > 128 || !e.fragmentKeys.every(hex) || !Number.isFinite(e.expires) || e.expires > this.now() + this.ttlMs) throw new Error('invalid cache');
      const size = (e.reasoning?.length ?? 0) * 2 + 256 + e.fragmentKeys.length * 256;
      if (size > CAPTURE_LIMIT) throw new Error('invalid cache');
      if (e.expires <= this.now()) continue;
      bytes += size; if (bytes > this.maxBytes) throw new Error('invalid cache');
      loaded.set(key, { reasoning: e.reasoning, contentHash: e.contentHash, fragmentKeys: e.fragmentKeys, fragmentAmbiguous: e.fragmentAmbiguous, expires: e.expires, bytes: size });
    }
    this.clear(false); this.entries = loaded; this.bytes = bytes;
    for (const [key, entry] of loaded) for (const fragment of entry.fragmentKeys) {
      if (!this.fragments.has(fragment)) this.fragments.set(fragment, new Map());
      const group = this.fragments.get(fragment);
      if (group.size) { entry.fragmentAmbiguous = true; for (const other of group.values()) other.fragmentAmbiguous = true; }
      group.set(key, entry);
    }
  }
  restore(scope, messages) {
    this.prune(); const digest = createHash('sha256').update(scope), scopeAnchor = anchor(scope, messages);
    const restored = messages.map(message => {
      append(digest, message);
      if (message.role !== 'assistant' || !missing(message)) return message;
      // Some harnesses retain the original text under this alias, even after restart.
      if (typeof message.reasoning === 'string' && message.reasoning.length) return { ...message, reasoning_content: message.reasoning };
      const entry = this.entries.get(digest.copy().digest('hex'));
      return typeof entry?.reasoning === 'string' ? { ...message, reasoning_content: entry.reasoning } : message;
    });
    // WorkBuddy splits one parallel response into text + assistant/tool pairs. Match
    // complete call identities and a common captured response, never a bare call ID.
    for (let i = 0; i < restored.length; i++) {
      const message = restored[i];
      if (message.role !== 'assistant' || !message.tool_calls?.length) continue;
      const keys = message.tool_calls.map(tool => fragmentKey(scopeAnchor, tool));
      if (keys.some(key => !key || !this.fragments.has(key))) continue;
      const possible = [...this.fragments.get(keys[0]).keys()].filter(key => keys.every(fragment => this.fragments.get(fragment).has(key)));
      if (possible.length !== 1) continue;
      const entry = this.entries.get(possible[0]);
      if (typeof entry?.reasoning !== 'string' || entry.fragmentAmbiguous) continue;
      if (contentHash(message) !== contentHash({ content: '' }) && contentHash(message) !== entry.contentHash) continue;
      if (!missing(message) && message.reasoning_content !== entry.reasoning) continue;
      if (missing(message)) restored[i] = { ...message, reasoning_content: entry.reasoning };
      const previous = restored[i - 1];
      if (keys.includes(entry.fragmentKeys[0]) && previous?.role === 'assistant' && !previous.tool_calls?.length && !previous.function_call && missing(previous) && contentHash(previous) === entry.contentHash && entry.contentHash !== contentHash({ content: '' })) {
        restored[i - 1] = { ...previous, reasoning_content: entry.reasoning };
      }
    }
    return restored;
  }
  remember(scope, messages, choices) {
    this.prune(); const digest = createHash('sha256').update(scope); const inserted = [], scopeAnchor = anchor(scope, messages);
    for (const message of messages) append(digest, message);
    for (const choice of choices ?? []) {
      const message = choice?.message;
      if (message?.role !== 'assistant') continue;
      const eligible = complete(choice) && typeof message.reasoning_content === 'string';
      const tools = message.tool_calls ?? [];
      const fragments = tools.length <= 128 ? tools.map(tool => fragmentKey(scopeAnchor, tool)) : [];
      const fragmentKeys = fragments.every(Boolean) ? fragments : [];
      const overhead = 256 + fragmentKeys.length * 256;
      const bytes = eligible ? message.reasoning_content.length * 2 + overhead : overhead;
      const key = append(digest.copy(), message).digest('hex');
      const previous = this.entries.get(key);
      // Identical visible histories can have different hidden reasoning (parallel generations).
      // Keep an ambiguity marker instead of guessing which generation the client used.
      const oversized = !eligible || bytes > CAPTURE_LIMIT || bytes > this.maxBytes;
      if (oversized && !previous && !fragmentKeys.length) continue;
      const reasoning = oversized || previous && previous.reasoning !== message.reasoning_content ? null : message.reasoning_content;
      this.delete(key);
      const entry = { reasoning, fragmentKeys, fragmentAmbiguous: previous?.fragmentAmbiguous ?? false, contentHash: contentHash(message), bytes: reasoning === null ? overhead : bytes, expires: this.now() + this.ttlMs };
      this.entries.set(key, entry); this.bytes += entry.bytes;
      for (const fragment of fragmentKeys) {
        if (!this.fragments.has(fragment)) this.fragments.set(fragment, new Map());
        const group = this.fragments.get(fragment);
        // A reused call identity must stay ambiguous even if one colliding entry is
        // evicted earlier. Full-history matches can still identify the exact reply.
        if (group.size) { entry.fragmentAmbiguous = true; for (const other of group.values()) other.fragmentAmbiguous = true; }
        group.set(key, entry);
      }
      if (reasoning !== null) inserted.push([key, entry]);
      while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) this.delete(this.entries.keys().next().value);
    }
    this.onChange();
    // Failed streams must not leave newly captured response fragments available for replay.
    return () => { for (const [key, entry] of inserted) if (this.entries.get(key) === entry) this.delete(key); };
  }
}

// A bounded observer; the gateway still sends the original SSE bytes to the AI tool.
export class ReasoningStream {
  constructor() { this.items = new Map(); this.bytes = 0; this.valid = true; }
  invalidate() { this.valid = false; this.items.clear(); }
  accept(event) {
    if (!this.valid || !Array.isArray(event.choices)) return;
    this.bytes += JSON.stringify(event.choices).length * 2;
    if (this.bytes > CAPTURE_LIMIT) { this.invalidate(); return; }
    for (const choice of event.choices) {
      const index = choice.index ?? 0;
      if (!Number.isInteger(index) || index < 0 || index > 15) { this.invalidate(); return; }
      if (!this.items.has(index)) this.items.set(index, { message: { role: 'assistant', content: '' }, tools: new Map(), finish_reason: null });
      const item = this.items.get(index), delta = choice.delta ?? {};
      if (delta.role && delta.role !== 'assistant') { this.invalidate(); return; }
      for (const field of ['content', 'reasoning_content']) {
        if (delta[field] == null) continue;
        if (typeof delta[field] !== 'string') { this.invalidate(); return; }
        item.message[field] = (item.message[field] ?? '') + delta[field];
      }
      if (delta.function_call) { this.invalidate(); return; }
      if (delta.tool_calls != null && !Array.isArray(delta.tool_calls)) { this.invalidate(); return; }
      for (const tool of delta.tool_calls ?? []) {
        if (!Number.isInteger(tool.index) || tool.index < 0 || tool.index > 127) { this.invalidate(); return; }
        if (!item.tools.has(tool.index)) item.tools.set(tool.index, { id: '', type: 'function', function: { name: '', arguments: '' } });
        const target = item.tools.get(tool.index);
        if (tool.type && tool.type !== 'function') { this.invalidate(); return; }
        for (const [value, object, field] of [[tool.id, target, 'id'], [tool.function?.name, target.function, 'name'], [tool.function?.arguments, target.function, 'arguments']]) {
          if (value == null) continue;
          if (typeof value !== 'string') { this.invalidate(); return; }
          object[field] += value;
        }
      }
      if (choice.finish_reason != null) item.finish_reason = choice.finish_reason;
    }
  }
  choices() {
    if (!this.valid) return [];
    return [...this.items.values()].flatMap(item => {
      const tools = [...item.tools].sort(([a], [b]) => a - b);
      if (tools.some(([index, tool], i) => index !== i || !tool.id || !tool.function.name)) return [];
      return [{ finish_reason: item.finish_reason, message: { ...item.message, ...(tools.length ? { tool_calls: tools.map(([, tool]) => tool) } : {}) } }];
    });
  }
}

export async function isReasoningHistoryError(response) {
  // Inspect only a small error body and never return upstream text (it may include secrets).
  if (response.status !== 400 || !response.body) return false;
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = ''; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 65536) return false;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const message = JSON.parse(text)?.error?.message;
    return typeof message === 'string' && /reasoning_content/i.test(message) && /must|required|missing|passed\s*back|缺少|回传|必[须填]/i.test(message);
  } catch { return false; }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
