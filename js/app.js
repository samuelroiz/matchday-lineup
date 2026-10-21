// UI wiring for the four tabs. Data rules live in model.js; drawing in teamsheet.js / video.js.

import {
  ALL_SLOTS, BENCH_SLOTS, POSITIONS, SLOT_NAMES, SLOT_POSITIONS, STARTER_SLOTS, KICKOFF_TIMES, formatKickoff,
  cmToFtIn, copyMatch, countPicked, findDuplicates, formatFixtureWhen, ftInToCm, isValid,
  kgToLb, lbToKg, matchFileBase, normalizeMatch, normalizePlayer, removePlayerFromMatch,
  toNumberOrNull, validateMatch, validatePlayer, visibleStats, STAT_KEYS, newId,
} from './model.js';
import { openStore } from './storage.js';
import { createBackup, describeRestore, restoreBackup } from './backup.js';
import { forgetPhoto, loadImage, photoImage, resizeImage } from './images.js';
import { createPhotoPicker } from './cropeditor.js';
import { drawPhoto } from './photodraw.js';
import { PHOTO_STYLES } from './photostyle.js';
import { CROP_ASPECT } from './crop.js';
import { confirmDialog, el, openDialog, toast } from './dialog.js';
import { layoutTeamSheet, drawTeamSheet } from './teamsheet.js';
import { SPEEDS, VIDEO_TEMPLATE, buildTimeline } from './timeline.js';
import { createPreviewPlayer, createVideoRenderer, recordVideo } from './video.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const DEFAULT_SETTINGS = { id: 'settings', units: 'imperial', photoStyle: 'auto', activeMatchId: null, speed: 1, transition: 'flip', sheetSize: 'post' };
// ?clip=5 exports only the first 5 seconds of the video (handy for a quick test).
const CLIP_SECONDS = Math.max(0, Number(new URLSearchParams(location.search).get('clip')) || 0);

const state = {
  store: null,
  players: [],
  matches: [],
  settings: { ...DEFAULT_SETTINGS },
  logo: null,
  photoUrls: new Map(),
  video: null,       // { timeline, renderer, player }
  exporting: null,   // AbortController while a video export runs
};

// ---------- helpers ----------

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function photoUrl(id) {
  if (!id) return null;
  if (state.photoUrls.has(id)) return state.photoUrls.get(id);
  const rec = await state.store.get('photos', id);
  const url = rec?.blob ? URL.createObjectURL(rec.blob) : null;
  state.photoUrls.set(id, url);
  return url;
}

async function deletePhoto(id) {
  if (!id) return;
  await state.store.delete('photos', id);
  const url = state.photoUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  state.photoUrls.delete(id);
  forgetPhoto(id);
}

async function savePhoto(blob) {
  const id = newId();
  await state.store.put('photos', { id, blob });
  return id;
}

const playerById = (id) => state.players.find((p) => p.id === id) || null;
const activeMatch = () => state.matches.find((m) => m.id === state.settings.activeMatchId) || null;
const byName = (a, b) => a.name.localeCompare(b.name);
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function storageError(e) {
  console.error(e);
  const full = e?.name === 'QuotaExceededError';
  toast(full ? 'Browser storage is full. Back up the squad, then remove some photos.' : `Could not save: ${e?.message || e}`, { type: 'error', timeout: 7000 });
}

async function saveSettings() {
  try { await state.store.put('settings', state.settings); } catch (e) { storageError(e); }
}

function showErrors(root, errors) {
  for (const small of $$('.err', root)) {
    const msg = errors[small.dataset.for] || '';
    small.textContent = msg;
    small.closest('.field')?.classList.toggle('invalid', !!msg);
  }
}

// ---------- tabs ----------

function showTab(name) {
  for (const btn of $$('.tabs [role=tab]')) btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
  for (const panel of $$('main > [role=tabpanel]')) panel.hidden = panel.id !== `tab-${name}`;
  if (name !== 'video') state.video?.player.pause();
  if (name === 'sheet') renderSheet();
  if (name === 'video') prepareVideo();
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
}

// ---------- squad ----------

function statsList(p) {
  const shown = new Set(visibleStats(p, state.settings.units).map((s) => s.key));
  const all = visibleStats({ ...p, show: {} }, state.settings.units);
  if (!all.length) return el('p', { class: 'muted small' }, 'No stats yet');
  return el('dl', { class: 'stats' }, all.map((s) => el('div', { class: shown.has(s.key) ? 'stat' : 'stat off', title: shown.has(s.key) ? '' : 'Hidden in the video' },
    el('dt', {}, s.label), el('dd', {}, s.value, shown.has(s.key) ? '' : el('span', { class: 'off-tag' }, 'hidden')))));
}

const THUMB_W = 320;
function photoFigure(id, crop, label, name) {
  const canvas = el('canvas', { width: String(THUMB_W), height: String(Math.round(THUMB_W / CROP_ASPECT)), role: 'img', 'aria-label': `${label} photo of ${name}`, hidden: true });
  const fig = el('figure', { class: 'card-photo' }, el('span', { class: 'photo-empty' }, 'No photo'), canvas, el('figcaption', {}, label));
  if (id) {
    photoImage(state.store, id).then((img) => {
      if (!img) return;
      drawPhoto(canvas.getContext('2d'), { img, crop }, 0, 0, canvas.width, canvas.height, state.settings.photoStyle);
      canvas.hidden = false;
      canvas.dataset.rendered = 'true';
      fig.querySelector('.photo-empty')?.remove();
    });
  }
  return fig;
}

function renderSquad() {
  const q = $('#squad-search').value.trim().toLowerCase();
  const list = $('#player-list');
  const players = [...state.players].sort(byName)
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.nickname.toLowerCase().includes(q) || p.positions.join(' ').toLowerCase().includes(q));
  list.replaceChildren(...players.map((p) => el('article', { class: 'player-card', dataset: { id: p.id } },
    el('div', { class: 'card-photos' }, photoFigure(p.photos.serious, p.crops.serious, 'Serious', p.name), photoFigure(p.photos.fun, p.crops.fun, 'Fun', p.name)),
    el('div', { class: 'card-info' },
      el('h3', {}, p.name),
      p.nickname ? el('p', { class: 'nick' }, `“${p.nickname}”`) : null,
      el('div', { class: 'chips static' }, p.positions.map((pos) => el('span', { class: 'chip' }, pos))),
      statsList(p)),
    el('div', { class: 'card-actions' },
      el('button', { type: 'button', class: 'btn btn-small', onclick: () => openPlayerForm(p) }, 'Edit'),
      el('button', { type: 'button', class: 'btn btn-small btn-danger-ghost', onclick: () => deletePlayer(p) }, 'Delete')))));
  $('#squad-empty').hidden = state.players.length > 0;
  const n = state.players.length;
  $('#squad-count').textContent = n ? `${n} player${n === 1 ? '' : 's'} in the squad${q ? ` · ${players.length} shown` : ''}` : '';
}

function readPlayerForm(form, base) {
  const f = form.elements;
  const heightCm = f.heightUnit.value === 'cm' ? toNumberOrNull(f.heightCm.value) : ftInToCm(f.heightFt.value, f.heightIn.value);
  const w = toNumberOrNull(f.weight.value);
  const weightKg = w === null || Number.isNaN(w) ? w : f.weightUnit.value === 'lb' ? lbToKg(w) : w;
  const show = {};
  for (const k of STAT_KEYS) show[k] = f[`show-${k}`].checked;
  return normalizePlayer({
    ...base,
    name: f.name.value,
    nickname: f.nickname.value,
    positions: $$('[data-positions] input:checked', form).map((i) => i.value),
    heightCm,
    weightKg,
    years: f.years.value,
    caps: f.caps.value,
    show,
    updatedAt: new Date().toISOString(),
  });
}

function friendlyPlayerErrors(errors) {
  const e = { ...errors };
  if (e.heightCm) e.heightCm = 'Height should be between 4\'0" and 7\'6" (120–230 cm).';
  if (e.weightKg) e.weightKg = 'Weight should be between 88 and 440 lb (40–200 kg).';
  return e;
}

function fillPlayerForm(form, p) {
  const f = form.elements;
  const imperial = state.settings.units === 'imperial';
  f.name.value = p?.name || '';
  f.nickname.value = p?.nickname || '';
  $('[data-positions]', form).replaceChildren(...POSITIONS.map((pos) => el('label', { class: 'chip-toggle' },
    el('input', { type: 'checkbox', value: pos, checked: p?.positions.includes(pos) }), pos)));

  const setHeightUnit = (unit) => {
    f.heightUnit.value = unit;
    $('[data-height=cm]', form).hidden = unit !== 'cm';
    $('[data-height=ftin]', form).hidden = unit !== 'ftin';
  };
  setHeightUnit(imperial ? 'ftin' : 'cm');
  if (p?.heightCm) {
    f.heightCm.value = Math.round(p.heightCm);
    const fi = cmToFtIn(p.heightCm);
    f.heightFt.value = fi.ft;
    f.heightIn.value = fi.in;
  }
  // Switching unit converts what's already typed.
  f.heightUnit.addEventListener('change', () => {
    const unit = f.heightUnit.value;
    if (unit === 'cm') {
      const cm = ftInToCm(f.heightFt.value, f.heightIn.value);
      f.heightCm.value = Number.isFinite(cm) ? Math.round(cm) : '';
    } else {
      const fi = cmToFtIn(toNumberOrNull(f.heightCm.value));
      f.heightFt.value = fi ? fi.ft : '';
      f.heightIn.value = fi ? fi.in : '';
    }
    setHeightUnit(unit);
  });

  f.weightUnit.value = imperial ? 'lb' : 'kg';
  if (p?.weightKg) f.weight.value = imperial ? kgToLb(p.weightKg) : p.weightKg;
  f.weightUnit.addEventListener('change', () => {
    const v = toNumberOrNull(f.weight.value);
    if (Number.isFinite(v)) f.weight.value = f.weightUnit.value === 'kg' ? lbToKg(v) : kgToLb(v);
  });

  f.years.value = p?.years ?? '';
  f.caps.value = p?.caps ?? '';
  for (const k of STAT_KEYS) f[`show-${k}`].checked = p ? p.show[k] !== false : true;
}

async function openPlayerForm(existing = null) {
  const form = $('#player-form-tpl').content.firstElementChild.cloneNode(true);
  fillPlayerForm(form, existing);
  const pickers = {};
  for (const [kind, label] of [['serious', 'Serious photo'], ['fun', 'Fun photo']]) {
    const id = existing?.photos[kind];
    const img = id ? await photoImage(state.store, id) : null;
    pickers[kind] = createPhotoPicker({
      label, kind,
      existing: img ? { img, crop: existing.crops[kind] } : null,
      getStyle: () => state.settings.photoStyle,
    });
  }
  $('.photo-pickers', form).replaceChildren(pickers.serious.element, pickers.fun.element);

  const title = existing ? `Edit ${existing.name}` : 'Add player';
  return openDialog({
    title,
    body: form,
    className: 'modal-wide',
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: existing ? 'Save changes' : 'Add to squad', value: 'save', variant: 'primary' }],
    beforeClose: async (value) => {
      if (value !== 'save') return true;
      const player = readPlayerForm(form, existing || {});
      const errors = validatePlayer(player);
      showErrors(form, friendlyPlayerErrors(errors));
      if (!isValid(errors)) { $('.field.invalid input', form)?.focus(); return false; }
      try {
        for (const kind of ['serious', 'fun']) {
          const r = pickers[kind].result();
          const old = existing?.photos[kind];
          if (r.blob) {
            player.photos[kind] = await savePhoto(r.blob);
            player.crops[kind] = r.crop;
            if (old) await deletePhoto(old);
          } else if (r.removed) {
            player.photos[kind] = null;
            player.crops[kind] = null;
            if (old) await deletePhoto(old);
          } else if (r.crop) {
            player.crops[kind] = r.crop;
          }
        }
        await state.store.put('players', player);
      } catch (e) {
        storageError(e);
        return false;
      }
      const i = state.players.findIndex((p) => p.id === player.id);
      if (i >= 0) state.players[i] = player; else state.players.push(player);
      renderSquad();
      renderMatchEditor();
      toast(existing ? `Saved ${player.name}.` : `${player.name} added to the squad.`, { type: 'success' });
      return true;
    },
  });
}

async function deletePlayer(p) {
  const inMatches = state.matches.filter((m) => Object.values(m.selection).includes(p.id));
  const extra = inMatches.length ? ` They will also be taken out of ${inMatches.length} saved match${inMatches.length === 1 ? '' : 'es'}.` : '';
  if (!(await confirmDialog(`Delete ${p.name} and their photos from this device?${extra}`, { title: 'Delete player', okLabel: 'Delete', danger: true }))) return;
  try {
    for (const m of inMatches) {
      removePlayerFromMatch(m, p.id);
      m.updatedAt = new Date().toISOString();
      await state.store.put('matches', m);
    }
    await deletePhoto(p.photos.serious);
    await deletePhoto(p.photos.fun);
    await state.store.delete('players', p.id);
  } catch (e) { storageError(e); return; }
  state.players = state.players.filter((x) => x.id !== p.id);
  renderSquad();
  renderMatchList();
  renderMatchEditor();
  toast(`${p.name} deleted.`);
}

async function backupSquad() {
  try {
    const data = await createBackup(state.store);
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    download(blob, `sfv-squad-backup-${new Date().toISOString().slice(0, 10)}.json`);
    toast(`Backed up ${data.players.length} players and ${Object.keys(data.photos).length} photos.`, { type: 'success' });
  } catch (e) {
    toast(`Backup failed: ${e.message}`, { type: 'error' });
  }
}

async function restoreSquad(file) {
  try {
    const result = await restoreBackup(state.store, await file.text());
    await loadAll();
    renderSquad();
    renderMatchList();
    renderMatchEditor();
    toast(describeRestore(result), { type: 'success', timeout: 6000 });
  } catch (e) {
    if (e?.name === 'QuotaExceededError') storageError(e);
    else toast(e.message, { type: 'error', timeout: 6000 });
  }
}

// ---------- matches ----------

function nextSaturday(from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sortedMatches() {
  return [...state.matches].sort((a, b) => (b.date || '9999').localeCompare(a.date || '9999') || b.createdAt.localeCompare(a.createdAt));
}

function renderMatchList() {
  const active = state.settings.activeMatchId;
  const items = sortedMatches().map((m) => el('li', {},
    el('button', {
      type: 'button',
      class: `match-item${m.id === active ? ' active' : ''}`,
      'aria-current': m.id === active ? 'true' : false,
      onclick: () => selectMatch(m.id),
    },
    el('strong', {}, `vs ${m.opponent || 'TBC'}`),
    el('span', {}, formatFixtureWhen(m) || 'No date yet'),
    el('span', { class: 'muted small' }, `${countPicked(m.selection, STARTER_SLOTS)}/15 · bench ${countPicked(m.selection, BENCH_SLOTS)}/8`))));
  $('#match-list').replaceChildren(...items);
  if (!items.length) $('#match-list').append(el('li', { class: 'muted small pad' }, 'No saved matches yet.'));
}

async function selectMatch(id) {
  await flushMatchSave();
  state.settings.activeMatchId = id;
  await saveSettings();
  renderMatchList();
  renderMatchEditor();
}

function slotOptions(slot, selection) {
  const suits = SLOT_POSITIONS[slot] || [];
  const pickedAt = new Map();
  for (const s of ALL_SLOTS) {
    const id = selection[s];
    if (id && s !== slot) pickedAt.set(id, [...(pickedAt.get(id) || []), s]);
  }
  const option = (p) => el('option', { value: p.id },
    `${p.name}${p.positions.length ? ` · ${p.positions.join(', ')}` : ''}${pickedAt.has(p.id) ? `  (also #${pickedAt.get(p.id).join(', #')})` : ''}`);
  const players = [...state.players].sort(byName);
  const good = players.filter((p) => p.positions.some((x) => suits.includes(x)));
  const rest = players.filter((p) => !good.includes(p));
  const opts = [el('option', { value: '' }, '— not picked —')];
  if (good.length) opts.push(el('optgroup', { label: `Plays ${suits.join(' / ')}` }, good.map(option)));
  if (rest.length) opts.push(el('optgroup', { label: good.length ? 'Rest of squad' : 'Squad' }, rest.map(option)));
  return opts;
}

function refreshSelection(m) {
  const dups = findDuplicates(m.selection);
  const dupSlots = new Set(dups.flatMap((d) => d.slots));
  for (const sel of $$('select[data-slot]')) {
    const slot = Number(sel.dataset.slot);
    sel.replaceChildren(...slotOptions(slot, m.selection));
    sel.value = m.selection[slot] && playerById(m.selection[slot]) ? m.selection[slot] : '';
    sel.closest('.slot').classList.toggle('dup', dupSlots.has(slot));
    sel.closest('.slot').classList.toggle('filled', !!sel.value);
  }
  const warn = $('#dup-warning');
  warn.hidden = dups.length === 0;
  warn.replaceChildren(...dups.map((d) => el('p', {},
    el('strong', {}, playerById(d.playerId)?.name || 'A player'), ` is picked twice: shirts ${d.slots.join(' and ')}.`)));
  $('#xv-count').textContent = `${countPicked(m.selection, STARTER_SLOTS)}/15`;
  $('#bench-count').textContent = `${countPicked(m.selection, BENCH_SLOTS)}/8`;
}

function slotRow(slot) {
  return el('label', { class: 'slot', dataset: { slot } },
    el('span', { class: 'num' }, String(slot)),
    el('span', { class: 'pos' }, SLOT_NAMES[slot]),
    el('select', { dataset: { slot }, 'aria-label': `Shirt ${slot}, ${SLOT_NAMES[slot]}` }));
}

function renderMatchEditor() {
  const m = activeMatch();
  $('#match-none').hidden = !!m;
  $('#match-form').hidden = !m;
  if (!m) return;
  const form = $('#match-form');
  $('#match-title').textContent = m.opponent ? `SFV vs ${m.opponent}` : 'New match';
  setKickoffOptions(m.kickoff);
  for (const k of ['opponent', 'date', 'kickoff', 'venue', 'competition']) {
    if (document.activeElement !== form.elements[k]) form.elements[k].value = m[k] || '';
  }
  showErrors(form, touchedErrors(m));
  const logo = $('#m-logo-preview');
  logo.hidden = !m.opponentLogo;
  $('#m-logo-remove').hidden = !m.opponentLogo;
  if (m.opponentLogo) photoUrl(m.opponentLogo).then((u) => { logo.src = u || ''; });

  const starterGroups = VIDEO_TEMPLATE.groups.filter((g) => !g.compact);
  $('#starters').replaceChildren(...starterGroups.map((g) => el('div', { class: 'slot-group' },
    el('h3', {}, g.title), ...[...g.slots].sort((a, b) => a - b).map(slotRow))));
  $('#bench').replaceChildren(el('div', { class: 'slot-group wide' }, ...BENCH_SLOTS.map(slotRow)));
  if (!state.players.length) {
    $('#starters').prepend(el('p', { class: 'warning' }, 'Your squad is empty. Add players on the Squad tab first.'));
  }
  refreshSelection(m);
}

const touched = new Set();
function touchedErrors(m) {
  const errors = validateMatch(m);
  return Object.fromEntries(Object.entries(errors).filter(([k]) => touched.has(k)));
}

let saveTimer = 0;
let pendingSave = null;
function scheduleMatchSave(m) {
  m.updatedAt = new Date().toISOString();
  $('#save-status').textContent = 'Saving…';
  pendingSave = m;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushMatchSave, 300);
}

async function flushMatchSave() {
  clearTimeout(saveTimer);
  const m = pendingSave;
  pendingSave = null;
  if (!m) return;
  try {
    await state.store.put('matches', m);
    $('#save-status').textContent = 'Saved';
  } catch (e) {
    $('#save-status').textContent = 'Not saved';
    storageError(e);
  }
  renderMatchList();
}

async function newMatch() {
  const m = normalizeMatch({ date: nextSaturday() });
  try { await state.store.put('matches', m); } catch (e) { storageError(e); return; }
  state.matches.push(m);
  touched.clear();
  await selectMatch(m.id);
  $('#m-opponent').focus();
}

async function copyActiveMatch() {
  const src = activeMatch();
  if (!src) return;
  await flushMatchSave();
  const m = copyMatch(src);
  m.date = nextSaturday();
  if (src.opponentLogo) m.opponentLogo = null;
  try { await state.store.put('matches', m); } catch (e) { storageError(e); return; }
  state.matches.push(m);
  touched.clear();
  await selectMatch(m.id);
  toast('Selection copied. Set the opponent and check the date.', { type: 'success' });
  $('#m-opponent').focus();
}

async function deleteActiveMatch() {
  const m = activeMatch();
  if (!m) return;
  if (!(await confirmDialog(`Delete the match vs ${m.opponent || 'TBC'}? The squad is not affected.`, { title: 'Delete match', okLabel: 'Delete', danger: true }))) return;
  pendingSave = null;
  try {
    await deletePhoto(m.opponentLogo);
    await state.store.delete('matches', m.id);
  } catch (e) { storageError(e); return; }
  state.matches = state.matches.filter((x) => x.id !== m.id);
  state.settings.activeMatchId = sortedMatches()[0]?.id || null;
  await saveSettings();
  renderMatchList();
  renderMatchEditor();
  toast('Match deleted.');
}

// Kick-off is a list rather than <input type=time>: Safari shows an empty time input as a
// greyed "12:30 PM" that looks filled in but saves nothing.
function setKickoffOptions(current) {
  const sel = $('#m-kickoff');
  const times = KICKOFF_TIMES.includes(current) || !current ? KICKOFF_TIMES : [...KICKOFF_TIMES, current].sort();
  if (sel.options.length === times.length + 1) return;
  sel.replaceChildren(el('option', { value: '' }, 'Not set'), ...times.map((t) => el('option', { value: t }, formatKickoff(t))));
}

function bindMatchForm() {
  const form = $('#match-form');
  form.addEventListener('submit', (e) => e.preventDefault());
  // Some browsers only fire 'change' for selects and date pickers, so listen to both.
  const onFixtureEdit = (e) => {
    const m = activeMatch();
    const k = e.target.name;
    if (!m || !['opponent', 'date', 'kickoff', 'venue', 'competition'].includes(k)) return;
    if (m[k] === e.target.value) return;
    m[k] = e.target.value;
    touched.add(k);
    $('#match-title').textContent = m.opponent ? `SFV vs ${m.opponent}` : 'New match';
    showErrors(form, touchedErrors(m));
    scheduleMatchSave(m);
  };
  form.addEventListener('input', onFixtureEdit);
  form.addEventListener('change', onFixtureEdit);
  form.addEventListener('focusout', (e) => {
    const m = activeMatch();
    if (!m || !e.target.name) return;
    touched.add(e.target.name);
    showErrors(form, touchedErrors(m));
  });
  form.addEventListener('change', (e) => {
    const m = activeMatch();
    if (!m || !e.target.matches('select[data-slot]')) return;
    m.selection[e.target.dataset.slot] = e.target.value || null;
    refreshSelection(m);
    scheduleMatchSave(m);
  });
  $('#m-logo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    const m = activeMatch();
    if (!file || !m) return;
    try {
      const blob = await resizeImage(file, 600, { type: 'image/png' });
      const old = m.opponentLogo;
      m.opponentLogo = await savePhoto(blob);
      if (old) await deletePhoto(old);
      scheduleMatchSave(m);
      renderMatchEditor();
    } catch (err) { toast(err.message, { type: 'error' }); }
  });
  $('#m-logo-remove').addEventListener('click', async () => {
    const m = activeMatch();
    if (!m?.opponentLogo) return;
    await deletePhoto(m.opponentLogo);
    m.opponentLogo = null;
    scheduleMatchSave(m);
    renderMatchEditor();
  });
  $('#new-match').addEventListener('click', newMatch);
  $('#copy-match').addEventListener('click', copyActiveMatch);
  $('#delete-match').addEventListener('click', deleteActiveMatch);
}

/** Problems worth flagging before exporting. */
function matchIssues(m) {
  const issues = Object.values(validateMatch(m));
  for (const d of findDuplicates(m.selection)) issues.push(`${playerById(d.playerId)?.name || 'A player'} is picked twice (shirts ${d.slots.join(' and ')}).`);
  const missing = STARTER_SLOTS.filter((s) => !playerById(m.selection[s]));
  if (missing.length) issues.push(`No player picked for shirt${missing.length === 1 ? '' : 's'} ${missing.join(', ')}.`);
  return issues;
}

// ---------- render data ----------

async function photoOf(p, kind) {
  const img = await photoImage(state.store, p.photos[kind]);
  return img ? { img, crop: p.crops[kind] } : null;
}

async function buildRenderData(m) {
  const slots = {};
  for (const s of ALL_SLOTS) {
    const p = playerById(m.selection[s]);
    slots[s] = p ? { player: p, serious: await photoOf(p, 'serious'), fun: await photoOf(p, 'fun') } : null;
  }
  return {
    match: m,
    units: state.settings.units,
    photoStyle: state.settings.photoStyle,
    logo: state.logo,
    opponentLogo: await photoImage(state.store, m.opponentLogo),
    slots,
  };
}

function setNote(node, m, extra = []) {
  const issues = m ? [...matchIssues(m), ...extra] : ['Create or pick a match on the Match tab first.'];
  node.replaceChildren(...(issues.length
    ? [el('span', { class: 'warn-text' }, '⚠ '), issues.join(' ')]
    : [m ? `SFV vs ${m.opponent} · ${formatFixtureWhen(m)}` : '']));
}

// ---------- team sheet ----------

let sheetRenderId = 0;
async function renderSheet() {
  await flushMatchSave();
  const m = activeMatch();
  const size = state.settings.sheetSize;
  const canvas = $('#sheet-canvas');
  const L = layoutTeamSheet(size);
  canvas.width = L.width;
  canvas.height = L.height;
  canvas.parentElement.classList.toggle('tall', size === 'story');
  setNote($('#sheet-note'), m);
  $('#sheet-export').disabled = !m;
  const ctx = canvas.getContext('2d');
  if (!m) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
  const id = ++sheetRenderId;
  const data = await buildRenderData(m);
  if (id !== sheetRenderId) return; // a newer render started while photos were loading
  drawTeamSheet(ctx, size, data);
  canvas.dataset.rendered = size;
}

async function exportSheet() {
  const m = activeMatch();
  if (!m) return;
  await renderSheet();
  const canvas = $('#sheet-canvas');
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) { toast('Could not create the image.', { type: 'error' }); return; }
  const filename = `${matchFileBase(m)}-${state.settings.sheetSize}.png`;
  const link = $('#sheet-link');
  if (link.href.startsWith('blob:')) URL.revokeObjectURL(link.href);
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.hidden = false;
  link.textContent = `Save ${filename} again`;
  download(blob, filename);
  toast(`Saved ${filename}`, { type: 'success' });
}

// ---------- video ----------

function videoTemplate() {
  return { ...VIDEO_TEMPLATE, transition: state.settings.transition };
}

let videoBuildId = 0;
async function prepareVideo() {
  if (state.exporting) return;
  await flushMatchSave();
  state.video?.player.pause();
  const m = activeMatch();
  setNote($('#video-note'), m, CLIP_SECONDS ? [`Test mode: exports only the first ${CLIP_SECONDS} s.`] : []);
  $('#video-export').disabled = !m;
  $('#video-play').disabled = !m;
  const canvas = $('#video-canvas');
  if (!m) { canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); state.video = null; return; }
  const id = ++videoBuildId;
  const data = await buildRenderData(m);
  if (id !== videoBuildId) return;
  const template = videoTemplate();
  const timeline = buildTimeline(template, { speed: state.settings.speed, selection: m.selection });
  const renderer = createVideoRenderer(data, timeline, template);
  $('#video-length').textContent = `Length ${fmtTime(timeline.duration)} · ${timeline.segments.filter((s) => s.type === 'group').length} groups`;
  const player = createPreviewPlayer(canvas, renderer, timeline, {
    onTime: (t) => {
      $('#video-scrub').value = String(Math.round((t / timeline.duration) * 1000));
      $('#video-time').textContent = `${fmtTime(t)} / ${fmtTime(timeline.duration)}`;
    },
    onEnd: () => { $('#video-play').textContent = '▶ Preview'; },
  });
  state.video = { timeline, renderer, player };
  $('#video-play').textContent = '▶ Preview';
}

function togglePreview() {
  const v = state.video;
  if (!v) return;
  if (v.player.playing) { v.player.pause(); $('#video-play').textContent = '▶ Preview'; } else { v.player.play(); $('#video-play').textContent = '❚❚ Pause'; }
}

function setExportingUi(on) {
  $('#video-progress').hidden = !on;
  for (const id of ['#video-export', '#video-play', '#video-scrub', '#video-speed', '#video-transition']) $(id).disabled = on;
}

async function exportVideo() {
  const m = activeMatch();
  if (!m || state.exporting) return;
  await prepareVideo();
  const v = state.video;
  if (!v) return;
  v.player.pause();
  const ctrl = new AbortController();
  state.exporting = ctrl;
  setExportingUi(true);
  $('#video-result').hidden = true;
  const bar = $('#video-progress-bar');
  const label = $('#video-progress-label');
  try {
    const result = await recordVideo($('#video-canvas'), v.renderer, v.timeline, {
      signal: ctrl.signal,
      limitSeconds: CLIP_SECONDS,
      onProgress: (p) => { bar.value = p; label.textContent = `${Math.round(p * 100)}%`; },
    });
    const filename = `${matchFileBase(m)}-lineup.${result.ext}`;
    const url = URL.createObjectURL(result.blob);
    const out = $('#video-output');
    if (out.src.startsWith('blob:')) URL.revokeObjectURL(out.src);
    out.src = url;
    const link = $('#video-link');
    link.href = url;
    link.download = filename;
    link.dataset.type = result.type;
    link.dataset.size = String(result.blob.size);
    $('#video-format').textContent = result.ext === 'mp4'
      ? `MP4 · ${(result.blob.size / 1e6).toFixed(1)} MB · ready for Instagram.`
      : `WebM · ${(result.blob.size / 1e6).toFixed(1)} MB. This browser can't record MP4; Instagram may need it converted. Chrome 126+ and Safari record MP4.`;
    $('#video-result').hidden = false;
    toast('Video ready.', { type: 'success' });
  } catch (e) {
    if (e?.name === 'AbortError') toast('Video export cancelled.');
    else toast(e.message || String(e), { type: 'error', timeout: 7000 });
  } finally {
    state.exporting = null;
    setExportingUi(false);
    bar.value = 0;
    label.textContent = '0%';
    v.player.seek(0);
  }
}

function bindVideo() {
  const speed = $('#video-speed');
  speed.replaceChildren(...SPEEDS.map((s) => el('option', { value: String(s.value) }, `${s.label} (${s.value}×)`)));
  speed.value = String(state.settings.speed);
  if (!speed.value) speed.value = '1';
  speed.addEventListener('change', async () => { state.settings.speed = Number(speed.value); await saveSettings(); prepareVideo(); });
  const tr = $('#video-transition');
  tr.value = state.settings.transition;
  tr.addEventListener('change', async () => { state.settings.transition = tr.value; await saveSettings(); prepareVideo(); });
  $('#video-play').addEventListener('click', togglePreview);
  $('#video-scrub').addEventListener('input', (e) => {
    const v = state.video;
    if (!v) return;
    v.player.pause();
    $('#video-play').textContent = '▶ Preview';
    v.player.seek((Number(e.target.value) / 1000) * v.timeline.duration);
  });
  $('#video-export').addEventListener('click', exportVideo);
  $('#video-cancel').addEventListener('click', () => state.exporting?.abort());
}

// ---------- boot ----------

async function loadAll() {
  const [players, matches, settings] = await Promise.all([
    state.store.getAll('players'),
    state.store.getAll('matches'),
    state.store.get('settings', 'settings'),
  ]);
  state.players = players.map(normalizePlayer);
  state.matches = matches.map(normalizeMatch);
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  if (!activeMatch()) state.settings.activeMatchId = sortedMatches()[0]?.id || null;
}

async function init() {
  state.store = await openStore();
  if (state.store.kind !== 'indexeddb') {
    const note = $('#storage-note');
    note.hidden = false;
    note.textContent = state.store.kind === 'localstorage' ? 'Limited storage: back up often' : 'Not saved: private browsing?';
  }
  navigator.storage?.persist?.().catch(() => {});
  await loadAll();

  state.logo = await loadImage('assets/sfv-logo.jpeg');
  if (!state.logo) $('.club-logo').hidden = true;

  for (const btn of $$('.tabs [role=tab]')) btn.addEventListener('click', () => showTab(btn.dataset.tab));
  $('.tabs').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const tabs = $$('.tabs [role=tab]');
    const i = tabs.indexOf(document.activeElement);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    showTab(next.dataset.tab);
  });

  $('#add-player').addEventListener('click', () => openPlayerForm());
  $('#squad-search').addEventListener('input', renderSquad);
  $('#units').value = state.settings.units;
  $('#units').addEventListener('change', async (e) => { state.settings.units = e.target.value; await saveSettings(); renderSquad(); });
  const styleSel = $('#photo-style');
  styleSel.replaceChildren(...PHOTO_STYLES.map((s) => el('option', { value: s.value }, s.label)));
  styleSel.value = state.settings.photoStyle;
  styleSel.addEventListener('change', async () => { state.settings.photoStyle = styleSel.value; await saveSettings(); renderSquad(); });
  $('#backup').addEventListener('click', backupSquad);
  $('#restore').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) restoreSquad(f); });

  bindMatchForm();
  for (const r of $$('input[name=sheet-size]')) {
    r.checked = r.value === state.settings.sheetSize;
    r.addEventListener('change', async () => { state.settings.sheetSize = r.value; await saveSettings(); renderSheet(); });
  }
  $('#sheet-export').addEventListener('click', exportSheet);
  bindVideo();

  window.addEventListener('beforeunload', (e) => {
    if (pendingSave) flushMatchSave();
    if (state.exporting) e.preventDefault();
  });

  renderSquad();
  renderMatchList();
  renderMatchEditor();
  const start = location.hash.slice(1);
  showTab(['squad', 'match', 'sheet', 'video'].includes(start) ? start : (state.players.length ? 'match' : 'squad'));
  document.documentElement.dataset.ready = 'true';
}

init().catch((e) => {
  console.error(e);
  toast(`Matchday Lineup failed to start: ${e.message}`, { type: 'error', timeout: 15000 });
});
