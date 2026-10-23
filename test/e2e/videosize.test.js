// A full-length lineup video exported at Standard quality stays under 20 MB (recorded in real time, about a minute).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { startServer } from '../../scripts/serve.js';

const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LIMIT = 20 * 1024 * 1024;

let server;
let browser;
let page;
const pageErrors = [];

before(async () => {
  server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/`;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto(`${base}#squad`);
  await page.waitForSelector('html[data-ready="true"]');
  // A full match: 23 players and 6 coaches, every one with detailed photos (shapes, shading and
  // grain, so the encoder has as much to do as with real photos).
  await page.evaluate(async () => {
    const { openStore } = await import('/js/storage.js');
    const { ALL_SLOTS, normalizeCoach, normalizeMatch, normalizePlayer } = await import('/js/model.js');
    const store = await openStore();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    async function photo(id) {
      const c = document.createElement('canvas');
      c.width = 900; c.height = 1200;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 900, 1200);
      grad.addColorStop(0, `hsl(${rnd() * 360} 50% 40%)`);
      grad.addColorStop(1, `hsl(${rnd() * 360} 60% 70%)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 900, 1200);
      for (let i = 0; i < 400; i++) {
        g.fillStyle = `hsl(${rnd() * 360} ${30 + rnd() * 50}% ${20 + rnd() * 60}% / ${0.2 + rnd() * 0.6})`;
        g.beginPath();
        g.arc(rnd() * 900, rnd() * 1200, 5 + rnd() * 80, 0, Math.PI * 2);
        g.fill();
      }
      const px = g.getImageData(0, 0, 900, 1200);
      for (let i = 0; i < px.data.length; i += 4) {
        const n = (rnd() - 0.5) * 30;
        px.data[i] += n; px.data[i + 1] += n; px.data[i + 2] += n;
      }
      g.putImageData(px, 0, 0);
      await store.put('photos', { id, blob: await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)) });
    }
    const selection = {};
    for (const s of ALL_SLOTS) {
      await photo(`s${s}`);
      await photo(`f${s}`);
      await store.put('players', normalizePlayer({
        id: `p${s}`, name: `Player${s} Surname${s}`, nickname: `Nick${s}`, positions: ['Prop'],
        heightCm: 175 + s, weightKg: 85 + s, years: 1 + (s % 9), caps: 10 + s, photos: { serious: `s${s}`, fun: `f${s}` },
      }));
      selection[s] = `p${s}`;
    }
    const coaches = [];
    for (let i = 0; i < 6; i++) {
      await photo(`c${i}`);
      await store.put('coaches', normalizeCoach({ id: `c${i}`, name: `Coach${i} Surname${i}`, role: 'Assistant', photo: `c${i}` }));
      coaches.push(`c${i}`);
    }
    await store.put('matches', normalizeMatch({
      id: 'm1', opponent: 'Santa Monica', date: '2026-10-24', kickoff: '14:30', venue: 'Balboa Park',
      competition: 'SCRFU D2', selection, captain: 'p8', viceCaptain: 'p10', coaches,
    }));
    await store.put('settings', { id: 'settings', activeMatchId: 'm1' });
  });
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
});

after(async () => {
  await browser?.close();
  server?.close();
});

test('Quality defaults to Standard, and a full-length Standard export is under 20 MB', async () => {
  await page.click('[data-tab=video]');
  await page.waitForFunction(() => /Length/.test(document.querySelector('#video-length').textContent));
  assert.equal(await page.$eval('#video-quality', (s) => s.value), 'standard');
  const length = await page.$eval('#video-length', (e) => e.textContent);
  const [, mm, ss] = /Length (\d+):(\d\d)/.exec(length);
  assert.ok(Number(mm) * 60 + Number(ss) >= 55, `full-length video: ${length}`);

  await page.click('#video-export');
  await page.waitForSelector('#video-result:not([hidden])', { timeout: 150_000 });
  const { size, type } = await page.$eval('#video-link', (a) => ({ size: Number(a.dataset.size), type: a.dataset.type }));
  assert.match(type, /^video\//);
  assert.ok(size > 1024 * 1024, `a real recording, not an empty one (${size} bytes)`);
  assert.ok(size < LIMIT, `Standard export is ${(size / 1024 / 1024).toFixed(1)} MB, over 20 MB`);
  assert.match(await page.$eval('#video-format', (e) => e.textContent), /MB/);
});

test('the Quality choice is saved and locked while recording', async () => {
  await page.select('#video-quality', 'high');
  await page.waitForFunction(async () => {
    const { openStore } = await import('/js/storage.js');
    return (await (await openStore()).get('settings', 'settings'))?.videoQuality === 'high';
  });
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await page.click('[data-tab=video]');
  assert.equal(await page.$eval('#video-quality', (s) => s.value), 'high');
  await page.click('#video-export');
  await page.waitForSelector('#video-progress:not([hidden])');
  assert.equal(await page.$eval('#video-quality', (s) => s.disabled), true);
  await page.click('#video-cancel');
  await page.waitForFunction(() => !document.querySelector('#video-quality').disabled);
  await page.select('#video-quality', 'standard');
});

test('no page errors', () => {
  assert.deepEqual(pageErrors, []);
});
