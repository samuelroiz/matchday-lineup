// Lineup video: draws any moment of the timeline onto a canvas, plays it back in the page,
// and records it with MediaRecorder. What appears when, and where, comes from timeline.js.

import { SLOT_NAMES, formatFixtureWhen, splitName, visibleStats } from './model.js';
import { VIDEO_TEMPLATE, cardRects, cardState, ease, font, segmentAt, titleState } from './timeline.js';
import { drawBackground, drawLogo, drawNameLine, drawPlaceholder, fitText, roundRectPath } from './draw.js';
import { drawPhoto } from './photodraw.js';
import { drawTeamSheet, layoutTeamSheet } from './teamsheet.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const prog = (t, a, b) => clamp01((t - a) / (b - a));

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * data: { match, units, logo, opponentLogo, photoStyle, slots: { [shirt]: { player, serious, fun } } }
 * serious/fun are photos { img, crop }.
 */
export function createVideoRenderer(data, timeline, template = VIDEO_TEMPLATE) {
  const W = template.width;
  const H = template.height;
  const S = template.style;
  const L = template.layout;
  const f = (kind, size) => font(template, kind, size);
  let bg = null;
  let sheet = null;

  const background = () => {
    if (!bg) {
      bg = makeCanvas(W, H);
      const c = bg.getContext('2d');
      drawBackground(c, W, H, S);
      c.globalAlpha = 0.06;
      drawLogo(c, data.logo, W / 2, H * 0.55, W * 0.42);
    }
    return bg;
  };
  const teamSheet = () => {
    if (!sheet) {
      const sz = layoutTeamSheet('story');
      sheet = makeCanvas(sz.width, sz.height);
      drawTeamSheet(sheet.getContext('2d'), 'story', data);
    }
    return sheet;
  };

  function drawIntro(ctx, seg, t) {
    const u = prog(t, seg.start, seg.end);
    const out = 1 - prog(t, seg.fadeOutStart, seg.end);
    const m = data.match;
    // Each element fades up in turn: [appear at, fully in] as a share of the intro.
    const step = (i) => ease.outCubic(prog(u, 0.08 + i * 0.07, 0.22 + i * 0.07)) * out;

    const logoIn = ease.outCubic(prog(u, 0, 0.22));
    ctx.save();
    ctx.globalAlpha = logoIn * out;
    drawLogo(ctx, data.logo, W / 2, 600, 200 * (0.7 + 0.3 * logoIn));
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const lines = [
      { text: (m.competition || 'Matchday').toUpperCase(), y: 905, kind: 'body', size: 42, color: S.accent },
      { text: 'SFV', y: 1070, kind: 'display', size: 170, color: S.white },
      { text: 'VS', y: 1150, kind: 'display', size: 60, color: S.accent },
      { text: (m.opponent || 'TBC').toUpperCase(), y: 1290, kind: 'display', size: 130, color: S.white },
      { text: formatFixtureWhen(m), y: data.opponentLogo ? 1590 : 1420, kind: 'body', size: 50, color: S.white },
      { text: m.venue || '', y: data.opponentLogo ? 1660 : 1490, kind: 'body', size: 40, color: 'rgba(255,255,255,0.8)' },
    ];
    lines.forEach((ln, i) => {
      if (!ln.text) return;
      const a = step(i);
      ctx.globalAlpha = a;
      ctx.fillStyle = ln.color;
      fitText(ctx, ln.text, W / 2, ln.y + (1 - a) * 30, W - 2 * L.side, ln.size, (s) => f(ln.kind, s));
    });
    if (data.opponentLogo) {
      ctx.globalAlpha = step(4);
      drawLogo(ctx, data.opponentLogo, W / 2, 1430, 85, { label: '' });
    }
    ctx.restore();
  }

  function drawCardPhoto(ctx, x, y, w, h, entry, flip) {
    const serious = entry?.serious || null;
    const fun = entry?.fun || serious;
    const name = entry?.player?.name;
    const paint = (photo) => (photo ? drawPhoto(ctx, photo, x, y, w, h, data.photoStyle) : drawPlaceholder(ctx, x, y, w, h, name, S));
    if (template.transition === 'crossfade') {
      paint(serious);
      if (flip > 0) {
        ctx.save();
        ctx.globalAlpha *= flip;
        paint(fun);
        ctx.restore();
      }
      return;
    }
    // Card turn: squash to nothing on the Serious side, open out on the Fun side.
    const sx = Math.abs(Math.cos(flip * Math.PI));
    ctx.save();
    ctx.translate(x + w / 2, 0);
    ctx.scale(Math.max(sx, 0.001), 1);
    ctx.translate(-(x + w / 2), 0);
    paint(flip < 0.5 ? serious : fun);
    ctx.restore();
  }

  function drawCard(ctx, rect, slot, entry, state, compact) {
    const { x, y, w, h } = rect;
    const dx = (1 - state.enter) * W * 0.9 - state.exit * W * 0.9;
    const alpha = clamp01(state.enter * 1.3) * (1 - state.exit);
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(dx, 0);

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 12;
    roundRectPath(ctx, x, y, w, h, L.radius);
    ctx.fillStyle = S.card;
    ctx.fill();
    ctx.restore();

    const pw = w * (compact ? L.compactPhotoWidth : L.photoWidth);
    ctx.save();
    roundRectPath(ctx, x, y, w, h, L.radius);
    ctx.clip();
    drawCardPhoto(ctx, x, y, pw, h, entry, state.flip);
    ctx.fillStyle = S.accent;
    ctx.fillRect(x + pw, y, 8, h);
    ctx.restore();

    const player = entry?.player;
    const ix = x + pw + 8 + (compact ? 22 : 36);
    const iw = x + w - ix - (compact ? 18 : 32);
    const { first, last } = splitName(player?.name || '');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = S.maroon;
    ctx.font = f('display', h * (compact ? 0.24 : 0.25));
    const numY = y + h * (compact ? 0.27 : 0.27);
    ctx.fillText(String(slot), ix, numY);
    if (!compact) {
      const numW = ctx.measureText(String(slot)).width;
      ctx.fillStyle = S.muted;
      fitText(ctx, SLOT_NAMES[slot].toUpperCase(), ix + numW + 20, numY - h * 0.02, iw - numW - 20, h * 0.055, (s) => f('body', s));
    }

    drawNameLine(ctx, {
      first, last: (last || 'TBC').toUpperCase(), x: ix, y: y + h * (compact ? 0.5 : 0.5), maxWidth: iw, size: h * (compact ? 0.12 : 0.12),
      align: 'left', firstFont: (s) => f('body', s), lastFont: (s) => f('display', s), firstColor: S.cardInk, lastColor: S.maroon,
    });

    const stats = visibleStats(player, data.units);
    if (compact) {
      ctx.fillStyle = S.cardInk;
      const line = stats.filter((s) => s.key !== 'caps').map((s) => (s.key === 'years' ? (s.value === 'New' ? 'New at SFV' : `${s.value} yrs SFV`) : s.value)).join(' · ');
      if (line) fitText(ctx, line, ix, y + h * 0.7, iw, h * 0.07, (s) => f('body', s));
      if (player?.nickname) {
        ctx.fillStyle = S.muted;
        fitText(ctx, `“${player.nickname}”`, ix, y + h * 0.84, iw, h * 0.07, (s) => f('body', s));
      }
    } else {
      if (player?.nickname) {
        ctx.fillStyle = S.muted;
        fitText(ctx, `“${player.nickname}”`, ix, y + h * 0.63, iw, h * 0.06, (s) => f('body', s));
      }
      // Stats as a 2-column grid of label over value.
      const colW = iw / 2;
      stats.forEach((s, i) => {
        const cx = ix + (i % 2) * colW;
        const cy = y + h * (0.75 + Math.floor(i / 2) * 0.15);
        ctx.fillStyle = S.muted;
        fitText(ctx, s.label.toUpperCase(), cx, cy, colW - 12, h * 0.04, (sz) => f('body', sz));
        ctx.fillStyle = S.cardInk;
        fitText(ctx, s.value, cx, cy + h * 0.07, colW - 12, h * 0.07, (sz) => f('display', sz));
      });
    }
    ctx.restore();
  }

  function drawGroup(ctx, seg, t) {
    const ts = titleState(seg, t);
    ctx.save();
    ctx.globalAlpha = ts.alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = S.accent;
    fitText(ctx, `SFV vs ${data.match.opponent || 'TBC'}`.toUpperCase(), W / 2, L.titleY - 115, W - 2 * L.side, 36, (s) => f('body', s));
    ctx.fillStyle = S.white;
    fitText(ctx, seg.title.toUpperCase(), W / 2, L.titleY + (1 - ts.alpha) * 20, W - 2 * L.side, 120, (s) => f('display', s));
    ctx.fillStyle = S.accent;
    ctx.fillRect(W / 2 - 70 * ts.alpha, L.titleY + 30, 140 * ts.alpha, 8);
    ctx.restore();

    const rects = cardRects(template, seg.cards.length, seg.compact);
    seg.cards.forEach((card, i) => {
      const st = cardState(card, t);
      if (st.visible) drawCard(ctx, rects[i], card.slot, data.slots[card.slot], st, seg.compact);
    });
  }

  function drawSheet(ctx, seg, t) {
    const a = ease.outCubic(prog(t, seg.start, seg.inEnd));
    const s = 1.06 - 0.06 * a;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(teamSheet(), 0, 0, W, H);
    ctx.restore();
  }

  return {
    width: W,
    height: H,
    draw(ctx, t) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.drawImage(background(), 0, 0);
      const seg = segmentAt(timeline, t);
      if (seg.type === 'intro') drawIntro(ctx, seg, t);
      else if (seg.type === 'group') drawGroup(ctx, seg, t);
      else drawSheet(ctx, seg, t);
      ctx.restore();
    },
  };
}

/** Real-time playback in the page. */
export function createPreviewPlayer(canvas, renderer, timeline, { onTime, onEnd } = {}) {
  const ctx = canvas.getContext('2d');
  // At 0:00 the intro hasn't faded in yet, so idle previews show the intro fully drawn instead.
  const posterTime = timeline.segments[0].fadeOutStart ?? 0;
  let raf = 0;
  let startedAt = 0;
  let pos = 0;
  const frame = () => {
    pos = Math.min(timeline.duration, (performance.now() - startedAt) / 1000);
    renderer.draw(ctx, pos);
    onTime?.(pos);
    if (pos >= timeline.duration) { raf = 0; onEnd?.(); return; }
    raf = requestAnimationFrame(frame);
  };
  const player = {
    get playing() { return raf !== 0; },
    get time() { return pos; },
    play() {
      if (raf) return;
      if (pos >= timeline.duration) pos = 0;
      startedAt = performance.now() - pos * 1000;
      raf = requestAnimationFrame(frame);
    },
    pause() { cancelAnimationFrame(raf); raf = 0; },
    seek(t) {
      pos = Math.max(0, Math.min(timeline.duration, t));
      startedAt = performance.now() - pos * 1000;
      renderer.draw(ctx, pos === 0 && !raf ? posterTime : pos);
      onTime?.(pos);
    },
  };
  player.seek(0);
  return player;
}

const FORMATS = [
  'video/mp4;codecs=avc1.42E01F',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** First recording format this browser supports, preferring MP4. */
export function pickVideoFormat(isSupported = (t) => globalThis.MediaRecorder?.isTypeSupported?.(t)) {
  for (const mimeType of FORMATS) {
    if (isSupported(mimeType)) return { mimeType, type: mimeType.split(';')[0], ext: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm' };
  }
  return null;
}

// A worker-driven tick keeps frames coming if the tab loses focus (timers on the page get throttled).
function createTicker(ms, fn) {
  let worker = null;
  let url = null;
  let id = 0;
  try {
    const src = 'let id;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
    url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = fn;
    worker.postMessage(ms);
  } catch {
    worker = null;
    id = setInterval(fn, ms);
  }
  return {
    stop() {
      if (worker) worker.terminate();
      if (url) URL.revokeObjectURL(url);
      clearInterval(id);
    },
  };
}

/**
 * Record the timeline in real time from `canvas`. Resolves { blob, type, ext }.
 * Rejects with an AbortError if `signal` is aborted.
 */
export async function recordVideo(canvas, renderer, timeline, { onProgress, signal, limitSeconds } = {}) {
  const fmt = pickVideoFormat();
  if (!fmt || typeof canvas.captureStream !== 'function') {
    throw new Error('This browser cannot record video. Try a recent Chrome, Edge, Safari or Firefox.');
  }
  const duration = Math.min(timeline.duration, limitSeconds > 0 ? limitSeconds : Infinity);
  const ctx = canvas.getContext('2d');
  renderer.draw(ctx, 0);

  const stream = canvas.captureStream(timeline.fps);
  const recorder = new MediaRecorder(stream, { mimeType: fmt.mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

  let ticker = null;
  let aborted = false;
  try {
    recorder.start(500);
    const t0 = performance.now();
    await new Promise((resolve, reject) => {
      const onAbort = () => { aborted = true; reject(new DOMException('Video export cancelled', 'AbortError')); };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      ticker = createTicker(1000 / timeline.fps, () => {
        if (aborted) return;
        const t = (performance.now() - t0) / 1000;
        try {
          renderer.draw(ctx, Math.min(t, duration));
        } catch (err) {
          aborted = true;
          reject(err);
          return;
        }
        onProgress?.(Math.min(1, t / duration));
        if (t >= duration) {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }
      });
    });
  } finally {
    ticker?.stop();
    if (recorder.state !== 'inactive') {
      recorder.stop();
      await stopped;
    }
    stream.getTracks().forEach((tr) => tr.stop());
  }
  const blob = new Blob(chunks, { type: fmt.type });
  if (!blob.size) throw new Error('The recording came out empty. Please try again.');
  return { blob, type: fmt.type, ext: fmt.ext };
}
