// Remembers the window's size, position, and maximized state between launches.
// Fullscreen is never persisted: it is a launch option, not window geometry.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { screen } from 'electron';

export class WindowState {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.state = this.load();
    this.timer = undefined;
  }
  load() {
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      if (Number.isFinite(saved.width) && Number.isFinite(saved.height)) return saved;
    } catch { /* first launch or unreadable file */ }
    return { ...this.defaults };
  }
  bounds() {
    const { x, y, width, height } = this.state;
    const bounds = { width: Math.max(Math.round(width), 640), height: Math.max(Math.round(height), 400) };
    if (!Number.isFinite(x) || !Number.isFinite(y)) return bounds;
    // Only restore a position that is still visible on a connected display.
    const area = screen.getDisplayMatching({ x, y, width: bounds.width, height: bounds.height }).workArea;
    const visible = x + bounds.width > area.x + 40 && x < area.x + area.width - 40 && y >= area.y - 10 && y < area.y + area.height - 40;
    return visible ? { ...bounds, x: Math.round(x), y: Math.round(y) } : bounds;
  }
  get maximized() { return Boolean(this.state.maximized); }
  track(window) {
    const save = () => {
      if (window.isDestroyed()) return;
      const maximized = window.isMaximized();
      if (!maximized && !window.isFullScreen() && !window.isMinimized()) Object.assign(this.state, window.getNormalBounds());
      this.state.maximized = maximized;
      this.write();
    };
    const later = () => { clearTimeout(this.timer); this.timer = setTimeout(save, 400); };
    window.on('resize', later);
    window.on('move', later);
    window.on('close', () => { clearTimeout(this.timer); save(); });
  }
  write() {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.state));
    } catch { /* a read-only profile still runs fine */ }
  }
}
