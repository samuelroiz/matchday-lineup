// Photo cropping, face auto crop, photo style, kick-off and long names, in headless Chrome.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { startServer } from '../../scripts/serve.js';
import { makePng } from '../helpers/png.js';

const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Public-domain portrait (Alexander Gardner, 1863, via Wikimedia Commons), resized and padded
// so the face is small in the frame, like a typical phone photo.
const FACE = fileURLToPath(new URL('../fixtures/face-portrait.jpg', import.meta.url));

let server;
let browser;
let page;
let base;
let dir;
let noFace;
const pageErrors = [];

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'matchday-photos-'));
  noFace = join(dir, 'no-face.png');
  await writeFile(noFace, makePng(1000, 1600, [40, 90, 150]));
  server = await startServer(0);
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // Record text drawn on canvases, to check names and kick-off as they are actually drawn.
  await page.evaluateOnNewDocument(() => {
    window.__texts = null;
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, x, y, ...rest) {
      if (window.__texts) window.__texts.push({ t: String(t), x, y, w: this.measureText(t).width, size: parseFloat(/([\d.]+)px/.exec(this.font)?.[1]), canvas: this.canvas.id });
      return orig.call(this, t, x, y, ...rest);
    };
  });
  await page.goto(`${base}#squad`);
  await page.waitForSelector('html[data-ready="true"]');
});

after(async () => {
  await browser?.close();
  server?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const cropOf = (kind) => page.$eval(`dialog .photo-pick[data-kind=${kind}] canvas`, (c) => JSON.parse(c.dataset.crop));
const statusOf = (kind) => page.$eval(`dialog .photo-pick[data-kind=${kind}] .crop-status`, (e) => e.textContent);
const storedPlayers = () => page.evaluate(async () => {
  const { openStore } = await import('/js/storage.js');
  return (await openStore()).getAll('players');
});

test('uploading a photo auto crops on the face, or top-centre when there is none', async () => {
  await page.click('#add-player');
  await page.waitForSelector('dialog[open] .player-form');
  await page.type('dialog input[name=name]', 'Christopher Rodriguez');
  await (await page.$('dialog .photo-pick[data-kind=serious] input[type=file]')).uploadFile(FACE);
  await page.waitForFunction(() => /Face found/.test(document.querySelector('dialog .photo-pick[data-kind=serious] .crop-status').textContent), { timeout: 20000 });
  const face = await cropOf('serious');
  assert.equal(face.source, 'face');
  assert.ok(face.zoom > 1, `zoomed in on the face (zoom ${face.zoom})`);

  await (await page.$('dialog .photo-pick[data-kind=fun] input[type=file]')).uploadFile(noFace);
  await page.waitForFunction(() => /No face found/.test(document.querySelector('dialog .photo-pick[data-kind=fun] .crop-status').textContent), { timeout: 20000 });
  const top = await cropOf('fun');
  assert.equal(top.source, 'default');
  assert.equal(top.cx, 0.5);
  // 1000x1600 shrinks to 750x1200; a full-width 4:5 crop is 937.5 tall, so top-centre has cy = 468.75 / 1200.
  assert.ok(Math.abs(top.cy - 468.75 / 1200) < 1e-6, `cy ${top.cy}`);
});

test('drag moves the crop and the slider zooms it', async () => {
  const before = await cropOf('serious');
  const box = await (await page.$('dialog .photo-pick[data-kind=serious] canvas')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  const moved = await cropOf('serious');
  assert.equal(moved.source, 'manual');
  assert.ok(moved.cx < before.cx, 'dragging right shows more of the left');
  assert.match(await statusOf('serious'), /Drag/);

  await page.$eval('dialog .photo-pick[data-kind=serious] .crop-zoom', (z) => { z.value = '1.2'; z.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal((await cropOf('serious')).zoom, 1.2);
});

test('the crop is saved per photo and the original photo is kept', async () => {
  const shown = await cropOf('serious');
  await page.click('dialog [data-action=save]');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  const [p] = await storedPlayers();
  assert.deepEqual(p.crops.serious, shown);
  assert.equal(p.crops.fun.source, 'default');
  const dims = await page.evaluate(async (id) => {
    const { openStore } = await import('/js/storage.js');
    const b = await createImageBitmap((await (await openStore()).get('photos', id)).blob);
    return [b.width, b.height];
  }, p.photos.serious);
  assert.deepEqual(dims, [933, 1200], 'stored photo is the whole (resized) upload, not the crop');

  // Reopening shows the same crop.
  await page.click('.player-card button');
  await page.waitForSelector('dialog[open] .photo-pick[data-kind=serious] canvas[data-crop]');
  assert.deepEqual(await cropOf('serious'), shown);
  await page.click('dialog [data-action=cancel]');
});

test('a cropped photo fills exactly its box, showing the cropped part', async () => {
  const r = await page.evaluate(async () => {
    const { drawPhoto } = await import('/js/photodraw.js');
    const { drawTeamSheet, layoutTeamSheet } = await import('/js/teamsheet.js');
    const { normalizeMatch } = await import('/js/model.js');
    // Left half red, right half blue.
    const src = document.createElement('canvas');
    src.width = 1000; src.height = 1000;
    const s = src.getContext('2d');
    s.fillStyle = '#ff0000'; s.fillRect(0, 0, 500, 1000);
    s.fillStyle = '#0000ff'; s.fillRect(500, 0, 500, 1000);
    const img = await createImageBitmap(src);
    const blueSide = { cx: 0.75, cy: 0.5, zoom: 2, source: 'manual' };
    const isBlue = ([r, , b]) => b > 200 && r < 60;
    const isRed = ([r, , b]) => r > 200 && b < 60;

    const box = document.createElement('canvas');
    box.width = 160; box.height = 200;
    drawPhoto(box.getContext('2d'), { img, crop: blueSide }, 0, 0, 160, 200, 'off');
    const px = box.getContext('2d').getImageData(0, 0, 160, 200).data;
    let allBlue = true;
    for (let i = 0; i < px.length; i += 4) if (!isBlue([px[i], px[i + 1], px[i + 2]])) { allBlue = false; break; }

    const sheet = document.createElement('canvas');
    const L = layoutTeamSheet('post');
    sheet.width = L.width; sheet.height = L.height;
    const ctx = sheet.getContext('2d');
    const photo = (crop) => ({ player: { name: 'Test Player' }, serious: { img, crop }, fun: null });
    const at = (x, y) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data];
    const c1 = L.cards[1];
    drawTeamSheet(ctx, 'post', { match: normalizeMatch({ opponent: 'X', date: '2026-10-24' }), slots: { 1: photo(blueSide) }, photoStyle: 'off' });
    const blueCard = [at(c1.x + 2, c1.y + c1.h * 0.5), at(c1.x + c1.w - 3, c1.y + c1.h * 0.5), at(c1.x + c1.w / 2, c1.y + 2)];
    const justOutside = at(c1.x - 4, c1.y + c1.h * 0.5);
    drawTeamSheet(ctx, 'post', { match: normalizeMatch({ opponent: 'X', date: '2026-10-24' }), slots: { 1: photo({ ...blueSide, cx: 0.25 }) }, photoStyle: 'off' });
    const redCard = at(c1.x + c1.w / 2, c1.y + c1.h * 0.5);
    return {
      size: [box.width, box.height], allBlue,
      blueCard: blueCard.every(isBlue), outsideBlue: isBlue(justOutside), redCard: isRed(redCard),
    };
  });
  assert.deepEqual(r.size, [160, 200]);
  assert.ok(r.allBlue, 'whole box shows the cropped (blue) area');
  assert.ok(r.blueCard, 'team sheet card shows the crop edge to edge');
  assert.equal(r.outsideBlue, false, 'nothing spills outside the card');
  assert.ok(r.redCard, 'moving the crop changes what the card shows');
});

test('photo style changes the look, never the stored photo', async () => {
  const hash = () => page.evaluate(async () => {
    const { openStore } = await import('/js/storage.js');
    const recs = await (await openStore()).getAll('photos');
    const bufs = await Promise.all(recs.map((r) => r.blob.arrayBuffer()));
    const digests = await Promise.all(bufs.map((b) => crypto.subtle.digest('SHA-256', b)));
    return digests.map((d) => [...new Uint8Array(d)].join(',')).sort().join('|');
  });
  // Every pixel of the first card photo, plus a mark on the node to prove it isn't rebuilt.
  const grab = () => page.$eval('.player-card canvas[data-rendered]', (c) => {
    c.dataset.same ??= 'yes';
    return { style: c.dataset.style, same: c.dataset.same, px: [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data] };
  });
  const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) for (let j = 0; j < 3; j++) s += Math.abs(a[i + j] - b[i + j]); return s / (a.length * 0.75); };
  const before = await hash();
  const looks = {};
  await grab();
  for (const style of ['off', 'auto', 'club']) {
    await page.select('#photo-style', style);
    // Repainted in the change handler itself: no waiting, same canvas.
    looks[style] = await grab();
    assert.equal(looks[style].style, style, `cards show ${style} straight away`);
    assert.equal(looks[style].same, 'yes', 'the card is repainted in place, not rebuilt');
  }
  for (const [a, b] of [['off', 'auto'], ['auto', 'club'], ['off', 'club']]) {
    const d = diff(looks[a].px, looks[b].px);
    assert.ok(d > 8, `${a} vs ${b}: average change ${d.toFixed(1)} of 255 is too subtle to notice`);
  }
  assert.equal(await hash(), before, 'stored photos are byte-for-byte unchanged');
});

test('kick-off saves and shows on the team sheet', async () => {
  const [p] = await storedPlayers();
  await page.click('[data-tab=match]');
  await page.click('#new-match');
  await page.waitForSelector('#match-form:not([hidden])');
  await page.type('#m-opponent', 'Santa Monica');
  await page.select('select[data-slot="1"]', p.id);
  await page.select('#m-kickoff', '14:30');
  await page.waitForFunction(() => document.querySelector('#save-status').dataset.state === 'saved');

  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await page.click('[data-tab=match]');
  assert.equal(await page.$eval('#m-kickoff', (s) => s.value), '14:30');
  assert.equal(await page.$eval('#m-kickoff', (s) => s.selectedOptions[0].textContent), '2:30 PM');

  await page.evaluate(() => { window.__texts = []; });
  await page.click('[data-tab=sheet]');
  await page.waitForFunction(() => document.querySelector('#sheet-canvas').dataset.rendered);
  const texts = await page.evaluate(() => window.__texts.filter((t) => t.canvas === 'sheet-canvas').map((t) => t.t));
  assert.ok(texts.some((t) => t.includes('Kick-off 2:30 PM')), texts.join(' | '));
});

test('a long name on the team sheet becomes "C. RODRIGUEZ" on one line instead of shrinking', async () => {
  const card = await page.evaluate(async () => (await import('/js/teamsheet.js')).layoutTeamSheet('post').cards[1]);
  await page.evaluate(() => { window.__texts = []; });
  await page.click('input[name=sheet-size][value=story]');
  await page.click('input[name=sheet-size][value=post]');
  await page.waitForFunction(() => window.__texts.some((t) => t.t === 'RODRIGUEZ'));
  const texts = await page.evaluate(() => window.__texts.filter((t) => t.canvas === 'sheet-canvas'));
  assert.ok(!texts.some((t) => t.t === 'Christopher'), 'the full first name would shrink too far, so it is not used');
  const first = texts.findLast((t) => t.t === 'C.');
  const last = texts.findLast((t) => t.t === 'RODRIGUEZ');
  assert.ok(first && last, 'initial and surname are drawn');
  const normal = card.h * 0.085; // the team sheet's name size
  assert.ok(last.size >= normal * 0.8 - 1, `drawn at ${last.size}px, normal ${normal.toFixed(1)}px`);
  assert.equal(first.y, last.y, 'first name and surname share one line');
  assert.ok(first.x >= card.x && last.x + last.w <= card.x + card.w, `name spans ${first.x}..${last.x + last.w}, card ${card.x}..${card.x + card.w}`);
});

test('a long name stays on one line in the video', async () => {
  await page.click('[data-tab=video]');
  await page.waitForFunction(() => /Length/.test(document.querySelector('#video-length').textContent));
  // Scrub forward until the front-row card is on screen.
  let texts = [];
  for (let v = 0; v <= 400 && !texts.length; v += 5) {
    texts = await page.evaluate((v) => {
      window.__texts = [];
      const s = document.querySelector('#video-scrub');
      s.value = String(v);
      s.dispatchEvent(new Event('input'));
      const out = window.__texts.filter((t) => t.canvas === 'video-canvas');
      return out.some((t) => t.t === 'RODRIGUEZ') ? out : [];
    }, v);
  }
  // Full first name when it fits at about the normal size, otherwise the initial.
  const first = texts.find((t) => t.t === 'Christopher' || t.t === 'C.');
  const last = texts.find((t) => t.t === 'RODRIGUEZ');
  assert.ok(first && last, 'name drawn in the video');
  assert.equal(first.y, last.y, 'one line');
  assert.ok(last.x + last.w <= 1080 - 60, 'stays inside the card');
});

test('no page errors', () => {
  assert.deepEqual(pageErrors, []);
});
