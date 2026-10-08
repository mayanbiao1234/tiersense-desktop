import test from 'node:test';
import assert from 'node:assert/strict';
import { ReasoningCache, ReasoningStream, reasoningScope, isReasoningHistoryError } from '../core/reasoning.mjs';

const user = { role: 'user', content: 'read private file' };
const assistant = { role: 'assistant', content: 'answer', reasoning_content: '原始思考\n不可改写' };
const choice = message => ({ message, finish_reason: 'stop' });
const stripped = ({ reasoning_content, ...message }) => message;

test('replay restores missing/null/empty fields, preserves nonempty values and never mutates caller history', () => {
  const cache = new ReasoningCache();
  cache.remember('scope', [user], [choice(assistant)]);
  for (const value of [undefined, null, '']) {
    const messages = [user, { ...assistant, reasoning_content: value }];
    const before = structuredClone(messages);
    assert.deepEqual(cache.restore('scope', messages)[1], assistant);
    assert.deepEqual(messages, before);
  }
  const explicit = { ...assistant, reasoning_content: 'client original' };
  assert.deepEqual(cache.restore('scope', [user, explicit])[1], explicit);
  assert.equal(JSON.stringify([...cache.entries]).includes(user.content), false);
  assert.equal(JSON.stringify([...cache.entries]).includes('answer'), false);
});

test('equivalent text blocks, empty response metadata and reserialized tool JSON can be matched', () => {
  const cache = new ReasoningCache();
  const message = { ...assistant, content: null, refusal: null, annotations: [], tool_calls: [{ id: 'call-a', type: 'function', function: { name: 'Read', arguments: '{ "b": 1, "a": 2 }' } }] };
  cache.remember('scope', [user], [{ message, finish_reason: 'tool_calls' }]);
  const replay = { role: 'assistant', content: [], tool_calls: [{ index: 0, id: 'call-a', type: 'function', function: { name: 'Read', arguments: '{"b":1,"a":2}' } }] };
  const messages = [{ ...user, content: [{ type: 'text', text: user.content }] }, replay];
  assert.equal(cache.restore('scope', messages)[1].reasoning_content, assistant.reasoning_content);
  assert.deepEqual(cache.restore('scope', messages)[1].tool_calls, replay.tool_calls);
});

test('scope follows the local conversation across models but isolates account, endpoint, local key and user changes', () => {
  const provider = { id: 'p', baseUrl: 'https://provider.test/v1' };
  const config = { providers: [provider], secrets: { providers: { p: 'upstream-key' }, gatewayKey: 'local-key' } };
  const original = reasoningScope(config, {});
  assert.equal(reasoningScope({ ...config, models: [{ model: 'different-model' }] }, {}), original);
  const scopes = [
    reasoningScope({ ...config, providers: [{ ...provider, id: 'q' }] }, {}),
    reasoningScope({ ...config, providers: [{ ...provider, baseUrl: 'https://other.test/v1' }] }, {}),
    reasoningScope({ ...config, secrets: { ...config.secrets, providers: { p: 'new' } } }, {}),
    reasoningScope({ ...config, secrets: { ...config.secrets, gatewayKey: 'new' } }, {}),
    reasoningScope(config, { user: 'another-agent' }),
  ];
  const cache = new ReasoningCache(); cache.remember(original, [user], [choice(assistant)]);
  for (const scope of scopes) {
    assert.notEqual(scope, original);
    assert.equal(cache.restore(scope, [user, stripped(assistant)])[1].reasoning_content, undefined);
  }
  for (const messages of [[{ ...user, content: 'different task' }, stripped(assistant)], [stripped(assistant)], [user, { ...stripped(assistant), content: 'edited' }]]) {
    assert.equal(cache.restore(original, messages).at(-1).reasoning_content, undefined);
  }
});

const tools = ['a', 'b'].map(id => ({ id, type: 'function', function: { name: 'Read', arguments: JSON.stringify({ path: id }) } }));
function splitResponse(message) {
  return [{ role: 'assistant', content: message.content }, ...message.tool_calls.flatMap(call => [
    { role: 'assistant', content: null, tool_calls: [call] },
    { role: 'tool', tool_call_id: call.id, content: 'result' },
  ])];
}
test('WorkBuddy split text and tool pairs recover the same original reasoning without changing the messages', () => {
  const cache = new ReasoningCache(), message = { ...assistant, tool_calls: tools };
  cache.remember('scope', [user], [choice(message)]);
  const messages = [user, ...splitResponse(message)];
  const before = structuredClone(messages);
  const restored = cache.restore('scope', messages);
  assert.deepEqual(restored.filter(m => m.role === 'assistant').map(m => m.reasoning_content), Array(3).fill(assistant.reasoning_content));
  assert.deepEqual(restored.map(stripped), before);
  assert.deepEqual(messages, before);
  for (const content of [user.content, assistant.content, 'Read', 'path']) assert.equal(JSON.stringify([...cache.entries]).includes(content), false);
});

test('reasoning alias is recovered without cache, while explicit original values always win', () => {
  const cache = new ReasoningCache();
  const original = { role: 'assistant', content: null, reasoning: '原文\n  字符不变', tool_calls: tools };
  assert.equal(cache.restore('scope', [user, original])[1].reasoning_content, original.reasoning);
  assert.equal(original.reasoning_content, undefined);
  assert.equal(cache.restore('scope', [user, { ...original, reasoning_content: 'explicit' }])[1].reasoning_content, 'explicit');
  for (const reasoning of ['', {}, [{ text: 'cannot assume this encoding' }]]) assert.equal(cache.restore('scope', [{ ...original, reasoning }])[0].reasoning_content, undefined);
});

test('a completed response with genuinely empty reasoning keeps the original empty field on replay', () => {
  const cache = new ReasoningCache(), message = { ...assistant, reasoning_content: '' };
  cache.remember('scope', [user], [choice(message)]);
  const restored = cache.restore('scope', [user, stripped(message)])[1];
  assert.equal(Object.hasOwn(restored, 'reasoning_content'), true);
  assert.equal(restored.reasoning_content, '');
});

test('split replay refuses changed calls, other conversations, mismatched text and mixed response groups', () => {
  const cache = new ReasoningCache(), message = { ...assistant, tool_calls: tools };
  cache.remember('scope', [user], [choice(message)]);
  const second = { ...assistant, content: 'second answer', reasoning_content: 'other reasoning', tool_calls: [{ ...tools[0], id: 'c' }] };
  cache.remember('scope', [user, message], [choice(second)]);
  const single = { role: 'assistant', content: null, tool_calls: [tools[0]] };
  for (const changed of [
    { ...single, tool_calls: [{ ...tools[0], function: { name: 'Read', arguments: '{"path":"other"}' } }] },
    { ...single, tool_calls: [{ ...tools[0], function: { ...tools[0].function, name: 'Write' } }] },
    { ...single, content: 'edited answer' },
    { ...single, tool_calls: [tools[0], second.tool_calls[0]] },
  ]) assert.equal(cache.restore('scope', [user, changed])[1].reasoning_content, undefined);
  assert.equal(cache.restore('other', [user, single])[1].reasoning_content, undefined);
  assert.equal(cache.restore('scope', [{ ...user, content: 'different task' }, single])[1].reasoning_content, undefined);
  const changedText = splitResponse(message); changedText[0].content = 'edited answer';
  assert.equal(cache.restore('scope', [user, ...changedText])[1].reasoning_content, undefined);
  assert.equal(cache.restore('scope', [user, { ...single, reasoning_content: 'client original' }])[1].reasoning_content, 'client original');
});

test('fragment indexes stay bounded and expire, roll back and preserve ambiguous tool identities', () => {
  let now = 0;
  const cache = new ReasoningCache({ maxEntries: 2, maxBytes: 4096, now: () => now, ttlMs: 100 });
  const message = { ...assistant, tool_calls: tools };
  const replay = [user, ...splitResponse(message)];
  const rollback = cache.remember('scope', [user], [choice(message)]);
  rollback(); assert.equal(cache.fragments.size, 0); assert.equal(cache.bytes, 0);
  cache.remember('scope', [user], [choice(message)]);
  cache.remember('scope', [user, { role: 'assistant', content: 'different prefix' }], [choice({ ...message, reasoning_content: 'another generation' })]);
  assert.equal(cache.restore('scope', replay)[2].reasoning_content, undefined);
  cache.delete(cache.entries.keys().next().value);
  assert.equal(cache.restore('scope', replay)[2].reasoning_content, undefined);
  cache.clear(); assert.equal(cache.fragments.size, 0);
  for (let i = 0; i < 100; i++) cache.remember('scope', [user], [choice({ ...message, tool_calls: [{ ...tools[0], id: `call-${i}` }] })]);
  assert.equal(cache.entries.size, 2); assert.equal(cache.fragments.size, 2); assert(cache.bytes <= 4096);
  now = 100; cache.prune(); assert.equal(cache.entries.size, 0); assert.equal(cache.fragments.size, 0); assert.equal(cache.bytes, 0);
});

test('ambiguous parallel generations remain unresolved; rollback cannot erase ambiguity or newer responses', () => {
  const cache = new ReasoningCache();
  const rollback = cache.remember('scope', [user], [choice(assistant)]);
  const otherRollback = cache.remember('scope', [user], [choice({ ...assistant, reasoning_content: 'different hidden reasoning' })]);
  rollback(); otherRollback();
  cache.remember('scope', [user], [choice(assistant)]);
  assert.equal(cache.restore('scope', [user, stripped(assistant)])[1].reasoning_content, undefined);
  assert.equal(cache.entries.size, 1);
  cache.clear();
  const staleRollback = cache.remember('scope', [user], [choice(assistant)]);
  cache.remember('scope', [user], [choice(assistant)]); staleRollback();
  assert.equal(cache.restore('scope', [user, stripped(assistant)])[1].reasoning_content, assistant.reasoning_content);
});

test('TTL, entry and memory limits evict whole entries without truncating reasoning', () => {
  let now = 0;
  const cache = new ReasoningCache({ now: () => now, ttlMs: 100, maxEntries: 2, maxBytes: 800 });
  for (const content of ['a', 'b', 'c']) cache.remember('scope', [user], [choice({ ...assistant, content })]);
  assert.equal(cache.entries.size, 2); assert(cache.bytes <= 800);
  assert.equal(cache.restore('scope', [user, { role: 'assistant', content: 'a' }])[1].reasoning_content, undefined);
  now = 100; assert.equal(cache.restore('scope', [user, { role: 'assistant', content: 'c' }])[1].reasoning_content, undefined);
  assert.equal(cache.bytes, 0);
  cache.remember('scope', [user], [choice({ ...assistant, reasoning_content: 'x'.repeat(600000) })]);
  assert.equal(cache.entries.size, 0);
  cache.remember('scope', [user], [choice(assistant)]);
  cache.clear(); assert.equal(cache.bytes, 0); assert.equal(cache.entries.size, 0);
});

test('large numeric tool arguments remain distinct and a newer non-thinking answer cannot reuse old reasoning', () => {
  const cache = new ReasoningCache();
  const message = { ...assistant, tool_calls: [{ id: 'same-id', type: 'function', function: { name: 'Read', arguments: '{"id":9223372036854775808}' } }] };
  cache.remember('scope', [user], [choice(message)]);
  const other = structuredClone(withoutReason(message)); other.tool_calls[0].function.arguments = '{"id":9223372036854775809}';
  assert.equal(cache.restore('scope', [user, other])[1].reasoning_content, undefined);
  cache.remember('scope', [user], [choice(withoutReason(message))]);
  assert.equal(cache.restore('scope', [user, withoutReason(message)])[1].reasoning_content, undefined);
  function withoutReason(message) { return stripped(message); }
});

test('incomplete choices and failed response rollback cannot populate replay cache', () => {
  const cache = new ReasoningCache();
  for (const finish_reason of [null, 'length', 'content_filter']) cache.remember('scope', [user], [{ message: assistant, finish_reason }]);
  assert.equal(cache.entries.size, 0);
  cache.remember('scope', [user], [choice(assistant)])(); assert.equal(cache.entries.size, 0);
});

test('stream observer assembles interleaved parallel tool calls and original Unicode reasoning', () => {
  const stream = new ReasoningStream();
  const add = delta => stream.accept({ choices: [{ index: 0, delta }] });
  add({ role: 'assistant', reasoning_content: '先读' }); add({ reasoning_content: '两个文件\n' });
  add({ tool_calls: [{ index: 1, id: 'b', type: 'function', function: { name: 'Read', arguments: '{"p":' } }, { index: 0, id: 'a', type: 'function', function: { name: 'Read', arguments: '{"p":' } }] });
  add({ tool_calls: [{ index: 0, function: { arguments: '"甲"}' } }, { index: 1, function: { arguments: '"乙"}' } }] });
  stream.accept({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  const [result] = stream.choices();
  assert.equal(result.message.reasoning_content, '先读两个文件\n');
  assert.deepEqual(result.message.tool_calls.map(t => [t.id, JSON.parse(t.function.arguments).p]), [['a', '甲'], ['b', '乙']]);
  assert.equal(result.finish_reason, 'tool_calls');
});

test('unbounded or malformed stream observations disable recovery, not raw forwarding', () => {
  for (const delta of [{ reasoning_content: {} }, { reasoning_content: 'x'.repeat(600000) }, { tool_calls: [{ index: -1 }] }, { function_call: { name: 'old' } }]) {
    const stream = new ReasoningStream(); stream.accept({ choices: [{ delta }] }); assert.deepEqual(stream.choices(), []);
  }
  const stream = new ReasoningStream();
  stream.accept({ choices: [{ delta: { reasoning_content: 'thinking', tool_calls: [{ index: 1, id: 'a', function: { name: 'Read' } }] }, finish_reason: 'tool_calls' }] });
  assert.deepEqual(stream.choices(), []);
});

test('only bounded, structured reasoning-history 400s receive specialized guidance', async () => {
  const error = message => JSON.stringify({ error: { message } });
  assert.equal(await isReasoningHistoryError(new Response(error('Missing reasoning_content must be passed back secret'), { status: 400 })), true);
  for (const [status, body] of [[401, error('Missing reasoning_content')], [400, error('unknown field')], [400, 'reasoning_content missing'], [400, error('Missing reasoning_content ' + 'x'.repeat(66000))]]) {
    assert.equal(await isReasoningHistoryError(new Response(body, { status })), false);
  }
});
