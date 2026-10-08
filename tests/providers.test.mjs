import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { defaults, applyProvider, providerInput, publicConfig, migrateConfig } from '../core/config.mjs';
import { PROVIDER_PRESETS } from '../core/providers.mjs';

test('all vendor presets survive validation, migration, and public snapshots; local logos are bundled', async () => {
  const config = defaults();
  for (const preset of PROVIDER_PRESETS.filter(p => p.id !== 'custom')) {
    applyProvider(config, { preset: preset.id, name: preset.name, baseUrl: preset.baseUrl, apiKey: `test-${preset.id}` });
    const logo = new URL(`../public/providers/${preset.logo}`, import.meta.url);
    await access(logo);
    const svg = await readFile(logo, 'utf8');
    assert.match(svg, /<svg[\s>]/);
    assert.doesNotMatch(svg, /<script|<foreignObject|\bonload\s*=|(?:href|src)=["'](?:https?:|\/\/)/i);
  }
  const snapshot = publicConfig(migrateConfig(structuredClone(config)));
  assert.deepEqual(snapshot.providers.map(p => p.preset), PROVIDER_PRESETS.filter(p => p.id !== 'custom').map(p => p.id));
  assert.equal(snapshot.providers.every(p => p.hasKey), true);
  assert.equal(JSON.stringify(snapshot).includes('test-'), false);
});

test('editing a preset preserves custom URLs, provider IDs, keys, and model references', () => {
  const config = defaults();
  applyProvider(config, { name: '我的百炼', preset: 'bailian', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/', apiKey: 'my-key' });
  const provider = config.providers[0];
  config.models = [{ id: 'model-a', providerId: provider.id }];
  applyProvider(config, { ...provider, name: '百炼新名称', enabled: false });
  assert.equal(config.providers[0].baseUrl, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
  assert.equal(config.providers[0].name, '百炼新名称');
  assert.equal(config.providers[0].enabled, false);
  assert.equal(config.models[0].providerId, config.providers[0].id);
  assert.equal(config.secrets.providers[provider.id], 'my-key');
  applyProvider(config, { ...config.providers[0], baseUrl: `${provider.baseUrl}/alternative` });
  assert.equal(config.secrets.providers[provider.id], 'my-key');
});

test('switching to another origin requires a replacement key without mutating existing config', () => {
  const config = defaults();
  applyProvider(config, { name: 'DeepSeek', preset: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'old-key' });
  const provider = config.providers[0];
  const before = structuredClone(config);
  for (const baseUrl of ['https://api.moonshot.cn/v1', 'https://api.deepseek.com:8443/v1']) {
    assert.throws(() => applyProvider(config, { ...provider, preset: 'moonshot', baseUrl, apiKey: '  ' }), /服务地址已变更/);
    assert.deepEqual(config, before);
  }
  applyProvider(config, { ...provider, preset: 'moonshot', name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', apiKey: ' new-key ' });
  assert.equal(config.providers[0].preset, 'moonshot');
  assert.equal(config.secrets.providers[provider.id], 'new-key');
});

test('custom providers still work and invalid addresses or missing keys cannot be saved', () => {
  const config = defaults();
  const input = { name: '自有服务', preset: 'custom', baseUrl: 'http://127.0.0.1:9010/v1' };
  assert.throws(() => applyProvider(config, input), /API Key/);
  assert.equal(config.providers.length, 0);
  applyProvider(config, { ...input, apiKey: 'local-key' });
  assert.equal(config.providers[0].preset, 'custom');
  assert.equal(providerInput({ ...input, preset: 'unknown-vendor' }).preset, 'custom');
  assert.throws(() => applyProvider(config, { ...input, apiKey: 'a', baseUrl: 'http://example.com/v1' }), /HTTPS/);
  assert.throws(() => applyProvider(config, { ...input, apiKey: 'a', baseUrl: 'https://user:password@example.com' }), /用户名/);
});
