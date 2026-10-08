import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { History, HISTORY_LIMIT } from '../core/history.mjs';
async function directory(t) {
  const base = resolve(process.env.TEMP || 'D:/CodexData/Temp'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'tierflow-history-test-'));
  t.after(async () => { if (resolve(dir).startsWith(`${base}${sep}tierflow-history-test-`)) await rm(dir, { recursive: true }); }); return dir;
}
test('concurrent records persist and survive restart without request bodies or keys', async t => {
  const dir = await directory(t); const history = await new History(dir).init();
  for (let i = 0; i < 50; i++) history.record({ id: String(i), time: Date.now(), model: 'glm', inputTokens: 10, cost: { source: 'estimated', currency: 'CNY', amount: .1 }, headers: { Authorization: 'private-key' }, messages: [{ content: 'private-prompt' }], response: 'private-answer' });
  await history.flush(); const reloaded = await new History(dir).init(); assert.equal(reloaded.entries.length, 50);
  const text = await readFile(join(dir, 'usage-history.json'), 'utf8'); assert.doesNotMatch(text, /private-key|private-prompt|private-answer/);
  assert.equal(reloaded.entries[0].cost.amount, .1);
  await reloaded.clear(); assert.equal((await new History(dir).init()).entries.length, 0);
});
test('retention is bounded by 90 days and 10000 records', async t => {
  const dir = await directory(t); const history = await new History(dir).init();
  history.entries = Array.from({ length: HISTORY_LIMIT + 1 }, (_, i) => ({ id: String(i), time: Date.now() - i }));
  history.entries.push({ id: 'old', time: Date.now() - 91 * 86400000 }); history.trim();
  assert.equal(history.entries.length, HISTORY_LIMIT); assert(!history.entries.some(e => e.id === 'old'));
});

test('retry diagnostics retain only bounded public fields and survive history reload', async t => {
  const dir = await directory(t), history = await new History(dir).init();
  const attempt = { model: 'glm', provider: 'test', code: 'model_not_activated', skipped: true, durationMs: 20, status: 400, messages: ['private-prompt'], headers: { Authorization: 'private-key' } };
  history.record({ id: 'retry', time: Date.now(), scoreSource: 'cache', modelMs: 100, upstreamWaitMs: 50, retryTrace: Array(20).fill(attempt) });
  await history.flush(); const saved = await new History(dir).init();
  assert.equal(saved.entries[0].retryTrace.length, 12); assert.equal(saved.entries[0].scoreSource, 'cache'); assert.equal(saved.entries[0].modelMs, 100);
  assert.deepEqual(Object.keys(saved.entries[0].retryTrace[0]), ['model', 'provider', 'code', 'skipped', 'durationMs', 'status']);
  assert.doesNotMatch(await readFile(join(dir, 'usage-history.json'), 'utf8'), /private-prompt|private-key/);
});
test('corrupt history is preserved; routing can continue with memory-only records', async t => {
  const dir = await directory(t); const file = join(dir, 'usage-history.json'); await writeFile(file, '{truncated');
  const history = await new History(dir).init(); assert.match(history.info().error, /原文件已保留/);
  history.record({ id: 'new', time: Date.now() }); await history.flush(); assert.equal(await readFile(file, 'utf8'), '{truncated');
  assert.equal(history.entries.length, 1); await history.clear(); assert.equal((await new History(dir).init()).entries.length, 0);
});
