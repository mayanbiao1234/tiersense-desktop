import { macApplicationMenu } from './platform.mjs';

// Keep desktop lifetime independent of window visibility and service state.
export class DesktopController {
  constructor({ app, Tray, Menu, dialog, window, gateway, store, icon, publish, platform = process.platform }) {
    Object.assign(this, { app, Tray, Menu, dialog, window, gateway, store, icon, publish, platform });
    this.quitting = false;
    this.quitRequested = false;
    this.serviceOperations = 0;
    this.tray = null;
    this.shutdown = null;
    this.lastMenuState = '';
  }

  initialize() {
    try {
      this.tray = new this.Tray(this.icon);
      // macOS opens the assigned menu natively; a second popup interferes with it.
      if (this.platform !== 'darwin') {
        this.tray.on('click', () => this.tray.popUpContextMenu());
        this.tray.on('double-click', () => { this.tray.closeContextMenu(); this.show(); });
        this.tray.on('balloon-click', () => this.show());
      }
      this.refresh();
    } catch {
      this.tray?.destroy(); this.tray = null;
      this.dialog.showErrorBox('后台图标不可用', '暂时无法创建后台图标。请保持窗口打开或最小化；关闭窗口将退出 TierFlow。');
      this.refresh();
    }
    this.window.on('close', event => this.closeWindow(event));
    this.window.on('session-end', () => { this.quitting = true; void this.gateway.stop().catch(() => {}); });
    this.app.on('before-quit', event => this.beforeQuit(event));
    this.app.on('second-instance', () => this.show());
    this.app.on('activate', () => this.show());
    this.app.on('will-quit', () => this.destroyTray());
  }

  destroyTray() { if (this.tray && !this.tray.isDestroyed()) this.tray.destroy(); }

  show() {
    if (this.window.isDestroyed()) return;
    if (this.platform === 'darwin') this.app.show();
    if (this.window.isMinimized()) this.window.restore();
    this.window.show(); this.window.focus();
  }

  refresh() {
    const { running, port } = this.gateway.status();
    const busy = this.serviceOperations > 0 || this.quitting || this.quitRequested;
    const key = JSON.stringify([running, port, busy]);
    if (this.lastMenuState === key) return;
    this.lastMenuState = key;
    if (this.platform === 'darwin') this.Menu.setApplicationMenu(this.Menu.buildFromTemplate(macApplicationMenu(this)));
    if (!this.tray || this.tray.isDestroyed()) return;
    this.tray.setToolTip(`TierSense 路由${running ? '运行中' : '已停止'} · ${port}`);
    this.tray.setContextMenu(this.Menu.buildFromTemplate([
      { label: running ? `TierSense 路由运行中 · 端口 ${port}` : 'TierSense 路由已暂停', enabled: false },
      { type: 'separator' },
      { label: '打开主界面', click: () => this.show() },
      { label: '开启 TierSense 路由', enabled: !running && !busy, click: () => this.runService(true) },
      { label: '暂停 TierSense 路由', enabled: running && !busy, click: () => this.runService(false) },
      { type: 'separator' },
      { label: '退出 TierFlow', enabled: !this.quitting && !this.quitRequested, click: () => { void this.requestQuit(); } },
    ]));
  }

  async setService(running) {
    if (this.quitting || this.quitRequested) throw new Error('TierFlow 正在退出');
    this.serviceOperations++; this.refresh();
    try { await (running ? this.gateway.start() : this.gateway.stop()); }
    catch (error) {
      throw new Error(error.code === 'EADDRINUSE' ? '端口被占用，请在设置中更换本地端口' : running ? '无法启动本地 API 服务，请检查端口设置' : '无法停止本地 API 服务，请重试');
    } finally { this.serviceOperations--; this.publish(); }
  }

  runService(running) {
    void this.setService(running).catch(error => {
      if (this.quitting) return;
      this.show();
      this.dialog.showErrorBox(running ? '开启 TierSense 路由失败' : '暂停 TierSense 路由失败', error.message);
    });
  }

  closeWindow(event) {
    if (this.quitting) return;
    event.preventDefault();
    if (!this.tray || this.tray.isDestroyed()) { void this.requestQuit(); return; }
    this.window.hide();
    if (!this.store.config.trayHintShown) {
      const running = this.gateway.status().running;
      if (this.platform === 'win32') this.tray.displayBalloon({ title: 'TierFlow 已收起到系统托盘',
        content: `${running ? 'TierSense 路由继续运行。' : 'TierSense 路由当前未开启。'}点击右下角 TierFlow 图标即可打开界面、开启或暂停 TierSense 路由；找不到图标时请展开“隐藏的图标”。完全关闭请在托盘菜单选择“退出 TierFlow”。`,
        iconType: 'info', noSound: true, respectQuietTime: true });
      void this.store.update(config => { config.trayHintShown = true; }).catch(() => {});
    }
  }

  async requestQuit() {
    if (this.quitRequested || this.quitting) return;
    this.quitRequested = true; this.refresh();
    try {
      const { active } = this.gateway.status();
      if (active > 0) {
        this.show();
        const { response } = await this.dialog.showMessageBox(this.window, { type: 'question', title: '退出 TierFlow',
          message: `还有 ${active} 个请求正在处理`, detail: `退出会停止本地服务并中断这些请求。关闭主窗口可保留在${this.platform === 'darwin' ? '菜单栏' : '系统托盘'}，让服务继续运行。`,
          buttons: ['继续运行', '退出并停止路由'], defaultId: 0, cancelId: 0 });
        if (response !== 1) return;
      }
      this.app.quit();
    } catch { this.dialog.showErrorBox('无法退出 TierFlow', '请关闭当前对话框后，从后台图标菜单重试退出。'); }
    finally { if (!this.quitting) { this.quitRequested = false; this.refresh(); } }
  }

  beforeQuit(event) {
    if (this.quitting) return;
    event.preventDefault();
    // Dock's Quit action also uses the active-request confirmation.
    if (!this.quitRequested && this.gateway.status().active > 0) { void this.requestQuit(); return; }
    this.quitting = true; this.refresh();
    // stop() queues after any pending start(), so exiting cannot leave a listener behind.
    this.shutdown = Promise.resolve().then(() => this.gateway.stop()).then(() => this.store.queue)
      .catch(() => {}).finally(() => { this.destroyTray(); this.app.quit(); });
  }
}
