// Fixes from the second new-user test: toasts, hints, auto-pick, bench packing, Share, Start over.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { startServer } from '../../scripts/serve.js';

const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CLIP = 2; // seconds of video to export

let server;
let browser;
let page;
const pageErrors = [];
const nativeDialogs = [];

// A squad with one player for every starting position, plus a few spares.
const SQUAD = [
  ['Pat Loose', 'Prop'], ['Tom Tight', 'Prop'], ['Hal Hooker', 'Hooker'], ['Lou Lock', 'Lock'], ['Len Lock', 'Lock'],
  ['Fin Flanker', 'Flanker'], ['Flo Flanker', 'Flanker'], ['Nate Eight', 'Number 8'], ['Sam Scrum', 'Scrum-half'],
  ['Fly Half', 'Fly-half'], ['Cam Centre', 'Centre'], ['Cy Centre', 'Centre'], ['Will Wing', 'Wing'], ['Wes Wing', 'Wing'],
  ['Fred Fullback', 'Fullback'], ['Hugo Spare', 'Hooker'], ['Pete Spare', 'Prop'],
];

before(async () => {
  server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/`;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', async (d) => { nativeDialogs.push(d.type()); await d.dismiss(); });
  // Stand-in for a phone's share sheet: records what would be shared.
  await page.evaluateOnNewDocument(() => {
    window.__shared = [];
    window.__canShare = true;
    navigator.canShare = (d) => window.__canShare && !!d?.files?.length;
    navigator.share = async (d) => { window.__shared.push({ title: d.title, files: d.files.map((f) => ({ name: f.name, type: f.type, size: f.size })) }); };
  });
  await page.goto(`${base}?clip=${CLIP}#squad`);
  await page.waitForSelector('html[data-ready="true"]');
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function addPlayer(name, position) {
  await page.click('#add-player');
  await page.waitForSelector('dialog[open] .player-form');
  await page.type('dialog input[name=name]', name);
  await page.$$eval('dialog .chip-toggle', (labels, pos) => labels.find((l) => l.textContent.trim() === pos).click(), position);
  await page.click('dialog [data-action=save]');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
}

const idOf = (name) => page.evaluate(async (name) => {
  const { openStore } = await import('/js/storage.js');
  return (await (await openStore()).getAll('players')).find((p) => p.name === name)?.id;
}, name);
const shirt = (slot) => page.$eval(`select[data-slot="${slot}"]`, (s) => (s.value ? s.selectedOptions[0].textContent.split(' · ')[0] : ''));
const saved = () => page.waitForFunction(() => document.querySelector('#save-status').dataset.state === 'saved');

const CONTROLS = 'main button, main a[href], main select, main input:not([type=file]), main label.btn';

/** Mark the controls already scrolled under the sticky tab bar: a toast can't be blamed for those. */
const markUnderBar = () => page.evaluate((sel) => {
  const bar = document.querySelector('.tabs').getBoundingClientRect().bottom;
  for (const c of document.querySelectorAll(sel)) c.toggleAttribute('data-under-bar', c.getBoundingClientRect().top < bar);
}, CONTROLS);

/** Visible buttons, links and fields that a toast is on top of. */
const coveredControls = () => page.evaluate((sel) => {
  const toasts = [...document.querySelectorAll('.toast')].map((t) => t.getBoundingClientRect());
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  return [...document.querySelectorAll(sel)]
    .filter((c) => c.offsetParent && c.getBoundingClientRect().width && !c.hasAttribute('data-under-bar'))
    .filter((c) => toasts.some((t) => hit(t, c.getBoundingClientRect())))
    .map((c) => c.textContent.trim() || c.id || c.tagName);
}, CONTROLS);

test('the player form explains the Serious and Fun photos; the squad explains photo styles', async () => {
  await page.click('#add-player');
  await page.waitForSelector('dialog[open] .player-form');
  const hint = await page.$eval('dialog .photo-hint', (e) => e.textContent);
  assert.match(hint, /Serious.*team sheet/);
  assert.match(hint, /Fun.*flips/);
  await page.click('dialog [data-action=cancel]');
  const style = await page.$eval('#photo-style-help', (e) => (e.offsetParent ? e.textContent : ''));
  assert.match(style, /Off.*Auto.*Club grade/s, 'visible one-line explanation of the styles');
});

test('toasts never cover the page controls and never stack', async () => {
  for (const [name, pos] of SQUAD) await addPlayer(name, pos);
  // Every save above made a toast, but only the last remains.
  assert.equal((await page.$$('.toast:not(.leaving)')).length, 1);
  for (const width of [1400, 1000, 390]) {
    await page.setViewport({ width, height: 900, isMobile: width < 600, hasTouch: width < 600 });
    for (const scroll of [0, 600]) {
      await page.evaluate((y) => window.scrollTo(0, y), scroll);
      await markUnderBar();
      await page.evaluate(async () => {
        const { toast } = await import('/js/dialog.js');
        toast('First message about something');
        toast('Second message about something else');
        toast('Third message, which pushes the first one out');
      });
      const shown = await page.$$eval('.toast:not(.leaving)', (ts) => ts.map((t) => t.textContent));
      assert.deepEqual(shown, ['Third message, which pushes the first one out'], `${width}px: only the newest shows`);
      const box = await page.$eval('.toast:not(.leaving)', (t) => { const r = t.getBoundingClientRect(); const bar = document.querySelector('.tabs').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, barTop: bar.top, barBottom: bar.bottom }; });
      assert.ok(box.top >= box.barTop - 1 && box.bottom <= box.barBottom + 1, `${width}px: the toast stays inside the tab bar ${JSON.stringify(box)}`);
      assert.deepEqual(await coveredControls(), [], `${width}px wide, scrolled ${scroll}px: no control under a toast`);
      // Taps go through a toast to whatever is underneath.
      assert.equal(await page.$eval('.toast', (t) => getComputedStyle(t.parentElement).pointerEvents), 'none');
    }
  }
  await page.setViewport({ width: 1400, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
});

test('the Match tab says clearly when changes are saved', async () => {
  await page.click('[data-tab=match]');
  await page.click('#new-match');
  await page.waitForSelector('#match-form:not([hidden])');
  assert.match(await page.$eval('#save-status', (e) => e.textContent), /save automatically/i);
  await page.type('#m-opponent', 'Santa Monica');
  await saved();
  const status = await page.$eval('#save-status', (e) => ({ text: e.textContent, colour: getComputedStyle(e).color }));
  assert.equal(status.text, '✓ Saved on this device');
  assert.equal(status.colour, 'rgb(29, 122, 70)', 'saved shows in green');
});

test('Auto-pick fills empty shirts by position and keeps shirts already picked', async () => {
  // The coach's own choices: a prop at 3 and a spare hooker at 2.
  await page.select('select[data-slot="3"]', await idOf('Pete Spare'));
  await page.select('select[data-slot="2"]', await idOf('Hugo Spare'));
  await saved();
  await page.click('#auto-pick');
  await saved();
  assert.equal(await shirt(3), 'Pete Spare', 'picked shirt kept');
  assert.equal(await shirt(2), 'Hugo Spare', 'picked shirt kept');
  assert.equal(await shirt(8), 'Nate Eight');
  assert.equal(await shirt(9), 'Sam Scrum');
  assert.equal(await shirt(10), 'Fly Half');
  assert.equal(await shirt(15), 'Fred Fullback');
  assert.equal(await page.$eval('#xv-count', (e) => e.textContent), '15/15');
  // The two players left over (a prop and the first-choice hooker) go to the bench from 16.
  assert.equal(await page.$eval('#bench-count', (e) => e.textContent), '2/8');
  assert.ok((await shirt(16)) && (await shirt(17)) && !(await shirt(18)));
  assert.equal(await page.$eval('#dup-warning', (e) => e.hidden), true, 'nobody picked twice');
  assert.match(await page.$eval('.toast:last-child', (e) => e.textContent), /Picked 15 players/);
});

test('replacements pack from 16 upward', async () => {
  // Clear the bench, then pick into shirt 21: the player lands in 16.
  for (const s of [17, 16]) await page.select(`select[data-slot="${s}"]`, '');
  await page.select('select[data-slot="21"]', await idOf('Pete Spare'));
  // Pete was also at 3; take him off there so the bench is the only place.
  await page.select('select[data-slot="3"]', await idOf('Tom Tight'));
  await saved();
  assert.equal(await shirt(16), 'Pete Spare');
  assert.equal(await shirt(21), '');
  assert.match(await page.$eval('#bench-note', (e) => e.textContent), /moved to 16/);
  await page.select('select[data-slot="23"]', await idOf('Hugo Spare'));
  assert.equal(await shirt(17), 'Hugo Spare');
  // Clearing 16 closes the gap: 17 moves down.
  await page.select('select[data-slot="16"]', '');
  await saved();
  assert.equal(await shirt(16), 'Hugo Spare');
  assert.equal(await shirt(17), '');
  const stored = await page.evaluate(async () => {
    const { openStore } = await import('/js/storage.js');
    const [m] = await (await openStore()).getAll('matches');
    return [16, 17, 18, 19, 20, 21, 22, 23].map((s) => !!m.selection[s]);
  });
  assert.deepEqual(stored, [true, false, false, false, false, false, false, false], 'saved packed');
});

test('after exporting, Share opens the share sheet with the PNG and the video; Download stays', async () => {
  await page.click('[data-tab=sheet]');
  await page.waitForFunction(() => document.querySelector('#sheet-canvas').dataset.rendered);
  await page.click('#sheet-export');
  await page.waitForSelector('#sheet-share:not([hidden])');
  assert.equal(await page.$eval('#sheet-link', (a) => a.hidden), false, 'Save again link still there');
  await page.click('#sheet-share');
  await page.waitForFunction(() => window.__shared.length === 1);
  const sheet = await page.evaluate(() => window.__shared[0]);
  assert.match(sheet.files[0].name, /^sfv-vs-santa-monica-.*-post\.png$/);
  assert.equal(sheet.files[0].type, 'image/png');
  assert.ok(sheet.files[0].size > 10_000);

  await page.click('[data-tab=video]');
  await page.waitForFunction(() => /Length/.test(document.querySelector('#video-length').textContent));
  await page.click('#video-export');
  await page.waitForSelector('#video-result:not([hidden])', { timeout: (CLIP + 20) * 1000 });
  assert.equal(await page.$eval('#video-share', (b) => b.hidden), false);
  assert.ok(await page.$eval('#video-link', (a) => a.href.startsWith('blob:') && a.download), 'Download is still offered');
  await page.click('#video-share');
  await page.waitForFunction(() => window.__shared.length === 2);
  const video = await page.evaluate(() => window.__shared[1]);
  assert.match(video.files[0].name, /-lineup\.(mp4|webm)$/);
  assert.match(video.files[0].type, /^video\//);
});

test('no Share button where the browser cannot share files', async () => {
  await page.evaluate(() => { window.__canShare = false; });
  await page.click('[data-tab=sheet]');
  await page.click('#sheet-export');
  await page.waitForFunction(() => document.querySelector('#sheet-share').hidden);
  await page.evaluate(() => { window.__canShare = true; });
});

test('Start over clears players, coaches and matches after one confirm that offers a backup', async () => {
  await page.click('[data-tab=squad]');
  // The link sits under the backup buttons.
  const pos = await page.evaluate(() => {
    const b = document.querySelector('#backup').getBoundingClientRect();
    const s = document.querySelector('#start-over').getBoundingClientRect();
    return { below: s.top >= b.bottom - 1 };
  });
  assert.ok(pos.below, 'Start over is under the backup buttons');

  // Cancel changes nothing.
  await page.click('#start-over');
  await page.waitForSelector('dialog[open]');
  assert.match(await page.$eval('dialog', (d) => d.textContent), /Back up first/);
  await page.click('dialog [data-action=cancel]');
  assert.equal((await page.$$('.player-card')).length, SQUAD.length);

  await page.click('#start-over');
  await page.waitForSelector('dialog[open]');
  await page.click('dialog [data-action=backup]');
  await page.waitForFunction(() => document.querySelector('dialog .start-over-tip.done'));
  assert.ok(await page.$('dialog[open]'), 'backing up keeps the dialog open');
  await page.click('dialog [data-action=delete]');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  await page.waitForFunction(() => !document.querySelector('#squad-empty').hidden);

  const left = await page.evaluate(async () => {
    const { openStore } = await import('/js/storage.js');
    const store = await openStore();
    const n = async (name) => (await store.getAll(name)).length;
    return { players: await n('players'), coaches: await n('coaches'), matches: await n('matches'), photos: await n('photos') };
  });
  assert.deepEqual(left, { players: 0, coaches: 0, matches: 0, photos: 0 });
  assert.equal((await page.$$('.player-card')).length, 0);
  assert.equal(await page.$eval('#squad-empty', (e) => e.hidden), false);
  await page.click('[data-tab=match]');
  assert.equal(await page.$eval('#match-none', (e) => e.hidden), false);
});

test('no native dialogs and no page errors', () => {
  assert.deepEqual(nativeDialogs, []);
  assert.deepEqual(pageErrors, []);
});
