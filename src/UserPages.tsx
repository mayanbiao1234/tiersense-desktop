import { useEffect, useState } from 'react';
import { ArrowRight, Check, CheckCheck, CircleHelp, Copy, Eye, EyeOff, FlaskConical, FolderOpen, Gauge, Layers3, Network, Play, ShieldCheck } from 'lucide-react';
import { readiness } from '../core/policy.mjs';
import type { API } from './types';
import { Badge, Button, Field, SectionHead, TierSenseLogo, Toggle } from './ui';
import { preview } from './api';
import { AgentGuide } from './AgentGuide';
import { Workspace } from './Workspace';

export function OverviewPage(api: API & { onSetupStep: (step: number) => void }) {
  const { state, busy, setPage, setModal, execute } = api;
  const checks = readiness(state), connected = checks.providers && checks.tiersense;
  const ready = connected && checks.models, complete = ready && state.onboardingCompleted;
  const steps = [
    { title: '连接服务', desc: '添加你购买模型服务的平台，连接 TierSense。', done: connected },
    { title: '安排模型', desc: '选择要用的模型，按任务难度和专长分工。', done: connected && checks.models },
    { title: '连接到 AI 工具', desc: '复制三项信息到你使用的 AI 软件。', done: complete },
  ];
  const count = steps.filter(s => s.done).length;
  const currentStep = steps.findIndex(step => !step.done);
  if (state.onboardingCompleted) return <Workspace {...api} />;
  return <>
    <SectionHead title="智能选模，搭配刚刚好" text="TierSense 为每一步任务判断难度、选择模型，模型费用仍由原渠道结算。" />
    <section className="welcome-card">
      <div className="welcome-copy"><div className="sense-hero-brand"><TierSenseLogo wordmark /><span>决策模型 · 步骤级智能路由</span></div>
        <h2>{complete ? state.gateway.running ? 'TierSense 路由已开启' : '开启 TierSense 智能路由' : '把准备工作交给这份引导'}</h2>
        <p className="welcome-description">{complete ? <><span>照常在 AI 工具里提问。</span><span>TierSense 为每一步选择合适的模型。</span></> : <><span>连接模型渠道和 TierSense。</span><span>跟着三步完成设置，无需编写代码。</span></>}</p>
        <div className="button-row"><Button icon={complete ? state.gateway.running ? ArrowRight : Play : ArrowRight} disabled={busy} onClick={() => complete ? state.gateway.running ? setPage('connection') : execute('gateway.start', undefined, 'TierSense 路由已开启') : setPage('setup')}>{complete ? state.gateway.running ? '查看连接信息' : '开启 TierSense 路由' : state.providers.length || state.hasTiersenseKey ? '继续设置' : '开始设置'}</Button><Button kind="ghost" onClick={() => setPage('help')}>第一次使用？先看说明</Button></div>
      </div><nav className="welcome-guide" aria-label="三步配置引导">
        <div className="welcome-guide-heading"><h3>配置引导</h3><span>已完成 {count} / 3 步</span></div>
        <p className="welcome-guide-hint">{complete ? '点击对应步骤，可重新检查或修改。' : '按顺序点击下面的步骤，完成首次设置。'}</p>
        <div className="welcome-guide-steps">{steps.map((step, i) => {
          const available = i === 0 || i === 1 && connected || i === 2 && ready;
          const current = i === currentStep;
          return <button key={step.title} className={`welcome-step ${current ? 'current' : ''} ${step.done ? 'complete' : ''}`} disabled={!available} aria-current={current ? 'step' : undefined} aria-label={`第 ${i + 1} 步：${step.title}，${step.done ? '修改设置' : available ? '去设置' : '请先完成前面的步骤'}`} onClick={() => api.onSetupStep(i)}>
            <span className="welcome-step-number">0{i + 1}</span>
            <div className="welcome-step-copy"><div className="welcome-step-title"><strong>{step.title}</strong>{step.done ? <span className="welcome-step-status"><Check size={12} />已完成</span> : current && <span className="welcome-step-status">当前步骤</span>}</div><small>{available ? step.desc : i === 1 ? '先完成第 1 步，再选择模型。' : '先完成前两步，再连接 AI 工具。'}</small></div>
            <span className="welcome-step-action">{step.done ? '修改' : available ? '去设置' : '待解锁'}{available && <ArrowRight size={14} />}</span>
          </button>;
        })}</div>
      </nav>
    </section>
    {complete && <div className="home-shortcuts">{[
      { icon: Network, title: '模型渠道', value: `${state.providers.filter(p => p.enabled && p.hasKey).length} 个已启用`, page: 'providers' as const },
      { icon: Layers3, title: '我的模型', value: `${state.models.filter(m => m.enabled).length} 个已启用`, page: 'models' as const },
      { icon: Gauge, title: '用量与费用', value: '查看模型使用比例与消费', page: 'analytics' as const },
    ].map(item => <button className="card" key={item.title} onClick={() => setPage(item.page)}><item.icon size={22} /><div><strong>{item.title}</strong><span>{item.value}</span></div><ArrowRight size={17} /></button>)}</div>}
    <div className="home-bottom"><span><ShieldCheck size={16} />密钥在本机加密保存。任务消息会发送给 TierSense 和选中的模型平台。</span>{complete && <button className="text-button" onClick={() => setModal({ type: 'test' })}>检查是否能正常使用 <ArrowRight size={14} /></button>}</div>
  </>;
}

export function ConnectionFields({ endpoint, act, copy }: Pick<API, 'endpoint' | 'act' | 'copy'>) {
  const [key, setKey] = useState('');
  return <div className="connection-fields simple-connection-fields">{[
    { id: 'url', title: '服务地址', field: 'Base URL', value: endpoint },
    { id: 'key', title: '访问密钥', field: 'API Key', value: key || '••••••••••••••••••••••••' },
    { id: 'model', title: '模型名称', field: 'Model', value: 'tierflow-auto' },
  ].map((item, i) => <div key={item.id}><label><span>{i + 1}</span>{item.title}<small>{item.field}</small></label><div><code>{item.value}</code>{item.id === 'key' && <button type="button" aria-label={key ? '隐藏访问密钥' : '显示访问密钥'} onClick={() => key ? setKey('') : void act('gateway.key').then(k => setKey(k as string)).catch(() => {})}>{key ? <EyeOff size={16} /> : <Eye size={16} />}</button>}<button type="button" className="copy-text" aria-label={`复制${item.title}`} onClick={() => { if (item.id === 'key') void act('gateway.key').then(k => copy(k as string)).catch(() => {}); else void copy(item.value); }}><Copy size={15} />复制</button></div></div>)}</div>;
}

export function ConnectionPage(api: API) {
  const { state, endpoint, busy, act, execute, copy, notify, setModal, setPage } = api;
  const [lang, setLang] = useState('python'); const [keyRevision, setKeyRevision] = useState(0);
  const checks = readiness(state), ready = checks.providers && checks.models && checks.tiersense;
  const code = lang === 'python' ? `from openai import OpenAI\nimport os\n\nclient = OpenAI(\n    base_url="${endpoint}",\n    api_key=os.environ["TIERFLOW_LOCAL_KEY"],\n)\nresponse = client.chat.completions.create(\n    model="tierflow-auto",\n    messages=[{"role": "user", "content": "你好"}],\n)\nprint(response.choices[0].message.content)` : `curl "${endpoint}/chat/completions" \\\n  -H "Authorization: Bearer $TIERFLOW_LOCAL_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"tierflow-auto","messages":[{"role":"user","content":"你好"}]}'`;
  return <><SectionHead title="连接到你使用的 AI 工具" text="在 AI 软件中填写下面三项信息，即可使用 TierSense 智能路由。" />
    {!ready && <div className="info-strip"><CircleHelp size={18} /><span>先完成服务和模型设置，再进行连接。</span><Button kind="ghost" onClick={() => setPage('setup')}>继续设置</Button></div>}
    <section className="card connection-guide"><div className="connection-instructions"><span className="section-number">连接方法</span><h2>打开 AI 工具的模型设置</h2><ol><li>添加服务商，选择「自定义」或「OpenAI 兼容」。</li><li>如果能选择接口类型，选「Chat Completions」。</li><li>把服务地址、访问密钥、模型名称逐一复制到对应位置，保存后开始对话。</li></ol><p>每个软件的字段名称略有不同，认准标签旁的英文名称即可。</p><div className="connection-status"><Badge color={state.gateway.running ? 'green' : ''}>{state.gateway.running ? 'TierSense 路由已开启' : 'TierSense 路由未开启'}</Badge>{!state.gateway.running && <Button icon={Play} disabled={busy || !ready} onClick={() => execute('gateway.start', undefined, 'TierSense 路由已开启')}>开启</Button>}</div></div><div className="connection-values"><ConnectionFields key={keyRevision} {...api} /><p className="form-note">这里使用本机生成的连接密钥，和 TierSense 服务密钥、模型渠道密钥不同。</p></div></section>
    <AgentGuide {...api} />
    <div className="connection-tip"><CheckCheck size={18} /><span>使用时保持本客户端运行。点击 × 会收起窗口，TierSense 路由会继续工作。</span><Button kind="secondary" icon={FlaskConical} disabled={!ready || !state.gateway.running} onClick={() => setModal({ type: 'test' })}>测试连接</Button></div>
    <details className="disclosure card"><summary>无法连接？查看排查方法</summary><div className="disclosure-body"><ol className="plain-list"><li>确认上方显示“TierSense 路由已开启”，并且 AI 工具运行在这台电脑上。</li><li>重新复制三项信息，不要把模型平台的密钥填在这里。</li><li>此版本支持 OpenAI Chat Completions。只支持 Responses 或 Anthropic 原生接口的软件暂时无法直接连接。</li><li>打开“使用记录”查看具体错误；余额不足或模型权限问题需在对应平台处理。</li></ol><Button kind="ghost" onClick={() => setPage('logs')}>查看使用记录 <ArrowRight size={14} /></Button></div></details>
    <details className="disclosure card"><summary>开发者选项：代码示例与更换密钥</summary><div className="disclosure-body"><section className="code-card"><div className="code-tabs"><button className={lang === 'python' ? 'active' : ''} onClick={() => setLang('python')}>Python</button><button className={lang === 'curl' ? 'active' : ''} onClick={() => setLang('curl')}>cURL</button><button aria-label="复制示例代码" onClick={() => void copy(code)}><Copy size={15} /></button></div><pre><code>{code}</code></pre></section><p className="form-note">将本地密钥设置为环境变量 TIERFLOW_LOCAL_KEY。每次请求需携带完整消息历史，可通过 tierflow_task 传递原始任务；不支持只传历史 ID 的增量请求。</p><div className="setting-row"><div><strong>更换本地访问密钥</strong><p>更换后，所有已连接的 AI 工具都需要更新。</p></div><Button kind="secondary" onClick={() => { if (window.confirm('更换访问密钥后，所有已连接的 AI 工具都需要更新。继续吗？')) void act('gateway.rotate').then(() => { setKeyRevision(v => v + 1); notify('已更换，请重新复制访问密钥'); }).catch(() => {}); }}>更换密钥</Button></div></div></details>
  </>;
}

export function HelpPage({ setPage, setModal, execute }: API) {
  return <><SectionHead title="第一次使用 TierSense" text="先准备密钥，再跟随引导连接。这里解释你真正需要知道的几件事。" action={<Button icon={ArrowRight} onClick={() => setPage('setup')}>开始设置</Button>} />
    <div className="help-intro card"><TierSenseLogo /><div><h2>让不同模型，各自做好擅长的事。</h2><p>你在 AI 工具里提出任务，TierSense 判断每一步的难度，本客户端按你的分工设置调用模型。你仍在原来的 AI 工具里完成任务。</p></div></div>
    <section className="card help-preparation"><h3>开始前准备这三样</h3><ol className="plain-list"><li><strong>模型平台的访问密钥（API Key）</strong><p>例如 TierFlow、智谱、DeepSeek。可在平台的 API 管理页创建；聊天会员通常不等于 API 使用额度。</p></li><li><strong>TierSense 的访问密钥</strong><p>用于判断任务难度。当前版本需要已有密钥，客户端内购买订阅暂未开放。</p></li><li><strong>支持自定义模型接口的 AI 工具</strong><p>该软件需运行在本机，并支持 OpenAI 兼容的 Chat Completions 接口。</p></li></ol></section>
    {[
      ['“渠道”和“模型”有什么区别？', '渠道是你购买模型服务的平台，模型是平台提供的具体 AI。先连接渠道，再从它的列表中选择模型。一个渠道可以添加多个模型。'],
      ['API Key 是什么，能用账户密码代替吗？', '它是一串用于授权调用的访问密钥，需要从对应平台获取。它不是登录密码，不要把密码填进来。模型渠道密钥和 TierSense 密钥分别填写；连接 AI 工具时，再复制本机生成的连接密钥。'],
      ['不知道怎么分档，可以先用吗？', '可以先保留默认档次，把模型放进你认为合适的档次。轻量适合简单任务，旗舰用于更难的任务；这只是你的分组，不是软件对模型能力的认证。还可为同档模型指定分工，例如复杂编程优先 GLM、复杂规划优先 Qwen。'],
      ['工具调用和图片能力，需要勾选吗？', '如果模型支持让 AI 软件执行搜索、读文件等操作，可勾选“工具”；支持看图则勾选“图片”。这些标记帮助 TierSense 路由筛选可用模型，不会让模型获得新能力。不确定时先查看渠道的模型说明。'],
      ['钱从哪里扣？为什么有些费用是“未知”？', '模型费用由原渠道结算，TierSense 使用自己的服务额度。用量与费用页只统计经过本客户端的请求。填好模型单价、平台返回用量后才能估算，最终金额以平台账单为准。'],
      ['Token 和缓存命中是什么？', 'Token 是模型计量文本用量的单位，不等于字数。缓存命中表示平台复用了部分已有输入，一些平台会对此收取较低费用。平台没返回这些数据时，界面显示“—”，不是 0。'],
      ['关掉窗口，还能继续使用吗？', '点击 × 只会收起到后台，已开启的 TierSense 路由继续工作。右下角 TierFlow 图标可恢复窗口；选择“退出 TierFlow”才会完全退出，连接它的 AI 工具也将无法继续调用。'],
    ].map(([title, body]) => <details className="disclosure card" key={title}><summary>{title}</summary><div className="disclosure-body"><p>{body}</p></div></details>)}
    <div className="help-links"><Button kind="secondary" onClick={() => setModal({ type: 'tiersense' })}>连接 TierSense</Button><Button kind="ghost" onClick={() => execute('external.open', { url: 'https://tierflow.cn/tiersense/docs/difficulty' })}>查看 TierSense 技术文档</Button></div>
  </>;
}

export function AccountPage({ state, setModal }: API) {
  return <><SectionHead title="TierSense 服务" text="TierSense 负责判断任务难度，模型调用费用仍由各渠道结算。" /><section className="card sense-service"><TierSenseLogo wordmark /><div><h2>{state.hasTiersenseKey ? '访问密钥已保存' : '连接已有的 TierSense 服务'}</h2><p>{state.hasTiersenseKey ? '实际可用额度和权限以平台为准。' : '当前请使用已有密钥。客户端内登录和购买订阅暂未开放。'}</p></div><Button onClick={() => setModal({ type: 'tiersense' })}>{state.hasTiersenseKey ? '管理连接' : '填写访问密钥'}</Button></section><details className="disclosure card"><summary>TierSense 月度订阅 · 尚未开放</summary><div className="disclosure-body"><p>计划在客户端内提供 ¥12.9 / 月订阅。正式上线前会说明额度和续费规则。当前无法登录或付款，已有密钥按原服务规则使用。</p></div></details></>;
}

export function SettingsPage({ state, busy, act, execute }: API) {
  const [form, setForm] = useState(state.settings);
  const dirty = Object.entries(form).some(([key, value]) => key !== 'zoomFactor' && value !== state.settings[key as keyof typeof state.settings]);
  useEffect(() => { document.documentElement.dataset.settingsDirty = String(dirty); return () => { delete document.documentElement.dataset.settingsDirty; }; }, [dirty]);
  return <><SectionHead title="设置" text="调整显示大小和启动方式。" action={<div className="save-status"><span className={dirty ? 'unsaved' : ''}>{dirty ? '有未保存的修改' : '设置已保存'}</span><Button icon={Check} disabled={busy || !dirty} onClick={() => void act('settings.save', { ...form, zoomFactor: state.settings.zoomFactor }, '设置已保存').catch(() => {})}>保存设置</Button></div>} />
    <section className="card padded settings-card"><h3>日常使用</h3><div className="setting-row"><div><strong>文字和界面大小</strong><p>立即生效。{state.platform === 'darwin' ? '⌘' : 'Ctrl'} + 加号 / 减号也可调整。</p></div><select aria-label="界面缩放" className="compact-select" value={state.settings.zoomFactor} disabled={busy || preview} onChange={e => execute('settings.save', { zoomFactor: Number(e.target.value) })}>{[.8,.9,1,1.1,1.25,1.5].map(v => <option value={v} key={v}>{v * 100}%{v === 1 ? '（默认）' : ''}</option>)}</select></div><div className="setting-row"><div><strong>打开客户端时自动开启 TierSense 路由</strong><p>不用每次手动开启。修改后点击“保存设置”。</p></div><Toggle checked={form.autoStart} onChange={autoStart => setForm({ ...form, autoStart })} label="打开时自动开启 TierSense 路由" /></div><div className="setting-row"><div><strong>关闭窗口后继续运行</strong><p>点击 × 收起到{state.platform === 'darwin' ? '顶部菜单栏' : '右下角托盘'}。完全关闭请在菜单中选择“退出 TierFlow”。</p></div><Button kind="secondary" disabled={preview} onClick={() => execute('tray.menu')}>打开后台菜单</Button></div></section>
    <details className="disclosure card"><summary>高级设置：端口与等待时间</summary><div className="disclosure-body"><p className="form-note">通常无需修改。端口被占用或经常等待超时时，再调整这些选项。</p><Field label="本地服务端口" hint="更改前先暂停 TierSense 路由，更改后需重新复制地址到 AI 工具。"><input type="number" min={1024} max={65535} value={form.port} disabled={state.gateway.running} onChange={e => setForm({ ...form, port: Number(e.target.value) })} /></Field><div className="setting-row"><div><strong>恢复模型尝试</strong><p>刚开通模型或补充额度后，可清除临时等待状态。此操作不会发起付费调用。</p></div><Button kind="secondary" disabled={busy || preview} onClick={() => execute('gateway.retry', undefined, '下次请求将重新尝试模型')}>恢复尝试</Button></div><div className="form-grid"><Field label="等待难度判断（秒）"><input type="number" min={1} max={120} value={form.scoreTimeoutMs / 1000} onChange={e => setForm({ ...form, scoreTimeoutMs: Number(e.target.value) * 1000 })} /></Field><Field label="等待整次回复（秒）"><input type="number" min={10} max={600} value={form.requestTimeoutMs / 1000} onChange={e => setForm({ ...form, requestTimeoutMs: Number(e.target.value) * 1000 })} /></Field></div></div></details>
    <details className="disclosure card"><summary>本机数据与隐私</summary><div className="disclosure-body"><p>密钥由系统加密保存在本机。消息会发送至 TierSense 判断难度，并发送至选中的模型平台。</p><p>使用记录不保存消息正文，最多保留 90 天、10,000 条。可在“使用记录”中清空。</p><p>为兼容多轮对话，原始推理内容在内存中暂存最多 24 小时（最多 1,024 条、32 MiB）。默认不写入文件，停止服务或退出后清空。</p><div className="setting-row"><div><strong>重启后继续已有对话</strong><p>开启并保存后，推理缓存会在本机加密保存，24 小时内有效。过期内容下次运行时清理，关闭后删除缓存文件。</p></div><Toggle checked={!!form.retainReasoning} onChange={retainReasoning => setForm({ ...form, retainReasoning })} label="重启后继续已有对话" /></div><div className="setting-row"><div><strong>清空对话兼容缓存</strong><p>清空后，部分旧对话可能需要重新开始。</p></div><Button kind="secondary" disabled={busy || preview} onClick={() => { if (window.confirm('清空后，部分旧对话可能需要重新开始。继续清空兼容缓存吗？')) execute('reasoning.clear', undefined, '兼容缓存已清空'); }}>清空缓存</Button></div>{state.recoveryError && <p className="error-text">{state.recoveryError}</p>}<div className="setting-row"><div><strong>数据位置</strong><p className="mono">{state.dataDir}</p></div><Button kind="secondary" icon={FolderOpen} onClick={() => execute('data.open')}>打开文件夹</Button></div></div></details><div className="about-line"><strong>TierSense 智能路由</strong><span>版本 {state.version}</span></div>
  </>;
}
