// Photo picker with a crop editor: choose a file, auto crop on the face, drag to move,
// slider (or +/-) to zoom. The frame is the card's 4:5 shape, drawn with the same code
// the card, team sheet and video use, in the current photo style.

import { CROP_ASPECT, ZOOM_MAX, ZOOM_MIN, clampCrop, defaultCrop, faceCrop, panCrop, zoomCrop } from './crop.js';
import { drawPhoto, imageSize } from './photodraw.js';
import { detectFace } from './face.js';
import { resizeImage } from './images.js';
import { el, toast } from './dialog.js';

const STATUS = {
  face: 'Face found and centred. Drag or zoom to adjust.',
  default: 'No face found, so it starts top-centre. Drag or zoom to adjust.',
  manual: 'Drag the photo to move it. Use the slider to zoom.',
};

async function decode(blob) {
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

/** Auto crop for a freshly uploaded image. */
export async function autoCrop(img) {
  const { w, h } = imageSize(img);
  const face = await detectFace(img);
  return face ? faceCrop(face, w, h) : clampCrop(defaultCrop(), w, h);
}

/**
 * existing: { img, crop } of the stored photo, or null.
 * Returns { element, result() } where result() is
 *   { changed: false } | { removed: true } | { blob, crop } (new photo) | { crop } (re-cropped).
 */
export function createPhotoPicker({ label, kind, existing = null, getStyle = () => 'off' }) {
  let img = existing?.img || null;
  let crop = existing?.img ? clampCrop(existing.crop || defaultCrop(), imageSize(img).w, imageSize(img).h) : null;
  let blob = null;
  let removed = false;
  let cropTouched = false;
  let dragging = false;

  const canvas = el('canvas', { class: 'crop-canvas', tabindex: '0', 'aria-label': `${label}: drag to move, plus and minus to zoom` });
  const empty = el('span', { class: 'photo-empty' }, 'No photo');
  const frame = el('div', { class: 'photo-frame crop-frame' }, canvas, empty);
  const zoom = el('input', { type: 'range', class: 'crop-zoom', min: String(ZOOM_MIN), max: String(ZOOM_MAX), step: '0.01', value: '1', 'aria-label': `${label} zoom` });
  const autoBtn = el('button', { type: 'button', class: 'btn btn-small', 'data-autocrop': '' }, 'Auto crop');
  const controls = el('div', { class: 'crop-controls' }, el('label', { class: 'zoom-label' }, 'Zoom', zoom), autoBtn);
  const status = el('p', { class: 'crop-status' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', name: `photo-${kind}`, hidden: true });
  const choose = el('label', { class: 'btn btn-small file-btn' }, 'Choose…', fileInput);
  const clear = el('button', { type: 'button', class: 'btn btn-small', 'data-clear': '' }, 'Remove');
  const element = el('div', { class: 'photo-pick', dataset: { kind } },
    el('span', { class: 'photo-label' }, label), frame, controls, status, el('div', { class: 'photo-buttons' }, choose, clear));

  function draw() {
    const has = !!img;
    canvas.hidden = !has;
    empty.hidden = has;
    controls.hidden = !has;
    clear.hidden = !has;
    if (!has) { status.textContent = ''; return; }
    const cssW = frame.clientWidth || 200;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const W = Math.round(cssW * dpr);
    const H = Math.round(W / CROP_ASPECT);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    // Skip the photo style while dragging so it keeps up with the pointer.
    drawPhoto(ctx, { img, crop }, 0, 0, W, H, dragging ? 'off' : getStyle());
    zoom.value = String(crop.zoom);
    canvas.dataset.crop = JSON.stringify(crop);
  }

  const setStatus = (source) => { status.textContent = STATUS[source] || STATUS.manual; };

  let last = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!img) return;
    dragging = true;
    last = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const { w, h } = imageSize(img);
    crop = panCrop(crop, e.clientX - last.x, e.clientY - last.y, w, h, canvas.clientWidth || frame.clientWidth);
    last = { x: e.clientX, y: e.clientY };
    cropTouched = true;
    draw();
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('dragging');
    setStatus('manual');
    draw();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('keydown', (e) => {
    if (!img) return;
    const { w, h } = imageSize(img);
    const step = 8;
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) crop = panCrop(crop, ...moves[e.key], w, h, canvas.clientWidth || 200);
    else if (e.key === '+' || e.key === '=') crop = zoomCrop(crop, crop.zoom + 0.1, w, h);
    else if (e.key === '-') crop = zoomCrop(crop, crop.zoom - 0.1, w, h);
    else return;
    e.preventDefault();
    cropTouched = true;
    setStatus('manual');
    draw();
  });
  zoom.addEventListener('input', () => {
    const { w, h } = imageSize(img);
    crop = zoomCrop(crop, Number(zoom.value), w, h);
    cropTouched = true;
    setStatus('manual');
    draw();
  });
  autoBtn.addEventListener('click', async () => {
    autoBtn.disabled = true;
    status.textContent = 'Looking for a face…';
    try {
      crop = await autoCrop(img);
      cropTouched = true;
      setStatus(crop.source);
      draw();
    } finally { autoBtn.disabled = false; }
  });
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    element.classList.add('busy');
    status.textContent = 'Resizing and looking for a face…';
    try {
      const resized = await resizeImage(file);
      const decoded = await decode(resized);
      crop = await autoCrop(decoded);
      img = decoded;
      blob = resized;
      removed = false;
      setStatus(crop.source);
      draw();
    } catch (err) {
      toast(err.message, { type: 'error' });
      status.textContent = '';
    } finally {
      element.classList.remove('busy');
    }
  });
  clear.addEventListener('click', () => {
    img = null;
    crop = null;
    blob = null;
    removed = true;
    draw();
  });

  // The frame has no size until the dialog is on screen.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => draw()).observe(frame);
  draw();
  if (img) setStatus(existing.crop ? 'manual' : 'default');

  return {
    element,
    redraw: draw,
    result() {
      if (blob) return { blob, crop };
      if (removed) return existing ? { removed: true } : { changed: false };
      if (cropTouched && img) return { crop };
      return { changed: false };
    },
  };
}
