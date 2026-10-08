import path from 'node:path';
import { existsSync } from 'node:fs';

export function desktopPaths(platform, appData, override, exists = existsSync) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (override && (!paths.isAbsolute(override) || platform === 'win32' && !/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(override))) throw new Error('TIERFLOW_DATA_DIR 必须是绝对路径');
  let dataDir = override || paths.join(appData, 'TierFlow');
  // Compatibility only: reuse an existing pre-0.3.1 profile, including its
  // encryption state. Never create this old directory on a fresh installation.
  const legacy = 'D:\\CodexData\\TierFlow';
  if (platform === 'win32' && !override && !exists(paths.join(dataDir, 'config.json')) && exists(paths.join(legacy, 'config.json'))) dataDir = legacy;
  return { dataDir, tempDir: paths.join(dataDir, 'tmp') };
}

export function windowChrome(platform) {
  // Keep native traffic lights, full-screen behavior and the system title bar on Mac.
  return platform === 'darwin' ? { frame: true, autoHideMenuBar: false } : { frame: false, autoHideMenuBar: true };
}

export function macApplicationMenu(desktop) {
  const { running } = desktop.gateway.status();
  const busy = desktop.serviceOperations > 0 || desktop.quitting || desktop.quitRequested;
  return [
    { label: 'TierFlow', submenu: [
      { role: 'about', label: '关于 TierFlow' },
      { type: 'separator' },
      { label: '打开主界面', accelerator: 'Cmd+1', click: () => desktop.show() },
      { label: '开启 TierSense 路由', enabled: !running && !busy, click: () => desktop.runService(true) },
      { label: '暂停 TierSense 路由', enabled: running && !busy, click: () => desktop.runService(false) },
      { type: 'separator' },
      { role: 'hide', label: '隐藏 TierFlow' }, { role: 'hideOthers', label: '隐藏其他应用' },
      { role: 'unhide', label: '显示全部' }, { type: 'separator' },
      { label: '退出 TierFlow', accelerator: 'Cmd+Q', click: () => { void desktop.requestQuit(); } },
    ] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' },
    ] },
    { label: '窗口', submenu: [
      { role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放窗口' },
      { role: 'togglefullscreen', label: '切换全屏' },
      { label: '关闭窗口', accelerator: 'Cmd+W', click: () => desktop.window.close() },
      { type: 'separator' }, { label: '显示 TierFlow', click: () => desktop.show() },
    ] },
  ];
}
