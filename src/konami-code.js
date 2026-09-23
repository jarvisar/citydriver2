const CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];

export class KonamiCode {
  constructor() { this.reset(); }
  reset() { this.keys = []; }
  keydown(event) {
    if (event.repeat) return false;
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing
      || event.target?.isContentEditable || event.target?.closest?.('input, textarea, select')) {
      this.reset();
      return false;
    }
    return this.press(event.code);
  }
  press(code) {
    this.keys.push(code);
    if (this.keys.length > CODE.length) this.keys.shift();
    if (this.keys.length !== CODE.length || !CODE.every((code, i) => code === this.keys[i])) return false;
    this.reset();
    return true;
  }
}
