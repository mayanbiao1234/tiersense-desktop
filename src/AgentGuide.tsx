import { useState } from 'react';
import { Copy } from 'lucide-react';
import type { API } from './types';
import { Button } from './ui';

type Agent = 'workbuddy' | 'openclaw' | 'opencode';
function configuration(agent: Agent, endpoint: string, key: string, v2: boolean) {
  const id = 'tierflow-auto';
  if (agent === 'openclaw') return JSON.stringify({
    models: { mode: 'merge', providers: { tiersense: {
      baseUrl: endpoint, apiKey: key, api: 'openai-completions',
      models: [{ id, name: 'TierSense 自动选模', reasoning: true, input: ['text'], contextWindow: 32768, maxTokens: 4096,
        compat: { requiresReasoningContentOnAssistantMessages: true, maxTokensField: 'max_tokens', supportsStore: false, supportsReasoningEffort: false } }],
    } } },
    agents: { defaults: { model: { primary: `tiersense/${id}` } } },
  }, null, 2);
  const models = { [id]: { name: 'TierSense 自动选模', reasoning: true, tool_call: true, interleaved: { field: 'reasoning_content' }, limit: { context: 32768, output: 4096 } } };
  return JSON.stringify(v2 ? {
    providers: { tiersense: { name: 'TierSense', package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: endpoint, apiKey: key }, models } },
  } : {
    provider: { tiersense: { name: 'TierSense', npm: '@ai-sdk/openai-compatible', options: { baseURL: endpoint, apiKey: key }, models } },
  }, null, 2);
}

export function AgentGuide({ endpoint, act, copy }: Pick<API, 'endpoint' | 'act' | 'copy'>) {
  const [agent, setAgent] = useState<Agent>('workbuddy');
  const [v2, setV2] = useState(false);
  const [copying, setCopying] = useState(false);
  const copyConfiguration = async () => {
    setCopying(true);
    try { const key = await act('gateway.key') as string; await copy(configuration(agent, endpoint, key, v2)); }
    catch { /* The shared action handler displays failures. */ }
    finally { setCopying(false); }
  };
  return <details className="disclosure card agent-guide">
    <summary>按软件查看连接步骤 <small>WorkBuddy · OpenClaw · OpenCode</small></summary>
    <div className="disclosure-body">
      <div className="agent-guide-tabs" aria-label="选择 AI 工具">{(['workbuddy', 'openclaw', 'opencode'] as Agent[]).map((id, index) => <button type="button" key={id} aria-pressed={agent === id} className={agent === id ? 'active' : ''} onClick={() => setAgent(id)}>{['WorkBuddy', 'OpenClaw', 'OpenCode'][index]}</button>)}</div>
      {agent === 'workbuddy' ? <ol className="plain-list">
        <li>在 WorkBuddy「设置 → 模型」里添加模型，选择「自定义 / Custom」。</li>
        <li>复制本页的服务地址、访问密钥；模型名称填写 <code>tierflow-auto</code>。显示名称可自定。</li>
        <li>保留“自定义协议”关闭，让软件自动补全地址。如果已开启，完整地址应填 <code>{endpoint}/chat/completions</code>。</li>
        <li>开启工具调用能力，保存后在对话中选择刚添加的模型。更新本客户端后，先新建一段对话验证。</li>
      </ol> : <>
        <p>{agent === 'openclaw' ? '将下面的配置合并到 OpenClaw 的配置文件，保留已有渠道和其他设置。选择 tiersense/tierflow-auto。' : '将下面的配置合并到 opencode.json，保留原有设置。重新打开 OpenCode，用 /models 选择 tiersense/tierflow-auto。'}</p>
        {agent === 'opencode' && <label className="agent-version">OpenCode 版本<select value={v2 ? 'v2' : 'v1'} onChange={e => setV2(e.target.value === 'v2')}><option value="v1">V1（provider / npm）</option><option value="v2">V2（providers / package）</option></select></label>}
        <p className="form-note">示例已加入推理历史的兼容配置。上下文 32K、输出 4K 为示例上限，请按候选模型中最小的上限调整。旧版软件不识别字段时请先更新。</p>
        <details className="agent-config"><summary>查看配置内容</summary><pre><code>{configuration(agent, endpoint, '粘贴本页的访问密钥', v2)}</code></pre></details>
        <Button kind="secondary" icon={Copy} disabled={copying} onClick={() => void copyConfiguration()}>复制配置（含本地密钥）</Button>
      </>}
      <p className="form-note agent-reasoning-note">模型切换与历史兼容由客户端自动处理，日常使用无需调整这里的设置。</p>
    </div>
  </details>;
}
