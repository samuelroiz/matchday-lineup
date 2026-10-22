// Visual QA, small squad: 6 players, 2 coaches (one without a photo), the three photo styles,
// a part-filled match, toast placement (desktop and phone), the crop editor, both team sheets (and one with no bench), the video preview (no export),
// before/after frames of the card layout and the ?clip test mode.   npm run qa:6  ->  qa/six-players/
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  REPO, addCoach, addPlayer, createMatch, cropEditorPass, findPhotos, frameTimes, frameWithLayout, launch, log, seek, settle,
  sideBySide, teamSheets, waitSquadRendered,
} from './lib.mjs';
import { VIDEO_TEMPLATE } from '../../js/timeline.js';

const OUT = join(REPO, 'qa', 'six-players');
const P = (shirt, name, nickname, positions, ft, inch, lb, years, caps) => ({ shirt, name, nickname, positions, ft, in: inch, lb, years, caps });
const SQUAD = [
  P(1, 'Mateo Alvarez', 'Tank', ['Prop'], 5, 11, 265, 4, 38),
  P(2, 'Christopher Rodriguez', 'Chris', ['Hooker'], 5, 10, 225, 6, 71),
  P(3, 'Sione Taufa', '', ['Prop'], 6, 0, 280, 2, 15),
  P(9, 'Ryan Castillo', '', ['Scrum-half'], 5, 7, 170, 2, 18),
  P(10, 'Ethan Hughes', '', ['Fly-half'], 5, 11, 190, 5, 52),
  P(16, 'Tom Brennan', '', ['Hooker'], 5, 9, 215, 2, 12),
];
// The card layout before taller cards for small groups and the wider gap above the name.
const OLD_LAYOUT = {
  maxFewCardHeight: VIDEO_TEMPLATE.layout.maxCardHeight,
  fewGap: VIDEO_TEMPLATE.layout.gap,
  photoAspect: 0,
  content: {
    ...VIDEO_TEMPLATE.layout.content,
    fun: { numberY: 0.25, nameY: 0.43, nicknameY: 0.54, statsY: 0.7, statRow: 0.16 },
    compactFun: { ...VIDEO_TEMPLATE.layout.content.compactFun, numberY: 0.26, nameY: 0.46, nicknameY: 0.57, statsY: 0.74 },
  },
};

const photos = await findPhotos();
const qa = await launch(OUT, { clean: true });
const { page } = qa;
const notes = {};

await qa.shot('00-first-open');
for (const [i, p] of SQUAD.entries()) {
  await addPlayer(qa, p, [photos[i % photos.length], photos[(i + 1) % photos.length]],
    i === 0 ? () => qa.shot('01-add-player-form') : undefined);
}
await addCoach(qa, { name: 'Maria Delgado', role: 'Head coach' }, photos[2 % photos.length]);
await addCoach(qa, { name: 'Grant Whitaker', role: 'Forwards coach' }, null); // no photo: no "Photo" label
await waitSquadRendered(page);
await settle(4500); // let the "added" toasts clear
await qa.shot('03-squad', { fullPage: true });
// Photo styles: the cards repaint straight away, and each style should look clearly different.
for (const style of ['off', 'auto', 'club']) {
  await page.select('#photo-style', style);
  await qa.shotEl(`03a-squad-style-${style}`, '#player-list');
}
await page.select('#photo-style', 'auto');

// Re-crop and save, so the save path is exercised too.
const crops = await cropEditorPass(qa, 'Christopher Rodriguez', '04', { save: true });
await writeFile(join(OUT, 'crop-states.json'), JSON.stringify(crops, null, 2));

await createMatch(qa, {
  opponent: 'Santa Monica', date: '2026-10-24', kickoff: '14:30', venue: 'Balboa Sports Complex, Encino',
  picks: SQUAD.map((p) => [p.shirt, p.name]), captain: 'Christopher Rodriguez', vice: 'Ethan Hughes',
});
await qa.shot('05-match', { fullPage: true });
// A toast sits in the tab bar beside the tabs, over nothing, desktop and phone.
await page.evaluate(async () => (await import('/js/dialog.js')).toast('Picked 9 players. Shirts 4, 5, 6 left empty: nobody plays there.', { type: 'success' }));
await qa.shot('05a-toast-desktop');
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.evaluate(async () => (await import('/js/dialog.js')).toast('Saved Mateo Alvarez.', { type: 'success' }));
await qa.shot('05b-toast-phone');
await page.setViewport({ width: 1400, height: 1000 });
await settle(4500);
notes.sheetNote = await teamSheets(qa, '06');

// No replacements: the coaches line should move up into the bench's place.
await page.click('[data-tab=match]');
await page.select('select[data-slot="16"]', '');
await page.waitForFunction(() => document.querySelector('#save-status').dataset.state === 'saved');
await page.click('[data-tab=sheet]');
for (const size of ['post', 'story']) {
  await page.click(`input[name=sheet-size][value=${size}]`);
  await page.waitForSelector(`#sheet-canvas[data-rendered=${size}]`);
  await settle();
  await qa.canvasPng(`06-sheet-${size}-no-bench`, '#sheet-canvas');
}
await page.click('input[name=sheet-size][value=post]');
await page.click('[data-tab=match]');
const brennan = await page.$eval('select[data-slot="16"]', (s) => [...s.options].find((o) => o.textContent.startsWith('Tom Brennan')).value);
await page.select('select[data-slot="16"]', brennan);
await page.waitForFunction(() => document.querySelector('#save-status').dataset.state === 'saved');

// ---------- video preview ----------
await page.click('[data-tab=video]');
await page.waitForFunction(() => /Length/.test(document.querySelector('#video-length').textContent));
await settle();
notes.videoNote = await page.$eval('#video-note', (e) => e.textContent);
notes.videoLength = await page.$eval('#video-length', (e) => e.textContent);
await qa.shot('07-video-tab');
await page.click('#video-play');
await settle(2500);
await qa.shot('07a-video-playing');
notes.playButtonWhilePlaying = await page.$eval('#video-play', (e) => e.textContent);
await page.click('#video-play');

const T = await frameTimes(page);
await writeFile(join(OUT, 'frame-times.json'), JSON.stringify(T, null, 2));
const frame = async (name, t) => { await seek(page, t, T.duration); await qa.canvasPng(name, '#video-canvas'); };
await frame('08-preview-0-cover', 0);
await frame('08a-preview-intro', T.intro);
for (const [i, g] of T.groups.entries()) {
  const n = 'bcdefgh'[i];
  if (g.before !== null) await frame(`08${n}1-preview-${g.key}-before-flip`, g.before);
  await frame(`08${n}2-preview-${g.key}${g.before !== null ? '-after-flip' : ''}`, g.after);
}
await frame('08z-preview-team-sheet', T.sheet);

// Card layout before/after: taller cards for a group of two, more room above the name.
for (const key of ['halves', 'front']) {
  const t = T.groups.find((g) => g.key === key).after;
  const before = await frameWithLayout(page, t, T.duration, OLD_LAYOUT);
  const after = await frameWithLayout(page, t, T.duration, {});
  await qa.savePng(`10-cards-${key}-before`, before);
  await qa.savePng(`10-cards-${key}-after`, after);
  await qa.savePng(`10-cards-${key}-before-after`, await sideBySide(page, [before, 'Before'], [after, 'After']));
  log('cards before/after', key);
}
await seek(page, 0, T.duration);
await qa.shot('09-video-tab-idle');

// Pressing Preview with the page scrolled down (phone width) brings the player back into view.
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await settle();
await qa.shot('11-video-tab-phone');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await settle();
await page.click('#video-play');
await settle(1200);
await qa.shot('11a-video-phone-preview-pressed');
notes.phonePlayerInView = await page.$eval('#video-canvas', (c) => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; });
await page.click('#video-play');
await page.setViewport({ width: 1400, height: 1000 });

// ?clip=5 test mode: the length shown is the clip's, and the note is on its own line.
await page.goto(`${page.url().split(/[?#]/)[0]}?clip=5#video`);
await page.waitForSelector('html[data-ready="true"]');
await page.waitForFunction(() => /Length/.test(document.querySelector('#video-length').textContent));
await settle();
notes.clipLength = await page.$eval('#video-length', (e) => e.textContent);
notes.clipNote = await page.$eval('#video-note', (e) => e.innerText);
await qa.shotEl('12-video-clip-mode-side', '.video-side');

await writeFile(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2));
log('notes', notes);
log('problems', qa.problems);
await qa.close();
