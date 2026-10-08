import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowRight, Check, CircleHelp, Sparkles, Layers3, Plus, Trash2 } from 'lucide-react';
import { FEATURES, readiness } from '../core/policy.mjs';
import type { API, Dimension, Routing, RoutingRule, State } from './types';
import { Badge, Button, Field, Modal, SectionHead, Toggle } from './ui';

const TASK_LABELS = { domain1: '编程与代码修复', domain2: '使用工具', domain3: '多步推理', domain4: '拆解任务', domain5: '规划任务' };

export function RoutingEditor({ state, busy, act, setModal, embedded = false, onSaved }: API & { embedded?: boolean; onSaved?: () => void }) {
  const [routing, setRouting] = useState<Routing>(() => structuredClone(state.routing));
  const [options, setOptions] = useState({ allowEscalation: state.settings.allowEscalation, failureMode: state.settings.failureMode, fallbackModelId: state.settings.fallbackModelId });
  const [assignments, setAssignments] = useState<Record<string, { tier: string; priority: number }>>(() => Object.fromEntries(state.models.map(m => [m.id, { tier: m.tier, priority: m.priority }])));
  const [reassignments, setReassignments] = useState<Record<string, string>>({});
  const [activeTier, setActiveTier] = useState(state.routing.tiers.at(-1)!.id);
  const [removeId, setRemoveId] = useState(''); const [targetId, setTargetId] = useState('');
  const [error, setError] = useState('');
  const [baseline, setBaseline] = useState(() => JSON.stringify({ routing: state.routing, options, assignments }));
  const dirty = JSON.stringify({ routing, options, assignments }) !== baseline;
  useEffect(() => { document.documentElement.dataset.routingDirty = String(dirty); return () => { delete document.documentElement.dataset.routingDirty; }; }, [dirty]);
  useEffect(() => { setAssignments(previous => Object.fromEntries(state.models.map(m => [m.id, previous[m.id] ?? { tier: m.tier, priority: m.priority }]))); }, [state.models]);
  const modelTier = (id: string) => assignments[id]?.tier ?? state.models.find(m => m.id === id)?.tier;
  const pool = state.models.filter(m => modelTier(m.id) === activeTier);
  const rules = routing.rules.filter(r => r.tierId === activeTier);
  const ruleChange = (id: string, values: Partial<RoutingRule>) => setRouting(r => ({ ...r, rules: r.rules.map(rule => rule.id === id ? { ...rule, ...values } : rule) }));
  function assign(id: string, tier: string) {
    setAssignments(previous => ({ ...previous, [id]: { ...previous[id], tier } }));
    setRouting(previous => ({ ...previous, rules: previous.rules.map(r => {
      const modelIds = r.tierId === tier ? r.modelIds : r.modelIds.filter(m => m !== id);
      return { ...r, modelIds, enabled: r.enabled && !!modelIds.length };
    }) }));
  }
  function move(index: number, delta: number) {
    setRouting(r => { const all = [...r.rules]; const a = all.findIndex(x => x.id === rules[index].id); const b = all.findIndex(x => x.id === rules[index + delta].id); [all[a], all[b]] = [all[b], all[a]]; return { ...r, rules: all }; });
  }
  function remove() {
    setRouting({ tiers: routing.tiers.filter(t => t.id !== removeId).map((t, i) => i === 0 ? { ...t, minScore: 0 } : t), rules: routing.rules.map(r => r.tierId === removeId ? { ...r, tierId: targetId } : r) });
    setAssignments(previous => Object.fromEntries(Object.entries(previous).map(([id, value]) => [id, value.tier === removeId ? { ...value, tier: targetId } : value])));
    setReassignments(previous => ({ ...Object.fromEntries(Object.entries(previous).map(([id, target]) => [id, target === removeId ? targetId : target])), [removeId]: targetId }));
    if (activeTier === removeId) setActiveTier(targetId); setRemoveId(''); setTargetId('');
  }
  async function save(continueSetup = false) {
    setError('');
    try {
      const result = await act('routing.save', { routing, settings: options, reassignments, modelAssignments: assignments }, '分档与模型分工已保存') as State;
      setBaseline(JSON.stringify({ routing, options, assignments })); setReassignments({}); delete document.documentElement.dataset.routingDirty;
      if (continueSetup) {
        const checks = readiness(result);
        if (!checks.models) setError(`配置已保存，请补充可用模型后继续。尚未覆盖：${checks.uncovered.join('、') || '至少一个模型'}。`);
        else onSaved?.();
      }
    } catch (e) { setError((e as Error).message); }
  }
  return <div className="strategy-editor division-editor">
    <SectionHead title={embedded ? '安排你的模型' : 'TierSense 智能路由'} text="先按任务难度选择档次，再在同档里选择擅长这类任务的模型。" />
    <div className="routing-example"><Sparkles size={18} /><p>例如：GLM 和 Qwen 都放在旗舰档，复杂编程优先用 GLM，复杂规划优先用 Qwen。</p></div>
    <details className="disclosure card tier-customization"><summary>调整档次数量和分界 <small>可选 · 当前 {routing.tiers.length} 档</small></summary><div className="disclosure-body">    <div className="simple-tier-summary">{routing.tiers.map((t, i) => <div key={t.id}><span>{i + 1}</span><strong>{t.name}</strong><small>{routing.tiers.length === 1 ? '处理全部难度' : i === 0 ? '较简单的任务' : i === routing.tiers.length - 1 ? '更复杂的任务' : '中等难度的任务'}</small></div>)}</div>
    <section className="division-section tier-fields"><div className="card-heading no-pad"><div><h3>设置档次 <Badge>{routing.tiers.length} 个</Badge></h3><p>可增加、改名或删除，支持 1–20 档。一个档次可以放多个模型。</p></div><Button kind="secondary" icon={Plus} disabled={routing.tiers.length >= 20 || routing.tiers.at(-1)!.minScore >= 10} onClick={() => { const last = routing.tiers.at(-1)!; let n = routing.tiers.length + 1; while (routing.tiers.some(t => t.name === `档次 ${n}`)) n++; setRouting({ ...routing, tiers: [...routing.tiers, { id: crypto.randomUUID(), name: `档次 ${n}`, minScore: (last.minScore + 10) / 2 }] }); }}>增加一档</Button></div>
      <div className="tier-scale">{routing.tiers.map((t, i) => <div key={t.id} style={{ flex: Math.max(0.1, (routing.tiers[i + 1]?.minScore ?? 10) - t.minScore) }}>{t.name}</div>)}</div>
      <div className="tier-edit-head"><span>顺序 / 名称</span><span>综合分下限</span><span /></div>
      {routing.tiers.map((tier, i) => <div className="tier-edit-row" key={tier.id}><span className="tier-order">{String(i + 1).padStart(2, '0')}</span><input aria-label={`第 ${i + 1} 档名称`} maxLength={120} value={tier.name} onChange={e => setRouting({ ...routing, tiers: routing.tiers.map(t => t.id === tier.id ? { ...t, name: e.target.value } : t) })} /><input aria-label={`第 ${i + 1} 档综合分下限`} type="number" min="0" max="10" step="any" disabled={i === 0} value={tier.minScore} onChange={e => setRouting({ ...routing, tiers: routing.tiers.map(t => t.id === tier.id ? { ...t, minScore: Number(e.target.value) } : t) })} /><button className="icon-button danger-text" disabled={routing.tiers.length === 1} aria-label={`删除档次 ${tier.name}`} onClick={() => { setRemoveId(tier.id); setTargetId(''); }}><Trash2 size={16} /></button></div>)}
      <p className="form-note">第一档从 0 开始，达到下一档分界就进入下一档，最后一档包含 10 分。五维规则不会让请求直接跳档。</p>
    </section></div></details>
    <section className="card padded division-section"><div className="card-heading no-pad"><div><h3>1. 为模型选择档次</h3><p>把你认为适合简单任务的模型放在较低档，处理复杂任务的放在较高档。</p></div><Button kind="secondary" icon={Plus} disabled={dirty || busy || !state.providers.length} onClick={() => setModal({ type: 'discover' })}>添加模型</Button></div>
      {dirty && <p className="form-note">需要增加模型时，先保存当前配置，再从渠道选择。</p>}
      {!state.models.length ? <p className="rules-empty">还没有模型。从渠道列表勾选，或返回第一步添加渠道。</p> : <div className="assignment-list simple-assignment"><div className="assignment-head"><span>模型 / 渠道</span><span>用于哪一档</span></div>{state.models.map(m => <div className="assignment-row" key={m.id}><div><strong>{m.name}</strong><small>{state.providers.find(p => p.id === m.providerId)?.name}{!m.enabled ? ' · 已停用' : ''}</small></div><select aria-label={`${m.name} 分配档次`} value={modelTier(m.id)} onChange={e => assign(m.id, e.target.value)}>{routing.tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>)}</div>}
      {!!state.models.length && <details className="disclosure"><summary>调整同档默认顺序 <small>没有匹配分工时使用</small></summary><div className="disclosure-body"><p className="form-note">数字越小越优先。同样数字时，按添加顺序选择。</p>{state.models.map(m => <Field key={m.id} label={m.name}><input aria-label={`${m.name} 默认顺序`} type="number" min={1} max={100} value={assignments[m.id]?.priority ?? m.priority} onChange={e => setAssignments(previous => ({ ...previous, [m.id]: { tier: modelTier(m.id)!, priority: Number(e.target.value) } }))} /></Field>)}</div></details>}
      <p className="form-note">移动模型后，原档次中与它有关的分工会移除。</p>
    </section>
    <section className="card padded division-section"><div className="card-heading no-pad"><div><h3>2. 指定模型分工 <Badge>可选</Badge></h3><p>同一档有多个模型时，可以指定谁更擅长哪类任务。多个分工都符合时，优先使用排在上面的。</p></div></div>
      {routing.rules.some(r => !r.modelIds.length) && <div className="info-strip"><CircleHelp size={17} /><span>部分规则尚未指定模型，当前停用。旧版仅选择模型池的规则保留了条件，请补选具体模型后启用。</span></div>}
      <div className="division-tabs" role="tablist" aria-label="选择分工档次">{routing.tiers.map(t => <button role="tab" aria-selected={activeTier === t.id} className={activeTier === t.id ? 'active' : ''} key={t.id} onClick={() => setActiveTier(t.id)}>{t.name}<span>{state.models.filter(m => modelTier(m.id) === t.id).length} 个模型</span></button>)}</div>
      <div className="division-pool-heading"><div><strong>{routing.tiers.find(t => t.id === activeTier)?.name}档的模型分工</strong><p>{pool.length > 1 ? '同样的综合难度，可以根据当前步骤交给不同模型。' : pool.length ? '当前只有一个模型；加入更多模型后，可发挥不同模型的专长。' : '先把模型放入此档，再设置分工。'}</p></div><Button icon={Plus} kind="secondary" disabled={!pool.length || routing.rules.length >= 100} onClick={() => setRouting({ ...routing, rules: [...routing.rules, { id: crypto.randomUUID(), name: '代码修复分工', tierId: activeTier, modelIds: [pool[0].id], dimension: 'domain1', operator: 'gte', threshold: 1.5, enabled: true }] })}>添加分工</Button></div>
      {!rules.length && <div className="rules-empty"><Layers3 size={22} /><div><strong>可以先按默认顺序使用</strong><p>不设置分工也可以使用。添加分工后，例如编程较难时优先 GLM，规划较难时优先 Qwen。</p></div></div>}
      {rules.map((rule, index) => <div className={`rule-editor ${!rule.enabled ? 'muted-card' : ''}`} key={rule.id}><div className="rule-editor-head"><span className="rule-priority">{index + 1}</span><input aria-label={`分工 ${index + 1} 名称`} value={rule.name} maxLength={120} onChange={e => ruleChange(rule.id, { name: e.target.value })} /><Toggle checked={rule.enabled} disabled={!rule.modelIds.length} label={`启用分工 ${index + 1}`} onChange={enabled => ruleChange(rule.id, { enabled })} /><button className="icon-button" disabled={index === 0} aria-label={`上移分工 ${index + 1}`} onClick={() => move(index, -1)}><ArrowUp size={15} /></button><button className="icon-button" disabled={index === rules.length - 1} aria-label={`下移分工 ${index + 1}`} onClick={() => move(index, 1)}><ArrowDown size={15} /></button><button className="icon-button danger-text" aria-label={`删除分工 ${index + 1}`} onClick={() => setRouting({ ...routing, rules: routing.rules.filter(r => r.id !== rule.id) })}><Trash2 size={15} /></button></div><div className="rule-condition simple-rule-condition">
        <Field label="任务类型"><select aria-label={`分工 ${index + 1} 维度`} value={rule.dimension} onChange={e => ruleChange(rule.id, { dimension: e.target.value as Dimension, name: `${FEATURES[e.target.value as Dimension]}分工` })}>{Object.entries(TASK_LABELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
        <Field label="任务难度"><select aria-label={`分工 ${index + 1} 难度`} value={rule.operator === 'gte' && [1, 1.5, 2].includes(rule.threshold) ? String(rule.threshold) : 'custom'} onChange={e => { if (e.target.value !== 'custom') ruleChange(rule.id, { operator: 'gte', threshold: Number(e.target.value) }); }}><option value="1">中等及以上</option><option value="1.5">较难时</option><option value="2">最高难度时</option><option value="custom" disabled>自定义：{rule.operator === 'gte' ? '≥' : '<'} {rule.threshold} 分</option></select></Field>
        <Field label="优先使用"><select aria-label={`分工 ${index + 1} 首选模型`} value={rule.modelIds[0] ?? ''} onChange={e => ruleChange(rule.id, { modelIds: e.target.value ? [e.target.value] : [], enabled: !!e.target.value && rule.enabled })}><option value="">选择本档模型</option>{pool.map(m => <option key={m.id} value={m.id}>{m.name} · {state.providers.find(p => p.id === m.providerId)?.name}{!m.enabled ? '（已停用）' : ''}</option>)}</select></Field>
      </div><details className="disclosure rule-precision"><summary>精确设置难度条件</summary><div className="disclosure-body form-grid">        <Field label="满足条件"><select aria-label={`分工 ${index + 1} 条件`} value={rule.operator} onChange={e => ruleChange(rule.id, { operator: e.target.value as 'gte' | 'lt' })}><option value="gte">≥ 大于等于</option><option value="lt">&lt; 小于</option></select></Field>
        <Field label="难度阈值（0–2）"><input aria-label={`分工 ${index + 1} 阈值`} type="number" min="0" max="2" step="0.1" value={rule.threshold} onChange={e => ruleChange(rule.id, { threshold: Number(e.target.value) })} /></Field>
<p className="form-note">单项难度为 0–2 分。“较难时”表示达到 1.5 分；修改只影响本档内选模。</p></div></details></div>)}
      <div className="rule-fallback"><ArrowDown size={15} /><span>没有符合的分工时，按同档默认顺序选模型。</span></div>

    </section>
    <details className="card padded division-section advanced-routing"><summary>高级：模型不可用时怎么处理</summary><div className="setting-row"><div><strong>允许向更高档查找</strong><p>本档模型都不满足能力要求或可重试的调用失败后，才按顺序升级；在更高档内也按其分工选模。</p></div><Toggle label="允许升级档次" checked={options.allowEscalation} onChange={allowEscalation => setOptions({ ...options, allowEscalation })} /></div><Field label="TierSense 评分失败时"><select value={options.failureMode} onChange={e => setOptions({ ...options, failureMode: e.target.value as 'block' | 'fallback' })}><option value="block">停止本次调用（默认）</option><option value="fallback">改用指定备用模型</option></select></Field>{options.failureMode === 'fallback' && <Field label="备用模型"><select value={options.fallbackModelId} onChange={e => setOptions({ ...options, fallbackModelId: e.target.value })}><option value="">选择模型</option>{state.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>}<p className="form-note">最多尝试 3 个候选。开始输出后不换模型；鉴权失败直接返回错误。关闭升级时只使用综合难度选中的档次。</p></details>
    {error && <div className="info-strip error-text" role="alert"><CircleHelp size={17} /><span>{error}</span></div>}
    <div className="strategy-save"><span>{dirty ? '有尚未保存的修改' : '当前分档与分工已保存'}</span><div className="button-row"><Button kind={embedded ? 'secondary' : 'primary'} icon={Check} disabled={busy || !dirty} onClick={() => void save()}>保存配置</Button>{embedded && <Button icon={ArrowRight} disabled={busy} onClick={() => void save(true)}>保存并继续</Button>}</div></div>
    {removeId && <Modal title="删除档次并迁移配置" subtitle="模型与分工一起迁移，保存配置后生效。" onClose={() => setRemoveId('')}><div className="modal-body"><Field label="将本档模型和分工迁往"><select value={targetId} onChange={e => setTargetId(e.target.value)}><option value="">选择目标档次</option>{routing.tiers.filter(t => t.id !== removeId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field><div className="form-actions"><Button kind="secondary" onClick={() => setRemoveId('')}>取消</Button><Button kind="danger" disabled={!targetId} onClick={remove}>迁移并移除</Button></div></div></Modal>}
  </div>;
}
