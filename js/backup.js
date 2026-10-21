// Squad backup (one JSON file, photos inlined as data URLs) and additive restore.
// Works against any store from storage.js, so it is tested in Node with the memory store.

import { blobToDataUrl, dataUrlToBlob } from './blobs.js';
import { normalizePlayer, normalizeMatch, validatePlayer, isValid } from './model.js';

export const BACKUP_APP = 'matchday-lineup';
export const BACKUP_VERSION = 1;

function photoIdsOf(players, matches) {
  const ids = new Set();
  for (const p of players) for (const id of [p.photos?.serious, p.photos?.fun]) if (id) ids.add(id);
  for (const m of matches) if (m.opponentLogo) ids.add(m.opponentLogo);
  return ids;
}

/** Build the backup object (squad, saved matches and every photo they use). */
export async function createBackup(store, { now = new Date() } = {}) {
  const players = await store.getAll('players');
  const matches = await store.getAll('matches');
  const photos = {};
  for (const id of photoIdsOf(players, matches)) {
    const rec = await store.get('photos', id);
    if (rec?.blob) photos[id] = await blobToDataUrl(rec.blob);
  }
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    players,
    matches,
    photos,
  };
}

/** Parse and check a backup file's text. Throws an Error with a readable message. */
export function parseBackup(text) {
  let data;
  try { data = typeof text === 'string' ? JSON.parse(text) : text; } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!data || typeof data !== 'object' || data.app !== BACKUP_APP) {
    throw new Error('That file is not a Matchday Lineup backup.');
  }
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of the app.');
  }
  if (!Array.isArray(data.players)) throw new Error('The backup has no squad list.');
  return {
    players: data.players,
    matches: Array.isArray(data.matches) ? data.matches : [],
    photos: data.photos && typeof data.photos === 'object' ? data.photos : {},
  };
}

/**
 * Work out what a restore would do, without touching storage.
 * Restore only ever adds: records whose id already exists here are skipped, never replaced.
 */
export function planRestore(backup, existing) {
  const havePlayers = new Set(existing.playerIds);
  const haveMatches = new Set(existing.matchIds);
  const plan = { players: [], matches: [], photoIds: new Set(), skippedPlayers: [], skippedMatches: [], invalid: [] };

  for (const raw of backup.players) {
    if (!raw?.id) { plan.invalid.push(raw); continue; }
    const p = normalizePlayer(raw);
    if (havePlayers.has(p.id)) { plan.skippedPlayers.push(p); continue; }
    if (!isValid(validatePlayer(p))) { plan.invalid.push(raw); continue; }
    havePlayers.add(p.id);
    plan.players.push(p);
  }
  for (const raw of backup.matches) {
    if (!raw?.id) { plan.invalid.push(raw); continue; }
    const m = normalizeMatch(raw);
    if (haveMatches.has(m.id)) { plan.skippedMatches.push(m); continue; }
    haveMatches.add(m.id);
    plan.matches.push(m);
  }
  for (const id of photoIdsOf(plan.players, plan.matches)) {
    if (typeof backup.photos[id] === 'string') plan.photoIds.add(id);
  }
  return plan;
}

/** Restore a backup into the store. Returns a summary for the UI. */
export async function restoreBackup(store, text) {
  const backup = parseBackup(text);
  const [players, matches] = await Promise.all([store.getAll('players'), store.getAll('matches')]);
  const plan = planRestore(backup, { playerIds: players.map((p) => p.id), matchIds: matches.map((m) => m.id) });

  let photosAdded = 0;
  for (const id of plan.photoIds) {
    if (await store.get('photos', id)) continue; // already have this exact photo
    try {
      await store.put('photos', { id, blob: dataUrlToBlob(backup.photos[id]) });
      photosAdded++;
    } catch { /* a corrupt photo shouldn't sink the whole restore */ }
  }
  for (const p of plan.players) {
    // Photo ids that didn't come through are dropped so the card shows a placeholder.
    for (const k of ['serious', 'fun']) {
      if (p.photos[k] && !(await store.get('photos', p.photos[k]))) p.photos[k] = null;
    }
    await store.put('players', p);
  }
  for (const m of plan.matches) {
    if (m.opponentLogo && !(await store.get('photos', m.opponentLogo))) m.opponentLogo = null;
    await store.put('matches', m);
  }
  return {
    playersAdded: plan.players.length,
    matchesAdded: plan.matches.length,
    photosAdded,
    playersSkipped: plan.skippedPlayers.length,
    matchesSkipped: plan.skippedMatches.length,
    invalid: plan.invalid.length,
  };
}

export function describeRestore(r) {
  const parts = [`Added ${r.playersAdded} player${r.playersAdded === 1 ? '' : 's'}`];
  if (r.matchesAdded) parts.push(`${r.matchesAdded} match${r.matchesAdded === 1 ? '' : 'es'}`);
  let msg = parts.join(' and ') + '.';
  const skipped = r.playersSkipped + r.matchesSkipped;
  if (skipped) msg += ` Skipped ${skipped} already on this device.`;
  if (r.invalid) msg += ` Ignored ${r.invalid} unreadable entr${r.invalid === 1 ? 'y' : 'ies'}.`;
  return msg;
}
