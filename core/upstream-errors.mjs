import { createHash } from 'node:crypto';
import { GatewayError } from './router.mjs';

// Never display or persist the provider's raw error: it can echo prompts and keys.
export async function upstreamFailure(response) {
  let data; let text = ''; let size = 0;
  const reader = response.body?.getReader();
  try {
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 65536) throw new Error('oversized');
        text += decoder.decode(value, { stream: true });
      }
      data = JSON.parse(text + decoder.decode());
    }
  } catch { data = null; }
  finally { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } }
  const error = data?.error ?? data;
  const description = [error?.code, error?.type, error?.message].filter(v => typeof v === 'string').join(' ');
  const status = response.status;
  const failure = (message, code, retry = false, cooldownMs = 0, scope = 'model', clientStatus = 502) => Object.assign(new GatewayError(message, clientStatus, code), { retry, cooldownMs, scope });
  if ([400, 422].includes(status) && /reasoning_content/i.test(description) && /must|required|missing|passed\s*back|缺少|回传|必[须填]/i.test(description)) return failure('这段对话的部分历史思考已丢失，无法完整恢复。请在 AI 工具中新建对话后重试，连接信息无需修改。', 'reasoning_history_missing', false, 0, 'model', 400);
  if (/content_filter|content[_ ]?policy|safety|sensitive|内容审核|安全审核/i.test(description)) return failure('模型平台未接受本次内容，请查看该平台的使用规则或调整请求。', 'content_rejected', false, 0, 'model', 400);
  if (/product is not activated|model.*not activated|服务未开通|模型未开通/i.test(description)) return failure('该模型尚未在渠道平台开通。请登录这把密钥所属的平台账号，开通模型服务后重试。', 'model_not_activated', true, 120000);
  if (/insufficient[_ ]?(balance|quota|credit)|balance.*insufficient|credit.*(exhaust|insufficient)|arrear|overdue|余额不足|欠费|额度.*(不足|用尽)/i.test(description) || status === 402) return failure('渠道余额或可用额度不足，请在对应平台充值或补充额度。', 'insufficient_balance', true, 60000, 'provider');
  if (status === 401 || /invalid[_ ]?api[_ ]?key|incorrect api key|api key.*(invalid|expired)/i.test(description)) return failure('渠道访问密钥无效或已过期，请在“模型渠道”中更新密钥。', 'upstream_authentication', true, 60000, 'provider');
  if (/model[_ ]not[_ ]found|model.*(does not exist|not found)|模型.*不存在/i.test(description)) return failure('渠道找不到这个模型，请刷新渠道模型列表并检查模型名称。', 'model_not_found', true, 120000);
  if (status === 403 || /access.?denied|permission.?denied|not authorized/i.test(description)) return failure('当前密钥没有调用该模型的权限，请在渠道平台检查模型授权。', 'model_access_denied', true, 60000);
  if (status === 429) {
    const value = response.headers.get('retry-after');
    const parsed = value && (/^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now());
    return failure('渠道调用过于频繁，已暂缓尝试这个模型，请稍后重试。', 'upstream_rate_limited', true, Math.min(120000, Math.max(1000, Number.isFinite(parsed) && parsed > 0 ? parsed : 15000)), 'model', 429);
  }
  if ([400, 413, 422].includes(status) && /context_length|maximum context|input length|too many tokens|上下文.*(超|长)|输入.*超.*(长|限)/i.test(description)) return failure('当前对话超过该模型的长度限制，请在 AI 工具中压缩历史或使用支持更长对话的模型。', 'context_limit', true, 0, 'model', 400);
  if ([400, 422].includes(status) && /(?:does not support|not support|unsupported|不支持).*(?:tool|function|vision|image|工具|图片)|(?:tool|function|vision|image).*(?:not support|unsupported)/i.test(description)) return failure('该模型不支持本次请求需要的工具或图片能力，请检查模型能力设置。', 'model_capability', true);
  if ([500, 502, 503, 504].includes(status)) return failure('模型渠道暂时不可用，请稍后重试。', 'upstream_unavailable', true, 15000);
  if ([400, 422].includes(status)) return failure('模型平台未接受本次请求的参数。请检查 AI 工具的模型设置，并用请求编号反馈问题。', 'upstream_invalid_request', false, 0, 'model', 400);
  return failure(`模型渠道返回 HTTP ${status}。请检查渠道状态，或使用请求编号联系支持。`, 'upstream_error');
}

export class ModelHealth {
  constructor({ now = Date.now, limit = 512 } = {}) { this.now = now; this.limit = limit; this.entries = new Map(); }
  key(config, provider, model, scope) { return createHash('sha256').update(JSON.stringify([provider.id, provider.baseUrl, config.secrets.providers[provider.id], scope === 'provider' ? null : model.model])).digest('hex'); }
  clear() { this.entries.clear(); }
  blocked(config, provider, model) {
    for (const [key, entry] of this.entries) if (entry.until <= this.now()) this.entries.delete(key);
    return this.entries.get(this.key(config, provider, model, 'provider')) ?? this.entries.get(this.key(config, provider, model, 'model'));
  }
  fail(config, provider, model, error) {
    if (!error.cooldownMs) return;
    this.entries.set(this.key(config, provider, model, error.scope), { error, until: this.now() + error.cooldownMs });
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
  }
}
