// A model list is provider data, never instructions. Keep credentials in main.
export function parseModels(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : null;
  if (!rows) throw new Error('渠道返回的内容不是模型列表，可改为手动填写模型标识');
  if (rows.length > 20000) throw new Error('渠道模型列表过大，请手动添加需要的模型');
  const unique = new Map();
  for (const row of rows) {
    const id = typeof row === 'string' ? row.trim() : typeof row?.id === 'string' ? row.id.trim() : '';
    if (!id || id.length > 120 || /[\x00-\x1f\x7f]/.test(id) || unique.has(id)) continue;
    // Standard /models does not certify tools or vision capabilities.
    unique.set(id, { id });
  }
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function discoverModels(config, id, fetcher = fetch) {
  const provider = config.providers.find(p => p.id === id);
  const key = config.secrets.providers[id];
  if (!provider || !key) throw new Error('请先保存渠道和 API Key');
  let response;
  try {
    response = await fetcher(`${provider.baseUrl}/models`, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
  } catch { throw new Error('获取模型列表失败或超时，请检查地址与网络；也可手动添加'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(response.status === 404 || response.status === 405 ? '该渠道未提供模型列表接口，可手动填写模型标识'
      : response.status === 401 || response.status === 403 ? '渠道授权失败，请检查 API Key 与模型列表权限' : `渠道暂时无法提供模型列表（HTTP ${response.status}），可重试或手动添加`);
  }
  let text = ''; let length = 0;
  try {
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 4 * 1024 * 1024) throw new Error('too_large');
      text += decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
  } catch { throw new Error('模型列表接收失败或内容过大，可重试或手动添加'); }
  let payload; try { payload = JSON.parse(text); } catch { throw new Error('渠道没有返回有效的 JSON 模型列表，可手动添加'); }
  return { models: parseModels(payload) };
}
