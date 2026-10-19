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

/**
 * Preferencia del jugador por este puesto: 0 = su 1ª posición, 1 = la 2ª... (las
 * posiciones se guardan en orden de preferencia). -1 si no la tiene marcada.
 */
export function rankFor(positions, slot) {
  // Para los puestos de campo, la portería no cuenta en el orden.
  const pos = slot.role === 'POR' ? positions || [] : (positions || []).filter((r) => r !== 'POR');
  const accepts = slot.accepts || [slot.role];
  let best = -1;
  for (const r of accepts) { const i = pos.indexOf(r); if (i >= 0 && (best < 0 || i < best)) best = i; }
  return best;
}

// Nivel de un jugador en cada posición: 0 = Muy bien, 1 = Bien, 2 = Cumple.
export const LEVELS = [0, 1, 2];
export const LEVEL_NAMES = ['Muy bien', 'Bien', 'Cumple'];
const LEVEL_BASE = [0, 0.4, 0.75]; // coste base de cada nivel (minutos equivalentes)
const LEVEL_CAP = [0.3, 0.65, 0.95]; // cada nivel por debajo del siguiente y "Cumple" por debajo de "misma línea" (1)

/** Nivel del jugador en esa posición (sin marcar = Muy bien). */
export function levelOf(levels, role) {
  const v = Number(levels?.[role]);
  return LEVELS.includes(v) ? v : 0;
}

/** ¿Tiene algún nivel distinto de "Muy bien" en sus posiciones? */
export function hasLevels(positions, levels) {
  return (positions || []).some((r) => levelOf(levels, r) > 0);
}

/**
 * "Coste" de que un jugador ocupe un puesto, en minutos equivalentes de
 * diferencia que la app aceptaría para evitarlo. Igualar minutos sigue siendo lo primero.
 * - Sin niveles (todas "Muy bien"): 1ª posición 0, cada posición más abajo en su
 *   lista un poco más (máx. 0,75).
 * - Con niveles: manda el nivel (Muy bien 0, Bien 0,4, Cumple 0,75) y, dentro del
 *   mismo nivel, desempata el orden de su lista (+0,1 por puesto).
 * - Posición sin marcar: misma línea 1, otra línea 2,5.
 */
export function positionCost(positions, slot, { rankStepMin = 0.25, linePenaltyMin = 1, offPenaltyMin = 2.5 } = {}, levels = null) {
  const rank = rankFor(positions, slot);
  if (rank < 0) return fitFor(positions, slot) === 'line' ? linePenaltyMin : offPenaltyMin;
  if (!hasLevels(positions, levels)) return Math.min(rankStepMin * rank, 0.75);
  // Posición concreta que usa (en el 1-2-3-1 un DFC puede cubrirlo un lateral): la mejor de las que acepta.
  const pos = slot.role === 'POR' ? positions || [] : (positions || []).filter((r) => r !== 'POR');
  let best = Infinity;
  for (const r of slot.accepts || [slot.role]) {
    if (!pos.includes(r)) continue;
    const lv = levelOf(levels, r);
    const within = pos.filter((x) => levelOf(levels, x) === lv).indexOf(r);
    best = Math.min(best, Math.min(LEVEL_BASE[lv] + 0.1 * within, LEVEL_CAP[lv]));
  }
  return best;
}

const FIELD_LINES = ['DEF', 'MED', 'DEL'];

function lineDemandAndPlayers(slots, players) {
  const field = players.filter((p) => (p.positions || []).some((r) => r !== 'POR'));
  const fieldSlots = slots.filter((s) => s.role !== 'POR');
  const demand = {};
  // Jugadores-equivalentes que necesita cada línea si todos juegan lo mismo.
  for (const L of FIELD_LINES) demand[L] = fieldSlots.length ? (fieldSlots.filter((s) => ROLE_LINE[s.role] === L).length * field.length) / fieldSlots.length : 0;
  const lines = field.map((p) => [...new Set((p.positions || []).map((r) => ROLE_LINE[r]).filter((L) => L !== 'POR'))]);
  return { demand, lines };
}

/**
 * Lo justa que va cada línea (defensa, medio, ataque): jugadores que necesita
 * frente a jugadores que la pueden cubrir. Sirve para reservar a los polivalentes
 * para la línea más justa.
 */
export function lineScarcity(slots, players) {
  const { demand, lines } = lineDemandAndPlayers(slots, players);
  const out = {};
  for (const L of FIELD_LINES) {
    const capable = lines.filter((ls) => ls.includes(L)).length;
    out[L] = demand[L] ? demand[L] / Math.max(capable, 0.5) : 0;
  }
  return out;
}

/**
 * ¿Pueden los convocados cubrir los minutos de cada línea jugando todos lo mismo
 * y cada uno en posiciones que tiene marcadas? Reparto óptimo (flujo máximo).
 * Devuelve lo que falta en cada línea, en jugadores-equivalentes.
 */
export function lineShortage(slots, players) {
  const { demand, lines } = lineDemandAndPlayers(slots, players);
  // Red: fuente -> jugador (1) -> línea (si la puede jugar) -> sumidero (demanda).
  const P = lines.length; const n = P + 5; const S = P + 3; const T = P + 4;
  const cap = Array.from({ length: n }, () => new Array(n).fill(0));
  const li = { DEF: P, MED: P + 1, DEL: P + 2 };
  lines.forEach((ls, i) => { cap[S][i] = 1; for (const L of ls) cap[i][li[L]] = 1; });
  for (const L of FIELD_LINES) cap[li[L]][T] = demand[L];
  for (;;) {
    const prev = new Array(n).fill(-1); prev[S] = S; const q = [S];
    while (q.length && prev[T] < 0) { const u = q.shift(); for (let v = 0; v < n; v++) if (prev[v] < 0 && cap[u][v] > 1e-9) { prev[v] = u; q.push(v); } }
    if (prev[T] < 0) break;
    let f = Infinity; for (let v = T; v !== S; v = prev[v]) f = Math.min(f, cap[prev[v]][v]);
    for (let v = T; v !== S; v = prev[v]) { cap[prev[v]][v] -= f; cap[v][prev[v]] += f; }
  }
  return Object.fromEntries(FIELD_LINES.map((L) => [L, cap[li[L]][T]]));
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
 * Prioridades: 1) minutos iguales, 2) no quitar a quien lleva menos de
 * `minStintMin` en el campo, 3) posiciones (misma línea antes que otra línea).
 * La portería solo la ocupa un portero salvo que no haya ninguno.
 * - `lockGK`: el portero actual no se mueve.
 *
 * players: [{ id, positions: ['DFC', ...], played: segundos, stint?: segundos en el campo desde que entró, tie?: número }]
 * current: { slotId: playerId | null }
 * Devuelve { slotId: playerId | null }.
 */
export function optimizeLineup({
  slots, players, current = {}, lockGK = false, gapMin = 6, gkCommitMin = null, hysteresisMin = 2, movePenaltyMin = 0.5,
  minStintMin = 5, stintPenaltyMin = 15, linePenaltyMin = 1, offPenaltyMin = 2.5, rankStepMin = 0.25,
  maxBenchMin = null, benchPenaltyMin = 8, scarcity = null, reserveMin = 1,
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
        if (r.id && r.id === lockedGK) row[c] = BIG;
        // Quitar a quien acaba de entrar (menos de minStintMin) penaliza.
        else if (slotOf[r.id] && r.stint != null && r.stint < minStintMin * 60) row[c] = 2 * g * stintPenaltyMin;
        // Quien está en el banquillo y pasaría de maxBenchMin seguidos si no entra ahora, debe entrar.
        else if (maxBenchMin && !slotOf[r.id] && r.benched != null && r.benched + g * 60 > maxBenchMin * 60 + 1) row[c] = 2 * g * benchPenaltyMin;
        else row[c] = 0;
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
      // Las posiciones ceden ante la igualdad de minutos (ver positionCost). La
      // portería es solo para porteros y un portero puro no juega de campo.
      const fit = fitFor(r.positions, slot);
      const onlyGK = (r.positions || []).length > 0 && r.positions.every((x) => x === 'POR');
      if (fit === 'no' && (slot.role === 'POR' || onlyGK)) v += 3 * OUT;
      else v += 2 * g * positionCost(r.positions, slot, { rankStepMin, linePenaltyMin, offPenaltyMin }, r.levels);
      // Reservar a los polivalentes: si este jugador sirve para una línea que va
      // más justa que la de este puesto, cuesta un poco usarlo aquí.
      if (scarcity && reserveMin && slot.role !== 'POR') {
        const here = scarcity[ROLE_LINE[slot.role]] || 0;
        let other = 0;
        for (const rr of r.positions || []) { const L = ROLE_LINE[rr]; if (L !== 'POR' && L !== ROLE_LINE[slot.role]) other = Math.max(other, scarcity[L] || 0); }
        if (other > here) v += 2 * g * reserveMin * Math.min(other - here, 1);
      }
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
export function windowPoints(halfLenSec, windows, minGapSec = 90, startSec = 0) {
  const total = halfLenSec * 2;
  const pts = [];
  for (let k = 1; k < windows; k++) {
    const g = Math.round(startSec + ((total - startSec) * k) / windows);
    if (g < halfLenSec - minGapSec) pts.push({ h: 1, t: g });
    else if (g < halfLenSec + minGapSec) {
      if (!pts.some((p) => p.h === 2 && p.t === 0)) pts.push({ h: 2, t: 0 });
    } else if (g - halfLenSec <= halfLenSec - minGapSec) pts.push({ h: 2, t: g - halfLenSec });
  }
  return pts;
}

export const pointKey = (p) => `${p.h}-${p.t}`;

/** Segundo "nominal" del partido (sin tiempo añadido) → momento {h, t}. */
export function nominalToPoint(g, halfLenSec) {
  return g < halfLenSec ? { h: 1, t: Math.round(g) } : { h: 2, t: Math.round(g - halfLenSec) };
}

function avgGapSec(points, halfLen) {
  const n = points.filter((p) => !(p.h === 2 && p.t === 0)).length;
  return (halfLen * 2) / (n + 1);
}

export function hysteresisFor(gapSec) {
  return clamp((gapSec / 60) * 0.4, 1, 4);
}

/** Puntuación de un plan: lo desiguales que quedan los minutos (varianza) y, un poco, cuántos cambios hay. */
function scorePlan(plan) {
  const vals = Object.values(plan.projected).map((x) => x / 60);
  const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length || 1);
  const subs = plan.changes.reduce((a, c) => a + c.subs.length, 0);
  const events = plan.changes.filter((c) => c.subs.length).length;
  const short = plan.changes.reduce((a, c) => a + (c.shortOuts || 0), 0);
  return variance + 2 * short + 1.5 * (plan.benchExcessMin || 0) + 0.005 * (plan.posCost || 0) + 0.03 * subs + 0.25 * events;
}

/**
 * "Cada X minutos" con ajuste: mueve algunos cambios hasta `maxShiftSec` antes o
 * después de su minuto para que los minutos queden iguales. Solo mueve los
 * cambios que aún no han llegado; el descanso no se mueve.
 * `base` son los mismos parámetros que planMatch (sin `points`).
 */
export function adjustSchedule(base, points, {
  maxShiftSec = 180, stepSec = 30, minGapSec = 90, fixed = [], nowGapSec = 30, endGapSec = 60,
} = {}) {
  const handled = base.handled instanceof Set ? base.handled : new Set(base.handled || []);
  const nowH = base.phase === 'h2' || base.phase === 'break' ? 2 : 1;
  const nowT = base.phase === 'h1' || base.phase === 'h2' ? base.halfSec || 0 : 0;
  const halfLen = base.halfLen;
  const isHalftime = (p) => p.h === 2 && p.t === 0;
  const isFuture = (p) => base.phase === 'pre' || p.h > nowH || (p.h === nowH && p.t > nowT + nowGapSec);
  const cur = points.map((p) => ({ h: p.h, t: p.t, orig: p.t, movable: !isHalftime(p) && !fixed.includes(pointKey(p)) && !handled.has(pointKey(p)) && isFuture(p) }));
  const evalPts = (pts) => scorePlan(planMatch({ ...base, points: pts.map(({ h, t }) => ({ h, t })), handled }));
  let best = evalPts(cur);
  for (let round = 0; round < 4; round++) {
    let improved = false;
    for (let i = 0; i < cur.length; i++) {
      const p = cur[i];
      if (!p.movable) continue;
      for (let d = -maxShiftSec; d <= maxShiftSec; d += stepSec) {
        const t = p.orig + d;
        if (t === p.t) continue;
        if (t < minGapSec || t > halfLen - endGapSec) continue;
        if (p.h === nowH && base.phase !== 'pre' && t < nowT + nowGapSec) continue;
        if (cur.some((q, j) => j !== i && q.h === p.h && Math.abs(q.t - t) < minGapSec)) continue;
        const old = p.t;
        p.t = t;
        const sc = evalPts(cur);
        if (sc < best - 1e-6) { best = sc; improved = true; } else p.t = old;
      }
    }
    if (!improved) break;
  }
  return cur.map(({ h, t }) => ({ h, t })).sort((a, b) => a.h - b.h || a.t - b.t);
}

/**
 * Modo automático: prueba varios calendarios de cambios y se queda con el que
 * deja los minutos más igualados (y, a igualdad, con menos cambios).
 * `base` son los mismos parámetros que planMatch (sin `points`).
 */
export function chooseSchedule(base, { minWindows = 3, maxWindows = 12, firstSec = null, refine = false, current = null } = {}) {
  let best = null;
  const halfLen = base.halfLen;
  const nowKey = base.phase === 'h2' || base.phase === 'break' ? 2 : 1;
  const nowT = base.phase === 'h1' || base.phase === 'h2' ? base.halfSec || 0 : 0;
  const nowNominal = base.phase === 'pre' ? 0 : (nowKey - 1) * halfLen + Math.min(nowT, halfLen);
  const handledBase = new Set(base.handled || []);
  // Primer cambio fijado por el usuario y aún no ha llegado: se respeta y el resto se reparte después.
  const first = firstSec && firstSec > nowNominal ? nominalToPoint(firstSec, halfLen) : null;
  if (first) base = { ...base, mustChange: [...(base.mustChange || []), pointKey(first)] };
  const start = first ? firstSec : nowNominal;
  const range = firstSec ? [1, 10] : [minWindows, maxWindows];
  const GAP = 180; // mínimo entre remesas
  for (let w = range[0]; w <= range[1]; w++) {
    let points;
    if (start > 0) {
      if (w > 1 && (2 * halfLen - start) / w < GAP) continue;
      points = windowPoints(halfLen, w, 150, start)
        .filter((p) => (p.h === 2 && p.t === 0) || (p.h - 1) * halfLen + p.t >= nowNominal + GAP);
      if (first) points.unshift(first);
    } else {
      points = windowPoints(halfLen, w);
    }
    // Los puntos ya pasados no cuentan: se dan por hechos.
    const handled = new Set(handledBase);
    if (base.phase !== 'pre') {
      for (const p of points) {
        if (p.h === 2 && p.t === 0) continue; // el descanso nunca se da por hecho solo
        if (p.h < nowKey || (p.h === nowKey && p.t <= nowT)) handled.add(pointKey(p));
      }
    }
    const score = scorePlan(planMatch({ ...base, points, handled }));
    if (!best || score < best.score - 1e-9) best = { score, windows: w, points, handledPast: [...handled] };
  }
  if (refine || firstSec) {
    best.points = adjustSchedule({ ...base, handled: new Set(best.handledPast) }, best.points, {
      fixed: first ? [pointKey(first)] : [], minGapSec: GAP, nowGapSec: first ? 30 : GAP, endGapSec: 150,
    });
    best.score = scorePlan(planMatch({ ...base, points: best.points, handled: new Set(best.handledPast) }));
  }
  // El plan vigente también compite: replanificar nunca debe empeorarlo.
  if (current && base.phase !== 'pre') {
    const score = scorePlan(planMatch({ ...base, points: current, handled: handledBase }));
    if (score <= best.score + 1e-9) return { score, windows: 0, points: current, handledPast: [...handledBase], kept: true };
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
export function planMatch({
  slots, players, lineup, phase, halfSec = 0, halfLen, points: basePoints = [], handled = new Set(), gkHalftimeOnly = true, firstStep = null,
  stepVariants = {}, forced = {}, mustChange = [], maxBenchMin = null, minStintMin = 5,
}) {
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
  // Desde cuándo (segundo nominal) está cada uno en el campo, para no quitar a quien acaba de entrar.
  const stintStart = {};
  for (const p of players) if (Object.values(cur).includes(p.id)) stintStart[p.id] = nominal(pos) - (phase === 'pre' ? 0 : p.stint ?? 1e6);
  // Desde cuándo está cada uno en el banquillo (los porteros puros no cuentan: esperan su parte).
  const onlyGK = (p) => (p.positions || []).length > 0 && p.positions.every((x) => x === 'POR');
  const benchStart = {};
  for (const p of players) {
    if (!Object.values(cur).includes(p.id) && !onlyGK(p)) benchStart[p.id] = nominal(pos) - (phase === 'pre' ? 0 : p.benched ?? 0);
  }
  // Lo justa que va cada línea con estos convocados (para reservar a los polivalentes).
  const scarcity = lineScarcity(slots, players);
  // Minutos-equivalentes jugados fuera de la 1ª posición (para preferir planes con menos).
  let posCost = 0;
  let posFrom = nominal(pos);
  const accPos = (lu, toNominal) => {
    const dt = Math.max(0, toNominal - posFrom) / 60;
    if (dt > 0) {
      for (const sl of slots) {
        const pid = lu[sl.id];
        if (!pid || sl.role === 'POR') continue;
        const pl = players.find((x) => x.id === pid);
        if (pl) posCost += dt * positionCost(pl.positions, sl, undefined, pl.levels);
      }
    }
    posFrom = Math.max(posFrom, toNominal);
  };
  let benchExcess = 0;
  let benchMax = { sec: 0, id: null }; // el tramo seguido más largo en el banquillo
  const noteBench = (id, sec) => { if (sec > benchMax.sec) benchMax = { sec, id }; };
  const maxBenchSec = maxBenchMin ? maxBenchMin * 60 : null;
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
    // Un cambio ya anunciado (fijado) se mantiene tal cual si sigue siendo posible.
    const forcedKey = [point.key, ...st.keys].find((k) => forced[k]);
    const forcedLineup = forcedKey && Object.values(forced[forcedKey]).every((pid) => !pid || avail.has(pid)) ? forced[forcedKey] : null;
    const after = forcedLineup ? { ...forcedLineup } : optimizeLineup({
      slots,
      players: players.map((p, j) => ({
        id: p.id,
        positions: p.positions,
        levels: p.levels,
        played: played[p.id] + (point.h === 1 && !point.halftime ? virtual[p.id] || 0 : 0),
        stint: stintStart[p.id] != null ? nominal(point) - stintStart[p.id] : null,
        benched: benchStart[p.id] != null ? nominal(point) - benchStart[p.id] : null,
        tie: j,
      })),
      current: cur,
      lockGK,
      gapMin,
      gkCommitMin,
      maxBenchMin,
      minStintMin,
      scarcity,
      // Margen para no cambiar por poco: proporcional al tramo que viene (al final del partido, menor).
      hysteresisMin: (point.halftime && !halftimeIsBoundary ? hysteresisMin * 3 : Math.min(hysteresisMin, hysteresisFor(gapMin * 60)))
        * ((i === 0 && firstStep ? firstStep : stepVariants[i])?.hysteresisMul ?? 1),
      ...((i === 0 && firstStep ? firstStep : stepVariants[i])?.opts || {}),
      ...((i === 0 && firstStep ? firstStep : stepVariants[i])?.gapMul ? { gapMin: gapMin * (i === 0 && firstStep ? firstStep : stepVariants[i]).gapMul } : {}),
    });
    // La primera remesa que fija el usuario tiene que tener cambios sí o sí.
    if (!forcedLineup && [point.key, ...st.keys].some((k) => mustChange.includes(k))
      && !Object.values(after).some((pid) => pid && !Object.values(cur).includes(pid))) {
      const again = optimizeLineup({
        slots,
        players: players.map((p, j) => ({
          id: p.id, positions: p.positions, levels: p.levels, played: played[p.id], stint: null, tie: j,
        })),
        current: cur, lockGK, gapMin, gkCommitMin, hysteresisMin: 0, stintPenaltyMin: 0,
      });
      Object.assign(after, again);
    }
    accPos(cur, nominal(point));
    const { subs, moves } = diffLineups(cur, after);
    let shortOuts = 0;
    for (const sb of subs) {
      if (sb.out && stintStart[sb.out] != null && nominal(point) - stintStart[sb.out] < minStintMin * 60) shortOuts++;
      if (sb.out) delete stintStart[sb.out];
      if (sb.in) stintStart[sb.in] = nominal(point);
      if (sb.in && benchStart[sb.in] != null) {
        if (maxBenchSec) benchExcess += Math.max(0, nominal(point) - benchStart[sb.in] - maxBenchSec);
        noteBench(sb.in, nominal(point) - benchStart[sb.in]);
        delete benchStart[sb.in];
      }
      if (sb.out && !onlyGK(players.find((p) => p.id === sb.out) || {})) benchStart[sb.out] = nominal(point);
    }
    changes.push({ key: point.key, keys: st.keys, half: point.h, t: point.t, due: st.due, halftime: point.halftime, before: cur, after, subs, moves, shortOuts });
    cur = after;
  });
  advance({ h: 2, t: halfLen });
  accPos(cur, 2 * halfLen);
  for (const [id, st] of Object.entries(benchStart)) {
    if (maxBenchSec) benchExcess += Math.max(0, 2 * halfLen - st - maxBenchSec);
    noteBench(id, 2 * halfLen - st);
  }
  return { changes, projected: played, benchExcessMin: benchExcess / 60, benchMax, posCost };
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

/**
 * Avisos de posiciones justas: si para un puesto hay pocos convocados que lo
 * sepan jugar, esos jugadores tendrán que jugar más que el resto.
 * players: convocados disponibles [{ id, name, positions }].
 * Devuelve [{ label, names, count, slots }].
 */
export function positionWarnings(slots, players, halfLenMin = 25) {
  const field = players.filter((p) => (p.positions || []).some((r) => r !== 'POR'));
  const fieldSlots = slots.filter((s) => s.role !== 'POR');
  if (!field.length) return [];
  const fair = (fieldSlots.length * halfLenMin * 2) / Math.max(field.length, fieldSlots.length);
  const groups = new Map();
  for (const s of fieldSlots) {
    const accepts = s.accepts || [s.role];
    const key = accepts.join('/');
    if (!groups.has(key)) groups.set(key, { accepts, role: s.role, slots: 0 });
    groups.get(key).slots += 1;
  }
  const out = [];
  for (const g of groups.values()) {
    const able = field.filter((p) => g.accepts.some((r) => (p.positions || []).includes(r)));
    const needMin = g.slots * halfLenMin * 2;
    if (able.length * fair < needMin - 0.5) {
      const label = g.accepts.length > 1 ? `${ROLE_NAMES[g.role]} (${g.accepts.join(' o ')})` : ROLE_NAMES[g.role];
      out.push({ label, names: able.map((p) => p.name), count: able.length, slots: g.slots });
    }
  }
  return out;
}

/**
 * Como planMatch, pero el cambio que toca ahora se elige mirando al final del
 * partido: prueba varias combinaciones y se queda con la que deja los minutos
 * finales más iguales (respetando lo de no quitar a quien lleva menos de 5').
 */
const VARIANTS = [
  { hysteresisMul: 0 }, { hysteresisMul: 0.5 }, { hysteresisMul: 2 }, { hysteresisMul: 4 },
  { hysteresisMul: 0, opts: { linePenaltyMin: 1.5, offPenaltyMin: 5 } },
  { hysteresisMul: 1, opts: { stintPenaltyMin: 12 } },
  { hysteresisMul: 1, gapMul: 2 }, { hysteresisMul: 1, gapMul: 0.5 },
  { hysteresisMul: 1, opts: { benchPenaltyMin: 5 } }, { hysteresisMul: 0.5, opts: { benchPenaltyMin: 30 } },
  { hysteresisMul: 1, opts: { reserveMin: 1 } }, { hysteresisMul: 1, opts: { reserveMin: 3 } },
  { hysteresisMul: 1, opts: { offPenaltyMin: 6, linePenaltyMin: 2.5 } },
];

export function planMatchBest(params) {
  const base = planMatch(params);
  if (!base.changes[0]?.due) return base;
  let best = base;
  let bestScore = scorePlan(base);
  for (const firstStep of VARIANTS) {
    const plan = planMatch({ ...params, firstStep });
    const sc = scorePlan(plan);
    if (sc < bestScore - 1e-6) { best = plan; bestScore = sc; }
  }
  return best;
}

/**
 * Plan completo afinado: remesa a remesa, prueba varias formas de decidir esa
 * remesa (mirando cómo acaba el partido) y se queda con la mejor. Más lento que
 * planMatch; se usa para el plan que se enseña y para decidir el cambio que toca.
 */
export function planMatchRefined(params, { rounds = 2 } = {}) {
  let plan = planMatch(params);
  let bestScore = scorePlan(plan);
  const chosen = {};
  for (let r = 0; r < rounds; r++) {
    let improved = false;
    for (let i = 0; i < plan.changes.length; i++) {
      for (const v of VARIANTS) {
        const trial = planMatch({ ...params, stepVariants: { ...chosen, [i]: v } });
        // Una remesa que ya está sonando no puede convertirse en "no cambiar nada".
        if (plan.changes[i].due && plan.changes[i].subs.length && !trial.changes[i].subs.length) continue;
        const sc = scorePlan(trial);
        if (sc < bestScore - 1e-6) { bestScore = sc; plan = trial; chosen[i] = v; improved = true; }
      }
    }
    if (!improved) break;
  }
  plan.stepVariants = chosen;
  return plan;
}

/** Diferencia entre el jugador de campo que más juega y el que menos (minutos). */
export function fieldSpread(plan, players) {
  const vals = players.filter((p) => !(p.positions || []).every((x) => x === 'POR')).map((p) => (plan.projected[p.id] || 0) / 60);
  return vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
}

/**
 * Elige momentos de cambio aplicando las reglas pedidas (mínimo seguido en el
 * campo y máximo seguido en el banquillo). Como igualar minutos va primero, si
 * con esta convocatoria esas reglas dejan una diferencia de más de `toleranceMin`,
 * se relajan lo justo, paso a paso, y se usa la primera opción que iguala.
 * Devuelve el resultado de chooseSchedule más { rules, relaxed }.
 */
export function chooseScheduleWithRules(base, { firstSec = null, current = null, minStintMin = 7, maxBenchMin = 8, toleranceMin = 2 } = {}) {
  const tries = [];
  const push = (m, b) => { if (!tries.some((t) => t.m === m && t.b === b)) tries.push({ m, b }); };
  const mb = (b, d) => (b ? b + d : null);
  const m1 = Math.max(5, minStintMin - 1);
  push(minStintMin, maxBenchMin);
  push(minStintMin, mb(maxBenchMin, 1));
  push(m1, maxBenchMin);
  push(m1, mb(maxBenchMin, 1));
  push(5, maxBenchMin);
  push(5, mb(maxBenchMin, 1));
  push(5, mb(maxBenchMin, 2));
  let best = null;
  for (const t of tries) {
    const b = { ...base, minStintMin: t.m, maxBenchMin: t.b };
    const sched = chooseSchedule(b, { firstSec, current });
    const plan = planMatchRefined({ ...b, points: sched.points, handled: new Set(sched.handledPast) });
    const spread = fieldSpread(plan, base.players);
    const cand = { ...sched, rules: { minStintMin: t.m, maxBenchMin: t.b }, spread };
    if (!best || spread < best.spread - 0.5) best = cand;
    if (spread <= toleranceMin) { best = cand; break; }
  }
  best.relaxed = best.rules.minStintMin !== minStintMin || best.rules.maxBenchMin !== maxBenchMin;
  return best;
}

/**
 * Avisos por líneas: si a la defensa (o al medio, o al ataque) le faltan
 * jugadores para cubrir sus minutos con todos jugando lo mismo, alguien tendrá
 * que jugar fuera de su sitio. Devuelve [{ line, scarcity }].
 */
export function lineWarnings(slots, players) {
  const short = lineShortage(slots, players);
  // Más de un tercio de jugador de hueco (unos 10 minutos de partido) merece aviso.
  return Object.entries(short).filter(([, v]) => v > 0.34).map(([line, shortage]) => ({ line, shortage }));
}
