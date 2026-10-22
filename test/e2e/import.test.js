// Squad import from a spreadsheet, through the real Squad tab in headless Chrome.
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
const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

let server;
let browser;
let page;
let dir;
const pageErrors = [];
const nativeDialogs = [];

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'matchday-import-'));
  await writeFile(join(dir, 'serious.png'), makePng(800, 1000, [150, 40, 50]));
  await writeFile(join(dir, 'fun.png'), makePng(800, 1000, [40, 90, 150]));
  await writeFile(join(dir, 'no-names.csv'), 'Email,Phone\na@b.c,123\n');
  server = await startServer(0);
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', async (d) => { nativeDialogs.push(d.type()); await d.dismiss(); });
  // Catch downloads (the template) instead of saving them.
  await page.evaluateOnNewDocument(() => {
    window.__downloads = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { window.__downloads.push({ name: this.download, href: this.href }); return; }
      return click.call(this);
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/#squad`);
  await page.waitForSelector('html[data-ready="true"]');
});

after(async () => {
  await browser?.close();
  server?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const stored = () => page.evaluate(async () => {
  const { openStore } = await import('/js/storage.js');
  return (await openStore()).getAll('players');
});

async function upload(path) {
  const input = await page.$('#import-sheet');
  await input.uploadFile(path);
  await page.waitForSelector('dialog[open]');
}

const section = (name) => page.$eval('dialog', (d, name) => {
  const s = d.querySelector(`[data-section=${name}]`);
  if (!s) return null;
  return { title: s.querySelector('h3').textContent, rows: [...s.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent)), text: s.textContent };
}, name);

test('the Squad tab offers import, a template and the Google Sheets tip', async () => {
  const bar = await page.$eval('.import-bar', (e) => e.textContent);
  assert.match(bar, /Import from sheet/);
  assert.match(bar, /Download template/);
  assert.match(bar, /Google Sheets: File › Download › Comma-separated values \(\.csv\)/);
  assert.equal(await page.$eval('#import-sheet', (i) => i.accept), '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await page.click('#import-template');
  await page.waitForFunction(() => window.__downloads.length === 1);
  const t = await page.evaluate(async () => { const d = window.__downloads[0]; return { name: d.name, text: await (await fetch(d.href)).text() }; });
  assert.equal(t.name, 'sfv-squad-template.csv');
  assert.equal(t.text, 'Name,Nickname,Positions,Height,Weight,Years at SFV,Caps\r\n');
});

test('a squad player added by hand, with photos, a crop and weight hidden', async () => {
  await page.click('#add-player');
  await page.waitForSelector('dialog[open] .player-form');
  await page.type('dialog input[name=name]', 'Mateo Alvarez');
  await page.type('dialog input[name=years]', '3');
  await page.click('dialog input[name=show-weight]');
  for (const kind of ['serious', 'fun']) {
    await (await page.$(`dialog .photo-pick[data-kind=${kind}] input[type=file]`)).uploadFile(join(dir, `${kind}.png`));
    await page.waitForSelector(`dialog .photo-pick[data-kind=${kind}] canvas[data-crop]:not([hidden])`);
  }
  await page.click('dialog [data-action=save]');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  const [p] = await stored();
  assert.ok(p.photos.serious && p.photos.fun);
  assert.equal(p.show.weight, false);
});

test('the preview lists new players, updates and rows with errors; Cancel changes nothing', async () => {
  const before = await stored();
  await upload(fixture('sample-squad.csv'));
  const add = await section('add');
  assert.equal(add.title, 'New players (5)');
  assert.deepEqual(add.rows.map((r) => r[0]), ['Christopher Rodriguez “Chris”', 'Sione Taufa', 'Ryan Castillo', 'Ethan Hughes', "Liam O'Connor"]);
  assert.deepEqual(add.rows[0].slice(1), ['Hooker, Prop', '5\'10"', '225 lb', '6', '71']);
  assert.deepEqual(add.rows[3].slice(1, 3), ['Fly-half, Centre', '6\'0"']);
  const upd = await section('update');
  assert.equal(upd.title, 'Updates to players already in the squad (1)');
  assert.equal(upd.rows[0][0], 'Mateo Alvarez');
  for (const change of ['Nickname: —', 'Tank', 'Positions: —', 'Prop', 'Height: —', '5\'11"', 'Weight: —', '265 lb', 'Years at SFV: 3', '4', 'Caps: —', '38']) {
    assert.ok(upd.rows[0][1].includes(change), `${change} in ${upd.rows[0][1]}`);
  }
  const errs = await section('errors');
  assert.equal(errs.title, 'Rows with problems, not imported (4)');
  assert.deepEqual(errs.rows.map((r) => r.slice(0, 2)), [['9', 'Goalie Gary'], ['10', 'Tall Tim'], ['11', '—'], ['12', 'MATEO ALVAREZ']]);
  assert.match(errs.rows[0][2], /Unknown position: "Goalkeeper"/);
  assert.match(errs.rows[1][2], /should be between/);
  assert.match(errs.rows[2][2], /No name/);
  assert.match(errs.rows[3][2], /Same name as row 2/);
  const dialog = await page.$eval('dialog', (d) => d.textContent);
  assert.match(dialog, /Columns not used: Email/);
  assert.match(dialog, /Photos, crops and the "Show in the video" choices are never touched/);
  assert.equal(await page.$eval('dialog [data-action=import]', (b) => b.textContent), 'Import 6 players');

  await page.click('dialog [data-action=cancel]');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.deepEqual(await stored(), before, 'nothing saved');
  assert.equal((await page.$$('.player-card')).length, 1);
});

test('importing adds and updates, keeps photos, crops and toggles, and marks who needs photos', async () => {
  const [mateoBefore] = await stored();
  await upload(fixture('sample-squad.csv'));
  await page.click('dialog [data-action=import]');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  await page.waitForFunction(() => document.querySelectorAll('.player-card').length === 6);
  assert.equal(await page.$eval('.toast:last-child', (t) => t.textContent), 'Added 5 players and updated 1. 5 still need photos (marked in gold).');

  const players = await stored();
  assert.equal(players.length, 6);
  const mateo = players.find((p) => p.id === mateoBefore.id);
  assert.equal(mateo.name, 'Mateo Alvarez');
  assert.equal(mateo.nickname, 'Tank');
  assert.deepEqual(mateo.positions, ['Prop']);
  assert.equal(mateo.weightKg, 120.2);
  assert.equal(mateo.years, 4);
  assert.equal(mateo.caps, 38);
  assert.deepEqual(mateo.photos, mateoBefore.photos, 'photos kept');
  assert.deepEqual(mateo.crops, mateoBefore.crops, 'crops kept');
  assert.deepEqual(mateo.show, mateoBefore.show, 'weight still hidden');

  const cards = await page.$$eval('.player-card', (els) => Object.fromEntries(els.map((c) => [c.querySelector('h3').textContent, {
    tag: c.querySelector('.needs-tag')?.textContent || null, marked: c.classList.contains('needs-photos'),
  }])));
  assert.deepEqual(cards['Mateo Alvarez'], { tag: null, marked: false });
  for (const name of ['Christopher Rodriguez', 'Sione Taufa', 'Ryan Castillo', 'Ethan Hughes', "Liam O'Connor"]) {
    assert.deepEqual(cards[name], { tag: 'Needs photos', marked: true }, name);
  }
  assert.match(await page.$eval('#squad-count', (e) => e.textContent), /6 players in the squad · 5 still need photos/);
});

test('the same squad as .xlsx is already up to date (dates turned back into positions)', async () => {
  await upload(fixture('sample-squad.xlsx'));
  assert.equal(await section('add'), null);
  assert.equal(await section('update'), null);
  const same = await section('unchanged');
  assert.equal(same.title, 'Already up to date (6)');
  assert.match(same.text, /Ethan Hughes/);
  assert.equal((await section('errors')).rows.length, 4);
  assert.equal(await page.$('dialog [data-action=import]'), null, 'nothing to import, so no Import button');
  await page.click('dialog [data-action=cancel]');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
});

test('a sheet with no Name column is refused with an explanation', async () => {
  await upload(join(dir, 'no-names.csv'));
  assert.match(await page.$eval('dialog', (d) => d.textContent), /No Name column found.*Name, Nickname, Positions, Height, Weight, Years at SFV, Caps/s);
  await page.click('dialog [data-action=true]');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.equal((await stored()).length, 6);
});

test('no native dialogs and no page errors', () => {
  assert.deepEqual(nativeDialogs, []);
  assert.deepEqual(pageErrors, []);
});
