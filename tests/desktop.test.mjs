import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { DesktopController } from '../electron/desktop.mjs';
import { Gateway } from '../core/gateway.mjs';
import { defaults } from '../core/config.mjs';

function fixture(platform = 'win32') {
  const config = defaults(); config.settings.port = 0;
  const store = { config, queue: Promise.resolve(), snapshot: () => structuredClone(config), update: async change => change(config) };
  const gateway = new Gateway(store);
  const app = new EventEmitter(); app.exited = false;
  app.show = () => { app.shown = true; };
  app.quit = () => {
    let prevented = false; app.emit('before-quit', { preventDefault() { prevented = true; } });
    if (!prevented) { app.exited = true; app.emit('will-quit'); }
  };
  const window = Object.assign(new EventEmitter(), { visible: true, minimized: false,
    isDestroyed: () => false, isMinimized() { return this.minimized; }, restore() { this.minimized = false; },
    show() { this.visible = true; }, hide() { this.visible = false; }, focus() {} });
  class Tray extends EventEmitter {
    destroyed = false; balloons = [];
    isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
    setToolTip(text) { this.tooltip = text; } setContextMenu(menu) { this.menu = menu; }
    popUpContextMenu() { this.open = true; } closeContextMenu() { this.open = false; }
    displayBalloon(options) { this.balloons.push(options); }
  }
  const dialog = { response: 0, prompts: 0, errors: [], showErrorBox(...args) { this.errors.push(args); },
    async showMessageBox() { this.prompts++; return { response: this.response }; } };
  const desktop = new DesktopController({ app, window, Tray, Menu: { buildFromTemplate: items => items, setApplicationMenu: items => { app.menu = items; } },
    dialog, gateway, store, platform, icon: 'test.ico', publish: () => desktop.refresh() });
  gateway.on('change', () => desktop.refresh()); desktop.initialize();
  const menu = label => desktop.tray.menu.find(item => item.label === label);
  const close = () => { let prevented = false; window.emit('close', { preventDefault() { prevented = true; } }); return prevented; };
  return { desktop, app, window, gateway, store, dialog, menu, close };
}

test('closing to tray preserves the listener; tray controls stop and restart it; second instance restores window', async t => {
  const f = fixture(); t.after(() => f.gateway.stop());
  await f.desktop.setService(true);
  assert.equal(f.close(), true); assert.equal(f.window.visible, false);
  const response = await fetch(`http://127.0.0.1:${f.gateway.status().port}/v1/models`);
  assert.equal(response.status, 401); await response.body.cancel();
  assert.equal(f.menu('开启 TierSense 路由').enabled, false); assert.equal(f.menu('暂停 TierSense 路由').enabled, true);
  await f.desktop.setService(false);
  assert.equal(f.gateway.status().running, false); assert.equal(f.menu('开启 TierSense 路由').enabled, true);
  assert.equal(f.close(), true); assert.equal(f.desktop.tray.balloons.length, 1);
  f.desktop.tray.emit('click'); assert.equal(f.desktop.tray.open, true);
  f.menu('打开主界面').click(); assert.equal(f.window.visible, true);
  f.window.minimized = true; f.window.hide(); f.app.emit('second-instance');
  assert.equal(f.window.visible, true); assert.equal(f.window.minimized, false);
  await f.desktop.setService(true); assert.equal(f.gateway.status().running, true);
});

test('Mac close preserves the listener without Windows balloon APIs; Dock activation restores the window', async t => {
  const f = fixture('darwin'); t.after(() => f.gateway.stop());
  f.desktop.tray.displayBalloon = () => { throw new Error('Windows-only API called on Mac'); };
  await f.desktop.setService(true);
  assert.equal(f.close(), true); assert.equal(f.window.visible, false);
  const response = await fetch(`http://127.0.0.1:${f.gateway.status().port}/v1/models`);
  assert.equal(response.status, 401); await response.body.cancel();
  assert.equal(f.desktop.tray.listenerCount('click'), 0);
  f.app.emit('activate'); assert.equal(f.window.visible, true); assert.equal(f.app.shown, true);
  assert.equal(f.store.config.trayHintShown, true);
  const top = f.app.menu[0].submenu;
  assert.equal(top.find(m => m.label === '开启 TierSense 路由').enabled, false);
  assert.equal(top.find(m => m.label === '暂停 TierSense 路由').enabled, true);
  assert.deepEqual(f.app.menu[1].submenu.filter(m => m.role).map(m => m.role), ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
  const quit = top.find(m => m.accelerator === 'Cmd+Q'); quit.click();
  await f.desktop.shutdown;
  assert.equal(f.app.exited, true); assert.equal(f.gateway.status().running, false);
});

test('Mac Dock quit can cancel active requests; confirmation gracefully stops the service', async () => {
  const f = fixture('darwin'); await f.desktop.setService(true);
  const request = new AbortController(); f.gateway.active.add(request);
  f.app.quit(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.app.exited, false); assert.equal(request.signal.aborted, false);
  f.dialog.response = 1; f.app.quit(); await new Promise(resolve => setImmediate(resolve));
  await f.desktop.shutdown;
  assert.equal(request.signal.aborted, true); assert.equal(f.app.exited, true);
});

test('busy requests can cancel exit; confirmed exit aborts requests and releases the port', async () => {
  const f = fixture(); await f.desktop.setService(true);
  const request = new AbortController(); f.gateway.active.add(request);
  await f.desktop.requestQuit(); assert.equal(f.app.exited, false); assert.equal(request.signal.aborted, false);
  assert.equal(f.desktop.quitRequested, false); assert.equal(f.menu('退出 TierFlow').enabled, true);
  f.dialog.response = 1; await f.desktop.requestQuit(); await f.desktop.shutdown;
  assert.equal(f.dialog.prompts, 2); assert.equal(request.signal.aborted, true);
  assert.equal(f.gateway.status().running, false); assert.equal(f.app.exited, true); assert.equal(f.desktop.tray.isDestroyed(), true);
});

test('exit waits for a pending service start and configuration write', async () => {
  const f = fixture(); let persistDone; f.store.queue = new Promise(resolve => { persistDone = resolve; });
  const starting = f.desktop.setService(true);
  await f.desktop.requestQuit(); await starting;
  assert.equal(f.app.exited, false);
  persistDone(); await f.desktop.shutdown;
  assert.equal(f.gateway.status().running, false); assert.equal(f.app.exited, true);
});

test('port collision returns a useful error and tray remains stopped and retryable', async t => {
  const occupied = http.createServer(); await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  const f = fixture(); f.store.config.settings.port = occupied.address().port;
  await assert.rejects(f.desktop.setService(true), /端口被占用/);
  assert.equal(f.gateway.status().running, false); assert.equal(f.desktop.serviceOperations, 0);
  assert.equal(f.menu('开启 TierSense 路由').enabled, true); assert.equal(f.menu('暂停 TierSense 路由').enabled, false);
  assert.equal(f.close(), true); assert.equal(f.window.visible, false);
  f.desktop.tray.destroy(); f.window.show(); f.close(); await f.desktop.shutdown;
  assert.equal(f.app.exited, true);
});
