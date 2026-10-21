import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPEEDS, VIDEO_TEMPLATE, buildTimeline, cardRects, cardState, segmentAt, titleState } from '../../js/timeline.js';
import { ALL_SLOTS, normalizeMatch } from '../../js/model.js';
import { pickVideoFormat } from '../../js/video.js';

const fullSelection = Object.fromEntries(ALL_SLOTS.map((s) => [s, `p${s}`]));
const EPS = 1e-9;

test('a full team runs 45-60 seconds at normal speed', () => {
  const tl = buildTimeline(VIDEO_TEMPLATE, { speed: 1, selection: fullSelection });
  assert.ok(tl.duration >= 45 && tl.duration <= 60, `duration ${tl.duration}`);
  assert.equal(tl.frameCount, Math.ceil(tl.duration * 30));
});

test('sequence is intro, the six units in order, bench, then the team sheet', () => {
  const tl = buildTimeline(VIDEO_TEMPLATE, { selection: fullSelection });
  assert.deepEqual(tl.segments.map((s) => s.key || s.type),
    ['intro', 'front', 'locks', 'backrow', 'halves', 'centres', 'backthree', 'bench', 'sheet']);
  const slots = tl.segments.filter((s) => s.type === 'group').map((s) => s.slots);
  assert.deepEqual(slots, [[1, 2, 3], [4, 5], [6, 7, 8], [9, 10], [12, 13], [11, 14, 15], [16, 17, 18, 19, 20, 21, 22, 23]]);
});

test('segments are back to back with no gaps or overlaps', () => {
  const tl = buildTimeline(VIDEO_TEMPLATE, { selection: fullSelection });
  assert.equal(tl.segments[0].start, 0);
  for (let i = 1; i < tl.segments.length; i++) {
    assert.ok(Math.abs(tl.segments[i].start - tl.segments[i - 1].end) < EPS, `gap before ${i}`);
  }
  assert.ok(Math.abs(tl.segments.at(-1).end - tl.duration) < EPS);
});

test('the full team sheet is held for 3 seconds at every speed', () => {
  for (const { value } of SPEEDS) {
    const sheet = buildTimeline(VIDEO_TEMPLATE, { speed: value }).segments.at(-1);
    assert.equal(sheet.type, 'sheet');
    assert.ok(Math.abs(sheet.end - sheet.inEnd - 3) < EPS);
  }
});

test('faster speed means a shorter video, never below the 3 s hold', () => {
  const durations = SPEEDS.map((s) => buildTimeline(VIDEO_TEMPLATE, { speed: s.value }).duration);
  for (let i = 1; i < durations.length; i++) assert.ok(durations[i] < durations[i - 1]);
  assert.ok(buildTimeline(VIDEO_TEMPLATE, { speed: 100 }).duration > 3);
  assert.throws(() => buildTimeline(VIDEO_TEMPLATE, { speed: 0 }));
});

test('each card slides in, shows Serious, flips to Fun, then slides out', () => {
  const tl = buildTimeline(VIDEO_TEMPLATE, { selection: fullSelection });
  for (const seg of tl.segments.filter((s) => s.type === 'group')) {
    for (const c of seg.cards) {
      assert.ok(seg.start <= c.inStart && c.inStart < c.inEnd);
      assert.ok(c.inEnd < c.flipStart && c.flipStart < c.flipEnd);
      assert.ok(c.flipEnd < c.outStart && c.outStart < c.outEnd && c.outEnd <= seg.end);
    }
    // Every card is in place before the first one flips, and flipped before the first one leaves.
    const lastIn = Math.max(...seg.cards.map((c) => c.inEnd));
    const firstFlip = Math.min(...seg.cards.map((c) => c.flipStart));
    const lastFlip = Math.max(...seg.cards.map((c) => c.flipEnd));
    const firstOut = Math.min(...seg.cards.map((c) => c.outStart));
    assert.ok(lastIn < firstFlip && lastFlip < firstOut, seg.key);
  }
});

test('cardState moves through enter, flip and exit', () => {
  const tl = buildTimeline(VIDEO_TEMPLATE, { selection: fullSelection });
  const c = tl.segments[1].cards[0];
  assert.equal(cardState(c, c.inStart - 0.01).visible, false);
  assert.equal(cardState(c, c.inEnd).enter, 1);
  const serious = cardState(c, (c.inEnd + c.flipStart) / 2);
  assert.deepEqual([serious.visible, serious.flip, serious.exit], [true, 0, 0]);
  const mid = cardState(c, (c.flipStart + c.flipEnd) / 2);
  assert.ok(mid.flip > 0.4 && mid.flip < 0.6);
  assert.equal(cardState(c, c.flipEnd).flip, 1);
  assert.equal(cardState(c, c.outEnd).visible, false);
  const ts = titleState(tl.segments[1], (c.inEnd + c.flipStart) / 2);
  assert.equal(ts.alpha, 1);
});

test('segmentAt finds the segment on screen, clamping at both ends', () => {
  const tl = buildTimeline(VIDEO_TEMPLATE, { selection: fullSelection });
  assert.equal(segmentAt(tl, -1).type, 'intro');
  assert.equal(segmentAt(tl, 0).type, 'intro');
  const front = tl.segments[1];
  assert.equal(segmentAt(tl, front.start + 0.01).key, 'front');
  assert.equal(segmentAt(tl, front.end).key, 'locks');
  assert.equal(segmentAt(tl, tl.duration + 10).type, 'sheet');
});

test('empty shirts get no card and empty groups are skipped', () => {
  const sel = normalizeMatch({ selection: { 1: 'a', 3: 'c', 10: 'd' } }).selection;
  const tl = buildTimeline(VIDEO_TEMPLATE, { selection: sel });
  const groups = tl.segments.filter((s) => s.type === 'group');
  assert.deepEqual(groups.map((g) => [g.key, g.slots]), [['front', [1, 3]], ['halves', [10]]]);
  assert.ok(tl.duration < buildTimeline(VIDEO_TEMPLATE, { selection: fullSelection }).duration);
});

test('timings come from the template, so a restyle is a data change', () => {
  const quick = {
    ...VIDEO_TEMPLATE,
    timings: { ...VIDEO_TEMPLATE.timings, holdSerious: 0.5, holdFun: 0.5 },
    groups: [{ key: 'all', title: 'Everyone', slots: [1, 2] }],
  };
  const tl = buildTimeline(quick);
  assert.deepEqual(tl.segments.map((s) => s.key || s.type), ['intro', 'all', 'sheet']);
  const c = tl.segments[1].cards[1];
  assert.ok(Math.abs(c.flipStart - (tl.segments[1].start + 0.7 + 0.15 + 0.5 + 0.15)) < EPS);
});

test('card rectangles stay on the canvas and never overlap', () => {
  const T = VIDEO_TEMPLATE;
  for (const [n, compact] of [[1, false], [2, false], [3, false], [8, true], [7, true]]) {
    const rects = cardRects(T, n, compact);
    assert.equal(rects.length, n);
    for (const r of rects) {
      assert.ok(r.x >= 0 && r.y >= T.layout.cardsTop - EPS && r.x + r.w <= T.width && r.y + r.h <= T.layout.cardsBottom + EPS, JSON.stringify(r));
    }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = rects[i];
      const b = rects[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.equal(overlap, false, `cards ${i} and ${j} of ${n} overlap`);
    }
  }
});

test('video format prefers MP4 and falls back to WebM', () => {
  assert.equal(pickVideoFormat((t) => t.startsWith('video/mp4')).ext, 'mp4');
  const webm = pickVideoFormat((t) => t.startsWith('video/webm'));
  assert.deepEqual([webm.ext, webm.type], ['webm', 'video/webm']);
  assert.equal(pickVideoFormat(() => false), null);
});
