import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, routingInput, applyRouting, modelInput, migrateConfig } from '../core/config.mjs';
import { selectRoute, readiness } from '../core/policy.mjs';
import { candidates } from '../core/router.mjs';

const scores = (score, values = {}) => ({ score, feature_scores: { domain1: 0, domain2: 0, domain3: 0, domain4: 0, domain5: 0, ...values } });
const rule = (id, dimension, tierId, threshold = 1.5, operator = 'gte') => ({ id, name: id, dimension, tierId, modelIds: [id + '-model'], threshold, operator, enabled: true });

test('overall difficulty fixes the tier; simultaneous matches choose the first rule only within that tier', () => {
  const { routing } = defaults();
  routing.rules = [rule('cheap-rule', 'domain1', 'economy'), rule('coding-first', 'domain1', 'flagship'), rule('planning', 'domain5', 'flagship')];
  const input = scores(9.9, { domain1: 1.5, domain5: 2 });
  assert.equal(selectRoute(input, routing).tierId, 'flagship');
  assert.equal(selectRoute(input, routing).ruleId, 'coding-first');
  routing.rules.reverse(); assert.equal(selectRoute(input, routing).ruleId, 'planning');
  routing.rules[0].enabled = false; assert.equal(selectRoute(input, routing).ruleId, 'coding-first');
  assert.equal(selectRoute(scores(2, { domain1: 2, domain5: 2 }), routing).tierId, 'economy');
});

test('all five dimensions support exact threshold and less-than boundaries, with overall fallback', () => {
  for (const dimension of ['domain1', 'domain2', 'domain3', 'domain4', 'domain5']) {
    const { routing } = defaults(); routing.rules = [rule('r', dimension, 'flagship', 1.5, 'lt')];
    assert.equal(selectRoute(scores(10, { [dimension]: 1.49 }), routing).ruleId, 'r');
    assert.equal(selectRoute(scores(10, { [dimension]: 1.5 }), routing).tierId, 'flagship');
    routing.rules[0].operator = 'gte';
    assert.equal(selectRoute(scores(10, { [dimension]: 1.5 }), routing).ruleId, 'r');
  }
});

test('one and five tiers route continuously through boundaries 0 to 10', () => {
  const routing = routingInput({ tiers: [0, 2, 4, 6, 8].map((minScore, i) => ({ id: `t${i}`, name: `Tier ${i}`, minScore })), rules: [] });
  for (const [score, id] of [[0, 't0'], [1.99, 't0'], [2, 't1'], [4, 't2'], [7.99, 't3'], [8, 't4'], [10, 't4']]) assert.equal(selectRoute(scores(score), routing).tierId, id);
  routing.tiers = [routing.tiers[0]];
  assert.equal(selectRoute(scores(10), routing).tierId, 't0');
});

test('invalid tiers, dangling rules and malformed dimension thresholds are rejected', () => {
  const cases = [
    { tiers: [], rules: [] },
    { tiers: [{ id: 'x', name: 'X', minScore: 1 }], rules: [] },
    { tiers: [{ id: 'x', name: 'X', minScore: 0 }, { id: 'x', name: 'Y', minScore: 5 }], rules: [] },
    { ...defaults().routing, rules: [rule('r', 'domain6', 'flagship')] },
    { ...defaults().routing, rules: [rule('r', 'domain1', 'missing')] },
    { ...defaults().routing, rules: [rule('r', 'domain1', 'flagship', 2.1)] },
    { ...defaults().routing, rules: [rule('r', 'domain1', 'flagship', NaN)] },
  ];
  for (const value of cases) assert.throws(() => routingInput(value));
});

test('deleting a pool requires explicit migration and keeps model identity and fallback references', () => {
  const config = defaults();
  config.models = [{ id: 'm1', tier: 'economy' }]; config.settings.fallbackModelId = 'm1';
  const routing = { tiers: [{ id: 'balanced', name: '日常', minScore: 0 }, { id: 'flagship', name: '专业', minScore: 7 }], rules: [{ ...rule('code', 'domain1', 'flagship'), modelIds: ['m1'] }] };
  assert.throws(() => applyRouting(config, { routing }), /迁往/);
  applyRouting(config, { routing, reassignments: { economy: 'flagship' } });
  assert.equal(config.models[0].tier, 'flagship'); assert.equal(config.models[0].id, 'm1');
  assert.equal(config.settings.fallbackModelId, 'm1');
});

test('custom tier escalation uses configured order and never a lower priority dimension rule', () => {
  const config = defaults();
  config.providers = [{ id: 'p', enabled: true }]; config.secrets.providers.p = 'test';
  config.routing = routingInput({ tiers: [0, 3, 6, 9].map((minScore, i) => ({ id: `pool${i}`, name: `Pool ${i}`, minScore })), rules: [rule('target', 'domain1', 'pool1'), rule('second', 'domain2', 'pool0')] });
  config.models = [0, 1, 2, 3].map(i => ({ id: `m${i}`, tier: `pool${i}`, providerId: 'p', enabled: true, tools: i !== 1, priority: 1 }));
  const body = { messages: [{ role: 'user', content: 'x' }], tools: [{}] };
  const input = scores(4, { domain1: 2, domain2: 2 });
  assert.deepEqual(candidates(config, body, input).map(m => m.id), ['m2', 'm3']);
  config.settings.allowEscalation = false;
  assert.throws(() => candidates(config, body, input), e => e.code === 'no_eligible_model');
  assert.throws(() => modelInput({ tier: 'flagship', providerId: 'p' }, config), /有效的模型档次/);
});

test('onboarding checks every reachable pool, active channel keys and TierSense key', () => {
  const config = defaults();
  config.providers = [{ id: 'p', enabled: true }]; config.secrets.providers.p = 'test'; config.secrets.tiersenseKey = 'test';
  config.models = [{ tier: 'economy', enabled: true, providerId: 'p' }];
  assert.equal(readiness(config).models, false);
  config.models[0].tier = 'flagship'; assert.equal(readiness(config).models, true);
  config.settings.allowEscalation = false; assert.equal(readiness(config).models, false);
  config.providers[0].enabled = false; assert.equal(readiness(config).providers, false);
});

test('legacy migration preserves tier IDs, custom boundaries and boundary-only pools', () => {
  for (const [lower, upper] of [[2.4, 8.2], [0, 10]]) {
    const saved = { ...defaults(), version: 1, models: [{ id: 'm', tier: 'economy' }], settings: { ...defaults().settings, lowerThreshold: lower, upperThreshold: upper } };
    delete saved.routing;
    const migrated = migrateConfig(saved);
    for (const score of [0, lower, (lower + upper) / 2, upper, 10]) assert.equal(selectRoute(scores(score), migrated.routing).tierId, score < lower ? 'economy' : score < upper ? 'balanced' : 'flagship');
    assert.equal(migrated.models[0].tier, 'economy'); assert.equal(migrated.secrets.gatewayKey, saved.secrets.gatewayKey);
    assert.equal(migrated.version, 3); assert.equal('lowerThreshold' in migrated.settings, false);
  }
});
