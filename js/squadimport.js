// Squad import from a spreadsheet: loose column matching, forgiving height/weight/position
// parsing, and a plan (new / updated / unchanged / errors) shown before anything is saved.
// Pure: no DOM, no storage. Rows come from sheet.js.

import {
  LIMITS, POSITIONS, formatHeight, formatWeight, ftInToCm, lbToKg, normalizePlayer,
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
 * Height text -> { cm, note? } or { error }. Accepts 6'1", 6' 1, 6 ft 1, 6ft 1in, 6', 6-1, 73 in,
 * 185 cm and 1.85 m. A bare number is read in the only unit it makes sense in (185: cm, 73: inches,
 * 6: feet, 1.85: metres), with a note saying so. hint: a unit from the column heading ('cm').
 */
export function parseHeight(text, hint = null) {
  const s = tidy(text).toLowerCase();
  const typed = tidy(text);
  const unclear = { error: `"${typed}" isn't clear. Write it like 6'1", 6 ft 1 or 185 cm.` };
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
  if (!Number.isFinite(n)) return unclear;
  if (hint === 'cm') return { cm: round1(n) };
  const [lo, hi] = LIMITS.heightCm;
  // The plausible ranges for cm, inches, metres and feet don't overlap, so a bare number only
  // ever fits one of them.
  if (n >= lo && n <= hi) return { cm: round1(n), note: `Height ${typed} read as cm (too tall to be inches).` };
  if (n * 2.54 >= lo && n * 2.54 <= hi) {
    const cm = round1(n * 2.54);
    return { cm, note: `Height ${typed} read as inches (${formatHeight(cm)}); too short to be cm.` };
  }
  if (s.includes('.') && n * 100 >= lo && n * 100 <= hi) return { cm: round1(n * 100), note: `Height ${typed} read as metres.` };
  if (Number.isInteger(n) && n >= 4 && n <= 7) return { cm: ftInToCm(n, 0), note: `Height ${typed} read as ${n}'0" (feet).` };
  return { error: `${typed} isn't a likely height in cm, inches or feet. Write it like 6'1" or 185 cm.` };
}

/**
 * Weight text -> { kg, note? } or { error }. Accepts 220 lb / lbs / pounds and 100 kg / kgs / kilos.
 * A bare number is read in the only unit it's a likely weight in (76: kg, 282: lb), or, when it
 * could be either, in `unit` (the "Show stats in" setting), always with a note. hint: a unit from
 * the column heading ('lb' or 'kg'), which is taken as written.
 */
export function parseWeight(text, unit = 'lb', hint = null) {
  const s = tidy(text).toLowerCase();
  const typed = tidy(text);
  let m = /^(\d+(?:\.\d+)?) ?(?:lb|lbs|lb\.|pounds?|#)$/.exec(s);
  if (m) return { kg: lbToKg(m[1]) };
  if ((m = /^(\d+(?:\.\d+)?) ?(?:kg|kgs|kilos?|kilograms?)$/.exec(s))) return { kg: round1(Number(m[1])) };
  const n = num(s);
  if (!Number.isFinite(n)) return { error: `"${typed}" isn't clear. Write it like 220 lb or 100 kg.` };
  if (hint) return { kg: hint === 'kg' ? round1(n) : lbToKg(n) };
  const [lo, hi] = LIMITS.weightKg;
  const asKg = n >= lo && n <= hi;
  const asLb = lbToKg(n) >= lo && lbToKg(n) <= hi;
  if (asKg && asLb) {
    return {
      kg: unit === 'kg' ? round1(n) : lbToKg(n),
      note: `Weight ${typed} read as ${unit} (from "Show stats in"). Write ${typed} ${unit === 'kg' ? 'lb' : 'kg'} if that's wrong.`,
      assumed: true,
    };
  }
  if (asKg) return { kg: round1(n), note: `Weight ${typed} read as kg (too light to be lb).` };
  if (asLb) return { kg: lbToKg(n), note: `Weight ${typed} read as lb (too heavy to be kg).` };
  return { error: `${typed} isn't a likely weight in lb or kg. Write it like 220 lb or 100 kg.` };
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
function parseCount(text) {
  const s = tidy(text).toLowerCase().replace(/\s*(years?|yrs?|caps?|seasons?)$/, '');
  if (s === 'new') return { value: 0 };
  const n = num(s);
  if (!Number.isInteger(n)) return { error: `"${tidy(text)}" should be a whole number.` };
  return { value: n };
}

/** Case-insensitive, space-insensitive name key, used to match sheet rows to squad players. */
export const nameKey = (name) => String(name ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

// ---------- plan ----------

const RANGE_TEXT = {
  heightCm: () => 'should be between 4\'0" and 7\'6" (120–230 cm)', // same limits and wording as the player form
  weightKg: () => 'should be between 88 and 440 lb (40–200 kg)',
  years: () => `should be 0 to ${LIMITS.years[1]}`,
  caps: () => `should be 0 to ${LIMITS.caps[1]}`,
};
const inRange = (field, v) => v >= LIMITS[field][0] && v <= LIMITS[field][1];

/**
 * One data row -> { name, fields, notes, warnings }.
 *   fields: { field: value } for the cells that were filled in and could be read.
 *   notes: [{ field, text, assumed }] how a bare number was read (always shown, never silent).
 *   warnings: [{ field, text }] a cell that couldn't be used, so it is left out of the import.
 * units: the "Show stats in" setting ('imperial' | 'metric').
 */
function readRow(row, { columns, hints }, units) {
  const cell = (field) => (field in columns ? tidy(row[columns[field]]) : '');
  const fields = {};
  const notes = [];
  const warnings = [];
  const skip = (field, why) => warnings.push({ field, text: `${FIELD_LABELS[field]} skipped: ${why}` });
  const shown = (field, v) => showValue(field, v, units);

  let name = cell('name');
  if (!name && ('firstName' in columns || 'lastName' in columns)) name = [cell('firstName'), cell('lastName')].filter(Boolean).join(' ');
  if (name.length > LIMITS.name) {
    name = name.slice(0, LIMITS.name).trim();
    warnings.push({ field: 'name', text: `Name shortened to ${LIMITS.name} characters.` });
  }

  if (cell('nickname')) {
    if (cell('nickname').length > LIMITS.nickname) skip('nickname', `longer than ${LIMITS.nickname} characters.`);
    else fields.nickname = cell('nickname');
  }
  if (cell('positions')) {
    const { positions, unknown } = parsePositions(undoDate(cell('positions')));
    const list = unknown.map((u) => `"${u}"`).join(', ');
    if (!positions.length) skip('positions', `${list} not recognised. Use ${POSITIONS.join(', ')}.`);
    else {
      fields.positions = positions;
      if (unknown.length) warnings.push({ field: 'positions', text: `Positions: ${list} not recognised, so left out. Use ${POSITIONS.join(', ')}.` });
    }
  }
  const measure = (field, parsed, value) => {
    if (parsed.error) return skip(field, parsed.error);
    if (!inRange(field, value)) return skip(field, `${shown(field, value)} ${RANGE_TEXT[field]()}.`);
    fields[field] = value;
    if (parsed.note) notes.push({ field, text: parsed.note, assumed: !!parsed.assumed });
  };
  if (cell('heightCm')) {
    const h = parseHeight(cell('heightCm'), hints.heightCm);
    measure('heightCm', h, h.cm);
  }
  if (cell('weightKg')) {
    const w = parseWeight(cell('weightKg'), units === 'metric' ? 'kg' : 'lb', hints.weightKg);
    measure('weightKg', w, w.kg);
  }
  for (const key of ['years', 'caps']) {
    if (!cell(key)) continue;
    const c = parseCount(cell(key));
    if (c.error) skip(key, c.error);
    else if (!inRange(key, c.value)) skip(key, `${c.value} ${RANGE_TEXT[key]()}.`);
    else fields[key] = c.value;
  }
  return { name, fields, notes, warnings };
}

/**
 * Whether a sheet value and a squad value would look the same to the coach: heights and weights
 * as displayed (282 lb is 282 lb, whether stored as 127.9 or 128 kg), positions in any order.
 */
export function sameShown(field, a, b, units = 'imperial') {
  if (field === 'positions') return [...(a || [])].sort().join('|') === [...(b || [])].sort().join('|');
  if (field === 'nickname') return String(a ?? '').trim() === String(b ?? '').trim();
  return showValue(field, a, units) === showValue(field, b, units);
}

/** A field's value as the coach reads it, for the preview. */
export function showValue(field, value, units = 'imperial') {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'heightCm') return formatHeight(value, units);
  if (field === 'weightKg') return formatWeight(value, units);
  if (field === 'positions') return value.length ? value.join(', ') : '—';
  if (field === 'years' && value === 0) return 'New'; // as the squad cards and video show it
  return String(value);
}

/** The template's example row is marked so it is never imported. */
export const EXAMPLE_NAME = 'EXAMPLE (skipped on import)';
const isExample = (name) => /^example\b/i.test(name.trim());

/**
 * Work out what an import would do, without changing anything.
 * rows: from parseCsv / readXlsx. players: the current squad. units: the "Show stats in" setting.
 * Returns {
 *   error,                       // a problem with the whole sheet (no Name column, no rows)
 *   ignoredColumns: [header],
 *   exampleRows: [row],          // the template's example row, skipped
 *   add: [{ row, player, notes, warnings }],
 *   update: [{ row, before, player, changes: [{ field, from, to }], notes, warnings }],
 *   unchanged: [{ row, player, notes, warnings }],
 *   errors: [{ row, name, reasons: [] }],   // rows not imported at all
 * }
 * A cell that can't be used is left out with a warning; only a row with no name (or one that
 * can't be told apart from another) is not imported. Row numbers are the sheet's own (1 = first).
 */
export function planImport(rows, players = [], { units = 'imperial' } = {}) {
  const plan = { error: null, ignoredColumns: [], exampleRows: [], add: [], update: [], unchanged: [], errors: [] };
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
  const now = () => new Date().toISOString();

  for (let i = headerAt + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row.some((c) => String(c ?? '').trim())) continue; // blank line
    const rowNo = i + 1;
    const { name, fields, notes, warnings } = readRow(row, cols, units);
    const fail = (reasons) => plan.errors.push({ row: rowNo, name, reasons });
    if (!name) { fail(['No name, so there is no one to add or update.']); continue; }
    if (isExample(name)) { plan.exampleRows.push(rowNo); continue; }
    const key = nameKey(name);
    // Importing these would add or change the same player twice, or guess which one is meant.
    if (seen.has(key)) { fail([`Same name as row ${seen.get(key)}.`]); continue; }
    seen.set(key, rowNo);
    const matches = squadByName.get(key) || [];
    if (matches.length > 1) { fail([`${matches.length} players in the squad are called ${matches[0].name}. Rename one first.`]); continue; }

    const existing = matches[0];
    if (!existing) {
      plan.add.push({ row: rowNo, player: normalizePlayer({ ...fields, name, updatedAt: now() }), notes, warnings });
      continue;
    }
    // Existing player: only cells that were filled in and look different, and never the name's
    // spelling, photos, crops or which stats show.
    const changes = Object.keys(fields).filter((f) => !sameShown(f, existing[f], fields[f], units))
      .map((field) => ({ field, from: existing[field], to: fields[field] }));
    const changed = new Set(changes.map((c) => c.field));
    const used = notes.filter((n) => changed.has(n.field));
    if (!changes.length) { plan.unchanged.push({ row: rowNo, player: existing, notes: used, warnings }); continue; }
    const player = { ...existing, ...Object.fromEntries(changes.map((c) => [c.field, c.to])), updatedAt: now() };
    plan.update.push({ row: rowNo, before: existing, player, changes, notes: used, warnings });
  }
  if (!plan.add.length && !plan.update.length && !plan.unchanged.length && !plan.errors.length) {
    plan.error = plan.exampleRows.length ? 'Only the example row was found. Add your players under it, or replace it.' : 'No players found under the heading row.';
  }
  return plan;
}

/** What pressing the confirm button will do: "Add 2, update 3", "Add 5 players", "Update 1 player". */
export function importActionLabel(plan) {
  const a = plan.add.length;
  const u = plan.update.length;
  const players = (n) => `${n} player${n === 1 ? '' : 's'}`;
  if (a && u) return `Add ${a}, update ${u}`;
  if (a) return `Add ${players(a)}`;
  if (u) return `Update ${players(u)}`;
  return '';
}

/** Players to save for a plan: the new ones and the updated ones. */
export const playersToSave = (plan) => [...plan.add.map((a) => a.player), ...plan.update.map((u) => u.player)];

/** Which photos a player still needs: [] when both are there. */
export function missingPhotos(p) {
  return [!p.photos?.serious && 'Serious', !p.photos?.fun && 'Fun'].filter(Boolean);
}

/** The template: the headings and one example row (skipped on import) showing the formats. */
export const templateRows = () => [
  TEMPLATE_COLUMNS,
  [EXAMPLE_NAME, 'Tank', 'Prop, Hooker or 1/2', '6\'1" or 185 cm', '220 lb or 100 kg', '3', '25'],
];
