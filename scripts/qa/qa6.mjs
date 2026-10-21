// Visual QA, small squad: 6 players, 1 coach, a part-filled match, the crop editor, both team
// sheets and the video preview (no export).   npm run qa:6  ->  qa/six-players/
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  REPO, addCoach, addPlayer, createMatch, cropEditorPass, findPhotos, frameTimes, launch, log, seek, settle,
  teamSheets, waitSquadRendered,
} from './lib.mjs';

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
await waitSquadRendered(page);
await settle(4500); // let the "added" toasts clear
await qa.shot('03-squad', { fullPage: true });

// Re-crop and save, so the save path is exercised too.
const crops = await cropEditorPass(qa, 'Christopher Rodriguez', '04', { save: true });
await writeFile(join(OUT, 'crop-states.json'), JSON.stringify(crops, null, 2));

await createMatch(qa, {
  opponent: 'Santa Monica', date: '2026-10-24', kickoff: '14:30', venue: 'Balboa Sports Complex, Encino',
  picks: SQUAD.map((p) => [p.shirt, p.name]), captain: 'Christopher Rodriguez', vice: 'Ethan Hughes',
});
await qa.shot('05-match', { fullPage: true });
notes.sheetNote = await teamSheets(qa, '06');

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
await seek(page, 0, T.duration);
await qa.shot('09-video-tab-idle');

await writeFile(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2));
log('notes', notes);
log('problems', qa.problems);
await qa.close();
