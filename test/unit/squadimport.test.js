// Squad import: reading CSV and .xlsx, loose headers, every height/weight/position format,
// the preview plan, and update-by-name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv, readXlsx, toCsv } from '../../js/sheet.js';
import {
  EXAMPLE_NAME, TEMPLATE_COLUMNS, fieldForHeader, importActionLabel, matchColumns, missingPhotos, parseHeight, parsePositions,
  parseWeight, planImport, playersToSave, sameShown, templateRows, undoDate,
} from '../../js/squadimport.js';
import { normalizePlayer } from '../../js/model.js';

const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

// ---------- CSV ----------

test('CSV: quotes, doubled quotes, commas inside quotes, CRLF and a BOM', () => {
  const rows = parseCsv('﻿Name,Positions,Height\r\n"Ortega, Alex","Prop, Lock","6\'1"""\r\nBo,Hooker,185 cm\r\n');
  assert.deepEqual(rows, [['Name', 'Positions', 'Height'], ['Ortega, Alex', 'Prop, Lock', '6\'1"'], ['Bo', 'Hooker', '185 cm']]);
});

test('CSV: an unquoted 6\'1" is kept as typed', () => {
  assert.deepEqual(parseCsv('Name,Height\nAl,6\'1"\n'), [['Name', 'Height'], ['Al', '6\'1"']]);
});

test('CSV: semicolon and tab separated files (Excel in some countries)', () => {
  assert.deepEqual(parseCsv('Name;Weight\nAl;100,5 kg\n'), [['Name', 'Weight'], ['Al', '100,5 kg']]);
  assert.deepEqual(parseCsv('Name\tCaps\nAl\t3'), [['Name', 'Caps'], ['Al', '3']]);
});

test('CSV: a quoted line break stays in the cell; a missing final newline is fine', () => {
  assert.deepEqual(parseCsv('Name,Nick\n"Al\nOrtega",Tank'), [['Name', 'Nick'], ['Al\nOrtega', 'Tank']]);
});

test('toCsv quotes only what needs it and round-trips', () => {
  const rows = [['Name', 'Height'], ['Ortega, Alex', '6\'1"'], ['Bo', '185']];
  assert.equal(toCsv([['a', 'b,c', 'd"e']]), 'a,"b,c","d""e"\r\n');
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

// ---------- xlsx ----------

test('xlsx written by LibreOffice reads like the same sheet saved as CSV', async () => {
  const x = await readXlsx(readFileSync(fixture('sample-squad.xlsx')));
  const c = parseCsv(readFileSync(fixture('sample-squad.csv'), 'utf8'));
  const trim = (rows) => rows.map((r) => { const a = [...r]; while (a.length && a.at(-1) === '') a.pop(); return a; });
  assert.equal(x.length, c.length);
  for (let i = 0; i < c.length; i++) {
    // The one difference is real: the spreadsheet turned "10/12" into a date (an Excel date number).
    if (c[i][2] === '10/12') { assert.match(x[i][2], /^\d{5}$/); assert.equal(undoDate(x[i][2]), '10/12'); continue; }
    assert.deepEqual(trim(x)[i], trim(c)[i], `row ${i + 1}`);
  }
});

// A tiny .xlsx built by hand: stored (uncompressed) entries, namespace prefixes, inline and
// rich-text strings, a boolean, a gap between cells and an entity.
function buildXlsx(files) {
  const enc = new TextEncoder();
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const parts = [];
  const central = [];
  let offset = 0;
  const le = (n, bytes) => Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 0xff);
  for (const [name, text] of Object.entries(files)) {
    const data = enc.encode(text);
    const nameB = enc.encode(name);
    const crc = crc32(data);
    const head = [...le(0x04034b50, 4), ...le(20, 2), 0, 0, 0, 0, 0, 0, 0, 0, ...le(crc, 4), ...le(data.length, 4), ...le(data.length, 4), ...le(nameB.length, 2), 0, 0];
    parts.push(Uint8Array.from(head), nameB, data);
    central.push(Uint8Array.from([...le(0x02014b50, 4), ...le(20, 2), ...le(20, 2), 0, 0, 0, 0, 0, 0, 0, 0, ...le(crc, 4), ...le(data.length, 4), ...le(data.length, 4),
      ...le(nameB.length, 2), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le(offset, 4)]), nameB);
    offset += head.length + nameB.length + data.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = Uint8Array.from([...le(0x06054b50, 4), 0, 0, 0, 0, ...le(Object.keys(files).length, 2), ...le(Object.keys(files).length, 2), ...le(cdSize, 4), ...le(offset, 4), 0, 0]);
  return Buffer.concat([...parts, ...central, end]);
}

test('xlsx: namespaced tags, inline and rich-text strings, gaps, booleans, entities, second sheet ignored', async () => {
  const ns = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const xlsx = buildXlsx({
    'xl/workbook.xml': `<x:workbook ${ns}><x:sheets><x:sheet name="Squad" sheetId="1" r:id="rId7"/><x:sheet name="Other" sheetId="2" r:id="rId8"/></x:sheets></x:workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId8" Target="worksheets/other.xml"/><Relationship Id="rId7" Target="worksheets/squad.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><r><t>Pos</t></r><r><t xml:space="preserve">itions</t></r></si><si><t>O&apos;Connor &amp; Co</t></si></sst>',
    'xl/worksheets/squad.xml': `<x:worksheet ${ns}><x:sheetData>
      <x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c><x:c r="D1" t="inlineStr"><x:is><x:t>Caps</x:t></x:is></x:c></x:row>
      <x:row r="3"><x:c r="A3" t="s"><x:v>2</x:v></x:c><x:c r="B3" t="inlineStr"><x:is><x:t>Wing</x:t></x:is></x:c><x:c r="C3" t="b"><x:v>1</x:v></x:c><x:c r="D3"><x:v>12</x:v></x:c></x:row>
    </x:sheetData></x:worksheet>`,
    'xl/worksheets/other.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Wrong sheet</t></is></c></row></sheetData></worksheet>',
  });
  assert.deepEqual(await readXlsx(xlsx), [['Name', 'Positions', '', 'Caps'], [], ["O'Connor & Co", 'Wing', 'TRUE', '12']]);
});

test('xlsx: a file that is not a spreadsheet gives a plain message', async () => {
  await assert.rejects(readXlsx(Buffer.from('not a zip at all, just text')), /not a valid \.xlsx/);
});

// ---------- headers ----------

test('column names match loosely', () => {
  const cases = {
    name: ['Name', 'NAME', '  name ', 'Player', 'Player Name', 'Full name', 'player_name'],
    nickname: ['Nickname', 'nick', 'Nick name', 'Known as'],
    positions: ['Positions', 'Position', 'Pos', 'Pos.', 'POSITION(S)', 'positions played'],
    heightCm: ['Height', 'height (cm)', 'Height ft/in', 'HT'],
    weightKg: ['Weight', 'Weight (lbs)', 'WT', 'weight kg'],
    years: ['Years at SFV', 'years', 'Yrs', 'Years at club', 'Seasons'],
    caps: ['Caps', 'CAPS', 'Cap', 'Apps', 'Appearances'],
    firstName: ['First name', 'Given name'],
    lastName: ['Last name', 'Surname'],
  };
  for (const [field, headers] of Object.entries(cases)) {
    for (const h of headers) assert.equal(fieldForHeader(h), field, `"${h}"`);
  }
  for (const h of ['Email', 'Phone', '', 'Notes']) assert.equal(fieldForHeader(h), null, `"${h}"`);
  const m = matchColumns(['Email', 'Name', 'Weight (kg)', 'Name']);
  assert.deepEqual(m.columns, { name: 1, weightKg: 2 });
  assert.deepEqual(m.hints, { weightKg: 'kg' });
  assert.deepEqual(m.ignored, ['Email', 'Name'], 'unknown and repeated columns are listed as not used');
});

test('the template has exactly the agreed columns, and they all match', () => {
  assert.deepEqual(TEMPLATE_COLUMNS, ['Name', 'Nickname', 'Positions', 'Height', 'Weight', 'Years at SFV', 'Caps']);
  assert.deepEqual(templateRows()[0], TEMPLATE_COLUMNS);
  assert.deepEqual(Object.keys(matchColumns(TEMPLATE_COLUMNS).columns), ['name', 'nickname', 'positions', 'heightCm', 'weightKg', 'years', 'caps']);
});

test('the template has one example row showing the formats, and importing it skips that row', () => {
  const rows = templateRows();
  assert.equal(rows.length, 2);
  const [name, , positions, height, weight] = rows[1];
  assert.equal(name, 'EXAMPLE (skipped on import)');
  assert.equal(name, EXAMPLE_NAME);
  assert.equal(positions, 'Prop, Hooker or 1/2');
  assert.equal(height, '6\'1" or 185 cm');
  assert.equal(weight, '220 lb or 100 kg');
  // The example's formats really are the accepted ones.
  assert.deepEqual(parsePositions(positions).positions, ['Prop', 'Hooker']);
  for (const h of height.split(' or ')) assert.ok(parseHeight(h).cm, h);
  for (const w of weight.split(' or ')) assert.ok(parseWeight(w).kg, w);

  // Untouched template: nothing to import, and the preview says why.
  const only = planImport(parseCsv(toCsv(rows)), []);
  assert.match(only.error, /Only the example row/);
  // With players added under it (and in a different case), the example row is still skipped.
  const filled = planImport([...rows.map((r, i) => (i === 1 ? ['example (Skipped on import)', ...r.slice(1)] : r)), ['Bo Kim', '', 'Hooker']], []);
  assert.deepEqual(filled.exampleRows, [2]);
  assert.deepEqual(filled.add.map((a) => a.player.name), ['Bo Kim']);
  assert.deepEqual(filled.errors, []);
});

// ---------- values ----------

test('every height format', () => {
  const sixOne = 185.4;
  for (const h of [`6'1"`, `6'1`, `6' 1"`, '6 ft 1', '6ft 1in', '6 ft 1 in', '6 feet 1 inch', '6’1”', '6′1″', "6'1''", '6-1', '6 1', '73"', '73 in']) {
    assert.equal(parseHeight(h).cm, sixOne, h);
  }
  assert.equal(parseHeight("6'").cm, 182.9);
  assert.equal(parseHeight('6 ft').cm, 182.9);
  for (const h of ['185 cm', '185cm', '185 CM', '185', '1.85 m', '1.85m', '1.85']) assert.equal(parseHeight(h).cm, 185, h);
  for (const h of ['tall', "6'13", '6-13', '12-5', '300', '20', '']) assert.ok(parseHeight(h).error, `"${h}" is refused`);
});

test('a bare height is read in the only unit it makes sense in, always with a note', () => {
  assert.deepEqual(parseHeight('185'), { cm: 185, note: 'Height 185 read as cm (too tall to be inches).' });
  assert.deepEqual(parseHeight('73'), { cm: 185.4, note: 'Height 73 read as inches (6\'1"); too short to be cm.' });
  assert.deepEqual(parseHeight('6'), { cm: 182.9, note: 'Height 6 read as 6\'0" (feet).' });
  assert.deepEqual(parseHeight('1.85'), { cm: 185, note: 'Height 1.85 read as metres.' });
  assert.deepEqual(parseHeight('185', 'cm'), { cm: 185 }, 'a unit in the column heading is taken as written');
  for (const h of ['6\'1"', '185 cm', '73 in', '6 ft 1']) assert.equal(parseHeight(h).note, undefined, `${h} has its unit: no note`);
});

test('every weight format; a bare number follows the units setting', () => {
  for (const w of ['220 lb', '220lb', '220 lbs', '220 LBS', '220 pounds', '220#']) assert.equal(parseWeight(w, 'kg').kg, 99.8, w);
  for (const w of ['100 kg', '100kg', '100 KG', '100 kgs', '100 kilos']) assert.equal(parseWeight(w, 'lb').kg, 100, w);
  assert.equal(parseWeight('100', 'kg').kg, 100, 'bare number with cm · kg');
  assert.equal(parseWeight('100', 'lb').kg, 45.4, 'bare number with ft/in · lb');
  assert.ok(parseWeight('heavy').error);
});

test('a bare weight that fits only one unit uses it; one that fits both is an assumption; never silent', () => {
  for (const setting of ['lb', 'kg']) {
    assert.deepEqual(parseWeight('76', setting), { kg: 76, note: 'Weight 76 read as kg (too light to be lb).' }, `76 with ${setting}`);
    assert.deepEqual(parseWeight('282', setting), { kg: 127.9, note: 'Weight 282 read as lb (too heavy to be kg).' }, `282 with ${setting}`);
  }
  assert.deepEqual(parseWeight('128', 'lb'), { kg: 58.1, note: 'Weight 128 read as lb (from "Show stats in"). Write 128 kg if that\'s wrong.', assumed: true });
  assert.deepEqual(parseWeight('128', 'kg'), { kg: 128, note: 'Weight 128 read as kg (from "Show stats in"). Write 128 lb if that\'s wrong.', assumed: true });
  assert.deepEqual(parseWeight('128', 'lb', 'kg'), { kg: 128 }, 'a unit in the column heading is taken as written');
  for (const w of ['20', '500']) assert.match(parseWeight(w).error, /isn't a likely weight in lb or kg/, w);
  for (const w of ['128 lb', '128 kg']) assert.equal(parseWeight(w).note, undefined, `${w} has its unit: no note`);
});

test('the preview carries each bare-number note, and marks assumptions', () => {
  const plan = planImport([['Name', 'Height', 'Weight'], ['Al', '185', '76'], ['Bo', '6\'1"', '128'], ['Cy', '73', '282 lb']], [], { units: 'imperial' });
  const notes = Object.fromEntries(plan.add.map((a) => [a.player.name, a.notes]));
  assert.deepEqual(notes.Al.map((n) => [n.field, n.assumed]), [['heightCm', false], ['weightKg', false]]);
  assert.match(notes.Al[1].text, /76 read as kg/);
  assert.deepEqual(notes.Bo, [{ field: 'weightKg', text: 'Weight 128 read as lb (from "Show stats in"). Write 128 kg if that\'s wrong.', assumed: true }]);
  assert.deepEqual(notes.Cy.map((n) => n.field), ['heightCm'], 'a weight with a unit needs no note');
  assert.equal(plan.add.find((a) => a.player.name === 'Al').player.weightKg, 76);
});

test('several positions, separated by commas, slashes and more', () => {
  const p = (t) => parsePositions(t).positions;
  assert.deepEqual(p('Prop, Hooker'), ['Prop', 'Hooker']);
  assert.deepEqual(p('Lock/Flanker'), ['Lock', 'Flanker']);
  assert.deepEqual(p('scrum half; fly-half & centre'), ['Scrum-half', 'Fly-half', 'Centre']);
  assert.deepEqual(p('No. 8 and Openside'), ['Number 8', 'Flanker']);
  assert.deepEqual(p('10/12'), ['Fly-half', 'Centre'], 'shirt numbers');
  assert.deepEqual(p('Center, Winger, Full back'), ['Centre', 'Wing', 'Fullback']);
  assert.deepEqual(p('Back row'), ['Flanker', 'Number 8']);
  assert.deepEqual(p('prop, PROP, loosehead'), ['Prop'], 'no repeats');
  assert.deepEqual(parsePositions('Prop, Goalkeeper').unknown, ['Goalkeeper']);
});

test('positions a spreadsheet turned into a date come back', () => {
  assert.equal(undoDate('46307'), '10/12');
  assert.equal(undoDate('10/12/2026'), '10/12');
  assert.equal(undoDate('2026-04-05'), '4/5');
  assert.equal(undoDate('12'), '12', 'a plain shirt number is left alone');
  assert.equal(undoDate('Prop'), 'Prop');
});

// ---------- the plan ----------

test('the sample sheet: bad cells are skipped with a warning, only nameless and repeated rows are dropped (CSV and xlsx agree)', async () => {
  const fromCsv = planImport(parseCsv(readFileSync(fixture('sample-squad.csv'), 'utf8')), [], { units: 'imperial' });
  const fromXlsx = planImport(await readXlsx(readFileSync(fixture('sample-squad.xlsx'))), [], { units: 'imperial' });
  for (const plan of [fromCsv, fromXlsx]) {
    assert.equal(plan.error, null);
    const added = Object.fromEntries(plan.add.map(({ player: p }) => [p.name, [p.positions.join('+'), p.heightCm, p.weightKg, p.years, p.caps, p.nickname]]));
    assert.deepEqual(added, {
      'Mateo Alvarez': ['Prop', 180.3, 120.2, 4, 38, 'Tank'],
      'Christopher Rodriguez': ['Hooker+Prop', 177.8, 102.1, 6, 71, 'Chris'],
      'Sione Taufa': ['Prop+Lock', 183, 127, 2, 15, ''],
      'Ryan Castillo': ['Scrum-half', 170, 77.1, 2, 18, ''],
      'Ethan Hughes': ['Fly-half+Centre', 182.9, 86, 0, null, ''],
      "Liam O'Connor": ['Wing+Fullback', 188, 88.5, 1, 3, ''],
      // One bad cell no longer drops the row: the cell is left blank.
      'Goalie Gary': ['', 182.9, 90.7, 1, 1, ''],
      'Tall Tim': ['Lock', null, 113.4, 1, 1, ''],
    });
    const warn = (name) => plan.add.find((a) => a.player.name === name).warnings.map((w) => w.text);
    assert.deepEqual(warn('Goalie Gary'), ['Positions skipped: "Goalkeeper" not recognised. Use Prop, Hooker, Lock, Flanker, Number 8, Scrum-half, Fly-half, Centre, Wing, Fullback.']);
    assert.deepEqual(warn('Tall Tim'), ['Height skipped: 9\'2" should be between 4\'0" and 7\'6" (120–230 cm).']);
    assert.deepEqual(warn('Mateo Alvarez'), []);
    const errors = Object.fromEntries(plan.errors.map((e) => [e.row, [e.name, e.reasons.join(' ')]]));
    assert.deepEqual(Object.keys(errors).map(Number), [11, 12], 'only the row with no name and the repeated name');
    assert.equal(errors[11][0], '');
    assert.match(errors[11][1], /No name/);
    assert.match(errors[12][1], /Same name as row 2/);
    assert.deepEqual(plan.ignoredColumns, ['Email']);
    for (const { player } of plan.add) assert.deepEqual(missingPhotos(player), ['Serious', 'Fun']);
    // Bare weights are explained: 225 can only be lb; 195 could be either, so it is an assumption.
    const notes = (name) => plan.add.find((a) => a.player.name === name).notes;
    assert.match(notes('Christopher Rodriguez')[0].text, /225 read as lb \(too heavy to be kg\)/);
    assert.equal(notes("Liam O'Connor")[0].assumed, true);
  }
});

test('one bad cell leaves just that field out; the rest of the row still imports or updates', () => {
  const rows = [['Name', 'Nickname', 'Positions', 'Height', 'Weight', 'Years', 'Caps'],
    ['Al', 'x'.repeat(31), 'Prop, Goalkeeper', 'tall', '20', '2.5', 'lots'],
    ['Mateo Alvarez', '', 'Lock', '7\'11"', '125 kg', '61', '']];
  const plan = planImport(rows, [existing()], { units: 'imperial' });
  const al = plan.add[0];
  assert.equal(al.player.name, 'Al');
  assert.deepEqual(al.player.positions, ['Prop'], 'the positions it knows are kept');
  assert.deepEqual([al.player.nickname, al.player.heightCm, al.player.weightKg, al.player.years, al.player.caps], ['', null, null, null, null]);
  assert.deepEqual(al.warnings.map((w) => w.field), ['nickname', 'positions', 'heightCm', 'weightKg', 'years', 'caps']);
  assert.deepEqual(al.warnings.map((w) => w.text), [
    'Nickname skipped: longer than 30 characters.',
    'Positions: "Goalkeeper" not recognised, so left out. Use Prop, Hooker, Lock, Flanker, Number 8, Scrum-half, Fly-half, Centre, Wing, Fullback.',
    'Height skipped: "tall" isn\'t clear. Write it like 6\'1", 6 ft 1 or 185 cm.',
    "Weight skipped: 20 isn't a likely weight in lb or kg. Write it like 220 lb or 100 kg.",
    'Years at SFV skipped: "2.5" should be a whole number.',
    'Caps skipped: "lots" should be a whole number.',
  ]);
  const mateo = plan.update[0];
  assert.deepEqual(mateo.changes.map((c) => c.field), ['positions', 'weightKg'], 'bad height and years are not applied');
  assert.equal(mateo.player.heightCm, 180.3, 'the squad height is kept, not blanked');
  assert.equal(mateo.player.years, 3);
  assert.deepEqual(mateo.warnings.map((w) => w.field), ['heightCm', 'years']);
  assert.match(mateo.warnings[1].text, /Years at SFV skipped: 61 should be 0 to 60/);
  assert.deepEqual(plan.errors, []);
});

test('only a row with no name is rejected; a very long name is shortened with a warning', () => {
  const plan = planImport([['Name', 'Caps'], ['', '3'], ['N'.repeat(70), '1']], []);
  assert.deepEqual(plan.errors.map((e) => e.row), [2]);
  assert.match(plan.errors[0].reasons[0], /No name/);
  assert.equal(plan.add[0].player.name.length, 60);
  assert.deepEqual(plan.add[0].warnings.map((w) => w.text), ['Name shortened to 60 characters.']);
});

const existing = () => normalizePlayer({
  id: 'mateo', name: 'Mateo Alvarez', nickname: 'Tank', positions: ['Prop'], heightCm: 180.3, weightKg: 120.2, years: 3, caps: 30,
  show: { weight: false }, photos: { serious: 'photo-s', fun: 'photo-f' },
  crops: { serious: { cx: 0.4, cy: 0.3, zoom: 1.5 }, fun: { cx: 0.6, cy: 0.5, zoom: 1.2 } },
});

test('update by name (any case): only filled cells change; photos, crops and toggles never do', () => {
  const rows = [['Name', 'Nickname', 'Positions', 'Height', 'Weight', 'Years at SFV', 'Caps'], ['  mateo   ALVAREZ ', '', 'Prop, Lock', '', '125 kg', '4', '']];
  const before = existing();
  const plan = planImport(rows, [before], { units: 'imperial' });
  assert.equal(plan.add.length, 0);
  assert.equal(plan.update.length, 1);
  const { player, changes } = plan.update[0];
  assert.deepEqual(changes.map((c) => c.field), ['positions', 'weightKg', 'years']);
  assert.equal(player.id, 'mateo', 'same player, not a new one');
  assert.equal(player.name, 'Mateo Alvarez', "the squad's spelling of the name is kept");
  assert.equal(player.nickname, 'Tank', 'empty cell: unchanged');
  assert.equal(player.heightCm, 180.3, 'empty cell: unchanged');
  assert.equal(player.caps, 30, 'empty cell: unchanged');
  assert.deepEqual(player.positions, ['Prop', 'Lock']);
  assert.equal(player.weightKg, 125);
  assert.equal(player.years, 4);
  assert.deepEqual(player.photos, before.photos);
  assert.deepEqual(player.crops, before.crops);
  assert.deepEqual(player.show, before.show);
  assert.deepEqual(playersToSave(plan), [player]);
  assert.equal(before.weightKg, 120.2, 'the squad record itself is not changed by planning');
});

test('an unchanged value is never listed as a change, however it was stored or typed', () => {
  // Stored as 128 kg (typed in kg on the form); the sheet says 282, which reads as 127.9 kg.
  const squad = [normalizePlayer({ ...existing(), weightKg: 128, heightCm: 185, positions: ['Hooker', 'Prop'], nickname: 'Tank' })];
  for (const [units, height, weight] of [['imperial', '6\'1"', '282'], ['imperial', '185 cm', '282 lb'], ['metric', '185.4 cm', '128 kg'], ['metric', '6\'1"', '128.04 kg']]) {
    const plan = planImport([['Name', 'Nickname', 'Positions', 'Height', 'Weight'], ['Mateo Alvarez', ' Tank ', 'Prop / Hooker', height, weight]], squad, { units });
    assert.equal(plan.update.length, 0, `${units}: ${height}, ${weight} -> ${JSON.stringify(plan.update[0]?.changes)}`);
    assert.equal(plan.unchanged.length, 1);
    assert.deepEqual(plan.unchanged[0].notes, [], 'no notes for values that are not being changed');
  }
  // A real change is still a change, and only the field that changed is written.
  const plan = planImport([['Name', 'Height', 'Weight'], ['Mateo Alvarez', '6\'1"', '285']], squad, { units: 'imperial' });
  assert.deepEqual(plan.update[0].changes.map((c) => c.field), ['weightKg']);
  assert.equal(plan.update[0].player.heightCm, 185, 'the stored height is kept exactly');
  assert.ok(sameShown('weightKg', 128, 127.9, 'imperial'));
  assert.ok(sameShown('weightKg', 128, 127.9, 'metric'), '128 and 127.9 kg both show as 128 kg');
  assert.ok(!sameShown('weightKg', 128, 129.3, 'imperial'));
});

test('the confirm button says what will happen', () => {
  const p = (a, u) => ({ add: Array(a).fill({}), update: Array(u).fill({}) });
  assert.equal(importActionLabel(p(2, 3)), 'Add 2, update 3');
  assert.equal(importActionLabel(p(5, 0)), 'Add 5 players');
  assert.equal(importActionLabel(p(1, 0)), 'Add 1 player');
  assert.equal(importActionLabel(p(0, 1)), 'Update 1 player');
  assert.equal(importActionLabel(p(0, 4)), 'Update 4 players');
  assert.equal(importActionLabel(p(0, 0)), '');
});

test('a row matching the squad exactly is "already up to date", not an update', () => {
  const rows = [['name', 'weight'], ['Mateo Alvarez', '120.2 kg']];
  const plan = planImport(rows, [existing()]);
  assert.equal(plan.update.length, 0);
  assert.equal(plan.unchanged.length, 1);
  assert.deepEqual(playersToSave(plan), []);
});

test('bare weights follow the units setting; a unit in the header wins', () => {
  assert.equal(planImport([['Name', 'Weight'], ['A', '100']], [], { units: 'metric' }).add[0].player.weightKg, 100);
  assert.equal(planImport([['Name', 'Weight'], ['A', '220']], [], { units: 'imperial' }).add[0].player.weightKg, 99.8);
  assert.equal(planImport([['Name', 'Weight (kg)'], ['A', '100']], [], { units: 'imperial' }).add[0].player.weightKg, 100);
  assert.equal(planImport([['Name', 'Height (cm)'], ['A', '185']], []).add[0].player.heightCm, 185);
});

test('first and last name columns are joined; the heading row can sit lower down', () => {
  const plan = planImport([[], ['', ''], ['First name', 'Surname', 'Pos'], ['Sam', 'Roiz', 'Hooker']], []);
  assert.equal(plan.add[0].player.name, 'Sam Roiz');
  assert.equal(plan.add[0].row, 4);
});

test('problems with the whole sheet, and with names the squad has twice', () => {
  assert.match(planImport([], []).error, /empty/);
  assert.match(planImport([['Email', 'Phone'], ['a@b.c', '1']], []).error, /No Name column/);
  assert.match(planImport([['Name']], []).error, /No players/);
  const twins = [normalizePlayer({ id: '1', name: 'Bo Kim' }), normalizePlayer({ id: '2', name: 'bo kim' })];
  const plan = planImport([['Name', 'Caps'], ['Bo Kim', '3']], twins);
  assert.match(plan.errors[0].reasons[0], /2 players in the squad are called Bo Kim/);
});

test('bad numbers are explained, and the rest of the row is kept', () => {
  const plan = planImport([['Name', 'Years', 'Caps', 'Weight'], ['A', '2.5', 'lots', '20 kg'], ['B', '', '', '']], []);
  const why = plan.add[0].warnings.map((w) => w.text).join(' ');
  assert.match(why, /Years at SFV skipped: "2\.5" should be a whole number/);
  assert.match(why, /Caps skipped: "lots" should be a whole number/);
  assert.match(why, /Weight skipped: 44 lb should be between 88 and 440 lb/);
  assert.equal(plan.add.length, 2, 'both rows import; a row with just a name is a valid new player');
});
