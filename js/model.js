// Pure data helpers: no DOM, no storage. Safe to import from Node tests.

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
  name: 60, nickname: 30, opponent: 60, venue: 80, competition: 60,
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
  return errors;
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

/** Start next week's match from this one: same selection, new id, fresh fixture details. */
export function copyMatch(m) {
  return normalizeMatch({
    selection: { ...m.selection },
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
  return changed;
}

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
