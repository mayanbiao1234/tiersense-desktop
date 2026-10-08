import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCheck, CircleHelp, FlaskConical, Layers3, Network, Pencil, Play, Plus, ShieldCheck } from 'lucide-react';
import { readiness } from '../core/policy.mjs';
import { ProviderMark } from './Providers';
import type { API } from './types';
import { Badge, Button, Modal, SectionHead, TierSenseLogo, Toggle } from './ui';
import { RoutingEditor } from './RoutingEditor';
import { ConnectionFields } from './UserPages';
import { AgentGuide } from './AgentGuide';

export function SetupPage(api: API & { initialStep?: number }) {
  const { state, busy, act, execute, setModal, setPage } = api;
  const checks = readiness(state);
  const connected = checks.providers && checks.tiersense;
  const ready = connected && checks.models;
  const [step, setStep] = useState(() => api.initialStep === undefined ? connected ? state.onboardingCompleted && ready ? 2 : 1 : 0 : Math.max(0, Math.min(api.initialStep, ready ? 2 : connected ? 1 : 0)));
  const [entered, setEntered] = useState(false);
  const [finished, setFinished] = useState(false);
  const [pendingStep, setPendingStep] = useState<number | null>(null);
  useEffect(() => { window.scrollTo(0, 0); }, [step, finished]);
  const changeStep = (next: number) => {
    if (next === step) return;
    if (document.documentElement.dataset.routingDirty === 'true') { setPendingStep(next); return; }
    setStep(next); setFinished(false);
  };
  return <div className="setup-flow">
    <SectionHead title={finished ? '准备好了，可以开始使用。' : ['连接模型服务', '安排你的模型', '连接到 AI 工具'][step]} text={finished ? '完成后，可在左侧随时修改。' : ['先填写模型平台和 TierSense 的密钥。保存后可以随时继续。', '先按任务难度分档，再让同档模型按专长分工。不确定的设置可以先保留。', '开启 TierSense 路由，然后把三项信息复制到你使用的 AI 软件。'][step]} action={<Button kind="ghost" onClick={() => setPage('overview')}>{finished ? '回到总览' : '稍后继续'}</Button>} />
    <nav className="wizard-progress" aria-label="配置进度">{[
      { title: '连接服务', desc: '填写访问密钥', done: connected },
      { title: '安排模型', desc: '选择档次与分工', done: connected && checks.models },
      { title: '连接 AI 工具', desc: '复制三项信息', done: state.onboardingCompleted && ready },
    ].map((item, index) => <button key={item.title} aria-current={index === step ? 'step' : undefined} className={`${index === step ? 'current' : ''} ${item.done ? 'done' : ''}`} disabled={index === 1 && !connected || index === 2 && !ready} onClick={() => changeStep(index)}><span className="wizard-step-number">{item.done ? <Check size={19} /> : `0${index + 1}`}</span><span><strong>{item.title}</strong><small>{item.desc}</small></span>{index < 2 && <ArrowRight size={18} />}</button>)}</nav>
    {finished ? <section className="card setup-complete"><span className="complete-symbol"><CheckCheck size={35} /></span><h2>设置完成</h2><p>现在可以在已连接的 AI 工具里提问了。关闭窗口会收起到{state.platform === 'darwin' ? '菜单栏' : '系统托盘'}，服务继续运行。<br />使用了哪个模型、花了多少额度，都可以在左侧查看。</p><div className="button-row"><Button onClick={() => setPage('overview')}>回到总览</Button><Button kind="secondary" onClick={() => setPage('logs')}>查看使用记录</Button></div></section> : <>
      {step === 0 && <>
        <div className="setup-services"><section className="card padded"><div className="card-heading no-pad"><div><h3><Network size={18} />1. 添加模型渠道</h3><p>选择你购买模型服务的平台，例如智谱或 DeepSeek。</p></div><Badge color={checks.providers ? 'green' : ''}>{checks.providers ? '已配置' : '待填写'}</Badge></div>
          {state.providers.map(p => <div key={p.id} className="setup-provider"><ProviderMark preset={p.preset} /><div><strong>{p.name}</strong><small>{p.hasKey ? p.enabled ? '已保存 · 可选择模型' : '渠道已停用' : '请填写访问密钥'}</small></div><Button kind="ghost" disabled={busy || !p.hasKey} icon={Layers3} onClick={() => setModal({ type: 'discover', data: p })}>选择模型</Button><button className="icon-button" aria-label={`编辑 ${p.name}`} onClick={() => setModal({ type: 'provider', data: p })}><Pencil size={16} /></button>{!p.enabled && <Button kind="ghost" onClick={() => execute('provider.save', { ...p, enabled: true })}>启用</Button>}</div>)}
          <Button icon={Plus} kind={checks.providers ? 'secondary' : 'primary'} onClick={() => setModal({ type: 'provider' })}>{state.providers.length ? '再添加一个渠道' : '添加模型渠道'}</Button><p className="form-note">访问密钥是一串授权使用的字符，可从平台的 API 管理页获取，不是账户密码。保存后即可勾选模型。</p>
        </section><section className="card padded"><div className="card-heading no-pad"><div><h3>2. 连接 TierSense</h3><p>由 TierSense 判断每一步的难度，帮助选择模型。</p></div><Badge color={checks.tiersense ? 'green' : ''}>{checks.tiersense ? '已保存密钥' : '待连接'}</Badge></div><div className="setup-sense-copy"><TierSenseLogo /><div><strong>填写 TierSense 访问密钥</strong><p>填写用于难度判断的密钥，可在官网获取 <a className="inline-link" href="https://tierflow.cn" onClick={event => { event.preventDefault(); void execute('external.open', { url: 'https://tierflow.cn' }); }}>tierflow.cn</a>。</p></div></div><Button kind={checks.tiersense ? 'secondary' : 'primary'} onClick={() => setModal({ type: 'tiersense' })}>{checks.tiersense ? '修改访问密钥' : '填写访问密钥'}</Button><p className="form-note">保存不会产生模型调用费用；是否可用可在最后一步测试。</p></section></div>
        <div className="info-strip neutral"><ShieldCheck size={18} /><span>密钥在本机加密保存。使用时，任务消息会发送给 TierSense 判断难度，并发送给选中的模型平台。</span></div>
        <div className="wizard-footer"><span>{connected ? '服务信息已保存，接下来安排模型。' : '完成上方两项后，才能继续。'}</span><Button icon={ArrowRight} disabled={!connected || busy} onClick={() => setStep(1)}>下一步：安排模型</Button></div>
      </>}
      {step === 1 && <RoutingEditor {...api} embedded onSaved={() => setStep(2)} />}
      {step === 2 && <>
        <div className="setup-final-layout"><section className="card padded"><div className="card-heading no-pad"><div><h3>开启 TierSense 路由</h3><p>开启后，连接的 AI 工具才能使用这些模型。</p></div><Badge color={state.gateway.running ? 'green' : ''}>{state.gateway.running ? '运行中' : '未开启'}</Badge></div>
          <details className="disclosure"><summary>服务与模型已配置 <small>查看或修改</small></summary><div className="disclosure-body preflight-list">{[
            { ok: checks.providers, title: '模型渠道已配置', desc: `${state.providers.filter(p => p.enabled && p.hasKey).length} 个渠道可供选择`, step: 0 },
            { ok: checks.tiersense, title: 'TierSense 密钥已保存', desc: '用于判断任务难度', step: 0 },
            { ok: checks.models, title: '每档都有可用模型', desc: '模型安排已就绪', step: 1 },
          ].map(item => <div key={item.title}><span className={item.ok ? 'preflight-ok' : 'error-text'}>{item.ok ? <Check size={17} /> : <CircleHelp size={17} />}</span><div><strong>{item.title}</strong><small>{item.desc}</small></div><button className="text-button" onClick={() => setStep(item.step)}>修改</button></div>)}</div></details>
          <div className="setting-row"><div><strong>下次打开客户端时自动开启 TierSense 路由</strong><p>窗口收起到{state.platform === 'darwin' ? '菜单栏' : '系统托盘'}后，服务仍会运行。</p></div><Toggle checked={state.settings.autoStart} label="下次自动开启 TierSense 路由" disabled={busy} onChange={autoStart => execute('settings.save', { autoStart })} /></div>
          <Button className="full-width" icon={state.gateway.running ? Check : Play} disabled={busy || !ready || state.gateway.running} onClick={() => execute('gateway.start', undefined, 'TierSense 路由已开启')}>{state.gateway.running ? 'TierSense 路由已开启' : '开启 TierSense 路由'}</Button>

        </section><section className="card padded"><div className="card-heading no-pad"><div><h3>把三项信息填入 AI 工具</h3><p>在工具的模型设置中，选择自定义 OpenAI 服务；接口类型选 Chat Completions。</p></div><Badge>统一入口</Badge></div>
          <ConnectionFields {...api} /><p className="form-note">不知道填在哪里？展开下方“按软件查看连接步骤”。</p>
          <label className="setup-confirm"><input type="checkbox" checked={entered} disabled={!state.gateway.running || !ready} onChange={e => setEntered(e.target.checked)} /><span>我已在 AI 工具中填写并保存这三项</span></label>
        </section></div>
        <AgentGuide {...api} />
        <section className="card setup-test"><FlaskConical size={21} /><div><h3>可选：检查连接是否可用</h3><p>发送一条测试消息，会消耗少量 TierSense 和模型额度。</p></div><Button kind="secondary" disabled={!state.gateway.running || !ready} onClick={() => setModal({ type: 'test' })}>测试连接</Button></section>
        <div className="wizard-footer"><span>{!state.gateway.running ? '先开启 TierSense 路由，再填写连接信息。' : !entered ? '填好三项后，请勾选“我已在 AI 工具中填写并保存”。' : '准备完成，可以保存设置。'}</span><Button kind="secondary" icon={ArrowLeft} onClick={() => { setStep(1); }}>返回模型配置</Button><Button icon={CheckCheck} disabled={busy || !entered || !state.gateway.running || !ready} onClick={() => { void act('onboarding.complete').then(() => setFinished(true)).catch(() => {}); }}>完成配置</Button></div>
      </>}
    </>}
    {pendingStep !== null && <Modal title="选模设置尚未保存" subtitle="返回其他步骤会放弃尚未保存的设置。" onClose={() => setPendingStep(null)}><div className="modal-body"><div className="form-actions"><Button kind="secondary" onClick={() => setPendingStep(null)}>继续编辑</Button><Button onClick={() => { setStep(pendingStep); setPendingStep(null); }}>放弃修改并返回</Button></div></div></Modal>}
  </div>;
}
