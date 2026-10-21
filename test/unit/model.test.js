import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_SLOTS, cmToFtIn, copyMatch, findDuplicates, formatFixtureWhen, formatHeight, formatWeight,
  ftInToCm, isValid, isValidDate, kgToLb, lbToKg, matchFileBase, normalizeMatch, normalizePlayer,
  removePlayerFromMatch, shortName, splitName, validateMatch, validatePlayer, visibleStats,
} from '../../js/model.js';

const valid = (overrides = {}) => normalizePlayer({ name: 'Sam Roiz', positions: ['Hooker'], heightCm: 180, weightKg: 100, years: 3, ...overrides });

test('a complete player is valid', () => {
  assert.deepEqual(validatePlayer(valid()), {});
});

test('name is required and trimmed', () => {
  assert.equal(normalizePlayer({ name: '   Ana   Lopez ' }).name, 'Ana Lopez');
  assert.ok(validatePlayer(valid({ name: '   ' })).name);
  assert.ok(validatePlayer(valid({ name: 'x'.repeat(61) })).name);
});

test('only name is required; other stats are optional', () => {
  assert.deepEqual(validatePlayer(normalizePlayer({ name: 'Solo' })), {});
});

test('numbers outside realistic ranges are rejected', () => {
  assert.ok(validatePlayer(valid({ heightCm: 90 })).heightCm);
  assert.ok(validatePlayer(valid({ heightCm: 'tall' })).heightCm);
  assert.ok(validatePlayer(valid({ weightKg: 500 })).weightKg);
  assert.ok(validatePlayer(valid({ years: -1 })).years);
  assert.ok(validatePlayer(valid({ years: 2.5 })).years);
  assert.ok(validatePlayer(valid({ caps: 1001 })).caps);
  assert.ok(isValid(validatePlayer(valid({ caps: 0, years: 0 }))));
});

test('unknown positions are dropped by normalize and rejected by validate', () => {
  assert.deepEqual(normalizePlayer({ name: 'A', positions: ['Prop', 'Goalkeeper', 'Prop'] }).positions, ['Prop']);
  assert.ok(validatePlayer({ ...valid(), positions: ['Goalkeeper'] }).positions);
});

test('stat visibility defaults to shown and respects toggles', () => {
  const p = valid({ caps: 12, show: { weight: false } });
  assert.deepEqual(p.show, { height: true, weight: false, years: true, caps: true });
  const keys = visibleStats(p, 'metric').map((s) => s.key);
  assert.deepEqual(keys, ['height', 'years', 'caps']);
  assert.equal(visibleStats(valid({ years: 0 })).find((s) => s.key === 'years').value, 'New');
});

test('feet/inches and pounds convert both ways', () => {
  assert.equal(ftInToCm(6, 2), 188);
  assert.deepEqual(cmToFtIn(188), { ft: 6, in: 2 });
  assert.deepEqual(cmToFtIn(182.6), { ft: 6, in: 0 }); // 71.9 in rounds up to 6'0", not 5'12"
  assert.equal(ftInToCm('', ''), null);
  assert.equal(lbToKg(220), 99.8);
  assert.equal(kgToLb(99.8), 220);
  assert.equal(formatHeight(188, 'imperial'), `6'2"`);
  assert.equal(formatHeight(188, 'metric'), '188 cm');
  assert.equal(formatWeight(99.8, 'imperial'), '220 lb');
  assert.equal(formatWeight(99.8, 'metric'), '100 kg');
  assert.equal(formatHeight(null), '');
});

test('names split into first and surname', () => {
  assert.deepEqual(splitName('Jonny May Smith'), { first: 'Jonny May', last: 'Smith' });
  assert.deepEqual(splitName('Pele'), { first: '', last: 'Pele' });
  assert.equal(shortName('Jonny Smith'), 'J. Smith');
});

test('match needs an opponent and a real date', () => {
  const m = normalizeMatch({ opponent: 'Santa Monica', date: '2026-10-24', kickoff: '14:30' });
  assert.deepEqual(validateMatch(m), {});
  assert.ok(validateMatch({ ...m, opponent: '' }).opponent);
  assert.ok(validateMatch({ ...m, date: '' }).date);
  assert.ok(validateMatch({ ...m, date: '2026-02-30' }).date);
  assert.ok(validateMatch({ ...m, kickoff: '25:00' }).kickoff);
  assert.ok(validateMatch({ ...m, selection: { ...m.selection, 24: 'x' } }).selection);
  assert.equal(isValidDate('2028-02-29'), true);
});

test('normalizeMatch always has shirts 1-23', () => {
  const m = normalizeMatch({ selection: { 1: 'a', 99: 'b' } });
  assert.deepEqual(Object.keys(m.selection).map(Number), ALL_SLOTS);
  assert.equal(m.selection[1], 'a');
  assert.equal(m.selection[99], undefined);
});

test('a player picked twice is reported with both shirts', () => {
  const m = normalizeMatch({ selection: { 1: 'a', 3: 'b', 17: 'a', 18: 'c' } });
  assert.deepEqual(findDuplicates(m.selection), [{ playerId: 'a', slots: [1, 17] }]);
  assert.deepEqual(findDuplicates(normalizeMatch({}).selection), []);
});

test('copying a match keeps the selection but not the fixture', () => {
  const src = normalizeMatch({ opponent: 'Belmont Shore', date: '2026-10-17', kickoff: '13:00', venue: 'Woodley Park', competition: 'D2', selection: { 1: 'a', 2: 'b' } });
  const next = copyMatch(src);
  assert.notEqual(next.id, src.id);
  assert.equal(next.opponent, '');
  assert.equal(next.date, '');
  assert.equal(next.venue, 'Woodley Park');
  assert.equal(next.selection[2], 'b');
  next.selection[1] = 'z';
  assert.equal(src.selection[1], 'a', 'copy must not share the selection object');
});

test('removing a player clears every shirt they had', () => {
  const m = normalizeMatch({ selection: { 1: 'a', 16: 'a', 2: 'b' } });
  assert.equal(removePlayerFromMatch(m, 'a'), true);
  assert.equal(m.selection[1], null);
  assert.equal(m.selection[16], null);
  assert.equal(removePlayerFromMatch(m, 'a'), false);
});

test('fixture text and file names', () => {
  const m = normalizeMatch({ opponent: 'Santa Monica RFC', date: '2026-10-24', kickoff: '14:30' });
  assert.equal(formatFixtureWhen(m), 'Sat, Oct 24, 2026 · 2:30 PM');
  assert.equal(matchFileBase(m), 'sfv-vs-santa-monica-rfc-2026-10-24');
});
