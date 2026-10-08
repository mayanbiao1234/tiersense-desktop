const { version } = require('../package.json');

// Separate configuration: never use the Windows-only electronDist or NSIS hook.
module.exports = {
  extends: null,
  appId: 'cn.tierflow.desktop', productName: 'TierFlow',
  directories: { output: `release/${version}/mac` },
  files: ['dist/**/*', 'electron/**/*', 'core/**/*', 'package.json'],
  asar: true,
  artifactName: 'TierFlow-${version}-macOS-${arch}-test.${ext}',
  mac: {
    category: 'public.app-category.developer-tools', icon: 'public/icon.icns',
    identity: '-', hardenedRuntime: false, notarize: false,
    entitlements: 'build/entitlements.mac.plist', entitlementsInherit: 'build/entitlements.mac.plist',
  },
  dmg: {
    title: 'TierFlow 安装', writeUpdateInfo: false,
    contents: [{ x: 140, y: 180, type: 'file' }, { x: 400, y: 180, type: 'link', path: '/Applications' }],
  },
};
