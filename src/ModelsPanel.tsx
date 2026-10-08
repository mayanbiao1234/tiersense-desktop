import { Layers3, Network, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { API, Model } from './types';
import { FEATURES } from '../core/policy.mjs';
import { Badge, Button, Empty, SectionHead, Toggle } from './ui';
import { ProviderMark } from './Providers';
import { useViewState } from './ui-state';
import { useCurrentAlerts } from './Workspace';

export function ModelsPanel({ state, busy, execute, setModal, setPage, embedded = false, onEditTiers }: API & { embedded?: boolean; onEditTiers?: () => void }) {
  const [query, setQuery] = useViewState('models.query', '');
  const [providerId, setProviderId] = useViewState('models.provider', '');
  const [tierId, setTierId] = useViewState('models.tier', '');
  const [filter, setFilter] = useViewState('models.status', 'all');
  const providerFilter = state.providers.some(p => p.id === providerId) ? providerId : '';
  const tierFilter = state.routing.tiers.some(t => t.id === tierId) ? tierId : '';
  const alerts = useCurrentAlerts(state.modelAlerts);
  const issue = (m: Model) => { const p = state.providers.find(p => p.id === m.providerId); return !p?.hasKey || !p.enabled || alerts.some(a => a.modelId === m.id); };
  const filtered = state.models.filter(m => {
    const p = state.providers.find(p => p.id === m.providerId);
    return `${m.name} ${m.model} ${p?.name}`.toLowerCase().includes(query.trim().toLowerCase()) && (!providerFilter || m.providerId === providerFilter) && (!tierFilter || m.tier === tierFilter)
      && (filter === 'all' || filter === 'on' && m.enabled || filter === 'off' && !m.enabled || filter === 'attention' && m.enabled && issue(m));
  });
  const hasFilter = !!(query || providerFilter || tierFilter || filter !== 'all');
  const reset = () => { setQuery(''); setProviderId(''); setTierId(''); setFilter('all'); };
  return <>
    <SectionHead title={embedded ? '选择要使用的模型' : '我的模型'} text="按难度分档，在同一档内安排模型各自擅长的任务。" action={<div className="button-row"><Button kind="secondary" icon={SlidersHorizontal} onClick={onEditTiers ?? (() => setPage('routing'))}>调整分工</Button><Button icon={Plus} disabled={!state.providers.length} onClick={() => setModal({ type: 'discover' })}>添加模型</Button></div>} />
    {!state.providers.length && <div className="info-strip"><Network size={17} /><span>先连接一个模型渠道，再选择它提供的模型。</span><Button kind="ghost" onClick={() => setModal({ type: 'provider' })}>连接渠道</Button></div>}
    <div className="directory-toolbar"><label className="search"><Search size={16} /><input aria-label="搜索模型" placeholder="搜索模型名称或渠道" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <select aria-label="筛选模型渠道" value={providerFilter} onChange={e => setProviderId(e.target.value)}><option value="">全部渠道</option>{state.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <select aria-label="筛选模型档次" value={tierFilter} onChange={e => setTierId(e.target.value)}><option value="">全部档次</option>{state.routing.tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <select aria-label="筛选模型状态" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部状态</option><option value="on">已启用</option><option value="off">已停用</option><option value="attention">需要处理</option></select>
    </div>
    <div className="directory-summary"><span>{hasFilter ? `找到 ${filtered.length} 个模型` : `共 ${state.models.length} 个模型 · ${state.routing.tiers.length} 个档次`}</span>{hasFilter ? <button className="text-button" onClick={reset}>清除筛选</button> : <span>修改保存后，下次调用生效</span>}</div>
    <div className="model-directory card">{state.routing.tiers.filter(t => !tierFilter || t.id === tierFilter).map(tier => {
      const index = state.routing.tiers.findIndex(t => t.id === tier.id);
      const models = filtered.filter(m => m.tier === tier.id).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
      if (!models.length && hasFilter) return null;
      return <section className="model-group" key={tier.id} aria-label={`${tier.name}档模型`}>
        <div className="model-group-heading"><span className="group-index">{String(index + 1).padStart(2, '0')}</span><h3>{tier.name}</h3><span>{models.length} 个模型</span><button className="text-button" disabled={!state.providers.length || busy} onClick={() => setModal({ type: 'model', data: { tier: tier.id } as Model })}><Plus size={14} />手动添加</button></div>
        {!!models.length && <div className="model-columns" aria-hidden="true"><span>模型 / 渠道</span><span>任务分工与能力</span><span>当前状态</span><span>操作</span></div>}
        {models.map(m => {
          const provider = state.providers.find(p => p.id === m.providerId), alert = alerts.find(a => a.modelId === m.id);
          const specialties = [...new Set(state.routing.rules.filter(r => r.enabled && r.tierId === tier.id && r.modelIds.includes(m.id)).map(r => FEATURES[r.dimension]))];
          const status = !m.enabled ? '已停用' : !provider?.enabled ? '渠道已停用' : !provider.hasKey ? '待填写密钥' : alert ? '暂时跳过' : '已启用';
          const needsAttention = m.enabled && issue(m);
          return <article className={`model-row ${!m.enabled ? 'row-disabled' : ''}`} key={m.id}>
            <div className="model-identity"><ProviderMark preset={provider?.preset ?? 'custom'} /><div><button className="entity-name" title={m.name} onClick={() => setModal({ type: 'model', data: m })}>{m.name}</button>{m.name !== m.model && <code title={m.model}>{m.model}</code>}<span>{provider?.name ?? '渠道不存在'}</span></div></div>
            <div className="model-role"><strong>{specialties.length ? `${specialties.join('、')}优先` : '按同档默认顺序选用'}</strong><div>{m.tools && <span>工具调用</span>}{m.vision && <span>图片理解</span>}{!m.tools && !m.vision && <span>文本对话</span>}</div></div>
            <div className="model-status"><Badge color={needsAttention ? 'amber' : ''}>{status}</Badge>{alert && m.enabled && <p>{alert.message}</p>}</div>
            <div className="row-actions"><Toggle checked={m.enabled} onChange={enabled => execute('model.save', { ...m, enabled }, enabled ? '模型已启用，下次调用生效' : '模型已停用，下次调用生效')} label={`启用 ${m.name}`} disabled={busy} /><button className="text-button" disabled={busy} aria-label={`编辑 ${m.name}`} onClick={() => setModal({ type: 'model', data: m })}><Pencil size={14} />编辑</button><button className="icon-button quiet-delete" disabled={busy} title={`删除 ${m.name}`} aria-label={`删除 ${m.name}`} onClick={() => setModal({ type: 'delete-model', data: m })}><Trash2 size={15} /></button></div>
          </article>;
        })}
        {!models.length && <div className="empty-tier"><Layers3 size={18} /><span>还没有模型。{state.settings.allowEscalation && index < state.routing.tiers.length - 1 ? '这类任务将尝试更高档的模型。' : '添加模型后，才能处理这类任务。'}</span></div>}
      </section>;
    })}{hasFilter && !filtered.length && <Empty icon={Search} title="没有找到匹配的模型" text="试试其他名称，或清除筛选条件。"><Button kind="secondary" onClick={reset}>清除筛选</Button></Empty>}</div>
    <p className="directory-footnote">已启用表示加入候选池；模型权限与实际可用性以平台返回为准。单价可在“编辑”中设置。</p>
  </>;
}
