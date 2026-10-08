import plist from 'plist';

export function macBundlePath(name) {
  return name.replace(/^Electron\.app\//, 'TierFlow.app/')
    .replace(/\/Electron Helper([^/]*)/g, '/TierFlow Helper$1')
    .replace(/\/Contents\/MacOS\/Electron$/, '/Contents/MacOS/TierFlow');
}

export function macBundlePlist(name, contents, version) {
  const info = plist.parse(contents.toString('utf8'));
  if (name === 'Electron.app/Contents/Info.plist') {
    Object.assign(info, {
      CFBundleIdentifier: 'cn.tierflow.desktop', CFBundleName: 'TierFlow', CFBundleDisplayName: 'TierFlow',
      CFBundleExecutable: 'TierFlow', CFBundleIconFile: 'icon.icns',
      CFBundleShortVersionString: version, CFBundleVersion: version,
      LSApplicationCategoryType: 'public.app-category.developer-tools',
      NSHumanReadableCopyright: 'TierFlow',
    });
    delete info.ElectronAsarIntegrity;
  } else if (/\/Electron Helper[^/]*\.app\/Contents\/Info.plist$/.test(name)) {
    const suffix = name.match(/\/Electron Helper([^/]*)\.app\//)[1];
    Object.assign(info, {
      CFBundleName: `TierFlow Helper${suffix}`, CFBundleDisplayName: `TierFlow Helper${suffix}`,
      CFBundleExecutable: `TierFlow Helper${suffix}`,
      CFBundleIdentifier: `cn.tierflow.desktop.helper${suffix ? `.${suffix.replace(/[^a-zA-Z0-9]/g, '')}` : ''}`,
      CFBundleVersion: version,
    });
  }
  return Buffer.from(plist.build(info));
}

export function runtimeEntryAllowed(name) {
  return name.startsWith('Electron.app/') && !name.includes('/_CodeSignature/')
    && !name.endsWith('/default_app.asar') && !name.endsWith('/electron.icns');
}

export function assertMacArchitecture(bytes, arch) {
  const expected = arch === 'arm64' ? 0x0100000c : 0x01000007;
  if (bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== expected) throw new Error(`Invalid ${arch} Mach-O executable`);
}
