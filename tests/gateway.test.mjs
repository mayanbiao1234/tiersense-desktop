import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { defaults, routingInput, validUrl } from '../core/config.mjs';
import { Gateway } from '../core/gateway.mjs';

const scores = score => ({ score, feature_scores: { domain1: 1, domain2: 0.5, domain3: 1, domain4: 0.5, domain5: 0 } });
const completion = { id: 'chatcmpl-test', object: 'chat.completion', model: 'actual-model', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 80, completion_tokens: 12 } };
async function fixture(t, options = {}) {
  const observed = []; const config = defaults();
  const upstream = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text || '{}'); observed.push({ path: req.url, authorization: req.headers.authorization, body });
    if (req.url === '/score') {
      res.writeHead(options.scoreStatus ?? 200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(options.scoreBody ?? scores(options.score ?? 5)));
    }
    if (options.upstream) return options.upstream(req, res, body);
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(completion));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${upstream.address().port}`;
  config.settings.port = 0; config.settings.tiersenseUrl = `${base}/score`;
  config.secrets.tiersenseKey = 'score-secret'; config.secrets.providers = { p1: 'provider-secret' };
  config.providers = [{ id: 'p1', name: 'Test provider', baseUrl: `${base}/v1`, enabled: true }];
  config.models = ['economy', 'balanced', 'flagship'].map(tier => ({ id: tier, model: tier, providerId: 'p1', name: tier, tier, enabled: true, priority: 1, tools: true, vision: true }));
  options.configure?.(config);
  const gateway = new Gateway({ config, snapshot: () => structuredClone(config) }); await gateway.start();
  const url = `http://127.0.0.1:${gateway.status().port}`;
  t.after(async () => { await gateway.stop(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); });
  const request = (body = {}, extra = {}) => fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${config.secrets.gatewayKey}`, 'Content-Type': 'application/json', ...extra.headers }, body: JSON.stringify({ model: 'tierflow-auto', messages: [{ role: 'user', content: 'private test prompt' }], ...body }), ...extra.options });
  return { config, gateway, observed, url, request };
}

const agentTools = [{ type: 'function', function: { name: 'Read', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }];
function backupModels(c, count = 1) {
  for (let i = 0; i < count; i++) c.models.push({ ...c.models[1], id: `backup-${i}`, model: `backup-${i}`, priority: i + 2 });
}
function respondError(res, status, message) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message } })); }
function respondOK(res) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(completion)); }

test('unactivated model falls back within its tier, is cooled down, and keeps the three connection fields unchanged', async t => {
  const f = await fixture(t, { configure: c => { backupModels(c); c.settings.allowEscalation = false; }, upstream: (_req, res, body) => body.model === 'balanced' ? respondError(res, 400, 'The product is not activated') : respondOK(res) });
  const original = structuredClone(f.config);
  for (let i = 0; i < 2; i++) { const response = await f.request(); assert.equal(response.status, 200); await response.json(); }
  assert.deepEqual(f.observed.filter(e => e.path !== '/score').map(e => e.body.model), ['balanced', 'backup-0', 'backup-0']);
  assert.equal(f.observed.filter(e => e.path === '/score').length, 1);
  assert.equal(f.gateway.logs[0].scoreSource, 'cache'); assert.equal(f.gateway.logs[1].scoreSource, 'live');
  assert.equal(f.gateway.logs[0].retryTrace[0].skipped, true); assert.equal(f.gateway.logs[0].retryTrace[0].code, 'model_not_activated');
  assert.deepEqual(Object.keys(f.gateway.availability()[0]), ['modelId', 'providerId', 'code', 'message', 'retryAt']);
  assert.equal(f.gateway.availability()[0].modelId, 'balanced');
  assert.doesNotMatch(JSON.stringify(f.gateway.availability()), /provider-secret|score-secret|private test prompt/);
  assert(f.gateway.logs.every(e => e.modelMs >= 0 && e.upstreamWaitMs >= 0)); assert.deepEqual(f.config, original);
  f.gateway.health.clear(); assert.deepEqual(f.gateway.availability(), []); await (await f.request({ messages: [{ role: 'user', content: 'different next step' }] })).json();
  assert.equal(f.observed.filter(e => e.path === '/score').length, 2);
  assert.deepEqual(f.observed.filter(e => e.path !== '/score').slice(-2).map(e => e.body.model), ['balanced', 'backup-0']);
});

test('failed candidates stop at three actual attempts and never escalate unless enabled', async t => {
  const f = await fixture(t, { configure: c => { backupModels(c, 4); c.settings.allowEscalation = false; }, upstream: (_req, res) => respondError(res, 400, 'The product is not activated') });
  const response = await f.request(); assert.equal(response.status, 502); assert.equal((await response.json()).error.type, 'model_not_activated');
  assert.equal(f.gateway.logs[0].attempts, 3); assert.equal(f.observed.filter(e => e.path !== '/score').length, 3);
  f.config.models = f.config.models.filter(m => !m.id.startsWith('backup')); f.gateway.health.clear();
  await (await f.request()).json(); assert.equal(f.gateway.logs[0].attempts, 1); assert.equal(f.gateway.logs[0].model, 'balanced');
});

test('bad channel credentials skip its other models while allowing a configured alternative channel', async t => {
  const f = await fixture(t, { configure: c => {
    backupModels(c, 2); c.settings.allowEscalation = false;
    c.providers.push({ ...c.providers[0], id: 'p2', name: 'Second channel' }); c.secrets.providers.p2 = 'second-key'; c.models.at(-1).providerId = 'p2';
  }, upstream: (req, res) => req.headers.authorization === 'Bearer provider-secret' ? respondError(res, 401, 'invalid api key') : respondOK(res) });
  const response = await f.request(); assert.equal(response.status, 200); await response.json();
  assert.deepEqual(f.observed.filter(e => e.path !== '/score').map(e => e.body.model), ['balanced', 'backup-1']);
  assert.equal(f.gateway.logs[0].retryTrace[1].skipped, true); assert.equal(f.gateway.logs[0].attempts, 2);
});

for (const message of ['content_filter rejected', 'bad temperature']) test(`non-retryable rejection is never replayed: ${message}`, async t => {
  const f = await fixture(t, { configure: backupModels, upstream: (_req, res) => respondError(res, 400, message) });
  const response = await f.request(); assert.equal(response.status, 400); await response.json();
  assert.equal(f.gateway.logs[0].attempts, 1); assert.equal(f.observed.filter(e => e.path !== '/score').length, 1);
});

test('clearing compatibility history during an active response prevents that response from recreating cleared data', async t => {
  let release, arrived; const waiting = new Promise(resolve => { arrived = resolve; });
  const f = await fixture(t, { upstream: (_req, res) => { release = () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reasoningResponse({ role: 'assistant', content: 'answer', reasoning_content: 'original' }))); }; arrived(); } });
  const request = f.request(); await waiting; f.gateway.reasoning.clear(); release();
  assert.equal((await request).status, 200); assert.equal(f.gateway.reasoning.entries.size, 0);
});

test('a model deadline returns an actionable timeout, does not replay uncertain work and is not logged as user cancellation', async t => {
  const f = await fixture(t, { configure: c => { backupModels(c); c.settings.requestTimeoutMs = 100; }, upstream: () => {} });
  const response = await f.request(); assert.equal(response.status, 504); assert.equal((await response.json()).error.type, 'request_timeout');
  assert.equal(f.gateway.logs[0].status, 'error'); assert.equal(f.gateway.logs[0].attempts, 1);
});
const withoutReasoning = ({ reasoning_content, ...message }) => message;
const reasoningResponse = (message, finish_reason = 'stop') => ({ ...completion, choices: [{ index: 0, message, finish_reason }] });
function rejectMissingReasoning(res, body) {
  if (!body.tools?.length || !body.messages.some(m => m.role === 'assistant' && !m.reasoning_content)) return false;
  res.writeHead(400, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Missing reasoning_content in assistant message; it must be passed back. private upstream secret' } }));
  return true;
}

test('WorkBuddy-style omitted reasoning is recovered across tools, plain assistant turns and next user question', async t => {
  let turn = 0;
  const emitted = [];
  const f = await fixture(t, { configure: c => { c.models[1].model = 'deepseek-v4.1-flash'; }, upstream: (_req, res, body) => {
    if (rejectMissingReasoning(res, body)) return;
    const message = { role: 'assistant', content: turn === 0 ? null : `answer-${turn}`, reasoning_content: `原始思考-${turn}\n  请保留空格` };
    if (turn === 0) message.tool_calls = [{ id: 'call-read', type: 'function', function: { name: 'Read', arguments: '{ "path": "a.txt" }' } }];
    emitted.push(message); res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reasoningResponse(message, turn++ === 0 ? 'tool_calls' : 'stop')));
  } });
  const messages = [{ role: 'system', content: 'Act as a file assistant' }, { role: 'user', content: 'Read a.txt' }];
  for (let i = 0; i < 3; i++) {
    const response = await f.request({ messages, tools: agentTools, thinking: { type: 'enabled' }, tool_choice: 'auto', parallel_tool_calls: true });
    assert.equal(response.status, 200, await response.clone().text());
    const data = await response.json(); assert.deepEqual(data.choices[0].message, emitted[i]);
    messages.push(withoutReasoning(data.choices[0].message));
    if (i === 0) messages.push({ role: 'tool', tool_call_id: 'call-read', content: 'File contents' });
    else messages.push({ role: 'user', content: 'Continue with a new task' });
  }
  const calls = f.observed.filter(e => e.path !== '/score');
  assert.deepEqual(calls[2].body.messages.filter(m => m.role === 'assistant').map(m => m.reasoning_content), emitted.slice(0, 2).map(m => m.reasoning_content));
  assert.equal(calls[2].body.model, 'deepseek-v4.1-flash');
  assert.deepEqual(calls[2].body.thinking, { type: 'enabled' });
  assert.deepEqual(calls[2].body.tools, agentTools); assert.equal(calls[2].body.parallel_tool_calls, true);
  assert(f.observed.filter(e => e.path === '/score').every(e => e.body.messages.every(m => m.reasoning_content === undefined)));
  assert.equal(JSON.stringify(f.gateway.logs).includes('原始思考'), false);
  assert.equal(JSON.stringify(f.gateway.logs).includes('File contents'), false);
  await f.gateway.stop(); assert.equal(f.gateway.reasoning.entries.size, 0);
});

test('OpenClaw/OpenCode replay preserves explicit reasoning and restores empty placeholders after text-block reserialization', async t => {
  const answer = { role: 'assistant', content: '检查完成', reasoning_content: '先确认文件状态', refusal: null };
  const f = await fixture(t, { upstream: (_req, res, body) => { if (rejectMissingReasoning(res, body)) return; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reasoningResponse(answer))); } });
  const user = { role: 'user', content: '检查文件' };
  assert.equal((await (await f.request({ messages: [user] })).json()).choices[0].message.reasoning_content, answer.reasoning_content);
  const messages = [{ ...user, content: [{ type: 'text', text: user.content }] }, { role: 'assistant', content: [{ type: 'text', text: answer.content }], reasoning_content: '' }, { role: 'user', content: '继续' }];
  const replay = await f.request({ messages, tools: agentTools }); assert.equal(replay.status, 200); await replay.json();
  assert.equal(f.observed.at(-1).body.messages[1].reasoning_content, answer.reasoning_content);
  messages[1].reasoning_content = '来自工具的完整原文';
  await (await f.request({ messages, tools: agentTools })).json();
  assert.equal(f.observed.at(-1).body.messages[1].reasoning_content, messages[1].reasoning_content);
});

test('raw fragmented SSE reasoning and parallel tools can be replayed immediately at DONE before upstream closes', async t => {
  const user = { role: 'user', content: 'Read two files' };
  const events = [
    { choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '需要检查甲' } }] },
    { choices: [{ index: 0, delta: { reasoning_content: '和乙\n', tool_calls: [{ index: 1, id: 'b', type: 'function', function: { name: 'Read', arguments: '{"path":' } }, { index: 0, id: 'a', type: 'function', function: { name: 'Read', arguments: '{"path":' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"甲"}' } }, { index: 1, function: { arguments: '"乙"}' } }] }, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 30, prompt_cache_hit_tokens: 50 } },
  ];
  const wire = events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n';
  let finishUpstream;
  const f = await fixture(t, { upstream: async (_req, res, body) => {
    if (rejectMissingReasoning(res, body)) return;
    if (!body.stream) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(completion)); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    finishUpstream = () => res.end();
    const bytes = Buffer.from(wire);
    const unicode = bytes.indexOf(Buffer.from('甲')) + 1;
    res.write(bytes.subarray(0, unicode));
    await new Promise(resolve => setImmediate(resolve)); res.write(bytes.subarray(unicode));
  } });
  const response = await f.request({ messages: [user], tools: agentTools, stream: true });
  const reader = response.body.getReader(), decoder = new TextDecoder(); let received = '';
  while (!received.includes('[DONE]')) { const { value, done } = await reader.read(); assert.equal(done, false); received += decoder.decode(value, { stream: true }); }
  const message = { role: 'assistant', content: null, tool_calls: ['a', 'b'].map((id, i) => ({ id, type: 'function', function: { name: 'Read', arguments: JSON.stringify({ path: ['甲', '乙'][i] }) } })) };
  const followup = await f.request({ messages: [user, message, { role: 'tool', tool_call_id: 'a', content: 'A' }, { role: 'tool', tool_call_id: 'b', content: 'B' }], tools: agentTools });
  assert.equal(followup.status, 200, await followup.clone().text()); await followup.json();
  assert.equal(f.observed.at(-1).body.messages[1].reasoning_content, '需要检查甲和乙\n');
  finishUpstream();
  while (true) { const { value, done } = await reader.read(); if (done) break; received += decoder.decode(value, { stream: true }); }
  received += decoder.decode(); assert.equal(received, wire);
});

test('missing old reasoning produces sanitized guidance without fabricating content or replaying 400', async t => {
  const message = { role: 'assistant', content: 'Done', reasoning_content: 'original' };
  const f = await fixture(t, { upstream: (_req, res, body) => { if (rejectMissingReasoning(res, body)) return; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reasoningResponse(message))); } });
  const messages = [{ role: 'user', content: 'same question' }];
  await (await f.request({ messages, tools: agentTools })).json();
  f.gateway.reasoning.clear(); // Simulate an old conversation after a service restart.
  messages.push(withoutReasoning(message), { role: 'user', content: 'continue' });
  const response = await f.request({ messages, tools: agentTools });
  assert.equal(response.status, 400); const data = await response.json(); assert.equal(data.error.type, 'reasoning_history_missing');
  assert.equal(JSON.stringify(data).includes('private upstream secret'), false);
  assert.equal(f.gateway.logs[0].attempts, 1);
  assert.equal(f.observed.at(-1).body.messages[1].reasoning_content, undefined);
  assert.equal(f.observed.filter(e => e.path !== '/score').length, 2);
});

test('Qwen to DeepSeek routing replays WorkBuddy split parallel calls across channels, streaming and subsequent user turns', async t => {
  let turn = 0;
  const emitted = [];
  const f = await fixture(t, { upstream: (_req, res, body) => {
    if (rejectMissingReasoning(res, body)) return;
    const current = turn++;
    const count = [2, 0, 2, 4, 3, 0][current];
    const message = { role: 'assistant', content: current ? `Planning response ${current}` : null, reasoning_content: `模型 ${body.model} 原始思考 ${current}\n  保留空格`,
      ...(count ? { tool_calls: Array.from({ length: count }, (_, i) => ({ id: `call-${current}-${i}`, type: 'function', function: { name: 'Read', arguments: JSON.stringify({ path: `file-${i}` }) } })) } : {}) };
    emitted.push(message);
    const finishReason = count ? 'tool_calls' : 'stop';
    if (body.stream) {
      const delta = { ...message, ...(count ? { tool_calls: message.tool_calls.map((call, index) => ({ ...call, index })) } : {}) };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\ndata: [DONE]\n\n`);
    } else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reasoningResponse(message, finishReason))); }
  } });
  f.config.providers.push({ ...f.config.providers[0], id: 'p2' }); f.config.secrets.providers.p2 = 'second-channel-key';
  const messages = [{ role: 'system', content: 'Synthetic multi-model agent task' }, { role: 'user', content: 'Read two files and summarize' }];
  const models = ['qwen3.8-flash', 'qwen3.8-flash', 'deepseek-flash', 'qwen3.8-flash', 'qwen3.8-flash', 'deepseek-flash'];
  for (let i = 0; i < models.length; i++) {
    f.config.models[1].model = models[i]; f.config.models[1].providerId = i % 2 ? 'p2' : 'p1';
    const response = await f.request({ messages, tools: agentTools, stream: i % 2 === 0, thinking: { type: 'enabled' } });
    assert.equal(response.status, 200, await response.clone().text()); await response.text();
    const sent = f.observed.at(-1).body;
    assert.equal(sent.model, models[i]); assert.deepEqual(sent.thinking, { type: 'enabled' });
    assert.deepEqual(sent.messages.filter(m => m.role === 'assistant').map(m => m.reasoning_content), emitted.slice(0, i).flatMap(m => Array((m.content ? 1 : 0) + (m.tool_calls?.length ?? 0)).fill(m.reasoning_content)));
    const message = emitted[i];
    if (message.content) messages.push({ role: 'assistant', content: message.content, model: models[i], messageId: `response-${i}` });
    for (const call of message.tool_calls ?? []) messages.push(
      { role: 'assistant', content: null, tool_calls: [call], messageId: `response-${i}`, ...(i % 2 ? { reasoning: message.reasoning_content } : {}) },
      { role: 'tool', tool_call_id: call.id, content: `Synthetic result ${call.id}` },
    );
    if (i === 1) messages.push({ role: 'user', content: 'Continue with another question' });
  }
  assert.equal(turn, models.length); assert(f.gateway.logs.every(log => log.status === 'success' && log.attempts === 1));
  assert(!JSON.stringify(f.gateway.logs).includes('原始思考')); assert(!JSON.stringify(f.gateway.logs).includes('Synthetic'));
});

for (const ending of ['missing-done', 'error', 'post-done-error', 'length']) test(`stream ${ending} never leaves reasoning eligible for recovery`, async t => {
  const event = { choices: [{ index: 0, delta: { content: 'answer', reasoning_content: 'private reasoning' }, finish_reason: ending === 'length' ? 'length' : 'stop' }] };
  const f = await fixture(t, { upstream: (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify(event)}\n\n`);
    setTimeout(() => res.end(ending === 'error' ? 'data: {"error":{"message":"bad"}}\n\n' : ending === 'post-done-error' ? 'data: [DONE]\n\ndata: {"error":{"message":"bad"}}\n\n' : ending === 'length' ? 'data: [DONE]\n\n' : ''), 5);
  } });
  try { await (await f.request({ stream: true })).text(); } catch {}
  assert.equal(f.gateway.reasoning.entries.size, 0);
});
test('authenticated local model listing; unauthenticated and browser origins rejected', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.url}/v1/models`)).status, 401);
  const auth = { Authorization: `Bearer ${f.config.secrets.gatewayKey}` };
  assert.equal((await fetch(`${f.url}/v1/models`, { headers: { ...auth, Origin: 'https://evil.example' } })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    const request = http.get(`${f.url}/v1/models`, { headers: { ...auth, Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(hostStatus, 403);
  const models = await (await fetch(`${f.url}/v1/models`, { headers: auth })).json();
  assert.equal(models.data[0].id, 'tierflow-auto');
});
for (const [score, selected] of [[2, 'economy'], [3.5, 'balanced'], [7, 'flagship']]) {
  test(`score ${score} routes to ${selected}, preserving original tools and history`, async t => {
    const f = await fixture(t, { score });
    const messages = [{ role: 'user', content: 'repair code' }, { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: '{"path":"app.py"}' } }] }, { role: 'tool', tool_call_id: 'c1', content: 'code' }];
    const tools = [{ type: 'function', function: { name: 'Read', parameters: { type: 'object' } } }];
    const r = await f.request({ messages, tools, tierflow_task: 'original task' });
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), completion);
    assert.equal(f.observed[0].authorization, 'Bearer score-secret');
    assert.equal(f.observed[0].body.task, 'original task');
    assert.equal(f.observed[1].authorization, 'Bearer provider-secret');
    assert.equal(f.observed[1].body.model, selected);
    assert.deepEqual(f.observed[1].body.messages, messages); assert.deepEqual(f.observed[1].body.tools, tools);
    assert.equal(f.observed[1].body.tierflow_task, undefined);
    assert.equal(f.gateway.logs[0].inputTokens, 80);
    assert.equal(JSON.stringify(f.gateway.logs).includes('original task'), false);
    assert.equal(JSON.stringify(f.gateway.logs).includes('provider-secret'), false);
  });
}
test('capability filtering upgrades rather than losing tools or images', async t => {
  const f = await fixture(t, { score: 1, configure: c => { c.models[0].tools = false; c.models[1].vision = false; } });
  const r = await f.request({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.test/image.png' } }] }], tools: [{ type: 'function', function: { name: 'Read' } }] });
  assert.equal(r.status, 200); await r.json(); assert.equal(f.observed[1].body.model, 'flagship');
});
test('without an eligible model, no upstream LLM is called', async t => {
  const f = await fixture(t, { score: 1, configure: c => { c.models[0].enabled = false; c.settings.allowEscalation = false; } });
  const r = await f.request(); assert.equal(r.status, 503); assert.equal((await r.json()).error.type, 'no_eligible_model'); assert.equal(f.observed.length, 1);
});
test('a 429 before streaming retries next eligible candidate', async t => {
  const f = await fixture(t, { score: 1, upstream: (_req, res, body) => { res.writeHead(body.model === 'economy' ? 429 : 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body.model === 'economy' ? { error: 'rate limited' } : completion)); } });
  const r = await f.request(); assert.equal(r.status, 200); await r.json();
  assert.deepEqual(f.observed.filter(e => e.path !== '/score').map(e => e.body.model), ['economy', 'balanced']); assert.equal(f.gateway.logs[0].attempts, 2);
});
test('upstream 401 does not try another model or expose upstream content', async t => {
  const f = await fixture(t, { upstream: (_req, res) => { res.writeHead(401); res.end('provider-secret'); } });
  const r = await f.request(); assert.equal(r.status, 502); assert.equal((await r.text()).includes('provider-secret'), false); assert.equal(f.observed.length, 2);
});
test('TierSense error blocks LLM calls by default; explicit fallback selects only configured model', async t => {
  const f = await fixture(t, { scoreStatus: 422 });
  const r = await f.request(); assert.equal(r.status, 502); assert.match((await r.json()).error.message, /原始任务/); assert.equal(f.observed.length, 1);
  f.config.settings.failureMode = 'fallback'; f.config.settings.fallbackModelId = 'flagship';
  const retry = await f.request(); assert.equal(retry.status, 200); await retry.json();
  assert.equal(f.observed.at(-1).body.model, 'flagship'); assert.equal(f.gateway.logs[0].fallback, true);
});
test('invalid scores cannot silently choose the cheapest model', async t => {
  const f = await fixture(t, { scoreBody: { score: '3', feature_scores: {} } });
  const r = await f.request(); assert.equal(r.status, 502); assert.equal((await r.json()).error.type, 'invalid_score'); assert.equal(f.observed.length, 1);
});

test('gateway passes all feature scores to routing and records decision before capability upgrade', async t => {
  const f = await fixture(t, { score: 4, configure: c => {
    c.routing.rules = [
      { id: 'code', name: '代码优先', dimension: 'domain1', operator: 'gte', threshold: 1, tierId: 'balanced', modelIds: ['balanced'], enabled: true },
      { id: 'tools', name: '工具其次', dimension: 'domain2', operator: 'gte', threshold: 0.5, tierId: 'economy', modelIds: ['economy'], enabled: true },
    ];
    c.models[1].tools = false;
  } });
  const r = await f.request({ tools: [{ type: 'function', function: { name: 'Read' } }] });
  assert.equal(r.status, 200); await r.json();
  assert.equal(f.observed[1].body.model, 'flagship');
  const log = f.gateway.logs[0];
  assert.equal(log.route.tierId, 'balanced'); assert.equal(log.route.ruleId, 'code');
  assert.equal(log.tierName, '旗舰'); assert.equal(log.featureScores.domain2, 0.5);
  assert.equal(log.score, 4); assert.match(log.route.reason, /代码修复/);
});

for (const [total, dimension, chosen] of [[8, 'domain1', 'glm'], [8, 'domain5', 'qwen'], [2, 'domain1', 'economy']]) {
  test(`end-to-end: total ${total} and difficult ${dimension} calls ${chosen}`, async t => {
    const f = await fixture(t, { scoreBody: { score: total, feature_scores: { ...scores(0).feature_scores, [dimension]: 1.9 } }, configure: c => {
      const flagship = c.models.pop();
      c.models.push({ ...flagship, id: 'glm', model: 'glm', name: 'GLM', priority: 2 }, { ...flagship, id: 'qwen', model: 'qwen', name: 'Qwen', priority: 1 });
      c.routing.rules = [
        { id: 'coding', name: '代码分工', tierId: 'flagship', modelIds: ['glm'], dimension: 'domain1', operator: 'gte', threshold: 1.5, enabled: true },
        { id: 'planning', name: '规划分工', tierId: 'flagship', modelIds: ['qwen'], dimension: 'domain5', operator: 'gte', threshold: 1.5, enabled: true },
      ];
    } });
    const response = await f.request(); assert.equal(response.status, 200); await response.json();
    assert.equal(f.observed.at(-1).body.model, chosen);
    assert.equal(f.gateway.logs[0].route.tierId, total === 8 ? 'flagship' : 'economy');
    assert.equal(f.gateway.logs[0].model, chosen);
  });
}
test('stream forwards exact SSE bytes and tool deltas, recording actual usage', async t => {
  const sse = 'data: {"id":"x","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"Read","arguments":"{\\\"path\\\":\\\"a\\\"}"}}]}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":41,"completion_tokens":9}}\n\ndata: [DONE]\n\n';
  const f = await fixture(t, { upstream: (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(sse.slice(0, 37)); setTimeout(() => res.end(sse.slice(37)), 5); } });
  const r = await f.request({ stream: true }); assert.equal(r.status, 200); assert.equal(await r.text(), sse);
  assert.equal(f.gateway.logs[0].status, 'success'); assert.equal(f.gateway.logs[0].inputTokens, 41);
});

test('stream cache and reasoning usage is counted once, cost uses the selected model price snapshot', async t => {
  const usage = { prompt_tokens: 1000000, completion_tokens: 100000, prompt_cache_hit_tokens: 800000, completion_tokens_details: { reasoning_tokens: 50000 } };
  const sse = `data: ${JSON.stringify({ choices: [], usage })}\n\ndata: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]`;
  const f = await fixture(t, { configure: c => { c.providers[0].requestUsage = true; c.models[1].pricing = { currency: 'CNY', input: 2, output: 8, cacheRead: 0.2 }; }, upstream: (_req, res, body) => { assert.equal(body.stream_options.include_usage, true); res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(sse.slice(0, 70)); res.end(sse.slice(70)); } });
  const response = await f.request({ stream: true, stream_options: { include_usage: false, custom: 'preserved' } });
  assert.equal(await response.text(), sse); assert.equal(f.observed.at(-1).body.stream_options.custom, 'preserved');
  const entry = f.gateway.logs[0]; assert.equal(entry.status, 'success'); assert.equal(entry.cachedTokens, 800000); assert.equal(entry.reasoningTokens, 50000); assert.equal(entry.totalTokens, 1100000);
  assert.equal(f.gateway.status().totalTokens, 1100000); assert.equal(entry.cost.amount, 1.36);
  f.config.models[1].pricing.input = 100; assert.equal(entry.pricing.input, 2); assert.equal(entry.cost.amount, 1.36);
});

test('unknown cache and absent stream usage remain unknown and do not invent free requests', async t => {
  const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n';
  const f = await fixture(t, { upstream: (_req, res, body) => { assert.equal(body.stream_options, undefined); res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(sse); } });
  const response = await f.request({ stream: true }); await response.text();
  const entry = f.gateway.logs[0]; assert.equal(entry.totalTokens, null); assert.equal(entry.cachedTokens, null); assert.equal(entry.cost.amount, null); assert.equal(f.gateway.status().totalTokens, null);
});
test('truncated SSE is recorded as failed and never retried after output starts', async t => {
  const f = await fixture(t, { upstream: (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'); setTimeout(() => res.end(), 10); } });
  try { const r = await f.request({ stream: true }); await r.text(); } catch {}
  assert.equal(f.gateway.logs[0].status, 'error'); assert.equal(f.gateway.logs[0].code, 'incomplete_stream'); assert.equal(f.observed.length, 2);
});
test('upstream streaming error is recorded as failed', async t => {
  const f = await fixture(t, { upstream: (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: {"error":{"message":"failed"}}\n\ndata: [DONE]\n\n'); } });
  try { const r = await f.request({ stream: true }); await r.text(); } catch {}
  assert.equal(f.gateway.logs[0].code, 'upstream_stream_error');
});
test('client cancellation aborts pending provider response', async t => {
  let closed = false;
  const f = await fixture(t, { upstream: (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{"content":"one"}}]}\n\n'); res.on('close', () => { closed = true; }); } });
  const abort = new AbortController(); const response = await f.request({ stream: true }, { options: { signal: abort.signal } });
  const reader = response.body.getReader(); await reader.read(); abort.abort();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(closed, true); assert.equal(f.gateway.logs[0].status, 'cancelled');
});
test('unsupported endpoint and unknown model return explicit errors without scoring', async t => {
  const f = await fixture(t);
  const r = await f.request({ model: 'unknown' }); assert.equal(r.status, 400); await r.text();
  const responses = await fetch(`${f.url}/v1/responses`, { method: 'POST', headers: { Authorization: `Bearer ${f.config.secrets.gatewayKey}` } }); assert.equal(responses.status, 404); await responses.text(); assert.equal(f.observed.length, 0);
});
test('settings reject inverted thresholds and insecure external credential endpoints', () => {
  const routing = defaults().routing; routing.tiers[1].minScore = 8;
  assert.throws(() => routingInput(routing), /递增/);
  assert.throws(() => validUrl('http://example.com/v1'), /HTTPS/);
  assert.throws(() => validUrl('https://example.com/v1?key=secret'), /查询参数/);
  assert.equal(validUrl('http://127.0.0.1:9000/v1/'), 'http://127.0.0.1:9000/v1');
});
