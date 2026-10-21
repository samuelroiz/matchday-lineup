// Visual QA, full squad: 23 players, 2 coaches, a full match, every tab, a full video export
// with frames pulled from it, and the flip growth before/after.   npm run qa  ->  qa/
import { execFileSync } from 'node:child_process';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  REPO, addCoach, addPlayer, createMatch, cropEditorPass, findPhotos, frameTimes, frameWithLayout,
  launch, log, settle, sideBySide, teamSheets, waitSquadRendered,
} from './lib.mjs';

const OUT = join(REPO, 'qa');
const P = (name, nickname, positions, ft, inch, lb, years, caps) => ({ name, nickname, positions, ft, in: inch, lb, years, caps });
// In shirt order, 1-23.
const SQUAD = [
  P('Mateo Alvarez', 'Tank', ['Prop'], 5, 11, 265, 4, 38),
  P('Christopher Rodriguez', 'Chris', ['Hooker'], 5, 10, 225, 6, 71),
  P('Sione Taufa', '', ['Prop'], 6, 0, 280, 2, 15),
  P("Liam O'Connor", '', ['Lock'], 6, 6, 245, 3, 29),
  P('Marcus Bennett', 'Big Marc', ['Lock'], 6, 5, 250, 5, 44),
  P('Tavita Leota', '', ['Flanker'], 6, 2, 230, 1, 8),
  P('Jake Whitmore', '', ['Flanker'], 6, 1, 220, 3, 25),
  P('Daniel Okafor', 'Dano', ['Number 8', 'Flanker'], 6, 3, 240, 4, 40),
  P('Ryan Castillo', '', ['Scrum-half'], 5, 7, 170, 2, 18),
  P('Ethan Hughes', '', ['Fly-half'], 5, 11, 190, 5, 52),
  P('Kai Nakamura', 'Flash', ['Wing'], 5, 10, 180, 1, 6),
  P('Noah Fitzgerald', '', ['Centre', 'Fly-half'], 6, 0, 205, 3, 31),
  P('Isaac Mensah', '', ['Centre'], 6, 1, 210, 2, 14),
  P('Diego Herrera', '', ['Wing'], 5, 11, 185, 0, 0),
  P('Owen Gallagher', '', ['Fullback', 'Wing'], 6, 0, 195, 7, 88),
  P('Tom Brennan', '', ['Hooker'], 5, 9, 215, 2, 12),
  P('Luis Moreno', '', ['Prop'], 5, 10, 255, 3, 20),
  P('Viliami Fifita', 'Vili', ['Prop'], 6, 1, 275, 1, 5),
  P('Sam Patterson', '', ['Lock'], 6, 4, 240, 2, 9),
  P('Jordan Ellis', '', ['Flanker', 'Number 8'], 6, 2, 225, 1, 3),
  P('Ben Carter', '', ['Scrum-half'], 5, 6, 165, 4, 33),
  P('Alex Duarte', '', ['Centre', 'Fly-half'], 5, 11, 195, 2, 16),
  P('Will Harrington', '', ['Wing', 'Fullback'], 6, 0, 190, 3, 22),
];
// Added forwards coach first: the app should still list the head coach first.
const COACHES = [{ name: 'Grant Whitaker', role: 'Forwards coach' }, { name: 'Maria Delgado', role: 'Head coach' }];
// The card layout before the 10% flip growth, for the before/after frames.
const OLD_FLIP_LAYOUT = { flipScale: 1.07, cardSide: 60, gap: 40 };

const photos = await findPhotos();
// qa/ also holds qa/six-players, so only the old video goes (a second download would be renamed).
for (const f of (await readdir(OUT).catch(() => []))) if (/-lineup\.(mp4|webm)$/.test(f)) await rm(join(OUT, f));
const qa = await launch(OUT);
const { page } = qa;

// ---------- squad ----------
await qa.shot('00-first-open');
for (const [i, p] of SQUAD.entries()) {
  await addPlayer(qa, p, [photos[i % photos.length], photos[(i + 1) % photos.length]],
    i === 1 ? () => qa.shot('01-add-player-form') : undefined);
}
for (const [i, c] of COACHES.entries()) await addCoach(qa, c, photos[(i + 2) % photos.length]);

const crops = await cropEditorPass(qa, 'Christopher Rodriguez', '02');
await writeFile(join(OUT, 'crop-states.json'), JSON.stringify(crops, null, 2));

await settle(4500); // let the "added" toasts clear
for (const style of ['off', 'auto', 'club']) {
  await page.select('#photo-style', style);
  await settle(300);
  await waitSquadRendered(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await qa.shot(`03-squad-style-${style}`);
  await qa.shot(`03-squad-style-${style}-full`, { fullPage: true });
}
await page.select('#photo-style', 'auto');

// ---------- match and team sheet ----------
await createMatch(qa, {
  opponent: 'Santa Monica', date: '2026-10-24', kickoff: '14:30', venue: 'Balboa Sports Complex, Encino',
  competition: 'SCRFU D1 League', picks: SQUAD.map((p, i) => [i + 1, p.name]),
  captain: 'Christopher Rodriguez', vice: 'Ethan Hughes',
});
await qa.shot('04-match');
await qa.shot('04-match-full', { fullPage: true });
await teamSheets(qa, '05');

// ---------- video export ----------
await page.click('[data-tab=video]');
await page.waitForFunction(() => /Length/.test(document.querySelector('#video-length').textContent));
await settle();
await qa.shot('06-video-tab');
const cdp = await qa.browser.target().createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT, eventsEnabled: true });
log('exporting video (real time, about a minute)…');
await page.click('#video-export');
await page.waitForSelector('#video-result:not([hidden])', { timeout: 240000 });
log(await page.$eval('#video-format', (e) => e.textContent));
await qa.shot('07-video-exported');
const downloaded = new Promise((r) => cdp.on('Browser.downloadProgress', (e) => { if (e.state === 'completed') r(); }));
await page.click('#video-link');
await downloaded;

// ---------- frames from the exported file ----------
const T = await frameTimes(page);
await writeFile(join(OUT, 'frame-times.json'), JSON.stringify(T, null, 2));
const video = join(OUT, (await readdir(OUT)).find((f) => /-lineup\.(mp4|webm)$/.test(f)));
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,avg_frame_rate', '-of', 'json', video]).toString());
await writeFile(join(OUT, 'video-probe.json'), JSON.stringify(probe, null, 2));
const g = (k) => T.groups.find((x) => x.key === k);
const frames = [
  ['08-frame-0-cover', 0],
  ['08a-frame-intro', T.intro],
  ['08b-frame-front-row-before-flip', g('front').before],
  ['08c-frame-front-row-after-flip', g('front').after],
  ['08d-frame-bench-before-flip', g('bench').before],
  ['08d-frame-bench-after-flip', g('bench').after],
  ['08e-frame-coaches', g('coaches').after],
  ['08f-frame-team-sheet', Math.min(T.sheet, Number(probe.format.duration) - 0.3)],
];
for (const [name, t] of frames) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(3), '-i', video, '-frames:v', '1', join(OUT, `${name}.png`)]);
  log('frame', name, t.toFixed(2));
}

// ---------- flip growth: before (7%) and after (10%) ----------
for (const key of ['front', 'locks']) {
  const t = g(key).after;
  const before = await frameWithLayout(page, t, T.duration, OLD_FLIP_LAYOUT);
  const after = await frameWithLayout(page, t, T.duration, {});
  await qa.savePng(`09-flip-${key}-before-7`, before);
  await qa.savePng(`09-flip-${key}-after-10`, after);
  await qa.savePng(`09-flip-${key}-before-after`, await sideBySide(page, [before, 'Before: +7%'], [after, 'After: +10%']));
  log('flip before/after', key);
}

log('problems', qa.problems);
await qa.close();
