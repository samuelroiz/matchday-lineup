// The lineup video as data. Everything a restyle would touch lives in VIDEO_TEMPLATE:
// the order of groups, every timing, card layout, colours and type. The renderer
// (video.js) only asks "what is on screen at time t?" via buildTimeline / cardState.
// Pure: no DOM, imported by Node tests.

export const VIDEO_TEMPLATE = {
  width: 1080,
  height: 1920,
  fps: 30,

  // Seconds at speed 1. Everything is divided by the speed setting except sheetHold.
  timings: {
    intro: 3.6,        // logo + fixture card on screen
    introOut: 0.5,     // fade out at the end of the intro
    slideIn: 0.7,      // one card sliding in
    stagger: 0.15,     // delay between cards in a group (in, flip and out)
    holdSerious: 2.0,  // Serious photo on screen once all cards are in
    flip: 0.6,         // Serious -> Fun transition
    holdFun: 2.0,      // Fun photo on screen once all cards have flipped
    slideOut: 0.5,     // one card sliding out
    gap: 0.15,         // breath between groups
    sheetIn: 0.8,      // full team sheet fading in
    sheetHold: 3,      // full team sheet held (fixed, not scaled by speed)
  },

  // 'flip' (card turns over) or 'crossfade'
  transition: 'flip',

  groups: [
    { key: 'front', title: 'Front Row', slots: [1, 2, 3] },
    { key: 'locks', title: 'Locks', slots: [4, 5] },
    { key: 'backrow', title: 'Back Row', slots: [6, 7, 8] },
    { key: 'halves', title: 'Halves', slots: [9, 10] },
    { key: 'centres', title: 'Centres', slots: [12, 13] },
    { key: 'backthree', title: 'Back Three', slots: [11, 14, 15] },
    { key: 'bench', title: 'Bench', slots: [16, 17, 18, 19, 20, 21, 22, 23], compact: true, stagger: 0.07 },
  ],

  layout: {
    // Area the cards share, kept inside Instagram's story safe zone.
    cardsTop: 400,
    cardsBottom: 1720,
    side: 60,
    gap: 34,
    maxCardHeight: 420,
    compactColumns: 2,
    titleY: 250,         // group title baseline
    photoWidth: 0.42,    // share of a card's width taken by the photo
    radius: 28,
  },

  style: {
    background: ['#5a1520', '#7a1f2b', '#3d0e16'],
    stripe: 'rgba(242, 183, 5, 0.08)',
    card: '#fffaf0',
    cardInk: '#2a0c11',
    accent: '#f2b705',
    maroon: '#7a1f2b',
    muted: '#7d6a6d',
    white: '#ffffff',
    display: '800 {size}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif',
    body: '600 {size}px "Helvetica Neue", Arial, sans-serif',
  },
};

export const SPEEDS = [
  { value: 0.85, label: 'Relaxed' },
  { value: 1, label: 'Normal' },
  { value: 1.25, label: 'Quick' },
  { value: 1.5, label: 'Fast' },
];

export const font = (template, kind, size) => template.style[kind].replace('{size}', Math.round(size));

/**
 * Turn the template into absolute segments.
 * options.selection: { [shirt]: playerId } — when given, empty shirts get no card and
 * groups with nobody picked are skipped.
 */
export function buildTimeline(template = VIDEO_TEMPLATE, { speed = 1, selection = null } = {}) {
  if (!(speed > 0)) throw new Error('speed must be positive');
  const T = template.timings;
  const sc = (x) => x / speed;
  const segments = [];
  let t = 0;

  segments.push({ type: 'intro', start: 0, end: sc(T.intro), fadeOutStart: sc(T.intro - T.introOut) });
  t = sc(T.intro);

  for (const g of template.groups) {
    const slots = selection ? g.slots.filter((s) => selection[s]) : [...g.slots];
    if (slots.length === 0) continue;
    const n = slots.length;
    const st = sc(g.stagger ?? T.stagger);
    const allIn = sc(T.slideIn) + st * (n - 1);
    const flipBase = allIn + sc(T.holdSerious);
    const allFlipped = flipBase + sc(T.flip) + st * (n - 1);
    const outBase = allFlipped + sc(T.holdFun);
    const cards = slots.map((slot, i) => ({
      slot,
      index: i,
      inStart: t + st * i,
      inEnd: t + st * i + sc(T.slideIn),
      flipStart: t + flipBase + st * i,
      flipEnd: t + flipBase + st * i + sc(T.flip),
      outStart: t + outBase + st * i,
      outEnd: t + outBase + st * i + sc(T.slideOut),
    }));
    const end = cards[n - 1].outEnd + sc(T.gap);
    segments.push({ type: 'group', key: g.key, title: g.title, compact: !!g.compact, slots, cards, start: t, end });
    t = end;
  }

  const sheetInEnd = t + sc(T.sheetIn);
  segments.push({ type: 'sheet', start: t, inEnd: sheetInEnd, end: sheetInEnd + T.sheetHold });
  const duration = sheetInEnd + T.sheetHold;
  return { duration, fps: template.fps, frameCount: Math.ceil(duration * template.fps), segments };
}

export function segmentAt(timeline, t) {
  const segs = timeline.segments;
  if (t <= 0) return segs[0];
  for (const s of segs) if (t < s.end) return s;
  return segs[segs.length - 1];
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const progress = (t, a, b) => (b <= a ? (t >= b ? 1 : 0) : clamp01((t - a) / (b - a)));

export const ease = {
  outCubic: (x) => 1 - (1 - x) ** 3,
  inCubic: (x) => x ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
};

/**
 * Where a card is at time t.
 *   enter: 0 (off right) -> 1 (in place);  exit: 0 (in place) -> 1 (off left)
 *   flip:  0 (Serious)   -> 1 (Fun)
 */
export function cardState(card, t) {
  return {
    visible: t >= card.inStart && t < card.outEnd,
    enter: ease.outCubic(progress(t, card.inStart, card.inEnd)),
    flip: ease.inOutCubic(progress(t, card.flipStart, card.flipEnd)),
    exit: ease.inCubic(progress(t, card.outStart, card.outEnd)),
  };
}

/** Group title fades with the first card in and the last card out. */
export function titleState(segment, t) {
  const first = segment.cards[0];
  const last = segment.cards[segment.cards.length - 1];
  return {
    alpha: Math.min(progress(t, first.inStart, first.inEnd), 1 - progress(t, last.outStart, last.outEnd)),
  };
}

/** Card rectangles for a group of n cards, from the template layout. */
export function cardRects(template, n, compact = false) {
  const L = template.layout;
  const cols = compact ? L.compactColumns : 1;
  const rows = Math.ceil(n / cols);
  const areaW = template.width - L.side * 2;
  const areaH = L.cardsBottom - L.cardsTop;
  const w = (areaW - L.gap * (cols - 1)) / cols;
  const h = Math.min(compact ? Infinity : L.maxCardHeight, (areaH - L.gap * (rows - 1)) / rows);
  const usedH = rows * h + (rows - 1) * L.gap;
  const top = L.cardsTop + (areaH - usedH) / 2;
  const rects = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    // Centre a lone card on the last row of a multi-column grid.
    const rowCount = Math.min(cols, n - r * cols);
    const rowOffset = ((cols - rowCount) * (w + L.gap)) / 2;
    rects.push({ x: L.side + rowOffset + c * (w + L.gap), y: top + r * (h + L.gap), w, h });
  }
  return rects;
}
