import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

// Opt-in encrypted recovery on this OS account. No request bodies, response text,
// API keys or plaintext files are written. A corrupt vault never blocks routing.
export class ReasoningVault {
  constructor(directory, cache, encryption, changed = () => {}) {
    this.directory = directory; this.file = join(directory, 'reasoning-cache.enc');
    this.cache = cache; this.encryption = encryption; this.changed = changed;
    this.enabled = false; this.error = ''; this.blocked = false; this.queue = Promise.resolve(); this.epoch = 0;
    cache.onChange = () => this.schedule();
  }
  async init(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) { await this.clear(); return this; }
    try {
      if ((await stat(this.file)).size > 96 * 1024 * 1024) throw new Error('oversized');
      const plain = this.encryption.decrypt(await readFile(this.file));
      if (Buffer.byteLength(plain) > 64 * 1024 * 1024) throw new Error('oversized');
      this.cache.hydrate(JSON.parse(plain));
      await this.flush(); // Remove expired records from the encrypted snapshot too.
    } catch (error) {
      if (error.code !== 'ENOENT') { this.blocked = true; this.error = '本机对话恢复缓存无法读取，原文件已保留；新的对话仍可正常使用。可清空兼容缓存后重新保存。'; }
    }
    this.changed(); return this;
  }
  schedule() {
    if (!this.enabled || this.blocked || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 500); this.timer.unref?.();
  }
  async setEnabled(enabled) {
    this.enabled = !!enabled; this.epoch++;
    if (!this.enabled) await this.clear({ memory: false }); else await this.flush();
    this.changed();
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.enabled || this.blocked) return this.queue;
    const epoch = this.epoch;
    this.queue = this.queue.then(async () => {
      if (!this.enabled || this.blocked || this.epoch !== epoch) return;
      const plain = JSON.stringify(this.cache.snapshot());
      if (Buffer.byteLength(plain) > 64 * 1024 * 1024) throw new Error('oversized');
      const cipher = this.encryption.encrypt(plain);
      await mkdir(this.directory, { recursive: true });
      await writeFile(`${this.file}.tmp`, cipher, { mode: 0o600 });
      if (this.enabled && this.epoch === epoch) await rename(`${this.file}.tmp`, this.file);
      else await rm(`${this.file}.tmp`, { force: true });
      if (this.error) { this.error = ''; this.changed(); }
    }).catch(() => { this.error = '对话恢复缓存暂时无法加密保存，本次运行仍使用内存缓存。请检查本机存储空间和权限。'; this.changed(); });
    return this.queue;
  }
  async clear({ memory = true } = {}) {
    this.epoch++; clearTimeout(this.timer); this.timer = null; if (memory) this.cache.clear(false);
    this.queue = this.queue.then(async () => {
      await rm(this.file, { force: true }); await rm(`${this.file}.tmp`, { force: true });
      this.blocked = false; this.error = '';
    }).catch(() => { this.error = '兼容缓存文件清理失败，请检查数据目录权限后重试。'; });
    await this.queue; this.changed();
  }
}
