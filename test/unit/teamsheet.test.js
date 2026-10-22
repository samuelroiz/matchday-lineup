import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEAM_SHEET_SIZES, coachesLine, drawTeamSheet, layoutTeamSheet } from '../../js/teamsheet.js';
import { BENCH_SLOTS, STARTER_SLOTS, normalizeMatch } from '../../js/model.js';
import { MockCtx, fakeImage } from '../helpers/mockctx.js';

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
    assert.ok(L.coaches.yNoBench > L.bench.y && L.coaches.yNoBench < L.coaches.y - 100, 'with no bench the coaches line moves up');
  });
}

test('coaches are listed in one line with their roles', () => {
  assert.equal(coachesLine([{ coach: { name: 'Dana Whitfield', role: 'Head coach' } }, { coach: { name: 'Ray Nakamura', role: '' } }]),
    'Dana Whitfield (Head coach)  ·  Ray Nakamura');
  assert.equal(coachesLine([]), '');
});

for (const size of Object.keys(TEAM_SHEET_SIZES)) {
  test(`${size}: no opponent logo means no placeholder, and the header is centred`, () => {
    const L = layoutTeamSheet(size);
    const match = normalizeMatch({ opponent: 'Santa Monica', date: '2026-10-24', kickoff: '14:30', venue: 'Balboa Sports Complex, Encino' });
    const draw = (opponentLogo) => {
      const ctx = new MockCtx({ width: L.width, height: L.height });
      drawTeamSheet(ctx, size, { match, logo: fakeImage('sfv'), opponentLogo, slots: {}, coaches: [] });
      return ctx;
    };
    const inHeader = (ctx) => ctx.arcs.filter((a) => a.y > L.header.y && a.y < L.header.y + L.header.h && a.r > L.header.h * 0.3);
    const without = draw(null);
    const withLogo = draw(fakeImage('opp', 300, 300));
    assert.equal(inHeader(withLogo).length, 4, 'two logos: fill and ring each');
    assert.equal(inHeader(without).length, 2, 'only the club logo is drawn');
    // The club logo plus the widest header line, as one block, sits in the middle.
    const logo = inHeader(without)[0];
    const header = without.texts.filter((t) => t.y > L.header.y && t.y < L.header.y + L.header.h);
    const right = Math.max(...header.map((t) => t.x + t.w / 2));
    const left = logo.x - logo.r;
    assert.ok(Math.abs((left + right) / 2 - L.width / 2) < 2, `block ${left.toFixed(0)}..${right.toFixed(0)} on a ${L.width} sheet`);
    const cx = header[0].x;
    for (const t of header) assert.equal(t.x, cx, 'header lines share one centre');
    assert.ok(cx - Math.max(...header.map((t) => t.w)) / 2 > logo.x + logo.r, 'text clears the logo');
  });
}
