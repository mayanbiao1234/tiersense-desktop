import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { validWindowState } from '../core/window-layout.mjs';

// Non-secret, small UI preferences live beside this installation's user data.
export class WindowState {
  constructor(directory) {
    this.file = join(directory, 'window-state.json'); this.value = null;
    try { const text = readFileSync(this.file, 'utf8'); if (text.length <= 4096) { const value = JSON.parse(text); if (validWindowState(value)) this.value = value; } } catch { /* Use display-safe defaults. */ }
  }
  attach(window, app) {
    let timer;
    const persist = () => {
      clearTimeout(timer);
      if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
      const next = { version: 1, bounds: window.getNormalBounds(), maximized: window.isMaximized() };
      if (!validWindowState(next)) return;
      this.value = next;
      try { writeFileSync(`${this.file}.tmp`, JSON.stringify(next), { mode: 0o600 }); renameSync(`${this.file}.tmp`, this.file); } catch { /* Layout persistence must not interrupt routing or shutdown. */ }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(persist, 350); timer.unref?.(); };
    for (const event of ['resize', 'move', 'maximize', 'unmaximize']) window.on(event, schedule);
    window.on('close', persist); app.on('before-quit', persist);
    window.on('closed', () => clearTimeout(timer));
  }
}
