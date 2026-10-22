// UI wiring for the four tabs. Data rules live in model.js; drawing in teamsheet.js / video.js.

import {
  ALL_SLOTS, BENCH_SLOTS, POSITIONS, SLOT_NAMES, SLOT_POSITIONS, STARTER_SLOTS, KICKOFF_TIMES, formatKickoff,
  autoPick, cmToFtIn, copyMatch, countPicked, findDuplicates, formatFixtureWhen, ftInToCm, isValid,
  kgToLb, lbToKg, matchFileBase, normalizeMatch, normalizePlayer, packBench, removePlayerFromMatch,
  toNumberOrNull, validateMatch, validatePlayer, visibleStats, STAT_KEYS, newId,
  COACH_ROLES, compareCoaches, leaderBadge, normalizeCoach, removeCoachFromMatch, setLeader, syncLeaders, validateCoach,
} from './model.js';
import { STORE_NAMES, openStore } from './storage.js';
import { backupSummary, createBackup, describeRestore, restoreBackup } from './backup.js';
import { forgetPhoto, loadImage, photoImage, resizeImage } from './images.js';
import { createPhotoPicker } from './cropeditor.js';
import { readSheetFile, toCsv } from './sheet.js';
import { FIELD_LABELS, importActionLabel, missingPhotos, planImport, playersToSave, showValue, templateRows } from './squadimport.js';
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
  coaches: [],
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

/** A File for the share sheet, or null where this browser can't share files. */
function shareableFile(blob, filename) {
  if (!blob || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function' || typeof File !== 'function') return null;
  const file = new File([blob], filename, { type: blob.type });
  try { return navigator.canShare({ files: [file] }) ? file : null; } catch { return null; }
}

/** Offer the phone's share sheet for an export. The button stays hidden where that isn't possible. */
function setupShare(button, blob, filename, title) {
  const file = shareableFile(blob, filename);
  button.hidden = !file;
  button.onclick = !file ? null : async () => {
    try {
      await navigator.share({ files: [file], title });
    } catch (e) {
      if (e?.name !== 'AbortError') toast(`Could not share: ${e?.message || e}. Use Download instead.`, { type: 'error' });
    }
  };
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
const coachById = (id) => state.coaches.find((c) => c.id === id) || null;
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
const cardPhotos = new WeakMap(); // card canvas -> { img, crop }, so a style change can repaint it in place

function paintCardPhoto(canvas) {
  const photo = cardPhotos.get(canvas);
  if (!photo) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawPhoto(ctx, photo, 0, 0, canvas.width, canvas.height, state.settings.photoStyle);
  canvas.dataset.style = state.settings.photoStyle;
}

// showLabel 'always' (player cards, so Serious and Fun stay told apart) or 'with-photo'.
function photoFigure(id, crop, label, name, showLabel = 'always') {
  const canvas = el('canvas', { width: String(THUMB_W), height: String(Math.round(THUMB_W / CROP_ASPECT)), role: 'img', 'aria-label': `${label} photo of ${name}`, hidden: true });
  const caption = id || showLabel === 'always' ? el('figcaption', {}, label) : null;
  const fig = el('figure', { class: 'card-photo' }, el('span', { class: 'photo-empty' }, 'No photo'), canvas, caption);
  if (!id) canvas.dataset.rendered = 'none';
  else {
    photoImage(state.store, id).then((img) => {
      if (!img) return;
      cardPhotos.set(canvas, { img, crop });
      paintCardPhoto(canvas);
      canvas.hidden = false;
      canvas.dataset.rendered = 'true';
      fig.querySelector('.photo-empty')?.remove();
    });
  }
  return fig;
}

/** Repaint every squad and coach photo with the current style, without rebuilding the cards. */
function repaintCardPhotos() {
  for (const canvas of $$('.card-photo canvas')) paintCardPhoto(canvas);
}

function renderSquad() {
  const q = $('#squad-search').value.trim().toLowerCase();
  const list = $('#player-list');
  const players = [...state.players].sort(byName)
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.nickname.toLowerCase().includes(q) || p.positions.join(' ').toLowerCase().includes(q));
  list.replaceChildren(...players.map((p) => el('article', { class: `player-card${missingPhotos(p).length ? ' needs-photos' : ''}`, dataset: { id: p.id } },
    el('div', { class: 'card-photos' }, photoFigure(p.photos.serious, p.crops.serious, 'Serious', p.name), photoFigure(p.photos.fun, p.crops.fun, 'Fun', p.name)),
    el('div', { class: 'card-info' },
      el('h3', {}, p.name),
      needsTag(p),
      p.nickname ? el('p', { class: 'nick' }, `“${p.nickname}”`) : null,
      el('div', { class: 'chips static' }, p.positions.map((pos) => el('span', { class: 'chip' }, pos))),
      statsList(p)),
    el('div', { class: 'card-actions' },
      el('button', { type: 'button', class: 'btn btn-small', onclick: () => openPlayerForm(p) }, 'Edit'),
      el('button', { type: 'button', class: 'btn btn-small btn-danger-ghost', onclick: () => deletePlayer(p) }, 'Delete')))));
  $('#squad-empty').hidden = state.players.length > 0;
  const n = state.players.length;
  const needing = state.players.filter((p) => missingPhotos(p).length).length;
  $('#squad-count').textContent = n
    ? `${n} player${n === 1 ? '' : 's'} in the squad${needing ? ` · ${needing} still need${needing === 1 ? 's' : ''} photos (marked in gold)` : ''}${q ? ` · ${players.length} shown` : ''}`
    : '';
}

/** "Needs photos" / "Needs Fun photo" on a squad card, so it's clear who still needs them. */
function needsTag(p) {
  const missing = missingPhotos(p);
  if (!missing.length) return null;
  return el('span', { class: 'needs-tag' }, missing.length === 2 ? 'Needs photos' : `Needs ${missing[0]} photo`);
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

function renderCoaches() {
  const coaches = [...state.coaches].sort(compareCoaches);
  $('#coach-list').replaceChildren(...coaches.map((c) => el('article', { class: 'player-card coach-card', dataset: { id: c.id } },
    el('div', { class: 'card-photos' }, photoFigure(c.photo, c.crop, 'Photo', c.name, 'with-photo')),
    el('div', { class: 'card-info' }, el('h3', {}, c.name), el('p', { class: 'role' }, c.role || 'Coach')),
    el('div', { class: 'card-actions' },
      el('button', { type: 'button', class: 'btn btn-small', onclick: () => openCoachForm(c) }, 'Edit'),
      el('button', { type: 'button', class: 'btn btn-small btn-danger-ghost', onclick: () => deleteCoach(c) }, 'Delete')))));
  $('#coaches-empty').hidden = state.coaches.length > 0;
}

async function openCoachForm(existing = null) {
  const form = $('#coach-form-tpl').content.firstElementChild.cloneNode(true);
  form.elements.name.value = existing?.name || '';
  form.elements.role.value = existing?.role || '';
  // Plain buttons rather than a <datalist>: an open suggestion list swallows the first
  // click on Save, so the coach only saved on the second click.
  const roleInput = form.elements.role;
  const markRole = () => {
    for (const b of $$('[data-role-chips] button', form)) b.setAttribute('aria-pressed', String(b.value.toLowerCase() === roleInput.value.trim().toLowerCase()));
  };
  $('[data-role-chips]', form).replaceChildren(...COACH_ROLES.map((r) => el('button', {
    type: 'button', class: 'chip-btn', value: r,
    onclick: () => { roleInput.value = r; markRole(); },
  }, r)));
  roleInput.addEventListener('input', markRole);
  markRole();
  const img = existing?.photo ? await photoImage(state.store, existing.photo) : null;
  const picker = createPhotoPicker({
    label: 'Photo', kind: 'coach',
    existing: img ? { img, crop: existing.crop } : null,
    getStyle: () => state.settings.photoStyle,
  });
  $('.photo-pickers', form).replaceChildren(picker.element);
  return openDialog({
    title: existing ? `Edit ${existing.name}` : 'Add coach',
    body: form,
    className: 'modal-wide',
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: existing ? 'Save changes' : 'Add coach', value: 'save', variant: 'primary' }],
    beforeClose: async (value) => {
      if (value !== 'save') return true;
      const coach = normalizeCoach({ ...(existing || {}), name: form.elements.name.value, role: form.elements.role.value, updatedAt: new Date().toISOString() });
      const errors = validateCoach(coach);
      showErrors(form, errors);
      if (!isValid(errors)) { $('.field.invalid input', form)?.focus(); return false; }
      try {
        const r = picker.result();
        const old = existing?.photo;
        if (r.blob) {
          coach.photo = await savePhoto(r.blob);
          coach.crop = r.crop;
          if (old) await deletePhoto(old);
        } else if (r.removed) {
          coach.photo = null;
          coach.crop = null;
          if (old) await deletePhoto(old);
        } else if (r.crop) {
          coach.crop = r.crop;
        }
        await state.store.put('coaches', coach);
      } catch (e) {
        storageError(e);
        return false;
      }
      const i = state.coaches.findIndex((c) => c.id === coach.id);
      if (i >= 0) state.coaches[i] = coach; else state.coaches.push(coach);
      renderCoaches();
      renderMatchEditor();
      toast(existing ? `Saved ${coach.name}.` : `${coach.name} added to the coaches.`, { type: 'success' });
      return true;
    },
  });
}

async function deleteCoach(c) {
  const inMatches = state.matches.filter((m) => m.coaches.includes(c.id));
  const extra = inMatches.length ? ` They will also be taken off ${inMatches.length} saved match${inMatches.length === 1 ? '' : 'es'}.` : '';
  if (!(await confirmDialog(`Delete ${c.name} and their photo from this device?${extra}`, { title: 'Delete coach', okLabel: 'Delete', danger: true }))) return;
  try {
    for (const m of inMatches) {
      removeCoachFromMatch(m, c.id);
      m.updatedAt = new Date().toISOString();
      await state.store.put('matches', m);
    }
    await deletePhoto(c.photo);
    await state.store.delete('coaches', c.id);
  } catch (e) { storageError(e); return; }
  state.coaches = state.coaches.filter((x) => x.id !== c.id);
  renderCoaches();
  renderMatchEditor();
  toast(`${c.name} deleted.`);
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
    toast(backupSummary(data), { type: 'success' });
    return true;
  } catch (e) {
    toast(`Backup failed: ${e.message}`, { type: 'error' });
    return false;
  }
}

async function restoreSquad(file) {
  try {
    const result = await restoreBackup(state.store, await file.text());
    await loadAll();
    renderSquad();
    renderCoaches();
    renderMatchList();
    renderMatchEditor();
    toast(describeRestore(result), { type: 'success', timeout: 6000 });
  } catch (e) {
    if (e?.name === 'QuotaExceededError') storageError(e);
    else toast(e.message, { type: 'error', timeout: 6000 });
  }
}

// ---------- import from a spreadsheet ----------

function downloadTemplate(e) {
  e.preventDefault();
  download(new Blob([toCsv(templateRows())], { type: 'text/csv' }), 'sfv-squad-template.csv');
}

const table = (head, rows) => el('div', { class: 'table-wrap' }, el('table', {},
  el('thead', {}, el('tr', {}, head.map((h) => el('th', {}, h)))),
  el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c) => el('td', {}, c)))))));

/** A row's notes (how bare numbers were read) and warnings (cells left out), for the preview. */
function rowNotes({ notes = [], warnings = [] }) {
  if (!notes.length && !warnings.length) return '';
  return el('div', { class: 'row-notes' },
    warnings.map((w) => el('div', { class: 'warn' }, `⚠ ${w.text}`)),
    notes.map((n) => el('div', { class: n.assumed ? 'note assumed' : 'note' }, n.assumed ? `Assumed: ${n.text}` : n.text)));
}

/** What the import will do, laid out for the confirm dialog. */
function importPreview(plan, units) {
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const sections = [];
  const total = plan.add.length + plan.update.length;
  const entries = [...plan.add, ...plan.update, ...plan.unchanged];
  const warned = entries.filter((e) => e.warnings.length).length;
  const assumed = entries.reduce((n, e) => n + e.notes.filter((x) => x.assumed).length, 0);
  const read = entries.reduce((n, e) => n + e.notes.length, 0);
  sections.push(el('p', { class: 'import-summary' }, total
    ? `${plural(plan.add.length, 'new player')} and ${plural(plan.update.length, 'update')}. Nothing changes until you press ${importActionLabel(plan)}.`
    : 'Nothing to import.'));
  const checks = [
    warned && `${plural(warned, 'row')} with a cell that couldn't be used: that cell is left out, the rest of the row is imported (⚠ below).`,
    read && `${plural(read, 'number')} without a unit${assumed ? `, ${assumed} of them assumed from your "Show stats in" setting` : ''}: see the notes to check how each was read.`,
  ].filter(Boolean);
  if (checks.length) sections.push(el('ul', { class: 'import-checks' }, checks.map((c) => el('li', {}, c))));
  if (plan.add.length) {
    sections.push(el('section', { dataset: { section: 'add' } }, el('h3', {}, `New players (${plan.add.length})`),
      table(['Name', 'Positions', 'Height', 'Weight', 'Years', 'Caps', 'Notes'], plan.add.map((a) => {
        const p = a.player;
        return [p.name + (p.nickname ? ` “${p.nickname}”` : ''), showValue('positions', p.positions), showValue('heightCm', p.heightCm, units),
          showValue('weightKg', p.weightKg, units), showValue('years', p.years), showValue('caps', p.caps), rowNotes(a)];
      }))));
  }
  if (plan.update.length) {
    sections.push(el('section', { dataset: { section: 'update' } }, el('h3', {}, `Updates to players already in the squad (${plan.update.length})`),
      table(['Name', 'Changes', 'Notes'], plan.update.map((u) => [u.before.name, el('div', {}, u.changes.map((c) => el('div', { class: 'change' },
        `${FIELD_LABELS[c.field]}: `, el('span', { class: 'from' }, showValue(c.field, c.from, units)), ' → ', el('strong', {}, showValue(c.field, c.to, units))))), rowNotes(u)]))));
  }
  if (plan.unchanged.length) {
    const flagged = plan.unchanged.filter((u) => u.warnings.length);
    sections.push(el('section', { dataset: { section: 'unchanged' } }, el('h3', {}, `Already up to date (${plan.unchanged.length})`),
      el('p', { class: 'hint' }, plan.unchanged.map((u) => u.player.name).join(', ')),
      flagged.length ? table(['Name', 'Notes'], flagged.map((u) => [u.player.name, rowNotes(u)])) : null));
  }
  if (plan.errors.length) {
    sections.push(el('section', { dataset: { section: 'errors' } }, el('h3', { class: 'bad' }, `Rows not imported (${plan.errors.length})`),
      table(['Row', 'Name', 'Why'], plan.errors.map((e) => [String(e.row), e.name || '—', e.reasons.join(' ')]))));
  }
  if (plan.exampleRows.length) {
    sections.push(el('p', { class: 'hint', dataset: { section: 'example' } }, `Row ${plan.exampleRows.join(', ')} is the template's example row, so it was skipped.`));
  }
  if (plan.ignoredColumns.length) {
    sections.push(el('p', { class: 'hint' }, `Columns not used: ${plan.ignoredColumns.join(', ')}.`));
  }
  sections.push(el('p', { class: 'hint' }, 'Updates only change the cells filled in the sheet that differ from the squad. Photos, crops and the "Show in the video" choices are never touched.'));
  return el('div', { class: 'import-preview' }, sections);
}

async function importSheet(file) {
  const units = state.settings.units;
  let plan;
  try {
    plan = planImport(await readSheetFile(file), state.players, { units });
  } catch (e) {
    toast(e.message || String(e), { type: 'error', timeout: 7000 });
    return;
  }
  if (plan.error) {
    await openDialog({ title: `Can't import ${file.name}`, body: el('p', {}, plan.error), actions: [{ label: 'OK', value: true, variant: 'primary' }] });
    return;
  }
  const toSave = playersToSave(plan);
  const choice = await openDialog({
    title: `Import ${file.name}`,
    body: importPreview(plan, units),
    className: 'modal-wide',
    actions: toSave.length
      ? [{ label: 'Cancel', value: 'cancel' }, { label: importActionLabel(plan), value: 'import', variant: 'primary' }]
      : [{ label: 'Close', value: 'cancel', variant: 'primary' }],
  });
  if (choice !== 'import') return;
  try {
    for (const p of toSave) await state.store.put('players', p);
  } catch (e) { storageError(e); return; }
  for (const p of toSave) {
    const i = state.players.findIndex((x) => x.id === p.id);
    if (i >= 0) state.players[i] = p; else state.players.push(p);
  }
  renderSquad();
  renderMatchEditor();
  const added = plan.add.length;
  const updated = plan.update.length;
  const needing = toSave.filter((p) => missingPhotos(p).length).length;
  const parts = [added && `Added ${added} player${added === 1 ? '' : 's'}`, updated && `${added ? 'updated' : 'Updated'} ${updated}`].filter(Boolean).join(' and ');
  toast(`${parts}.${needing ? ` ${needing} still need${needing === 1 ? 's' : ''} photos (marked in gold).` : ''}`, { type: 'success', timeout: 7000 });
}

/** Delete every player, coach, match and photo on this device, after one confirm. */
async function startOver() {
  const counts = `${state.players.length} player${state.players.length === 1 ? '' : 's'}, ${state.coaches.length} coach${state.coaches.length === 1 ? '' : 'es'} and ${state.matches.length} match${state.matches.length === 1 ? '' : 'es'}`;
  const tip = el('p', { class: 'hint start-over-tip' }, 'Back up first if you might want them again: the backup file can be restored later.');
  const choice = await openDialog({
    title: 'Start over?',
    body: el('div', {},
      el('p', {}, `This deletes ${counts}, with all their photos, from this device. It can't be undone.`),
      tip),
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Back up first', value: 'backup' },
      { label: 'Delete everything', value: 'delete', variant: 'danger' },
    ],
    // Backing up keeps the dialog open, so they can delete straight after.
    beforeClose: async (value) => {
      if (value !== 'backup') return true;
      if (await backupSquad()) {
        tip.textContent = '✓ Backup downloaded. You can delete everything now.';
        tip.classList.add('done');
      }
      return false;
    },
  });
  if (choice !== 'delete') return;
  pendingSave = null;
  clearTimeout(saveTimer);
  try {
    for (const name of STORE_NAMES.filter((n) => n !== 'settings')) {
      for (const rec of await state.store.getAll(name)) await state.store.delete(name, rec.id);
    }
  } catch (e) { storageError(e); return; }
  for (const [id, url] of state.photoUrls) { if (url) URL.revokeObjectURL(url); forgetPhoto(id); }
  state.photoUrls.clear();
  state.players = [];
  state.coaches = [];
  state.matches = [];
  state.settings.activeMatchId = null;
  await saveSettings();
  renderSquad();
  renderCoaches();
  renderMatchList();
  renderMatchEditor();
  toast('Everything deleted. Start by adding your players.', { type: 'success' });
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
  if (id !== state.settings.activeMatchId) setSaveStatus('idle');
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
  refreshLeaders(m);
  $('#xv-count').textContent = `${countPicked(m.selection, STARTER_SLOTS)}/15`;
  $('#bench-count').textContent = `${countPicked(m.selection, BENCH_SLOTS)}/8`;
}

/** Captain / vice-captain lists offer only picked players; "C"/"VC" tags appear on their shirts. */
function refreshLeaders(m) {
  syncLeaders(m);
  const picked = ALL_SLOTS.map((s) => ({ s, p: playerById(m.selection[s]) })).filter((x) => x.p);
  const seen = new Set();
  const options = picked.filter(({ p }) => !seen.has(p.id) && seen.add(p.id))
    .map(({ s, p }) => el('option', { value: p.id }, `#${s} ${p.name}`));
  for (const sel of $$('select[data-role]')) {
    sel.replaceChildren(el('option', { value: '' }, picked.length ? '— none —' : '— pick the team first —'), ...options.map((o) => o.cloneNode(true)));
    sel.value = m[sel.dataset.role] || '';
  }
  for (const row of $$('.slot[data-slot]')) {
    const badge = leaderBadge(m, m.selection[row.dataset.slot]);
    row.querySelector('.leader-tag')?.remove();
    if (badge) row.querySelector('.pos').append(el('span', { class: 'leader-tag', title: badge === 'C' ? 'Captain' : 'Vice-captain' }, badge));
  }
}

function renderCoachToggles(m) {
  const box = $('#m-coaches');
  const coaches = [...state.coaches].sort(compareCoaches);
  box.replaceChildren(...coaches.map((c) => el('label', {},
    el('input', { type: 'checkbox', value: c.id, checked: m.coaches.includes(c.id), dataset: { coach: c.id } }),
    `${c.name}${c.role ? ` · ${c.role}` : ''}`)));
  if (!coaches.length) box.append(el('span', { class: 'muted small' }, 'Add coaches on the Squad tab.'));
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
  if (m.opponentLogo) photoUrl(m.opponentLogo).then((u) => { logo.src = u || ''; logo.hidden = !u; });

  const starterGroups = VIDEO_TEMPLATE.groups.filter((g) => g.slots && g.slots.every((s) => STARTER_SLOTS.includes(s)));
  $('#starters').replaceChildren(...starterGroups.map((g) => el('div', { class: 'slot-group' },
    el('h3', {}, g.title), ...[...g.slots].sort((a, b) => a - b).map(slotRow))));
  $('#bench').replaceChildren(el('div', { class: 'slot-group wide' }, ...BENCH_SLOTS.map(slotRow)));
  if (!state.players.length) {
    $('#starters').prepend(el('p', { class: 'warning' }, 'Your squad is empty. Add players on the Squad tab first.'));
  }
  renderCoachToggles(m);
  refreshSelection(m);
  if (!$('#save-status').dataset.state) setSaveStatus('idle');
  setBenchNote(null);
}

const touched = new Set();
function touchedErrors(m) {
  const errors = validateMatch(m);
  return Object.fromEntries(Object.entries(errors).filter(([k]) => touched.has(k)));
}

let saveTimer = 0;
let pendingSave = null;

const SAVE_TEXT = {
  idle: 'Changes save automatically',
  saving: 'Saving…',
  saved: '✓ Saved on this device',
  error: 'Not saved',
};
function setSaveStatus(state) {
  const node = $('#save-status');
  node.dataset.state = state;
  node.textContent = SAVE_TEXT[state];
}

function scheduleMatchSave(m) {
  m.updatedAt = new Date().toISOString();
  setSaveStatus('saving');
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
    setSaveStatus('saved');
  } catch (e) {
    setSaveStatus('error');
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

/** Close gaps on the bench so replacements run 16, 17, 18... and say where a pick went. */
function packReplacements(m, changedSlot) {
  const id = m.selection[changedSlot];
  m.selection = packBench(m.selection);
  const now = id ? BENCH_SLOTS.find((s) => m.selection[s] === id) : null;
  setBenchNote(now && now !== changedSlot ? `${playerById(id)?.name || 'Player'} moved to ${now}: replacements fill from 16 up.` : null);
}

function setBenchNote(moved) {
  const note = $('#bench-note');
  note.classList.toggle('moved', !!moved);
  note.textContent = moved || 'Replacements fill from 16 up: pick into any bench shirt and gaps close automatically.';
}

function autoPickActive() {
  const m = activeMatch();
  if (!m) return;
  if (!state.players.length) { toast('Add players on the Squad tab first.'); return; }
  const { selection, added, empty } = autoPick(m.selection, state.players);
  m.selection = selection;
  refreshSelection(m);
  scheduleMatchSave(m);
  const gaps = empty.length ? ` Shirt${empty.length === 1 ? '' : 's'} ${empty.join(', ')} left empty: nobody plays there.` : '';
  toast(added ? `Picked ${added} player${added === 1 ? '' : 's'}.${gaps}` : `No empty shirts to fill.${gaps}`, { type: added ? 'success' : 'info', timeout: 6000 });
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
    if (!m) return;
    if (e.target.matches('select[data-slot]')) {
      const slot = Number(e.target.dataset.slot);
      m.selection[slot] = e.target.value || null;
      if (BENCH_SLOTS.includes(slot)) packReplacements(m, slot);
    } else if (e.target.matches('select[data-role]')) {
      // One captain, one vice-captain, never the same player.
      setLeader(m, e.target.dataset.role, e.target.value || null);
    } else if (e.target.matches('input[data-coach]')) {
      const id = e.target.dataset.coach;
      m.coaches = e.target.checked ? [...new Set([...m.coaches, id])] : m.coaches.filter((x) => x !== id);
      // Keep the squad's coach order rather than tick order.
      const order = [...state.coaches].sort(compareCoaches).map((c) => c.id);
      m.coaches.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    } else return;
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
  $('#auto-pick').addEventListener('click', autoPickActive);
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

// Role order (Head coach first) for the team sheet and video, whatever order the match saved.
const onDuty = (m) => m.coaches.map(coachById).filter(Boolean).sort(compareCoaches);

async function buildRenderData(m) {
  const coaches = [];
  for (const c of onDuty(m)) {
    const img = await photoImage(state.store, c.photo);
    coaches.push({ coach: c, photo: img ? { img, crop: c.crop } : null });
  }
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
    coaches,
    coachById: Object.fromEntries(coaches.map((c) => [c.coach.id, c])),
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
  setupShare($('#sheet-share'), blob, filename, `SFV vs ${m.opponent || 'TBC'}`);
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
  setNote($('#video-note'), m);
  if (CLIP_SECONDS) $('#video-note').append(el('span', { class: 'note-line' }, `Test mode (?clip=${CLIP_SECONDS}): exports only the first ${CLIP_SECONDS} s.`));
  $('#video-export').disabled = !m;
  $('#video-play').disabled = !m;
  const canvas = $('#video-canvas');
  if (!m) { canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); state.video = null; return; }
  const id = ++videoBuildId;
  const data = await buildRenderData(m);
  if (id !== videoBuildId) return;
  const template = videoTemplate();
  const timeline = buildTimeline(template, { speed: state.settings.speed, selection: m.selection, coaches: onDuty(m).map((c) => c.id) });
  const renderer = createVideoRenderer(data, timeline, template);
  const clipped = CLIP_SECONDS > 0 && CLIP_SECONDS < timeline.duration;
  $('#video-length').textContent = clipped
    ? `Length ${fmtTime(CLIP_SECONDS)} (test clip)`
    : `Length ${fmtTime(timeline.duration)} · ${timeline.segments.filter((s) => s.type === 'group').length} groups`;
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
  if (v.player.playing) { v.player.pause(); $('#video-play').textContent = '▶ Preview'; return; }
  v.player.play();
  $('#video-play').textContent = '❚❚ Pause';
  // Bring the player into view if it has scrolled off (the controls sit above it on phones).
  const r = $('#video-canvas').getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight) $('#video-preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    setupShare($('#video-share'), result.blob, filename, `SFV vs ${m.opponent || 'TBC'}`);
    $('#video-format').textContent = result.ext === 'mp4'
      ? `MP4 · ${(result.blob.size / 1e6).toFixed(1)} MB · ready for Instagram.`
      : `WebM · ${(result.blob.size / 1e6).toFixed(1)} MB. This browser can't record MP4; Instagram may need it converted. Chrome 126+ and Safari record MP4.`;
    $('#video-result').hidden = false;
    scrollToResult(out);
    link.focus({ preventScroll: true });
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

/**
 * Bring the finished video and its Download button on screen. Waits for the video's
 * metadata first: until then the player has no height, and scrolling early leaves its
 * bottom and the button below the fold once it grows.
 */
function scrollToResult(video) {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    requestAnimationFrame(() => {
      const box = $('#video-result');
      const tabs = $('.tabs').getBoundingClientRect().bottom;
      // If it all fits under the sticky tabs, line up its bottom; otherwise its top.
      const fits = box.getBoundingClientRect().height + tabs <= innerHeight;
      box.scrollIntoView({ behavior: 'smooth', block: fits ? 'end' : 'start' });
    });
  };
  if (video.readyState >= 1) { go(); return; }
  video.addEventListener('loadedmetadata', go, { once: true });
  video.addEventListener('error', go, { once: true });
  setTimeout(go, 3000); // don't leave the result off screen if neither event comes
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
  const [players, coaches, matches, settings] = await Promise.all([
    state.store.getAll('players'),
    state.store.getAll('coaches'),
    state.store.getAll('matches'),
    state.store.get('settings', 'settings'),
  ]);
  state.players = players.map(normalizePlayer);
  state.coaches = coaches.map(normalizeCoach);
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
  $('#add-coach').addEventListener('click', () => openCoachForm());
  $('#squad-search').addEventListener('input', renderSquad);
  $('#units').value = state.settings.units;
  $('#units').addEventListener('change', async (e) => { state.settings.units = e.target.value; await saveSettings(); renderSquad(); });
  const styleSel = $('#photo-style');
  styleSel.replaceChildren(...PHOTO_STYLES.map((s) => el('option', { value: s.value }, s.label)));
  styleSel.value = state.settings.photoStyle;
  styleSel.addEventListener('change', () => {
    state.settings.photoStyle = styleSel.value;
    repaintCardPhotos(); // straight away, before the save
    saveSettings();
  });
  $('#backup').addEventListener('click', backupSquad);
  $('#start-over').addEventListener('click', startOver);
  $('#import-sheet').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importSheet(f); });
  $('#import-template').addEventListener('click', downloadTemplate);
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
  renderCoaches();
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
