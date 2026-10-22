import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGrade, buildGrade, photoStats } from '../../js/photostyle.js';
import { fitName, fitNameSize } from '../../js/draw.js';
import { fixtureLine } from '../../js/teamsheet.js';
import { KICKOFF_TIMES, normalizeMatch } from '../../js/model.js';

/** n x n RGBA image: a gradient around a base colour. */
function image(n, [r, g, b], spread = 30) {
  const d = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const t = (i % n) / n - 0.5;
    d[i * 4] = r + t * spread;
    d[i * 4 + 1] = g + t * spread;
    d[i * 4 + 2] = b + t * spread;
    d[i * 4 + 3] = 255;
  }
  return d;
}
const mean = (d, c) => { let s = 0; for (let i = c; i < d.length; i += 4) s += d[i]; return s / (d.length / 4); };

test('Off leaves pixels alone', () => {
  assert.equal(buildGrade(photoStats(image(8, [50, 60, 70])), 'off'), null);
  const d = image(8, [50, 60, 70]);
  const copy = new Uint8ClampedArray(d);
  applyGrade(d, null);
  assert.deepEqual(d, copy);
});

test('Auto brightens a dark photo and darkens a bright one toward the middle', () => {
  const dark = image(16, [40, 40, 45]);
  const bright = image(16, [215, 215, 210]);
  const before = [mean(dark, 1), mean(bright, 1)];
  applyGrade(dark, buildGrade(photoStats(dark), 'auto'));
  applyGrade(bright, buildGrade(photoStats(bright), 'auto'));
  assert.ok(mean(dark, 1) > before[0] + 40, `dark ${before[0]} -> ${mean(dark, 1)}`);
  assert.ok(mean(bright, 1) < before[1] - 20, `bright ${before[1]} -> ${mean(bright, 1)}`);
});

test('Auto evens out a colour cast (within limits)', () => {
  const blue = image(16, [90, 110, 170]);
  const castBefore = mean(blue, 2) - mean(blue, 0);
  applyGrade(blue, buildGrade(photoStats(blue), 'auto'));
  const castAfter = mean(blue, 2) - mean(blue, 0);
  assert.ok(castAfter < castBefore, `${castBefore} -> ${castAfter}`);
});

test('Club grade adds a warm maroon/gold tone compared with Auto', () => {
  const a = image(16, [120, 120, 120], 200);
  const c = new Uint8ClampedArray(a);
  applyGrade(a, buildGrade(photoStats(a), 'auto'));
  applyGrade(c, buildGrade(photoStats(c), 'club'));
  assert.ok(mean(c, 0) - mean(c, 2) > mean(a, 0) - mean(a, 2) + 5, 'red leans above blue');
});

test('each style changes an ordinary, well-exposed photo enough to notice', () => {
  // A mid-tone photo with a full range of shades and some colour: the case where the old
  // grades barely moved the pixels.
  const n = 32;
  const base = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const x = (i % n) / n;
    const y = Math.floor(i / n) / n;
    base.set([30 + 200 * x, 40 + 150 * y, 60 + 120 * (1 - x), 255], i * 4);
  }
  const graded = (style) => { const d = new Uint8ClampedArray(base); applyGrade(d, buildGrade(photoStats(d), style)); return d; };
  const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) s += Math.abs(a[i + c] - b[i + c]); return s / (a.length * 0.75); };
  const looks = { off: base, auto: graded('auto'), club: graded('club') };
  for (const [a, b] of [['off', 'auto'], ['auto', 'club'], ['off', 'club']]) {
    const d = diff(looks[a], looks[b]);
    assert.ok(d >= 12, `${a} vs ${b}: average change ${d.toFixed(1)} of 255`);
  }
});

test('long names shrink to fit one line instead of wrapping', () => {
  // Stand-in for measureText: every character is 0.55 em wide.
  const measure = (t, s) => t.length * s * 0.55;
  const maxWidth = 174; // a post-size team sheet card, less padding
  const size = fitNameSize(measure, 'Christopher', 'RODRIGUEZ', maxWidth, 22);
  const width = measure('Christopher', size) + 0.25 * size + measure('RODRIGUEZ', size);
  assert.ok(width <= maxWidth, `width ${width}`);
  assert.ok(size < 22 && size > 10, `size ${size}`);
  assert.equal(fitNameSize(measure, 'Bo', 'KIM', maxWidth, 22), 22, 'short names keep the full size');
});

test('a name that would shrink a lot uses the first initial at a normal size', () => {
  const measure = (t, s) => t.length * s * 0.55;
  const long = fitName(measure, 'Christopher', 'RODRIGUEZ', 174, 22);
  assert.equal(long.first, 'C.');
  assert.ok(long.size >= 22 * 0.8, `size ${long.size}`);
  assert.deepEqual(fitName(measure, 'Mateo', 'ALVAREZ', 174, 22), { first: 'Mateo', size: 22 }, 'names that fit stay in full');
  assert.equal(fitName(measure, '', 'RODRIGUEZ', 174, 22).first, '', 'a single name has no initial to use');
});

test('the team sheet fixture line includes the kick-off time', () => {
  assert.equal(fixtureLine(normalizeMatch({ date: '2026-10-24', kickoff: '14:30' })), 'Sat, Oct 24, 2026 · Kick-off 2:30 PM');
  assert.equal(fixtureLine(normalizeMatch({ date: '2026-10-24' })), 'Sat, Oct 24, 2026');
  assert.ok(KICKOFF_TIMES.includes('12:30') && KICKOFF_TIMES.includes('14:30'));
});
