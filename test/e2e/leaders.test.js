// Captain / vice-captain, coaches, and the card flip, in headless Chrome.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { startServer } from '../../scripts/serve.js';

const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FACE = fileURLToPath(new URL('../fixtures/face-portrait.jpg', import.meta.url));
const PLAYERS = ['Alex Ortega', 'Bo Tanaka', 'Chris Mbeki', 'Dan Fonoti'];

let server;
let browser;
let page;
let base;
let dir;
const pageErrors = [];

async function preparePage(p) {
  p.on('pageerror', (e) => pageErrors.push(e.message));
  await p.setViewport({ width: 1400, height: 1000 });
  await p.evaluateOnNewDocument(() => {
    // Record canvas text, and capture downloads instead of saving them.
    window.__texts = null;
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, x, y, ...rest) {
      if (window.__texts) window.__texts.push({ t: String(t), x, y, w: this.measureText(t).width, canvas: this.canvas.id });
      return orig.call(this, t, x, y, ...rest);
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { window.__download = { href: this.href, name: this.download }; return; }
      return click.call(this);
    };
  });
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'matchday-leaders-'));
  server = await startServer(0);
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  page = await browser.newPage();
  await preparePage(page);
  await page.goto(`${base}#squad`);
  await page.waitForSelector('html[data-ready="true"]');
  // Players are covered by app.test.js; seed them directly to keep this suite quick.
  await page.evaluate(async (names) => {
    const { openStore } = await import('/js/storage.js');
    const { normalizePlayer } = await import('/js/model.js');
    const store = await openStore();
    for (const [i, name] of names.entries()) {
      const c = document.createElement('canvas');
      c.width = 400; c.height = 500;
      const g = c.getContext('2d');
      g.fillStyle = ['#c33', '#3c3', '#33c', '#cc3'][i];
      g.fillRect(0, 0, 400, 500);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg'));
      await store.put('photos', { id: `ph${i}`, blob });
      await store.put('players', normalizePlayer({ id: `p${i}`, name, positions: ['Prop'], heightCm: 180 + i, weightKg: 100, years: 2, photos: { serious: `ph${i}`, fun: `ph${i}` } }));
    }
  }, PLAYERS);
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
});

after(async () => {
  await browser?.close();
  server?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function addCoach(name, role, photo) {
  await page.click('#add-coach');
  await page.waitForSelector('dialog[open] .coach-form');
  await page.type('dialog input[name=name]', name);
  await page.type('dialog input[name=role]', role);
  if (photo) {
    await (await page.$('dialog .photo-pick input[type=file]')).uploadFile(photo);
    await page.waitForFunction(() => /Face found/.test(document.querySelector('dialog .crop-status').textContent), { timeout: 20000 });
  }
  await page.click('dialog [data-action=save]');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
}

const coachCards = () => page.$$eval('.coach-card', (els) => els.map((c) => `${c.querySelector('h3').textContent} | ${c.querySelector('.role').textContent}`));

test('coaches are added on the Squad tab with a cropped photo, and saved', async () => {
  await addCoach('Dana Whitfield', 'Head coach', FACE);
  await addCoach('Ray Nakamura', 'Forwards coach', null);
  assert.deepEqual(await coachCards(), ['Dana Whitfield | Head coach', 'Ray Nakamura | Forwards coach']);
  await page.waitForSelector('.coach-card canvas[data-rendered]');

  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  assert.deepEqual(await coachCards(), ['Dana Whitfield | Head coach', 'Ray Nakamura | Forwards coach']);
  const stored = await page.evaluate(async () => {
    const { openStore } = await import('/js/storage.js');
    return (await (await openStore()).getAll('coaches')).map((c) => ({ name: c.name, hasPhoto: !!c.photo, source: c.crop?.source ?? null }));
  });
  assert.deepEqual(stored.sort((a, b) => a.name.localeCompare(b.name)), [
    { name: 'Dana Whitfield', hasPhoto: true, source: 'face' },
    { name: 'Ray Nakamura', hasPhoto: false, source: null },
  ]);
});

test('a coach without a photo has no "Photo" label, and role buttons fill in the role', async () => {
  const captions = await page.$$eval('.coach-card', (els) => els.map((c) => c.querySelector('figcaption')?.textContent ?? null));
  assert.deepEqual(captions, ['Photo', null]);

  // Role suggestions are buttons, not a <datalist> popup that eats the first click on Save.
  await page.click('#add-coach');
  await page.waitForSelector('dialog[open] .coach-form');
  assert.equal(await page.$('dialog datalist'), null);
  await page.type('dialog input[name=name]', 'Lee Park');
  await page.click('dialog [data-role-chips] button[value="Backs coach"]');
  assert.equal(await page.$eval('dialog input[name=role]', (i) => i.value), 'Backs coach');
  assert.equal(await page.$eval('dialog [data-role-chips] button[value="Backs coach"]', (b) => b.getAttribute('aria-pressed')), 'true');
  await page.click('dialog [data-action=cancel]');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
});

const storedMatch = () => page.evaluate(async () => {
  const { openStore } = await import('/js/storage.js');
  return (await (await openStore()).getAll('matches'))[0];
});
const tags = () => page.$$eval('.slot .leader-tag', (els) => els.map((e) => `${e.closest('.slot').dataset.slot}:${e.textContent}`));
const saved = () => page.waitForFunction(() => document.querySelector('#save-status').dataset.state === 'saved');

test('one captain and one vice-captain per match, and coaches on duty', async () => {
  await page.click('[data-tab=match]');
  await page.click('#new-match');
  await page.waitForSelector('#match-form:not([hidden])');
  await page.type('#m-opponent', 'Santa Monica');
  for (const [slot, id] of [[1, 'p0'], [2, 'p1'], [3, 'p2'], [16, 'p3']]) await page.select(`select[data-slot="${slot}"]`, id);

  await page.select('#m-captain', 'p0');
  await page.select('#m-captain', 'p1'); // a new captain replaces the old one
  await page.select('#m-vice', 'p2');
  assert.deepEqual(await tags(), ['2:C', '3:VC']);
  await page.select('#m-vice', 'p1'); // the captain can't also be vice
  assert.equal(await page.$eval('#m-captain', (s) => s.value), '');
  assert.deepEqual(await tags(), ['2:VC']);
  await page.select('#m-vice', 'p2');
  await page.select('#m-captain', 'p1');
  assert.deepEqual(await tags(), ['2:C', '3:VC']);

  const ids = await page.$$eval('#m-coaches input', (els) => els.map((e) => e.value));
  for (const id of ids) await page.click(`#m-coaches input[value="${id}"]`);
  await saved();
  const m = await storedMatch();
  assert.deepEqual([m.captain, m.viceCaptain, m.coaches.length], ['p1', 'p2', 2]);

  // Dropping the vice-captain from the team takes the armband off them too.
  await page.select('select[data-slot="3"]', '');
  await saved();
  assert.equal((await storedMatch()).viceCaptain, null);
  await page.select('select[data-slot="3"]', 'p2');
  await page.select('#m-vice', 'p2');
  await saved();
});

test('the C and VC badges are drawn on the right team sheet cards; coaches listed under the replacements', async () => {
  const L = await page.evaluate(async () => (await import('/js/teamsheet.js')).layoutTeamSheet('post'));
  await page.evaluate(() => { window.__texts = []; });
  await page.click('[data-tab=sheet]');
  await page.waitForFunction(() => window.__texts.some((t) => t.t === 'REPLACEMENTS'));
  const texts = await page.evaluate(() => window.__texts.filter((t) => t.canvas === 'sheet-canvas'));
  const inCard = (t, slot) => {
    const c = L.cards[slot];
    return t.x >= c.x && t.x <= c.x + c.w && t.y >= c.y && t.y <= c.y + c.h;
  };
  const c = texts.filter((t) => t.t === 'C');
  const vc = texts.filter((t) => t.t === 'VC');
  assert.equal(c.length, 1, 'exactly one captain badge');
  assert.ok(inCard(c[0], 2), 'C on shirt 2');
  assert.equal(vc.length, 1);
  assert.ok(inCard(vc[0], 3), 'VC on shirt 3');
  // Only #16 is on the bench: empty replacement spots are left out, empty starting shirts keep TBC.
  const b = L.bench;
  const inBench = texts.filter((t) => t.x >= b.x && t.x <= b.x + b.w && t.y >= b.y && t.y <= b.y + b.h && t.t !== 'REPLACEMENTS');
  assert.deepEqual(inBench.map((t) => t.t), ['16', 'D. Fonoti']);
  assert.ok(texts.some((t) => t.t === 'TBC' && t.y < b.y), 'empty starting shirts still say TBC');
  assert.ok(texts.some((t) => t.t === 'COACHES'));
  assert.ok(texts.some((t) => t.t === 'Dana Whitfield (Head coach)  ·  Ray Nakamura (Forwards coach)'));
});

/** Scrub the preview to v (0-1000) and return the text drawn on the video canvas. */
const frameAt = (v) => page.evaluate((v) => {
  window.__texts = [];
  const s = document.querySelector('#video-scrub');
  s.value = String(v);
  s.dispatchEvent(new Event('input'));
  return window.__texts.filter((t) => t.canvas === 'video-canvas');
}, v);

test('video cards: Serious side has no stats, the flip shows them, captain badge on the right card', async () => {
  await page.click('[data-tab=video]');
  await page.waitForFunction(() => /Length/.test(document.querySelector('#video-length').textContent));
  const rects = await page.evaluate(async () => {
    const { VIDEO_TEMPLATE, cardRects } = await import('/js/timeline.js');
    return { rects: cardRects(VIDEO_TEMPLATE, 3, false), photoWidth: VIDEO_TEMPLATE.layout.photoWidth };
  });
  let firstSeen = null;
  let statsSeen = null;
  let badge = null;
  for (let v = 0; v <= 500 && statsSeen === null; v += 2) {
    const texts = await frameAt(v);
    if (texts.some((t) => t.t === 'LOCKS')) break;
    if (!texts.some((t) => t.t === 'FRONT ROW')) continue;
    if (firstSeen === null && texts.some((t) => t.t === 'TANAKA')) {
      firstSeen = v;
      assert.ok(!texts.some((t) => t.t === 'HEIGHT'), 'no stats when the card first slides in');
      assert.ok(texts.some((t) => t.t === 'HOOKER'), 'position shown on the Serious side');
    }
    badge ??= texts.find((t) => t.t === 'C');
    if (firstSeen !== null && texts.some((t) => t.t === 'HEIGHT')) statsSeen = v;
  }
  assert.ok(firstSeen !== null, 'front row shown');
  assert.ok(statsSeen > firstSeen, 'stats appear after the flip');
  assert.ok(badge, 'captain badge drawn');
  const r = rects.rects[1]; // shirt 2 is the second front-row card
  assert.ok(badge.x >= r.x && badge.x <= r.x + r.w * rects.photoWidth && badge.y >= r.y && badge.y <= r.y + r.h, 'badge on shirt 2’s photo');
});

test('the first frame is the intro fully drawn, so it works as the Instagram cover', async () => {
  const snap = (v) => page.evaluate((v) => {
    const s = document.querySelector('#video-scrub');
    s.value = String(v);
    s.dispatchEvent(new Event('input'));
    return document.querySelector('#video-canvas').toDataURL();
  }, v);
  const first = await snap(0);
  assert.equal(first, await snap(20), 'frame 0 matches the intro a second in');
  const texts = await frameAt(0);
  assert.ok(texts.some((t) => t.t === 'SANTA MONICA'));
});

test('the video has a coaches group after the bench', async () => {
  let benchAt = null;
  let coachesAt = null;
  for (let v = 600; v <= 1000 && coachesAt === null; v += 4) {
    const texts = await frameAt(v);
    if (texts.some((t) => t.t === 'BENCH')) benchAt ??= v;
    if (texts.some((t) => t.t === 'COACHES') && texts.some((t) => t.t === 'WHITFIELD')) {
      coachesAt = v;
      assert.ok(texts.some((t) => t.t === 'HEAD COACH'));
    }
  }
  assert.ok(benchAt !== null && coachesAt > benchAt, `bench at ${benchAt}, coaches at ${coachesAt}`);
  const length = await page.$eval('#video-length', (e) => e.textContent);
  const [, mm, ss] = /Length (\d+):(\d\d)/.exec(length);
  const seconds = Number(mm) * 60 + Number(ss);
  assert.ok(seconds >= 20 && seconds <= 60, length); // short squad here; full-team length is a unit test
});

test('coaches come back with Back up squad and Restore', async () => {
  await page.click('[data-tab=squad]');
  await page.evaluate(() => { window.__download = null; });
  await page.click('#backup');
  await page.waitForFunction(() => window.__download);
  const json = await page.evaluate(async () => (await fetch(window.__download.href)).text());
  const file = join(dir, 'backup.json');
  await writeFile(file, json);
  assert.equal(JSON.parse(json).coaches.length, 2);

  // A fresh browser profile: nothing stored yet.
  const ctx = await browser.createBrowserContext();
  const fresh = await ctx.newPage();
  await preparePage(fresh);
  await fresh.goto(`${base}#squad`);
  await fresh.waitForSelector('html[data-ready="true"]');
  assert.equal((await fresh.$$('.coach-card')).length, 0);
  await (await fresh.$('#restore')).uploadFile(file);
  await fresh.waitForFunction(() => document.querySelectorAll('.coach-card').length === 2);
  await fresh.waitForSelector('.coach-card canvas[data-rendered]');
  await fresh.click('[data-tab=match]');
  await fresh.waitForSelector('#match-form:not([hidden])');
  assert.equal(await fresh.$eval('#m-captain', (s) => s.value), 'p1');
  assert.equal(await fresh.$$eval('#m-coaches input:checked', (els) => els.length), 2);
  await ctx.close();
});

test('no page errors', () => {
  assert.deepEqual(pageErrors, []);
});
