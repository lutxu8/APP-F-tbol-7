import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATIONS, planMatchRefined, fitFor, rankFor, positionCost, lineWarnings, chooseScheduleWithRules, migratePositions, recommendReplacement, adjustSchedule, positionWarnings, hungarian, optimizeLineup, planMatch, chooseSchedule, intervalPoints, proposeSquad, diffLineups } from '../js/logic.js';

const HALF = 25 * 60;

function squad(n, { gks = 1, dedicatedGK = true } = {}) {
  const roles = ['LI', 'DFC', 'MED', 'LD', 'DEL', 'MED'];
  const out = [];
  for (let i = 0; i < n; i++) {
    if (i < gks) out.push({ id: 'p' + i, positions: dedicatedGK ? ['POR'] : ['POR', 'DFC'] });
    else out.push({ id: 'p' + i, positions: [roles[i % 6], roles[(i + 2) % 6]] });
  }
  return out;
}

function simulate(players, formation, opts = {}) {
  const slots = FORMATIONS[formation].slots;
  const ps = players.map((p) => ({ ...p, played: 0 }));
  const lineup = optimizeLineup({ slots, players: ps, gkCommitMin: 25 });
  const base = { slots, players: ps, lineup, phase: 'pre', halfLen: HALF, gkHalftimeOnly: opts.gkHalftimeOnly ?? true };
  const points = opts.interval ? intervalPoints(HALF, opts.interval) : chooseSchedule(base).points;
  const { changes, projected } = planMatchRefined({ ...base, points });
  return { changes, projected, lineup, slots };
}

test('hungarian finds optimal assignment', () => {
  const ans = hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]]);
  const total = ans.reduce((s, c, r) => s + [[4, 1, 3], [2, 0, 5], [3, 2, 2]][r][c], 0);
  assert.equal(total, 5);
});

test('lineup respects positions', () => {
  const players = squad(10);
  const { lineup, slots } = simulate(players, '3-2-1');
  for (const s of slots) {
    const p = players.find((x) => x.id === lineup[s.id]);
    assert.equal(fitFor(p.positions, s), 'yes', `${p.id} en ${s.id}`);
  }
});

for (const formation of ['3-2-1', '2-3-1']) {
  for (let n = 8; n <= 14; n++) {
    test(`reparto justo ${formation} con ${n} jugadores (portero fijo)`, () => {
      const players = squad(n, { gks: 1 });
      const { projected } = simulate(players, formation);
      const mins = Object.values(projected).map((s) => s / 60);
      const total = mins.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(total - 350) < 0.1, 'total ' + total);
      assert.equal(mins[0], 50);
      const field = mins.slice(1);
      const spread = Math.max(...field) - Math.min(...field);
      assert.ok(spread <= 6, `diferencia ${spread.toFixed(1)} min: ${field.map((m) => m.toFixed(1)).join(', ')}`);
    });
  }
}

test('dos porteros puros se reparten las partes', () => {
  const { projected } = simulate(squad(11, { gks: 2 }), '2-3-1');
  assert.equal(projected.p0, 25 * 60);
  assert.equal(projected.p1, 25 * 60);
});

test('porteros que también juegan de campo: reparto razonable', () => {
  const { projected } = simulate(squad(11, { gks: 2, dedicatedGK: false }), '3-2-1');
  const mins = Object.values(projected).map((s) => s / 60);
  assert.ok(Math.max(...mins) - Math.min(...mins) <= 6.5, mins.join(', '));
});

test('el portero solo cambia en el descanso', () => {
  const players = squad(12, { gks: 2 });
  const { changes } = simulate(players, '3-2-1');
  for (const c of changes) {
    if (!c.halftime) assert.equal(c.before.POR, c.after.POR);
  }
});

test('cambio pendiente se marca como "due"', () => {
  const players = squad(10, { gks: 1 }).map((p) => ({ ...p, played: 0 }));
  const slots = FORMATIONS['3-2-1'].slots;
  const lineup = optimizeLineup({ slots, players });
  const interval = 500;
  const field = Object.values(lineup);
  const live = players.map((p) => ({ ...p, played: field.includes(p.id) ? interval + 5 : 0 }));
  const { changes } = planMatch({ slots, players: live, lineup, phase: 'h1', halfSec: interval + 5, halfLen: HALF, points: intervalPoints(HALF, interval) });
  assert.ok(changes[0].due);
  assert.ok(changes[0].subs.length >= 1);
});

test('hueco por lesión se rellena al momento', () => {
  const players = squad(9, { gks: 1 }).map((p) => ({ ...p, played: 0 }));
  const slots = FORMATIONS['2-3-1'].slots;
  const lineup = optimizeLineup({ slots, players });
  lineup.DEF1 = null;
  const { changes } = planMatch({ slots, players, lineup, phase: 'h1', halfSec: 60, halfLen: HALF, points: intervalPoints(HALF, 500) });
  assert.ok(changes[0].due);
  assert.ok(changes[0].after.DEF1);
});

test('convocatoria prioriza menos minutos y garantiza portero', () => {
  const av = [
    { id: 'a', name: 'A', positions: ['DEF'], seasonSeconds: 100 },
    { id: 'b', name: 'B', positions: ['MED'], seasonSeconds: 50 },
    { id: 'c', name: 'C', positions: ['POR'], seasonSeconds: 900 },
    { id: 'd', name: 'D', positions: ['DEL'], seasonSeconds: 10 },
  ];
  assert.deepEqual(proposeSquad(av, 3).sort(), ['b', 'c', 'd']);
});

test('diffLineups empareja entradas y salidas', () => {
  const d = diffLineups({ A: 'x', B: 'y' }, { A: 'z', B: 'y' });
  assert.deepEqual(d.subs, [{ in: 'z', out: 'x', slotId: 'A' }]);
});

test('laterales y centrales en su sitio', () => {
  const slots = FORMATIONS['3-2-1'].slots;
  const players = [
    { id: 'gk', positions: ['POR'] }, { id: 'li', positions: ['LI'] }, { id: 'ld', positions: ['LD'] }, { id: 'dfc', positions: ['DFC'] },
    { id: 'm1', positions: ['MED'] }, { id: 'm2', positions: ['MED'] }, { id: 'dc', positions: ['DEL'] },
  ].map((p) => ({ ...p, played: 0 }));
  const l = optimizeLineup({ slots, players });
  assert.deepEqual([l.POR, l.DEF1, l.DEF2, l.DEF3], ['gk', 'li', 'dfc', 'ld']);
});

test('en 1-2-3-1 un lateral puede cubrir la defensa de su lado', () => {
  const [, d1, d2] = FORMATIONS['2-3-1'].slots;
  assert.equal(fitFor(['LI'], d1), 'yes');
  assert.equal(fitFor(['LI'], d2), 'line');
  assert.equal(fitFor(['MED'], d2), 'no');
});

test('migración de DEF antiguo', () => {
  assert.deepEqual(migratePositions(['DEF', 'MED']), ['LI', 'DFC', 'LD', 'MED']);
});

test('cambio no previsto: recomienda al del banquillo que encaja y menos ha jugado', () => {
  const slots = FORMATIONS['3-2-1'].slots;
  const players = [
    { id: 'gk', positions: ['POR'], played: 600 }, { id: 'li', positions: ['LI'], played: 600 }, { id: 'ld', positions: ['LD'], played: 600 },
    { id: 'dfc', positions: ['DFC'], played: 600 }, { id: 'm1', positions: ['MED'], played: 600 }, { id: 'm2', positions: ['MED'], played: 600 },
    { id: 'dc', positions: ['DEL'], played: 600 },
    { id: 'b1', positions: ['MED'], played: 0 }, { id: 'b2', positions: ['LD', 'LI'], played: 300 }, { id: 'b3', positions: ['LD'], played: 100 },
  ];
  const lineup = { POR: 'gk', DEF1: 'li', DEF2: 'dfc', DEF3: 'ld', MED1: 'm1', MED2: 'm2', DEL1: 'dc' };
  const r = recommendReplacement({ slots, players, lineup, outId: 'ld', lockGK: true });
  assert.equal(r.after.DEF3, 'b3');
  assert.deepEqual(r.subs, [{ in: 'b3', out: 'ld', slotId: 'DEF3' }]);
  assert.deepEqual(r.options.map((o) => o.id), ['b3', 'b2', 'b1']);
  assert.equal(r.after.POR, 'gk');
});

test('cada X min con ajuste iguala minutos', () => {
  const ALL = ['LI', 'DFC', 'LD', 'MED', 'DEL'];
  const players = [{ id: 'gk', positions: ['POR'] }, ...Array.from({ length: 9 }, (_, i) => ({ id: 'p' + i, positions: ALL }))].map((p) => ({ ...p, played: 0 }));
  const slots = FORMATIONS['3-2-1'].slots;
  const lineup = optimizeLineup({ slots, players, gkCommitMin: 25 });
  const base = { slots, players, lineup, phase: 'pre', halfLen: HALF, gkHalftimeOnly: true };
  const fixed = intervalPoints(HALF, 300);
  const adjusted = adjustSchedule(base, fixed);
  const spread = (pts) => {
    const r = planMatch({ ...base, points: pts });
    const f = players.slice(1).map((p) => r.projected[p.id] / 60);
    return Math.max(...f) - Math.min(...f);
  };
  assert.ok(spread(adjusted) < spread(fixed));
  assert.ok(spread(adjusted) <= 1, 'dif ' + spread(adjusted));
  adjusted.forEach((p, i) => assert.ok(Math.abs(p.t - fixed[i].t) <= 180));
});

test('aviso de posición con pocos jugadores', () => {
  const slots = FORMATIONS['3-2-1'].slots;
  const ps = [
    { id: 'gk', name: 'GK', positions: ['POR'] }, { id: 'a', name: 'Ana', positions: ['LD'] },
    ...Array.from({ length: 9 }, (_, i) => ({ id: 'x' + i, name: 'X' + i, positions: ['LI', 'DFC', 'MED', 'DEL'] })),
  ];
  const w = positionWarnings(slots, ps);
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].names, ['Ana']);
});

test('primera remesa fijada y después automático: minutos iguales y nadie sale con menos de 5 min', () => {
  const ALL = ['LI', 'DFC', 'LD', 'MED', 'DEL'];
  const slots = FORMATIONS['3-2-1'].slots;
  for (const n of [9, 10, 11, 12]) {
    const players = [{ id: 'gk', positions: ['POR'] }, ...Array.from({ length: n - 1 }, (_, i) => ({ id: 'p' + i, positions: ALL }))].map((p) => ({ ...p, played: 0 }));
    const lineup = optimizeLineup({ slots, players, gkCommitMin: 25 });
    const base = { slots, players, lineup, phase: 'pre', halfLen: HALF, gkHalftimeOnly: true };
    const { points } = chooseSchedule(base, { firstSec: 480 });
    assert.deepEqual(points[0], { h: 1, t: 480 });
    const r = planMatch({ ...base, points });
    assert.equal(r.changes.reduce((a, c) => a + c.shortOuts, 0), 0);
    const f = players.slice(1).map((p) => r.projected[p.id] / 60);
    assert.ok(Math.max(...f) - Math.min(...f) <= 3, `n=${n}: ${f.map((x) => x.toFixed(1)).join(', ')}`);
  }
});

test('no se quita a quien lleva menos de 5 min si se puede evitar', () => {
  const slots = FORMATIONS['3-2-1'].slots;
  const ALL = ['LI', 'DFC', 'LD', 'MED', 'DEL'];
  const players = [{ id: 'gk', positions: ['POR'], played: 600 }, ...Array.from({ length: 9 }, (_, i) => ({ id: 'p' + i, positions: ALL, played: 600, stint: 600 }))];
  players[1].stint = 120; // p0 acaba de entrar
  players[1].played = 700;
  const lineup = { POR: 'gk', DEF1: 'p0', DEF2: 'p1', DEF3: 'p2', MED1: 'p3', MED2: 'p4', DEL1: 'p5' };
  players.slice(7).forEach((p) => { p.played = 300; p.stint = null; });
  const after = optimizeLineup({ slots, players, current: lineup, gapMin: 5, hysteresisMin: 1 });
  assert.ok(Object.values(after).includes('p0'), 'p0 sigue en el campo');
});

test('plantillas variadas de 10 de campo: plan afinado con diferencia pequeña', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ROLES5 = ['LI', 'DFC', 'LD', 'MED', 'DEL'];
  const spreads = [];
  for (let r = 0; r < 10; r++) {
    const players = [{ id: 'gk', positions: ['POR'], played: 0 }];
    for (let i = 0; i < 10; i++) {
      const pos = new Set();
      const k = 1 + Math.floor(rnd() * 3);
      while (pos.size < k) pos.add(ROLES5[Math.floor(rnd() * 5)]);
      players.push({ id: 'p' + i, positions: [...pos], played: 0 });
    }
    const slots = FORMATIONS[r % 2 ? '2-3-1' : '3-2-1'].slots;
    const lineup = optimizeLineup({ slots, players, gkCommitMin: 25 });
    const base = { slots, players, lineup, phase: 'pre', halfLen: HALF, gkHalftimeOnly: true };
    const plan = planMatchRefined({ ...base, points: chooseSchedule(base, { firstSec: 480 }).points });
    const f = players.slice(1).map((p) => plan.projected[p.id] / 60);
    spreads.push(Math.max(...f) - Math.min(...f));
    assert.equal(plan.projected.gk, 50 * 60, 'el portero puro no sale de la portería');
  }
  assert.ok(Math.max(...spreads) <= 2.5, spreads.join(', '));
});

test('la primera remesa fijada siempre tiene cambios, sea cual sea el minuto', () => {
  const slots = FORMATIONS['3-2-1'].slots;
  const roster = [['POR'], ['LI', 'DFC'], ['DFC', 'MED'], ['LD', 'MED'], ['MED', 'DEL'], ['MED'], ['DEL', 'MED'], ['LI', 'LD', 'DFC'], ['DFC', 'MED'], ['MED', 'DEL'], ['LD', 'MED'], ['MED', 'DEL']];
  for (const n of [9, 10, 11, 12]) {
    for (let m = 2; m <= 20; m++) {
      const players = roster.slice(0, n).map((pos, i) => ({ id: 'p' + i, positions: pos, played: 0 }));
      const lineup = optimizeLineup({ slots, players, gkCommitMin: 25 });
      const base = { slots, players, lineup, phase: 'pre', halfLen: HALF, gkHalftimeOnly: true, mustChange: [`1-${m * 60}`] };
      const plan = planMatchRefined({ ...base, points: chooseSchedule(base, { firstSec: m * 60 }).points });
      const first = plan.changes.find((c) => c.subs.length);
      assert.equal(first.half === 1 && first.t, m * 60, `n=${n}, min ${m}: primer cambio en ${first.half}ª ${first.t / 60}`);
    }
  }
});

test('nadie pasa más de 9 min seguidos en el banquillo (9 a 13 convocados)', () => {
  const R5 = ['LI', 'DFC', 'LD', 'MED', 'DEL'];
  for (const n of [9, 10, 11, 12, 13]) {
    const players = [{ id: 'gk', positions: ['POR'], played: 0 }];
    for (let i = 0; i < n - 1; i++) players.push({ id: 'p' + i, positions: [R5[i % 5], R5[(i + 2) % 5]], played: 0 });
    const slots = FORMATIONS['3-2-1'].slots;
    const lineup = optimizeLineup({ slots, players, gkCommitMin: 25 });
    const base = { slots, players, lineup, phase: 'pre', halfLen: HALF, gkHalftimeOnly: true, mustChange: ['1-480'], maxBenchMin: 9 };
    const plan = planMatchRefined({ ...base, points: chooseSchedule(base, { firstSec: 480 }).points });
    const nom = (c) => (c.half - 1) * HALF + c.t;
    const since = {};
    let worst = 0;
    for (const p of players.slice(1)) if (!Object.values(lineup).includes(p.id)) since[p.id] = 0;
    for (const c of plan.changes) {
      for (const s of c.subs) {
        if (s.in && since[s.in] != null) { worst = Math.max(worst, nom(c) - since[s.in]); delete since[s.in]; }
        if (s.out) since[s.out] = nom(c);
      }
    }
    for (const v of Object.values(since)) worst = Math.max(worst, 2 * HALF - v);
    assert.ok(worst <= 9 * 60 + 1, `n=${n}: ${(worst / 60).toFixed(1)} min seguidos en el banquillo`);
    assert.equal(plan.changes.reduce((a, c) => a + c.shortOuts, 0), 0, `n=${n}: alguien sale con menos de 5 min`);
  }
});

test('posiciones en orden de preferencia', () => {
  const [, li, dfc] = FORMATIONS['3-2-1'].slots;
  assert.equal(rankFor(['MED', 'DFC', 'LI'], dfc), 1);
  assert.equal(rankFor(['MED', 'DFC', 'LI'], li), 2);
  assert.equal(rankFor(['POR', 'DFC'], dfc), 0, 'la portería no cuenta en el orden de campo');
  assert.ok(positionCost(['DFC', 'LI'], dfc) < positionCost(['LI', 'DFC'], dfc));
  assert.ok(positionCost(['LD'], li) < positionCost(['MED'], li), 'misma línea antes que otra línea');
  // En igualdad de minutos, cada uno a su posición preferida
  const slots = FORMATIONS['3-2-1'].slots;
  const players = [
    { id: 'gk', positions: ['POR'] }, { id: 'a', positions: ['LD', 'LI'] }, { id: 'b', positions: ['LI', 'LD'] }, { id: 'c', positions: ['DFC'] },
    { id: 'm1', positions: ['MED'] }, { id: 'm2', positions: ['MED'] }, { id: 'd', positions: ['DEL'] },
  ].map((p) => ({ ...p, played: 0 }));
  const l = optimizeLineup({ slots, players });
  assert.equal(l.DEF1, 'b'); // LI
  assert.equal(l.DEF3, 'a'); // LD
});

test('aviso de línea justa (convocatoria real del equipo)', () => {
  const slots = FORMATIONS['3-2-1'].slots;
  const real = { Maza: ['POR'], Andoni: ['LI', 'DFC', 'LD'], Zaldua: ['LI', 'LD'], Lu: ['LI', 'DFC'], Guerre: ['LD', 'LI', 'DFC'], Jontxo: ['LI', 'DFC', 'LD', 'MED', 'DEL'], Sarasua: ['MED'], Pika: ['MED', 'DEL'], Oier: ['MED', 'DEL'], Txipi: ['MED', 'DEL'], Peru: ['DEL'] };
  const players = Object.entries(real).map(([id, positions]) => ({ id, positions }));
  // Con estas posiciones las líneas están cubiertas (Jontxo cubre lo que falta)
  assert.deepEqual(lineWarnings(slots, players), []);
  // Sin Jontxo, sí falta gente atrás
  const sinJontxo = players.filter((p) => p.id !== 'Jontxo').concat([{ id: 'x', positions: ['MED'] }]);
  assert.ok(lineWarnings(slots, sinJontxo).some((w) => w.line === 'DEF'));
});

test('reglas de tiempo seguido: se aplican si dejan jugar a todos lo mismo y si no se relajan', () => {
  const slots = FORMATIONS['3-2-1'].slots;
  const ALL = ['LI', 'DFC', 'LD', 'MED', 'DEL'];
  const players = [{ id: 'gk', positions: ['POR'], played: 0 }, ...Array.from({ length: 9 }, (_, i) => ({ id: 'p' + i, positions: ALL, played: 0 }))];
  const lineup = optimizeLineup({ slots, players, gkCommitMin: 25 });
  const base = { slots, players, lineup, phase: 'pre', halfLen: HALF, gkHalftimeOnly: true, mustChange: ['1-480'] };
  const r = chooseScheduleWithRules(base, { firstSec: 480, minStintMin: 7, maxBenchMin: 8 });
  assert.deepEqual(r.rules, { minStintMin: 7, maxBenchMin: 8 });
  assert.equal(r.relaxed, false);
  assert.ok(r.spread <= 2);
});
