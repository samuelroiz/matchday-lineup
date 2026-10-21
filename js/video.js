// Lineup video: draws any moment of the timeline onto a canvas, plays it back in the page,
// and records it with MediaRecorder. What appears when, and where, comes from timeline.js.

import { SLOT_NAMES, formatFixtureWhen, leaderBadge, splitName, visibleStats } from './model.js';
import { VIDEO_TEMPLATE, cardLook, cardRects, cardState, ease, font, segmentAt, titleState } from './timeline.js';
import { drawBackground, drawLeaderBadge, drawLogo, drawNameLine, drawPlaceholder, fitText, roundRectPath } from './draw.js';
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
 * data: { match, units, logo, opponentLogo, photoStyle, slots: { [shirt]: { player, serious, fun } },
 *         coaches: [{ coach, photo }], coachById: { [id]: { coach, photo } } }
 * serious/fun/photo are photos { img, crop }.
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

  // The intro is fully drawn from the first frame (Instagram uses that frame as the cover),
  // then fades out into the first group.
  function drawIntro(ctx, seg, t) {
    const out = 1 - prog(t, seg.fadeOutStart, seg.end);
    const m = data.match;

    ctx.save();
    ctx.globalAlpha = out;
    drawLogo(ctx, data.logo, W / 2, 600, 200);
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
    ctx.globalAlpha = out;
    for (const ln of lines) {
      if (!ln.text) continue;
      ctx.fillStyle = ln.color;
      fitText(ctx, ln.text, W / 2, ln.y, W - 2 * L.side, ln.size, (s) => f(ln.kind, s));
    }
    if (data.opponentLogo) {
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

  // Text and stats in the panel beside the photo. Serious side: number, position, name.
  // Fun side (as the card flips): layout slides up and the allowed stats fade in.
  function drawPlayerInfo(ctx, rect, slot, entry, look, compact, ix, iw) {
    const { y, h } = rect;
    const C = L.content;
    const from = compact ? C.compactSerious : C.serious;
    const to = compact ? C.compactFun : C.fun;
    const at = (k) => y + h * (from[k] + (to[k] - from[k]) * look.layout);
    const player = entry?.player;
    const { first, last } = splitName(player?.name || '');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = S.maroon;
    ctx.font = f('display', h * C.numberSize);
    const numY = at('numberY');
    ctx.fillText(String(slot), ix, numY);
    const numW = ctx.measureText(String(slot)).width;
    ctx.fillStyle = S.muted;
    fitText(ctx, SLOT_NAMES[slot].toUpperCase(), ix + numW + 18, numY - h * 0.02, iw - numW - 18, h * (compact ? 0.06 : 0.055), (s) => f('body', s));

    drawNameLine(ctx, {
      first, last: (last || 'TBC').toUpperCase(), x: ix, y: at('nameY'), maxWidth: iw, size: h * C.nameSize,
      align: 'left', firstFont: (s) => f('body', s), lastFont: (s) => f('display', s), firstColor: S.cardInk, lastColor: S.maroon,
    });

    if (look.statsAlpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= look.statsAlpha;
    const stats = visibleStats(player, data.units);
    if (compact) {
      if (player?.nickname) {
        ctx.fillStyle = S.muted;
        fitText(ctx, `“${player.nickname}”`, ix, y + h * to.nicknameY, iw, h * 0.07, (s) => f('body', s));
      }
      ctx.fillStyle = S.cardInk;
      stats.filter((s) => to.stats.includes(s.key)).forEach((s, i) => {
        fitText(ctx, s.value, ix, y + h * (to.statsY + i * to.statRow), iw, h * to.statSize, (sz) => f('display', sz));
      });
    } else {
      if (player?.nickname) {
        ctx.fillStyle = S.muted;
        fitText(ctx, `“${player.nickname}”`, ix, y + h * to.nicknameY, iw, h * 0.06, (s) => f('body', s));
      }
      // Stats as a 2-column grid of label over value.
      const colW = iw / 2;
      stats.forEach((s, i) => {
        const cx = ix + (i % 2) * colW;
        const cy = y + h * (to.statsY + Math.floor(i / 2) * to.statRow);
        ctx.fillStyle = S.muted;
        fitText(ctx, s.label.toUpperCase(), cx, cy, colW - 12, h * 0.04, (sz) => f('body', sz));
        ctx.fillStyle = S.cardInk;
        fitText(ctx, s.value, cx, cy + h * 0.07, colW - 12, h * 0.07, (sz) => f('display', sz));
      });
    }
    ctx.restore();
  }

  function drawCoachInfo(ctx, rect, entry, ix, iw) {
    const { y, h } = rect;
    const C = L.content.coach;
    const { first, last } = splitName(entry?.coach?.name || '');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = S.muted;
    fitText(ctx, (entry?.coach?.role || 'Coach').toUpperCase(), ix, y + h * C.roleY, iw, h * 0.07, (s) => f('body', s));
    drawNameLine(ctx, {
      first, last: (last || 'TBC').toUpperCase(), x: ix, y: y + h * C.nameY, maxWidth: iw, size: h * L.content.nameSize,
      align: 'left', firstFont: (s) => f('body', s), lastFont: (s) => f('display', s), firstColor: S.cardInk, lastColor: S.maroon,
    });
  }

  function drawCard(ctx, rect, card, state, compact) {
    const { x, y, w, h } = rect;
    const dx = (1 - state.enter) * W * 0.9 - state.exit * W * 0.9;
    const alpha = clamp01(state.enter * 1.3) * (1 - state.exit);
    if (alpha <= 0) return;
    const look = cardLook(template, state, compact);
    const isCoach = card.kind === 'coach';
    const entry = isCoach ? data.coachById?.[card.coachId] : data.slots[card.slot];
    ctx.save();
    ctx.globalAlpha = alpha;
    // Slide, then grow around the card's centre on the flip.
    ctx.translate(dx + x + w / 2, y + h / 2);
    ctx.scale(look.scale, look.scale);
    ctx.translate(-(x + w / 2), -(y + h / 2));

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 30 + 20 * look.layout;
    ctx.shadowOffsetY = 12 + 8 * look.layout;
    roundRectPath(ctx, x, y, w, h, L.radius);
    ctx.fillStyle = S.card;
    ctx.fill();
    ctx.restore();

    const pw = w * (compact ? L.compactPhotoWidth : L.photoWidth);
    ctx.save();
    roundRectPath(ctx, x, y, w, h, L.radius);
    ctx.clip();
    if (isCoach) {
      if (entry?.photo) drawPhoto(ctx, entry.photo, x, y, pw, h, data.photoStyle);
      else drawPlaceholder(ctx, x, y, pw, h, entry?.coach?.name, S);
    } else {
      drawCardPhoto(ctx, x, y, pw, h, entry, state.flip);
    }
    ctx.fillStyle = S.accent;
    ctx.fillRect(x + pw, y, 8, h);
    ctx.restore();

    const badge = !isCoach && leaderBadge(data.match, entry?.player?.id);
    if (badge) {
      const r = h * (compact ? L.compactBadge : L.badge);
      drawLeaderBadge(ctx, badge, x + pw - r - h * 0.04, y + r + h * 0.04, r, { font: (s) => f('display', s) });
    }

    const ix = x + pw + 8 + (compact ? 22 : 36);
    const iw = x + w - ix - (compact ? 18 : 32);
    if (isCoach) drawCoachInfo(ctx, rect, entry, ix, iw);
    else drawPlayerInfo(ctx, rect, card.slot, entry, look, compact, ix, iw);
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
    // Cards further into their flip are bigger, so draw them last (on top).
    seg.cards
      .map((card, i) => ({ card, rect: rects[i], st: cardState(card, t) }))
      .filter((c) => c.st.visible)
      .sort((a, b) => a.st.flip - b.st.flip)
      .forEach(({ card, rect, st }) => drawCard(ctx, rect, card, st, seg.compact));
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
      renderer.draw(ctx, pos);
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
