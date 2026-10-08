import { createHash } from 'node:crypto';
import { scoreStep, scorePayload } from './router.mjs';

// Short-lived exact-request reuse. Neither message bodies nor keys are retained in
// the completed cache. New turns and tool results always produce a different key.
export class Scoring {
  constructor(fetcher = fetch, { now = Date.now, ttlMs = 60000, maxEntries = 128 } = {}) {
    this.fetcher = fetcher; this.now = now; this.ttlMs = ttlMs; this.maxEntries = maxEntries;
    this.completed = new Map(); this.pending = new Map();
  }
  clear() { for (const task of this.pending.values()) task.controller.abort(); this.pending.clear(); this.completed.clear(); }
  async get(config, body, signal) {
    signal.throwIfAborted();
    const payload = JSON.stringify(scorePayload(body));
    const key = createHash('sha256').update(JSON.stringify([config.settings.tiersenseUrl, config.secrets.tiersenseKey, config.secrets.gatewayKey, config.settings.scoreTimeoutMs, body.user ?? null])).update(payload).digest('hex');
    for (const [id, entry] of this.completed) if (entry.expires <= this.now()) this.completed.delete(id);
    const cached = this.completed.get(key);
    if (cached) return { scores: structuredClone(cached.scores), source: 'cache' };
    let task = this.pending.get(key); const source = task ? 'shared' : 'live';
    if (!task || task.controller.signal.aborted) {
      task = { controller: new AbortController(), waiters: 0 };
      this.pending.set(key, task);
      task.promise = scoreStep(config, body, task.controller.signal, this.fetcher, payload).then(scores => {
        task.controller.signal.throwIfAborted();
        if (!task.controller.signal.aborted && this.pending.get(key) === task) {
          this.completed.set(key, { scores, expires: this.now() + this.ttlMs });
          while (this.completed.size > this.maxEntries) this.completed.delete(this.completed.keys().next().value);
        }
        return scores;
      }).finally(() => { if (this.pending.get(key) === task) this.pending.delete(key); });
    }
    task.waiters++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, scores) => {
        if (settled) return; settled = true; signal.removeEventListener('abort', abort); task.waiters--;
        if (!task.waiters && this.pending.get(key) === task) { task.controller.abort(); this.pending.delete(key); }
        if (error) reject(error); else resolve({ scores: structuredClone(scores), source });
      };
      const abort = () => finish(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      task.promise.then(scores => finish(null, scores), error => finish(error));
      if (signal.aborted) abort();
    });
  }
}
