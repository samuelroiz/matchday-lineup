// Pure data helpers: no DOM, no storage. Safe to import from Node tests.

import { normalizeCrop, validateCrop } from './crop.js';

export const POSITIONS = [
  'Prop', 'Hooker', 'Lock', 'Flanker', 'Number 8',
  'Scrum-half', 'Fly-half', 'Centre', 'Wing', 'Fullback',
];

export const STARTER_SLOTS = Array.from({ length: 15 }, (_, i) => i + 1);
export const BENCH_SLOTS = Array.from({ length: 8 }, (_, i) => i + 16);
export const ALL_SLOTS = [...STARTER_SLOTS, ...BENCH_SLOTS];

export const SLOT_NAMES = {
  1: 'Loosehead Prop', 2: 'Hooker', 3: 'Tighthead Prop', 4: 'Lock', 5: 'Lock',
  6: 'Blindside Flanker', 7: 'Openside Flanker', 8: 'Number 8', 9: 'Scrum-half',
  10: 'Fly-half', 11: 'Left Wing', 12: 'Inside Centre', 13: 'Outside Centre',
  14: 'Right Wing', 15: 'Fullback',
};
for (const s of BENCH_SLOTS) SLOT_NAMES[s] = 'Replacement';

// Which usual positions suit each shirt; used to sort the picker, never to block a pick.
export const SLOT_POSITIONS = {
  1: ['Prop'], 2: ['Hooker'], 3: ['Prop'], 4: ['Lock'], 5: ['Lock'],
  6: ['Flanker'], 7: ['Flanker'], 8: ['Number 8', 'Flanker'], 9: ['Scrum-half'],
  10: ['Fly-half'], 11: ['Wing'], 12: ['Centre', 'Fly-half'], 13: ['Centre'],
  14: ['Wing'], 15: ['Fullback', 'Wing'],
  16: ['Hooker'], 17: ['Prop'], 18: ['Prop'], 19: ['Lock'], 20: ['Flanker', 'Number 8'],
  21: ['Scrum-half'], 22: ['Fly-half', 'Centre'], 23: ['Centre', 'Wing', 'Fullback'],
};

export const STAT_KEYS = ['height', 'weight', 'years', 'caps'];
export const STAT_LABELS = { height: 'Height', weight: 'Weight', years: 'Years at SFV', caps: 'Caps' };

export const LIMITS = {
  name: 60, nickname: 30, opponent: 60, venue: 80, competition: 60, role: 40,
  heightCm: [120, 230], weightKg: [40, 200], years: [0, 60], caps: [0, 1000],
};

const CM_PER_IN = 2.54;
const KG_PER_LB = 0.45359237;

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const round1 = (n) => Math.round(n * 10) / 10;

/** '' / null / undefined -> null; anything else -> Number (possibly NaN, which validation rejects). */
export function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  return Number(v);
}

export function ftInToCm(ft, inches) {
  const f = toNumberOrNull(ft);
  const i = toNumberOrNull(inches);
  if (f === null && i === null) return null;
  const total = (f ?? 0) * 12 + (i ?? 0);
  return round1(total * CM_PER_IN);
}

export function cmToFtIn(cm) {
  if (cm === null || cm === undefined || !Number.isFinite(cm)) return null;
  let ft = Math.floor(cm / CM_PER_IN / 12);
  let inches = Math.round(cm / CM_PER_IN - ft * 12);
  if (inches === 12) { ft += 1; inches = 0; }
  return { ft, in: inches };
}

export const lbToKg = (lb) => (toNumberOrNull(lb) === null ? null : round1(Number(lb) * KG_PER_LB));
export const kgToLb = (kg) => (kg === null || kg === undefined ? null : Math.round(kg / KG_PER_LB));

export function formatHeight(cm, units = 'imperial') {
  if (cm === null || cm === undefined || !Number.isFinite(cm)) return '';
  if (units === 'metric') return `${Math.round(cm)} cm`;
  const { ft, in: i } = cmToFtIn(cm);
  return `${ft}'${i}"`;
}

export function formatWeight(kg, units = 'imperial') {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return '';
  return units === 'metric' ? `${Math.round(kg)} kg` : `${kgToLb(kg)} lb`;
}

function cleanText(v, max) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max + 1);
}

/** Fill in defaults and tidy a player record. Does not validate. */
export function normalizePlayer(input = {}) {
  const now = new Date().toISOString();
  const show = {};
  for (const k of STAT_KEYS) show[k] = input.show?.[k] !== false;
  const positions = Array.isArray(input.positions)
    ? [...new Set(input.positions.filter((p) => POSITIONS.includes(p)))]
    : [];
  const num = (v) => {
    const n = toNumberOrNull(v);
    return n === null ? null : n;
  };
  return {
    id: input.id || newId(),
    name: cleanText(input.name, LIMITS.name),
    nickname: cleanText(input.nickname, LIMITS.nickname),
    positions,
    heightCm: num(input.heightCm) === null ? null : round1(num(input.heightCm)),
    weightKg: num(input.weightKg) === null ? null : round1(num(input.weightKg)),
    years: num(input.years),
    caps: num(input.caps),
    show,
    photos: {
      serious: input.photos?.serious || null,
      fun: input.photos?.fun || null,
    },
    // Crop per photo; null means top-centre. Replacing a photo replaces its crop.
    crops: {
      serious: normalizeCrop(input.crops?.serious),
      fun: normalizeCrop(input.crops?.fun),
    },
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

function checkRange(errors, key, value, [min, max], { integer = false, label }) {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value)) errors[key] = `${label} must be a number.`;
  else if (integer && !Number.isInteger(value)) errors[key] = `${label} must be a whole number.`;
  else if (value < min || value > max) errors[key] = `${label} must be between ${min} and ${max}.`;
}

/** Returns an object of field -> message. Empty object means valid. */
export function validatePlayer(p) {
  const errors = {};
  if (!p || typeof p !== 'object') return { name: 'Player is missing.' };
  if (!p.name || !String(p.name).trim()) errors.name = 'Name is required.';
  else if (p.name.length > LIMITS.name) errors.name = `Name must be ${LIMITS.name} characters or fewer.`;
  if (p.nickname && p.nickname.length > LIMITS.nickname) {
    errors.nickname = `Nickname must be ${LIMITS.nickname} characters or fewer.`;
  }
  if (!Array.isArray(p.positions) || p.positions.some((x) => !POSITIONS.includes(x))) {
    errors.positions = 'Unknown position.';
  }
  checkRange(errors, 'heightCm', p.heightCm, LIMITS.heightCm, { label: 'Height (cm)' });
  checkRange(errors, 'weightKg', p.weightKg, LIMITS.weightKg, { label: 'Weight (kg)' });
  checkRange(errors, 'years', p.years, LIMITS.years, { integer: true, label: 'Years at SFV' });
  checkRange(errors, 'caps', p.caps, LIMITS.caps, { integer: true, label: 'Caps' });
  for (const kind of ['serious', 'fun']) {
    const msg = validateCrop(p.crops?.[kind]);
    if (msg) errors.photos = `${kind === 'serious' ? 'Serious' : 'Fun'} photo: ${msg}`;
  }
  return errors;
}

export const isValid = (errors) => Object.keys(errors).length === 0;

/** Stats a player has allowed to be shown, formatted, in a fixed order. */
export function visibleStats(p, units = 'imperial') {
  const out = [];
  if (!p) return out;
  const add = (key, value) => {
    if (p.show?.[key] !== false && value !== '' && value !== null && value !== undefined) {
      out.push({ key, label: STAT_LABELS[key], value: String(value) });
    }
  };
  add('height', formatHeight(p.heightCm, units));
  add('weight', formatWeight(p.weightKg, units));
  add('years', Number.isFinite(p.years) ? (p.years === 0 ? 'New' : p.years) : null);
  add('caps', Number.isFinite(p.caps) ? p.caps : null);
  return out;
}

/** "Jonny May Smith" -> { first: 'Jonny May', last: 'Smith' } */
export function splitName(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: '', last: parts[0] || '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

export function shortName(name = '') {
  const { first, last } = splitName(name);
  return first ? `${first[0]}. ${last}` : last;
}

export function initials(name = '') {
  const { first, last } = splitName(name);
  return ((first[0] || '') + (last[0] || '')).toUpperCase() || '?';
}

// ---------- Matches ----------

export function emptySelection() {
  const sel = {};
  for (const s of ALL_SLOTS) sel[s] = null;
  return sel;
}

export function normalizeMatch(input = {}) {
  const now = new Date().toISOString();
  const selection = emptySelection();
  for (const s of ALL_SLOTS) {
    const v = input.selection?.[s];
    selection[s] = v ? String(v) : null;
  }
  return {
    id: input.id || newId(),
    opponent: cleanText(input.opponent, LIMITS.opponent),
    date: String(input.date || ''),
    kickoff: String(input.kickoff || ''),
    venue: cleanText(input.venue, LIMITS.venue),
    competition: cleanText(input.competition, LIMITS.competition),
    opponentLogo: input.opponentLogo || null,
    selection,
    captain: input.captain || null,
    viceCaptain: input.viceCaptain || null,
    coaches: Array.isArray(input.coaches) ? [...new Set(input.coaches.filter(Boolean).map(String))] : [],
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

export function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function validateMatch(m) {
  const errors = {};
  if (!m || typeof m !== 'object') return { opponent: 'Match is missing.' };
  if (!m.opponent?.trim()) errors.opponent = 'Opponent is required.';
  else if (m.opponent.length > LIMITS.opponent) errors.opponent = `Opponent must be ${LIMITS.opponent} characters or fewer.`;
  if (!m.date) errors.date = 'Date is required.';
  else if (!isValidDate(m.date)) errors.date = 'Date must be a real date (YYYY-MM-DD).';
  if (m.kickoff && !/^([01]\d|2[0-3]):[0-5]\d$/.test(m.kickoff)) errors.kickoff = 'Kick-off must be a time like 14:30.';
  if (m.venue && m.venue.length > LIMITS.venue) errors.venue = `Venue must be ${LIMITS.venue} characters or fewer.`;
  if (m.competition && m.competition.length > LIMITS.competition) {
    errors.competition = `Competition must be ${LIMITS.competition} characters or fewer.`;
  }
  const sel = m.selection || {};
  for (const key of Object.keys(sel)) {
    if (!ALL_SLOTS.includes(Number(key))) errors.selection = `Shirt ${key} is not a valid shirt number.`;
  }
  const picked = new Set(Object.values(sel).filter(Boolean));
  if (m.captain && !picked.has(m.captain)) errors.captain = 'The captain must be in the team.';
  if (m.viceCaptain && !picked.has(m.viceCaptain)) errors.viceCaptain = 'The vice-captain must be in the team.';
  if (m.captain && m.captain === m.viceCaptain) errors.viceCaptain = 'Captain and vice-captain must be different players.';
  return errors;
}

// ---------- Captain / vice-captain ----------

/**
 * Make playerId the match's 'captain' or 'viceCaptain' (null clears it). A match has one of
 * each, so this replaces whoever had the role, and a player can't hold both.
 */
export function setLeader(m, role, playerId) {
  if (role !== 'captain' && role !== 'viceCaptain') throw new Error(`Unknown role: ${role}`);
  const other = role === 'captain' ? 'viceCaptain' : 'captain';
  m[role] = playerId || null;
  if (playerId && m[other] === playerId) m[other] = null;
  return m;
}

/** Drop captain / vice-captain who are no longer picked. Returns true if anything changed. */
export function syncLeaders(m) {
  const picked = new Set(Object.values(m.selection).filter(Boolean));
  let changed = false;
  for (const role of ['captain', 'viceCaptain']) {
    if (m[role] && !picked.has(m[role])) { m[role] = null; changed = true; }
  }
  return changed;
}

/** 'C', 'VC' or null for a player in this match. */
export function leaderBadge(m, playerId) {
  if (!playerId) return null;
  if (m.captain === playerId) return 'C';
  if (m.viceCaptain === playerId) return 'VC';
  return null;
}

// ---------- Coaches ----------

export const COACH_ROLES = [
  'Head coach', 'Assistant coach', 'Forwards coach', 'Backs coach', 'Defence coach',
  'Skills coach', 'Strength & conditioning', 'Team manager', 'Physio',
];

/** Coaches in COACH_ROLES order (Head coach first), roles typed by hand after those, then by name. */
export function compareCoaches(a, b) {
  const rank = (c) => {
    const i = COACH_ROLES.findIndex((r) => r.toLowerCase() === (c.role || '').trim().toLowerCase());
    return i < 0 ? COACH_ROLES.length : i;
  };
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
}

export function normalizeCoach(input = {}) {
  const now = new Date().toISOString();
  return {
    id: input.id || newId(),
    name: cleanText(input.name, LIMITS.name),
    role: cleanText(input.role, LIMITS.role),
    photo: input.photo || null,
    crop: normalizeCrop(input.crop),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

export function validateCoach(c) {
  const errors = {};
  if (!c || typeof c !== 'object') return { name: 'Coach is missing.' };
  if (!c.name || !String(c.name).trim()) errors.name = 'Name is required.';
  else if (c.name.length > LIMITS.name) errors.name = `Name must be ${LIMITS.name} characters or fewer.`;
  if (c.role && c.role.length > LIMITS.role) errors.role = `Role must be ${LIMITS.role} characters or fewer.`;
  const msg = validateCrop(c.crop);
  if (msg) errors.photo = msg;
  return errors;
}

/** Take a deleted coach off a match. Returns true if anything changed. */
export function removeCoachFromMatch(m, coachId) {
  const before = m.coaches.length;
  m.coaches = m.coaches.filter((id) => id !== coachId);
  return m.coaches.length !== before;
}

/** Players picked in more than one shirt: [{ playerId, slots: [3, 17] }] */
export function findDuplicates(selection = {}) {
  const bySlot = new Map();
  for (const s of ALL_SLOTS) {
    const id = selection[s];
    if (!id) continue;
    if (!bySlot.has(id)) bySlot.set(id, []);
    bySlot.get(id).push(s);
  }
  return [...bySlot].filter(([, slots]) => slots.length > 1).map(([playerId, slots]) => ({ playerId, slots }));
}

export function countPicked(selection = {}, slots = ALL_SLOTS) {
  return slots.filter((s) => selection[s]).length;
}

/**
 * Replacements packed into 16, 17, 18... in the order they were picked, with no gaps.
 * Returns a new selection; starters are untouched.
 */
export function packBench(selection = {}) {
  const picked = BENCH_SLOTS.map((s) => selection[s]).filter(Boolean);
  const out = { ...selection };
  BENCH_SLOTS.forEach((s, i) => { out[s] = picked[i] || null; });
  return out;
}

/** How well a player suits a shirt: lower is better, null if none of their positions fit. */
function fitScore(player, slot) {
  const suits = SLOT_POSITIONS[slot] || [];
  let best = null;
  player.positions.forEach((pos, i) => {
    const j = suits.indexOf(pos);
    // The shirt's main position first, then the player's main position, then specialists
    // ahead of players who cover many positions (they can fill a gap elsewhere).
    if (j >= 0) best = Math.min(best ?? Infinity, j * 4 + i * 2 + (player.positions.length - 1) * 0.5);
  });
  return best;
}

/**
 * Fill empty shirts from the squad by usual positions, leaving shirts already picked alone.
 * Starters first, the hardest shirt to fill first each time, so a lone hooker isn't spent on
 * the bench. Then the bench by position, then anyone left over, packed from 16.
 * Returns { selection, added: number of players picked, empty: [starter shirts still empty] }.
 */
export function autoPick(selection = {}, players = []) {
  const known = new Map(players.map((p) => [p.id, p]));
  const out = { ...emptySelection(), ...selection };
  for (const s of ALL_SLOTS) if (out[s] && !known.has(out[s])) out[s] = null;
  const used = new Set(ALL_SLOTS.map((s) => out[s]).filter(Boolean));
  const byName = [...players].sort((a, b) => a.name.localeCompare(b.name));
  let added = 0;

  const fillByPosition = (slots) => {
    let open = slots.filter((s) => !out[s]);
    for (;;) {
      const options = open.map((slot) => ({
        slot,
        candidates: byName.filter((p) => !used.has(p.id) && fitScore(p, slot) !== null)
          .sort((a, b) => fitScore(a, slot) - fitScore(b, slot)),
      })).filter((o) => o.candidates.length);
      if (!options.length) return;
      options.sort((a, b) => a.candidates.length - b.candidates.length || a.slot - b.slot);
      const { slot, candidates: [pick] } = options[0];
      out[slot] = pick.id;
      used.add(pick.id);
      added++;
      open = open.filter((s) => s !== slot);
    }
  };

  fillByPosition(STARTER_SLOTS);
  fillByPosition(BENCH_SLOTS);
  for (const s of BENCH_SLOTS) {
    if (out[s]) continue;
    const p = byName.find((x) => !used.has(x.id));
    if (!p) break;
    out[s] = p.id;
    used.add(p.id);
    added++;
  }
  const packed = packBench(out);
  return { selection: packed, added, empty: STARTER_SLOTS.filter((s) => !packed[s]) };
}

/** Start next week's match from this one: same selection, new id, fresh fixture details. */
export function copyMatch(m) {
  return normalizeMatch({
    selection: { ...m.selection },
    captain: m.captain,
    viceCaptain: m.viceCaptain,
    coaches: [...(m.coaches || [])],
    competition: m.competition,
    kickoff: m.kickoff,
    venue: m.venue,
  });
}

/** Remove a deleted player from a match selection. Returns true if anything changed. */
export function removePlayerFromMatch(m, playerId) {
  let changed = false;
  for (const s of ALL_SLOTS) {
    if (m.selection[s] === playerId) { m.selection[s] = null; changed = true; }
  }
  if (syncLeaders(m)) changed = true;
  return changed;
}

// Kick-off choices every 15 minutes, 7:00 AM to 9:45 PM, as "HH:MM".
export const KICKOFF_TIMES = Array.from({ length: 60 }, (_, i) => {
  const mins = 7 * 60 + i * 15;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
});

export function formatKickoff(hhmm) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return '';
  let [h, min] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(min).padStart(2, '0')} ${ampm}`;
}

export function formatMatchDate(date) {
  if (!isValidDate(date)) return '';
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Sat, Oct 25, 2026 · 2:00 PM" */
export function formatFixtureWhen(m) {
  return [formatMatchDate(m.date), formatKickoff(m.kickoff)].filter(Boolean).join(' · ');
}

export function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'match';
}

export function matchFileBase(m) {
  return ['sfv-vs', slugify(m.opponent), m.date].filter(Boolean).join('-');
}
