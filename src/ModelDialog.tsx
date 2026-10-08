import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Model, Pricing, State } from './types';
import { Button, Field, Modal, Toggle } from './ui';

export function ModelDialog({ data, state, busy, onClose, onSave, onDelete }: { data?: Model; state: State; busy: boolean; onClose: () => void; onSave: (input: unknown) => Promise<void>; onDelete: () => void }) {
  const [form, setForm] = useState({ id: data?.id, name: data?.name ?? '', model: data?.model ?? '', providerId: data?.providerId ?? state.providers[0]?.id ?? '', tier: data?.tier ?? state.routing.tiers[0].id, tools: data?.tools ?? true, vision: data?.vision ?? false, priority: data?.priority ?? 1, enabled: data?.enabled ?? true });
  const [pricing, setPricing] = useState<Pricing>(data?.pricing ?? { currency: 'CNY', input: null, output: null, cacheRead: null });
  return <Modal wide title={data?.id ? '编辑模型' : '手动添加模型'} subtitle="为模型选择档次。其他选项可稍后调整。" onClose={onClose}>
    <form className="modal-body" onSubmit={e => { e.preventDefault(); void onSave({ ...form, pricing }).catch(() => {}); }}>
      <Field label="所属渠道"><select value={form.providerId} required onChange={e => setForm({ ...form, providerId: e.target.value })}>{state.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="显示名称"><input autoFocus required value={form.name} placeholder="例如：DeepSeek 日常" onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="用于哪一档"><select value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })}>{state.routing.tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
      <details className="disclosure" open={!data?.id ? true : undefined}><summary>模型能力与标识</summary><div className="disclosure-body">
      <Field label="平台上的模型名称（Model ID）" hint="需要与平台提供的名称完全一致。"><input required value={form.model} placeholder="例如：deepseek-chat" onChange={e => setForm({ ...form, model: e.target.value })} /></Field>
      <div className="setting-row"><div><strong>支持使用工具</strong><p>可让 AI 软件执行搜索、读文件等操作。请按模型实际能力选择。</p></div><Toggle checked={form.tools} onChange={tools => setForm({ ...form, tools })} label="支持使用工具" /></div>
      <div className="setting-row"><div><strong>支持看图</strong><p>允许把带有图片的任务交给这个模型。</p></div><Toggle checked={form.vision} onChange={vision => setForm({ ...form, vision })} label="支持看图" /></div>
      <Field label="同档默认顺序" hint="没有符合的分工时，数字越小越先使用。"><input type="number" min={1} max={100} required value={form.priority} onChange={e => setForm({ ...form, priority: Number(e.target.value) })} /></Field>
      </div></details>
      <details className="disclosure"><summary>设置单价，用于估算费用 <small>可选</small></summary><div className="disclosure-body"><section className="price-editor"><div className="card-heading"><div><h3>模型单价</h3><p>从平台价格页填写，每百万 Token 的价格。Token 是用量计费单位。</p></div><select aria-label="计价币种" value={pricing.currency} onChange={e => setPricing({ ...pricing, currency: e.target.value as Pricing['currency'] })}><option value="CNY">人民币 CNY</option><option value="USD">美元 USD</option></select></div>
        <div className="price-fields">{([{ key: 'input', label: '普通输入单价' }, { key: 'output', label: '输出单价' }, { key: 'cacheRead', label: '缓存命中输入单价' }] as const).map(item => <Field key={item.key} label={item.label}><input type="number" aria-label={item.label} min={0} max={1000000} step="any" placeholder={item.key === 'cacheRead' ? '留空按普通输入单价' : '未知请留空'} value={pricing[item.key] ?? ''} onChange={e => setPricing({ ...pricing, [item.key]: e.target.value === '' ? null : Number(e.target.value) })} /></Field>)}</div>
        <p className="form-note">费用为本地估算，未设置完整单价或未返回完整用量时显示“未知”。不包含 TierSense、工具额外费用、阶梯价格或套餐折扣；最终以渠道账单为准。缓存用量未知时按普通输入单价估算。</p>
      </section></div></details>
      <div className="form-actions">{data?.id && <Button kind="danger" icon={Trash2} disabled={busy} onClick={onDelete}>删除模型</Button>}<Button kind="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={busy}>保存模型</Button></div>
    </form>
  </Modal>;
}
