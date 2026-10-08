// OpenAI Chat Completions endpoints. Presets never replace saved user URLs.
export const PROVIDER_PRESETS = [
  { id: 'tierflow', name: 'TierFlow', detail: '清枢智汇', baseUrl: 'https://tierflow.cn/v1', logo: 'tierflow.svg', hint: '清枢智汇官方渠道。使用 TierFlow 平台的 API Key，保存后选择该 Key 可调用的模型。' },
  { id: 'deepseek', name: 'DeepSeek', detail: '深度求索', baseUrl: 'https://api.deepseek.com', logo: 'deepseek-color.svg', hint: '使用 DeepSeek 开放平台的 API Key。' },
  { id: 'zhipu', name: '智谱 AI', detail: 'GLM · BigModel', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', logo: 'zhipu-color.svg', hint: '预填常规 API 地址；GLM Coding Plan 使用专用地址，请按套餐说明修改。' },
  { id: 'bailian', name: '阿里云百炼', detail: '通义千问 · Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', logo: 'qwen-color.svg', hint: '预填中国内地（北京）地址，API Key 须属于同一地域；其他地域或套餐请修改地址。' },
  { id: 'ark', name: '火山方舟', detail: '豆包 · Doubao', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', logo: 'volcengine-color.svg', hint: '预填北京地域常规 API 地址；模型标识请填写方舟控制台提供的模型 ID 或推理接入点 ID。' },
  { id: 'moonshot', name: 'Kimi', detail: '月之暗面 · Moonshot', baseUrl: 'https://api.moonshot.cn/v1', logo: 'kimi-color.svg', hint: '使用 Kimi 开放平台的 API Key；Kimi Code 等套餐请按对应说明配置。' },
  { id: 'minimax', name: 'MiniMax', detail: '稀宇科技', baseUrl: 'https://api.minimax.cn/v1', logo: 'minimax-color.svg', hint: '预填国内站 OpenAI 兼容地址，使用对应平台的 API Key。' },
  { id: 'hunyuan', name: '腾讯混元', detail: 'Hunyuan', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', logo: 'hunyuan-color.svg', hint: '使用混元 OpenAI 兼容接口的 API Key；腾讯云 SecretId / SecretKey 不能直接使用。' },
  { id: 'siliconflow', name: '硅基流动', detail: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', logo: 'siliconcloud-color.svg', hint: '预填国内站地址；添加模型时请保留完整模型标识（包括组织名前缀）。' },
  { id: 'custom', name: '自定义渠道', detail: 'OpenAI 兼容', baseUrl: '', logo: '', hint: '填写兼容 OpenAI Chat Completions 的基础地址，不包含 /chat/completions。' },
];

export function getProviderPreset(id) {
  return PROVIDER_PRESETS.find(p => p.id === id) ?? PROVIDER_PRESETS.at(-1);
}

// A saved secret must not silently follow a provider to a different server.
export function providerOriginChanged(previous, next) {
  if (!previous) return false;
  try { return new URL(previous).origin !== new URL(next).origin; }
  catch { return true; }
}
