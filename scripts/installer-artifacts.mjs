import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const destination = new URL(`../release/${pkg.version}/`, import.meta.url);
const setup = `TierFlow-Setup-${pkg.version}.exe`;
const launcher = [
  '@echo off', 'setlocal',
  'set "TEMP=D:\\CodexData\\Temp"', 'set "TMP=%TEMP%"', 'set "TMPDIR=%TEMP%"',
  'if not exist "%TEMP%" mkdir "%TEMP%"',
  'if not exist "%TEMP%" (echo Cannot create D: temporary directory. & pause & exit /b 1)',
  `if not exist "%~dp0${setup}" (echo Keep this script next to ${setup}. & pause & exit /b 1)`,
  `start "" /wait "%~dp0${setup}"`, 'exit /b %errorlevel%', '',
].join('\r\n');
await writeFile(new URL('Install-TierFlow-Dev-D.cmd', destination), launcher, 'ascii');
await writeFile(new URL('安装说明.txt', destination), [
  `TierFlow ${pkg.version}`, '',
  `用户只需下载并运行 ${setup}，无需 Node.js、Python、源码或其他文件。无需 D 盘。`,
  '升级前请从右下角系统托盘菜单选择“退出 TierFlow”；点击 × 只会收起窗口。',
  '默认安装到当前用户的 %LOCALAPPDATA%\\Programs\\TierFlow，也可选择其他可写文件夹。升级记住上次的安装位置。',
  '安装时可选择创建桌面和开始菜单快捷方式；完成页可选择立即启动或打开安装文件夹。',
  '新用户配置、加密密钥、缓存和运行时临时文件保存在 %APPDATA%\\TierFlow 下；卸载保留配置。',
  '检测到旧版配置时继续沿用原数据目录，不移动加密状态。实际位置可在客户端“设置”查看。',
  '点击 × 后服务继续运行。右下角托盘图标可打开界面、启动/停止服务或退出；找不到时请展开“隐藏的图标”。',
  '当前为未签名的开发测试版，账户登录与支付服务尚待后端接入。', '',
  '仅供开发者：Install-TierFlow-Dev-D.cmd 用于本开发机的 D 盘临时目录偏好，不向普通用户分发。官网只需提供 EXE。', '',
].join('\r\n'), 'utf8');
console.log(`Installer, user guide and developer-only D: launcher: ${path.resolve(`release/${pkg.version}`)}`);
