// Squad import from a spreadsheet: loose column matching, forgiving height/weight/position
// parsing, and a plan (new / updated / unchanged / errors) shown before anything is saved.
// Pure: no DOM, no storage. Rows come from sheet.js.

import {
  LIMITS, POSITIONS, formatHeight, formatWeight, ftInToCm, lbToKg, normalizePlayer, validatePlayer,
} from './model.js';

export const TEMPLATE_COLUMNS = ['Name', 'Nickname', 'Positions', 'Height', 'Weight', 'Years at SFV', 'Caps'];

export const FIELD_LABELS = {
  name: 'Name', nickname: 'Nickname', positions: 'Positions', heightCm: 'Height', weightKg: 'Weight', years: 'Years at SFV', caps: 'Caps',
};

// ---------- columns ----------

const squash = (s) => String(s ?? '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, '');

/** Which player field a header names, or null. Case, spaces, punctuation and units are ignored. */
export function fieldForHeader(header) {
  const h = squash(header);
  if (!h) return null;
  if (h.includes('nick') || ['knownas', 'alias', 'aka'].includes(h)) return 'nickname';
  if (['firstname', 'givenname', 'forename', 'first'].includes(h)) return 'firstName';
  if (['lastname', 'surname', 'familyname', 'last'].includes(h)) return 'lastName';
  if (['name', 'player', 'players', 'playername', 'fullname'].includes(h) || h.endsWith('name')) return 'name';
  if (h.startsWith('pos')) return 'positions';
  if (h.startsWith('height') || ['ht', 'tall'].includes(h)) return 'heightCm';
  if (h.startsWith('weight') || ['wt', 'mass', 'weighs'].includes(h)) return 'weightKg';
  if (h.includes('year') || h.includes('season') || h.startsWith('yrs')) return 'years';
  if (h.startsWith('cap') || ['apps', 'appearances', 'games', 'gamesplayed', 'matches'].includes(h)) return 'caps';
  return null;
}

/** A unit written in a header, e.g. "Height (cm)" or "Weight lbs", for numbers typed without one. */
function unitHint(header) {
  const h = String(header ?? '').toLowerCase();
  if (/\bcm\b|centim/.test(h)) return 'cm';
  if (/\bkgs?\b|kilo/.test(h)) return 'kg';
  if (/\blbs?\b|pound/.test(h)) return 'lb';
  return null;
}

/** Header row -> { columns: { field: index }, hints: { field: unit }, ignored: [header text] }. */
export function matchColumns(headerRow) {
  const columns = {};
  const hints = {};
  const ignored = [];
  headerRow.forEach((text, i) => {
    if (!String(text ?? '').trim()) return;
    const field = fieldForHeader(text);
    if (!field || field in columns) { ignored.push(String(text).trim()); return; }
    columns[field] = i;
    const unit = unitHint(text);
    if (unit) hints[field] = unit;
  });
  return { columns, hints, ignored };
}

// ---------- values ----------

const num = (s) => (/^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN);
const round1 = (n) => Math.round(n * 10) / 10;
const tidy = (s) => String(s ?? '').trim()
  .replace(/[‘’′´`]/g, "'") // curly and prime marks, as phones and Excel type them
  .replace(/[“”″]/g, '"')
  .replace(/''/g, '"')
  .replace(/\s+/g, ' ');

/**
 * Height text -> { cm } or { error }. Accepts 6'1", 6' 1, 6 ft 1, 6ft 1in, 6', 6-1, 73 in, 185 cm,
 * 1.85 m, and a bare 185 (cm).
 */
export function parseHeight(text) {
  const s = tidy(text).toLowerCase();
  const unclear = { error: `Height "${tidy(text)}" isn't clear. Write it like 6'1", 6 ft 1 or 185 cm.` };
  let m = /^(\d+(?:\.\d+)?) ?(?:'|ft\.?|feet|foot)(?: ?(\d+(?:\.\d+)?) ?(?:"|in\.?|inch|inches)?)?$/.exec(s);
  if (m) {
    const inches = m[2] === undefined ? 0 : Number(m[2]);
    if (inches >= 12) return unclear;
    return { cm: ftInToCm(m[1], inches) };
  }
  // 6-1 and 6 1, as rosters often write it.
  if ((m = /^([4-7]) ?[- ] ?(\d{1,2})$/.exec(s))) return Number(m[2]) < 12 ? { cm: ftInToCm(m[1], m[2]) } : unclear;
  if ((m = /^(\d+(?:\.\d+)?) ?(?:"|in\.?|inch|inches)$/.exec(s))) return { cm: round1(Number(m[1]) * 2.54) };
  if ((m = /^(\d+(?:\.\d+)?) ?(?:cm|cms|centimet(?:er|re)s?)$/.exec(s))) return { cm: round1(Number(m[1])) };
  if ((m = /^(\d(?:\.\d+)?) ?(?:m|metres?|meters?)$/.exec(s))) return { cm: round1(Number(m[1]) * 100) };
  const n = num(s);
  if (n >= 100 && n <= 260) return { cm: round1(n) };
  if (n >= 1 && n < 3 && s.includes('.')) return { cm: round1(n * 100) }; // 1.85: metres
  return unclear;
}

/**
 * Weight text -> { kg } or { error }. Accepts 220 lb / lbs / pounds, 100 kg / kgs / kilos, and a
 * bare number, read as unit ('lb' or 'kg': the header's unit, else the "Show stats in" setting).
 */
export function parseWeight(text, unit = 'lb') {
  const s = tidy(text).toLowerCase();
  let m = /^(\d+(?:\.\d+)?) ?(?:lb|lbs|lb\.|pounds?|#)$/.exec(s);
  if (m) return { kg: lbToKg(m[1]) };
  if ((m = /^(\d+(?:\.\d+)?) ?(?:kg|kgs|kilos?|kilograms?)$/.exec(s))) return { kg: round1(Number(m[1])) };
  const n = num(s);
  if (Number.isFinite(n)) return { kg: unit === 'kg' ? round1(n) : lbToKg(n) };
  return { error: `Weight "${tidy(text)}" isn't clear. Write it like 220 lb or 100 kg.` };
}

const POSITION_WORDS = {
  Prop: ['prop', 'props', 'loosehead', 'loosehead prop', 'tighthead', 'tighthead prop', 'loose head', 'tight head', '1', '3'],
  Hooker: ['hooker', 'hook', '2'],
  Lock: ['lock', 'locks', 'second row', 'lock forward', '4', '5'],
  Flanker: ['flanker', 'flank', 'flankers', 'openside', 'blindside', 'open side', 'blind side', 'openside flanker', 'blindside flanker', 'wing forward', '6', '7'],
  'Number 8': ['number 8', 'number eight', 'no 8', 'no8', 'n8', 'eight', 'eighth man', '8'],
  'Scrum-half': ['scrum-half', 'scrum half', 'scrumhalf', 'sh', 'half back', 'halfback', '9'],
  'Fly-half': ['fly-half', 'fly half', 'flyhalf', 'fh', 'first five', 'first five-eighth', 'stand-off', 'stand off', 'outhalf', 'out half', '10'],
  Centre: ['centre', 'center', 'centres', 'centers', 'inside centre', 'outside centre', 'inside center', 'outside center', 'second five', '12', '13'],
  Wing: ['wing', 'winger', 'wings', 'left wing', 'right wing', '11', '14'],
  Fullback: ['fullback', 'full back', 'full-back', 'fb', '15'],
};
// Words for a unit cover each of its positions.
const POSITION_GROUPS = {
  'front row': ['Prop', 'Hooker'],
  'back row': ['Flanker', 'Number 8'],
  backrow: ['Flanker', 'Number 8'],
  'loose forward': ['Flanker', 'Number 8'],
  'back three': ['Wing', 'Fullback'],
  'outside back': ['Wing', 'Fullback'],
};
const POSITION_LOOKUP = new Map([
  ...Object.entries(POSITION_WORDS).flatMap(([pos, words]) => [[pos.toLowerCase(), [pos]], ...words.map((w) => [w, [pos]])]),
  ...Object.entries(POSITION_GROUPS),
]);

/** "Prop, Hooker" / "Lock/Flanker" / "10 & 12" -> { positions, unknown: [words not understood] }. */
export function parsePositions(text) {
  const positions = [];
  const unknown = [];
  for (const raw of tidy(text).split(/[,/;&+|]|\band\b|\bor\b/i)) {
    const word = raw.toLowerCase().replace(/[.#]/g, '').replace(/\s+/g, ' ').trim();
    if (!word) continue;
    const found = POSITION_LOOKUP.get(word) || POSITION_LOOKUP.get(word.replace(/-/g, ' '));
    if (!found) { unknown.push(raw.trim()); continue; }
    for (const pos of found) if (!positions.includes(pos)) positions.push(pos);
  }
  return { positions, unknown };
}

/**
 * Spreadsheets turn shirt numbers like "10/12" or "4/5" into dates. Turn such a date back into
 * "month/day": an Excel date number (46307), or a date with a year (10/12/2026, 2026-10-12).
 */
export function undoDate(text) {
  const s = tidy(text);
  let m;
  if (/^\d+$/.test(s) && Number(s) > 23 && Number(s) < 2958466) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  }
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/.exec(s))) return `${Number(m[1])}/${Number(m[2])}`;
  if ((m = /^\d{4}-(\d{1,2})-(\d{1,2})$/.exec(s))) return `${Number(m[1])}/${Number(m[2])}`;
  return s;
}

/** Whole-number cell (years, caps). "New" counts as 0 years. */
function parseCount(text, label, key) {
  const s = tidy(text).toLowerCase().replace(/\s*(years?|yrs?|caps?|seasons?)$/, '');
  if (key === 'years' && s === 'new') return { value: 0 };
  const n = num(s);
  if (!Number.isInteger(n)) return { error: `${label} "${tidy(text)}" should be a whole number.` };
  return { value: n };
}

/** Case-insensitive, space-insensitive name key, used to match sheet rows to squad players. */
export const nameKey = (name) => String(name ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

// ---------- plan ----------

/**
 * One data row -> { name, fields: { field: value } (only cells that were filled), errors: [] }.
 * units: the "Show stats in" setting ('imperial' | 'metric'), used for bare weights.
 */
function readRow(row, { columns, hints }, units) {
  const cell = (field) => (field in columns ? tidy(row[columns[field]]) : '');
  const fields = {};
  const errors = [];
  let name = cell('name');
  if (!name && ('firstName' in columns || 'lastName' in columns)) name = [cell('firstName'), cell('lastName')].filter(Boolean).join(' ');
  if (name) fields.name = name;

  if (cell('nickname')) fields.nickname = cell('nickname');
  if (cell('positions')) {
    const { positions, unknown } = parsePositions(undoDate(cell('positions')));
    if (unknown.length) errors.push(`Unknown position${unknown.length === 1 ? '' : 's'}: ${unknown.map((u) => `"${u}"`).join(', ')}. Use ${POSITIONS.join(', ')}.`);
    else fields.positions = positions;
  }
  if (cell('heightCm')) {
    const h = hints.heightCm === 'cm' && num(cell('heightCm')) > 0 ? { cm: num(cell('heightCm')) } : parseHeight(cell('heightCm'));
    if (h.error) errors.push(h.error); else fields.heightCm = h.cm;
  }
  if (cell('weightKg')) {
    const w = parseWeight(cell('weightKg'), hints.weightKg || (units === 'metric' ? 'kg' : 'lb'));
    if (w.error) errors.push(w.error); else fields.weightKg = w.kg;
  }
  for (const [key, label] of [['years', 'Years at SFV'], ['caps', 'Caps']]) {
    if (!cell(key)) continue;
    const c = parseCount(cell(key), label, key);
    if (c.error) errors.push(c.error); else fields[key] = c.value;
  }
  return { name, fields, errors };
}

/** Range problems, worded with what was typed and in the units the coach uses. */
function rangeErrors(player, fields, units) {
  const errs = validatePlayer(player);
  const out = [];
  if (errs.name && fields.name) out.push(`Name is longer than ${LIMITS.name} characters.`);
  if (errs.nickname) out.push(`Nickname is longer than ${LIMITS.nickname} characters.`);
  // Same limits and wording as the player form.
  if (errs.heightCm && 'heightCm' in fields) out.push(`Height ${formatHeight(fields.heightCm, units)} should be between 4'0" and 7'6" (120–230 cm).`);
  if (errs.weightKg && 'weightKg' in fields) out.push(`Weight ${formatWeight(fields.weightKg, units)} should be between 88 and 440 lb (40–200 kg).`);
  if (errs.years && 'years' in fields) out.push(`Years at SFV must be 0 to ${LIMITS.years[1]}.`);
  if (errs.caps && 'caps' in fields) out.push(`Caps must be 0 to ${LIMITS.caps[1]}.`);
  return out;
}

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A field's value as the coach reads it, for the preview. */
export function showValue(field, value, units = 'imperial') {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'heightCm') return formatHeight(value, units);
  if (field === 'weightKg') return formatWeight(value, units);
  if (field === 'positions') return value.length ? value.join(', ') : '—';
  if (field === 'years' && value === 0) return 'New'; // as the squad cards and video show it
  return String(value);
}

/**
 * Work out what an import would do, without changing anything.
 * rows: from parseCsv / readXlsx. players: the current squad. units: the "Show stats in" setting.
 * Returns {
 *   error,                       // a problem with the whole sheet (no Name column, no rows)
 *   ignoredColumns: [header],
 *   add: [{ row, player }],
 *   update: [{ row, before, player, changes: [{ field, from, to }] }],
 *   unchanged: [{ row, player }],
 *   errors: [{ row, name, reasons: [] }],
 * }
 * Row numbers are the sheet's own (1 = first row).
 */
export function planImport(rows, players = [], { units = 'imperial' } = {}) {
  const plan = { error: null, ignoredColumns: [], add: [], update: [], unchanged: [], errors: [] };
  const headerAt = rows.findIndex((r) => r.some((c) => String(c ?? '').trim()));
  if (headerAt < 0) return { ...plan, error: 'The sheet is empty.' };
  const cols = matchColumns(rows[headerAt]);
  plan.ignoredColumns = cols.ignored;
  if (!('name' in cols.columns) && !('firstName' in cols.columns || 'lastName' in cols.columns)) {
    return { ...plan, error: `No Name column found in the first row. Use the template's headings: ${TEMPLATE_COLUMNS.join(', ')}.` };
  }

  const squadByName = new Map();
  for (const p of players) {
    const k = nameKey(p.name);
    squadByName.set(k, [...(squadByName.get(k) || []), p]);
  }
  const seen = new Map(); // name key -> first row number

  for (let i = headerAt + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row.some((c) => String(c ?? '').trim())) continue; // blank line
    const rowNo = i + 1;
    const { name, fields, errors } = readRow(row, cols, units);
    const fail = (reasons) => plan.errors.push({ row: rowNo, name, reasons });
    if (!name) { fail(['No name.', ...errors]); continue; }
    const key = nameKey(name);
    if (seen.has(key)) { fail([`Same name as row ${seen.get(key)}.`]); continue; }
    seen.set(key, rowNo);
    if (errors.length) { fail(errors); continue; }

    const matches = squadByName.get(key) || [];
    if (matches.length > 1) { fail([`${matches.length} players in the squad are called ${matches[0].name}. Rename one first.`]); continue; }
    const existing = matches[0];
    if (!existing) {
      const player = normalizePlayer({ ...fields, name, updatedAt: new Date().toISOString() });
      const bad = rangeErrors(player, fields, units);
      if (bad.length) fail(bad); else plan.add.push({ row: rowNo, player });
      continue;
    }
    // Existing player: only the cells filled in, and never the name's spelling, photos,
    // crops or which stats show.
    delete fields.name;
    const player = { ...existing, ...fields };
    const bad = rangeErrors(player, fields, units);
    if (bad.length) { fail(bad); continue; }
    const changes = Object.keys(fields).filter((f) => !sameValue(existing[f], fields[f]))
      .map((field) => ({ field, from: existing[field], to: fields[field] }));
    if (!changes.length) plan.unchanged.push({ row: rowNo, player: existing });
    else plan.update.push({ row: rowNo, before: existing, player: { ...player, updatedAt: new Date().toISOString() }, changes });
  }
  if (!plan.add.length && !plan.update.length && !plan.unchanged.length && !plan.errors.length) {
    plan.error = 'No players found under the heading row.';
  }
  return plan;
}

/** Players to save for a plan: the new ones and the updated ones. */
export const playersToSave = (plan) => [...plan.add.map((a) => a.player), ...plan.update.map((u) => u.player)];

/** Which photos a player still needs: [] when both are there. */
export function missingPhotos(p) {
  return [!p.photos?.serious && 'Serious', !p.photos?.fun && 'Fun'].filter(Boolean);
}

/** The template's heading row, plus nothing else, ready for toCsv. */
export const templateRows = () => [TEMPLATE_COLUMNS];
