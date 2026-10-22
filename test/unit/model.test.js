import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_SLOTS, cmToFtIn, copyMatch, findDuplicates, formatFixtureWhen, formatHeight, formatWeight,
  ftInToCm, isValid, isValidDate, kgToLb, lbToKg, matchFileBase, normalizeMatch, normalizePlayer,
  removePlayerFromMatch, shortName, splitName, validateMatch, validatePlayer, visibleStats,
  compareCoaches, leaderBadge, normalizeCoach, removeCoachFromMatch, setLeader, syncLeaders, validateCoach,
  BENCH_SLOTS, STARTER_SLOTS, SLOT_POSITIONS, autoPick, emptySelection, packBench,
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

test('a match has one captain and one vice-captain, never the same player', () => {
  const m = normalizeMatch({ opponent: 'X', date: '2026-10-24', selection: { 1: 'a', 2: 'b', 10: 'c' } });
  setLeader(m, 'captain', 'a');
  setLeader(m, 'captain', 'c'); // choosing another captain replaces the first
  assert.equal(m.captain, 'c');
  assert.equal(leaderBadge(m, 'a'), null);
  setLeader(m, 'viceCaptain', 'b');
  assert.deepEqual([leaderBadge(m, 'c'), leaderBadge(m, 'b')], ['C', 'VC']);
  setLeader(m, 'viceCaptain', 'c'); // the captain can't also be vice: they move across
  assert.deepEqual([m.captain, m.viceCaptain], [null, 'c']);
  assert.throws(() => setLeader(m, 'coach', 'a'));
  assert.deepEqual(validateMatch(m), {});
});

test('captain rules are validated, and dropped players lose the armband', () => {
  const m = normalizeMatch({ opponent: 'X', date: '2026-10-24', selection: { 1: 'a', 2: 'b' } });
  assert.ok(validateMatch({ ...m, captain: 'zz' }).captain, 'captain must be picked');
  assert.ok(validateMatch({ ...m, captain: 'a', viceCaptain: 'a' }).viceCaptain, 'not both roles');
  m.captain = 'a';
  m.viceCaptain = 'b';
  m.selection[2] = null;
  assert.equal(syncLeaders(m), true);
  assert.deepEqual([m.captain, m.viceCaptain], ['a', null]);
  removePlayerFromMatch(m, 'a');
  assert.equal(m.captain, null);
});

test('copying a match keeps captain, vice-captain and coaches', () => {
  const src = normalizeMatch({ selection: { 1: 'a', 2: 'b' }, captain: 'a', viceCaptain: 'b', coaches: ['c1', 'c1', 'c2'] });
  assert.deepEqual(src.coaches, ['c1', 'c2'], 'no duplicate coaches');
  const next = copyMatch(src);
  assert.deepEqual([next.captain, next.viceCaptain, next.coaches], ['a', 'b', ['c1', 'c2']]);
});

test('coaches need a name; role and photo crop are checked', () => {
  const c = normalizeCoach({ name: '  Dana   Whitfield ', role: 'Head coach' });
  assert.equal(c.name, 'Dana Whitfield');
  assert.deepEqual(validateCoach(c), {});
  assert.ok(validateCoach(normalizeCoach({ role: 'Assistant' })).name);
  assert.ok(validateCoach(normalizeCoach({ name: 'A', role: 'x'.repeat(41) })).role);
  assert.ok(validateCoach({ ...c, crop: { cx: 0.5, cy: 0.5, zoom: 9, source: 'manual' } }).photo);
  const m = normalizeMatch({ coaches: [c.id, 'other'] });
  assert.equal(removeCoachFromMatch(m, c.id), true);
  assert.deepEqual(m.coaches, ['other']);
});

test('coaches are ordered by role, Head coach first, typed-in roles last, then by name', () => {
  const c = (name, role) => normalizeCoach({ name, role });
  const sorted = [
    c('Zoe Physio', 'Physio'), c('Amy Custom', 'Kit manager'), c('Grant Whitaker', 'Forwards coach'),
    c('Bea Backs', 'backs coach'), c('Maria Delgado', 'Head coach'), c('Al Assist', 'Assistant coach'),
    c('Ann Other', 'Forwards coach'), c('Bo Norole', ''),
  ].sort(compareCoaches).map((x) => x.name);
  assert.deepEqual(sorted, ['Maria Delgado', 'Al Assist', 'Ann Other', 'Grant Whitaker', 'Bea Backs', 'Zoe Physio', 'Amy Custom', 'Bo Norole']);
});

// ---------- auto-pick and bench packing ----------

const squadOf = (spec) => Object.entries(spec).map(([name, positions]) => normalizePlayer({ id: name, name, positions }));

test('packBench moves replacements down to 16, 17... keeping their order', () => {
  const sel = { ...emptySelection(), 1: 'a', 17: 'x', 20: 'y', 23: 'z' };
  const packed = packBench(sel);
  assert.deepEqual(BENCH_SLOTS.map((s) => packed[s]), ['x', 'y', 'z', null, null, null, null, null]);
  assert.equal(packed[1], 'a', 'starters untouched');
  assert.equal(sel[17], 'x', 'input not changed');
  assert.deepEqual(packBench(packed), packed, 'already packed stays the same');
});

test('auto-pick fills every shirt by position from a full squad', () => {
  const squad = squadOf({
    'P1 Loose': ['Prop'], 'P2 Tight': ['Prop'], 'H Hooker': ['Hooker'], 'L1 Lock': ['Lock'], 'L2 Lock': ['Lock'],
    'F1 Flank': ['Flanker'], 'F2 Flank': ['Flanker'], 'N8 Eight': ['Number 8'], 'S9 Scrum': ['Scrum-half'],
    'F10 Fly': ['Fly-half'], 'C1 Centre': ['Centre'], 'C2 Centre': ['Centre'], 'W1 Wing': ['Wing'], 'W2 Wing': ['Wing'],
    'FB Full': ['Fullback'],
    'H2 Hooker': ['Hooker'], 'P3 Prop': ['Prop'], 'P4 Prop': ['Prop'], 'L3 Lock': ['Lock'], 'F3 Flank': ['Flanker'],
    'S2 Scrum': ['Scrum-half'], 'F2 Fly': ['Fly-half'], 'W3 Wing': ['Wing'],
  });
  const { selection, added, empty } = autoPick(emptySelection(), squad);
  assert.equal(added, 23);
  assert.deepEqual(empty, []);
  const pos = (s) => squad.find((p) => p.id === selection[s]).positions;
  for (const s of [...STARTER_SLOTS, ...BENCH_SLOTS]) {
    assert.ok(pos(s).some((x) => SLOT_POSITIONS[s].includes(x)), `shirt ${s} gets a ${SLOT_POSITIONS[s].join('/')}, not ${pos(s)}`);
  }
  assert.equal(findDuplicates(selection).length, 0, 'nobody picked twice');
  assert.equal(pos(8)[0], 'Number 8', 'the Number 8 wears 8, ahead of a flanker');
});

test('auto-pick keeps shirts already picked and never re-uses those players', () => {
  const squad = squadOf({ 'A Prop': ['Prop'], 'B Prop': ['Prop'], 'C Prop': ['Prop'], 'D Hooker': ['Hooker'] });
  const start = { ...emptySelection(), 1: 'C Prop', 10: 'A Prop' }; // a prop at fly-half: the coach's call
  const { selection } = autoPick(start, squad);
  assert.equal(selection[1], 'C Prop');
  assert.equal(selection[10], 'A Prop');
  assert.equal(selection[3], 'B Prop');
  assert.equal(selection[2], 'D Hooker');
  assert.equal(findDuplicates(selection).length, 0);
  assert.equal(start[3], null, 'input not changed');
});

test('auto-pick spends a scarce player where only they fit', () => {
  // One player covers hooker and prop; the other prop can only be a prop. The hooker shirt
  // has one candidate, so it is filled first, and both props still get a shirt.
  const squad = squadOf({ 'Versatile Vic': ['Prop', 'Hooker'], 'Only Prop': ['Prop'] });
  const { selection, empty } = autoPick(emptySelection(), squad);
  assert.equal(selection[2], 'Versatile Vic');
  assert.ok([selection[1], selection[3]].includes('Only Prop'));
  assert.ok(empty.includes(4) && empty.includes(15), 'shirts nobody plays stay empty');
});

test('auto-pick puts players left over on the bench, packed from 16', () => {
  const squad = squadOf({ 'A Wing': ['Wing'], 'B Wing': ['Wing'], 'C Wing': ['Wing'], 'D Wing': ['Wing'], 'E Wing': ['Wing'], 'No Position': [] });
  const { selection } = autoPick({ ...emptySelection(), 19: 'E Wing' }, squad);
  const bench = BENCH_SLOTS.map((s) => selection[s]);
  assert.deepEqual(bench.slice(3), [null, null, null, null, null]);
  assert.equal(bench.filter(Boolean).length, 3, 'one wing on the bench already, plus the two left over');
  assert.ok(bench.includes('E Wing') && bench.includes('No Position'));
});

test('auto-pick ignores ids of players no longer in the squad', () => {
  const squad = squadOf({ 'A Prop': ['Prop'] });
  const { selection } = autoPick({ ...emptySelection(), 1: 'deleted-id' }, squad);
  assert.equal(selection[1], 'A Prop');
});
