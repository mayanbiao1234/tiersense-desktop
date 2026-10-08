import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopPaths } from '../electron/platform.mjs';

test('Windows without a D drive uses the current user app data path, including Chinese names and spaces', () => {
  const base = 'C:\\Users\\测试 用户\\AppData\\Roaming';
  const probes = [];
  const result = desktopPaths('win32', base, undefined, name => { probes.push(name); return false; });
  assert.deepEqual(result, { dataDir: `${base}\\TierFlow`, tempDir: `${base}\\TierFlow\\tmp` });
  assert(probes.every(name => name.endsWith('config.json')));
});

test('existing encrypted legacy profiles are reused in place without moving encryption state', () => {
  const legacy = 'D:\\CodexData\\TierFlow';
  const result = desktopPaths('win32', 'C:\\Users\\Alice\\AppData\\Roaming', undefined, name => name === `${legacy}\\config.json`);
  assert.equal(result.dataDir, legacy); assert.equal(result.tempDir, `${legacy}\\tmp`);
});

test('an existing standard profile has priority over legacy discovery', () => {
  const base = 'E:\\User Data\\Roaming';
  const result = desktopPaths('win32', base, undefined, () => true);
  assert.equal(result.dataDir, `${base}\\TierFlow`);
});

test('an explicit data path controls both storage and temporary files and bypasses legacy probing', () => {
  for (const override of ['E:\\我的模型\\TierFlow Data', 'D:\\CodexData\\Temp\\isolated-profile', '\\\\server\\share\\TierFlow']) {
    const result = desktopPaths('win32', 'C:\\Users\\Alice\\AppData\\Roaming', override, () => { throw new Error('must not probe legacy data'); });
    assert.equal(result.dataDir, override); assert.equal(result.tempDir, `${override}\\tmp`);
  }
});

test('relative overrides cannot accidentally write into an installation or working directory', () => {
  for (const override of ['data', 'C:data', '\\data']) assert.throws(() => desktopPaths('win32', 'C:\\Users\\Test\\AppData\\Roaming', override), /绝对路径/);
  assert.throws(() => desktopPaths('darwin', '/Users/test/Library/Application Support', 'data'), /绝对路径/);
});
