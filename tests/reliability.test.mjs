import test from 'node:test';
import assert from 'node:assert/strict';
import { upstreamFailure, ModelHealth } from '../core/upstream-errors.mjs';
import { Scoring } from '../core/scoring.mjs';
import { defaults } from '../core/config.mjs';

const response = (status, error, headers = {}) => new Response(JSON.stringify({ error }), { status, headers });
for (const [status, message, code, retry] of [
  [400, 'The product is not activated, please confirm that you have activated products and try again after activation.', 'model_not_activated', true],
  [402, 'insufficient balance', 'insufficient_balance', true],
  [401, 'invalid api key private-secret', 'upstream_authentication', true],
  [404, 'model not found', 'model_not_found', true],
  [403, 'permission denied', 'model_access_denied', true],
  [429, 'rate limit', 'upstream_rate_limited', true],
  [503, 'temporarily unavailable private-prompt', 'upstream_unavailable', true],
  [400, 'maximum context length exceeded', 'context_limit', true],
  [400, 'model does not support tool calls', 'model_capability', true],
  [400, 'content_filter rejected', 'content_rejected', false],
  [400, 'reasoning_content is missing', 'reasoning_history_missing', false],
  [400, 'bad temperature private-secret', 'upstream_invalid_request', false],
]) test(`provider error ${code} is actionable and never exposes the raw body`, async () => {
  const failure = await upstreamFailure(response(status, { code: 'InvalidParameter', message }));
  assert.equal(failure.code, code); assert.equal(failure.retry, retry); assert.doesNotMatch(failure.message, /private-secret|private-prompt/);
});

test('error parsing is bounded, accepts top-level channel errors and caps Retry-After', async () => {
  const root = new Response(JSON.stringify({ code: 'InvalidParameter', message: 'The product is not activated' }), { status: 400 });
  assert.equal((await upstreamFailure(root)).code, 'model_not_activated');
  for (const body of ['not-json private-secret', JSON.stringify({ error: { message: 'private-secret '.repeat(8000) } })]) {
    const failure = await upstreamFailure(new Response(body, { status: 400 }));
    assert.equal(failure.code, 'upstream_invalid_request'); assert.doesNotMatch(failure.message, /private-secret/);
  }
  assert.equal((await upstreamFailure(response(429, {}, { 'retry-after': '999999' }))).cooldownMs, 120000);
});

test('cooldowns isolate models or channels as appropriate, expire and reset on credential changes', async () => {
  let now = 0; const health = new ModelHealth({ now: () => now, limit: 2 });
  const c = { secrets: { providers: { p: 'first-key' } } }, p = { id: 'p', baseUrl: 'https://provider.test' };
  const one = { model: 'a' }, two = { model: 'b' };
  health.fail(c, p, one, await upstreamFailure(response(400, { message: 'product is not activated' })));
  assert(health.blocked(c, p, one)); assert.equal(health.blocked(c, p, two), undefined);
  assert.equal(health.blocked({ secrets: { providers: { p: 'new-key' } } }, p, one), undefined);
  now = 120000; assert.equal(health.blocked(c, p, one), undefined);
  health.fail(c, p, one, await upstreamFailure(response(401, {}))); assert(health.blocked(c, p, two));
  assert(!JSON.stringify([...health.entries]).includes('first-key'));
  health.clear(); assert.equal(health.entries.size, 0);
});

const scores = { score: 5, feature_scores: { domain1: 1, domain2: 1, domain3: 1, domain4: 1, domain5: 1 } };
const config = () => { const c = defaults(); c.secrets.tiersenseKey = 'private-score-key'; return c; };
const body = () => ({ messages: [{ role: 'user', content: 'private task' }] });
const signal = () => new AbortController().signal;
test('exact score reuse avoids repeated calls but never reuses a different step, task, user or account', async () => {
  let calls = 0, now = 0;
  const cache = new Scoring(async () => { calls++; return Response.json(scores); }, { now: () => now, ttlMs: 100, maxEntries: 2 });
  const c = config(), b = body();
  const first = await cache.get(c, b, signal()); first.scores.score = 0;
  assert.equal((await cache.get(c, b, signal())).scores.score, 5); assert.equal(calls, 1);
  for (const changed of [{ ...b, user: 'other-user' }, { ...b, tierflow_task: 'other-task' }, { messages: [...b.messages, { role: 'tool', content: 'new result' }] }]) await cache.get(c, changed, signal());
  assert.equal(calls, 4); assert.equal(cache.completed.size, 2);
  const latest = { messages: [...b.messages, { role: 'tool', content: 'new result' }] };
  assert.equal((await cache.get(c, latest, signal())).source, 'cache');
  const changedKey = structuredClone(c); changedKey.secrets.tiersenseKey = 'changed'; await cache.get(changedKey, latest, signal()); assert.equal(calls, 5);
  now = 101; await cache.get(changedKey, latest, signal()); assert.equal(calls, 6);
  assert.doesNotMatch(JSON.stringify([...cache.completed]), /private task|private-score-key/);
});

test('concurrent identical scoring is shared; cancelling one client does not abort the other', async () => {
  let calls = 0, release, upstreamSignal;
  const scoring = new Scoring(async (_url, init) => { calls++; upstreamSignal = init.signal; await new Promise(resolve => { release = resolve; }); return Response.json(scores); });
  const c = config(), b = body(), a = new AbortController();
  const first = scoring.get(c, b, a.signal); const second = scoring.get(c, b, signal());
  const rejected = assert.rejects(first); a.abort(); await rejected;
  assert.equal(upstreamSignal.aborted, false); release();
  assert.equal((await second).source, 'shared'); assert.equal(calls, 1);
});

test('cancelled/failed scoring cannot poison reuse or survive clear, and retry is possible', async () => {
  let calls = 0;
  const scoring = new Scoring(async (_url, init) => { calls++; if (calls === 1) return response(503, {}); return Response.json(scores); });
  const c = config(), b = body(); await assert.rejects(scoring.get(c, b, signal()));
  assert.equal(scoring.completed.size, 0); await scoring.get(c, b, signal()); assert.equal(calls, 2);
  scoring.clear(); assert.equal(scoring.completed.size, 0);
  let release, observedSignal;
  const pending = new Scoring(async (_url, init) => { observedSignal = init.signal; await new Promise(resolve => { release = resolve; }); return Response.json(scores); });
  const a = new AbortController(), request = pending.get(c, b, a.signal), rejected = assert.rejects(request);
  a.abort(); await rejected; assert.equal(observedSignal.aborted, true); release();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(pending.completed.size, 0); assert.equal(pending.pending.size, 0);
});
