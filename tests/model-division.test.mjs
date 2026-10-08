import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, applyRouting, migrateConfig, pruneModelRules, importModels } from '../core/config.mjs';
import { candidates } from '../core/router.mjs';
import { selectRoute } from '../core/policy.mjs';
import { discoverModels, parseModels } from '../core/discovery.mjs';

const scores = (score, features = {}) => ({ score, feature_scores: { domain1: 0, domain2: 0, domain3: 0, domain4: 0, domain5: 0, ...features } });
const body = { messages: [{ role: 'user', content: 'test' }] };
function fixture() {
  const c = defaults(); c.providers = [{ id: 'p', name: 'fixture', enabled: true, baseUrl: 'https://provider.example/v1' }]; c.secrets.providers.p = 'fixture-secret';
  c.models = [['cheap', 'economy', 1], ['glm', 'flagship', 2], ['qwen', 'flagship', 1]].map(([id, tier, priority]) => ({ id, name: id, model: id, tier, priority, enabled: true, tools: true, vision: false, providerId: 'p' }));
  c.routing.rules = [
    { id: 'code', name: '编程用 GLM', tierId: 'flagship', dimension: 'domain1', threshold: 1.5, operator: 'gte', modelIds: ['glm'], enabled: true },
    { id: 'plan', name: '规划用 Qwen', tierId: 'flagship', dimension: 'domain5', threshold: 1.5, operator: 'gte', modelIds: ['qwen'], enabled: true },
  ]; return c;
}
test('same flagship score chooses GLM for coding and Qwen for planning; a hard dimension never raises the overall tier', () => {
  const c = fixture();
  assert.deepEqual(candidates(c, body, scores(8, { domain1: 2 })).map(m => m.id), ['glm', 'qwen']);
  assert.deepEqual(candidates(c, body, scores(8, { domain5: 2 })).map(m => m.id), ['qwen', 'glm']);
  assert.equal(candidates(c, body, scores(2, { domain1: 2 }))[0].id, 'cheap');
  assert.equal(selectRoute(scores(2, { domain1: 2 }), c.routing).ruleId, '');
  assert.equal(candidates(c, body, scores(8))[0].id, 'qwen');
});
test('competing dimensions respect rule order; disabled or incapable specialists fall back within the same tier', () => {
  const c = fixture(); const input = scores(8, { domain1: 2, domain5: 2 });
  assert.equal(candidates(c, body, input)[0].id, 'glm');
  c.routing.rules.reverse(); assert.equal(candidates(c, body, input)[0].id, 'qwen');
  c.models[2].tools = false;
  assert.equal(candidates(c, { ...body, tools: [{}] }, input)[0].id, 'glm');
  c.models[1].enabled = false;
  assert.throws(() => candidates(c, { ...body, tools: [{}] }, input), error => error.code === 'no_eligible_model');
});
test('model preferences must reference existing models in the same tier; moving or deleting a specialist disables dangling rules', () => {
  const c = fixture(); const routing = structuredClone(c.routing); routing.rules[0].modelIds = ['cheap'];
  assert.throws(() => applyRouting(c, { routing }), /属于规则指定的档次/);
  const updated = fixture(); updated.models[1].tier = 'economy'; pruneModelRules(updated);
  assert.deepEqual(updated.routing.rules[0].modelIds, []); assert.equal(updated.routing.rules[0].enabled, false);
  pruneModelRules(updated, ['qwen']); assert.equal(updated.routing.rules[1].enabled, false);
});
test('legacy tier rules are retained for review, not guessed into model assignments; secrets and tiers survive', () => {
  const c = fixture(); c.version = 2; delete c.routing.rules[0].modelIds; delete c.routing.rules[1].modelIds;
  const migrated = migrateConfig(c);
  assert.equal(migrated.version, 3); assert.deepEqual(migrated.secrets, c.secrets);
  assert.deepEqual(migrated.models, c.models); assert.deepEqual(migrated.routing.tiers, c.routing.tiers);
  assert.equal(migrated.routing.rules[0].threshold, 1.5); assert.equal(migrated.routing.rules[0].enabled, false);
  assert.deepEqual(migrated.routing.rules[0].modelIds, []);
});
test('batch model import skips only exact provider/model/tier duplicates and preserves capabilities explicitly chosen by user', () => {
  const c = fixture(); const input = { providerId: 'p', models: [{ name: 'GLM', model: 'glm', tier: 'flagship', tools: false, vision: true }, { name: 'new', model: 'new', tier: 'flagship', tools: false, vision: true }] };
  assert.equal(importModels(c, input), 1); assert.equal(c.models.at(-1).tools, false); assert.equal(c.models.at(-1).vision, true);
  assert.equal(importModels(c, input), 0);
  assert.throws(() => importModels(c, { ...input, models: [{ ...input.models[1], tier: 'missing' }] }), /有效的模型档次/);
});
test('channel model discovery deduplicates IDs, does not invent capabilities, and never exposes credentials', async () => {
  const c = fixture(); let request;
  const result = await discoverModels(c, 'p', async (url, options) => { request = { url, options }; return Response.json({ data: [{ id: 'glm' }, { id: 'qwen' }, { id: 'glm' }, { id: 'bad\nmodel' }, {}] }); });
  assert.deepEqual(result.models, [{ id: 'glm' }, { id: 'qwen' }]);
  assert.equal(request.url, 'https://provider.example/v1/models'); assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers.Authorization, 'Bearer fixture-secret');
  assert(!JSON.stringify(result).includes('fixture-secret'));
  assert.deepEqual(parseModels({ models: ['a', 'a', { id: 'b' }] }), [{ id: 'a' }, { id: 'b' }]);
});
test('model discovery handles authentication, unsupported endpoint, malformed JSON, oversize and timeout without leaking response bodies', async () => {
  const c = fixture();
  for (const status of [401, 403, 404, 405, 500]) await assert.rejects(discoverModels(c, 'p', async () => new Response('fixture-secret', { status })), error => !error.message.includes('fixture-secret'));
  await assert.rejects(discoverModels(c, 'p', async () => new Response('not-json')), /有效的 JSON/);
  await assert.rejects(discoverModels(c, 'p', async () => Response.json({ unexpected: [] })), /不是模型列表/);
  await assert.rejects(discoverModels(c, 'p', async () => new Response('x'.repeat(4 * 1024 * 1024 + 1))), /内容过大/);
  await assert.rejects(discoverModels(c, 'p', async () => { throw new Error('network secret'); }), /失败或超时/);
});
