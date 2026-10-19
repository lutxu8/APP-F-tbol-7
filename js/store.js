// Persistencia en el propio dispositivo (localStorage).
import { migratePositions } from './logic.js';

const KEY = 'futbol7-rotaciones.v1';

export const DEFAULT_SETTINGS = { teamName: 'Mi equipo', halfMinutes: 25, maxSquad: 12, maxBench: 8, minStint: 7 };

function fresh() {
  return { version: 1, players: [], matches: [], settings: { ...DEFAULT_SETTINGS }, setup: null, live: null };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const db = JSON.parse(raw);
    for (const p of db.players || []) p.positions = migratePositions(p.positions);
    const settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
    // Reglas pedidas por el equipo: mínimo 7' en el campo y máximo 8' en el banquillo.
    if (!settings.rulesV2) { settings.minStint = 7; if (Number(settings.maxBench) === 9) settings.maxBench = 8; settings.rulesV2 = true; }
    return { ...fresh(), ...db, settings };
  } catch (e) {
    console.error(e);
    return fresh();
  }
}

export function save(db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    console.error(e);
    alert('No se han podido guardar los datos en el dispositivo.');
  }
}

export function exportJSON(db, { compact = false } = {}) {
  const { players, settings } = db;
  // En compacto (para pegar en un mensaje) se quita el registro de cambios de cada
  // partido, que no hace falta para las estadísticas, y los espacios de formato.
  const matches = compact ? db.matches.map(({ log, ...m }) => m) : db.matches;
  const data = { app: 'futbol7-rotaciones', version: 1, exportedAt: new Date().toISOString(), players, matches, settings };
  return compact ? JSON.stringify(data) : JSON.stringify(data, null, 2);
}

export function importJSON(db, text) {
  // Tolera BOM, espacios y texto alrededor (p. ej. si se pegó desde un mensaje de WhatsApp).
  let t = String(text || '').replace(/^\uFEFF/, '').trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first < 0 || last < first) throw new Error('No hay datos de la app en lo que has elegido o pegado.');
  t = t.slice(first, last + 1);
  let data;
  try { data = JSON.parse(t); } catch (e) { throw new Error('Los datos están incompletos o dañados. Pide que te los vuelvan a enviar.'); }
  if (!Array.isArray(data.players)) throw new Error('No es una copia de seguridad de esta app.');
  if (!Array.isArray(data.matches)) data.matches = [];
  for (const p of data.players) p.positions = migratePositions(p.positions);
  return { ...db, players: data.players, matches: data.matches, settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) }, setup: null, live: null };
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}
