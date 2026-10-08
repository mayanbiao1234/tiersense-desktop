import test from 'node:test';
import assert from 'node:assert/strict';
import { readUsage, estimateCost, pricingInput, summarizeUsage } from '../core/usage.mjs';
import { defaults, modelInput, deleteModel, applyProvider } from '../core/config.mjs';

test('standard and DeepSeek cache counters are subsets, not additional tokens', () => {
  const usage = readUsage({ prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, prompt_tokens_details: { cached_tokens: 800 }, prompt_cache_hit_tokens: 800, completion_tokens_details: { reasoning_tokens: 50 } });
  assert.deepEqual(usage, { inputTokens: 1000, outputTokens: 200, totalTokens: 1200, cachedTokens: 800, reasoningTokens: 50 });
  assert.equal(readUsage({ prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 }).inputTokens, 100);
  assert.equal(readUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 999 }).totalTokens, 120);
});
test('missing, malformed and contradictory counters stay unknown; real zero is preserved', () => {
  assert.deepEqual(readUsage(null), {});
  const unknown = readUsage({ prompt_tokens: -1, completion_tokens: '10', total_tokens: Infinity, prompt_cache_hit_tokens: 1.5 });
  assert(Object.values(unknown).every(n => n === null));
  assert.equal(readUsage({ prompt_tokens: 10, prompt_cache_hit_tokens: 11 }).cachedTokens, null);
  assert.equal(readUsage({ completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 6 } }).reasoningTokens, null);
  assert.deepEqual(readUsage({ prompt_tokens: 0, completion_tokens: 0, prompt_cache_hit_tokens: 0 }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, reasoningTokens: null });
});
test('cost uses cache read price without double billing, and explains unknown cache data', () => {
  const pricing = pricingInput({ currency: 'CNY', input: 2, output: 8, cacheRead: 0.2 });
  const base = { inputTokens: 1000000, outputTokens: 100000, cachedTokens: 800000 };
  assert.equal(estimateCost(base, pricing).amount, 1.36);
  assert.equal(estimateCost(base, null).amount, null);
  assert.equal(estimateCost({ ...base, outputTokens: null }, pricing).amount, null);
  assert.equal(estimateCost({}, pricing).amount, null);
  assert.match(estimateCost({ inputTokens: 1, outputTokens: 0 }, pricing).note, /缓存用量未知/);
  assert.equal(estimateCost({ ...base, cachedTokens: null }, pricing).amount, 2.8);
  assert.match(estimateCost({ ...base, cachedTokens: null }, pricing).note, /缓存用量未知/);
  assert.equal(estimateCost(base, { ...pricing, cacheRead: null }).amount, 2.8);
  assert.equal(estimateCost(base, { currency: 'USD', input: 0, output: 0, cacheRead: 0 }).amount, 0);
  for (const bad of [-1, Infinity, '1', NaN]) assert.throws(() => pricingInput({ currency: 'CNY', input: bad }), /单价/);
  assert.throws(() => pricingInput({ currency: 'EUR', input: 1 }), /币种/);
});
test('analytics filters dates and providers, keeps currencies separate and excludes unknown cache samples', () => {
  const now = +new Date(2026, 9, 7, 13);
  const log = { id: 'one', time: now - 1000, providerId: 'p1', provider: 'Provider', model: 'GLM', status: 'success', ...readUsage({ prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 80 }), cost: { amount: 1, currency: 'CNY', source: 'estimated' } };
  const rows = [log, { ...log, id: 'two', model: 'Qwen', status: 'error', cachedTokens: null, cost: { amount: 2, currency: 'USD', source: 'estimated' } }, { ...log, id: 'three', providerId: 'p2', cachedTokens: 0, cost: { amount: null, currency: 'CNY', source: 'unknown' } }, { ...log, id: 'old', time: now - 10 * 86400000 }, { ...log, id: 'unselected', model: '', inputTokens: null, outputTokens: null, totalTokens: null, cachedTokens: null, status: 'error', cost: undefined }];
  const summary = summarizeUsage(rows, { range: '7d' }, now);
  assert.equal(summary.calls, 4); assert.equal(summary.success, 2); assert.equal(summary.routedCalls, 3);
  assert.equal(summary.totalTokens, 330); assert.equal(summary.usageSamples, 3); assert.equal(summary.cacheSamples, 2); assert.equal(summary.cacheHitRate, 0.4);
  assert.deepEqual(summary.costs, { CNY: 1, USD: 2 }); assert.equal(summary.pricedCalls, 2);
  assert.equal(summary.models.length, 3); assert.equal(summary.models.reduce((n, m) => n + m.share, 0), 1);
  assert.equal(summary.trend.length, 7); assert.equal(summary.trend.reduce((n, d) => n + d.calls, 0), 4);
  assert.equal(summarizeUsage(rows, { range: 'today', providerId: 'p2' }, now).calls, 1);
  assert.throws(() => summarizeUsage(rows, { range: 'anything' }, now), /周期/);
});
test('total-only usage does not invent known input, output or cache samples', () => {
  const summary = summarizeUsage([{ time: Date.now(), model: 'total-only', status: 'success', ...readUsage({ total_tokens: 100 }) }]);
  assert.equal(summary.totalTokens, 100);
  assert.equal(summary.usageSamples, 1);
  assert.equal(summary.inputSamples, 0);
  assert.equal(summary.outputSamples, 0);
  assert.equal(summary.cacheSamples, 0);
  assert.equal(summary.pricedCalls, 0);
  assert.equal(summary.models[0].inputSamples, 0);
});

test('model edits preserve optional pricing; delete removes routing references and resets deleted fallback', () => {
  const c = defaults(); applyProvider(c, { name: 'Official', preset: 'tierflow', baseUrl: 'https://tierflow.cn/v1', apiKey: 'dummy' });
  const model = modelInput({ providerId: c.providers[0].id, name: 'GLM', model: 'glm', tier: 'flagship', pricing: { currency: 'CNY', input: 2, output: 8, cacheRead: 0.2 } }, c);
  c.models.push(model); const pricing = structuredClone(model.pricing);
  assert.deepEqual(modelInput({ ...model, pricing: undefined, enabled: false }, c, model).pricing, pricing);
  c.routing.rules = [{ id: 'rule', tierId: 'flagship', modelIds: [model.id], enabled: true }];
  c.settings.fallbackModelId = model.id; c.settings.failureMode = 'fallback';
  deleteModel(c, model.id);
  assert.equal(c.models.length, 0); assert.equal(c.providers.length, 1); assert.equal(c.secrets.providers[c.providers[0].id], 'dummy');
  assert.equal(c.routing.rules[0].enabled, false); assert.deepEqual(c.routing.rules[0].modelIds, []); assert.equal(c.settings.failureMode, 'block');
});
