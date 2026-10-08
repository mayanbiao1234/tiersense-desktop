import { useEffect, useRef, useState } from 'react';
import { Check, CircleHelp, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { invoke } from './api';
import type { API, Model, Provider, State } from './types';
import { Badge, Button, Field, Modal } from './ui';

type Choice = { tier: string; tools: boolean; vision: boolean };
export function ModelPicker({ state, busy, act, setModal, notify, provider }: API & { provider?: Provider }) {
  const [providerId, setProviderId] = useState(provider?.id ?? state.providers.find(p => p.hasKey)?.id ?? '');
  const [models, setModels] = useState<{ id: string }[]>([]);
  const [selection, setSelection] = useState<Record<string, Choice>>({});
  const [search, setSearch] = useState(''); const [tier, setTier] = useState(state.routing.tiers.at(-1)!.id);
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const generation = useRef(0);
  const picked = Object.keys(selection);
  const matches = models.filter(m => m.id.toLowerCase().includes(search.trim().toLowerCase()));
  const visible = matches.slice(0, 200);
  async function load() {
    const current = ++generation.current;
    setLoading(true); setError(''); setModels([]);
    try { const result = await invoke<{ models: { id: string }[] }>('provider.models', { id: providerId }); if (current === generation.current) setModels(result.models); }
    catch (e) { if (current === generation.current) setError((e as Error).message); }
    finally { if (current === generation.current) setLoading(false); }
  }
  useEffect(() => { setSelection({}); setSearch(''); if (providerId) void load(); return () => { generation.current++; }; }, [providerId]);
  const choose = (id: string) => setSelection(previous => {
    const next = { ...previous }; if (next[id]) delete next[id]; else if (Object.keys(next).length < 200) next[id] = { tier, tools: false, vision: false }; return next;
  });
  const update = (id: string, change: Partial<Choice>) => setSelection(previous => ({ ...previous, [id]: { ...previous[id], ...change } }));
  async function save() {
    try {
      const result = await act('model.import', { providerId, models: picked.map(id => ({ model: id, name: id, ...selection[id], priority: 1 })) }) as State & { imported: number };
      notify(`已加入 ${result.imported} 个模型，已有的同档模型自动跳过`); setModal(null);
    } catch { /* act renders the error; keep the selection so the user can retry. */ }
  }
  return <Modal wide title="选择要使用的模型" subtitle="勾选你购买的模型。可以先选少量，之后随时添加。" onClose={() => { if (!busy) setModal(null); }}>
    <div className="modal-body model-picker">
      <div className="picker-channel"><Field label="模型渠道"><select value={providerId} disabled={busy || !!picked.length} onChange={e => setProviderId(e.target.value)}>{state.providers.filter(p => p.hasKey).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Button kind="secondary" icon={RefreshCw} disabled={loading || busy || !providerId} onClick={() => void load()}>刷新列表</Button></div>
      <div className="picker-explainer"><CircleHelp size={16} /><p><strong>“用工具”</strong>表示支持搜索、读文件等操作，<strong>“看图片”</strong>表示支持图片任务。请按平台说明勾选，不确定时先留空。</p></div>
      {loading ? <div className="picker-status" role="status"><LoaderCircle className="spin" size={22} />正在获取模型名称…</div> : error ? <div className="info-strip error-text" role="alert"><CircleHelp size={18} /><span>{error}。渠道已保存，不影响手动添加。</span></div> : <>
        <div className="picker-toolbar"><label className="picker-search"><Search size={16} /><input aria-label="搜索渠道模型" placeholder="搜索模型名称，例如 glm、qwen" value={search} onChange={e => setSearch(e.target.value)} /></label><Badge>{models.length} 个模型</Badge></div>
        <div className="picker-bulk"><Field label="先统一放到哪一档"><select value={tier} disabled={busy} onChange={e => { setTier(e.target.value); setSelection(previous => Object.fromEntries(Object.entries(previous).map(([id, value]) => [id, { ...value, tier: e.target.value }]))); }}>{state.routing.tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field><Button kind="ghost" disabled={busy || !visible.length} onClick={() => setSelection(previous => { const next = { ...previous }; for (const m of visible) { if (Object.keys(next).length >= 200) break; next[m.id] ??= { tier, tools: false, vision: false }; } return next; })}>全选当前结果</Button><Button kind="ghost" disabled={busy || !picked.length} onClick={() => setSelection({})}>清空选择</Button></div>
        <p className="form-note">不确定时可先放在最高档，下一步再按用途调整。这是你的分组，不是模型评级。</p>
        {picked.length > 0 && <label className="picker-tools-all"><input type="checkbox" checked={picked.every(id => selection[id].tools)} disabled={busy} onChange={e => setSelection(previous => Object.fromEntries(Object.entries(previous).map(([id, value]) => [id, { ...value, tools: e.target.checked }])))} />我确认所选模型都支持使用工具</label>}
        <div className="picker-list"><div className="picker-list-head"><span>模型名称</span><span>档次</span><span>用工具</span><span>看图片</span></div>{visible.map(m => {
          const choice = selection[m.id]; const existing = state.models.some(saved => saved.providerId === providerId && saved.model === m.id && saved.tier === (choice?.tier ?? tier));
          return <div className={`picker-model ${choice ? 'selected' : ''}`} key={m.id}><label><input type="checkbox" aria-label={`选择模型 ${m.id}`} checked={!!choice} disabled={busy || !choice && picked.length >= 200} onChange={() => choose(m.id)} /><span><code>{m.id}</code>{existing && <small>此档已添加，提交时跳过</small>}</span></label><select aria-label={`${m.id} 档次`} disabled={!choice || busy} value={choice?.tier ?? tier} onChange={e => update(m.id, { tier: e.target.value })}>{state.routing.tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><input type="checkbox" aria-label={`${m.id} 支持工具`} disabled={!choice || busy} checked={choice?.tools ?? false} onChange={e => update(m.id, { tools: e.target.checked })} /><input type="checkbox" aria-label={`${m.id} 支持图片`} disabled={!choice || busy} checked={choice?.vision ?? false} onChange={e => update(m.id, { vision: e.target.checked })} /></div>;
        })}{!visible.length && <p className="picker-status">{models.length ? '没有匹配的模型，请换个关键词。' : '渠道返回的模型列表为空，可尝试手动添加。'}</p>}</div>
        {matches.length > 200 && <p className="form-note">当前显示前 200 个结果，请用搜索缩小范围。</p>}
      </>}
      <div className="form-actions"><Button kind="ghost" disabled={busy} onClick={() => setModal({ type: 'model', data: { providerId, tier } as Model })}>手动填写模型</Button><span className="picker-count">已选 {picked.length} 个</span><Button icon={Check} disabled={busy || !picked.length} onClick={() => void save()}>添加所选模型</Button></div>
    </div>
  </Modal>;
}
