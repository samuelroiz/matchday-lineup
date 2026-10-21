// Browser-only image helpers: shrink uploads before storing, and decode stored blobs for drawing.

export const MAX_PHOTO_SIZE = 1200;

async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Resize so the longest side is at most maxSize. Always re-encodes (strips EXIF, fixes rotation). */
export async function resizeImage(file, maxSize = MAX_PHOTO_SIZE, { type = 'image/jpeg', quality = 0.88 } = {}) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('Please choose an image file (JPEG, PNG, WebP or HEIC).');
  let img;
  try { img = await decode(file); } catch {
    throw new Error('That image could not be read. Try a JPEG or PNG.');
  }
  const w0 = img.width || img.naturalWidth;
  const h0 = img.height || img.naturalHeight;
  const scale = Math.min(1, maxSize / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  img.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new Error('Could not process that image.');
  return blob;
}

const bitmapCache = new Map();

/** Decoded image for a stored photo id, cached. Returns null if missing or unreadable. */
export async function photoImage(store, id) {
  if (!id) return null;
  if (bitmapCache.has(id)) return bitmapCache.get(id);
  const rec = await store.get('photos', id);
  let img = null;
  if (rec?.blob) {
    try { img = await decode(rec.blob); } catch { img = null; }
  }
  bitmapCache.set(id, img);
  return img;
}

// Not closed here: a renderer built earlier may still be drawing it. GC reclaims it.
export function forgetPhoto(id) {
  bitmapCache.delete(id);
}

/** Load an image by URL; resolves null if it fails (e.g. the club logo hasn't been added yet). */
export function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
