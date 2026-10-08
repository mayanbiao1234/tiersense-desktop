import { selectRoute, tierRule } from './policy.mjs';

export class GatewayError extends Error {
  constructor(message, status = 400, code = 'invalid_request') { super(message); this.status = status; this.code = code; }
}
export function validateChat(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new GatewayError('请求须为 JSON 对象');
  if (body.model !== 'tierflow-auto') throw new GatewayError('本地路由模型名称为 tierflow-auto', 400, 'model_not_found');
  if (!Array.isArray(body.messages) || !body.messages.length) throw new GatewayError('messages 必须是非空消息数组');
  for (const message of body.messages) {
    if (!message || !['system', 'developer', 'user', 'assistant', 'tool', 'function'].includes(message.role)) throw new GatewayError('消息 role 无效');
    if (message.content !== null && message.content !== undefined && typeof message.content !== 'string' && !Array.isArray(message.content)) throw new GatewayError('消息 content 格式无效');
  }
  if (body.stream !== undefined && typeof body.stream !== 'boolean') throw new GatewayError('stream 须为布尔值');
  if (body.tools !== undefined && !Array.isArray(body.tools)) throw new GatewayError('tools 须为数组');
}
export function requiredCapabilities(body) {
  return {
    tools: !!body.tools?.length || !!body.functions?.length || body.messages.some(m => m.role === 'tool' || m.tool_calls?.length || m.function_call),
    vision: body.messages.some(m => Array.isArray(m.content) && m.content.some(p => ['image_url', 'input_image', 'image'].includes(p.type))),
  };
}
export function validateScores(payload) {
  const values = Array.from({ length: 5 }, (_, i) => payload?.feature_scores?.[`domain${i + 1}`]);
  if (typeof payload?.score !== 'number' || !Number.isFinite(payload.score) || payload.score < 0 || payload.score > 10 || values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 2)) {
    throw new GatewayError('TierSense 返回了无效评分，未发起模型调用', 502, 'invalid_score');
  }
  return { score: payload.score, feature_scores: Object.fromEntries(values.map((v, i) => [`domain${i + 1}`, v])) };
}
export function candidates(config, body, scores, fallback = false) {
  const requirements = requiredCapabilities(body);
  const tier = fallback ? null : selectRoute(scores, config.routing).tierId;
  const tiers = config.routing.tiers.map(t => t.id);
  const preferences = new Map(fallback ? [] : tiers.map(id => [id, tierRule(scores, config.routing, id)?.modelIds ?? []]));
  const preference = model => { const ids = preferences.get(model.tier) ?? []; const rank = ids.indexOf(model.id); return rank < 0 ? ids.length : rank; };
  const pool = config.models.filter(model => {
    const provider = config.providers.find(p => p.id === model.providerId);
    return model.enabled && provider?.enabled && config.secrets.providers[provider.id]
      && (!requirements.tools || model.tools) && (!requirements.vision || model.vision)
      && (fallback ? model.id === config.settings.fallbackModelId : model.tier === tier || config.settings.allowEscalation && tiers.indexOf(model.tier) > tiers.indexOf(tier));
  }).sort((a, b) => tiers.indexOf(a.tier) - tiers.indexOf(b.tier) || preference(a) - preference(b) || a.priority - b.priority || a.id.localeCompare(b.id));
  if (!pool.length) throw new GatewayError(fallback ? '没有符合请求能力要求的兜底模型' : '当前档次没有可用模型，请检查模型档次、渠道密钥及工具 / 视觉能力', 503, 'no_eligible_model');
  return pool;
}
export function scorePayload(body) {
  const payload = { model: 'TierSense', messages: body.messages };
  if (typeof body.tierflow_task === 'string' && body.tierflow_task.trim()) payload.task = body.tierflow_task.trim();
  return payload;
}
export async function scoreStep(config, body, signal, fetcher = fetch, serialized = JSON.stringify(scorePayload(body))) {
  if (!config.secrets.tiersenseKey) throw new GatewayError('请先在客户端连接 TierSense', 503, 'tiersense_not_configured');
  const controllerSignal = AbortSignal.any([signal, AbortSignal.timeout(config.settings.scoreTimeoutMs)]);
  let response;
  try {
    response = await fetcher(config.settings.tiersenseUrl, { method: 'POST', redirect: 'error', signal: controllerSignal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.secrets.tiersenseKey}` }, body: serialized });
  } catch { throw new GatewayError(signal.aborted ? '请求已取消' : 'TierSense 连接失败或评分超时', signal.aborted ? 499 : 504, 'score_unavailable'); }
  if (!response.ok) {
    await response.body?.cancel();
    const detail = response.status === 422 ? '消息历史缺少原始任务，请传完整历史或 tierflow_task' : response.status === 401 || response.status === 403 ? 'TierSense 授权失败，请检查 Key 与权限' : `TierSense 服务返回 HTTP ${response.status}`;
    throw new GatewayError(detail, 502, 'score_failed');
  }
  try { return validateScores(await response.json()); }
  catch (error) {
    if (controllerSignal.aborted) throw new GatewayError(signal.aborted ? '请求已取消' : 'TierSense 评分等待超时', signal.aborted ? 499 : 504, 'score_unavailable');
    if (error instanceof GatewayError) throw error;
    throw new GatewayError('TierSense 未返回有效 JSON', 502, 'invalid_score');
  }
}
