import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { GatewayError, validateChat, candidates } from './router.mjs';
import { selectRoute } from './policy.mjs';
import { readUsage, estimateCost } from './usage.mjs';
import { ReasoningCache, ReasoningStream, reasoningScope } from './reasoning.mjs';
import { ModelHealth, upstreamFailure } from './upstream-errors.mjs';
import { Scoring } from './scoring.mjs';

function sameKey(received, expected) {
  const a = Buffer.from(received ?? ''); const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
async function readJson(req) {
  let size = 0; const buffers = [];
  for await (const chunk of req) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new GatewayError('请求超过 8 MB 限制', 413, 'request_too_large'); buffers.push(chunk); }
  try { return JSON.parse(Buffer.concat(buffers).toString()); } catch { throw new GatewayError('请求 JSON 无法解析'); }
}
export class Gateway extends EventEmitter {
  constructor(store, fetcher = fetch, history = null) { super(); this.store = store; this.fetcher = fetcher; this.history = history; this.reasoning = new ReasoningCache(); this.scoring = new Scoring(fetcher); this.health = new ModelHealth(); this.server = null; this.logs = history?.entries.slice(0, 500) ?? []; this.active = new Set(); this.handles = new Set(); this.startedAt = null; this.transition = Promise.resolve(); this.total = 0; this.totalTokens = 0; this.usageSamples = 0; }
  status() { return { running: !!this.server?.listening, port: this.server?.address()?.port ?? this.store.config.settings.port, active: this.active.size, startedAt: this.startedAt, total: this.total, totalTokens: this.usageSamples ? this.totalTokens : null }; }
  notify() { this.emit('change'); }
  availability() {
    const config = this.store.snapshot();
    return config.models.filter(model => model.enabled).flatMap(model => {
      const provider = config.providers.find(p => p.id === model.providerId && p.enabled);
      if (!provider) return [];
      const blocked = this.health.blocked(config, provider, model);
      return blocked ? [{ modelId: model.id, providerId: provider.id, code: blocked.error.code, message: blocked.error.message, retryAt: blocked.until }] : [];
    });
  }
  async start() {
    const op = this.transition.then(async () => {
      if (this.server?.listening) return this.status();
      const server = http.createServer((req, res) => { const task = this.handle(req, res); this.handles.add(task); void task.finally(() => this.handles.delete(task)); });
      server.requestTimeout = 30000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.store.config.settings.port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
      });
      server.on('error', () => { this.notify(); });
      this.reasoningTimer = setInterval(() => this.reasoning.prune(), 60000); this.reasoningTimer.unref();
      this.server = server; this.startedAt = Date.now(); this.notify(); return this.status();
    });
    this.transition = op.catch(() => {}); return op;
  }
  async stop() {
    const op = this.transition.then(async () => {
      for (const controller of this.active) controller.abort(new GatewayError('服务已暂停，请求已取消', 499, 'cancelled'));
      if (this.server) { const s = this.server; s.closeAllConnections(); await new Promise(resolve => s.close(resolve)); this.server = null; }
      await Promise.allSettled([...this.handles]); await this.history?.flush();
      clearInterval(this.reasoningTimer); this.scoring.clear(); this.health.clear();
      await this.reasoningVault?.flush();
      if (!this.reasoningVault?.enabled) this.reasoning.clear();
      this.startedAt = null; this.notify(); return this.status();
    });
    this.transition = op.catch(() => {}); return op;
  }
  async handle(req, res) {
    const config = this.store.snapshot();
    const path = req.url?.split('?')[0];
    // Loopback-only binding, Host checks and no CORS prevent browser pages from using the proxy.
    const expectedPort = this.server?.address()?.port ?? config.settings.port;
    if (![`127.0.0.1:${expectedPort}`, `localhost:${expectedPort}`].includes(req.headers.host) || req.headers.origin) return json(res, 403, { error: { message: '只接受本机 Agent 请求', type: 'access_denied' } });
    if (!sameKey(req.headers.authorization, config.secrets.gatewayKey)) return json(res, 401, { error: { message: '本地 API Key 无效', type: 'authentication_error' } });
    if (req.method === 'GET' && path === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: 'tierflow-auto', object: 'model', created: 0, owned_by: 'tierflow-local' }] });
    if (req.method === 'GET' && path === '/health') return json(res, 200, { status: 'ok', ...this.status() });
    if (req.method !== 'POST' || path !== '/v1/chat/completions') return json(res, 404, { error: { message: '此版本支持 /v1/chat/completions 与 /v1/models；请使用 Chat Completions 协议', type: 'unsupported_endpoint' } });
    if (this.active.size >= 8) return json(res, 429, { error: { message: '本地并发上限为 8，请稍后重试', type: 'concurrency_limit' } });
    if (!req.headers['content-type']?.includes('application/json')) return json(res, 415, { error: { message: 'Content-Type 须为 application/json', type: 'invalid_request' } });
    const controller = new AbortController(); this.active.add(controller); this.notify();
    const reasoningEpoch = this.reasoning.epoch;
    res.on('close', () => { if (!res.writableEnded) controller.abort(new GatewayError('AI 工具已取消本次请求', 499, 'cancelled')); });
    const entry = { id: randomUUID(), time: Date.now(), status: 'pending', model: '', modelId: '', provider: '', providerId: '', tier: '', score: null, scoreMs: 0, durationMs: 0, inputTokens: null, outputTokens: null, totalTokens: null, cachedTokens: null, reasoningTokens: null, fallback: false, attempts: 0, error: '', code: '', pricing: null };
    entry.scoreSource = 'live'; entry.retryTrace = []; entry.modelMs = null; entry.upstreamWaitMs = null;
    let timeout; let discardReasoning; let modelStartedAt;
    try {
      const body = await readJson(req); validateChat(body);
      timeout = setTimeout(() => controller.abort(new GatewayError('本次请求等待超时，请稍后重试或在设置中调整等待时间。', 504, 'request_timeout')), config.settings.requestTimeoutMs);
      const scoreStart = Date.now(); let scores;
      try { const result = await this.scoring.get(config, body, controller.signal); scores = result.scores; entry.scoreSource = result.source; }
      catch (error) {
        if (controller.signal.aborted || config.settings.failureMode !== 'fallback' || !config.settings.fallbackModelId || error.code === 'tiersense_not_configured') throw error;
        entry.fallback = true; entry.code = error.code;
      }
      finally { entry.scoreMs = Date.now() - scoreStart; }
      entry.score = scores?.score ?? null;
      entry.featureScores = scores?.feature_scores ?? null;
      entry.route = scores ? selectRoute(scores, config.routing, config.models) : null;
      const pool = candidates(config, body, scores, entry.fallback);
      let upstream; let scope; let requestMessages; let lastFailure;
      modelStartedAt = Date.now();
      for (const model of pool) {
        controller.signal.throwIfAborted();
        const provider = config.providers.find(p => p.id === model.providerId);
        const trace = (code, skipped, elapsed, status = null) => {
          if (entry.retryTrace.length < 12) entry.retryTrace.push({ model: model.model, provider: provider.name, code, skipped, durationMs: elapsed, status });
        };
        const blocked = this.health.blocked(config, provider, model);
        if (blocked) { lastFailure = blocked.error; trace(blocked.error.code, true, 0); entry.fallback = true; continue; }
        if (entry.attempts >= 3) break;
        entry.model = model.model; entry.provider = provider.name; entry.tier = model.tier; entry.attempts++;
        entry.modelId = model.id; entry.providerId = provider.id; entry.pricing = model.pricing ?? null;
        entry.tierName = config.routing.tiers.find(t => t.id === model.tier)?.name ?? model.tier;
        const { tierflow_task, ...requestBody } = body;
        scope = reasoningScope(config, body);
        requestMessages = this.reasoning.restore(scope, body.messages);
        requestBody.messages = requestMessages;
        if (body.stream && provider.requestUsage) requestBody.stream_options = { ...requestBody.stream_options, include_usage: true };
        const started = Date.now();
        try {
          upstream = await this.fetcher(`${provider.baseUrl}/chat/completions`, { method: 'POST', redirect: 'error', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.secrets.providers[provider.id]}` },
            body: JSON.stringify({ ...requestBody, model: model.model }) });
        } catch (error) {
          controller.signal.throwIfAborted();
          lastFailure = new GatewayError('模型渠道连接失败，请检查地址与网络。', 502, 'upstream_connection');
          trace(lastFailure.code, false, Date.now() - started);
          // Only retry definite connection failures. An unknown timeout may already
          // have reached the provider and generated billable output.
          if (!['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(error.cause?.code ?? error.code)) throw lastFailure;
          entry.fallback = true; continue;
        }
        entry.upstreamWaitMs = Date.now() - started;
        if (upstream.ok) { trace('', false, entry.upstreamWaitMs, upstream.status); break; }
        lastFailure = await upstreamFailure(upstream);
        trace(lastFailure.code, false, Date.now() - started, upstream.status);
        this.health.fail(config, provider, model, lastFailure);
        if (!lastFailure.retry) throw lastFailure;
        entry.fallback = true;
      }
      if (!upstream?.ok) throw lastFailure ?? new GatewayError('所有候选渠道暂时不可用', 503, 'upstream_unavailable');
      if (body.stream) {
        if (!upstream.headers.get('content-type')?.includes('text/event-stream')) { await upstream.body?.cancel(); throw new GatewayError('模型渠道未返回 SSE 流', 502, 'invalid_stream'); }
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no', 'X-TierFlow-Request-Id': entry.id });
        // Forward original SSE bytes; observe bounded reasoning/tool deltas for history replay.
        const reasoningStream = new ReasoningStream();
        const decoder = new TextDecoder(); let pending = ''; let finished = false; let skippingLine = false;
        const inspectLine = line => {
          if (!line.startsWith('data:')) return;
          if (line.length >= 262144) { reasoningStream.invalidate(); return; }
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            if (!finished && reasoningEpoch === this.reasoning.epoch) discardReasoning = this.reasoning.remember(scope, requestMessages, reasoningStream.choices());
            finished = true; return;
          }
          try { const event = JSON.parse(data); if (event.error) throw new GatewayError('模型在流中返回错误', 502, 'upstream_stream_error'); if (event.usage) this.usage(entry, event.usage); reasoningStream.accept(event); }
          catch (error) { if (error instanceof GatewayError) throw error; reasoningStream.invalidate(); }
        };
        for await (const chunk of upstream.body) {
          if (controller.signal.aborted) throw new GatewayError('请求已取消', 499, 'cancelled');
          pending += decoder.decode(chunk, { stream: true });
          const lines = pending.split('\n'); pending = lines.pop() ?? '';
          for (const line of lines) { if (skippingLine) { skippingLine = false; continue; } inspectLine(line); }
          if (pending.length > 262144) { pending = ''; skippingLine = true; reasoningStream.invalidate(); }
          if (!res.write(chunk)) await once(res, 'drain', { signal: controller.signal });
        }
        if (!skippingLine) inspectLine(pending + decoder.decode());
        if (!finished) throw new GatewayError('模型响应流提前结束，未收到完成标记', 502, 'incomplete_stream');
        res.end();
      } else {
        let data;
        try { data = await upstream.json(); } catch { throw new GatewayError('模型渠道未返回有效 JSON', 502, 'invalid_upstream'); }
        if (data.error || !Array.isArray(data.choices)) throw new GatewayError('模型渠道返回了无效响应', 502, 'invalid_upstream');
        if (data.usage) this.usage(entry, data.usage);
        if (reasoningEpoch === this.reasoning.epoch) discardReasoning = this.reasoning.remember(scope, requestMessages, data.choices);
        res.setHeader('X-TierFlow-Request-Id', entry.id); json(res, 200, data);
      }
      entry.status = 'success';
    } catch (error) {
      discardReasoning?.();
      if (controller.signal.aborted) error = controller.signal.reason;
      entry.status = error?.code === 'cancelled' ? 'cancelled' : 'error';
      entry.error = error instanceof GatewayError ? error.message : '本地网关处理失败';
      entry.code = error.code ?? 'internal_error';
      if (!res.headersSent && !res.destroyed) json(res, error.status ?? 500, { error: { message: entry.error, type: entry.code, request_id: entry.id } });
      else if (!res.destroyed) res.destroy();
    } finally {
      clearTimeout(timeout); this.active.delete(controller); entry.durationMs = Date.now() - entry.time;
      if (modelStartedAt) entry.modelMs = Date.now() - modelStartedAt;
      this.total++;
      entry.cost = estimateCost(entry, entry.pricing);
      if (entry.totalTokens !== null) { this.usageSamples++; this.totalTokens += entry.totalTokens; }
      this.history?.record(entry);
      this.logs.unshift(entry); this.logs = this.logs.slice(0, 500); this.notify();
    }
  }
  usage(entry, usage) {
    for (const [key, value] of Object.entries(readUsage(usage))) if (value !== null) entry[key] = value;
    if (entry.inputTokens !== null && entry.outputTokens !== null) entry.totalTokens = Number.isSafeInteger(entry.inputTokens + entry.outputTokens) ? entry.inputTokens + entry.outputTokens : null;
    if (entry.inputTokens !== null && entry.cachedTokens > entry.inputTokens) entry.cachedTokens = null;
    if (entry.outputTokens !== null && entry.reasoningTokens > entry.outputTokens) entry.reasoningTokens = null;
  }
}
