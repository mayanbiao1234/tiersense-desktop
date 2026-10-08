// Usage is reported by the upstream. Missing data is unknown, never zero.
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function readUsage(usage) {
  if (!usage || typeof usage !== 'object') return {};
  let inputTokens = count(usage.prompt_tokens), outputTokens = count(usage.completion_tokens);
  let cachedTokens = count(usage.prompt_tokens_details?.cached_tokens) ?? count(usage.prompt_cache_hit_tokens);
  const miss = count(usage.prompt_cache_miss_tokens);
  if (inputTokens === null && cachedTokens !== null && miss !== null) inputTokens = count(cachedTokens + miss);
  if (inputTokens !== null && cachedTokens !== null && cachedTokens > inputTokens) cachedTokens = null;
  let reasoningTokens = count(usage.completion_tokens_details?.reasoning_tokens);
  if (outputTokens !== null && reasoningTokens !== null && reasoningTokens > outputTokens) reasoningTokens = null;
  const totalTokens = inputTokens !== null && outputTokens !== null ? count(inputTokens + outputTokens) : count(usage.total_tokens);
  return { inputTokens, outputTokens, totalTokens, cachedTokens, reasoningTokens };
}

export function pricingInput(value) {
  if (value === undefined || value === null) return null;
  if (!['CNY', 'USD'].includes(value.currency)) throw new Error('计价币种须为 CNY 或 USD');
  const price = key => {
    if (value[key] === null || value[key] === undefined || value[key] === '') return null;
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1000000) throw new Error('每百万 Token 单价须为 0–1000000，未知请留空');
    return value[key];
  };
  return { currency: value.currency, input: price('input'), output: price('output'), cacheRead: price('cacheRead') };
}

export function estimateCost(entry, pricing) {
  const unknown = reason => ({ amount: null, currency: pricing?.currency ?? 'CNY', source: 'unknown', note: reason });
  if (!pricing || !Number.isFinite(pricing.input) || !Number.isFinite(pricing.output)) return unknown('未配置完整输入 / 输出单价');
  if (count(entry.inputTokens) === null || count(entry.outputTokens) === null) return unknown('渠道未返回完整 Token 用量');
  const cached = count(entry.cachedTokens) !== null && entry.cachedTokens <= entry.inputTokens ? entry.cachedTokens : 0;
  const cachePrice = pricing.cacheRead ?? pricing.input;
  const amount = ((entry.inputTokens - cached) * pricing.input + cached * cachePrice + entry.outputTokens * pricing.output) / 1000000;
  return { amount, currency: pricing.currency, source: 'estimated',
    note: count(entry.cachedTokens) === null || entry.cachedTokens > entry.inputTokens ? '缓存用量未知，输入按普通单价估算' : pricing.cacheRead == null && cached > 0 ? '未设缓存单价，缓存按普通输入单价估算' : '按本次调用时保存的模型单价估算' };
}

const dayKey = timestamp => { const d = new Date(timestamp); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function bucket() { return { calls: 0, success: 0, inputTokens: 0, outputTokens: 0, inputSamples: 0, outputSamples: 0, totalTokens: 0, cachedTokens: 0, usageSamples: 0, cacheSamples: 0, cacheInputTokens: 0, pricedCalls: 0, costs: {} }; }
function add(target, entry) {
  target.calls++; if (entry.status === 'success') target.success++;
  if (entry.totalTokens !== null && entry.totalTokens !== undefined) { target.totalTokens += entry.totalTokens; target.usageSamples++; }
  if (entry.inputTokens != null) { target.inputTokens += entry.inputTokens; target.inputSamples++; }
  if (entry.outputTokens != null) { target.outputTokens += entry.outputTokens; target.outputSamples++; }
  if (entry.cachedTokens != null && entry.inputTokens != null) {
    target.cacheSamples++; target.cachedTokens += entry.cachedTokens; target.cacheInputTokens += entry.inputTokens;
  }
  if (entry.cost?.source === 'estimated' && Number.isFinite(entry.cost.amount)) {
    target.pricedCalls++; target.costs[entry.cost.currency] = (target.costs[entry.cost.currency] ?? 0) + entry.cost.amount;
  }
}
export function summarizeUsage(entries, { range = '7d', providerId = '' } = {}, now = Date.now()) {
  if (!['today', '7d', '30d', '90d'].includes(range)) throw new Error('请选择有效的统计周期');
  const days = range === 'today' ? 1 : Number(range.slice(0, -1));
  const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - days + 1);
  const rows = entries.filter(e => e.time >= +start && e.time <= now && (!providerId || e.providerId === providerId));
  const summary = bucket(), models = new Map(), trend = new Map();
  for (let i = 0; i < days; i++) { const d = new Date(start); d.setDate(d.getDate() + i); trend.set(dayKey(+d), { date: dayKey(+d), ...bucket() }); }
  let routedCalls = 0;
  for (const entry of rows) {
    add(summary, entry); add(trend.get(dayKey(entry.time)), entry);
    if (!entry.model) continue;
    routedCalls++;
    const key = JSON.stringify([entry.providerId ?? entry.provider, entry.model]);
    if (!models.has(key)) models.set(key, { key, model: entry.model, provider: entry.provider, providerId: entry.providerId ?? '', ...bucket() });
    add(models.get(key), entry);
  }
  return { range, from: +start, to: now, ...summary, routedCalls,
    cacheHitRate: summary.cacheInputTokens > 0 ? summary.cachedTokens / summary.cacheInputTokens : null,
    models: [...models.values()].sort((a, b) => b.calls - a.calls).map(m => ({ ...m, share: routedCalls ? m.calls / routedCalls : 0 })),
    trend: [...trend.values()] };
}
