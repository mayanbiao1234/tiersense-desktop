import { useEffect, useState } from 'react';
import { Activity, ArrowRight, ArrowUpRight, BarChart3, CircleHelp, Coins, Database, Gauge, Search } from 'lucide-react';
import type { API, Analytics, Log } from './types';
import { Badge, Button, Empty, Modal, SectionHead } from './ui';
import { FEATURES } from '../core/policy.mjs';
import { summarizeUsage } from '../core/usage.mjs';
import { invoke, preview } from './api';

const fmt = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('zh-CN');
const duration = (ms: number) => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
const money = (amount: number | null | undefined, currency = 'CNY') => amount == null ? '—' : `${currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency + ' '}${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
const costs = (values: Record<string, number>) => Object.keys(values).length ? Object.entries(values).map(([currency, amount]) => money(amount, currency)).join(' / ') : '—';
const pct = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
const retryReasons: Record<string, string> = { model_not_activated: '模型尚未开通', insufficient_balance: '余额或额度不足', upstream_authentication: '密钥无效或过期', model_not_found: '模型不存在', model_access_denied: '模型未授权', upstream_rate_limited: '调用过于频繁', context_limit: '对话超出模型长度限制', model_capability: '能力不匹配', upstream_unavailable: '渠道暂时不可用', upstream_connection: '渠道连接失败', reasoning_history_missing: '历史思考缺失', upstream_invalid_request: '参数不兼容' };

export function LogDialog({ log, onClose }: { log: Log; onClose: () => void }) {
  const hitRate = log.cachedTokens != null && log.inputTokens ? log.cachedTokens / log.inputTokens : null;
  return <Modal title="使用详情" onClose={onClose} wide><div className="modal-body">
    <div className="log-detail-grid">{[
      ['模型', log.model || '未调用'], ['渠道', log.provider || '—'], ['使用时间', new Date(log.time).toLocaleString('zh-CN', { hour12: false })],
      ['结果', log.status === 'success' ? '成功' : log.status === 'cancelled' ? '已取消' : '未成功'], ['等待时间', duration(log.durationMs)], ['文本用量（Token）', fmt(log.totalTokens)], ['预估费用', money(log.cost?.amount, log.cost?.currency)],
      ['输入 Token', fmt(log.inputTokens)], ['输出 Token', fmt(log.outputTokens)], ['缓存命中 Token', fmt(log.cachedTokens)], ['输入缓存命中率', pct(hitRate)],

    ].map(([key, value]) => <div key={key}><span>{key}</span><strong>{value}</strong></div>)}</div>
    <details className="disclosure"><summary>费用怎么算？</summary><div className="disclosure-body usage-explanation"><strong>{log.cost?.note ?? '费用未知'}</strong><p>{log.pricing ? `调用时单价：普通输入 ${log.pricing.input ?? '未知'} / 输出 ${log.pricing.output ?? '未知'} / 缓存命中 ${log.pricing.cacheRead ?? '按普通输入计价'} ${log.pricing.currency}，单位为每百万 Token。` : '可在模型编辑页填写单价；修改仅影响之后的调用。'}{log.attempts > 1 && ' 仅估算最终模型返回的用量，早前失败尝试的账单需向渠道核对。'}</p></div></details>
    <details className="disclosure"><summary>查看选模原因和难度评分</summary><div className="disclosure-body"><div className="log-detail-grid">{[['使用档次', log.tierName || log.tier || '—'], ['综合难度', log.score?.toFixed(2) ?? '—'], ['推理 Token（包含在输出中）', fmt(log.reasoningTokens)], ['尝试次数', String(log.attempts)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    {log.route && <div className="route-reason"><strong>{log.route.ruleId ? '先分档，再命中模型分工' : '综合分档 · 同档默认顺序'}</strong><p>{log.route.reason}</p>{log.tier !== log.route.tierId && <small>实际升级至 {log.tierName}档，以匹配模型能力或可用渠道。</small>}</div>}
    {log.featureScores && <div className="feature-scores">{Object.entries(FEATURES).map(([id, name]) => <div key={id}><span>{name}</span><meter min="0" max="2" value={log.featureScores![id as keyof typeof FEATURES]} /><b>{log.featureScores![id as keyof typeof FEATURES].toFixed(2)} <small>/ 2</small></b></div>)}</div>}
    <p className="form-note mono">请求编号：{log.id}</p></div></details>
    <details className="disclosure"><summary>等待时间与备用处理</summary><div className="disclosure-body">
      <div className="log-detail-grid">{[['难度判断', duration(log.scoreMs)], ['评分方式', log.scoreSource === 'cache' ? '复用相同请求的评分' : log.scoreSource === 'shared' ? '合并相同请求的判断' : log.score == null ? '判断未完成' : '本次重新判断'], ['模型调用阶段', log.modelMs == null ? '—' : duration(log.modelMs)], ['最终渠道响应等待', log.upstreamWaitMs == null ? '—' : duration(log.upstreamWaitMs)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      {log.code && log.fallback && log.status === 'success' && <p>本次难度判断未完成，已按你设置的兜底模型继续。</p>}
      {!!log.retryTrace?.length && <ol className="plain-list">{log.retryTrace.map((attempt, i) => <li key={i}><strong>{attempt.model}</strong> · {attempt.provider}<p>{attempt.skipped ? '临时跳过' : attempt.code ? '本次未成功' : '已接收渠道响应'}{attempt.code ? `：${retryReasons[attempt.code] ?? '渠道调用失败'}` : ''}</p></li>)}</ol>}
      {log.retryTrace?.some(attempt => attempt.skipped || attempt.code) && <p className="form-note">备用模型遵循已保存的档次、分工和升级设置。临时等待最长 2 分钟；处理好权限或额度后，可在设置中“恢复模型尝试”。</p>}
    </div></details>
    {log.error && <div className="info-strip error-text"><CircleHelp size={16} /><span>{log.error}<small>{log.code}</small></span></div>}
    <p className="form-note">Token 是文本用量的计费单位。缓存命中表示平台复用了部分输入。“—”表示平台没有返回数据。费用仅供参考，以平台账单为准。</p>
  </div></Modal>;
}

export function LogTable({ state, setModal, setPage }: Pick<API, 'state' | 'setModal' | 'setPage'>) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [cacheFilter, setCacheFilter] = useState('all'), [page, setCurrentPage] = useState(0);
  const rows = state.logs.filter(l => (!query || `${l.model} ${l.provider} ${l.id}`.toLowerCase().includes(query.toLowerCase())) && (filter === 'all' || l.status === filter) && (cacheFilter === 'all' || cacheFilter === 'hit' && (l.cachedTokens ?? 0) > 0 || cacheFilter === 'miss' && l.cachedTokens === 0 || cacheFilter === 'unknown' && l.cachedTokens == null));
  const last = Math.max(0, Math.ceil(rows.length / 30) - 1), current = Math.min(page, last);
  useEffect(() => setCurrentPage(0), [query, filter, cacheFilter]);
  return <><div className="table-tools usage-tools"><label className="search"><Search size={16} /><input placeholder="搜索模型或渠道" value={query} onChange={e => setQuery(e.target.value)} /></label><select value={filter} onChange={e => setFilter(e.target.value)} aria-label="筛选状态"><option value="all">全部状态</option><option value="success">成功</option><option value="error">失败</option><option value="cancelled">已取消</option></select><select value={cacheFilter} onChange={e => setCacheFilter(e.target.value)} aria-label="筛选缓存"><option value="all">全部缓存状态</option><option value="hit">有缓存命中</option><option value="miss">无缓存命中</option><option value="unknown">缓存未返回</option></select></div>
    <div className="table-wrap"><table className="usage-log-table"><thead><tr><th>时间</th><th>模型 / 渠道</th><th>文本用量</th><th>缓存复用</th><th>预估费用</th><th>状态</th><th /></tr></thead><tbody>{rows.slice(current * 30, (current + 1) * 30).map(l => <tr key={l.id} className="clickable" onClick={() => setModal({ type: 'log', data: l })}>
      <td className="mono">{new Date(l.time).toLocaleDateString('zh-CN')}<small>{new Date(l.time).toLocaleTimeString('zh-CN', { hour12: false })}</small></td><td><strong>{l.model || '尚未调用模型'}</strong><small>{l.provider || '评分阶段'}</small></td>
      <td className="mono">{fmt(l.totalTokens)}<small>Token</small></td><td>{l.cachedTokens == null ? <span className="unknown-value">未返回</span> : <><strong>{fmt(l.cachedTokens)} Token</strong><small>{l.inputTokens ? pct(l.cachedTokens / l.inputTokens) : '—'} 输入命中率</small></>}</td>
      <td className="mono" title={l.cost?.note}>{money(l.cost?.amount, l.cost?.currency)}<small>{l.cost?.source === 'estimated' ? `${l.cost.currency} · 估算` : '用量或单价待补全'}</small></td>
      <td><Badge color={l.status === 'success' ? 'green' : l.status === 'error' ? 'red' : ''}>{l.status === 'success' ? '成功' : l.status === 'error' ? '失败' : '已取消'}</Badge></td><td><button className="text-button" aria-label={`查看调用 ${l.id}`} onClick={e => { e.stopPropagation(); setModal({ type: 'log', data: l }); }}>详情</button></td>
    </tr>)}</tbody></table></div>
    {!rows.length ? <Empty icon={Activity} title={query || filter !== 'all' || cacheFilter !== 'all' ? '没有匹配的记录' : '你的第一次调用，从这里开始'} text="在已连接的 AI 工具里发送消息，使用结果会出现在这里。"><Button kind="secondary" onClick={() => setPage('connection')} icon={ArrowUpRight}>查看连接方法</Button></Empty> : <div className="table-pagination"><span>{rows.length} 条记录 · 最近 500 条以内</span><div><Button kind="secondary" disabled={current === 0} onClick={() => setCurrentPage(current - 1)}>上一页</Button><span>{current + 1} / {last + 1}</span><Button kind="secondary" disabled={current === last} onClick={() => setCurrentPage(current + 1)}>下一页</Button></div></div>}
  </>;
}

const colors = ['#2760f5', '#29a6a1', '#8b6ce0', '#efa545', '#e76c8b', '#8b98b4'];
export function AnalyticsPage({ state, setPage }: API) {
  const [range, setRange] = useState('7d'), [providerId, setProviderId] = useState('');
  const [data, setData] = useState<Analytics | null>(null), [error, setError] = useState('');
  useEffect(() => setData(null), [range, providerId]);
  useEffect(() => {
    let live = true; setError('');
    const result = preview ? Promise.resolve({ ...summarizeUsage(state.logs, { range, providerId }), history: state.history }) : invoke<Analytics>('analytics.get', { range, providerId });
    void result.then(value => { if (live) setData(value); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [range, providerId, state.history.revision]);
  const top = data?.models.slice(0, 5).map((m, i) => ({ label: m.model, provider: m.provider, share: m.share, calls: m.calls, color: colors[i] })) ?? [];
  if (data && data.models.length > 5) top.push({ label: '其他模型', provider: `${data.models.length - 5} 个模型 / 渠道组合`, share: data.models.slice(5).reduce((n, m) => n + m.share, 0), calls: data.models.slice(5).reduce((n, m) => n + m.calls, 0), color: colors[5] });
  let angle = 0; const gradient = top.map(m => { const from = angle; angle += m.share * 360; return `${m.color} ${from}deg ${angle}deg`; }).join(',');
  const maxCalls = Math.max(1, ...data?.trend.map(d => d.calls) ?? [0]);
  return <><SectionHead title="用量与费用" text="了解用了哪些模型、用了多少额度。费用是根据你填写的单价估算的。" action={<Button kind="secondary" icon={Coins} onClick={() => setPage('models')}>设置模型单价</Button>} />
    <div className="analytics-filters"><div role="group" aria-label="统计周期">{[['today', '今天'], ['7d', '近 7 天'], ['30d', '近 30 天'], ['90d', '近 90 天']].map(([value, label]) => <button key={value} aria-pressed={range === value} className={range === value ? 'active' : ''} onClick={() => setRange(value)}>{label}</button>)}</div><select aria-label="统计渠道" value={providerId} onChange={e => setProviderId(e.target.value)}><option value="">全部渠道</option>{state.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
    {(error || state.history.error) && <div className="info-strip error-text" role="status"><CircleHelp size={17} /><span>{error || state.history.error}</span></div>}
    {!data && !error && <div className="analytics-loading">正在统计本地用量…</div>}
    {data && <>
      <div className="metrics usage-metrics">{[
        { name: '使用次数', value: fmt(data.calls), sub: `成功 ${fmt(data.success)} 次 · 成功率 ${data.calls ? pct(data.success / data.calls) : '—'}`, icon: Activity },
        { name: '文本用量（Token）', value: data.usageSamples ? fmt(data.totalTokens) : '—', sub: `${data.usageSamples} / ${data.calls} 次返回总用量`, icon: Gauge },
        { name: '缓存复用比例', value: pct(data.cacheHitRate), sub: data.cacheSamples ? `${data.cacheSamples} 次有缓存明细 · 命中 ${fmt(data.cachedTokens)} Token` : '尚未返回缓存明细', icon: Database },
        { name: '预估消费', value: costs(data.costs), sub: `${data.pricedCalls} / ${data.calls} 次可估算 · 分币种统计`, icon: Coins },
      ].map(m => <div className="metric" key={m.name}><div className="metric-label">{m.name}<m.icon size={17} /></div><div className="metric-value">{m.value}</div><div className="metric-sub">{m.sub}</div></div>)}</div>
      <div className="analytics-charts"><section className="card padded"><div className="card-heading"><div><h3>各模型的使用比例</h3><p>本周期使用了哪些模型。</p></div><BarChart3 size={17} /></div>
        {data.routedCalls ? <div className="model-share"><div className="usage-donut" style={{ background: `conic-gradient(${gradient})` }} role="img" aria-label={`模型调用比例：${top.map(m => `${m.label} ${pct(m.share)}`).join('，')}`}><div><strong>{fmt(data.routedCalls)}</strong><span>次模型选择</span></div></div><div className="share-legend">{top.map((m, i) => <div key={i}><i style={{ background: m.color }} /><span><strong>{m.label}</strong><small>{m.provider} · {m.calls} 次</small></span><b>{pct(m.share)}</b></div>)}</div></div> : <Empty icon={BarChart3} title="还没有模型调用" text="模型请求完成后，会自动生成占比。" />}
      </section><section className="card padded"><div className="card-heading"><div><h3>每天用了多少次</h3><p>指向柱形可查看当天用量和预估费用。</p></div><Activity size={17} /></div><div className="usage-trend" role="img" aria-label={`每日调用趋势，总计 ${data.calls} 次`}>{data.trend.map(d => <div key={d.date} title={`${d.date}\n${d.calls} 次调用 · ${d.totalTokens} 已知 Token\n预估 ${costs(d.costs)}`}><div className="trend-bar" style={{ height: `${d.calls ? Math.max(3, d.calls / maxCalls * 100) : 0}%` }} /><small>{data.trend.length <= 7 || data.trend.indexOf(d) % Math.ceil(data.trend.length / 6) === 0 ? d.date.slice(5) : ''}</small></div>)}</div><div className="trend-range"><span>{data.trend[0]?.date}</span><span>{data.trend.at(-1)?.date}</span></div></section></div>
      <section className="card"><div className="card-heading analytics-table-heading"><div><h3>模型用量与消费</h3><p>不同渠道的同名模型分别统计；删除模型后保留历史。</p></div><button className="text-button" onClick={() => setPage('logs')}>查看使用记录 <ArrowRight size={14} /></button></div><div className="table-wrap"><table className="model-usage-table"><thead><tr><th>模型 / 渠道</th><th>调用 / 成功</th><th>比例</th><th>输入 / 输出 Token</th><th>命中缓存 Token</th><th>预估消费</th></tr></thead><tbody>{data.models.map(m => <tr key={m.key}><td><strong>{m.model}</strong><small>{m.provider}</small></td><td>{m.calls} / {m.success}</td><td>{pct(m.share)}</td><td>{`${m.inputSamples ? fmt(m.inputTokens) : '—'} / ${m.outputSamples ? fmt(m.outputTokens) : '—'}`}<small>{m.usageSamples} 次返回总用量</small></td><td>{m.cacheSamples ? fmt(m.cachedTokens) : '—'}</td><td>{costs(m.costs)}<small>{m.pricedCalls} / {m.calls} 次已估算</small></td></tr>)}</tbody></table></div>{!data.models.length && <Empty icon={Gauge} title="暂无可统计的模型" text="使用后自动生成统计，不包含你在其他软件中直接调用平台的记录。" />}</section>
      <details className="disclosure card"><summary>这些数字怎么算？</summary><div className="disclosure-body"><p>Token 是文本计量单位，缓存复用可能降低费用。未返回的用量不会当作 0。</p><p>仅统计本客户端保留的记录：最近 90 天，最多 10,000 条；当前保留 {fmt(data.history.count)} 条。缓存率 = 已返回缓存明细的命中输入 Token ÷ 对应输入 Token。未返回的数据不视为 0。预估消费使用调用当时的单价，不包含 TierSense、早前失败重试、额外工具费或渠道套餐优惠；不同币种不相加。余额来自渠道账户，不用于反推本地消费。</p></div></details>
      {!!data.calls && data.pricedCalls < data.calls && <div className="info-strip"><Coins size={17} /><span>{data.calls - data.pricedCalls} 次请求缺少完整用量或单价，暂未计入费用。请在模型编辑页补全单价，用于之后的请求。</span></div>}
    </>}
  </>;
}
