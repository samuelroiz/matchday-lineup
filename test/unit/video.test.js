// The video renderer drawn onto a recording mock canvas: what text and photos are on screen when.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_TEMPLATE, buildTimeline } from '../../js/timeline.js';
import { ALL_SLOTS, normalizeMatch, normalizePlayer, visibleStats } from '../../js/model.js';
import { createVideoRenderer } from '../../js/video.js';
import { MockCtx, fakeImage, installOffscreenCanvas } from '../helpers/mockctx.js';

installOffscreenCanvas();

const player = (slot) => normalizePlayer({
  id: `p${slot}`, name: `Player${slot} Surname${slot}`, nickname: `Nick${slot}`, positions: ['Prop'],
  heightCm: 180 + slot, weightKg: 90 + slot, years: 30 + slot, caps: 100 + slot * 3, // no clash with shirt numbers
});

function renderData(slots, opponentLogo = null) {
  const selection = Object.fromEntries(slots.map((s) => [s, `p${s}`]));
  return {
    selection,
    data: {
      match: normalizeMatch({ opponent: 'Santa Monica', date: '2026-10-24', kickoff: '14:30', venue: 'Balboa', selection }),
      units: 'imperial',
      photoStyle: 'off',
      logo: null,
      opponentLogo,
      slots: Object.fromEntries(ALL_SLOTS.map((s) => [s, selection[s]
        ? { player: player(s), serious: { img: fakeImage(`serious-${s}`), crop: null }, fun: { img: fakeImage(`fun-${s}`), crop: null } }
        : null])),
      coaches: [],
      coachById: {},
    },
  };
}

function frame(renderer, t) {
  const ctx = new MockCtx();
  renderer.draw(ctx, t);
  return ctx;
}

// Stats as drawn on a big card (label over value) or a bench card (value only).
const statTexts = (slot, compact) => visibleStats(player(slot), 'imperial')
  .filter((s) => !compact || ['height', 'weight'].includes(s.key))
  .map((s) => s.value);

const shown = (ctx, text) => ctx.texts.some((x) => x.text === text && x.alpha > 0);
const funShown = (ctx, slot) => ctx.images.some((i) => i.img.tag === `fun-${slot}` && i.alpha > 0);

// Short and single-card groups (and a full one) — the case where Crossfade lost the stats.
const LINEUPS = {
  'one per group': [1, 4, 9, 12, 11, 16],
  'two per group': [1, 2, 4, 5, 9, 10, 12, 13, 16, 17],
  'full team': ALL_SLOTS,
};

for (const [name, slots] of Object.entries(LINEUPS)) {
  test(`stats appear with the Fun photo in every group, flip and crossfade alike (${name})`, () => {
    const { data, selection } = renderData(slots);
    const timeline = buildTimeline(VIDEO_TEMPLATE, { selection });
    const renderers = Object.fromEntries(['flip', 'crossfade'].map((transition) => {
      const template = { ...VIDEO_TEMPLATE, transition };
      return [transition, createVideoRenderer(data, timeline, template)];
    }));
    for (const seg of timeline.segments.filter((s) => s.type === 'group')) {
      for (const card of seg.cards) {
        const stats = statTexts(card.slot, seg.compact);
        assert.ok(stats.length, 'test players have stats to show');
        // Sample through the change and the Fun hold.
        const times = [];
        for (let t = card.flipStart - 0.1; t <= card.outStart; t += 0.05) times.push(t);
        for (const t of times) {
          const f = frame(renderers.flip, t);
          const c = frame(renderers.crossfade, t);
          const label = `${seg.key} #${card.slot} at ${t.toFixed(2)}s`;
          for (const s of stats) {
            assert.equal(shown(c, s), shown(f, s), `${label}: crossfade shows "${s}" exactly when flip does`);
          }
          assert.equal(funShown(c, card.slot), stats.every((s) => shown(c, s)), `${label}: crossfade Fun photo and stats appear together`);
          assert.equal(funShown(f, card.slot), stats.every((s) => shown(f, s)), `${label}: flip Fun photo and stats appear together`);
        }
        // Once changed, both show every stat at full strength.
        const settled = (card.flipEnd + card.outStart) / 2;
        for (const r of Object.values(renderers)) {
          const ctx = frame(r, settled);
          for (const s of stats) {
            assert.ok(ctx.texts.some((x) => x.text === s && x.alpha === 1), `${seg.key} #${card.slot}: "${s}" drawn at full strength`);
          }
        }
      }
    }
  });
}

test('the intro leaves out a missing opponent logo and stays centred', () => {
  const { data, selection } = renderData([1]);
  const timeline = buildTimeline(VIDEO_TEMPLATE, { selection });
  const extent = (ctx) => {
    const ys = ctx.texts.map((x) => x.y);
    const logoTop = Math.min(...ctx.arcs.map((a) => a.y - a.r));
    return { top: Math.min(logoTop, ...ys), bottom: Math.max(...ys) };
  };
  const without = frame(createVideoRenderer(data, timeline), 0);
  // Background crest + club logo; nothing drawn where an opponent logo would go.
  const circlesWithout = without.arcs.length;
  const withLogo = frame(createVideoRenderer({ ...data, opponentLogo: fakeImage('opp', 400, 400) }, timeline), 0);
  assert.equal(withLogo.arcs.length, circlesWithout + 2, 'an opponent logo is a filled circle plus a ring');
  assert.ok(!without.images.some((i) => i.img.tag === 'opp'));
  const e = extent(without);
  const middle = (e.top + e.bottom) / 2;
  assert.ok(Math.abs(middle - VIDEO_TEMPLATE.height / 2) <= 40, `intro block centred at ${middle}, frame middle ${VIDEO_TEMPLATE.height / 2}`);
  for (const x of without.texts) assert.equal(x.x, VIDEO_TEMPLATE.width / 2, `"${x.text}" centred across`);
});
