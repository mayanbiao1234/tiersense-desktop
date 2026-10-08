import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import plist from 'plist';
import unzipper from 'unzipper';
import { extractFile, listPackage } from '@electron/asar';
import { assertMacArchitecture, macBundlePath, runtimeEntryAllowed } from './mac-archive.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'release', pkg.version, 'mac-test');
const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
const qaDir = path.join(root, 'docs', `qa-${pkg.version}`); await mkdir(qaDir, { recursive: true });
const reports = [];
for (const artifact of manifest.packages) {
  const file = path.join(output, artifact.file);
  const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes);
  assert.equal(hash.digest('hex'), artifact.sha256);
  const archive = await unzipper.Open.file(file);
  const byPath = new Map(archive.files.map(f => [f.path.replace(/\/$/, ''), f]));
  assert.equal(archive.files.length, byPath.size, 'Duplicate ZIP paths');
  for (const name of byPath.keys()) assert(!name.startsWith('/') && !name.includes('..') && !name.includes('\\'), name);
  const links = new Map();
  for (const [name, entry] of byPath) {
    if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) links.set(name, (await entry.buffer()).toString());
  }
  function resolveLink(name) {
    for (let depth = 0; depth < 40; depth++) {
      const parts = name.split('/'); let changed = false;
      for (let i = 1; i <= parts.length; i++) {
        const prefix = parts.slice(0, i).join('/'); const target = links.get(prefix);
        if (target === undefined) continue;
        name = path.posix.normalize(path.posix.join(path.posix.dirname(prefix), target, ...parts.slice(i)));
        assert(name.startsWith('TierFlow.app/'), 'Link escapes app'); changed = true; break;
      }
      if (!changed) return name;
    }
    throw new Error(`Cyclic framework link: ${name}`);
  }
  for (const name of links.keys()) assert(byPath.has(resolveLink(name)), `Broken framework link: ${name}`);
  assert(links.size > 0, 'Framework symlinks must survive Windows packaging');
  const info = plist.parse((await byPath.get('TierFlow.app/Contents/Info.plist').buffer()).toString());
  assert.equal(info.CFBundleIdentifier, 'cn.tierflow.desktop'); assert.equal(info.CFBundleVersion, pkg.version);
  const appExecutable = byPath.get(`TierFlow.app/Contents/MacOS/${info.CFBundleExecutable}`);
  assertMacArchitecture(await appExecutable.buffer(), artifact.arch);
  assert((appExecutable.externalFileAttributes >>> 16) & 0o111, 'Main executable lost execute permission');
  let helpers = 0;
  for (const [name, entry] of byPath) {
    if (!/\/TierFlow Helper[^/]*\.app\/Contents\/Info.plist$/.test(name)) continue;
    const helper = plist.parse((await entry.buffer()).toString());
    const executable = byPath.get(name.replace('Info.plist', `MacOS/${helper.CFBundleExecutable}`));
    assert(executable, 'Helper plist/executable mismatch'); assertMacArchitecture(await executable.buffer(), artifact.arch);
    assert((executable.externalFileAttributes >>> 16) & 0o111, 'Helper lost execute permission'); helpers++;
  }
  assert(helpers >= 4);
  const installer = byPath.get('Install-TierFlow.command');
  assert((installer.externalFileAttributes >>> 16) & 0o111);
  assert(!(await installer.buffer()).includes('\r'), 'Mac installer must use LF line endings');
  assert(!(await installer.buffer()).includes('xattr -'), 'Installer must not remove quarantine');
  const verifyDir = process.platform === 'win32' ? 'D:/CodexData/Temp/tierflow-mac' : path.join(root, '.build-temp');
  await mkdir(verifyDir, { recursive: true });
  const asarFile = path.join(verifyDir, `verify-${pkg.version}-${artifact.arch}.asar`);
  await writeFile(asarFile, await byPath.get('TierFlow.app/Contents/Resources/app.asar').buffer());
  const bundled = JSON.parse(extractFile(asarFile, 'package.json').toString()); assert.equal(bundled.version, pkg.version);
  const contents = listPackage(asarFile).map(name => name.replaceAll('\\', '/'));
  for (const required of ['/electron/main.mjs', '/electron/platform.mjs', '/electron/desktop.mjs', '/electron/preload.cjs', '/dist/index.html', '/dist/trayTemplate.png', '/dist/trayTemplate@2x.png']) assert(contents.includes(required), required);
  assert(!contents.some(n => /config\.json|\.env|node_modules|\.exe$/i.test(n)), 'Unexpected private or platform-specific data');
  const source = await unzipper.Open.file(path.join(process.platform === 'win32' ? 'D:/CodexData/Cache/electron' : process.env.electron_config_cache || path.join(root, '.build-cache/electron'), `electron-v${manifest.electron}-darwin-${artifact.arch}.zip`));
  // Every retained runtime entry keeps its original Unix permissions and link targets.
  for (const entry of source.files.filter(e => runtimeEntryAllowed(e.path))) {
    const built = byPath.get(macBundlePath(entry.path).replace(/\/$/, '')); assert(built, entry.path);
    assert.equal(built.externalFileAttributes >>> 16, entry.externalFileAttributes >>> 16, entry.path);
    if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) assert.deepEqual(await built.buffer(), await entry.buffer());
  }
  reports.push({ file: artifact.file, arch: artifact.arch, sha256: artifact.sha256, files: byPath.size, symlinks: links.size, helpers,
    minimumOS: info.LSMinimumSystemVersion, archiveVerified: true, nativeTested: false, notarized: false });
  console.log(`Verified ${artifact.arch}: ${byPath.size} entries, ${links.size} symlinks, ${helpers} helpers`);
}
await writeFile(path.join(qaDir, 'mac-archive-checks.json'), JSON.stringify(reports, null, 2) + '\n');
