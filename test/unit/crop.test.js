import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CROP_ASPECT, FACE_TARGET, ZOOM_MAX, clampCrop, cropRect, defaultCrop, faceCrop, normalizeCrop,
  panCrop, sourceRectForBox, validateCrop, zoomCrop,
} from '../../js/crop.js';
import { normalizePlayer, validatePlayer } from '../../js/model.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const inside = (r, iw, ih) => r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= iw + 1e-9 && r.y + r.h <= ih + 1e-9;

test('crop data is normalized and validated', () => {
  assert.deepEqual(normalizeCrop({ cx: 2, cy: -1, zoom: 9, source: 'face' }), { cx: 1, cy: 0, zoom: ZOOM_MAX, source: 'face' });
  assert.deepEqual(normalizeCrop({ cx: 'x' }), { cx: 0.5, cy: 0, zoom: 1, source: 'manual' });
  assert.equal(normalizeCrop(null), null);
  assert.equal(validateCrop(null), null);
  assert.equal(validateCrop(defaultCrop()), null);
  assert.match(validateCrop({ cx: 0.5, cy: 0.5, zoom: 0.5, source: 'manual' }), /Zoom/);
  assert.match(validateCrop({ cx: 1.5, cy: 0.5, zoom: 1, source: 'manual' }), /position/);
  assert.match(validateCrop({ cx: 0.5, cy: 0.5, zoom: 1, source: 'magic' }), /source/);
});

test('players keep a crop per photo, and a bad crop is rejected', () => {
  const p = normalizePlayer({ name: 'A B', crops: { serious: { cx: 0.4, cy: 0.3, zoom: 2, source: 'face' } } });
  assert.deepEqual(p.crops, { serious: { cx: 0.4, cy: 0.3, zoom: 2, source: 'face' }, fun: null });
  assert.deepEqual(validatePlayer(p), {});
  assert.ok(validatePlayer({ ...p, crops: { serious: { cx: 0.5, cy: 0.5, zoom: 99, source: 'manual' } } }).photos);
});

test('a crop is always card shaped and inside the photo', () => {
  for (const [iw, ih] of [[1200, 900], [900, 1200], [1000, 1250], [600, 2000]]) {
    for (const crop of [defaultCrop(), { cx: 0, cy: 1, zoom: 1, source: 'manual' }, { cx: 0.9, cy: 0.1, zoom: 3, source: 'manual' }]) {
      const r = cropRect(crop, iw, ih);
      assert.ok(near(r.w / r.h, CROP_ASPECT), `${iw}x${ih}`);
      assert.ok(inside(r, iw, ih), JSON.stringify({ iw, ih, r }));
    }
  }
  // zoom 2 halves the size
  assert.ok(near(cropRect({ cx: 0.5, cy: 0.5, zoom: 2, source: 'manual' }, 1000, 1000).h, 500));
});

test('no face: top-centre', () => {
  const r = cropRect(defaultCrop(), 1200, 1600);
  assert.equal(r.y, 0);
  assert.ok(near(r.x + r.w / 2, 600));
  assert.ok(near(r.h, 1500)); // full width at 4:5
});

test('auto crop puts every head at the same size and height', () => {
  // Framed very differently: small face, big face, landscape shot.
  const shots = [
    { iw: 1200, ih: 1600, face: { x: 500, y: 300, w: 220, h: 260 } },
    { iw: 900, ih: 1200, face: { x: 300, y: 350, w: 260, h: 300 } },
    { iw: 1600, ih: 1000, face: { x: 900, y: 250, w: 170, h: 200 } },
  ];
  for (const { iw, ih, face } of shots) {
    const crop = faceCrop(face, iw, ih);
    assert.equal(crop.source, 'face');
    const r = cropRect(crop, iw, ih);
    assert.ok(near(face.h / r.h, FACE_TARGET.height, 1e-3), `face height share ${face.h / r.h}`);
    assert.ok(near((face.y + face.h / 2 - r.y) / r.h, FACE_TARGET.centerY, 1e-3), 'face line');
    assert.ok(near(face.x + face.w / 2, r.x + r.w / 2, 1e-3), 'face centred');
  }
});

test('auto crop on a face near the edge stays inside the photo', () => {
  const crop = faceCrop({ x: 0, y: 0, w: 200, h: 220 }, 1000, 1400);
  const r = cropRect(crop, 1000, 1400);
  assert.ok(inside(r, 1000, 1400));
  assert.equal(r.x, 0);
  assert.equal(r.y, 0);
});

test('drawing into any box keeps the head size and fits the box shape', () => {
  const crop = { cx: 0.5, cy: 0.4, zoom: 2, source: 'manual' };
  const r = cropRect(crop, 1200, 1500);
  for (const aspect of [0.73, 0.8, 0.82, 0.64, 1]) {
    const s = sourceRectForBox(crop, 1200, 1500, aspect);
    assert.ok(near(s.w / s.h, aspect), `aspect ${aspect}`);
    assert.ok(near(s.h, r.h), 'same height, so same head size');
    assert.ok(inside(s, 1200, 1500));
  }
  // A wide box on a narrow photo can't keep the height; it still fits and stays inside.
  const s = sourceRectForBox({ cx: 0.5, cy: 0.2, zoom: 1, source: 'manual' }, 800, 1000, 2);
  assert.ok(near(s.w, 800) && near(s.h, 400) && inside(s, 800, 1000));
});

test('dragging and zooming move the crop and keep it inside', () => {
  const iw = 1000;
  const ih = 1000;
  const start = clampCrop({ cx: 0.5, cy: 0.5, zoom: 2, source: 'face' }, iw, ih);
  // Drag the photo 50 frame px to the right in a 200 px frame -> view moves left by 100 image px.
  const moved = panCrop(start, 50, 0, iw, ih, 200);
  assert.equal(moved.source, 'manual');
  assert.ok(near(moved.cx, 0.4));
  // Dragging miles past the edge stops at the edge.
  const edge = panCrop(start, 5000, 5000, iw, ih, 200);
  const r = cropRect(edge, iw, ih);
  assert.ok(near(r.x, 0) && near(r.y, 0));
  const z = zoomCrop(start, 10, iw, ih);
  assert.equal(z.zoom, ZOOM_MAX);
  assert.ok(near(zoomCrop(start, 1, iw, ih).cy, 0.5));
});
