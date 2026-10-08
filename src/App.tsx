import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckCheck, CircleHelp, Code2, FileClock, FlaskConical, Gauge, Layers3, LoaderCircle, Minus, Network, PanelTop, Play, Route, Settings2, ShieldCheck, Square, Trash2, X, type LucideIcon } from 'lucide-react';
import { invoke, preview, previewState } from './api';
import type { API, Log, Model, Page, Provider, State, Tier } from './types';
import { Badge, Button, Field, Modal, SectionHead, TierSenseLogo } from './ui';
import { readiness } from '../core/policy.mjs';
import { RoutingEditor } from './RoutingEditor';
import { ModelPicker } from './ModelPicker';
import { ModelsPanel } from './ModelsPanel';
import { ModelDialog } from './ModelDialog';
import { ProviderPanel } from './ProviderPanel';
import { AnalyticsPage, LogTable, LogDialog } from './UsageViews';
import { SetupPage } from './SetupPage';
import { OverviewPage, ConnectionPage, HelpPage, AccountPage, SettingsPage } from './UserPages';
import './routing.css';
import { ProviderDialog } from './Providers';



const nav: { id: Page; name: string; icon: LucideIcon }[] = [
  { id: 'overview', name: '总览', icon: PanelTop }, { id: 'providers', name: '模型渠道', icon: Network },
  { id: 'models', name: '我的模型', icon: Layers3 }, { id: 'routing', name: 'TierSense 路由', icon: Route },
  { id: 'connection', name: '连接 AI 工具', icon: Code2 }, { id: 'logs', name: '使用记录', icon: FileClock }, { id: 'analytics', name: '用量与费用', icon: Gauge },
];
const pageTitles: Record<Page, [string, string]> = {
  help: ['使用帮助', 'HELP'], setup: ['开始设置', 'SETUP'], overview: ['工作台', 'WORKSPACE'], providers: ['模型渠道', 'PROVIDERS'], models: ['我的模型', 'MODEL POOL'],
  routing: ['TierSense 路由', 'ROUTING'], connection: ['连接 AI 工具', 'INTEGRATION'], logs: ['使用记录', 'ACTIVITY'], analytics: ['用量与费用', 'ANALYTICS'], account: ['TierSense 服务', 'ACCOUNT'], settings: ['设置', 'PREFERENCES'],
};

export default function App() {
  const [state, setState] = useState<State>(previewState);
  const [page, updatePage] = useState<Page>('overview');
  const [setupEntryStep, setSetupEntryStep] = useState<number | undefined>();
  const [pendingPage, setPendingPage] = useState<Page | null>(null);
  const scrollPositions = useRef<Partial<Record<Page, number>>>({});
  const navigate = (next: Page) => { scrollPositions.current[page] = window.scrollY; setSetupEntryStep(undefined); updatePage(next); };
  const setPage = (next: Page) => { if (next === page) return; if (document.documentElement.dataset.routingDirty === 'true' || document.documentElement.dataset.settingsDirty === 'true') { setPendingPage(next); return; } navigate(next); };
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<{ type: string; data?: Provider | Model | Log } | null>(null);
  useLayoutEffect(() => { window.scrollTo(0, scrollPositions.current[page] ?? 0); }, [page]);
  useEffect(() => {
    const reveal = (event: Event) => { let parent = (event.target as HTMLElement).parentElement; while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; } };
    document.addEventListener('invalid', reveal, true);
    return () => document.removeEventListener('invalid', reveal, true);
  }, []);
  useEffect(() => { invoke<State>('snapshot').then(setState).catch(e => setToast({ text: e.message, error: true })); return window.tierflow?.subscribe(setState); }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 5000); return () => clearTimeout(id); }, [toast]);
  const notify = (text: string, error = false) => setToast({ text, error });
  async function act(action: string, input?: unknown, success?: string) {
    setBusy(true);
    try { const result = await invoke<unknown>(action, input); if (result && typeof result === 'object' && 'gateway' in result) setState(result as State); if (success) notify(success); return result; }
    catch (e) { notify((e as Error).message, true); throw e; } finally { setBusy(false); }
  }
  const execute = (action: string, input?: unknown, success?: string) => { void act(action, input, success).catch(() => {}); };
  async function copy(value: string) { try { if (window.tierflow) await invoke('clipboard.write', { text: value }); else await navigator.clipboard.writeText(value); notify('已复制到剪贴板'); } catch { notify('复制失败，请手动选择复制', true); } }
  const checks = readiness(state);
  const ready = checks.providers && checks.models && checks.tiersense;
  const endpoint = `http://127.0.0.1:${state.gateway.port}/v1`;
  const api = { state, busy, act, execute, notify, copy, setPage, setModal, endpoint };
  return <div className={`app-shell platform-${state.platform}`}>
    <aside className="sidebar"><div className="brand"><img src="/tsingshu_ai_logo.svg" alt="清枢智汇 · TsingShu.AI" /></div>
      <div className="app-identity">TierFlow <span>桌面端</span></div>
      <div className="nav-caption">日常使用</div><nav>{nav.map(item => <button key={item.id} aria-label={item.name} title={item.name} onClick={() => setPage(item.id)} className={page === item.id ? 'active' : ''}><item.icon size={18} strokeWidth={1.65} /><span>{item.name}</span>{item.id === 'providers' && state.providers.length > 0 && <em>{state.providers.length}</em>}{page === item.id && <i />}</button>)}</nav>
      <div className="sidebar-bottom">
        <button title="设置" className={`side-utility ${page === 'settings' ? 'selected' : ''}`} onClick={() => setPage('settings')}><Settings2 size={17} />设置</button>
        <button title="使用帮助" className={`side-utility ${page === 'help' ? 'selected' : ''}`} onClick={() => setPage('help')}><CircleHelp size={17} />使用帮助</button>
        <button title="TierSense 服务" className={`side-utility sense-nav ${page === 'account' ? 'selected' : ''}`} onClick={() => setPage('account')}><TierSenseLogo /><span>TierSense 服务</span></button>
      </div>
    </aside>
    <div className="main-shell"><div className="titlebar"><span>TierFlow Desktop <span className="title-version">/ {state.version}</span></span>{preview && <span className="preview-tag">浏览器界面预览</span>}<div className="window-controls"><button aria-label="最小化窗口" onClick={() => execute('window.minimize')}><Minus size={14} /></button><button aria-label="最大化窗口" onClick={() => execute('window.maximize')}><Square size={11} /></button><button aria-label="收起到系统托盘" title="收起到系统托盘，服务继续运行" onClick={() => execute('window.close')}><X size={16} /></button></div></div>
      <header className="topbar"><div><strong>{pageTitles[page][0]}</strong></div><div className="topbar-actions"><span className={`service-state ${state.gateway.running ? 'online' : ''}`}><i />TierSense 路由{state.gateway.running ? '已开启' : '未开启'}</span><span className="topbar-divider" />{!(page === 'overview' && state.onboardingCompleted) && (page !== 'overview' || ready || state.gateway.running) && <Button disabled={busy} kind={state.gateway.running || !ready ? 'secondary' : 'primary'} icon={state.gateway.running ? Square : Play} onClick={() => !state.gateway.running && !ready ? setPage('setup') : execute(state.gateway.running ? 'gateway.stop' : 'gateway.start', undefined, state.gateway.running ? 'TierSense 路由已暂停' : 'TierSense 路由已开启')}>{state.gateway.running ? '暂停' : ready ? '开启' : '继续设置'}</Button>}</div></header>
      <main key={page}>
        {page === 'setup' && <SetupPage {...api} initialStep={setupEntryStep} />}
        {page === 'overview' && <OverviewPage {...api} onSetupStep={step => { setPage('setup'); setSetupEntryStep(step); }} />}
        {page === 'providers' && <ProviderPanel {...api} />}
        {page === 'analytics' && <AnalyticsPage {...api} />}
        {page === 'models' && <ModelsPanel {...api} />}
        {page === 'routing' && <RoutingEditor {...api} />}
        {page === 'connection' && <ConnectionPage {...api} />}
        {page === 'logs' && <><SectionHead title="使用记录" text="查看每次用了哪个模型、是否成功，以及用了多少额度。" action={<Button kind="secondary" icon={Trash2} disabled={!state.logs.length && !state.history.error} onClick={() => setModal({ type: 'clear-logs' })}>清空记录</Button>} />{state.history.error && <div className="info-strip error-text"><CircleHelp size={17} /><span>{state.history.error}</span></div>}<section className="card"><LogTable state={state} setModal={setModal} setPage={setPage} /></section></>}
        {page === 'account' && <AccountPage {...api} />}
        {page === 'help' && <HelpPage {...api} />}
        {page === 'settings' && <SettingsPage {...api} />}
      </main>
    </div>
    {modal?.type === 'provider' && <ProviderDialog data={modal.data as Provider | undefined} busy={busy} onClose={() => setModal(null)} onSave={async input => { const saved = await act('provider.save', input, modal.data?.id ? '渠道已更新' : '渠道已保存，请选择模型') as State & { savedProviderId: string }; setModal(modal.data?.id ? null : { type: 'discover', data: saved.providers.find(p => p.id === saved.savedProviderId) }); }} />}
    {modal?.type === 'discover' && <ModelPicker {...api} provider={modal.data as Provider | undefined} />}
    {modal?.type === 'model' && <ModelDialog data={modal.data as Model | undefined} state={state} busy={busy} onDelete={() => setModal({ type: 'delete-model', data: modal.data })} onClose={() => setModal(null)} onSave={async input => { await act('model.save', input, '模型已保存'); setModal(null); }} />}
    {modal?.type === 'tiersense' && <TierSenseDialog {...api} onClose={() => setModal(null)} />}
    {modal?.type === 'test' && <TestDialog {...api} onClose={() => setModal(null)} />}
    {modal?.type === 'log' && <LogDialog log={modal.data as Log} onClose={() => setModal(null)} />}
    {modal && ['delete-provider', 'delete-model', 'clear-logs'].includes(modal.type) && <Modal title={modal.type === 'clear-logs' ? '清空调用记录' : '确认删除'} onClose={() => setModal(null)}><div className="modal-body"><p className="confirmation-text">{modal.type === 'delete-provider' ? `删除「${(modal.data as Provider).name}」后，该渠道的密钥和关联模型也会移除。` : modal.type === 'delete-model' ? `删除已添加的模型「${(modal.data as Model).name}」？相关分工会移除它，没有模型可选的分工将暂停。若它是备用模型，判断难度失败时将停止调用。平台账户中的模型和历史记录保留。` : '将清空本地保留的全部调用记录及对应费用统计，无法恢复。渠道、模型、密钥和渠道账单不受影响；进行中的请求完成后会产生新记录。'}</p><div className="form-actions"><Button kind="secondary" onClick={() => setModal(null)}>取消</Button><Button kind="danger" disabled={busy} onClick={() => { void act(modal.type === 'delete-provider' ? 'provider.delete' : modal.type === 'delete-model' ? 'model.delete' : 'logs.clear', { id: modal.data?.id }, '已完成').then(() => setModal(null)).catch(() => {}); }}>确认{modal.type === 'clear-logs' ? '清空' : '删除'}</Button></div></div></Modal>}
    {pendingPage && <Modal title="设置尚未保存" subtitle="离开会放弃本次未保存的修改，已保存的配置不受影响。" onClose={() => setPendingPage(null)}><div className="modal-body"><div className="form-actions"><Button kind="secondary" onClick={() => setPendingPage(null)}>继续编辑</Button><Button onClick={() => { navigate(pendingPage); setPendingPage(null); }}>放弃修改并离开</Button></div></div></Modal>}
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role="status">{toast.error ? <CircleHelp size={18} /> : <CheckCheck size={18} />}<span>{toast.text}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={14} /></button></div>}
  </div>;
}

function TierSenseDialog({ state, busy, act, onClose }: API & { onClose: () => void }) {
  const [key, setKey] = useState(''); const [url, setUrl] = useState(state.settings.tiersenseUrl);
  return <Modal title="连接 TierSense" subtitle="连接 TierSense 决策模型，为每一步任务判断难度并指导选模。" onClose={onClose}><form className="modal-body" onSubmit={e => { e.preventDefault(); void act('tiersense.save', { key, url }, 'TierSense 配置已保存').then(onClose).catch(() => {}); }}><div className="info-strip"><ShieldCheck size={18} /><span>TierSense 会收到任务消息，用于判断难度。模型平台的密钥不会发送给它。</span></div><Field label="TierSense 访问密钥（API Key）" hint={state.hasTiersenseKey ? '留空保留已保存的 Key。' : '填写已获授权的 TierSense 服务密钥，费用按原服务规则结算。'}><input required={!state.hasTiersenseKey} type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder={state.hasTiersenseKey ? '••••••••••••••••（已保存）' : '粘贴 TierSense 访问密钥'} /></Field><details className="disclosure"><summary>高级：更改 TierSense 服务地址</summary><div className="disclosure-body"><Field label="服务地址"><input required type="url" value={url} onChange={e => setUrl(e.target.value)} /></Field></div></details><div className="form-actions">{state.hasTiersenseKey && <Button kind="ghost" onClick={() => { void act('tiersense.remove', undefined, '已断开 TierSense').then(onClose).catch(() => {}); }} disabled={busy}>断开连接</Button>}<Button kind="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={busy}>保存连接</Button></div></form></Modal>;
}
function TestDialog({ state, act, onClose }: API & { onClose: () => void }) {
  const [prompt, setPrompt] = useState('用一句话说明什么是智能模型路由。'); const [running, setRunning] = useState(false); const [result, setResult] = useState<{ text: string; model: string } | null>(null);
  return <Modal title="测试连接" subtitle="发送一条简短消息，检查 TierSense 路由能否正常使用。" onClose={onClose} wide><div className="modal-body"><div className="info-strip"><FlaskConical size={17} /><span>将发送下面的测试内容到 TierSense 及选中的模型渠道，消耗相应服务额度。</span></div><Field label="测试消息"><textarea rows={4} maxLength={8000} value={prompt} onChange={e => setPrompt(e.target.value)} /></Field>{!state.gateway.running && <p className="error-text">请先开启 TierSense 路由。</p>}{result && <div className="test-result"><Badge color="green">响应成功 · {result.model}</Badge><p>{result.text}</p></div>}<div className="form-actions"><Button kind="secondary" onClick={onClose}>关闭</Button><Button disabled={running || !state.gateway.running || !prompt.trim()} icon={running ? LoaderCircle : Play} onClick={() => { setRunning(true); setResult(null); void act('route.test', { prompt }).then(r => setResult(r as { text: string; model: string })).catch(() => {}).finally(() => setRunning(false)); }}>{running ? '正在等待回复…' : '发送测试'}</Button></div></div></Modal>;
}
