const adapters = {
  deepseek: { origin: 'https://api.deepseek.com', paths: ['', '/', '/v1'], endpoint: '/user/balance' },
  moonshot: { origin: 'https://api.moonshot.cn', paths: ['/v1'], endpoint: '/v1/users/me/balance' },
  siliconflow: { origin: 'https://api.siliconflow.cn', paths: ['/v1'], endpoint: '/v1/user/info' },
};
export function balanceCapability(provider) {
  const adapter = adapters[provider.preset];
  if (!adapter) return { supported: false, reason: provider.preset === 'tierflow' ? 'TierFlow 余额接口待接入' : '此渠道暂未接入余额接口' };
  try {
    const url = new URL(provider.baseUrl);
    if (url.origin !== adapter.origin || !adapter.paths.includes(url.pathname.replace(/\/$/, '')) || url.search || url.hash || url.username || url.password) return { supported: false, reason: '余额查询仅适用于该厂商的内置官方地址' };
  } catch { return { supported: false, reason: '渠道地址无效' }; }
  return { supported: true, reason: '', url: `${adapter.origin}${adapter.endpoint}` };
}
const amount = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null;
export function parseBalance(preset, data) {
  let result;
  if (preset === 'deepseek') {
    if (!Array.isArray(data.balance_infos)) throw new Error('invalid');
    result = data.balance_infos.map(b => ({ currency: b.currency, total: amount(b.total_balance), cash: amount(b.topped_up_balance), granted: amount(b.granted_balance) }));
  } else if (preset === 'moonshot') {
    if (data.status !== true || data.code !== 0) throw new Error('invalid');
    result = [{ currency: 'CNY', total: amount(data.data?.available_balance), cash: amount(data.data?.cash_balance), granted: amount(data.data?.voucher_balance) }];
  } else if (preset === 'siliconflow') {
    if (data.status !== true || data.code !== 20000) throw new Error('invalid');
    result = [{ currency: 'CNY', total: amount(data.data?.totalBalance), cash: amount(data.data?.chargeBalance), granted: amount(data.data?.balance) }];
  }
  if (!result?.length || result.length > 5 || result.some(b => !['CNY', 'USD'].includes(b.currency) || b.total === null)) throw new Error('余额接口返回格式不受支持');
  return result;
}
async function limitedJson(response) {
  const buffers = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 262144) throw new Error('invalid'); buffers.push(chunk); }
  return JSON.parse(Buffer.concat(buffers).toString());
}
export class BalanceMonitor {
  constructor(store, onChange = () => {}, fetcher = fetch, now = Date.now) { this.store = store; this.onChange = onChange; this.fetcher = fetcher; this.now = now; this.cache = new Map(); this.pending = new Map(); }
  identity(provider) { return JSON.stringify([provider.preset, provider.baseUrl, this.store.config.secrets.providers[provider.id]]); }
  view(provider) {
    const capability = balanceCapability(provider); const cached = this.cache.get(provider.id);
    const valid = cached?.identity === this.identity(provider);
    const { identity, ...data } = valid ? cached : {};
    return { supported: capability.supported, reason: capability.reason, status: capability.supported ? 'idle' : 'unsupported', balances: [], checkedAt: null, attemptedAt: null, error: '', ...data,
      refreshing: this.pending.has(provider.id), low: !!valid && cached.balances.some(b => b.total <= (provider.balanceThreshold ?? 10)) };
  }
  snapshot() { return Object.fromEntries(this.store.config.providers.map(p => [p.id, this.view(p)])); }
  refresh(id) {
    if (this.pending.has(id)) return this.pending.get(id);
    const provider = this.store.config.providers.find(p => p.id === id);
    if (!provider) return Promise.reject(new Error('渠道不存在'));
    const capability = balanceCapability(provider), key = this.store.config.secrets.providers[id];
    if (!capability.supported) return Promise.reject(new Error(capability.reason));
    if (!provider.enabled || !key) return Promise.reject(new Error('请先启用渠道并配置 API Key'));
    const identity = this.identity(provider); const previous = this.cache.get(id);
    // Manual refresh is throttled too. A single channel never has overlapping queries.
    if (previous?.identity === identity && this.now() - previous.attemptedAt < 15000) return Promise.resolve(this.view(provider));
    const op = (async () => {
      let next = { identity, status: 'error', balances: previous?.identity === identity ? previous.balances : [], checkedAt: previous?.identity === identity ? previous.checkedAt : null, attemptedAt: this.now(), error: '' };
      try {
        const response = await this.fetcher(capability.url, { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
        if (!response.ok) { await response.body?.cancel(); next.error = `查询失败（HTTP ${response.status}），请检查 Key 权限、额度或稍后重试。`; }
        else { next.balances = parseBalance(provider.preset, await limitedJson(response)); next.status = 'ready'; next.checkedAt = this.now(); }
      } catch { next.error = '余额查询失败或格式不受支持，请检查网络与渠道权限后重试。'; }
      const current = this.store.config.providers.find(p => p.id === id);
      if (current && this.identity(current) === identity) this.cache.set(id, next);
      return current ? this.view(current) : null;
    })().finally(() => { this.pending.delete(id); this.onChange(); });
    this.pending.set(id, op); this.onChange(); return op;
  }
  async refreshEnabled() { await Promise.allSettled(this.store.config.providers.filter(p => p.enabled && p.balanceMonitor && balanceCapability(p).supported).map(p => this.refresh(p.id))); }
  start() { void this.refreshEnabled(); this.timer = setInterval(() => void this.refreshEnabled(), 5 * 60000); this.timer.unref?.(); }
  stop() { clearInterval(this.timer); }
}
