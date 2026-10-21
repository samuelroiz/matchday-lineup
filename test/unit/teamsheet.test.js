import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEAM_SHEET_SIZES, coachesLine, layoutTeamSheet } from '../../js/teamsheet.js';
import { BENCH_SLOTS, STARTER_SLOTS } from '../../js/model.js';

test('team sheet sizes match Instagram post and story', () => {
  assert.deepEqual([TEAM_SHEET_SIZES.post.width, TEAM_SHEET_SIZES.post.height], [1080, 1350]);
  assert.deepEqual([TEAM_SHEET_SIZES.story.width, TEAM_SHEET_SIZES.story.height], [1080, 1920]);
  assert.throws(() => layoutTeamSheet('square'));
});

for (const size of Object.keys(TEAM_SHEET_SIZES)) {
  test(`${size}: 15 cards and 8 bench entries fit without overlapping`, () => {
    const L = layoutTeamSheet(size);
    const boxes = [L.header, ...STARTER_SLOTS.map((s) => L.cards[s]), L.bench];
    assert.equal(Object.keys(L.cards).length, 15);
    assert.equal(Object.keys(L.bench.entries).length, 8);
    for (const b of boxes) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= L.width + 1e-6 && b.y + b.h <= L.height, JSON.stringify(b));
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `boxes ${i} and ${j} overlap`);
    }
    for (const s of BENCH_SLOTS) {
      const e = L.bench.entries[s];
      assert.ok(e.y >= L.bench.y && e.y + e.h <= L.bench.y + L.bench.h + 1e-6);
    }
    assert.ok(L.coaches.y > L.bench.y + L.bench.h + 20, 'coaches line sits under the replacements');
    assert.ok(L.footerY > L.coaches.y + 20 && L.footerY < L.height);
  });
}

test('coaches are listed in one line with their roles', () => {
  assert.equal(coachesLine([{ coach: { name: 'Dana Whitfield', role: 'Head coach' } }, { coach: { name: 'Ray Nakamura', role: '' } }]),
    'Dana Whitfield (Head coach)  ·  Ray Nakamura');
  assert.equal(coachesLine([]), '');
});
