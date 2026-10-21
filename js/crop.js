// Photo crops as data. A crop is { cx, cy, zoom, source }:
//   cx, cy  centre of the crop as a share of the image width/height (0-1)
//   zoom    1 = the largest card-shaped area that fits the image; 2 = half that size, ...
//   source  'face' (auto-cropped on a detected face), 'default' (top-centre) or 'manual'
// The stored photo is never cut; every renderer asks sourceRectForBox() which part to draw.
// Pure: no DOM, imported by Node tests.

export const CROP_ASPECT = 4 / 5; // width / height of a player card photo
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
// Where an auto crop puts the face: its height as a share of the crop height, and the
// face centre's distance from the crop top as a share of the crop height.
export const FACE_TARGET = { height: 0.3, centerY: 0.4 };
const SOURCES = ['face', 'default', 'manual'];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Top-centre: used when no face is found and for photos saved before crops existed. */
export function defaultCrop() {
  return { cx: 0.5, cy: 0, zoom: 1, source: 'default' };
}

export function normalizeCrop(c) {
  if (!c || typeof c !== 'object') return null;
  const num = (v, d) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
  return {
    cx: clamp(num(c.cx, 0.5), 0, 1),
    cy: clamp(num(c.cy, 0), 0, 1),
    zoom: clamp(num(c.zoom, 1), ZOOM_MIN, ZOOM_MAX),
    source: SOURCES.includes(c.source) ? c.source : 'manual',
  };
}

/** Error message, or null when the crop is fine (no crop at all is fine too). */
export function validateCrop(c) {
  if (c === null || c === undefined) return null;
  if (typeof c !== 'object') return 'Crop is not readable.';
  for (const k of ['cx', 'cy']) {
    if (!Number.isFinite(c[k]) || c[k] < 0 || c[k] > 1) return 'Crop position is out of range.';
  }
  if (!Number.isFinite(c.zoom) || c.zoom < ZOOM_MIN || c.zoom > ZOOM_MAX) return `Zoom must be between ${ZOOM_MIN} and ${ZOOM_MAX}.`;
  if (!SOURCES.includes(c.source)) return 'Unknown crop source.';
  return null;
}

/** Largest rectangle of the given shape that fits inside the image. */
function baseSize(iw, ih, aspect) {
  return iw / ih > aspect ? { w: ih * aspect, h: ih } : { w: iw, h: iw / aspect };
}

/** The card-shaped area of the image (in image pixels) the crop selects, kept inside the image. */
export function cropRect(crop, iw, ih) {
  const c = crop || defaultCrop();
  const b = baseSize(iw, ih, CROP_ASPECT);
  const w = b.w / c.zoom;
  const h = b.h / c.zoom;
  return {
    x: clamp(c.cx * iw - w / 2, 0, iw - w),
    y: clamp(c.cy * ih - h / 2, 0, ih - h),
    w,
    h,
  };
}

/** Same crop with its centre moved to where cropRect actually lands (so stored values match what's shown). */
export function clampCrop(crop, iw, ih) {
  const c = normalizeCrop(crop) || defaultCrop();
  const r = cropRect(c, iw, ih);
  return { ...c, cx: (r.x + r.w / 2) / iw, cy: (r.y + r.h / 2) / ih };
}

/**
 * The image area to draw into a box of any shape (team sheet card, video card, squad card).
 * Keeps the crop's height, so heads stay the same size everywhere, and widens or narrows it
 * around the crop centre. If the image runs out, it shrinks while keeping the face line in place.
 */
export function sourceRectForBox(crop, iw, ih, boxAspect) {
  const r = cropRect(crop, iw, ih);
  let h = r.h;
  let w = h * boxAspect;
  if (w > iw) { w = iw; h = w / boxAspect; }
  if (h > ih) { h = ih; w = h * boxAspect; }
  const faceLine = r.y + FACE_TARGET.centerY * r.h;
  return {
    x: clamp(r.x + r.w / 2 - w / 2, 0, iw - w),
    y: clamp(faceLine - FACE_TARGET.centerY * h, 0, ih - h),
    w,
    h,
  };
}

/** Auto crop from a detected face box { x, y, w, h } in image pixels. */
export function faceCrop(face, iw, ih) {
  const b = baseSize(iw, ih, CROP_ASPECT);
  const zoom = clamp(b.h / (face.h / FACE_TARGET.height), ZOOM_MIN, ZOOM_MAX);
  const h = b.h / zoom;
  const fcx = face.x + face.w / 2;
  const fcy = face.y + face.h / 2;
  const top = fcy - FACE_TARGET.centerY * h;
  return clampCrop({ cx: fcx / iw, cy: (top + h / 2) / ih, zoom, source: 'face' }, iw, ih);
}

/** Drag in the editor: dx, dy are pointer moves in frame pixels; frameW is the frame's width. */
export function panCrop(crop, dx, dy, iw, ih, frameW) {
  const r = cropRect(crop, iw, ih);
  const scale = r.w / frameW; // image pixels per frame pixel
  const cx = (r.x + r.w / 2 - dx * scale) / iw;
  const cy = (r.y + r.h / 2 - dy * scale) / ih;
  return clampCrop({ ...crop, cx, cy, source: 'manual' }, iw, ih);
}

/** Zoom slider: keeps the centre where it is. */
export function zoomCrop(crop, zoom, iw, ih) {
  return clampCrop({ ...(crop || defaultCrop()), zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX), source: 'manual' }, iw, ih);
}
