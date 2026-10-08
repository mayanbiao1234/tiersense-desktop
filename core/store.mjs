import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaults, publicConfig, migrateConfig } from './config.mjs';

export class Store {
  constructor(directory, encryption) { this.directory = directory; this.encryption = encryption; this.config = defaults(); this.queue = Promise.resolve(); }
  async init() {
    await mkdir(this.directory, { recursive: true });
    try {
      const original = await readFile(join(this.directory, 'config.json'), 'utf8');
      const saved = JSON.parse(original);
      if (!Array.isArray(saved.providers) || !Array.isArray(saved.models) || typeof saved.encryptedSecrets !== 'string') throw new Error('配置格式不受支持');
      this.config = migrateConfig({ ...saved, secrets: JSON.parse(this.encryption.decrypt(saved.encryptedSecrets)) });
      delete this.config.encryptedSecrets;
      if (saved.version < 3) this.legacySource = { version: saved.version, original };
    } catch (error) { if (error.code !== 'ENOENT') throw new Error(`无法读取本地配置，原文件已保留：${error.message}`); await this.persist(this.config); }
    return this;
  }
  snapshot() { return structuredClone(this.config); }
  public() { return publicConfig(this.config); }
  async persist(config) {
    if (this.legacySource) {
      const { version, original } = this.legacySource;
      try { await writeFile(join(this.directory, `config.v${version}.before-0.3.json`), original, { mode: 0o600, flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      this.legacySource = null;
    }
    const { secrets, ...rest } = config;
    const serialized = JSON.stringify({ ...rest, encryptedSecrets: this.encryption.encrypt(JSON.stringify(secrets)) }, null, 2);
    const destination = join(this.directory, 'config.json');
    await writeFile(`${destination}.tmp`, serialized, { mode: 0o600 });
    await rename(`${destination}.tmp`, destination);
  }
  update(change) {
    const operation = this.queue.then(async () => {
      const config = this.snapshot();
      await change(config);
      await this.persist(config);
      this.config = config;
      return this.public();
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
