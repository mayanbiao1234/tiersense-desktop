import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.error('DMG 打包需要 macOS。Windows 上请运行 npm run mac:test 生成 ZIP 测试安装包。');
  process.exit(1);
}
const { build, Platform, Arch } = await import('electron-builder');
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = await build({
  projectDir: root, config: path.join(root, 'build/electron-builder.mac.cjs'),
  targets: Platform.MAC.createTarget(['dmg', 'zip'], Arch.arm64, Arch.x64), publish: 'never',
});
console.log(artifacts.join('\n'));
