import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../../js/storage.js';
import { backupSummary, createBackup, parseBackup, planRestore, restoreBackup } from '../../js/backup.js';
import { blobToDataUrl, dataUrlToBlob } from '../../js/blobs.js';
import { normalizeCoach, normalizeMatch, normalizePlayer } from '../../js/model.js';

const bytes = (...b) => new Blob([new Uint8Array(b)], { type: 'image/jpeg' });

async function seed(store) {
  await store.put('photos', { id: 'ph-1', blob: bytes(1, 2, 3) });
  await store.put('photos', { id: 'ph-2', blob: bytes(4, 5, 6, 7) });
  await store.put('photos', { id: 'logo-1', blob: bytes(9) });
  await store.put('photos', { id: 'orphan', blob: bytes(0) });
  await store.put('photos', { id: 'coach-ph', blob: bytes(8, 8) });
  await store.put('coaches', normalizeCoach({ id: 'c-1', name: 'Dana Whitfield', role: 'Head coach', photo: 'coach-ph', crop: { cx: 0.5, cy: 0.35, zoom: 1.4, source: 'face' } }));
  await store.put('coaches', normalizeCoach({ id: 'c-2', name: 'Ray Nakamura', role: 'Forwards coach' }));
  const a = normalizePlayer({ id: 'p-a', name: 'Alex Ortega', positions: ['Prop'], photos: { serious: 'ph-1', fun: 'ph-2' }, crops: { serious: { cx: 0.45, cy: 0.3, zoom: 1.8, source: 'face' } } });
  const b = normalizePlayer({ id: 'p-b', name: 'Bo Tanaka', show: { weight: false } });
  await store.put('players', a);
  await store.put('players', b);
  await store.put('matches', normalizeMatch({ id: 'm-1', opponent: 'Kern County', date: '2026-10-10', opponentLogo: 'logo-1', selection: { 1: 'p-a', 9: 'p-b' }, captain: 'p-a', viceCaptain: 'p-b', coaches: ['c-1', 'c-2'] }));
  return { a, b };
}

test('blob <-> data URL round trip keeps bytes and type', async () => {
  const blob = new Blob([new Uint8Array([0, 255, 128, 7])], { type: 'image/png' });
  const url = await blobToDataUrl(blob);
  assert.match(url, /^data:image\/png;base64,/);
  const back = dataUrlToBlob(url);
  assert.equal(back.type, 'image/png');
  assert.deepEqual([...new Uint8Array(await back.arrayBuffer())], [0, 255, 128, 7]);
});

test('backup includes players, matches and only the photos they use', async () => {
  const store = createMemoryStore();
  await seed(store);
  const backup = await createBackup(store, { now: new Date('2026-10-21T10:00:00Z') });
  assert.equal(backup.app, 'matchday-lineup');
  assert.equal(backup.version, 1);
  assert.equal(backup.exportedAt, '2026-10-21T10:00:00.000Z');
  assert.equal(backup.players.length, 2);
  assert.equal(backup.matches.length, 1);
  assert.equal(backup.coaches.length, 2);
  assert.deepEqual(Object.keys(backup.photos).sort(), ['coach-ph', 'logo-1', 'ph-1', 'ph-2']);
  // It survives being written to a file.
  assert.doesNotThrow(() => parseBackup(JSON.stringify(backup)));
});

test('restore into an empty device brings back everything, photos included', async () => {
  const src = createMemoryStore();
  await seed(src);
  const text = JSON.stringify(await createBackup(src));

  const dest = createMemoryStore();
  const r = await restoreBackup(dest, text);
  assert.deepEqual(r, { playersAdded: 2, coachesAdded: 2, matchesAdded: 1, photosAdded: 4, playersSkipped: 0, coachesSkipped: 0, matchesSkipped: 0, invalid: 0 });
  const a = await dest.get('players', 'p-a');
  assert.equal(a.name, 'Alex Ortega');
  assert.equal(a.photos.fun, 'ph-2');
  assert.deepEqual(a.crops.serious, { cx: 0.45, cy: 0.3, zoom: 1.8, source: 'face' }, 'crops survive backup and restore');
  const photo = await dest.get('photos', 'ph-2');
  assert.deepEqual([...new Uint8Array(await photo.blob.arrayBuffer())], [4, 5, 6, 7]);
  assert.equal((await dest.get('players', 'p-b')).show.weight, false);
  const m = await dest.get('matches', 'm-1');
  assert.equal(m.selection[9], 'p-b');
  assert.deepEqual([m.captain, m.viceCaptain, m.coaches], ['p-a', 'p-b', ['c-1', 'c-2']]);
  const coach = await dest.get('coaches', 'c-1');
  assert.deepEqual([coach.name, coach.role, coach.photo, coach.crop.zoom], ['Dana Whitfield', 'Head coach', 'coach-ph', 1.4]);
  assert.deepEqual([...new Uint8Array(await (await dest.get('photos', 'coach-ph')).blob.arrayBuffer())], [8, 8]);
});

test('restore only adds: existing players are never overwritten', async () => {
  const src = createMemoryStore();
  await seed(src);
  const text = JSON.stringify(await createBackup(src));

  const dest = createMemoryStore();
  const edited = normalizePlayer({ id: 'p-a', name: 'Alex Ortega (edited here)' });
  await dest.put('players', edited);
  await dest.put('players', normalizePlayer({ id: 'p-local', name: 'Local Only' }));

  const r = await restoreBackup(dest, text);
  assert.equal(r.playersAdded, 1);
  assert.equal(r.playersSkipped, 1);
  assert.equal((await dest.get('players', 'p-a')).name, 'Alex Ortega (edited here)');
  assert.ok(await dest.get('players', 'p-local'));
  assert.equal((await dest.getAll('players')).length, 3);
});

test('restoring the same backup twice adds nothing the second time', async () => {
  const src = createMemoryStore();
  await seed(src);
  const text = JSON.stringify(await createBackup(src));
  const dest = createMemoryStore();
  await restoreBackup(dest, text);
  const again = await restoreBackup(dest, text);
  assert.equal(again.playersAdded, 0);
  assert.equal(again.matchesAdded, 0);
  assert.equal(again.photosAdded, 0);
  assert.equal(again.playersSkipped, 2);
  assert.equal(again.coachesAdded, 0);
  assert.equal(again.coachesSkipped, 2);
  assert.equal((await dest.getAll('players')).length, 2);
});

test('restore never overwrites a coach already on this device', async () => {
  const src = createMemoryStore();
  await seed(src);
  const text = JSON.stringify(await createBackup(src));
  const dest = createMemoryStore();
  await dest.put('coaches', normalizeCoach({ id: 'c-1', name: 'Dana Whitfield', role: 'Director of rugby' }));
  const r = await restoreBackup(dest, text);
  assert.deepEqual([r.coachesAdded, r.coachesSkipped], [1, 1]);
  assert.equal((await dest.get('coaches', 'c-1')).role, 'Director of rugby');
});

test('backups from before coaches existed still restore', async () => {
  const old = { app: 'matchday-lineup', version: 1, players: [{ id: 'p-z', name: 'Zed' }], matches: [], photos: {} };
  const r = await restoreBackup(createMemoryStore(), JSON.stringify(old));
  assert.deepEqual([r.playersAdded, r.coachesAdded], [1, 0]);
});

test('missing or corrupt photos leave a placeholder instead of failing', async () => {
  const backup = {
    app: 'matchday-lineup', version: 1, matches: [],
    players: [{ id: 'p-x', name: 'Xavi', photos: { serious: 'gone', fun: 'bad' } }],
    photos: { bad: 'not a data url' },
  };
  const dest = createMemoryStore();
  const r = await restoreBackup(dest, JSON.stringify(backup));
  assert.equal(r.playersAdded, 1);
  const p = await dest.get('players', 'p-x');
  assert.equal(p.photos.serious, null);
  assert.equal(p.photos.fun, null);
});

test('invalid entries are skipped and counted', () => {
  const plan = planRestore({
    players: [{ id: 'ok', name: 'Fine' }, { name: 'No id' }, { id: 'bad', name: '' }, null],
    matches: [{ opponent: 'no id' }],
    photos: {},
  }, { playerIds: [], matchIds: [] });
  assert.deepEqual(plan.players.map((p) => p.id), ['ok']);
  assert.equal(plan.invalid.length, 4);
});

test('files that are not backups are refused with a clear message', () => {
  assert.throws(() => parseBackup('not json'), /not valid JSON/);
  assert.throws(() => parseBackup('{"hello":1}'), /not a Matchday Lineup backup/);
  assert.throws(() => parseBackup(JSON.stringify({ app: 'matchday-lineup', version: 99, players: [] })), /newer version/);
  assert.throws(() => parseBackup(JSON.stringify({ app: 'matchday-lineup', version: 1 })), /no squad/);
});

test('the backup message counts matches too', () => {
  assert.equal(backupSummary({ players: [1, 2], coaches: [1], matches: [1, 2, 3], photos: { a: '', b: '' } }),
    'Backed up 2 players, 1 coach, 3 matches and 2 photos.');
  assert.equal(backupSummary({ players: [1], coaches: [], matches: [1], photos: {} }),
    'Backed up 1 player, 0 coaches, 1 match and 0 photos.');
});
