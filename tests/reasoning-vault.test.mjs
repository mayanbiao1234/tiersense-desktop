import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { ReasoningVault } from '../core/reasoning-vault.mjs';
import { ReasoningCache } from '../core/reasoning.mjs';

const user = { role: 'user', content: 'private prompt' };
const assistant = { role: 'assistant', content: 'private answer', reasoning_content: 'private original reasoning\n  原文', tool_calls: [{ id: 'call-a', type: 'function', function: { name: 'Read', arguments: '{"private-file":"secret"}' } }] };
const remember = cache => cache.remember('scope', [user], [{ message: assistant, finish_reason: 'tool_calls' }]);
const restore = cache => cache.restore('scope', [user, { role: 'assistant', content: null, tool_calls: assistant.tool_calls }])[1].reasoning_content;
function codec() {
  const key = randomBytes(32);
  return {
    encrypt: text => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
    decrypt: bytes => { const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'); },
  };
}
async function directory(t) {
  const root = resolve(tmpdir());
  const dir = await mkdtemp(join(root, 'tierflow-vault-'));
  t.after(async () => { const child = relative(root, resolve(dir)); assert(child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)); await rm(dir, { recursive: true, force: true }); });
  return dir;
}

test('opt-in encrypted restart restores original split-tool reasoning without persisting prompts, answers or tool arguments', async t => {
  const dir = await directory(t), encryption = codec(), original = new ReasoningCache();
  const vault = await new ReasoningVault(dir, original, encryption).init(true); remember(original); await vault.flush();
  const cipher = await readFile(vault.file); assert(!cipher.includes(Buffer.from(assistant.reasoning_content)));
  const plain = encryption.decrypt(cipher);
  for (const value of [user.content, assistant.content, 'private-file', 'secret']) assert(!plain.includes(value));
  const restored = new ReasoningCache(), reopened = await new ReasoningVault(dir, restored, encryption).init(true);
  assert.equal(restore(restored), assistant.reasoning_content); assert.equal(reopened.error, '');
  await reopened.clear(); assert.equal(restored.entries.size, 0); assert.deepEqual(await readdir(dir), []);
});

test('default is memory-only; enabling saves and disabling removes disk files while preserving the active conversation', async t => {
  const dir = await directory(t), cache = new ReasoningCache();
  const vault = await new ReasoningVault(dir, cache, codec()).init(false); remember(cache); await vault.flush();
  assert.deepEqual(await readdir(dir), []); assert.equal(restore(cache), assistant.reasoning_content);
  await vault.setEnabled(true); assert.deepEqual(await readdir(dir), ['reasoning-cache.enc']);
  await vault.setEnabled(false); assert.deepEqual(await readdir(dir), []); assert.equal(restore(cache), assistant.reasoning_content);
});

test('corrupt or wrong-account encrypted recovery is preserved, reported and never overwrites new in-memory reasoning', async t => {
  const dir = await directory(t), encryption = codec(), cache = new ReasoningCache();
  const vault = await new ReasoningVault(dir, cache, encryption).init(true); remember(cache); await vault.flush();
  const cipher = await readFile(vault.file);
  const restored = new ReasoningCache(), other = await new ReasoningVault(dir, restored, codec()).init(true);
  assert(other.blocked); assert(other.error); assert.equal(restored.entries.size, 0);
  remember(restored); await other.flush(); assert.deepEqual(await readFile(vault.file), cipher);
  assert.equal(restore(restored), assistant.reasoning_content);
  await other.clear(); remember(restored); await other.flush(); assert.equal(other.error, '');
  await writeFile(other.file, 'corrupt');
  const corrupt = await new ReasoningVault(dir, new ReasoningCache(), encryption).init(true);
  assert(corrupt.blocked); assert.equal(await readFile(other.file, 'utf8'), 'corrupt');
});

test('clearing or disabling a queued encrypted save cannot recreate the file', async t => {
  const dir = await directory(t), cache = new ReasoningCache(), vault = await new ReasoningVault(dir, cache, codec()).init(true);
  remember(cache); const saved = vault.flush(); await vault.clear(); await saved;
  assert.deepEqual(await readdir(dir), []); assert.equal(cache.entries.size, 0);
  remember(cache); const resaved = vault.flush(); await vault.setEnabled(false); await resaved;
  assert.deepEqual(await readdir(dir), []); assert.equal(restore(cache), assistant.reasoning_content);
});

test('long sessions retain over 256 steps past one hour, expire at 24 hours, and expired entries are removed on reopening', async t => {
  const dir = await directory(t), encryption = codec(); let now = 1;
  const cache = new ReasoningCache({ now: () => now }), vault = await new ReasoningVault(dir, cache, encryption).init(true);
  remember(cache);
  for (let i = 0; i < 300; i++) cache.remember('scope', [{ ...user, content: `task-${i}` }], [{ message: { ...assistant, tool_calls: undefined }, finish_reason: 'stop' }]);
  now += 3600001; assert.equal(restore(cache), assistant.reasoning_content); assert.equal(cache.entries.size, 301);
  await vault.flush(); now = 86400002;
  const after = new ReasoningCache({ now: () => now }), reopened = await new ReasoningVault(dir, after, encryption).init(true);
  assert.equal(after.entries.size, 0); assert.equal(restore(after), undefined);
  assert.equal(JSON.parse(encryption.decrypt(await readFile(reopened.file))).entries.length, 0);
});

test('encrypted snapshot validation rejects malformed, oversized and duplicate entries atomically', () => {
  let now = 100; const cache = new ReasoningCache({ now: () => now }); remember(cache);
  const snapshot = cache.snapshot();
  for (const mutate of [s => { s.version = 9; }, s => { s.entries.push(s.entries[0]); }, s => { s.entries[0][1].expires = Infinity; }, s => { s.entries[0][1].fragmentKeys = ['not-a-hash']; }, s => { s.entries[0][1].reasoning = 'x'.repeat(2 * 1024 * 1024); }]) {
    const bad = structuredClone(snapshot); mutate(bad); assert.throws(() => cache.hydrate(bad)); assert.equal(restore(cache), assistant.reasoning_content);
  }
});
