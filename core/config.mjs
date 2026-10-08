import { randomBytes, randomUUID } from 'node:crypto';
import { defaultTiers, FEATURES } from './policy.mjs';
import { getProviderPreset, providerOriginChanged } from './providers.mjs';
import { pricingInput } from './usage.mjs';

export function defaults() {
  return {
    version: 3, trayHintShown: false, providers: [], models: [], routing: { tiers: defaultTiers(), rules: [] }, onboardingCompleted: false,
    settings: { port: 18420, autoStart: false, zoomFactor: 1, retainReasoning: false,
      scoreTimeoutMs: 15000, requestTimeoutMs: 180000, allowEscalation: true,
      failureMode: 'block', fallbackModelId: '',
      tiersenseUrl: 'https://tierflow.cn/tiersense/v1/score' },
    secrets: { gatewayKey: `tf_local_${randomBytes(24).toString('hex')}`, tiersenseKey: '', providers: {} },
  };
}
export function validUrl(value, label = '服务地址') {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label}格式不正确`); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error(`${label}须使用 HTTPS，本机服务可使用 HTTP`);
  if (url.username || url.password || url.hash || url.search) throw new Error(`${label}不能包含用户名、密码、查询参数或片段`);
  return url.toString().replace(/\/$/, '');
}
function finiteNumber(v, min, max, label, integer = false) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) throw new Error(`${label}须为 ${min}–${max} ${integer ? '的整数' : '之间的数值'}`);
  return v;
}
function label(v, field) {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > 120) throw new Error(`${field}不能为空且最多 120 个字符`);
  return v.trim();
}
export function providerInput(input, existing) {
  return { id: existing?.id ?? randomUUID(), name: label(input.name, '渠道名称'),
    baseUrl: validUrl(input.baseUrl), enabled: input.enabled !== false,
    preset: getProviderPreset(input.preset).id,
    balanceMonitor: input.balanceMonitor ?? existing?.balanceMonitor ?? false,
    balanceThreshold: finiteNumber(input.balanceThreshold ?? existing?.balanceThreshold ?? 10, 0, 1000000, '低余额提醒值'),
    requestUsage: input.requestUsage ?? existing?.requestUsage ?? false };
}
export function applyProvider(config, input) {
  const existing = config.providers.find(p => p.id === input.id);
  if (input.id && !existing) throw new Error('渠道不存在');
  const provider = providerInput(input, existing);
  if (typeof provider.balanceMonitor !== 'boolean' || typeof provider.requestUsage !== 'boolean') throw new Error('渠道开关值不正确');
  const key = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (!key && providerOriginChanged(existing?.baseUrl, provider.baseUrl)) throw new Error('服务地址已变更，请填写该地址对应的 API Key');
  if (!key && !config.secrets.providers[provider.id]) throw new Error('请填写渠道的 API Key');
  if (existing) config.providers[config.providers.indexOf(existing)] = provider; else config.providers.push(provider);
  if (key) config.secrets.providers[provider.id] = key;
  return provider;
}
export function modelInput(input, config, existing) {
  if (!config.providers.some(p => p.id === input.providerId)) throw new Error('请选择有效的渠道');
  if (!config.routing.tiers.some(t => t.id === input.tier)) throw new Error('请选择有效的模型档次');
  return { id: existing?.id ?? randomUUID(), name: label(input.name, '显示名称'), model: label(input.model, '模型标识'),
    providerId: input.providerId, tier: input.tier, enabled: input.enabled !== false,
    tools: input.tools !== false, vision: input.vision === true,
    priority: finiteNumber(input.priority ?? 1, 1, 100, '优先级', true),
    pricing: pricingInput(input.pricing === undefined ? existing?.pricing : input.pricing) };
}
export function deleteModel(config, id) {
  if (!config.models.some(m => m.id === id)) throw new Error('模型不存在');
  config.models = config.models.filter(m => m.id !== id); pruneModelRules(config, [id]);
  if (config.settings.fallbackModelId === id) { config.settings.fallbackModelId = ''; config.settings.failureMode = 'block'; }
}
export function pruneModelRules(config, removedIds = []) {
  for (const rule of config.routing.rules) {
    rule.modelIds = (rule.modelIds ?? []).filter(id => !removedIds.includes(id) && config.models.some(m => m.id === id && m.tier === rule.tierId));
    if (!rule.modelIds.length) rule.enabled = false;
  }
}
export function importModels(config, input) {
  if (!Array.isArray(input.models) || !input.models.length || input.models.length > 200) throw new Error('每次请选择 1–200 个模型');
  const additions = [];
  for (const item of input.models) {
    const model = modelInput({ ...item, providerId: input.providerId }, config);
    if ([...config.models, ...additions].some(m => m.providerId === model.providerId && m.model === model.model && m.tier === model.tier)) continue;
    additions.push(model);
  }
  config.models.push(...additions);
  return additions.length;
}
export function settingsInput(input, current) {
  const s = { ...current };
  if ('zoomFactor' in input) s.zoomFactor = finiteNumber(input.zoomFactor, 0.8, 1.5, '界面缩放');
  if ('port' in input) s.port = finiteNumber(input.port, 1024, 65535, '端口', true);
  if ('scoreTimeoutMs' in input) s.scoreTimeoutMs = finiteNumber(input.scoreTimeoutMs, 1000, 120000, '评分超时', true);
  if ('requestTimeoutMs' in input) s.requestTimeoutMs = finiteNumber(input.requestTimeoutMs, 10000, 600000, '模型请求超时', true);
  if ('tiersenseUrl' in input) s.tiersenseUrl = validUrl(input.tiersenseUrl, 'TierSense 地址');
  for (const key of ['autoStart', 'allowEscalation', 'retainReasoning']) if (key in input) { if (typeof input[key] !== 'boolean') throw new Error('开关值不正确'); s[key] = input[key]; }
  if ('failureMode' in input) { if (!['block', 'fallback'].includes(input.failureMode)) throw new Error('无效的失败策略'); s.failureMode = input.failureMode; }
  if ('fallbackModelId' in input) s.fallbackModelId = typeof input.fallbackModelId === 'string' ? input.fallbackModelId : '';
  return s;
}
export function publicConfig(config) {
  return { version: config.version, providers: config.providers.map(p => ({ ...p, hasKey: !!config.secrets.providers[p.id] })),
    models: config.models, settings: config.settings, routing: config.routing, onboardingCompleted: config.onboardingCompleted, hasTiersenseKey: !!config.secrets.tiersenseKey,
    account: { connected: false, backendAvailable: false, planPrice: 12.9 },
  };
}

export function routingInput(input) {
  if (!Array.isArray(input?.tiers) || !input.tiers.length || input.tiers.length > 20) throw new Error('请设置 1–20 个模型档次');
  const ids = new Set(); const names = new Set();
  const tiers = input.tiers.map((tier, index) => {
    const id = label(tier.id, '档次标识'); const name = label(tier.name, '档次名称');
    if (ids.has(id) || names.has(name)) throw new Error('档次名称和标识不能重复');
    ids.add(id); names.add(name);
    const minScore = finiteNumber(tier.minScore, 0, 10, '综合难度下限');
    if (index === 0 ? minScore !== 0 : minScore < input.tiers[index - 1].minScore || minScore === input.tiers[index - 1].minScore && !(index === 1 && minScore === 0)) throw new Error('第一档从 0 开始，后续分界须递增');
    return { id, name, minScore };
  });
  if (!Array.isArray(input.rules) || input.rules.length > 100) throw new Error('最多设置 100 条维度规则');
  const ruleIds = new Set();
  const rules = input.rules.map(rule => {
    const id = label(rule.id, '规则标识');
    if (ruleIds.has(id)) throw new Error('规则标识不能重复');
    ruleIds.add(id);
    if (!Object.hasOwn(FEATURES, rule.dimension) || !['gte', 'lt'].includes(rule.operator)) throw new Error('无效的维度评分条件');
    if (!ids.has(rule.tierId)) throw new Error('规则指向的模型档次不存在');
    if (typeof rule.enabled !== 'boolean') throw new Error('规则开关值不正确');
    if (!Array.isArray(rule.modelIds) || rule.modelIds.length > 20 || new Set(rule.modelIds).size !== rule.modelIds.length) throw new Error('请选择最多 20 个不重复的分工模型');
    const modelIds = rule.modelIds.map(id => label(id, '模型标识'));
    if (rule.enabled && !modelIds.length) throw new Error('启用分工前，请选择至少一个模型');
    return { id, name: label(rule.name, '规则名称'), dimension: rule.dimension, operator: rule.operator,
      threshold: finiteNumber(rule.threshold, 0, 2, '维度分数'), tierId: rule.tierId, modelIds, enabled: rule.enabled };
  });
  return { tiers, rules };
}

// Routing, remapped models, and runtime options are committed together by Store.update.
export function applyRouting(config, input) {
  const routing = routingInput(input.routing);
  const reassignments = input.reassignments ?? {};
  for (const [id, assignment] of Object.entries(input.modelAssignments ?? {})) {
    const model = config.models.find(m => m.id === id);
    if (!model) throw new Error('模型列表已变化，请重新打开配置页');
    if (!routing.tiers.some(t => t.id === assignment.tier)) throw new Error('请选择有效的模型档次');
    model.tier = assignment.tier;
    model.priority = finiteNumber(assignment.priority, 1, 100, '默认顺序', true);
  }
  for (const model of config.models) {
    if (routing.tiers.some(t => t.id === model.tier)) continue;
    const target = reassignments[model.tier];
    if (!routing.tiers.some(t => t.id === target)) throw new Error('删除档次前，请指定该档模型迁往哪个模型池');
    model.tier = target;
  }
  config.routing = routing;
  for (const rule of routing.rules) {
    if (rule.modelIds.some(id => !config.models.some(m => m.id === id && m.tier === rule.tierId))) throw new Error('分工模型必须存在，且属于规则指定的档次');
  }
  const options = Object.fromEntries(Object.entries(input.settings ?? {}).filter(([key]) => ['allowEscalation', 'failureMode', 'fallbackModelId'].includes(key)));
  config.settings = settingsInput(options, config.settings);
  if (config.settings.failureMode === 'fallback' && !config.models.some(m => m.id === config.settings.fallbackModelId)) throw new Error('请选择有效的兜底模型');
}

export function migrateConfig(saved) {
  if (![1, 2, 3].includes(saved.version)) throw new Error('配置格式不受支持');
  const config = { ...defaults(), ...saved, settings: { ...defaults().settings, ...saved.settings } };
  if (saved.version === 1) {
    const lower = saved.settings?.lowerThreshold ?? 3.5; const upper = saved.settings?.upperThreshold ?? 7;
    config.routing = { tiers: defaultTiers().map((t, i) => ({ ...t, minScore: [0, lower, upper][i] })), rules: [] };
    // Retain legacy boundary 0/10 exactly, including a pool selected only at score 10.
  }
  delete config.settings.lowerThreshold; delete config.settings.upperThreshold;
  if (saved.version < 3) {
    // A former tier-selection rule cannot express a model preference. Preserve
    // its condition for review, but do not guess which of the user's models it meant.
    config.routing = { ...config.routing, rules: config.routing.rules.map(rule => ({ ...rule, modelIds: [], enabled: false })) };
  }
  config.version = 3;
  config.routing = routingInput(config.routing);
  if (config.models.some(m => !config.routing.tiers.some(t => t.id === m.tier))) throw new Error('模型引用了不存在的档次');
  if (config.routing.rules.some(r => r.modelIds.some(id => !config.models.some(m => m.id === id && m.tier === r.tierId)))) throw new Error('分工规则引用了不存在或其他档次的模型');
  return config;
}
