// Shared steps for the visual QA scripts (npm run qa / qa:6). They drive the real UI in
// Google Chrome like a coach would and write screenshots to qa/ (git-ignored).
// Not part of npm test: they need real portrait photos and take a while.
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { startServer } from '../serve.js';

export const REPO = fileURLToPath(new URL('../..', import.meta.url));
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
export const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

/** Portrait photos: pexels-*.jpg from QA_PHOTOS (default ~/Downloads). */
export async function findPhotos() {
  const dir = process.env.QA_PHOTOS || join(homedir(), 'Downloads');
  const photos = (await readdir(dir)).filter((f) => /^pexels-.*\.jpe?g$/i.test(f)).sort().map((f) => join(dir, f));
  if (!photos.length) throw new Error(`No pexels-*.jpg photos in ${dir}. Set QA_PHOTOS to a folder of portraits.`);
  return photos;
}

/** Fresh browser profile and server. clean empties out first. Problems collects page errors and failed requests. */
export async function launch(out, { clean = false } = {}) {
  if (clean) await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const profile = await mkdtemp(join(tmpdir(), 'matchday-qa-'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile });
  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url().replace(base, '/')}`); });
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto(base);
  await page.waitForSelector('html[data-ready="true"]');

  const file = (name) => join(out, `${name}.png`);
  const savePng = (name, dataUrl) => writeFile(file(name), Buffer.from(dataUrl.split(',')[1], 'base64'));
  return {
    browser, page, problems,
    shot: async (name, opts = {}) => { await page.screenshot({ path: file(name), ...opts }); log('shot', name); },
    shotEl: async (name, sel) => { await (await page.$(sel)).screenshot({ path: file(name) }); log('shot', name); },
    canvasPng: async (name, sel) => { await savePng(name, await page.$eval(sel, (c) => c.toDataURL('image/png'))); log('canvas', name); },
    savePng,
    async close() {
      await writeFile(join(out, 'problems.json'), JSON.stringify(problems, null, 2));
      await browser.close();
      server.close();
      await rm(profile, { recursive: true, force: true });
    },
  };
}

const waitPhoto = (page, kind) => page.waitForFunction((k) => {
  const s = document.querySelector(`dialog .photo-pick[data-kind="${k}"] .crop-status`)?.textContent || '';
  return s && !/Resizing|Looking/.test(s);
}, { timeout: 60000 }, kind);

async function uploadPhoto(page, kind, path, problems, who) {
  await (await page.$(`dialog .photo-pick[data-kind="${kind}"] input[type=file]`)).uploadFile(path);
  await waitPhoto(page, kind);
  const status = await page.$eval(`dialog .photo-pick[data-kind="${kind}"] .crop-status`, (e) => e.textContent);
  if (!/Face found/.test(status)) problems.push(`${who} ${kind}: ${status}`);
}

const closed = (page) => page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 30000 });

/** p: { name, nickname, positions, ft, in, lb, years, caps }; photos: [serious, fun]. onFilled runs before saving. */
export async function addPlayer(qa, p, [serious, fun], onFilled) {
  const { page } = qa;
  await page.click('#add-player');
  await page.waitForSelector('dialog[open] .player-form');
  await page.type('dialog input[name=name]', p.name);
  if (p.nickname) await page.type('dialog input[name=nickname]', p.nickname);
  for (const pos of p.positions) await page.click(`dialog [data-positions] input[value="${pos}"]`);
  for (const [field, v] of [['heightFt', p.ft], ['heightIn', p.in], ['weight', p.lb], ['years', p.years], ['caps', p.caps]]) {
    await page.type(`dialog input[name=${field}]`, String(v));
  }
  await uploadPhoto(page, 'serious', serious, qa.problems, p.name);
  await uploadPhoto(page, 'fun', fun, qa.problems, p.name);
  await onFilled?.();
  await page.click('dialog [data-action=save]');
  await closed(page);
  log('added', p.name);
}

export async function addCoach(qa, { name, role }, photo) {
  const { page } = qa;
  await page.click('#add-coach');
  await page.waitForSelector('dialog[open] .coach-form');
  await page.type('dialog input[name=name]', name);
  await page.type('dialog input[name=role]', role);
  if (photo) await uploadPhoto(page, 'coach', photo, qa.problems, name);
  await page.click('dialog [data-action=save]');
  await closed(page);
  log('added coach', name);
}

export const waitSquadRendered = (page) => page.waitForFunction(
  () => [...document.querySelectorAll('.card-photo canvas')].every((c) => c.dataset.rendered), { timeout: 60000 });

/** Open a player's crop editor, then drag, zoom, pan while zoomed and Auto crop, with a shot of each. */
export async function cropEditorPass(qa, name, prefix, { save = false } = {}) {
  const { page } = qa;
  const btn = await page.evaluateHandle((n) => [...document.querySelectorAll('.player-card')]
    .find((c) => c.querySelector('h3').textContent === n).querySelector('.card-actions .btn'), name);
  await btn.click();
  await page.waitForSelector('dialog[open] .player-form');
  const S = 'dialog .photo-pick[data-kind="serious"]';
  await settle(800);
  const cropOf = async () => JSON.parse(await page.$eval(`${S} .crop-canvas`, (c) => c.dataset.crop));
  const box = await (await page.$(`${S} .crop-canvas`)).boundingBox();
  const drag = async (dx, dy) => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) await page.mouse.move(box.x + box.width / 2 + k * dx, box.y + box.height / 2 + k * dy);
    await page.mouse.up();
    await settle();
  };
  const crops = { opened: await cropOf() };
  await qa.shot(`${prefix}-edit-player`);
  await qa.shotEl(`${prefix}a-crop-opened`, S);
  await drag(6, 4);
  crops.dragged = await cropOf();
  await qa.shotEl(`${prefix}b-crop-dragged`, S);
  await page.$eval(`${S} .crop-zoom`, (z) => { z.value = '1.8'; z.dispatchEvent(new Event('input', { bubbles: true })); });
  await settle();
  crops.zoomed = await cropOf();
  await qa.shotEl(`${prefix}c-crop-zoomed`, S);
  await drag(-6, 0); // room to pan sideways once zoomed
  crops.zoomedDraggedLeft = await cropOf();
  await qa.shotEl(`${prefix}d-crop-zoomed-dragged-left`, S);
  await page.click(`${S} [data-autocrop]`);
  await page.waitForFunction((s) => !/Looking/.test(document.querySelector(`${s} .crop-status`).textContent), {}, S);
  await settle();
  crops.auto = await cropOf();
  await qa.shotEl(`${prefix}e-crop-auto`, S);
  await page.click(`dialog [data-action=${save ? 'save' : 'cancel'}]`);
  await closed(page);
  return crops;
}

/** New match through the Match tab. picks: [[shirt, playerName]]. */
export async function createMatch(qa, { opponent, date, kickoff, venue, competition, picks, captain, vice }) {
  const { page } = qa;
  await page.click('[data-tab=match]');
  await page.click('#new-match');
  await page.waitForSelector('#match-form:not([hidden])');
  await page.type('#m-opponent', opponent);
  await page.$eval('#m-date', (d, v) => {
    d.value = v;
    d.dispatchEvent(new Event('input', { bubbles: true }));
    d.dispatchEvent(new Event('change', { bubbles: true }));
  }, date);
  await page.select('#m-kickoff', kickoff);
  await page.type('#m-venue', venue);
  if (competition) await page.type('#m-competition', competition);
  const ids = await page.evaluate(async () => {
    const { openStore } = await import('/js/storage.js');
    return Object.fromEntries((await (await openStore()).getAll('players')).map((p) => [p.name, p.id]));
  });
  for (const [shirt, name] of picks) await page.select(`select[data-slot="${shirt}"]`, ids[name]);
  await page.select('#m-captain', ids[captain]);
  if (vice) await page.select('#m-vice', ids[vice]);
  for (const box of await page.$$('#m-coaches input')) await box.click();
  await page.waitForFunction(() => document.querySelector('#save-status').textContent === 'Saved');
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** Team sheet tab: page shots and full-size PNGs for post and story. */
export async function teamSheets(qa, prefix) {
  const { page } = qa;
  await page.click('[data-tab=sheet]');
  for (const size of ['post', 'story']) {
    await page.click(`input[name=sheet-size][value=${size}]`);
    await page.waitForSelector(`#sheet-canvas[data-rendered=${size}]`);
    await settle();
    await qa.shot(`${prefix}-sheet-${size}-tab`, { fullPage: true });
    await qa.canvasPng(`${prefix}-sheet-${size}`, '#sheet-canvas');
  }
  const note = await page.$eval('#sheet-note', (e) => e.textContent);
  await page.click('input[name=sheet-size][value=post]');
  return note;
}

/** Moments worth a frame, from the saved match's timeline: intro, each group before/after the flip, sheet. */
export function frameTimes(page) {
  return page.evaluate(async () => {
    const { openStore } = await import('/js/storage.js');
    const { buildTimeline, VIDEO_TEMPLATE } = await import('/js/timeline.js');
    const store = await openStore();
    const m = (await store.getAll('matches'))[0];
    const settings = await store.get('settings', 'settings');
    const tl = buildTimeline(VIDEO_TEMPLATE, { speed: settings?.speed ?? 1, selection: m.selection, coaches: m.coaches });
    const groups = tl.segments.filter((s) => s.type === 'group').map((s) => {
      const last = s.cards[s.cards.length - 1];
      return s.kind === 'coaches'
        ? { key: s.key, before: null, after: (last.inEnd + s.cards[0].outStart) / 2 }
        : { key: s.key, before: (last.inEnd + s.cards[0].flipStart) / 2, after: (last.flipEnd + s.cards[0].outStart) / 2 };
    });
    return { duration: tl.duration, intro: tl.segments[0].fadeOutStart - 0.2, groups, sheet: tl.segments.at(-1).end - 0.5 };
  });
}

/** Seek the preview to an exact time (the scrubber normally steps in 1/1000ths). */
export const seek = (page, t, duration) => page.evaluate((t, d) => {
  const s = document.querySelector('#video-scrub');
  s.step = 'any';
  s.value = String((t / d) * 1000);
  s.dispatchEvent(new Event('input'));
}, t, duration);

/** Preview frame at time t with VIDEO_TEMPLATE.layout overrides applied (restored afterwards). */
export async function frameWithLayout(page, t, duration, layout) {
  return page.evaluate(async (t, d, layout) => {
    const { VIDEO_TEMPLATE } = await import('/js/timeline.js');
    const saved = { ...VIDEO_TEMPLATE.layout };
    Object.assign(VIDEO_TEMPLATE.layout, layout);
    const rebuild = () => new Promise((r) => {
      document.querySelector('#video-transition').dispatchEvent(new Event('change'));
      setTimeout(r, 1500);
    });
    await rebuild();
    const s = document.querySelector('#video-scrub');
    s.step = 'any';
    s.value = String((t / d) * 1000);
    s.dispatchEvent(new Event('input'));
    const png = document.querySelector('#video-canvas').toDataURL('image/png');
    Object.assign(VIDEO_TEMPLATE.layout, saved);
    await rebuild();
    return png;
  }, t, duration, layout);
}

/** Two frames side by side with titles, the 1080×1920 frame edge outlined. */
export function sideBySide(page, [a, titleA], [b, titleB]) {
  return page.evaluate(async (a, b, titleA, titleB) => {
    const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const pad = 40;
    const head = 120;
    const c = document.createElement('canvas');
    c.width = ia.width * 2 + pad * 3;
    c.height = ia.height + head + pad;
    const g = c.getContext('2d');
    g.fillStyle = '#222';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(ia, pad, head);
    g.drawImage(ib, ia.width + pad * 2, head);
    g.fillStyle = '#fff';
    g.font = '700 56px Helvetica, Arial';
    g.textAlign = 'center';
    g.fillText(titleA, pad + ia.width / 2, 85);
    g.fillText(titleB, ia.width * 1.5 + pad * 2, 85);
    g.strokeStyle = 'rgba(0,255,255,0.8)';
    g.lineWidth = 4;
    g.strokeRect(pad, head, ia.width, ia.height);
    g.strokeRect(ia.width + pad * 2, head, ib.width, ib.height);
    return c.toDataURL('image/png');
  }, a, b, titleA, titleB);
}
