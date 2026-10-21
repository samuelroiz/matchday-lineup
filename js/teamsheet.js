// Team sheet image: 15 photo cards, the bench, logo and fixture details.
// layoutTeamSheet is pure (tested in Node); drawTeamSheet paints onto any 2D context.

import { BENCH_SLOTS, STARTER_SLOTS, formatKickoff, formatMatchDate, leaderBadge, shortName, splitName } from './model.js';
import { drawBackground, drawLeaderBadge, drawLogo, drawNameLine, drawNumberBadge, drawPlaceholder, fitText, roundRectPath } from './draw.js';
import { drawPhoto } from './photodraw.js';

export const SHEET_STYLE = {
  background: ['#5a1520', '#7a1f2b', '#3d0e16'],
  stripe: 'rgba(242, 183, 5, 0.07)',
  maroon: '#7a1f2b',
  accent: '#f2b705',
  white: '#ffffff',
  display: (s) => `800 ${Math.round(s)}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`,
  body: (s) => `600 ${Math.round(s)}px "Helvetica Neue", Arial, sans-serif`,
};

// Layout per output size. Story keeps content out of the top/bottom bands Instagram covers.
export const TEAM_SHEET_SIZES = {
  post: {
    label: 'Instagram post', width: 1080, height: 1350,
    pad: 40, headerTop: 30, headerH: 206, gridTop: 256, gridH: 800, cols: 5, gap: 14,
    benchTop: 1070, benchH: 190, benchCols: 4, coachesY: 1294, footerY: 1334,
  },
  story: {
    label: 'Instagram story', width: 1080, height: 1920,
    pad: 40, headerTop: 230, headerH: 250, gridTop: 500, gridH: 960, cols: 5, gap: 14,
    benchTop: 1482, benchH: 214, benchCols: 4, coachesY: 1740, footerY: 1782,
  },
};

export function layoutTeamSheet(sizeKey = 'post') {
  const S = TEAM_SHEET_SIZES[sizeKey];
  if (!S) throw new Error(`Unknown team sheet size: ${sizeKey}`);
  const innerW = S.width - S.pad * 2;
  const rows = Math.ceil(STARTER_SLOTS.length / S.cols);
  const cw = (innerW - S.gap * (S.cols - 1)) / S.cols;
  const ch = (S.gridH - S.gap * (rows - 1)) / rows;
  const cards = {};
  STARTER_SLOTS.forEach((slot, i) => {
    const r = Math.floor(i / S.cols);
    const c = i % S.cols;
    cards[slot] = { x: S.pad + c * (cw + S.gap), y: S.gridTop + r * (ch + S.gap), w: cw, h: ch };
  });
  const benchRows = Math.ceil(BENCH_SLOTS.length / S.benchCols);
  const bench = { x: S.pad, y: S.benchTop, w: innerW, h: S.benchH, entries: {} };
  const titleH = 50;
  const ew = (innerW - 40) / S.benchCols;
  const eh = (S.benchH - titleH - 20) / benchRows;
  BENCH_SLOTS.forEach((slot, i) => {
    // Fill down each column so the numbers read 16-17 / 18-19 ... left to right.
    const c = Math.floor(i / benchRows);
    const r = i % benchRows;
    bench.entries[slot] = { x: S.pad + 20 + c * ew, y: S.benchTop + titleH + r * eh, w: ew, h: eh };
  });
  return {
    width: S.width,
    height: S.height,
    header: { x: S.pad, y: S.headerTop, w: innerW, h: S.headerH },
    cards,
    bench,
    coaches: { x: S.pad, y: S.coachesY, w: innerW },
    footerY: S.footerY,
  };
}

/** "Sat, Oct 24, 2026 · Kick-off 2:30 PM" */
export function fixtureLine(m) {
  const ko = formatKickoff(m.kickoff);
  return [formatMatchDate(m.date), ko && `Kick-off ${ko}`].filter(Boolean).join(' · ');
}

function drawHeader(ctx, box, data, st) {
  const r = box.h * 0.4;
  const cy = box.y + box.h / 2;
  drawLogo(ctx, data.logo, box.x + r, cy, r);
  if (data.opponentLogo) drawLogo(ctx, data.opponentLogo, box.x + box.w - r, cy, r, { label: '' });
  const m = data.match;
  const textW = box.w - r * 4 - 40;
  const cx = box.x + box.w / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = st.accent;
  fitText(ctx, (m.competition || 'Matchday').toUpperCase(), cx, box.y + box.h * 0.22, textW, box.h * 0.12, st.body);
  ctx.fillStyle = st.white;
  fitText(ctx, `SFV vs ${m.opponent || 'TBC'}`.toUpperCase(), cx, box.y + box.h * 0.56, textW, box.h * 0.3, st.display);
  ctx.fillStyle = st.white;
  fitText(ctx, fixtureLine(m), cx, box.y + box.h * 0.76, textW, box.h * 0.12, st.body);
  if (m.venue) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    fitText(ctx, m.venue, cx, box.y + box.h * 0.93, textW, box.h * 0.1, st.body);
  }
}

function drawCard(ctx, rect, slot, entry, st, photoStyle, badge) {
  const { x, y, w, h } = rect;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 12);
  ctx.clip();
  const player = entry?.player;
  if (entry?.serious) drawPhoto(ctx, entry.serious, x, y, w, h, photoStyle);
  else drawPlaceholder(ctx, x, y, w, h, player?.name, st);
  const g = ctx.createLinearGradient(0, y + h * 0.5, 0, y + h);
  g.addColorStop(0, 'rgba(30,5,10,0)');
  g.addColorStop(1, 'rgba(30,5,10,0.95)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y + h * 0.5, w, h * 0.5);
  ctx.fillStyle = st.accent;
  ctx.fillRect(x, y + h - 5, w, 5);
  ctx.restore();

  if (badge) {
    const r = w * 0.13;
    drawLeaderBadge(ctx, badge, x + w - r - w * 0.05, y + r + w * 0.05, r, { font: st.display });
  }

  // Shirt number on a dark badge, so gold reads on light photos too.
  drawNumberBadge(ctx, slot, x + w * 0.05, y + w * 0.05, h * 0.16, { font: st.display });

  ctx.textBaseline = 'alphabetic';
  const { first, last } = splitName(player?.name || '');
  drawNameLine(ctx, {
    first, last: (last || 'TBC').toUpperCase(), x: x + w / 2, y: y + h * 0.93, maxWidth: w - 14, size: h * 0.085,
    firstFont: st.body, lastFont: st.display, firstColor: 'rgba(255,255,255,0.85)', lastColor: st.white,
  });
}

/** Only picked replacements are listed, packed in shirt order. No replacements, no box. */
function drawBench(ctx, bench, data, st) {
  const picked = BENCH_SLOTS.filter((slot) => data.slots[slot]?.player);
  if (!picked.length) return;
  ctx.save();
  roundRectPath(ctx, bench.x, bench.y, bench.w, bench.h, 14);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(242,183,5,0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = st.accent;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = st.display(30);
  ctx.fillText('REPLACEMENTS', bench.x + 20, bench.y + 30);

  picked.forEach((slot, i) => {
    const e = bench.entries[BENCH_SLOTS[i]];
    const r = Math.min(20, e.h * 0.36);
    const cy = e.y + e.h / 2;
    ctx.beginPath();
    ctx.arc(e.x + r, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = st.accent;
    ctx.fill();
    ctx.fillStyle = st.maroon;
    ctx.textAlign = 'center';
    ctx.font = st.display(r * 1.1);
    ctx.fillText(String(slot), e.x + r, cy + 1);
    ctx.fillStyle = st.white;
    ctx.textAlign = 'left';
    const player = data.slots[slot].player;
    const badge = leaderBadge(data.match, player.id);
    fitText(ctx, shortName(player.name) + (badge ? ` (${badge})` : ''), e.x + r * 2 + 12, cy + 1, e.w - r * 2 - 24, r * 1.25, st.body);
  });
}

/** "Coaches with SFV" line under the replacements: "COACHES  Jane Doe (Head coach) · ..." */
export function coachesLine(coaches = []) {
  return coaches.map(({ coach }) => (coach.role ? `${coach.name} (${coach.role})` : coach.name)).join('  ·  ');
}

function drawCoachesLine(ctx, box, data, st) {
  const text = coachesLine(data.coaches);
  if (!text) return;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = st.display(26);
  ctx.fillStyle = st.accent;
  const label = 'COACHES';
  ctx.fillText(label, box.x + 20, box.y);
  const lw = ctx.measureText(label).width + 18;
  ctx.fillStyle = st.white;
  fitText(ctx, text, box.x + 20 + lw, box.y, box.w - 40 - lw, 24, st.body);
  ctx.restore();
}

/**
 * data: { match, logo, opponentLogo, photoStyle, slots: { [shirt]: { player, serious, fun } }, coaches: [{ coach, photo }] }
 * serious/fun are photos { img, crop } (see photodraw.js); missing ones get placeholders.
 */
export function drawTeamSheet(ctx, sizeKey, data, st = SHEET_STYLE) {
  const L = layoutTeamSheet(sizeKey);
  ctx.save();
  drawBackground(ctx, L.width, L.height, st);
  drawHeader(ctx, L.header, data, st);
  for (const slot of STARTER_SLOTS) {
    const entry = data.slots[slot];
    drawCard(ctx, L.cards[slot], slot, entry, st, data.photoStyle, leaderBadge(data.match, entry?.player?.id));
  }
  drawBench(ctx, L.bench, data, st);
  drawCoachesLine(ctx, L.coaches, data, st);
  ctx.fillStyle = 'rgba(242,183,5,0.85)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = st.body(20);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
  ctx.fillText('SAN FERNANDO VALLEY RUGBY CLUB', L.width / 2, L.footerY);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.restore();
}

/** Render to a fresh canvas (browser only). */
export function renderTeamSheetCanvas(sizeKey, data, doc = document) {
  const L = layoutTeamSheet(sizeKey);
  const canvas = doc.createElement('canvas');
  canvas.width = L.width;
  canvas.height = L.height;
  drawTeamSheet(canvas.getContext('2d'), sizeKey, data);
  return canvas;
}
