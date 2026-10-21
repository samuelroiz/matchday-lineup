// Face detection with MediaPipe BlazeFace, bundled in vendor/mediapipe (no CDN, no server).
// Loaded lazily the first time a photo is uploaded. Any failure just means "no face found".

import { imageSize } from './photodraw.js';

const BASE = new URL('../vendor/mediapipe/', import.meta.url).href;
const MAX_SIDE = 640;
let detectorPromise = null;

function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FaceDetector } = await import('../vendor/mediapipe/vision_bundle.mjs');
      return FaceDetector.createFromOptions(
        { wasmLoaderPath: BASE + 'vision_wasm_internal.js', wasmBinaryPath: BASE + 'vision_wasm_internal.wasm' },
        {
          baseOptions: { modelAssetPath: BASE + 'blaze_face_short_range.tflite', delegate: 'CPU' },
          runningMode: 'IMAGE',
          minDetectionConfidence: 0.5,
        },
      );
    })();
    detectorPromise.catch(() => { detectorPromise = null; });
  }
  return detectorPromise;
}

function regionCanvas(img, r) {
  const scale = Math.min(1, MAX_SIDE / Math.max(r.w, r.h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(r.w * scale));
  c.height = Math.max(1, Math.round(r.h * scale));
  c.getContext('2d').drawImage(img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return { canvas: c, scale };
}

/** Largest face in the image as { x, y, w, h } in image pixels, or null. */
export async function detectFace(img) {
  let detector;
  try { detector = await getDetector(); } catch (e) {
    console.warn('Face detection unavailable', e);
    return null;
  }
  const { w: iw, h: ih } = imageSize(img);
  // The model works best when the face fills a good part of the frame, so after the whole
  // photo also try the top-centre square, where heads usually are in full-length shots.
  const side = Math.min(iw, ih * 0.6);
  const regions = [{ x: 0, y: 0, w: iw, h: ih }, { x: (iw - side) / 2, y: 0, w: side, h: side }];
  for (const r of regions) {
    const { canvas, scale } = regionCanvas(img, r);
    let found = [];
    try { found = detector.detect(canvas).detections || []; } catch (e) { console.warn('Face detection failed', e); return null; }
    const boxes = found.map((d) => d.boundingBox).filter(Boolean);
    if (!boxes.length) continue;
    const best = boxes.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
    return { x: r.x + best.originX / scale, y: r.y + best.originY / scale, w: best.width / scale, h: best.height / scale };
  }
  return null;
}
