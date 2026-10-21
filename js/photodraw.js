// Draw a stored photo through its crop and the current photo style.
// A "photo" is { img, crop } where img is an ImageBitmap / HTMLImageElement / canvas.

import { sourceRectForBox } from './crop.js';
import { applyGrade, buildGrade, photoStats } from './photostyle.js';

const styled = new WeakMap(); // img -> Map(key -> canvas)
const MAX_PER_IMAGE = 8;

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export const imageSize = (img) => ({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });

/** Draw photo into the box (x, y, w, h). style: 'off' | 'auto' | 'club'. */
export function drawPhoto(ctx, photo, x, y, w, h, style = 'off') {
  const { img, crop } = photo;
  const { w: iw, h: ih } = imageSize(img);
  if (!iw || !ih || w <= 0 || h <= 0) return;
  const src = sourceRectForBox(crop, iw, ih, w / h);
  if (style !== 'auto' && style !== 'club') {
    ctx.drawImage(img, src.x, src.y, src.w, src.h, x, y, w, h);
    return;
  }
  // Grade at the size it's drawn: cheap, and the stats come from the visible area only.
  const cw = Math.max(1, Math.round(w));
  const ch = Math.max(1, Math.round(h));
  const key = `${style}|${cw}x${ch}|${src.x.toFixed(1)},${src.y.toFixed(1)},${src.w.toFixed(1)}`;
  let byKey = styled.get(img);
  if (!byKey) { byKey = new Map(); styled.set(img, byKey); }
  let canvas = byKey.get(key);
  if (!canvas) {
    canvas = makeCanvas(cw, ch);
    const c = canvas.getContext('2d', { willReadFrequently: true });
    c.imageSmoothingQuality = 'high';
    c.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, cw, ch);
    const pixels = c.getImageData(0, 0, cw, ch);
    applyGrade(pixels.data, buildGrade(photoStats(pixels.data), style));
    c.putImageData(pixels, 0, 0);
    if (byKey.size >= MAX_PER_IMAGE) byKey.delete(byKey.keys().next().value);
    byKey.set(key, canvas);
  }
  ctx.drawImage(canvas, x, y, w, h);
}
