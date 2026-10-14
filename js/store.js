// Persistencia en el propio dispositivo (localStorage).

const KEY = 'futbol7-rotaciones.v1';

export const DEFAULT_SETTINGS = { teamName: 'Mi equipo', halfMinutes: 25, maxSquad: 12 };

function fresh() {
  return { version: 1, players: [], matches: [], settings: { ...DEFAULT_SETTINGS }, setup: null, live: null };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const db = JSON.parse(raw);
    return { ...fresh(), ...db, settings: { ...DEFAULT_SETTINGS, ...(db.settings || {}) } };
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

export function exportJSON(db) {
  const { players, matches, settings } = db;
  return JSON.stringify({ app: 'futbol7-rotaciones', version: 1, exportedAt: new Date().toISOString(), players, matches, settings }, null, 2);
}

export function importJSON(db, text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.players) || !Array.isArray(data.matches)) throw new Error('El archivo no es una copia de seguridad válida.');
  return { ...db, players: data.players, matches: data.matches, settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) }, setup: null, live: null };
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}
