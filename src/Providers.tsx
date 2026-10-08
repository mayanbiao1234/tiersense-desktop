import { useState, type FormEvent } from 'react';
import { Check, Eye, EyeOff, LoaderCircle, Network, Plus } from 'lucide-react';
import { getProviderPreset, PROVIDER_PRESETS, providerOriginChanged, type ProviderPresetId } from '../core/providers.mjs';
import type { Provider } from './types';
import { Button, Field, Modal, Toggle } from './ui';
import { balanceCapability } from '../core/balances.mjs';
import './providers.css';

export function ProviderMark({ preset }: { preset: string }) {
  const item = getProviderPreset(preset);
  return <span className="provider-mark vendor-logo" data-provider={item.id} aria-hidden="true">{item.logo ? <img src={`/providers/${item.logo}`} alt="" /> : <Network size={22} />}</span>;
}

export function ProviderCatalog({ selected, disabled, onSelect }: { selected?: ProviderPresetId; disabled?: boolean; onSelect: (id: ProviderPresetId) => void }) {
  return <div className="provider-catalog" role="group" aria-label="选择模型渠道厂商">{PROVIDER_PRESETS.map(item =>
    <button type="button" key={item.id} disabled={disabled} data-provider={item.id} aria-label={item.name} aria-pressed={selected === undefined ? undefined : selected === item.id} className={selected === item.id ? 'selected' : ''} onClick={() => onSelect(item.id)}>
      <ProviderMark preset={item.id} /><span className="vendor-label"><strong>{item.name}</strong><small>{item.detail}</small></span>
      {selected === item.id ? <Check className="vendor-choice" size={14} /> : selected === undefined ? <Plus className="vendor-choice" size={14} /> : null}
    </button>
  )}</div>;
}

export function ProviderDialog({ data, busy, onClose, onSave }: { data?: Provider; busy: boolean; onClose: () => void; onSave: (input: unknown) => Promise<void> }) {
  const initial = getProviderPreset(data?.preset ?? PROVIDER_PRESETS[0].id);
  const [preset, setPreset] = useState(initial.id);
  const [name, setName] = useState(data?.name ?? (initial.id === 'custom' ? '' : initial.name));
  const [url, setUrl] = useState(data?.baseUrl ?? initial.baseUrl);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [balanceMonitor, setBalanceMonitor] = useState(data?.balanceMonitor ?? false);
  const [balanceThreshold, setBalanceThreshold] = useState(data?.balanceThreshold ?? 10);
  const [requestUsage, setRequestUsage] = useState(data?.requestUsage ?? false);
  const capability = balanceCapability({ preset, baseUrl: url });
  const current = getProviderPreset(preset);
  const changedOrigin = providerOriginChanged(data?.baseUrl, url);
  const retainKey = data?.hasKey && !changedOrigin;
  function choose(id: ProviderPresetId) {
    if (id === preset) return;
    const item = getProviderPreset(id);
    setPreset(id); setName(id === 'custom' ? '' : item.name); setUrl(item.baseUrl); setKey(''); setShowKey(false);
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave({ ...data, name, baseUrl: url, apiKey: key, preset, enabled: data?.enabled ?? true, balanceMonitor: capability.supported && balanceMonitor, balanceThreshold, requestUsage }).catch(() => {});
  };
  return <Modal wide title={data?.id ? '编辑模型渠道' : '添加模型渠道'} subtitle="选择你购买服务的平台，粘贴它提供的访问密钥。" onClose={onClose}>
    <form className="modal-body provider-form" onSubmit={submit}>
      <div className="provider-step-label"><span>01</span>选择渠道<small>已预填官方 API 地址</small></div>
      <ProviderCatalog selected={preset} disabled={busy} onSelect={choose} />
      <div className="provider-step-label"><span>02</span>粘贴访问密钥<small>从该平台的 API 管理页获取，不是登录密码</small></div>
      <Field label="访问密钥（API Key）" hint={retainKey ? '已保存；不修改时留空即可。' : data?.hasKey && changedOrigin ? '服务地址已变更，请填写新地址对应的密钥。' : '保存后会自动列出模型，你只需勾选想用的。'}>
        <span className="input-with-button"><input aria-label="API Key" type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false} required={!retainKey} disabled={busy} placeholder={retainKey ? '••••••••••••••••（已保存）' : '粘贴你的 API Key'} value={key} onChange={e => setKey(e.target.value)} /><button type="button" aria-label={showKey ? '隐藏密钥' : '显示密钥'} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></span>
      </Field>
      <p className="provider-address-hint">{current.hint}</p>
      <details key={preset} className="disclosure" open={preset === 'custom' ? true : undefined}><summary>连接设置：名称与服务地址</summary><div className="disclosure-body">
      <Field label="渠道名称"><input aria-label="渠道名称" required maxLength={120} disabled={busy} placeholder="例如：我的 TierFlow" value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="服务地址（Base URL）" hint="常规账户可使用预填地址；专用套餐或其他地区请按平台说明修改。"><input aria-label="Base URL" required type="url" disabled={busy} placeholder="https://api.example.com/v1" value={url} onChange={e => setUrl(e.target.value)} /></Field>
      </div></details>
      <details className="disclosure"><summary>可选：余额提醒与用量统计</summary><div className="disclosure-body">
      <div className="setting-row"><div><strong>自动监控渠道余额</strong><p>{capability.supported ? '开启后立即查询，应用运行时每 5 分钟刷新一次。' : capability.reason}</p></div><Toggle label="自动监控渠道余额" checked={capability.supported && balanceMonitor} disabled={busy || !capability.supported} onChange={setBalanceMonitor} /></div>
      {capability.supported && <Field label="低余额提醒值" hint="低于此值时在渠道卡片提示，单位为渠道原币。不会自动停用模型。"><input type="number" min={0} max={1000000} step="any" required value={balanceThreshold} onChange={e => setBalanceThreshold(Number(e.target.value))} /></Field>}
      <div className="setting-row"><div><strong>补充逐字回复的用量统计</strong><p>部分平台需要开启此项才返回 Token 用量。如开启后无法调用，请关闭。</p></div><Toggle label="补充逐字回复的用量统计" checked={requestUsage} onChange={setRequestUsage} disabled={busy} /></div>
      </div></details>
      <div className="form-actions"><Button kind="secondary" onClick={onClose}>取消</Button><Button type="submit" icon={busy ? LoaderCircle : Check} disabled={busy}>{data?.id ? '保存修改' : '保存并选择模型'}</Button></div>
    </form>
  </Modal>;
}
