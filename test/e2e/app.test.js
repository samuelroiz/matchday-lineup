// End-to-end: drives the real app in headless Chrome.
// Needs Google Chrome; set PUPPETEER_EXECUTABLE_PATH (defaults to the macOS install path).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { startServer } from '../../scripts/serve.js';
import { makePng, pngSize } from '../helpers/png.js';

const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CLIP = 3; // seconds of video to export in the test

let server;
let browser;
let page;
let base;
let fixtures;
const pageErrors = [];
const nativeDialogs = [];

const SQUAD = [
  { name: 'Alex Ortega', nickname: 'Tank', positions: ['Prop'], ft: 6, inch: 1, lb: 245, years: 4, colour: [150, 40, 50], hideWeight: true },
  { name: 'Bo Tanaka', positions: ['Hooker'], ft: 5, inch: 10, lb: 215, years: 2, colour: [40, 90, 150] },
  { name: 'Chris Mbeki', positions: ['Prop', 'Lock'], ft: 6, inch: 4, lb: 260, years: 7, colour: [40, 130, 60] },
];

before(async () => {
  fixtures = await mkdtemp(join(tmpdir(), 'matchday-e2e-'));
  for (const [i, p] of SQUAD.entries()) {
    p.serious = join(fixtures, `serious-${i}.png`);
    p.fun = join(fixtures, `fun-${i}.png`);
    await writeFile(p.serious, makePng(1600, 2000, p.colour));
    await writeFile(p.fun, makePng(1400, 1000, p.colour.map((c) => 255 - c)));
  }
  server = await startServer(0);
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--window-size=1400,1000'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', async (d) => { nativeDialogs.push(d.type()); await d.dismiss(); });
  await page.goto(`${base}?clip=${CLIP}#squad`);
  await page.waitForSelector('html[data-ready="true"]');
});

after(async () => {
  await browser?.close();
  server?.close();
  if (fixtures) await rm(fixtures, { recursive: true, force: true });
});

/** Fetch a blob: URL inside the page and hand back its bytes and type. */
async function readBlobUrl(selector) {
  const { type, b64 } = await page.$eval(selector, async (a) => {
    const blob = await (await fetch(a.href)).blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { type: blob.type, b64: btoa(s) };
  });
  return { type, buf: Buffer.from(b64, 'base64') };
}

async function addPlayer(p) {
  await page.click('#add-player');
  await page.waitForSelector('dialog[open] .player-form');
  await page.type('dialog input[name=name]', p.name);
  if (p.nickname) await page.type('dialog input[name=nickname]', p.nickname);
  for (const pos of p.positions) {
    await page.$$eval('dialog .chip-toggle', (labels, pos) => labels.find((l) => l.textContent.trim() === pos).click(), pos);
  }
  await page.type('dialog input[name=heightFt]', String(p.ft));
  await page.type('dialog input[name=heightIn]', String(p.inch));
  await page.type('dialog input[name=weight]', String(p.lb));
  await page.type('dialog input[name=years]', String(p.years));
  if (p.hideWeight) await page.click('dialog input[name=show-weight]');
  for (const kind of ['serious', 'fun']) {
    const input = await page.$(`dialog .photo-pick[data-kind=${kind}] input[type=file]`);
    await input.uploadFile(p[kind]);
    await page.waitForSelector(`dialog .photo-pick[data-kind=${kind}] canvas[data-crop]:not([hidden])`);
  }
  await page.click('dialog [data-action=save]');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
}

test('add players with Serious and Fun photos', async () => {
  // Saving an empty form is refused in-page, not with a browser alert.
  await page.click('#add-player');
  await page.waitForSelector('dialog[open]');
  await page.click('dialog [data-action=save]');
  const err = await page.$eval('dialog .err[data-for=name]', (e) => e.textContent);
  assert.match(err, /required/);
  await page.click('dialog [data-action=cancel]');

  for (const p of SQUAD) await addPlayer(p);
  const cards = await page.$$eval('.player-card', (els) => els.map((c) => c.querySelector('h3').textContent));
  assert.deepEqual(cards, SQUAD.map((p) => p.name).sort());

  // Both photos show on each card, and the stored originals are resized to at most 1200 px.
  await page.waitForFunction(() => document.querySelectorAll('.player-card canvas[data-rendered]').length === 6);
  const sizes = await page.evaluate(async () => {
    const { openStore } = await import('/js/storage.js');
    const store = await openStore();
    return Promise.all((await store.getAll('photos')).map(async (r) => { const b = await createImageBitmap(r.blob); return [b.width, b.height]; }));
  });
  assert.equal(sizes.length, 6);
  for (const [w, h] of sizes) assert.ok(Math.max(w, h) === 1200, `photo is ${w}x${h}`);

  const alex = await page.$$eval('.player-card', (els) => {
    const card = els.find((c) => c.querySelector('h3').textContent === 'Alex Ortega');
    return { stats: card.querySelector('.stats').textContent, hidden: [...card.querySelectorAll('.stat.off dt')].map((d) => d.textContent) };
  });
  assert.match(alex.stats, /6'1"/);
  assert.deepEqual(alex.hidden, ['Weight']);
});

test('pick a match, with a warning when a player is picked twice', async () => {
  await page.click('[data-tab=match]');
  await page.click('#new-match');
  await page.waitForSelector('#match-form:not([hidden])');
  await page.type('#m-opponent', 'Santa Monica');
  await page.type('#m-venue', 'Woodley Park');
  const ids = await page.$$eval('.player-card', (els) => Object.fromEntries(els.map((c) => [c.querySelector('h3').textContent, c.dataset.id])));

  await page.select('select[data-slot="1"]', ids['Alex Ortega']);
  await page.select('select[data-slot="2"]', ids['Bo Tanaka']);
  await page.select('select[data-slot="3"]', ids['Chris Mbeki']);
  await page.select('select[data-slot="17"]', ids['Alex Ortega']);
  await page.waitForSelector('#dup-warning:not([hidden])');
  assert.match(await page.$eval('#dup-warning', (e) => e.textContent), /Alex Ortega is picked twice: shirts 1 and 17/);
  await page.select('select[data-slot="17"]', '');
  await page.waitForSelector('#dup-warning[hidden]');

  await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Saved');
  assert.match(await page.$eval('#match-list', (e) => e.textContent), /vs Santa Monica/);
  assert.equal(await page.$eval('#xv-count', (e) => e.textContent), '3/15');
});

test('copy the match for next week keeps the selection', async () => {
  await page.click('#copy-match');
  await page.waitForFunction(() => document.querySelectorAll('#match-list li').length === 2);
  assert.equal(await page.$eval('#m-opponent', (e) => e.value), '');
  assert.equal(await page.$eval('#xv-count', (e) => e.textContent), '3/15');
  await page.type('#m-opponent', 'Belmont Shore');
  await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Saved');
});

test('export a team sheet PNG at post and story size', async () => {
  await page.click('[data-tab=sheet]');
  for (const [size, w, h] of [['post', 1080, 1350], ['story', 1080, 1920]]) {
    await page.click(`input[name=sheet-size][value=${size}]`);
    await page.waitForFunction((s) => document.querySelector('#sheet-canvas').dataset.rendered === s, {}, size);
    await page.click('#sheet-export');
    await page.waitForFunction((s) => document.querySelector('#sheet-link').download.endsWith(`-${s}.png`), {}, size);
    const { type, buf } = await readBlobUrl('#sheet-link');
    assert.equal(type, 'image/png');
    assert.deepEqual(pngSize(buf), { width: w, height: h });
    assert.ok(buf.length > 50_000, `PNG suspiciously small: ${buf.length} bytes`);
  }
  assert.match(await page.$eval('#sheet-link', (a) => a.download), /^sfv-vs-belmont-shore-\d{4}-\d{2}-\d{2}-story\.png$/);
});

test('preview plays in the page', async () => {
  await page.click('[data-tab=video]');
  await page.waitForFunction(() => /Length \d+:\d{2}/.test(document.querySelector('#video-length').textContent));
  await page.click('#video-play');
  await page.waitForFunction(() => Number(document.querySelector('#video-scrub').value) > 0, { timeout: 5000 });
  await page.click('#video-play'); // pause
});

test('cancel stops a video export', async () => {
  await page.click('#video-export');
  await page.waitForSelector('#video-progress:not([hidden])');
  await page.click('#video-cancel');
  await page.waitForSelector('#video-progress[hidden]');
  assert.equal(await page.$eval('#video-result', (e) => e.hidden), true);
});

test('render a short lineup video', async () => {
  await page.click('#video-export');
  await page.waitForSelector('#video-result:not([hidden])', { timeout: (CLIP + 20) * 1000 });
  const { type, buf } = await readBlobUrl('#video-link');
  assert.match(type, /^video\/(mp4|webm)$/);
  assert.ok(buf.length > 10_000, `video is only ${buf.length} bytes`);
  if (type === 'video/mp4') assert.equal(buf.toString('ascii', 4, 8), 'ftyp');
  else assert.deepEqual([...buf.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
  const name = await page.$eval('#video-link', (a) => a.download);
  assert.ok(name.endsWith(type === 'video/mp4' ? '-lineup.mp4' : '-lineup.webm'), name);
  console.log(`  video: ${type}, ${buf.length} bytes`);
});

/** True once the loaded video and the Download button are both fully on screen, below the sticky tabs. */
const resultInView = () => page.waitForFunction(() => {
  const video = document.querySelector('#video-output');
  if (video.readyState < 1) return false;
  const top = document.querySelector('.tabs').getBoundingClientRect().bottom;
  const v = video.getBoundingClientRect();
  const link = document.querySelector('#video-link').getBoundingClientRect();
  return v.height > 200 && v.top >= top - 1 && link.bottom <= innerHeight + 1;
}, { timeout: 8000 });

test('after an export the whole video and the Download button are in view', async () => {
  // Desktop: the export above already finished and scrolled.
  await resultInView();
  // Phone width, starting from the top of the page.
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#video-export');
  await page.waitForSelector('#video-result:not([hidden])', { timeout: (CLIP + 20) * 1000 });
  await resultInView();
  await page.setViewport({ width: 1400, height: 1000 });
});

test('everything is still there after a reload', async () => {
  await page.goto(`${base}#squad`);
  await page.waitForSelector('html[data-ready="true"]');
  assert.equal((await page.$$('.player-card')).length, 3);
  await page.click('[data-tab=match]');
  assert.equal((await page.$$('#match-list li')).length, 2);
});

test('no native dialogs and no page errors', () => {
  assert.deepEqual(nativeDialogs, []);
  assert.deepEqual(pageErrors, []);
});
