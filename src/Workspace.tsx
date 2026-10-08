import { useEffect, useState } from 'react';
import { ArrowRight, Check, CircleAlert, Code2, Gauge, Layers3, Network, Play, Settings2, Square } from 'lucide-react';
import type { API, ModelAlert } from './types';
import { Badge, Button, SectionHead, TierSenseLogo } from './ui';
import { readiness } from '../core/policy.mjs';

export function useCurrentAlerts(alerts: ModelAlert[] | undefined) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { setNow(Date.now()); if (!alerts?.length) return; const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); }, [alerts]);
  return (alerts ?? []).filter(alert => alert.retryAt > now);
}

export function Workspace({ state, busy, execute, setPage, setModal, onSetupStep }: API & { onSetupStep?: (step: number) => void }) {
  const checks = readiness(state), ready = checks.providers && checks.models && checks.tiersense;
  const running = state.gateway.running;
  const alerts = useCurrentAlerts(state.modelAlerts);
  const enabledProviders = state.providers.filter(p => p.enabled && p.hasKey);
  const availableModels = state.models.filter(m => m.enabled && enabledProviders.some(p => p.id === m.providerId));
  const low = state.providers.filter(p => p.enabled && state.balances[p.id]?.low);
  const problems: { key: string; title: string; text: string; action: string; go: () => void }[] = [];
  if (!checks.tiersense) problems.push({ key: 'sense', title: 'TierSense 尚未连接', text: '填写用于判断难度的访问密钥后，才能开始选模。', action: '连接 TierSense', go: () => setModal({ type: 'tiersense' }) });
  if (!checks.providers) problems.push({ key: 'providers', title: '没有已启用的模型渠道', text: '添加渠道密钥，或重新启用已有渠道。', action: '管理渠道', go: () => setPage('providers') });
  else if (!checks.models) problems.push({ key: 'models', title: '部分档次缺少可用模型', text: `${checks.uncovered.join('、') || '当前模型池'}需要补充模型，或调整档次与升级设置。`, action: '管理模型', go: () => setPage('models') });
  if (alerts.length) problems.push({ key: 'upstream', title: `${alerts.length} 个模型暂时跳过`, text: alerts[0].message, action: '查看模型', go: () => setPage('models') });
  if (low.length) problems.push({ key: 'balance', title: `${low.length} 个渠道余额偏低`, text: `${low.map(p => p.name).join('、')}的最近一次查询余额低于提醒值。`, action: '查看余额', go: () => setPage('providers') });
  if (state.history.error || state.recoveryError) problems.push({ key: 'storage', title: '本机数据需要检查', text: state.history.error || state.recoveryError || '', action: state.history.error ? '查看使用记录' : '查看设置', go: () => setPage(state.history.error ? 'logs' : 'settings') });
  return <div className="daily-workspace">
    <SectionHead title="智能选模，搭配刚刚好" text="在你习惯的 AI 工具中工作，由 TierSense 为每一步选择模型。" action={<Button kind="secondary" icon={Settings2} onClick={() => onSetupStep ? onSetupStep(0) : setPage('setup')}>修改配置</Button>} />
    <section className="service-panel card" aria-label="路由运行状态">
      <div className="service-panel-heading"><div className="workspace-sense"><TierSenseLogo wordmark /><span>步骤级智能路由</span></div><Badge color={running ? 'green' : ''}>{running ? '运行中' : '已暂停'}</Badge></div>
      <div className="service-panel-main"><div><h2>{running ? '路由正在运行' : ready ? '准备就绪，随时开始' : '完成配置后即可开启'}</h2><p>{running ? state.gateway.active ? `正在处理 ${state.gateway.active} 个请求，关闭窗口后仍会继续。` : '等待 AI 工具发来请求。你可以照常提问，无需手动切换模型。' : ready ? '开启后，已连接的 AI 工具即可使用你的模型池。' : '检查下方提示，补全服务和模型设置。'}</p></div>
        <div className="button-row">{running ? <><Button kind="secondary" icon={Square} disabled={busy} onClick={() => execute('gateway.stop', undefined, 'TierSense 路由已暂停')}>暂停路由</Button><Button icon={Code2} onClick={() => setPage('connection')}>连接 AI 工具</Button></> : <><Button kind="secondary" onClick={() => setPage('connection')}>查看连接信息</Button><Button icon={Play} disabled={busy} onClick={() => ready ? execute('gateway.start', undefined, 'TierSense 路由已开启') : setPage('setup')}>{ready ? '开启路由' : '补全配置'}</Button></>}</div>
      </div>
      <div className="service-panel-foot"><span><i className={running ? 'live-dot' : ''} />正在处理 <b>{state.gateway.active}</b> 个请求</span><span>本次打开已处理 <b>{state.gateway.total}</b> 次调用</span><button className="text-button" onClick={() => setPage('settings')}>自动开启：{state.settings.autoStart ? '已开启' : '未开启'} <ArrowRight size={13} /></button></div>
    </section>
    {!!problems.length && <section className="attention-panel card" aria-label="需要处理的事项"><div className="attention-heading"><CircleAlert size={17} /><h3>需要留意</h3><span>{problems.length} 项</span></div>{problems.map(item => <div className="attention-row" key={item.key}><div><strong>{item.title}</strong><p>{item.text}</p></div><button className="text-button" onClick={item.go}>{item.action}<ArrowRight size={14} /></button></div>)}</section>}
    <section className="workspace-setup card" aria-labelledby="workspace-setup-title">
      <div className="workspace-setup-heading"><h2 id="workspace-setup-title">配置引导</h2><p>点击对应步骤，查看或修改配置。</p></div>
      <ol className="workspace-steps">{[
        ['连接服务', '管理模型渠道和 TierSense 密钥。', 'providers'], ['安排模型', '综合难度分档，同档按专长分工。', 'routing'], ['连接 AI 工具', '复制服务地址、密钥和模型名称。', 'connection'],
      ].map(([name, desc, page], i) => <li key={name}><button onClick={() => onSetupStep ? onSetupStep(i) : setPage(page as 'providers' | 'routing' | 'connection')}><span className="workspace-step-number">0{i + 1}</span><div><strong>{name}</strong><p>{desc}</p></div><ArrowRight size={15} /></button></li>)}</ol>
    </section>
    <div className="workspace-links card">{[
      { icon: Network, title: '模型渠道', value: `${enabledProviders.length}`, unit: '个已启用', text: '管理密钥与平台余额', page: 'providers' as const },
      { icon: Layers3, title: '我的模型', value: `${availableModels.length}`, unit: '个已配置', text: `${state.routing.tiers.length} 个档次 · 查看模型分工`, page: 'models' as const },
      { icon: Gauge, title: '用量与费用', value: '', unit: '', text: '查看调用比例与预估消费', page: 'analytics' as const },
    ].map(item => <button key={item.title} onClick={() => setPage(item.page)}><div className="workspace-link-label"><item.icon size={18} /><strong>{item.title}</strong><ArrowRight size={15} /></div><div className="workspace-link-value">{item.value ? <><b>{item.value}</b><span>{item.unit}</span></> : <strong>查看用量分析</strong>}</div><p>{item.text}</p></button>)}</div>
    <div className="workspace-config-line"><span><Check size={15} />配置已保存在本机，可随时修改。</span><button className="text-button" disabled={!running || !ready} onClick={() => setModal({ type: 'test' })}>测试连接<ArrowRight size={14} /></button></div>
  </div>;
}
