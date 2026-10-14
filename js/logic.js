// Lógica pura (sin DOM): sistemas, asignación de posiciones, plan de cambios
// y propuesta de convocatoria. Se puede probar con Node (ver tests/).

export const ROLES = ['POR', 'LI', 'DFC', 'LD', 'MED', 'DEL'];
export const ROLE_NAMES = {
  POR: 'Portero', LI: 'Lateral izquierdo', DFC: 'Defensa central', LD: 'Lateral derecho', MED: 'Centrocampista', DEL: 'Delantero',
};
// Línea a la que pertenece cada posición (para colores y para "fuera de posición, pero en su línea").
export const ROLE_LINE = { POR: 'POR', LI: 'DEF', DFC: 'DEF', LD: 'DEF', MED: 'MED', DEL: 'DEL' };

// Coordenadas en % del campo (y=0 portería rival, y=100 portería propia).
// `role` es la posición del puesto; `accepts` las posiciones que encajan en él.
export const FORMATIONS = {
  '3-2-1': {
    name: '1-3-2-1',
    slots: [
      { id: 'POR', role: 'POR', label: 'POR', x: 50, y: 88 },
      { id: 'DEF1', role: 'LI', label: 'LI', x: 16, y: 64 },
      { id: 'DEF2', role: 'DFC', label: 'DFC', x: 50, y: 70 },
      { id: 'DEF3', role: 'LD', label: 'LD', x: 84, y: 64 },
      { id: 'MED1', role: 'MED', label: 'MC', x: 30, y: 42 },
      { id: 'MED2', role: 'MED', label: 'MC', x: 70, y: 42 },
      { id: 'DEL1', role: 'DEL', label: 'DC', x: 50, y: 16 },
    ],
  },
  '2-3-1': {
    name: '1-2-3-1',
    slots: [
      { id: 'POR', role: 'POR', label: 'POR', x: 50, y: 88 },
      { id: 'DEF1', role: 'DFC', accepts: ['DFC', 'LI'], label: 'DFC', x: 30, y: 68 },
      { id: 'DEF2', role: 'DFC', accepts: ['DFC', 'LD'], label: 'DFC', x: 70, y: 68 },
      { id: 'MED1', role: 'MED', label: 'MI', x: 15, y: 42 },
      { id: 'MED2', role: 'MED', label: 'MC', x: 50, y: 45 },
      { id: 'MED3', role: 'MED', label: 'MD', x: 85, y: 42 },
      { id: 'DEL1', role: 'DEL', label: 'DC', x: 50, y: 16 },
    ],
  },
};

/** ¿Puede jugar en este puesto? 'yes' | 'line' (misma línea, otra posición) | 'no'. */
export function fitFor(positions, slot) {
  const pos = positions || [];
  const accepts = slot.accepts || [slot.role];
  if (accepts.some((r) => pos.includes(r))) return 'yes';
  const line = ROLE_LINE[slot.role];
  if (line !== 'POR' && pos.some((r) => ROLE_LINE[r] === line)) return 'line';
  return 'no';
}

/** Convierte posiciones antiguas (DEF genérico) a las nuevas. */
export function migratePositions(positions) {
  const out = [];
  for (const r of positions || []) {
    if (r === 'DEF') out.push('LI', 'DFC', 'LD');
    else if (ROLES.includes(r)) out.push(r);
  }
  return [...new Set(out)];
}

const BIG = 1e7;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Algoritmo húngaro (minimiza coste). `cost` es una matriz cuadrada n×n.
 * Devuelve `ans[fila] = columna`.
 */
export function hungarian(cost) {
  const n = cost.length;
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else { minv[j] -= delta; }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const ans = new Array(n);
  for (let j = 1; j <= n; j++) if (p[j]) ans[p[j] - 1] = j - 1;
  return ans;
}

/**
 * Elige quién está en el campo y en qué puesto.
 * - Busca que los minutos queden lo más igualados posible: el coste de jugar los
 *   próximos `gapMin` minutos es el aumento de (minutos jugados)², así entra antes
 *   quien menos lleva.
 * - El portero se compromete `gkCommitMin` minutos (p. ej. la parte entera).
 * - `hysteresisMin`: ventaja para quien ya está en el campo (evita cambios por diferencias mínimas).
 * - Respeta posiciones; fuera de posición solo si no hay otra opción.
 * - `lockGK`: el portero actual no se mueve.
 *
 * players: [{ id, positions: ['DFC', ...], played: segundos, tie?: número }]
 * current: { slotId: playerId | null }
 * Devuelve { slotId: playerId | null }.
 */
export function optimizeLineup({
  slots, players, current = {}, lockGK = false, gapMin = 6, gkCommitMin = null, hysteresisMin = 2, movePenaltyMin = 0.5,
}) {
  const slotOf = {};
  const ids = new Set(players.map((p) => p.id));
  for (const [sid, pid] of Object.entries(current)) if (pid && ids.has(pid)) slotOf[pid] = sid;
  const gkSlot = slots.find((s) => s.role === 'POR');
  const gkCurrent = gkSlot ? current[gkSlot.id] : null;
  const lockedGK = lockGK && gkCurrent && ids.has(gkCurrent) ? gkCurrent : null;
  const roleOfSlot = Object.fromEntries(slots.map((s) => [s.id, s.role]));
  const g = Math.max(gapMin, 0.5);
  const gk = Math.max(gkCommitMin ?? g, 0.5);
  const OUT = 1e6;

  const rows = players.map((p) => ({ ...p }));
  while (rows.length < slots.length) rows.push({ id: null, dummy: true });
  const n = rows.length;
  const S = slots.length;

  const cost = rows.map((r, ri) => {
    const row = new Array(n);
    for (let c = 0; c < n; c++) {
      if (c >= S) { // banquillo
        row[c] = r.id && r.id === lockedGK ? BIG : 0;
        continue;
      }
      const slot = slots[c];
      if (r.dummy) { row[c] = slot.role === 'POR' ? 50 * OUT : 10 * OUT; continue; }
      if (lockedGK) {
        if (slot.id === gkSlot.id) { row[c] = r.id === lockedGK ? 0 : BIG; continue; }
        if (r.id === lockedGK) { row[c] = BIG; continue; }
      }
      const p = (r.played || 0) / 60;
      const d = slot.role === 'POR' ? gk : g;
      let v = d * (2 * p + d) + (r.tie ?? ri) * 1e-3;
      const cs = slotOf[r.id];
      if (cs) {
        v -= 2 * g * hysteresisMin;
        if (cs !== slot.id) v += 2 * g * (slot.role === 'POR' || roleOfSlot[cs] === 'POR' ? 3 : movePenaltyMin);
      }
      const fit = fitFor(r.positions, slot);
      // Misma línea, otra posición: se acepta si evita una diferencia de minutos de unos 5'.
      if (fit === 'line') v += 2 * g * 5;
      else if (fit === 'no') v += slot.role === 'POR' ? 3 * OUT : OUT;
      row[c] = v;
    }
    return row;
  });

  const ans = hungarian(cost);
  const lineup = {};
  for (const s of slots) lineup[s.id] = null;
  rows.forEach((r, ri) => {
    const c = ans[ri];
    if (c < S && !r.dummy) lineup[slots[c].id] = r.id;
  });
  return lineup;
}

/**
 * Momentos de cambio cada `intervalSec` (reloj de cada parte). No pone cambios
 * en los últimos `minGapSec` de una parte (para eso está el descanso).
 * Devuelve [{h, t}]; incluye el descanso ({h: 2, t: 0}) como momento de cambio.
 */
export function intervalPoints(halfLenSec, intervalSec, minGapSec = 120) {
  const pts = [];
  if (!intervalSec || intervalSec <= 0) return pts;
  for (const h of [1, 2]) {
    if (h === 2) pts.push({ h: 2, t: 0 });
    for (let t = intervalSec; t <= halfLenSec - minGapSec + 0.5; t += intervalSec) pts.push({ h, t: Math.round(t) });
  }
  return pts;
}

/**
 * Divide el partido entero (las dos partes seguidas) en `windows` tramos iguales.
 * Un tramo puede cruzar el descanso; los puntos muy pegados al final de una parte
 * se pasan al descanso. Devuelve [{h, t}]; el descanso ({h: 2, t: 0}) solo se
 * incluye si coincide con un cambio de tramo.
 */
export function windowPoints(halfLenSec, windows, minGapSec = 90) {
  const total = halfLenSec * 2;
  const pts = [];
  for (let k = 1; k < windows; k++) {
    const g = Math.round((total * k) / windows);
    if (g < halfLenSec - minGapSec) pts.push({ h: 1, t: g });
    else if (g < halfLenSec + minGapSec) {
      if (!pts.some((p) => p.h === 2 && p.t === 0)) pts.push({ h: 2, t: 0 });
    } else if (g - halfLenSec <= halfLenSec - minGapSec) pts.push({ h: 2, t: g - halfLenSec });
  }
  return pts;
}

export const pointKey = (p) => `${p.h}-${p.t}`;

function avgGapSec(points, halfLen) {
  const n = points.filter((p) => !(p.h === 2 && p.t === 0)).length;
  return (halfLen * 2) / (n + 1);
}

export function hysteresisFor(gapSec) {
  return clamp((gapSec / 60) * 0.4, 1, 4);
}

/**
 * Modo automático: prueba varios calendarios de cambios y se queda con el que
 * deja los minutos más igualados (y, a igualdad, con menos cambios).
 * `base` son los mismos parámetros que planMatch (sin `points`).
 */
export function chooseSchedule(base, { minWindows = 3, maxWindows = 12 } = {}) {
  let best = null;
  const nowKey = base.phase === 'h2' || base.phase === 'break' ? 2 : 1;
  const nowT = base.phase === 'h1' || base.phase === 'h2' ? base.halfSec || 0 : 0;
  for (let w = minWindows; w <= maxWindows; w++) {
    const points = windowPoints(base.halfLen, w);
    // Los puntos ya pasados no cuentan: se dan por hechos.
    const handled = new Set(base.handled || []);
    if (base.phase !== 'pre') {
      for (const p of points) {
        if (p.h === 2 && p.t === 0) continue; // el descanso nunca se da por hecho solo
        if (p.h < nowKey || (p.h === nowKey && p.t <= nowT)) handled.add(pointKey(p));
      }
    }
    const plan = planMatch({ ...base, points, handled });
    const vals = Object.values(plan.projected).map((x) => x / 60);
    const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length || 1);
    const subs = plan.changes.reduce((a, c) => a + c.subs.length, 0);
    const events = plan.changes.filter((c) => c.subs.length).length;
    const score = variance + 0.03 * subs + 0.1 * events;
    if (!best || score < best.score - 1e-9) best = { score, windows: w, points, handledPast: [...handled] };
  }
  return best;
}

/** Compara dos alineaciones: entradas/salidas emparejadas y cambios de puesto. */
export function diffLineups(before, after) {
  const onBefore = new Set(Object.values(before).filter(Boolean));
  const onAfter = new Set(Object.values(after).filter(Boolean));
  const slotBefore = {};
  for (const [sid, pid] of Object.entries(before)) if (pid) slotBefore[pid] = sid;
  const ins = [];
  const moves = [];
  for (const [sid, pid] of Object.entries(after)) {
    if (!pid) continue;
    if (!onBefore.has(pid)) ins.push({ pid, slotId: sid });
    else if (slotBefore[pid] !== sid) moves.push({ pid, from: slotBefore[pid], to: sid });
  }
  const outs = [...onBefore].filter((pid) => !onAfter.has(pid));
  const subs = [];
  const remainingOuts = [...outs];
  for (const i of ins) {
    const direct = before[i.slotId];
    let idx = remainingOuts.indexOf(direct);
    if (idx < 0) idx = 0;
    const out = remainingOuts.length ? remainingOuts.splice(idx, 1)[0] : null;
    subs.push({ in: i.pid, out, slotId: i.slotId });
  }
  for (const out of remainingOuts) subs.push({ in: null, out, slotId: null });
  return { subs, moves };
}

/**
 * Simula el resto del partido y propone los cambios.
 *
 * params:
 *  slots, players (disponibles: [{id, positions, played}]), lineup actual,
 *  phase: 'pre' | 'h1' | 'break' | 'h2' | 'end', halfSec (segundos en la parte actual),
 *  halfLen, points ([{h, t}] momentos de cambio; si no incluye el descanso, en el
 *  descanso solo se proponen cambios claros, p. ej. el portero), handled (Set de claves ya hechas/omitidas),
 *  gkHalftimeOnly (el portero solo cambia en el descanso).
 *
 * Devuelve { changes: [{key, keys, half, t, due, halftime, before, after, subs, moves}], projected: {id: segundos} }
 */
export function planMatch({ slots, players, lineup, phase, halfSec = 0, halfLen, points: basePoints = [], handled = new Set(), gkHalftimeOnly = true }) {
  handled = handled instanceof Set ? handled : new Set(handled);
  const played = Object.fromEntries(players.map((p) => [p.id, p.played || 0]));
  const avail = new Set(players.map((p) => p.id));
  let cur = {};
  for (const s of slots) cur[s.id] = lineup[s.id] && avail.has(lineup[s.id]) ? lineup[s.id] : null;

  if (phase === 'end') return { changes: [], projected: played };

  let pos;
  if (phase === 'pre') pos = { h: 1, t: 0 };
  else if (phase === 'h1') pos = { h: 1, t: halfSec };
  else if (phase === 'break') pos = { h: 2, t: 0 };
  else pos = { h: 2, t: halfSec };

  const halftimeIsBoundary = basePoints.some((p) => p.h === 2 && p.t === 0);
  const points = [{ h: 2, t: 0, halftime: true, key: '2-0' }];
  for (const p of basePoints) if (!(p.h === 2 && p.t === 0)) points.push({ h: p.h, t: p.t, halftime: false, key: pointKey(p) });
  points.sort((a, b) => a.h - b.h || a.t - b.t);
  const pending = points.filter((p) => !handled.has(p.key));
  const isPast = (p) => p.h < pos.h || (p.h === pos.h && p.t <= pos.t);
  const due = phase === 'pre' ? [] : pending.filter(isPast);
  const future = pending.filter((p) => !isPast(p));

  const advance = (to) => {
    let dt;
    if (to.h === pos.h) dt = Math.max(0, to.t - pos.t);
    else dt = Math.max(0, halfLen - pos.t) + to.t;
    for (const pid of Object.values(cur)) if (pid) played[pid] += dt;
    pos = { h: to.h, t: to.h === pos.h ? Math.max(pos.t, to.t) : to.t };
  };

  const hysteresisMin = hysteresisFor(avgGapSec(basePoints, halfLen));
  const nominal = (p) => (p.h - 1) * halfLen + Math.min(p.t, halfLen);
  const steps = [];
  const hasEmptySlot = slots.some((s) => !cur[s.id]) && players.some((p) => !Object.values(cur).includes(p.id));
  if (due.length || (hasEmptySlot && phase !== 'pre')) {
    const halftime = due.some((d) => d.halftime) || phase === 'break';
    steps.push({ point: { h: pos.h, t: pos.t, halftime, key: due.length ? due[due.length - 1].key : 'now' }, due: true, keys: due.map((d) => d.key) });
  }
  for (const p of future) steps.push({ point: p, due: false, keys: [p.key] });

  // Con el portero fijo por partes, quien vaya a ser portero en la 2ª parte
  // descansa más en la 1ª (se le suma la parte que jugará en portería).
  const virtual = {};
  const gkSlot = slots.find((s) => s.role === 'POR');
  if (gkHalftimeOnly && gkSlot && (phase === 'pre' || phase === 'h1')) {
    const gk2 = players
      .filter((p) => (p.positions || []).includes('POR') && p.id !== cur[gkSlot.id])
      .sort((a, b) => a.positions.length - b.positions.length || played[a.id] - played[b.id])[0];
    if (gk2) virtual[gk2.id] = halfLen;
  }

  const changes = [];
  steps.forEach((st, i) => {
    const point = st.point;
    if (!st.due) advance(point);
    const nextNominal = i + 1 < steps.length ? nominal(steps[i + 1].point) : 2 * halfLen;
    const gapMin = Math.max(30, nextNominal - nominal(point)) / 60;
    const lockGK = gkHalftimeOnly && !point.halftime;
    const gkCommitMin = gkHalftimeOnly ? Math.max(30, halfLen - Math.min(point.t, halfLen)) / 60 : gapMin;
    const after = optimizeLineup({
      slots,
      players: players.map((p, j) => ({
        id: p.id, positions: p.positions, played: played[p.id] + (point.h === 1 && !point.halftime ? virtual[p.id] || 0 : 0), tie: j,
      })),
      current: cur,
      lockGK,
      gapMin,
      gkCommitMin,
      hysteresisMin: point.halftime && !halftimeIsBoundary ? hysteresisMin * 3 : hysteresisMin,
    });
    const { subs, moves } = diffLineups(cur, after);
    changes.push({ key: point.key, keys: st.keys, half: point.h, t: point.t, due: st.due, halftime: point.halftime, before: cur, after, subs, moves });
    cur = after;
  });
  advance({ h: 2, t: halfLen });
  return { changes, projected: played };
}

/**
 * Propone la convocatoria cuando hay más disponibles que plazas:
 * prioridad a quien menos minutos lleva en la temporada (después, menos partidos).
 * Garantiza al menos un portero si hay alguno disponible.
 * available: [{ id, name, positions, seasonSeconds, matches }]
 */
export function proposeSquad(available, maxSquad) {
  const sorted = [...available].sort(
    (a, b) => (a.seasonSeconds || 0) - (b.seasonSeconds || 0) || (a.matches || 0) - (b.matches || 0) || String(a.name).localeCompare(String(b.name)),
  );
  const chosen = sorted.slice(0, maxSquad);
  const rest = sorted.slice(maxSquad);
  const isGK = (p) => (p.positions || []).includes('POR');
  if (!chosen.some(isGK)) {
    const gk = rest.find(isGK);
    if (gk) {
      for (let i = chosen.length - 1; i >= 0; i--) {
        if (!isGK(chosen[i])) { chosen.splice(i, 1, gk); break; }
      }
    }
  }
  return chosen.map((p) => p.id);
}

/** Estadísticas de temporada a partir del historial de partidos. */
export function seasonStats(players, matches) {
  const stats = {};
  for (const p of players) stats[p.id] = { id: p.id, name: p.name, called: 0, played: 0, seconds: 0 };
  for (const m of matches) {
    for (const row of m.players || []) {
      if (!stats[row.id]) stats[row.id] = { id: row.id, name: row.name, called: 0, played: 0, seconds: 0, gone: true };
      const s = stats[row.id];
      s.called += 1;
      if (row.seconds > 0) s.played += 1;
      s.seconds += row.seconds || 0;
    }
  }
  return stats;
}

/**
 * Cambio no previsto (lesión, cansancio...): quién debería sustituir a `outId`.
 * Mantiene al resto del once en su sitio salvo que una recolocación evite
 * jugar fuera de posición. Devuelve la alineación recomendada y, aparte, todas
 * las opciones del banquillo ordenadas (encaje en el puesto y minutos jugados).
 *
 * players: disponibles [{ id, positions, played }] (incluido `outId`).
 */
export function recommendReplacement({ slots, players, lineup, outId, lockGK = false }) {
  const slotId = Object.keys(lineup).find((s) => lineup[s] === outId);
  if (!slotId) return null;
  const slot = slots.find((s) => s.id === slotId);
  const current = { ...lineup, [slotId]: null };
  const others = players.filter((p) => p.id !== outId);
  const after = optimizeLineup({
    slots,
    players: others.map((p, i) => ({ ...p, tie: i })),
    current,
    lockGK: lockGK && slot.role !== 'POR',
    gapMin: 5,
    hysteresisMin: 15,
    movePenaltyMin: 2,
  });
  const onField = new Set(Object.values(lineup).filter(Boolean));
  const rank = { yes: 0, line: 1, no: 2 };
  const options = others
    .filter((p) => !onField.has(p.id))
    .map((p) => ({ id: p.id, played: p.played, fit: fitFor(p.positions, slot) }))
    .sort((a, b) => rank[a.fit] - rank[b.fit] || a.played - b.played);
  return { slotId, after, ...diffLineups(lineup, after), options };
}
