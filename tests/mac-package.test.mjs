import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import plist from 'plist';
import { desktopPaths, windowChrome } from '../electron/platform.mjs';
import { macBundlePath, macBundlePlist, assertMacArchitecture, runtimeEntryAllowed } from '../scripts/mac-archive.mjs';

test('Mac paths and window chrome use native conventions', () => {
  const base = '/Users/test/Library/Application Support';
  assert.equal(desktopPaths('darwin', base).dataDir, path.posix.join(base, 'TierFlow'));
  assert.equal(desktopPaths('darwin', base, '/custom-data').tempDir, '/custom-data/tmp');
  assert.equal(windowChrome('darwin').frame, true);
  assert.equal(windowChrome('win32').frame, false);
});

test('Mac bundle rename keeps helper executable names and identifiers aligned without changing framework names', () => {
  const main = 'Electron.app/Contents/Info.plist';
  const helper = 'Electron.app/Contents/Frameworks/Electron Helper (Renderer).app/Contents/Info.plist';
  const source = Buffer.from(plist.build({ CFBundleName: 'Electron', LSMinimumSystemVersion: '12.0' }));
  const info = plist.parse(macBundlePlist(main, source, '0.2.7').toString());
  assert.equal(info.CFBundleName, 'TierFlow'); assert.equal(info.LSMinimumSystemVersion, '12.0');
  const h = plist.parse(macBundlePlist(helper, source, '0.2.7').toString());
  assert.equal(h.CFBundleExecutable, 'TierFlow Helper (Renderer)');
  assert.equal(h.CFBundleIdentifier, 'cn.tierflow.desktop.helper.Renderer');
  assert.equal(macBundlePath(helper.replace('Info.plist', 'MacOS/Electron Helper (Renderer)')), 'TierFlow.app/Contents/Frameworks/TierFlow Helper (Renderer).app/Contents/MacOS/TierFlow Helper (Renderer)');
  assert.equal(macBundlePath('Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework'), 'TierFlow.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework');
  assert.equal(runtimeEntryAllowed('Electron.app/Contents/_CodeSignature/CodeResources'), false);
  assert.equal(runtimeEntryAllowed('Electron.app/Contents/Resources/default_app.asar'), false);
});

test('a wrong-architecture runtime cannot be published as the other Mac build', () => {
  const bytes = Buffer.alloc(32); bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(0x0100000c, 4);
  assert.doesNotThrow(() => assertMacArchitecture(bytes, 'arm64'));
  assert.throws(() => assertMacArchitecture(bytes, 'x64'), /Invalid x64/);
});
