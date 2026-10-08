// Cross-host test kit: preserve Unix modes and symlinks directly in ZIP, without
// extracting a Mac framework onto NTFS. The included Mac installer re-signs it.
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import unzipper from 'unzipper';
import yazl from 'yazl';
import { createPackage } from '@electron/asar';
import { assertMacArchitecture, macBundlePath, macBundlePlist, runtimeEntryAllowed } from './mac-archive.mjs';
import { downloadRuntime } from './download-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = pkg.devDependencies.electron;
const checksums = JSON.parse(await readFile(path.join(root, 'node_modules/electron/checksums.json'), 'utf8'));
const cache = process.platform === 'win32' ? 'D:/CodexData/Cache/electron' : (process.env.electron_config_cache || path.join(root, '.build-cache/electron'));
const temp = process.platform === 'win32' ? 'D:/CodexData/Temp' : (process.env.TMPDIR || os.tmpdir());
process.env.TEMP = process.env.TMP = process.env.TMPDIR = temp;
const output = path.join(root, 'release', pkg.version, 'mac-test');
await Promise.all([mkdir(cache, { recursive: true }), mkdir(temp, { recursive: true }), mkdir(output, { recursive: true })]);
console.log(`Mac test build: cache=${cache}; temp=${temp}; output=${output}`);

async function sha256(file) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function runtime(arch) {
  const name = `electron-v${version}-darwin-${arch}.zip`;
  const file = path.join(cache, name); const expected = checksums[name];
  if (!expected) throw new Error(`No pinned official checksum for ${name}`);
  if (!(await stat(file).catch(() => null))) {
    const partial = `${file}.${process.pid}.partial`;
    const mirror = process.env.TIERFLOW_ELECTRON_MIRROR;
    const url = mirror ? `${mirror.replace(/\/$/, '')}/${version}/${name}` : `https://github.com/electron/electron/releases/download/v${version}/${name}`;
    await downloadRuntime(url, partial, arch);
    if (await sha256(partial) !== expected) throw new Error(`Runtime checksum mismatch: ${name}`);
    await rename(partial, file);
  }
  if (await sha256(file) !== expected) throw new Error(`Cached runtime checksum mismatch: ${name}`);
  console.log(`Verified official Electron ${arch} runtime`); return file;
}

const work = await mkdtemp(path.join(temp, 'tierflow-mac-'));
const stage = path.join(work, 'app'); await mkdir(stage);
for (const dir of ['dist', 'electron', 'core']) await cp(path.join(root, dir), path.join(stage, dir), { recursive: true });
await writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: pkg.name, productName: 'TierFlow', version: pkg.version, type: 'module', main: pkg.main }));
const asar = path.join(work, 'app.asar'); await createPackage(stage, asar);
const runtimes = await Promise.all(['arm64', 'x64'].map(runtime));
const manifests = [];
for (const [index, arch] of ['arm64', 'x64'].entries()) {
  const source = await unzipper.Open.file(runtimes[index]);
  const executable = source.files.find(entry => entry.path === 'Electron.app/Contents/MacOS/Electron');
  assertMacArchitecture(await executable.buffer(), arch);
  const info = macBundlePlist('Electron.app/Contents/Info.plist', await source.files.find(e => e.path === 'Electron.app/Contents/Info.plist').buffer(), pkg.version);
  const minimumOS = info.toString().match(/<key>LSMinimumSystemVersion<\/key>\s*<string>([^<]+)/)?.[1] ?? 'see Info.plist';
  const name = `TierFlow-${pkg.version}-macOS-${arch}-test.zip`;
  const destination = path.join(output, name); const zip = new yazl.ZipFile();
  const completion = pipeline(zip.outputStream, createWriteStream(destination));
  for (const entry of source.files) {
    if (!runtimeEntryAllowed(entry.path)) continue;
    const name = macBundlePath(entry.path);
    const mode = (entry.externalFileAttributes >>> 16) || (entry.type === 'Directory' ? 0o40755 : 0o100644);
    if (entry.type === 'Directory') { zip.addEmptyDirectory(name, { mode }); continue; }
    if (entry.path === 'Electron.app/Contents/Info.plist' || /\/Electron Helper[^/]*\.app\/Contents\/Info.plist$/.test(entry.path)) {
      zip.addBuffer(macBundlePlist(entry.path, await entry.buffer(), pkg.version), name, { mode });
    } else {
      // Preserve link target bytes and S_IFLNK mode, rather than dereferencing links.
      zip.addReadStreamLazy(name, { mode, size: entry.uncompressedSize }, callback => callback(null, entry.stream()));
    }
  }
  zip.addFile(asar, 'TierFlow.app/Contents/Resources/app.asar', { mode: 0o100644 });
  zip.addFile(path.join(root, 'public/icon.icns'), 'TierFlow.app/Contents/Resources/icon.icns', { mode: 0o100644 });
  zip.addFile(path.join(root, 'build/install-mac-test.command'), 'Install-TierFlow.command', { mode: 0o100755 });
  zip.addFile(path.join(root, 'build/entitlements.mac.plist'), 'entitlements.mac.plist', { mode: 0o100644 });
  zip.addFile(path.join(root, 'docs/mac-test-user-guide.txt'), '使用说明.txt', { mode: 0o100644 });
  for (const license of ['LICENSE', 'LICENSES.chromium.html']) {
    const entry = source.files.find(e => e.path === license);
    if (entry) zip.addReadStreamLazy(`licenses/${license}`, { mode: 0o100644 }, cb => cb(null, entry.stream()));
  }
  zip.end(); await completion;
  manifests.push({ file: name, arch, size: (await stat(destination)).size, sha256: await sha256(destination), minimumOS,
    signing: 'Requires bundled installer to apply an ad-hoc signature on the destination Mac', notarized: false, nativeTested: false });
  console.log(`Created ${name} (${minimumOS}+)`);
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ version: pkg.version, electron: version, packages: manifests }, null, 2) + '\n');
await writeFile(path.join(output, 'SHA256SUMS.txt'), manifests.map(m => `${m.sha256}  ${m.file}`).join('\n') + '\n');
console.log(`Test kits ready: ${output}`);
