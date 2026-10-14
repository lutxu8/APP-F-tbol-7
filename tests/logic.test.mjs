import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATIONS, hungarian, optimizeLineup, planMatch, chooseSchedule, intervalPoints, proposeSquad, diffLineups } from '../js/logic.js';

const HALF = 25 * 60;

function squad(n, { gks = 1, dedicatedGK = true } = {}) {
  const roles = ['DEF', 'MED', 'DEL'];
  const out = [];
  for (let i = 0; i < n; i++) {
    if (i < gks) out.push({ id: 'p' + i, positions: dedicatedGK ? ['POR'] : ['POR', 'DEF'] });
    else out.push({ id: 'p' + i, positions: [roles[i % 3], roles[(i + 1) % 3]] });
  }
  return out;
}

function simulate(players, formation, opts = {}) {
  const slots = FORMATIONS[formation].slots;
  const ps = players.map((p) => ({ ...p, played: 0 }));
  const lineup = optimizeLineup({ slots, players: ps, gkCommitMin: 25 });
  const base = { slots, players: ps, lineup, phase: 'pre', halfLen: HALF, gkHalftimeOnly: opts.gkHalftimeOnly ?? true };
  const points = opts.interval ? intervalPoints(HALF, opts.interval) : chooseSchedule(base).points;
  const { changes, projected } = planMatch({ ...base, points });
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
    assert.ok(p.positions.includes(s.role), `${p.id} en ${s.id}`);
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
      assert.ok(spread <= 5, `diferencia ${spread.toFixed(1)} min: ${field.map((m) => m.toFixed(1)).join(', ')}`);
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
  assert.ok(Math.max(...mins) - Math.min(...mins) <= 6, mins.join(', '));
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
