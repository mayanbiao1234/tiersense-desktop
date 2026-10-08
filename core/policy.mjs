// Shared by the gateway and the local rule preview. No credentials or network access.
export const FEATURES = {
  domain1: '代码修复', domain2: '工具调用', domain3: '多跳推理', domain4: '任务分解', domain5: '规划',
};
export const defaultTiers = () => [
  { id: 'economy', name: '轻量', minScore: 0 },
  { id: 'balanced', name: '均衡', minScore: 3.5 },
  { id: 'flagship', name: '旗舰', minScore: 7 },
];
export function scoreTier(score, tiers) {
  return tiers.findLast(tier => score >= tier.minScore)?.id ?? tiers[0].id;
}
export function tierRule(scores, routing, tierId) {
  return routing.rules.find(r => r.enabled && r.tierId === tierId && r.modelIds?.length && (r.operator === 'gte'
    ? scores.feature_scores[r.dimension] >= r.threshold
    : scores.feature_scores[r.dimension] < r.threshold));
}
export function selectRoute(scores, routing, models = []) {
  const tierId = scoreTier(scores.score, routing.tiers);
  const rule = tierRule(scores, routing, tierId);
  const tierName = routing.tiers.find(t => t.id === tierId)?.name ?? tierId;
  const selected = rule?.modelIds.map(id => models.find(m => m.id === id)?.name ?? id).join(' → ');
  return { tierId, tierName, ruleId: rule?.id ?? '', ruleName: rule?.name ?? '',
    preferredModelIds: rule?.modelIds ?? [],
    reason: `综合难度 ${scores.score.toFixed(2)} → ${tierName}档；` + (rule ? `${FEATURES[rule.dimension]} ${scores.feature_scores[rule.dimension].toFixed(2)} ${rule.operator === 'gte' ? '≥' : '<'} ${rule.threshold} → 优先 ${selected}` : '未命中档内分工，按默认顺序选模型') };
}
// Static readiness only: credentials and model permissions are checked on a real request.
export function readiness(config) {
  const providers = config.providers.filter(p => p.enabled && (p.hasKey ?? !!config.secrets?.providers[p.id]));
  const models = config.models.filter(m => m.enabled && providers.some(p => p.id === m.providerId));
  const uncovered = config.routing.tiers.filter((tier, index) => !models.some(m => m.tier === tier.id || config.settings.allowEscalation && config.routing.tiers.findIndex(t => t.id === m.tier) > index));
  return { providers: providers.length > 0, models: models.length > 0 && !uncovered.length,
    tiersense: config.hasTiersenseKey ?? !!config.secrets?.tiersenseKey, uncovered: uncovered.map(t => t.name) };
}
