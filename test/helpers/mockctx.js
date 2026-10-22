// A stand-in CanvasRenderingContext2D for Node tests: records what is drawn (text, images,
// circles) with the opacity it is drawn at, and ignores everything else.

const STATE_KEYS = ['globalAlpha', 'font', 'fillStyle', 'strokeStyle', 'textAlign', 'textBaseline', 'lineWidth'];

export class MockCtx {
  constructor(canvas = { width: 1080, height: 1920 }) {
    this.canvas = canvas;
    this.globalAlpha = 1;
    this.font = '10px sans-serif';
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.textAlign = 'start';
    this.textBaseline = 'alphabetic';
    this.lineWidth = 1;
    this.stack = [];
    this.texts = [];
    this.images = [];
    this.arcs = [];
    return new Proxy(this, {
      // Any method not defined here (clip, fill, translate...) is a no-op.
      get: (t, k) => (k in t ? t[k] : () => {}),
      set: (t, k, v) => { t[k] = v; return true; },
    });
  }

  save() { this.stack.push(Object.fromEntries(STATE_KEYS.map((k) => [k, this[k]]))); }
  restore() { Object.assign(this, this.stack.pop() || {}); }
  fontSize() { return parseFloat(/([\d.]+)px/.exec(this.font)?.[1]) || 10; }
  measureText(text) { return { width: String(text).length * this.fontSize() * 0.55 }; }
  fillText(text, x, y) {
    this.texts.push({ text: String(text), x, y, alpha: this.globalAlpha, align: this.textAlign, w: this.measureText(text).width });
  }
  drawImage(img, ...args) { this.images.push({ img, alpha: this.globalAlpha, args }); }
  arc(x, y, r) { this.arcs.push({ x, y, r }); }
  createLinearGradient() { return { addColorStop() {} }; }
  getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; }
  putImageData() {}
}

/** Make createVideoRenderer's offscreen canvases work in Node. */
export function installOffscreenCanvas() {
  globalThis.OffscreenCanvas ??= class {
    constructor(width, height) { this.width = width; this.height = height; this.ctx = new MockCtx(this); }
    getContext() { return this.ctx; }
  };
}

/** A fake decoded image; `tag` says which photo it is. */
export const fakeImage = (tag, width = 800, height = 1000) => ({ tag, width, height });
