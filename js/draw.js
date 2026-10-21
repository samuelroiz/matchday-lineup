// Small canvas helpers shared by the team sheet and the video.
// Only touches a CanvasRenderingContext2D passed in, so importing it is DOM-free.

import { initials } from './model.js';

export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const imgSize = (img) => ({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });

/** Draw an image filling the box (CSS object-fit: cover). focusY 0 = keep top, 1 = keep bottom. */
export function drawCover(ctx, img, x, y, w, h, focusY = 0.3) {
  const { w: iw, h: ih } = imgSize(img);
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) * focusY;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/** Draw an image inside the box without cropping (object-fit: contain). */
export function drawContain(ctx, img, x, y, w, h) {
  const { w: iw, h: ih } = imgSize(img);
  if (!iw || !ih) return;
  const scale = Math.min(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** Set ctx.font to the largest size <= size at which text fits maxWidth. fontFor(size) -> CSS font. */
export function fitFont(ctx, text, maxWidth, size, fontFor, minSize = size * 0.45) {
  let s = size;
  ctx.font = fontFor(s);
  while (s > minSize && ctx.measureText(text).width > maxWidth) {
    s -= Math.max(1, s * 0.05);
    ctx.font = fontFor(s);
  }
  return s;
}

/** fitFont, then draw; truncates with an ellipsis if even the minimum size is too wide. */
export function fitText(ctx, text, x, y, maxWidth, size, fontFor) {
  fitFont(ctx, text, maxWidth, size, fontFor);
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > maxWidth) t = t.slice(0, -2) + '…';
  ctx.fillText(t, x, y);
}

export function drawPlaceholder(ctx, x, y, w, h, name, colors) {
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, colors.maroon);
  g.addColorStop(1, '#3d0e16');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = colors.accent;
  ctx.globalAlpha *= 0.85;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(Math.min(w, h) * 0.36)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(name ? initials(name) : '?', x + w / 2, y + h * 0.45);
  ctx.restore();
}

/** Club or opponent logo in a circle; draws a simple crest when the image is missing. */
export function drawLogo(ctx, logo, cx, cy, r, { ring = '#f2b705', fill = '#ffffff', label = 'SFV' } = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (logo) {
    ctx.clip();
    drawContain(ctx, logo, cx - r * 0.92, cy - r * 0.92, r * 1.84, r * 1.84);
  } else {
    ctx.fillStyle = '#7a1f2b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(r * 0.62)}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(label, cx, cy + r * 0.04);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(3, r * 0.07);
  ctx.strokeStyle = ring;
  ctx.stroke();
}

/** Maroon gradient with faint diagonal gold stripes. */
export function drawBackground(ctx, w, h, { background, stripe }) {
  const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
  g.addColorStop(0, background[0]);
  g.addColorStop(0.5, background[1]);
  g.addColorStop(1, background[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.strokeStyle = stripe;
  ctx.lineWidth = 46;
  for (let x = -h; x < w; x += 150) {
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x + h, 0);
    ctx.stroke();
  }
  ctx.restore();
}
