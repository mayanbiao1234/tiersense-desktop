import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const HISTORY_LIMIT = 10000;
export const HISTORY_DAYS = 90;
// A bounded numeric journal. Never persist request/response bodies, headers or secrets.
const fields = ['id', 'time', 'status', 'model', 'modelId', 'provider', 'providerId', 'tier', 'tierName', 'score', 'scoreMs', 'scoreSource', 'modelMs', 'upstreamWaitMs', 'retryTrace', 'durationMs', 'inputTokens', 'outputTokens', 'totalTokens', 'cachedTokens', 'reasoningTokens', 'fallback', 'attempts', 'error', 'code', 'featureScores', 'route', 'cost', 'pricing'];
function safeEntry(entry) {
  const clean = Object.fromEntries(fields.filter(key => key in entry).map(key => [key, entry[key]]));
  if ('retryTrace' in clean) clean.retryTrace = Array.isArray(clean.retryTrace) ? clean.retryTrace.filter(item => item && typeof item === 'object').slice(0, 12).map(item => ({
    model: typeof item.model === 'string' ? item.model.slice(0, 200) : '', provider: typeof item.provider === 'string' ? item.provider.slice(0, 100) : '',
    code: typeof item.code === 'string' ? item.code.slice(0, 80) : '', skipped: item.skipped === true,
    durationMs: Number.isFinite(item.durationMs) && item.durationMs >= 0 ? item.durationMs : 0,
    status: Number.isInteger(item.status) && item.status >= 100 && item.status <= 599 ? item.status : null,
  })) : [];
  return clean;
}
export class History {
  constructor(directory, onChange = () => {}) { this.file = join(directory, 'usage-history.json'); this.directory = directory; this.entries = []; this.queue = Promise.resolve(); this.error = ''; this.blocked = false; this.onChange = onChange; this.revision = 0; }
  trim(now = Date.now()) { this.entries = this.entries.filter(e => e.time >= now - HISTORY_DAYS * 86400000).slice(0, HISTORY_LIMIT); }
  async init() {
    await mkdir(this.directory, { recursive: true });
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.entries) || saved.entries.some(e => !e || typeof e.id !== 'string' || !Number.isFinite(e.time))) throw new Error('invalid history');
      this.entries = saved.entries.map(safeEntry).sort((a, b) => b.time - a.time); this.trim();
    } catch (error) { if (error.code !== 'ENOENT') { this.blocked = true; this.error = '历史记录无法读取，原文件已保留。新记录暂存内存；清空记录后可重新保存。'; } }
    return this;
  }
  record(entry) { this.entries.unshift(structuredClone(safeEntry(entry))); this.trim(); this.revision++; this.schedule(); }
  schedule() {
    if (this.blocked || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.persist(); }, 250); this.timer.unref?.();
  }
  persist() {
    if (this.blocked) return this.queue;
    const serialized = JSON.stringify({ version: 1, entries: this.entries });
    this.queue = this.queue.then(async () => {
      await writeFile(`${this.file}.tmp`, serialized, { mode: 0o600 }); await rename(`${this.file}.tmp`, this.file);
      if (this.error) { this.error = ''; this.onChange(); }
    }).catch(() => { this.error = '历史记录保存失败，当前数据暂存内存。请检查数据目录权限和剩余空间。'; this.onChange(); });
    return this.queue;
  }
  async flush() { if (this.timer) { clearTimeout(this.timer); this.timer = null; await this.persist(); } await this.queue; }
  async clear() {
    await this.flush(); this.entries = []; this.blocked = false; this.error = ''; this.revision++;
    await this.persist(); if (this.error) throw new Error(this.error);
  }
  info() { this.trim(); return { count: this.entries.length, limit: HISTORY_LIMIT, days: HISTORY_DAYS, revision: this.revision, oldest: this.entries.at(-1)?.time ?? null, error: this.error }; }
}
