import { app, BrowserWindow, ipcMain, safeStorage, shell, dialog, protocol, net, session, clipboard, screen, Tray, Menu } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Store } from '../core/store.mjs';
import { Gateway } from '../core/gateway.mjs';
import { applyProvider, modelInput, settingsInput, applyRouting, importModels, pruneModelRules, deleteModel } from '../core/config.mjs';
import { discoverModels } from '../core/discovery.mjs';
import { readiness } from '../core/policy.mjs';
import { DesktopController } from './desktop.mjs';
import { restoredWindowBounds, nextZoom } from '../core/window-layout.mjs';
import { WindowState } from './window-state.mjs';
import { desktopPaths, windowChrome } from './platform.mjs';
import { History } from '../core/history.mjs';
import { BalanceMonitor } from '../core/balances.mjs';
import { ReasoningVault } from '../core/reasoning-vault.mjs';
import { summarizeUsage } from '../core/usage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let dataDir; let tempDir;
try {
  ({ dataDir, tempDir } = desktopPaths(process.platform, app.getPath('appData'), process.env.TIERFLOW_DATA_DIR));
  for (const dir of [dataDir, tempDir, path.join(dataDir, 'session'), path.join(dataDir, 'logs'), path.join(dataDir, 'crashes')]) mkdirSync(dir, { recursive: true });
} catch (error) {
  const message = `无法使用数据目录${dataDir ? ` ${dataDir}` : ''}：${error.message}。可通过 TIERFLOW_DATA_DIR 指定可写的绝对路径。`;
  if (process.argv.includes('--smoke-test')) console.error(message); else dialog.showErrorBox('TierFlow 存储目录不可用', message);
  app.exit(1);
}
process.env.TEMP = process.env.TMP = process.env.TMPDIR = tempDir;
app.setPath('userData', dataDir); app.setPath('sessionData', path.join(dataDir, 'session'));
app.setPath('temp', tempDir); app.setPath('crashDumps', path.join(dataDir, 'crashes')); app.setAppLogsPath(path.join(dataDir, 'logs'));
app.commandLine.appendSwitch('disk-cache-dir', path.join(dataDir, 'cache'));
protocol.registerSchemesAsPrivileged([{ scheme: 'tierflow', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!app.requestSingleInstanceLock()) app.exit(0);
let window; let store; let gateway; let desktop; let history; let balances;
const devUrl = process.env.TIERFLOW_DEV_URL;
const allowedExternal = new Set(['https://tierflow.cn', 'https://tierflow.cn/tiersense/docs/difficulty', 'https://tierflow.cn/privacy-policy']);
function snapshot() { const info = history.info(); return { ...store.public(), gateway: gateway.status(), modelAlerts: gateway.availability(), recoveryError: gateway.reasoningVault?.error ?? '', logs: history.entries.slice(0, 500), history: info, balances: balances.snapshot(), dataDir, version: app.getVersion(), platform: process.platform }; }
function publish() { desktop?.refresh(); if (window && !window.isDestroyed()) window.webContents.send('tierflow:change', snapshot()); }
function checkSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效的调用来源');
  const url = event.senderFrame.url;
  if (devUrl ? !url.startsWith(`${devUrl}/`) : !url.startsWith('tierflow://app/')) throw new Error('无效的页面来源');
}
const actions = {
  snapshot: () => snapshot(),
  'clipboard.write': ({ text }) => {
    if (typeof text !== 'string' || text.length > 100000) throw new Error('复制内容不正确');
    clipboard.writeText(text);
  },
  'gateway.start': async () => { await desktop.setService(true); return snapshot(); },
  'gateway.stop': async () => { await desktop.setService(false); return snapshot(); },
  'gateway.key': () => store.config.secrets.gatewayKey,
  'gateway.rotate': async () => { await store.update(c => { c.secrets.gatewayKey = `tf_local_${randomBytes(24).toString('hex')}`; }); await gateway.reasoningVault.clear(); gateway.scoring.clear(); return snapshot(); },
  'gateway.retry': () => { gateway.health.clear(); return snapshot(); },
  'reasoning.clear': async () => { await gateway.reasoningVault.clear(); if (gateway.reasoningVault.error) throw new Error(gateway.reasoningVault.error); return snapshot(); },
  'provider.save': async input => {
    let savedProviderId; await store.update(c => { savedProviderId = applyProvider(c, input).id; }); gateway.health.clear(); void balances.refreshEnabled(); return { ...snapshot(), savedProviderId };
  },
  'provider.balance': async ({ id }) => { await balances.refresh(id); return snapshot(); },
  'provider.delete': async ({ id }) => { await store.update(c => { const modelIds = c.models.filter(m => m.providerId === id).map(m => m.id); c.providers = c.providers.filter(p => p.id !== id); c.models = c.models.filter(m => m.providerId !== id); delete c.secrets.providers[id]; pruneModelRules(c, modelIds); if (modelIds.includes(c.settings.fallbackModelId)) { c.settings.fallbackModelId = ''; c.settings.failureMode = 'block'; } }); balances.cache.delete(id); return snapshot(); },
  'provider.models': ({ id }) => discoverModels(store.snapshot(), id),
  'model.import': async input => { let imported; await store.update(c => { imported = importModels(c, input); }); return { ...snapshot(), imported }; },
  'provider.test': async ({ id }) => {
    const c = store.snapshot(); const p = c.providers.find(p => p.id === id);
    if (!p || !c.secrets.providers[id]) throw new Error('请先保存渠道和 API Key');
    try { const r = await fetch(`${p.baseUrl}/models`, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { Authorization: `Bearer ${c.secrets.providers[id]}` } });
      await r.body?.cancel(); if (!r.ok) throw new Error(r.status === 404 ? '渠道未提供 /models，无法用模型列表验证连接' : `渠道返回 HTTP ${r.status}`);
      return { message: '模型列表接口可访问；具体模型调用请用路由测试验证' };
    } catch(e) { throw new Error(e.name === 'TimeoutError' || e.name === 'TypeError' ? '连接失败或超时，请检查地址与网络' : e.message); }
  },
  'model.save': async input => { await store.update(c => { const existing = c.models.find(m => m.id === input.id); if (input.id && !existing) throw new Error('模型不存在'); const model = modelInput(input, c, existing); if (existing) c.models[c.models.indexOf(existing)] = model; else c.models.push(model); pruneModelRules(c); }); return snapshot(); },
  'model.delete': async ({ id }) => { await store.update(c => deleteModel(c, id)); return snapshot(); },
  'routing.save': async input => { await store.update(c => applyRouting(c, input)); return snapshot(); },
  'onboarding.complete': async () => { await store.update(c => { const r = readiness(c); if (!r.providers || !r.models || !r.tiersense || !gateway.status().running) throw new Error('请先完成配置并启动本地服务'); c.onboardingCompleted = true; }); return snapshot(); },
  'settings.save': async input => { if (gateway.status().running && input.port !== undefined && input.port !== store.config.settings.port) throw new Error('请先停止网关，再修改端口'); const previous = store.config.settings.retainReasoning; await store.update(c => { c.settings = settingsInput(input, c.settings); if (c.settings.failureMode === 'fallback' && !c.models.some(m => m.id === c.settings.fallbackModelId)) throw new Error('请选择有效的兜底模型'); }); if (previous !== store.config.settings.retainReasoning) await gateway.reasoningVault.setEnabled(store.config.settings.retainReasoning); if ('zoomFactor' in input) window.webContents.setZoomFactor(store.config.settings.zoomFactor); return snapshot(); },
  'tiersense.save': async ({ key, url }) => { await store.update(c => { c.settings = settingsInput({ tiersenseUrl: url }, c.settings); if (typeof key === 'string' && key.trim()) c.secrets.tiersenseKey = key.trim(); }); return snapshot(); },
  'tiersense.remove': async () => { await store.update(c => { c.secrets.tiersenseKey = ''; }); return snapshot(); },
  'logs.clear': async () => { await history.clear(); gateway.logs = history.entries.slice(0, 500); return snapshot(); },
  'analytics.get': input => { const info = history.info(); return { ...summarizeUsage(history.entries, input), history: info }; },
  'route.test': async ({ prompt }) => {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) throw new Error('请输入 1–8000 字的测试内容');
    if (!gateway.status().running) throw new Error('请先启动本地 API 服务');
    const r = await fetch(`http://127.0.0.1:${gateway.status().port}/v1/chat/completions`, { method: 'POST', signal: AbortSignal.timeout(store.config.settings.requestTimeoutMs + 5000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${store.config.secrets.gatewayKey}` },
      body: JSON.stringify({ model: 'tierflow-auto', messages: [{ role: 'user', content: prompt }], max_tokens: 256 }) });
    const data = await r.json(); if (!r.ok) throw new Error(data.error?.message ?? '测试失败');
    return { text: data.choices?.[0]?.message?.content ?? '模型返回了非文本结果', requestId: r.headers.get('x-tierflow-request-id'), model: data.model };
  },
  'external.open': async ({ url }) => { if (!allowedExternal.has(url)) throw new Error('此链接不可打开'); await shell.openExternal(url); },
  'data.open': () => shell.openPath(dataDir),
  'tray.menu': () => { if (!desktop.tray || desktop.tray.isDestroyed()) throw new Error('系统托盘暂时不可用'); desktop.tray.popUpContextMenu(); },
  'window.minimize': () => window.minimize(),
  'window.maximize': () => window.isMaximized() ? window.unmaximize() : window.maximize(),
  'window.close': () => window.close(),
};
async function createWindow() {
  const savedWindow = new WindowState(dataDir);
  const fallbackArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  window = new BrowserWindow({ ...restoredWindowBounds(screen.getAllDisplays().map(display => display.workArea), fallbackArea, savedWindow.value), show: false,
    backgroundColor: '#f9fafd', title: 'TierFlow', icon: path.join(root, 'dist/icon.png'), ...windowChrome(process.platform),
    webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const direction = ['+', '='].includes(input.key) ? 1 : input.key === '-' ? -1 : input.key === '0' ? 0 : null;
    if (direction === null) return;
    event.preventDefault();
    void store.update(c => { c.settings = settingsInput({ zoomFactor: nextZoom(c.settings.zoomFactor, direction) }, c.settings); })
      .then(() => { window.webContents.setZoomFactor(store.config.settings.zoomFactor); publish(); })
      .catch(() => {});
  });
  window.once('ready-to-show', () => { if (savedWindow.value?.maximized) window.maximize(); if (!process.argv.includes('--smoke-test')) window.show(); });
  await (devUrl ? window.loadURL(devUrl) : window.loadURL('tierflow://app/index.html'));
  window.webContents.setZoomFactor(Math.min(1.5, Math.max(0.8, store.config.settings.zoomFactor || 1)));
  savedWindow.attach(window, app);
}
app.whenReady().then(async () => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥加密服务不可用，无法安全保存 API Key');
  store = await new Store(dataDir, { encrypt: text => safeStorage.encryptString(text).toString('base64'), decrypt: text => safeStorage.decryptString(Buffer.from(text, 'base64')) }).init();
  history = await new History(dataDir, publish).init();
  gateway = new Gateway(store, fetch, history); gateway.on('change', publish);
  gateway.reasoningVault = await new ReasoningVault(dataDir, gateway.reasoning, {
    encrypt: text => safeStorage.encryptString(text), decrypt: buffer => safeStorage.decryptString(buffer),
  }, publish).init(store.config.settings.retainReasoning);
  balances = new BalanceMonitor(store, publish);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  protocol.handle('tierflow', request => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const dest = path.resolve(root, 'dist', relative);
    if (url.hostname !== 'app' || !dest.startsWith(`${path.resolve(root, 'dist')}${path.sep}`)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(dest).toString());
  });
  ipcMain.handle('tierflow:invoke', async (event, action, input) => {
    checkSender(event);
    if (!Object.hasOwn(actions, action)) return { ok: false, error: '不支持的操作' };
    try { const data = await actions[action](input); publish(); return { ok: true, data }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  await createWindow();
  desktop = new DesktopController({ app, Tray, Menu, dialog, window, gateway, store, icon: path.join(root, process.platform === 'darwin' ? 'dist/trayTemplate.png' : 'dist/icon.ico'), publish });
  desktop.initialize();
  balances.start(); app.on('will-quit', () => balances.stop());
  if (store.config.settings.autoStart) { try { await gateway.start(); } catch { dialog.showErrorBox('网关未能自动启动', '请检查端口是否被占用，在客户端中重新启动。'); } }
  if (process.argv.includes('--smoke-test')) { console.log('TIERFLOW_SMOKE_OK', JSON.stringify({ title: window.getTitle(), encryptedStorage: safeStorage.isEncryptionAvailable(), dataDir })); app.quit(); }
}).catch(error => { if (process.argv.includes('--smoke-test')) console.error(error); else dialog.showErrorBox('TierFlow 启动失败', error.message); app.exit(1); });
app.on('window-all-closed', () => app.quit());
