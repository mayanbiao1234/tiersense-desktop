import { KeyRound, Layers3, Network, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { API, Provider } from './types';
import { Badge, Button, Empty, SectionHead, Toggle } from './ui';
import { ProviderCatalog, ProviderMark } from './Providers';
import { getProviderPreset } from '../core/providers.mjs';
import { balanceCapability } from '../core/balances.mjs';
import { useViewState } from './ui-state';
import { useCurrentAlerts } from './Workspace';

export function ProviderPanel({ state, busy, execute, setModal }: API) {
  const [query, setQuery] = useViewState('providers.query', '');
  const [filter, setFilter] = useViewState('providers.status', 'all');
  const alerts = useCurrentAlerts(state.modelAlerts);
  const needsAttention = (p: Provider) => p.enabled && (!p.hasKey || state.balances[p.id]?.low || !!state.balances[p.id]?.error || alerts.some(a => a.providerId === p.id));
  const filtered = state.providers.filter(p => `${p.name} ${getProviderPreset(p.preset).name}`.toLowerCase().includes(query.trim().toLowerCase()) && (filter === 'all' || filter === 'on' && p.enabled || filter === 'off' && !p.enabled || filter === 'attention' && needsAttention(p)));
  const reset = () => { setQuery(''); setFilter('all'); };
  return <><SectionHead title="模型渠道" text="管理模型平台的访问密钥、可选模型和账户余额。" action={<Button icon={Plus} onClick={() => setModal({ type: 'provider' })}>添加渠道</Button>} />
    {state.providers.length ? <>
      <div className="directory-toolbar"><label className="search"><Search size={16} /><input aria-label="搜索渠道" placeholder="搜索渠道名称" value={query} onChange={e => setQuery(e.target.value)} /></label><select aria-label="筛选渠道状态" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部状态</option><option value="on">已启用</option><option value="off">已停用</option><option value="attention">需要处理</option></select></div>
      <div className="directory-summary"><span>{query || filter !== 'all' ? `找到 ${filtered.length} 个渠道` : `共 ${state.providers.length} 个渠道 · ${state.providers.filter(p => p.enabled).length} 个已启用`}</span>{(query || filter !== 'all') && <button className="text-button" onClick={reset}>清除筛选</button>}</div>
      <div className="channel-directory card">{filtered.map(p => {
        const data = state.balances[p.id], capability = balanceCapability(p), modelCount = state.models.filter(m => m.providerId === p.id).length;
        const alert = alerts.find(a => a.providerId === p.id);
        return <article className={`channel-row ${!p.enabled ? 'row-disabled' : ''}`} key={p.id}>
          <div className="channel-row-main"><div className="channel-identity"><ProviderMark preset={p.preset} /><div><div className="channel-title"><button className="entity-name" onClick={() => setModal({ type: 'provider', data: p })}>{p.name}</button><Badge color={p.enabled && !p.hasKey ? 'amber' : ''}>{!p.enabled ? '已停用' : p.hasKey ? '已启用' : '待填写密钥'}</Badge></div><p><KeyRound size={12} />{p.hasKey ? '密钥已保存' : '尚未填写密钥'}<span>·</span>{modelCount} 个模型</p></div></div>
            <div className="channel-balance"><span>{data?.error ? '余额查询失败' : '渠道可用余额'}</span><div>{data?.balances.length ? data.balances.map(b => <strong key={b.currency}>{b.currency === 'CNY' ? '¥' : b.currency === 'USD' ? '$' : `${b.currency} `}{b.total.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</strong>) : <span>{capability.supported ? '尚未查询' : '暂不支持查询'}</span>}{data?.low && <Badge color="amber">偏低</Badge>}</div>{data?.checkedAt && <small>{data.error ? '上次成功：' : '更新于 '}{new Date(data.checkedAt).toLocaleTimeString('zh-CN', { hour12: false })}</small>}</div>
            <div className="row-actions channel-actions"><Toggle checked={p.enabled} label={`启用 ${p.name}`} onChange={enabled => execute('provider.save', { ...p, enabled }, enabled ? '渠道已启用，下次调用生效' : '渠道已停用，下次调用生效')} disabled={busy} /><Button kind="secondary" icon={Layers3} disabled={busy || !p.hasKey} onClick={() => setModal({ type: 'discover', data: p })}>添加模型</Button><button className="text-button" aria-label={`编辑渠道 ${p.name}`} disabled={busy} onClick={() => setModal({ type: 'provider', data: p })}><Pencil size={14} />编辑</button><button className="icon-button quiet-delete" aria-label={`删除渠道 ${p.name}`} title={`删除渠道 ${p.name}`} disabled={busy} onClick={() => setModal({ type: 'delete-provider', data: p })}><Trash2 size={15} /></button></div>
          </div>
          {alert && p.enabled && <div className="channel-notice"><span>{alert.message}</span><button className="text-button" disabled={busy} onClick={() => execute('gateway.retry', undefined, '临时等待已清除，下次请求会重新尝试')}>已处理，重新尝试</button></div>}
          <details className="channel-details"><summary>渠道详情与余额 <span>{data?.refreshing ? '正在查询…' : data?.error ? '查询异常' : p.balanceMonitor ? '余额自动查询已开启' : ''}</span></summary><div className="channel-details-body"><div><span className="detail-label">服务地址</span><code>{p.baseUrl}</code><p className="form-note">{getProviderPreset(p.preset).detail}</p></div><div><div className="balance-detail-heading"><span className="detail-label">平台余额</span>{capability.supported && <button className="text-button" disabled={busy || data?.refreshing || !p.enabled || !p.hasKey} onClick={() => execute('provider.balance', { id: p.id })}><RefreshCw size={13} className={data?.refreshing ? 'spinning' : ''} />{data?.refreshing ? '查询中…' : '刷新余额'}</button>}</div>{data?.balances.length ? data.balances.map(b => <p key={b.currency}>{b.currency} · 现金 {b.cash?.toLocaleString('zh-CN') ?? '—'} · 赠额 / 代金券 {b.granted?.toLocaleString('zh-CN') ?? '—'}</p>) : <p>{capability.supported ? '查询后显示平台返回的余额。' : capability.reason}</p>}{data?.error && <p className="error-text">{data.error}{data.checkedAt ? ' 当前显示上次成功查询的余额。' : ''}</p>}<p className="form-note">{data?.checkedAt ? `上次成功查询：${new Date(data.checkedAt).toLocaleString('zh-CN', { hour12: false })}。` : ''}{capability.supported ? p.balanceMonitor ? '每 5 分钟自动查询。' : '可在编辑中开启自动查询。' : '模型调用照常支持。'}</p></div></div></details>
        </article>;
      })}{!filtered.length && <Empty icon={Search} title="没有找到匹配的渠道" text="试试其他名称，或清除筛选条件。"><Button kind="secondary" onClick={reset}>清除筛选</Button></Empty>}</div>
      <p className="directory-footnote">余额来自各平台账户。密钥已保存不代表模型已开通，实际调用权限以平台返回为准。</p>
    </> : <section className="card"><Empty icon={Network} title="添加你的第一个模型渠道" text="选择平台，填写访问密钥，保存后即可选择模型。"><ProviderCatalog onSelect={preset => setModal({ type: 'provider', data: { preset } as Provider })} /></Empty></section>}
  </>;
}
