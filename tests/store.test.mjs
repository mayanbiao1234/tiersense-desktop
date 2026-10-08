import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { Store } from '../core/store.mjs';
import { defaults, applyRouting } from '../core/config.mjs';

// Test-only codec. Production uses Electron safeStorage / Windows DPAPI.
const codec = { encrypt: value => Buffer.from(value).toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString() };
async function directory(t) {
  const base = resolve(process.env.TEMP || 'D:/CodexData/Temp'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'tierflow-test-'));
  t.after(async () => { const target = resolve(dir); if (target.startsWith(`${base}${sep}tierflow-test-`)) await rm(target, { recursive: true }); });
  return dir;
}
test('concurrent saves are serialized and private keys never enter the public snapshot', async t => {
  const dir = await directory(t); const store = await new Store(dir, codec).init();
  await Promise.all([store.update(c => { c.providers.push({ id: 'a' }); c.secrets.providers.a = 'secret-a'; }), store.update(c => { c.providers.push({ id: 'b' }); c.secrets.providers.b = 'secret-b'; })]);
  const reloaded = await new Store(dir, codec).init(); assert.equal(reloaded.config.providers.length, 2);
  assert.equal(reloaded.config.secrets.providers.a, 'secret-a');
  assert.equal(JSON.stringify(reloaded.public()).includes('secret-a'), false);
  const file = await readFile(join(dir, 'config.json'), 'utf8'); assert.equal(file.includes('secret-a'), false); assert.equal(file.includes('gatewayKey'), false);
});
test('corrupt config fails visibly and is preserved instead of overwriting user keys', async t => {
  const dir = await directory(t); const file = join(dir, 'config.json'); await writeFile(file, '{invalid');
  await assert.rejects(new Store(dir, codec).init(), /原文件已保留/); assert.equal(await readFile(file, 'utf8'), '{invalid');
});

test('v1 disk config migrates without rewriting keys or losing saved models', async t => {
  const dir = await directory(t); const config = defaults();
  const { secrets, routing, ...saved } = config;
  const encryptedSecrets = codec.encrypt(JSON.stringify(secrets));
  const legacy = JSON.stringify({ ...saved, version: 1, settings: { ...saved.settings, lowerThreshold: 4, upperThreshold: 8 }, models: [{ id: 'saved-model', tier: 'balanced' }], encryptedSecrets });
  const path = join(dir, 'config.json'); await writeFile(path, legacy);
  const store = await new Store(dir, codec).init();
  assert.deepEqual(store.config.routing.tiers.map(t => t.minScore), [0, 4, 8]);
  assert.equal(await readFile(path, 'utf8'), legacy);
  await store.update(c => { c.onboardingCompleted = true; });
  assert.equal(await readFile(join(dir, 'config.v1.before-0.3.json'), 'utf8'), legacy);
  const reload = await new Store(dir, codec).init();
  assert.equal(reload.config.version, 3); assert.deepEqual(reload.config.secrets, secrets);
  assert.equal(reload.config.models[0].id, 'saved-model');
});

test('v2 migration backs up the original encrypted file once before the first save', async t => {
  const dir = await directory(t); const { secrets, ...saved } = defaults();
  const legacy = JSON.stringify({ ...saved, version: 2, encryptedSecrets: codec.encrypt(JSON.stringify(secrets)) });
  await writeFile(join(dir, 'config.json'), legacy);
  const store = await new Store(dir, codec).init();
  await store.update(c => { c.onboardingCompleted = true; });
  assert.equal(await readFile(join(dir, 'config.v2.before-0.3.json'), 'utf8'), legacy);
  await store.update(c => { c.onboardingCompleted = false; });
  assert.equal(await readFile(join(dir, 'config.v2.before-0.3.json'), 'utf8'), legacy);
  assert.equal(store.config.version, 3);
});

test('failed routing save leaves all model assignments and disk config unchanged', async t => {
  const dir = await directory(t); const store = await new Store(dir, codec).init();
  await store.update(c => { c.models = [{ id: 'm', tier: 'economy' }]; });
  const before = await readFile(join(dir, 'config.json'), 'utf8');
  await assert.rejects(store.update(c => applyRouting(c, { routing: { tiers: [{ id: 'only', name: '唯一', minScore: 0 }], rules: [] }, reassignments: { economy: 'only' }, settings: { failureMode: 'fallback', fallbackModelId: 'missing' } })), /兜底模型/);
  assert.equal(store.config.models[0].tier, 'economy');
  assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), before);
});
