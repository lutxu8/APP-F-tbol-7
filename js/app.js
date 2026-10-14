import {
  ROLES, ROLE_NAMES, ROLE_LINE, FORMATIONS, fitFor, optimizeLineup, planMatch, planMatchRefined, chooseSchedule, intervalPoints, pointKey, proposeSquad, recommendReplacement, adjustSchedule, positionWarnings, seasonStats, diffLineups,
} from './logic.js';
import { load, save, exportJSON, importJSON, uid } from './store.js';

let db = load();
const ui = { tab: 'match', sel: null, injured: false, modal: null, setupStep: 1, alerted: new Set(), plan: null, next: null };

const $app = document.getElementById('app');
const $modal = document.getElementById('modal-root');

// ---------- utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
function mmss(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
const mins = (sec) => `${Math.round(sec / 60)}'`;
const today = () => new Date().toISOString().slice(0, 10);
let dataVersion = 0;
const persist = () => { dataVersion++; save(db); };
const playerById = (id) => db.players.find((p) => p.id === id);
const nameOf = (id) => playerById(id)?.name ?? '—';
const numOf = (id) => playerById(id)?.number ?? '';
const slotsOf = (formation) => FORMATIONS[formation].slots;
const slotLabel = (formation, slotId) => slotsOf(formation).find((s) => s.id === slotId)?.label ?? slotId;
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function sortPlayers(list) {
  return [...list].sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999) || a.name.localeCompare(b.name));
}
function seasonOf() {
  return seasonStats(db.players, db.matches);
}
function posChips(positions) {
  return ROLES.filter((r) => (positions || []).includes(r)).map((r) => `<span class="chip chip-${ROLE_LINE[r]}" title="${ROLE_NAMES[r]}">${r}</span>`).join('');
}

// ---------- sonido, vibración y pantalla encendida ----------
// Sonido de la alarma. En iOS el audio de una página solo se activa con un toque
// del usuario, y el audio web (AudioContext) puede quedarse mudo con el modo
// silencio o si Safari lo duerme, aunque diga que está funcionando. Por eso el
// pitido principal es un <audio> normal (como un vídeo: suena aunque el iPhone
// esté en silencio), que se desbloquea con el primer toque y después se puede
// reproducir cuando haga falta. El audio web queda solo como respaldo.
let audioCtx = null;
let beepEl = null;
let beepElReady = false;

function beepWavUrl() {
  // Tres pitidos (880/660/880 Hz) en un WAV generado al vuelo.
  const rate = 22050;
  const tones = [880, 660, 880];
  const beepLen = Math.round(rate * 0.25);
  const gap = Math.round(rate * 0.1);
  const n = tones.length * (beepLen + gap);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  let o = 44;
  tones.forEach((f) => {
    for (let i = 0; i < beepLen; i++) {
      const env = Math.min(1, i / 200, (beepLen - i) / 200);
      v.setInt16(o, Math.sign(Math.sin((2 * Math.PI * f * i) / rate)) * 9000 * env, true);
      o += 2;
    }
    o += gap * 2;
  });
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function ensureAudio() {
  // 1) <audio> principal: se reproduce en silencio dentro del toque para desbloquearlo.
  try {
    if (!beepEl) {
      beepEl = new Audio(beepWavUrl());
      beepEl.preload = 'auto';
      beepEl.setAttribute('playsinline', '');
    }
    if (!beepElReady) {
      beepEl.muted = true;
      const pr = beepEl.play();
      const done = () => { beepEl.pause(); beepEl.currentTime = 0; beepEl.muted = false; beepElReady = true; refreshSoundHint(); };
      if (pr) pr.then(done).catch(() => { beepEl.muted = false; });
      else done();
    }
  } catch (e) { /* sin audio */ }
  // 2) Audio web de respaldo.
  try {
    if (!audioCtx || audioCtx.state === 'closed') audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  } catch (e) { /* sin audio */ }
}

function webBeep(times) {
  if (!audioCtx) return false;
  if (audioCtx.state !== 'running') { audioCtx.resume().catch(() => {}); return false; }
  const t0 = audioCtx.currentTime;
  for (let i = 0; i < times; i++) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.value = i % 2 ? 660 : 880;
    g.gain.setValueAtTime(0.0001, t0 + i * 0.35);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.35 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 0.25);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0 + i * 0.35);
    o.stop(t0 + i * 0.35 + 0.3);
  }
  return true;
}

function beep(times = 3) {
  try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch (e) { /* */ }
  if (beepEl && beepElReady) {
    try {
      beepEl.muted = false;
      beepEl.currentTime = 0;
      const pr = beepEl.play();
      if (pr) pr.catch(() => { beepElReady = false; webBeep(times); refreshSoundHint(); });
      return;
    } catch (e) { beepElReady = false; }
  }
  webBeep(times);
}

/** ¿Está el sonido listo? Si no, durante el partido se pide un toque para activarlo. */
function soundReady() {
  return beepElReady || (audioCtx && audioCtx.state === 'running');
}
function refreshSoundHint() {
  const el = document.getElementById('sound-hint');
  if (el) el.hidden = soundReady();
}

// Cualquier toque activa el sonido (iOS solo lo permite dentro de un gesto).
['pointerdown', 'touchend', 'click'].forEach((ev) => document.addEventListener(ev, () => ensureAudio(), { capture: true, passive: true }));

let wakeLock = null;
async function syncWakeLock() {
  const want = db.live && db.live.phase !== 'end' && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) { wakeLock = null; }
}

// ---------- reloj y minutos del partido en curso ----------
function clockNow(L = db.live) {
  return L.elapsed + (L.running ? (Date.now() - L.anchorTs) / 1000 : 0);
}
function halfSecNow(L = db.live) {
  if (L.phase === 'h1') return clockNow(L) - L.halfStart[1];
  if (L.phase === 'h2') return clockNow(L) - L.halfStart[2];
  return 0;
}
function onField(L, pid) {
  return Object.values(L.lineup).includes(pid);
}
function playedNow(L, pid) {
  const base = L.acc[pid] || 0;
  if (L.enteredAt[pid] != null && onField(L, pid)) return base + (clockNow(L) - L.enteredAt[pid]);
  return base;
}
function availablePlayers(L) {
  return L.squad
    .filter((id) => !L.unavailable.includes(id) && playerById(id))
    .map((id) => ({
      id,
      positions: playerById(id).positions || [],
      played: playedNow(L, id),
      // Tiempo en el campo desde que entró (para no quitar a quien lleva menos de 5').
      stint: L.phase !== 'pre' && onField(L, id) && L.enteredAt[id] != null ? clockNow(L) - L.enteredAt[id] : null,
    }));
}
function planBase(L) {
  return {
    slots: slotsOf(L.formation),
    players: availablePlayers(L),
    lineup: L.lineup,
    phase: L.phase,
    halfSec: halfSecNow(L),
    halfLen: L.halfLen,
    handled: new Set(L.handled),
    gkHalftimeOnly: L.gkHalftimeOnly,
    // La primera remesa fijada por el usuario siempre tiene cambios.
    mustChange: L.freq === 'auto' && L.firstChange && L.firstChange < L.halfLen ? [pointKey({ h: 1, t: L.firstChange })] : [],
  };
}
function recomputeSchedule(L) {
  L.locked = null; // el próximo cambio se vuelve a anunciar con el plan nuevo
  const base = planBase(L);
  if (L.freq === 'auto') {
    const best = chooseSchedule(base, { firstSec: L.firstChange || null, current: L.phase === 'pre' ? null : L.points });
    L.points = best.points;
    L.handled = best.handledPast;
  } else {
    L.points = intervalPoints(L.halfLen, Number(L.freq));
    const curH = L.phase === 'h2' || L.phase === 'break' ? 2 : 1;
    const t = base.halfSec;
    const handled = new Set(L.handled);
    if (L.phase !== 'pre') for (const p of L.points) if (p.h < curH || (p.h === curH && p.t <= t && !(p.h === 2 && p.t === 0))) handled.add(pointKey(p));
    L.handled = [...handled];
    if (L.freqAdjust !== false) L.points = adjustSchedule({ ...base, handled }, L.points);
  }
}
// El plan afinado es costoso: se guarda unos segundos y se rehace si cambia algo
// o si llega el momento del siguiente cambio.
let planCache = null;
function computePlan() {
  const L = db.live;
  if (!L) return null;
  const now = Date.now();
  if (planCache && planCache.live === L && planCache.ver === dataVersion && now - planCache.ts < 5000
    && !(planCache.next && !planCache.next.due && secondsUntil(planCache.next, L) <= 0)) {
    ui.plan = planCache.plan;
    ui.next = planCache.next;
    return ui.plan;
  }
  const forcedOf = () => (L.locked ? { [L.locked.key]: L.locked.after } : {});
  const run = () => planMatchRefined({ ...planBase(L), points: L.points, forced: forcedOf() });
  let plan = run();
  // Un cambio pendiente que no cambia nada se da por hecho.
  let guard = 0;
  while (plan.changes[0]?.due && !plan.changes[0].subs.length && !plan.changes[0].moves.length && plan.changes[0].keys.length && guard++ < 5) {
    L.handled.push(...plan.changes[0].keys);
    persist();
    plan = run();
  }
  const isLocked = (c) => L.locked && (c.key === L.locked.key || c.keys.includes(L.locked.key));
  let next = L.locked ? plan.changes.find(isLocked) : null;
  // El cambio fijado ya no es posible (p. ej. alguien no disponible): se anuncia otro.
  if (L.locked && (!next || !next.subs.length && !next.moves.length || L.phase === 'end')) { L.locked = null; next = null; }
  if (!L.locked && L.phase !== 'end') {
    next = plan.changes.find((c) => c.subs.length || c.moves.length) || null;
    if (next) {
      // Se fija el próximo cambio: el aviso será exactamente este. Los momentos
      // anteriores sin cambios se descartan para que no salten avisos distintos.
      for (const c of plan.changes) {
        if (c === next) break;
        for (const k of c.keys) if (!L.handled.includes(k)) L.handled.push(k);
      }
      L.locked = { key: next.key, half: next.half, t: next.t, after: { ...next.after } };
      persist();
      plan = run();
      next = plan.changes.find(isLocked) || next;
    }
  }
  ui.plan = plan;
  ui.next = next;
  planCache = { live: L, ver: dataVersion, ts: now, plan, next: ui.next };
  return plan;
}
function secondsUntil(change, L = db.live) {
  const halfSec = halfSecNow(L);
  const curH = L.phase === 'h2' || L.phase === 'break' ? 2 : 1;
  if (L.phase === 'pre') return (change.half - 1) * L.halfLen + change.t;
  if (change.half === curH) return change.t - halfSec;
  return Math.max(0, L.halfLen - halfSec) + change.t;
}
function snapshot(L) {
  const snap = JSON.stringify({ lineup: L.lineup, acc: L.acc, enteredAt: L.enteredAt, handled: L.handled, log: L.log, unavailable: L.unavailable });
  L.undo = [...(L.undo || []).slice(-9), snap];
}

// ---------- acciones del partido ----------
function startMatchFromSetup() {
  const S = db.setup;
  const squad = S.squad.filter((id) => playerById(id));
  if (squad.length < 7 && !confirm(`Solo hay ${squad.length} convocados (se necesitan 7). ¿Seguir igualmente?`)) return;
  const halfLen = Math.round((db.settings.halfMinutes || 25) * 60);
  const L = {
    id: uid(),
    date: S.date || today(),
    rival: S.rival || '',
    formation: S.formation,
    freq: S.freq,
    freqAdjust: S.freqAdjust !== false,
    firstChange: S.firstChange === undefined ? 480 : S.firstChange,
    gkHalftimeOnly: S.gkHalftimeOnly,
    halfLen,
    squad,
    unavailable: [],
    phase: 'pre',
    elapsed: 0,
    running: false,
    anchorTs: 0,
    halfStart: { 1: 0, 2: null },
    lineup: {},
    acc: Object.fromEntries(squad.map((id) => [id, 0])),
    enteredAt: {},
    handled: [],
    points: [],
    log: [],
    goalsFor: 0,
    goalsAgainst: 0,
    undo: [],
  };
  L.lineup = optimizeLineup({
    slots: slotsOf(L.formation),
    players: squad.map((id, i) => ({ id, positions: playerById(id).positions || [], played: 0, tie: i })),
    gkCommitMin: halfLen / 60,
  });
  recomputeSchedule(L);
  db.live = L;
  ui.sel = null;
  persist();
  render();
}

function relineup() {
  const L = db.live;
  L.lineup = optimizeLineup({
    slots: slotsOf(L.formation),
    players: availablePlayers(L).map((p, i) => ({ ...p, tie: i })),
    gkCommitMin: L.halfLen / 60,
  });
  recomputeSchedule(L);
  persist();
  render();
}

function startHalf(h) {
  const L = db.live;
  ensureAudio();
  if (h === 1) {
    if (Object.values(L.lineup).filter(Boolean).length < 7 && !confirm('Hay puestos vacíos en el once. ¿Empezar igualmente?')) return;
    L.phase = 'h1';
    L.elapsed = 0;
    L.halfStart[1] = 0;
    for (const pid of Object.values(L.lineup)) if (pid) L.enteredAt[pid] = 0;
  } else {
    L.phase = 'h2';
    L.halfStart[2] = L.elapsed;
    // No se replanifica al empezar la 2ª parte si ya hay un cambio anunciado.
    if (L.freq === 'auto' && !L.locked) recomputeSchedule(L);
  }
  L.running = true;
  L.anchorTs = Date.now();
  persist();
  syncWakeLock();
  render();
}

function pauseResume() {
  const L = db.live;
  ensureAudio();
  if (L.running) {
    L.elapsed = clockNow(L);
    L.running = false;
  } else {
    L.running = true;
    L.anchorTs = Date.now();
  }
  persist();
  render();
}

function endHalf() {
  const L = db.live;
  if (L.phase === 'h1') {
    if (!confirm('¿Terminar la 1ª parte?')) return;
    L.elapsed = clockNow(L);
    L.running = false;
    L.phase = 'break';
    for (const p of L.points) if (p.h === 1 && !L.handled.includes(pointKey(p))) L.handled.push(pointKey(p));
  } else if (L.phase === 'h2') {
    if (!confirm('¿Terminar el partido? Se guardarán los minutos de cada jugador.')) return;
    L.elapsed = clockNow(L);
    L.running = false;
    for (const pid of Object.values(L.lineup)) {
      if (pid && L.enteredAt[pid] != null) L.acc[pid] = (L.acc[pid] || 0) + (L.elapsed - L.enteredAt[pid]);
    }
    L.enteredAt = {};
    L.phase = 'end';
    saveMatchToHistory(L);
  }
  persist();
  syncWakeLock();
  render();
}

function saveMatchToHistory(L) {
  const record = {
    id: L.id,
    date: L.date,
    rival: L.rival,
    formation: L.formation,
    goalsFor: L.goalsFor,
    goalsAgainst: L.goalsAgainst,
    players: L.squad.map((id) => ({ id, name: nameOf(id), seconds: Math.round(L.acc[id] || 0) })),
    log: L.log,
  };
  db.matches = [...db.matches.filter((m) => m.id !== record.id), record];
}

function substitute(L, outId, inId, slotId, c) {
  if (outId) {
    if (L.enteredAt[outId] != null) L.acc[outId] = (L.acc[outId] || 0) + (c - L.enteredAt[outId]);
    delete L.enteredAt[outId];
  }
  if (inId && L.phase !== 'pre') L.enteredAt[inId] = c;
  L.lineup[slotId] = inId;
}

/** Aplica una alineación nueva (cambios sugeridos). */
function applyLineup(after, keys, { injuredId = null, manual = false } = {}) {
  const L = db.live;
  snapshot(L);
  if (injuredId && !L.unavailable.includes(injuredId)) L.unavailable.push(injuredId);
  const c = clockNow(L);
  const before = { ...L.lineup };
  const { subs, moves } = diffLineups(before, after);
  const live = L.phase === 'h1' || L.phase === 'h2' || L.phase === 'break';
  for (const pid of Object.values(before)) {
    if (pid && !Object.values(after).includes(pid) && live) {
      if (L.enteredAt[pid] != null) L.acc[pid] = (L.acc[pid] || 0) + (c - L.enteredAt[pid]);
      delete L.enteredAt[pid];
    }
  }
  for (const pid of Object.values(after)) {
    if (pid && !Object.values(before).includes(pid) && live) L.enteredAt[pid] = c;
  }
  L.lineup = { ...after };
  L.handled.push(...keys);
  L.locked = null;
  const half = L.phase === 'h2' || L.phase === 'break' ? 2 : 1;
  for (const s of subs) L.log.push({ half, t: Math.round(halfSecNow(L)), in: s.in, out: s.out, slot: s.slotId, ...(manual ? { manual } : {}), ...(s.out === injuredId ? { injured: true } : {}) });
  for (const m of moves) L.log.push({ half, t: Math.round(halfSecNow(L)), move: m.pid, from: m.from, to: m.to });
  // Con alguien menos o un cambio fuera de plan, se reorganiza el resto del partido.
  // En automático se replanifica tras cada remesa, con los minutos reales (p. ej. si se cambió tarde).
  if (injuredId || manual || L.freq === 'auto') recomputeSchedule(L);
  ui.sel = null;
  ui.injured = false;
  persist();
  render();
}

function tapPlayer(kind, id) {
  const L = db.live;
  if (!L || L.phase === 'end') return;
  const sel = ui.sel;
  if (!sel) { ui.sel = { kind, id }; render(); return; }
  if (sel.kind === kind && sel.id === id) { ui.sel = null; render(); return; }
  if (sel.kind === 'bench' && kind === 'bench') { ui.sel = { kind, id }; render(); return; }
  L.locked = null; // un cambio a mano obliga a anunciar de nuevo el siguiente
  if (L.phase !== 'pre' && sel.kind !== kind) {
    const slotId = sel.kind === 'slot' ? sel.id : id;
    const benchId = sel.kind === 'bench' ? sel.id : id;
    const outId = L.lineup[slotId];
    applyLineup({ ...L.lineup, [slotId]: benchId }, [], { injuredId: ui.injured ? outId : null, manual: true });
    return;
  }
  snapshot(L);
  const c = clockNow(L);
  const half = L.phase === 'h2' || L.phase === 'break' ? 2 : 1;
  const t = Math.round(halfSecNow(L));
  if (sel.kind === 'slot' && kind === 'slot') {
    const a = L.lineup[sel.id];
    const b = L.lineup[id];
    L.lineup[sel.id] = b;
    L.lineup[id] = a;
    if (a) L.log.push({ half, t, move: a, from: sel.id, to: id });
    if (b) L.log.push({ half, t, move: b, from: id, to: sel.id });
  } else {
    const slotId = sel.kind === 'slot' ? sel.id : id;
    const benchId = sel.kind === 'bench' ? sel.id : id;
    const outId = L.lineup[slotId];
    substitute(L, outId, benchId, slotId, c);
    if (L.phase !== 'pre') L.log.push({ half, t, in: benchId, out: outId, slot: slotId, manual: true });
  }
  ui.sel = null;
  if (L.phase === 'pre') recomputeSchedule(L);
  persist();
  render();
}

function toggleUnavailable(pid) {
  const L = db.live;
  snapshot(L);
  if (L.unavailable.includes(pid)) {
    L.unavailable = L.unavailable.filter((x) => x !== pid);
  } else {
    if (!confirm(`¿Marcar a ${nameOf(pid)} como no disponible (lesión, se ha ido...)?`)) { L.undo.pop(); return; }
    const slotId = Object.keys(L.lineup).find((s) => L.lineup[s] === pid);
    if (slotId) substitute(L, pid, null, slotId, clockNow(L));
    L.unavailable.push(pid);
  }
  recomputeSchedule(L);
  ui.sel = null;
  persist();
  render();
}

function undo() {
  const L = db.live;
  const snap = L.undo?.pop();
  if (!snap) return;
  Object.assign(L, JSON.parse(snap));
  L.locked = null;
  ui.sel = null;
  persist();
  render();
}

let alarmOn = false;

// ---------- vistas ----------
function render() {
  // La alarma se enciende/apaga al momento (p. ej. nada más pulsar «Hacer cambios»).
  if (typeof alarmDue === 'function') {
    alarmOn = alarmDue();
    document.body.classList.toggle('alarm', alarmOn);
  }
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  document.getElementById('team-name').textContent = db.settings.teamName || 'Fútbol 7';
  let html = '';
  if (ui.tab === 'match') html = db.live ? viewLive() : viewSetup();
  else if (ui.tab === 'squad') html = viewSquad();
  else if (ui.tab === 'stats') html = viewStats();
  else html = viewSettings();
  if (alarmOn && ui.tab !== 'match') {
    html = `<button class="alarm-bar" data-action="tab" data-tab="match">🔔 ¡Toca cambio! Toca aquí para ir al partido</button>` + html;
  }
  $app.innerHTML = html;
  renderModal();
}

function viewSetup() {
  if (!db.players.length) {
    return `<section class="card empty">
      <h2>Empieza creando la plantilla</h2>
      <p>Añade a los jugadores del equipo y las posiciones en las que puede jugar cada uno.</p>
      <button class="btn primary" data-action="tab" data-tab="squad">Ir a la plantilla</button>
    </section>`;
  }
  const S = (db.setup ||= {
    date: today(), rival: '', available: db.players.filter((p) => p.active !== false).map((p) => p.id), squad: [], formation: '3-2-1', freq: 'auto', gkHalftimeOnly: true,
  });
  const st = seasonOf();
  const max = db.settings.maxSquad;
  if (ui.setupStep === 1) {
    const rows = sortPlayers(db.players).map((p) => {
      const on = S.available.includes(p.id);
      return `<label class="row check ${on ? 'on' : ''}">
        <input type="checkbox" data-action="toggle-available" data-id="${p.id}" ${on ? 'checked' : ''}>
        <span class="num">${esc(p.number)}</span>
        <span class="grow"><b>${esc(p.name)}</b><br>${posChips(p.positions)}</span>
        <span class="muted small">${mins(st[p.id]?.seconds || 0)} · ${st[p.id]?.played || 0} PJ</span>
      </label>`;
    }).join('');
    return `<section class="card">
      <h2>Nuevo partido · 1/2</h2>
      <p class="muted">¿Quién puede venir? Marca a los disponibles.</p>
      <div class="grid2">
        <label>Rival<input type="text" data-bind="setup.rival" value="${esc(S.rival)}" placeholder="Nombre del rival"></label>
        <label>Fecha<input type="date" data-bind="setup.date" value="${esc(S.date)}"></label>
      </div>
      <div class="toolbar"><button class="btn small" data-action="avail-all">Todos</button><button class="btn small" data-action="avail-none">Ninguno</button>
      <span class="muted">${S.available.length} disponibles · máx. ${max} convocados</span></div>
      <div class="list">${rows}</div>
      <button class="btn primary block" data-action="setup-next" ${S.available.length ? '' : 'disabled'}>Siguiente: convocatoria</button>
    </section>`;
  }
  // Paso 2
  const avail = S.available.filter((id) => playerById(id));
  const excess = avail.length > max;
  const rows = [...avail]
    .map((id) => playerById(id))
    .sort((a, b) => (st[a.id]?.seconds || 0) - (st[b.id]?.seconds || 0) || a.name.localeCompare(b.name))
    .map((p) => {
      const on = S.squad.includes(p.id);
      return `<label class="row check ${on ? 'on' : 'off'}">
        <input type="checkbox" data-action="toggle-squad" data-id="${p.id}" ${on ? 'checked' : ''}>
        <span class="num">${esc(p.number)}</span>
        <span class="grow"><b>${esc(p.name)}</b><br>${posChips(p.positions)}</span>
        <span class="muted small">${mins(st[p.id]?.seconds || 0)} · ${st[p.id]?.played || 0} PJ</span>
      </label>`;
    }).join('');
  const squadPlayers = S.squad.map(playerById).filter(Boolean);
  const warnings = [];
  if (S.squad.length > max) warnings.push(`Has convocado a ${S.squad.length} y el máximo es ${max}.`);
  if (S.squad.length < 7) warnings.push(`Solo hay ${S.squad.length} convocados: hacen falta 7.`);
  if (!squadPlayers.some((p) => (p.positions || []).includes('POR'))) warnings.push('No hay ningún portero en la convocatoria.');
  warnings.push(...positionWarningTexts(S.formation, squadPlayers));
  const formOpts = Object.entries(FORMATIONS).map(([k, f]) => `<button class="seg ${S.formation === k ? 'on' : ''}" data-action="set-formation" data-f="${k}">${f.name}</button>`).join('');
  return `<section class="card">
    <h2>Nuevo partido · 2/2</h2>
    ${excess ? `<p class="note">Hay <b>${avail.length}</b> disponibles y caben <b>${max}</b>. Entran primero los que <b>menos minutos</b> llevan en la temporada (puedes ajustarlo a mano).</p>` : '<p class="muted">Convocatoria</p>'}
    <div class="list">${rows}</div>
    <p class="muted small">Convocados: <b>${S.squad.length}</b> / ${max}</p>
    ${warnings.map((w) => `<p class="warn">⚠️ ${w}</p>`).join('')}
    <h3>Sistema</h3>
    <div class="segmented">${formOpts}</div>
    <h3>Cambios</h3>
    ${freqControl('setup', S.freq, Math.round((db.settings.halfMinutes || 25) * 60), S.freqAdjust !== false, null, S.firstChange === undefined ? 480 : S.firstChange)}
    <label class="switch"><input type="checkbox" data-bind="setup.gkHalftimeOnly" ${S.gkHalftimeOnly ? 'checked' : ''}> El portero solo cambia en el descanso</label>
    <div class="toolbar">
      <button class="btn" data-action="setup-back">← Atrás</button>
      <button class="btn primary grow" data-action="setup-create" ${S.squad.length ? '' : 'disabled'}>Ver alineación →</button>
    </div>
  </section>`;
}

const fmtMin = (sec) => String(Math.round((sec / 60) * 100) / 100).replace('.', ',');

const joinY = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}` : xs[0]);

/** Avisos de posiciones con pocos jugadores para el sistema elegido. */
function positionWarningTexts(formation, players) {
  return positionWarnings(slotsOf(formation), players, db.settings.halfMinutes || 25).map((w) => (w.count
    ? `Solo ${w.count === 1 ? 'hay 1 jugador' : `hay ${w.count} jugadores`} para ${w.label} (${esc(joinY(w.names))}): ${w.count === 1 ? 'jugará' : 'jugarán'} más minutos que el resto. Marca a más jugadores en esa posición o cambia de sistema.`
    : `Nadie puede jugar de ${w.label}: lo cubrirá alguien de otra posición.`));
}

/** Selector de cada cuántos minutos se hacen los cambios. */
function freqControl(scope, freq, halfLen, adjust = true, points = null, first = null) {
  const fixed = freq !== 'auto';
  let detail;
  if (points && (adjust || !fixed)) {
    // Ya hay plan: se muestran los minutos reales (con el ajuste aplicado).
    const half = (h) => points.filter((p) => p.h === h && !(h === 2 && p.t === 0)).map((p) => mmss(p.t));
    const h1 = half(1);
    const h2 = half(2);
    detail = `Cambios en el min ${h1.length ? joinY(h1) : '—'} de la 1ª parte, ${fixed ? 'en el descanso' : 'en el descanso si hace falta'} y en el min ${h2.length ? joinY(h2) : '—'} de la 2ª.`;
  } else if (fixed) {
    const pts = intervalPoints(halfLen, Number(freq)).filter((p) => p.h === 1).map((p) => fmtMin(p.t));
    detail = pts.length ? `Cambios en el min ${joinY(pts)} de cada parte, y en el descanso.` : 'Solo habrá cambios en el descanso.';
    if (adjust && pts.length) detail += ' Alguno puede moverse hasta 3 min para que todos jueguen lo mismo.';
  } else if (first) {
    detail = `Primera remesa en el min ${fmtMin(first)}. Después la app decide cuándo cambiar para que todos jueguen lo mismo, sin quitar a nadie que lleve menos de 5 min en el campo.`;
  } else {
    detail = 'La app elige los momentos que dejan los minutos más iguales con el menor número de cambios.';
  }
  return `<div class="segmented">
      <button class="seg ${fixed ? '' : 'on'}" data-action="freq-mode" data-scope="${scope}" data-mode="auto">Automático</button>
      <button class="seg ${fixed ? 'on' : ''}" data-action="freq-mode" data-scope="${scope}" data-mode="fixed">Cada X minutos</button>
    </div>
    ${fixed ? `<div class="stepper">
      <button class="btn" data-action="freq-step" data-scope="${scope}" data-d="-1" aria-label="Menos minutos">−</button>
      <div class="stepper-val">Cada <b>${fmtMin(Number(freq))}</b> min</div>
      <button class="btn" data-action="freq-step" data-scope="${scope}" data-d="1" aria-label="Más minutos">+</button>
    </div>
    <label class="switch"><input type="checkbox" data-action="freq-adjust" data-scope="${scope}" ${adjust ? 'checked' : ''}> Ajustar algún cambio (±3 min) para igualar minutos</label>` : `
    <label class="switch"><input type="checkbox" data-action="freq-first" data-scope="${scope}" ${first ? 'checked' : ''}> Fijar el minuto de la primera remesa</label>
    ${first ? `<div class="stepper">
      <button class="btn" data-action="first-step" data-scope="${scope}" data-d="-1" aria-label="Antes">−</button>
      <div class="stepper-val">1ª remesa en el min <b>${fmtMin(first)}</b></div>
      <button class="btn" data-action="first-step" data-scope="${scope}" data-d="1" aria-label="Después">+</button>
    </div>` : ''}`}
    <p class="muted small">${detail}</p>`;
}

function setFirst(scope, value) {
  if (scope === 'setup') db.setup.firstChange = value;
  else { db.live.firstChange = value; recomputeSchedule(db.live); }
  persist();
  render();
}

function setFreq(scope, value) {
  if (scope === 'setup') {
    db.setup.freq = value;
  } else {
    db.live.freq = value;
    recomputeSchedule(db.live);
  }
  persist();
  render();
}

/** Hoja inferior para cambiar a un jugador concreto (lesión, cansancio...). */
function viewSubSheet(L) {
  const outId = L.lineup[ui.sel.id];
  const rec = recommendReplacement({
    slots: slotsOf(L.formation), players: availablePlayers(L), lineup: L.lineup, outId, lockGK: L.gkHalftimeOnly && L.phase !== 'break',
  });
  if (!rec) return '';
  const fitTxt = { yes: '', line: ' <span class="warn small">(misma línea)</span>', no: ' <span class="warn small">(fuera de posición)</span>' };
  const main = rec.subs.find((x) => x.out === outId);
  const recHtml = main?.in
    ? `<div class="rec">
        <div><span class="in">⬆ ${esc(nameOf(main.in))}</span> <span class="muted">(${slotLabel(L.formation, main.slotId)}) · ${mmss(playedNow(L, main.in))} jugados</span></div>
        ${rec.moves.map((m) => `<div class="muted small">↔ ${esc(nameOf(m.pid))}: ${slotLabel(L.formation, m.from)} → ${slotLabel(L.formation, m.to)}</div>`).join('')}
      </div>
      <button class="btn primary block" data-action="sub-recommended">✅ Hacer este cambio</button>`
    : '<p class="muted">No hay nadie disponible en el banquillo.</p>';
  const others = rec.options.filter((o) => o.id !== main?.in);
  return `<div class="sheet">
    <div class="sheet-head"><b>Cambiar a ${esc(nameOf(outId))}</b> <span class="muted small">${slotLabel(L.formation, rec.slotId)} · ${mmss(playedNow(L, outId))} jugados</span>
      <button class="mini" data-action="cancel-sel" aria-label="Cerrar">✕</button></div>
    <label class="switch"><input type="checkbox" data-action="toggle-injured" ${ui.injured ? 'checked' : ''}> Lesionado: no vuelve a jugar</label>
    <p class="label">Recomendado</p>
    ${recHtml}
    ${others.length ? `<p class="label">Otras opciones</p><div class="opts">${others.map((o) => `<button class="opt" data-action="sub-option" data-id="${o.id}">${esc(nameOf(o.id))} <span class="muted small">${mmss(o.played)}</span>${fitTxt[o.fit]}</button>`).join('')}</div>` : ''}
    <p class="muted small">También puedes tocar a otro jugador del campo para intercambiar sus posiciones. Después del cambio, el plan se reorganiza.</p>
  </div>`;
}

function changeText(L, c) {
  const items = [];
  for (const s of c.subs) {
    if (s.in && s.out) items.push(`<li><span class="in">⬆ ${esc(nameOf(s.in))}</span> <span class="muted">(${slotLabel(L.formation, s.slotId)})</span> <span class="out">⬇ ${esc(nameOf(s.out))}</span></li>`);
    else if (s.in) items.push(`<li><span class="in">⬆ ${esc(nameOf(s.in))}</span> <span class="muted">(${slotLabel(L.formation, s.slotId)})</span></li>`);
    else items.push(`<li><span class="out">⬇ ${esc(nameOf(s.out))}</span></li>`);
  }
  for (const m of c.moves) items.push(`<li class="muted">↔ ${esc(nameOf(m.pid))}: ${slotLabel(L.formation, m.from)} → ${slotLabel(L.formation, m.to)}</li>`);
  return `<ul class="changes">${items.join('')}</ul>`;
}

function whenText(L, c) {
  if (c.halftime) return 'En el descanso';
  return `${c.half === 1 ? '1ª' : '2ª'} parte · min ${mmss(c.t)}`;
}

function viewLive() {
  const L = db.live;
  const plan = computePlan();
  const next = ui.next;
  const slots = slotsOf(L.formation);
  const halfSec = halfSecNow(L);
  const phaseLabel = { pre: 'Previa', h1: '1ª parte', break: 'Descanso', h2: '2ª parte', end: 'Final' }[L.phase];
  const inNext = new Set(next?.subs.map((s) => s.in).filter(Boolean));
  const outNext = new Set(next?.subs.map((s) => s.out).filter(Boolean));

  // Marcador y reloj
  let controls = '';
  if (L.phase === 'pre') {
    controls = `<button class="btn primary big" data-action="start-half" data-h="1">▶ Empezar 1ª parte</button>`;
  } else if (L.phase === 'h1' || L.phase === 'h2') {
    controls = `<button class="btn ${L.running ? '' : 'primary'} big" data-action="pause">${L.running ? '⏸ Pausar' : '▶ Reanudar'}</button>
      <button class="btn danger" data-action="end-half">${L.phase === 'h1' ? 'Fin 1ª parte' : 'Fin del partido'}</button>`;
  } else if (L.phase === 'break') {
    controls = `<button class="btn primary big" data-action="start-half" data-h="2">▶ Empezar 2ª parte</button>`;
  } else {
    controls = `<button class="btn primary big" data-action="close-match">Cerrar partido</button>`;
  }
  const over = halfSec > L.halfLen && (L.phase === 'h1' || L.phase === 'h2');
  const score = `<div class="score">
      <div class="team"><span>${esc(db.settings.teamName || 'Nosotros')}</span>
        <div class="goals"><button class="mini" data-action="goal" data-side="for" data-d="-1">−</button><b>${L.goalsFor}</b><button class="mini" data-action="goal" data-side="for" data-d="1">+</button></div></div>
      <div class="team"><span>${esc(L.rival || 'Rival')}</span>
        <div class="goals"><button class="mini" data-action="goal" data-side="against" data-d="-1">−</button><b>${L.goalsAgainst}</b><button class="mini" data-action="goal" data-side="against" data-d="1">+</button></div></div>
    </div>`;
  const clock = `<section class="card clock-card ${L.running ? 'running' : ''}">
      <div class="phase">${phaseLabel} · ${FORMATIONS[L.formation].name}</div>
      <div class="clock ${over ? 'over' : ''}" id="clock">${clockText(L)}</div>
      ${over ? '<div class="warn center">Tiempo cumplido</div>' : ''}
      <div class="controls">${controls}</div>
      ${L.phase === 'end' ? '' : `<button id="sound-hint" class="sound-hint" data-action="test-sound" ${soundReady() ? 'hidden' : ''}>🔇 El sonido de los avisos está desactivado. Toca aquí para activarlo.</button>
      <button class="mini sound-test" data-action="test-sound">🔊 Probar sonido</button>`}
      ${score}
    </section>`;

  // Aviso de cambio
  let banner = '';
  if (L.phase === 'end') {
    banner = viewSummary(L);
  } else if (next) {
    const isDue = next.due && L.phase !== 'pre';
    const head = isDue
      ? (L.phase === 'break' ? '🔁 Cambios para la 2ª parte' : '🔔 ¡Toca cambio! <span class="small muted">La alarma sonará hasta que pulses «Hacer cambios».</span>')
      : `Próximo cambio <span id="countdown">${L.phase === 'pre' ? '' : 'en ' + mmss(secondsUntil(next))}</span> <span class="muted small">(${whenText(L, next)})</span>`;
    banner = `<section class="card banner ${isDue ? 'due' : ''}">
      <div class="banner-head">${head}</div>
      ${changeText(L, next)}
      ${isDue ? '' : '<p class="muted small">Este cambio queda fijado: será el que avise la alarma. Solo cambia si haces un cambio a mano o alguien deja de estar disponible.</p>'}
      ${L.phase === 'pre' ? '' : `<div class="toolbar">
        <button class="btn primary grow" data-action="apply-next">${isDue ? '✅ Hacer cambios' : 'Adelantar ahora'}</button>
        ${isDue ? '<button class="btn" data-action="skip-next">Omitir</button>' : ''}
      </div>`}
    </section>`;
  } else if (L.phase !== 'pre') {
    banner = `<section class="card banner"><div class="banner-head muted">No hay más cambios previstos.</div></section>`;
  }

  // Campo
  const pitch = `<section class="pitch-wrap">
    <div class="pitch">
      <div class="line half"></div><div class="circle"></div><div class="box top"></div><div class="box bottom"></div>
      ${slots.map((s) => {
        const pid = L.lineup[s.id];
        const sel = ui.sel?.kind === 'slot' && ui.sel.id === s.id;
        const p = pid && playerById(pid);
        const fit = p ? fitFor(p.positions, s) : 'yes';
        return `<button class="slot ${sel ? 'sel' : ''} ${pid && outNext.has(pid) ? 'going-out' : ''} ${pid ? '' : 'empty'}" style="left:${s.x}%;top:${s.y}%" data-action="tap" data-kind="slot" data-id="${s.id}">
          <span class="shirt ${ROLE_LINE[s.role]}">${p ? esc(p.number || '·') : '+'}</span>
          <span class="pname">${p ? esc(p.name) : s.label}${fit === 'no' ? ' ⚠️' : fit === 'line' ? ' ⚠︎' : ''}</span>
          ${p ? `<span class="ptime" data-played="${pid}">${mmss(playedNow(L, pid))}</span>` : `<span class="ptime">${s.label}</span>`}
        </button>`;
      }).join('')}
    </div>
    <p class="hint muted small">${ui.sel ? 'Ahora toca el jugador con el que cambiarlo.' : 'Toca un jugador para cambiarlo: la app te dirá quién debe entrar.'}</p>
  </section>`;

  // Banquillo
  const bench = availablePlayers(L).filter((p) => !onField(L, p.id));
  const benchHtml = `<section class="card">
    <h3>Banquillo</h3>
    <div class="bench">${bench.length ? bench
      .sort((a, b) => a.played - b.played)
      .map((p) => {
        const pl = playerById(p.id);
        const sel = ui.sel?.kind === 'bench' && ui.sel.id === p.id;
        return `<button class="bench-p ${sel ? 'sel' : ''} ${inNext.has(p.id) ? 'coming-in' : ''}" data-action="tap" data-kind="bench" data-id="${p.id}">
          <span class="shirt">${esc(pl.number || '·')}</span>
          <span class="pname">${esc(pl.name)}</span>
          <span class="ptime" data-played="${p.id}">${mmss(p.played)}</span>
          <span class="tiny">${posChips(pl.positions)}</span>
        </button>`;
      }).join('') : '<p class="muted">Nadie en el banquillo.</p>'}</div>
  </section>`;

  // Plan completo
  const upcoming = plan.changes.filter((c) => c.subs.length || c.moves.length);
  const planHtml = L.phase === 'end' ? '' : `<section class="card">
    <details ${L.phase === 'pre' ? 'open' : ''}><summary><b>Plan de cambios</b> <span class="muted small">(${upcoming.length} momentos)</span></summary>
    ${upcoming.length ? upcoming.map((c) => `<div class="plan-item"><div class="plan-when">${whenText(L, c)}</div>${changeText(L, c)}</div>`).join('') : '<p class="muted">Sin cambios previstos.</p>'}
    <p class="muted small">El plan se recalcula solo si haces cambios distintos, pausas o alguien se lesiona.</p>
    </details>
  </section>`;

  // Tabla de minutos
  const rows = L.squad.filter(playerById).map((id) => ({ id, played: playedNow(L, id), proj: plan.projected[id] ?? playedNow(L, id) }))
    .sort((a, b) => a.proj - b.proj)
    .map((r) => {
      const un = L.unavailable.includes(r.id);
      return `<tr class="${un ? 'unavail' : ''}">
        <td>${esc(nameOf(r.id))}${onField(L, r.id) ? ' <span class="dot" title="En el campo"></span>' : ''}</td>
        <td class="num-c" data-played="${r.id}">${mmss(r.played)}</td>
        <td class="num-c">${un ? '—' : mins(r.proj)}</td>
        <td>${L.phase === 'end' ? '' : `<button class="mini ${un ? 'danger' : ''}" data-action="toggle-unavailable" data-id="${r.id}">${un ? 'No disp.' : 'Disp.'}</button>`}</td>
      </tr>`;
    }).join('');
  const table = `<section class="card">
    <h3>Minutos</h3>
    <table class="table"><thead><tr><th>Jugador</th><th>Jugado</th><th>Previsto</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted small">“Previsto” = minutos al final del partido si se siguen los cambios propuestos.</p>
  </section>`;

  const footer = `<section class="toolbar footer-actions">
    ${L.phase === 'pre' ? '<button class="btn" data-action="back-to-setup">← Convocatoria</button><button class="btn" data-action="relineup">🔄 Recalcular once</button>' : ''}
    ${L.phase !== 'end' && L.undo?.length ? '<button class="btn" data-action="undo">↩︎ Deshacer</button>' : ''}
    ${L.phase !== 'end' ? '<button class="btn danger-outline" data-action="discard-match">Descartar partido</button>' : ''}
  </section>`;

  const posWarn = L.phase === 'pre' ? positionWarningTexts(L.formation, availablePlayers(L).map((p) => playerById(p.id))) : [];
  const freqCard = L.phase === 'pre' ? `<section class="card">${posWarn.map((w) => `<p class="warn">⚠️ ${w}</p>`).join('')}<h3>Cambios</h3>${freqControl('live', L.freq, L.halfLen, L.freqAdjust !== false, L.points, L.firstChange ?? null)}</section>` : '';
  const showSheet = ui.sel?.kind === 'slot' && L.lineup[ui.sel.id] && ['h1', 'h2', 'break'].includes(L.phase);
  const sheet = showSheet ? viewSubSheet(L) : '';
  return clock + banner + freqCard + (L.phase === 'end' ? '' : pitch + benchHtml) + planHtml + table + footer + sheet;
}

function clockText(L) {
  if (L.phase === 'pre') return mmss(0);
  if (L.phase === 'break') return 'Descanso';
  if (L.phase === 'end') return 'Final';
  const s = halfSecNow(L);
  if (s > L.halfLen) return `${mmss(L.halfLen)} <small>+${mmss(s - L.halfLen)}</small>`;
  return mmss(s);
}

function viewSummary(L) {
  const vals = L.squad.filter(playerById).map((id) => L.acc[id] || 0);
  const played = vals.filter((v) => v > 0);
  const spread = played.length ? Math.max(...played) - Math.min(...played) : 0;
  return `<section class="card banner done">
    <div class="banner-head">✅ Partido guardado</div>
    <p>${esc(db.settings.teamName)} ${L.goalsFor} – ${L.goalsAgainst} ${esc(L.rival || 'Rival')}</p>
    <p class="muted small">Diferencia entre quien más y quien menos ha jugado: ${mins(spread)}</p>
  </section>`;
}

function viewSquad() {
  const st = seasonOf();
  const list = sortPlayers(db.players).map((p) => `<button class="row" data-action="edit-player" data-id="${p.id}">
      <span class="num">${esc(p.number)}</span>
      <span class="grow"><b>${esc(p.name)}</b>${p.active === false ? ' <span class="muted small">(baja)</span>' : ''}<br>${posChips(p.positions)}</span>
      <span class="muted small">${mins(st[p.id]?.seconds || 0)}<br>${st[p.id]?.played || 0} PJ</span>
    </button>`).join('');
  return `<section class="card">
    <div class="toolbar"><h2 class="grow">Plantilla (${db.players.length})</h2><button class="btn primary" data-action="new-player">+ Jugador</button></div>
    <div class="list">${list || '<p class="muted">Todavía no hay jugadores.</p>'}</div>
    <p class="muted small">POR = portero · LI = lateral izquierdo · DFC = defensa central · LD = lateral derecho · MED = centrocampista · DEL = delantero. Marca todas las posiciones en las que puede jugar cada uno.</p>
  </section>`;
}

function viewStats() {
  const st = seasonOf();
  const rows = Object.values(st)
    .filter((s) => !s.gone || s.called)
    .sort((a, b) => b.seconds - a.seconds)
    .map((s) => `<tr><td>${esc(playerById(s.id)?.name ?? s.name)}</td><td class="num-c">${s.called}</td><td class="num-c">${s.played}</td><td class="num-c">${Math.round(s.seconds / 60)}</td><td class="num-c">${s.played ? Math.round(s.seconds / 60 / s.played) : 0}</td></tr>`)
    .join('');
  const matches = [...db.matches].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((m) => `<button class="row" data-action="show-match" data-id="${m.id}">
      <span class="grow"><b>${esc(m.rival || 'Rival')}</b><br><span class="muted small">${fmtDate(m.date)} · ${FORMATIONS[m.formation]?.name ?? ''}</span></span>
      <span class="result">${m.goalsFor ?? 0} – ${m.goalsAgainst ?? 0}</span>
    </button>`).join('');
  return `<section class="card">
    <h2>Temporada</h2>
    <table class="table"><thead><tr><th>Jugador</th><th>Conv.</th><th>PJ</th><th>Min</th><th>Media</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">Sin datos</td></tr>'}</tbody></table>
    <p class="muted small">Conv. = convocatorias · PJ = partidos jugados · Media = minutos por partido jugado.</p>
  </section>
  <section class="card"><h2>Partidos (${db.matches.length})</h2><div class="list">${matches || '<p class="muted">Aún no hay partidos.</p>'}</div></section>`;
}

function viewSettings() {
  const s = db.settings;
  return `<section class="card">
    <h2>Ajustes</h2>
    <label>Nombre del equipo<input type="text" data-bind="settings.teamName" value="${esc(s.teamName)}"></label>
    <div class="grid2">
      <label>Minutos por parte<input type="number" inputmode="numeric" min="5" max="45" data-bind="settings.halfMinutes" value="${esc(s.halfMinutes)}"></label>
      <label>Máx. convocados<input type="number" inputmode="numeric" min="7" max="25" data-bind="settings.maxSquad" value="${esc(s.maxSquad)}"></label>
    </div>
  </section>
  <section class="card">
    <h2>Compartir y copia de seguridad</h2>
    <p class="muted small">Los datos se guardan solo en este teléfono. <b>Exportar</b> crea un archivo con la plantilla, los partidos y los ajustes que puedes enviar (WhatsApp, AirDrop, correo...) o guardar en Archivos.</p>
    <p class="muted small">Para cargarlo en otro móvil: guarda el archivo en la app <b>Archivos</b>, abre esta app y pulsa <b>Importar</b>. Ojo: importar <b>sustituye</b> todos los datos de ese móvil por los del archivo.</p>
    <div class="toolbar">
      <button class="btn" data-action="export">📤 Exportar / compartir</button>
      <label class="btn">⬆️ Importar<input type="file" accept="application/json,.json" data-action="import" hidden></label>
    </div>
  </section>
  <section class="card">
    <h2>Instalar en el iPhone</h2>
    <p class="small">En Safari pulsa <b>Compartir</b> → <b>Añadir a pantalla de inicio</b>. Se abrirá a pantalla completa y funcionará sin conexión.</p>
  </section>
  <section class="card">
    <button class="btn danger-outline block" data-action="wipe">Borrar todos los datos</button>
  </section>`;
}

// ---------- modales ----------
function renderModal() {
  const m = ui.modal;
  if (!m) { $modal.innerHTML = ''; return; }
  let body = '';
  if (m.type === 'player') {
    const p = m.player;
    body = `<h2>${m.isNew ? 'Nuevo jugador' : 'Editar jugador'}</h2>
      <div class="grid2 g-num">
        <label>Dorsal<input type="number" inputmode="numeric" data-bind="modal.player.number" value="${esc(p.number)}"></label>
        <label>Nombre<input type="text" data-bind="modal.player.name" value="${esc(p.name)}" placeholder="Nombre"></label>
      </div>
      <p class="label">Posiciones en las que puede jugar</p>
      <div class="pos-picker">${ROLES.map((r) => `<button class="pos ${p.positions.includes(r) ? 'on' : ''} chip-${ROLE_LINE[r]}" data-action="toggle-pos" data-role="${r}">${r}<small>${ROLE_NAMES[r]}</small></button>`).join('')}</div>
      <label class="switch"><input type="checkbox" data-bind="modal.player.active" ${p.active !== false ? 'checked' : ''}> Disponible por defecto (en plantilla activa)</label>
      <div class="toolbar">
        ${m.isNew ? '' : '<button class="btn danger-outline" data-action="delete-player">Eliminar</button>'}
        <span class="grow"></span>
        <button class="btn" data-action="close-modal">Cancelar</button>
        <button class="btn primary" data-action="save-player">Guardar</button>
      </div>`;
  } else if (m.type === 'match') {
    const match = db.matches.find((x) => x.id === m.id);
    if (!match) { ui.modal = null; $modal.innerHTML = ''; return; }
    const rows = [...match.players].sort((a, b) => b.seconds - a.seconds).map((r) => `<tr><td>${esc(playerById(r.id)?.name ?? r.name)}</td><td class="num-c">${mmss(r.seconds)}</td></tr>`).join('');
    body = `<h2>${esc(match.rival || 'Rival')} <span class="muted">${match.goalsFor ?? 0} – ${match.goalsAgainst ?? 0}</span></h2>
      <p class="muted">${fmtDate(match.date)} · ${FORMATIONS[match.formation]?.name ?? ''}</p>
      <table class="table"><thead><tr><th>Jugador</th><th>Minutos</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="toolbar">
        <button class="btn danger-outline" data-action="delete-match" data-id="${match.id}">Eliminar partido</button>
        <span class="grow"></span>
        <button class="btn primary" data-action="close-modal">Cerrar</button>
      </div>`;
  }
  $modal.innerHTML = `<div class="modal-backdrop" data-action="close-modal-bg"><div class="modal">${body}</div></div>`;
}

// ---------- eventos ----------
const actions = {
  tab: (d) => { ui.tab = d.tab; ui.sel = null; render(); window.scrollTo(0, 0); },
  // Preparación
  'toggle-available': (d) => {
    const S = db.setup;
    S.available = S.available.includes(d.id) ? S.available.filter((x) => x !== d.id) : [...S.available, d.id];
    persist(); render();
  },
  'avail-all': () => { db.setup.available = db.players.map((p) => p.id); persist(); render(); },
  'avail-none': () => { db.setup.available = []; persist(); render(); },
  'setup-next': () => {
    const S = db.setup;
    const st = seasonOf();
    const avail = S.available.map(playerById).filter(Boolean).map((p) => ({ id: p.id, name: p.name, positions: p.positions, seasonSeconds: st[p.id]?.seconds || 0, matches: st[p.id]?.played || 0 }));
    S.squad = proposeSquad(avail, db.settings.maxSquad);
    ui.setupStep = 2; persist(); render(); window.scrollTo(0, 0);
  },
  'setup-back': () => { ui.setupStep = 1; render(); },
  'toggle-squad': (d) => {
    const S = db.setup;
    S.squad = S.squad.includes(d.id) ? S.squad.filter((x) => x !== d.id) : [...S.squad, d.id];
    persist(); render();
  },
  'set-formation': (d) => { db.setup.formation = d.f; persist(); render(); },
  'setup-create': () => { startMatchFromSetup(); window.scrollTo(0, 0); },
  // Partido
  'start-half': (d) => startHalf(Number(d.h)),
  pause: () => pauseResume(),
  'end-half': () => endHalf(),
  'close-match': () => { db.live = null; db.setup = null; ui.setupStep = 1; persist(); syncWakeLock(); render(); },
  'discard-match': () => {
    if (!confirm('¿Descartar este partido? No se guardarán sus minutos.')) return;
    db.live = null; ui.setupStep = 2; persist(); syncWakeLock(); render();
  },
  'back-to-setup': () => { db.live = null; ui.setupStep = 2; persist(); render(); },
  relineup: () => relineup(),
  tap: (d) => tapPlayer(d.kind, d.id),
  'freq-mode': (d) => {
    const cur = d.scope === 'setup' ? db.setup.freq : db.live.freq;
    if (d.mode === 'auto') setFreq(d.scope, 'auto');
    else setFreq(d.scope, cur === 'auto' ? 300 : Number(cur));
  },
  'freq-step': (d) => {
    const cur = Number(d.scope === 'setup' ? db.setup.freq : db.live.freq) || 300;
    const next = Math.min(20, Math.max(2, Math.round(cur / 60) + Number(d.d))) * 60;
    setFreq(d.scope, next);
  },
  'first-step': (d) => {
    const obj = d.scope === 'setup' ? db.setup : db.live;
    const cur = obj.firstChange === undefined ? 480 : obj.firstChange || 480;
    setFirst(d.scope, Math.min(20, Math.max(2, Math.round(cur / 60) + Number(d.d))) * 60);
  },
  'test-sound': () => { ensureAudio(); setTimeout(() => beep(3), 150); setTimeout(refreshSoundHint, 400); },
  'cancel-sel': () => { ui.sel = null; ui.injured = false; render(); },
  'sub-recommended': () => {
    const L = db.live;
    const outId = L.lineup[ui.sel.id];
    const rec = recommendReplacement({
      slots: slotsOf(L.formation), players: availablePlayers(L), lineup: L.lineup, outId, lockGK: L.gkHalftimeOnly && L.phase !== 'break',
    });
    if (rec) applyLineup(rec.after, [], { injuredId: ui.injured ? outId : null, manual: true });
  },
  'sub-option': (d) => tapPlayer('bench', d.id),
  'apply-next': () => { if (ui.next) applyLineup(ui.next.after, ui.next.keys); },
  'skip-next': () => {
    if (!ui.next) return;
    const L = db.live; snapshot(L);
    L.handled.push(...ui.next.keys);
    L.locked = null;
    if (L.freq === 'auto') recomputeSchedule(L);
    persist(); render();
  },
  'toggle-unavailable': (d) => toggleUnavailable(d.id),
  undo: () => undo(),
  goal: (d) => {
    const L = db.live;
    const k = d.side === 'for' ? 'goalsFor' : 'goalsAgainst';
    L[k] = Math.max(0, L[k] + Number(d.d));
    if (L.phase === 'end') saveMatchToHistory(L);
    persist(); render();
  },
  // Plantilla
  'new-player': () => { ui.modal = { type: 'player', isNew: true, player: { id: uid(), name: '', number: '', positions: [], active: true } }; renderModal(); },
  'edit-player': (d) => { ui.modal = { type: 'player', isNew: false, player: structuredClone(playerById(d.id)) }; renderModal(); },
  'toggle-pos': (d) => {
    const p = ui.modal.player;
    p.positions = p.positions.includes(d.role) ? p.positions.filter((r) => r !== d.role) : [...p.positions, d.role];
    renderModal();
  },
  'save-player': () => {
    const p = ui.modal.player;
    p.name = (p.name || '').trim();
    if (!p.name) { alert('Pon un nombre.'); return; }
    if (!p.positions.length) { alert('Marca al menos una posición.'); return; }
    const i = db.players.findIndex((x) => x.id === p.id);
    if (i >= 0) db.players[i] = p; else db.players.push(p);
    if (ui.modal.isNew && db.setup && !db.setup.available.includes(p.id) && p.active !== false) db.setup.available.push(p.id);
    ui.modal = null; persist(); render();
  },
  'delete-player': () => {
    const p = ui.modal.player;
    if (db.live?.squad.includes(p.id)) { alert('Está convocado en el partido en curso. Quítalo cuando termine.'); return; }
    if (!confirm(`¿Eliminar a ${p.name}? Sus minutos en partidos ya jugados se conservan en el historial.`)) return;
    db.players = db.players.filter((x) => x.id !== p.id);
    if (db.setup) { db.setup.available = db.setup.available.filter((x) => x !== p.id); db.setup.squad = db.setup.squad.filter((x) => x !== p.id); }
    ui.modal = null; persist(); render();
  },
  'close-modal': () => { ui.modal = null; renderModal(); },
  'close-modal-bg': (d, el, e) => { if (e.target === el) { ui.modal = null; renderModal(); } },
  // Estadísticas
  'show-match': (d) => { ui.modal = { type: 'match', id: d.id }; renderModal(); },
  'delete-match': (d) => {
    if (!confirm('¿Eliminar este partido del historial? Se restarán sus minutos.')) return;
    db.matches = db.matches.filter((m) => m.id !== d.id);
    ui.modal = null; persist(); render();
  },
  // Ajustes
  export: async () => {
    const name = `futbol7-copia-${today()}.json`;
    const blob = new Blob([exportJSON(db)], { type: 'application/json' });
    // En el iPhone: menú de compartir (WhatsApp, AirDrop, Correo, Guardar en Archivos...).
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Datos Fútbol 7' });
        return;
      }
    } catch (e) {
      if (e?.name === 'AbortError') return; // cancelado por el usuario
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  wipe: () => {
    if (!confirm('Se borrarán jugadores, partidos y estadísticas de este teléfono. ¿Seguro?')) return;
    localStorage.clear(); db = load(); ui.setupStep = 1; render();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const fn = actions[el.dataset.action];
  if (fn) { fn(el.dataset, el, e); }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.action === 'toggle-injured') { ui.injured = el.checked; return; }
  if (el.dataset.action === 'freq-first') { setFirst(el.dataset.scope, el.checked ? 480 : null); return; }
  if (el.dataset.action === 'freq-adjust') {
    if (el.dataset.scope === 'setup') db.setup.freqAdjust = el.checked;
    else { db.live.freqAdjust = el.checked; recomputeSchedule(db.live); }
    persist(); render();
    return;
  }
  if (el.dataset.action === 'toggle-available' || el.dataset.action === 'toggle-squad') {
    actions[el.dataset.action](el.dataset);
    return;
  }
  if (el.dataset.action === 'import') {
    const file = el.files?.[0];
    el.value = ''; // permite volver a elegir el mismo archivo
    if (!file) return;
    file.text().then((text) => {
      try {
        const msg = `Se sustituirán TODOS los datos de este móvil (plantilla, partidos y ajustes) por los del archivo «${file.name}».${db.live ? ' El partido en curso se perderá.' : ''} ¿Seguir?`;
        if (!confirm(msg)) return;
        db = importJSON(db, text); persist(); ui.setupStep = 1; render();
        alert('Datos importados.');
      } catch (err) { alert('No se pudo importar: ' + err.message); }
    });
    return;
  }
  if (el.dataset.bind) bind(el, true);
});
document.addEventListener('input', (e) => {
  if (e.target.dataset.bind && e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') bind(e.target, false);
});

function bind(el, rerender) {
  const [root, ...path] = el.dataset.bind.split('.');
  let obj = root === 'setup' ? db.setup : root === 'settings' ? db.settings : root === 'modal' ? ui.modal : null;
  if (!obj) return;
  const last = path.pop();
  for (const k of path) obj = obj[k];
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.type === 'number' && root === 'settings') v = Number(v) || obj[last];
  obj[last] = v;
  if (root !== 'modal') persist();
  if (root === 'settings' && last === 'teamName') document.getElementById('team-name').textContent = v || 'Fútbol 7';
  if (rerender && root !== 'modal' && el.type !== 'text') render();
}

// ---------- tic del reloj ----------
function tick() {
  const L = db.live;
  if (!L || ui.tab !== 'match' || ui.modal) return;
  if (!(L.phase === 'h1' || L.phase === 'h2')) return;
  const clockEl = document.getElementById('clock');
  if (clockEl) clockEl.innerHTML = clockText(L);
  document.querySelectorAll('[data-played]').forEach((el) => { el.textContent = mmss(playedNow(L, el.dataset.played)); });
  const next = ui.next;
  const cd = document.getElementById('countdown');
  if (next && !next.due) {
    const left = secondsUntil(next);
    if (cd) cd.textContent = 'en ' + mmss(left);
    if (left <= 0 && L.running) render();
  }
  const halfKey = `end-${L.phase}`;
  if (halfSecNow(L) >= L.halfLen && !ui.alerted.has(halfKey)) {
    ui.alerted.add(halfKey);
    beep(5);
    render();
  }
}
setInterval(tick, 500);

// ---------- alarma de cambio ----------
// Cuando toca un cambio, la alarma (sonido, vibración y pantalla parpadeando)
// no para hasta pulsar «Hacer cambios» (u «Omitir»), aunque estés en otra pestaña.
function alarmDue() {
  const L = db.live;
  if (!L || !(L.phase === 'h1' || L.phase === 'h2')) return false;
  computePlan();
  return Boolean(ui.next?.due);
}
function alarmTick() {
  const due = alarmDue();
  if (due !== alarmOn) render();
  if (due) beep(3);
  refreshSoundHint();
}
setInterval(alarmTick, 1600);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (audioCtx && audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
    render();
    syncWakeLock();
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
navigator.storage?.persist?.().catch(() => {});

render();
syncWakeLock();
