const { LEVEL } = require('./battle');

const BASE = 'https://pokeapi.co/api/v2';
const MAX_ID = 649; // fino alla Gen 5
const MAX_BST = 600; // esclude i leggendari più forti
const MOVE_CANDIDATES = 12;

// Mosse che richiedono turni di ricarica, auto-KO ecc.: non le gestiamo.
const EXCLUDED_MOVES = new Set([
  'explosion', 'self-destruct', 'hyper-beam', 'giga-impact', 'focus-punch', 'dream-eater',
  'fling', 'last-resort', 'sky-attack', 'solar-beam', 'razor-wind', 'skull-bash', 'sky-drop',
  'solar-blade', 'meteor-beam', 'future-sight', 'doom-desire', 'belch', 'steel-roller',
  'synchronoise', 'ice-spinner', 'rollout', 'ice-ball', 'fury-cutter', 'uproar', 'outrage',
  'thrash', 'petal-dance', 'struggle', 'counter', 'mirror-coat', 'metal-burst', 'bide',
  'endeavor', 'final-gambit', 'return', 'frustration', 'natural-gift', 'trump-card',
  'low-kick', 'grass-knot', 'heavy-slam', 'heat-crash', 'gyro-ball', 'electro-ball',
  'flail', 'reversal', 'present', 'magnitude', 'spit-up',
]);

const cache = new Map();

async function getJson(url, tries = 3) {
  if (cache.has(url)) return cache.get(url);
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`);
      const json = await res.json();
      cache.set(url, json);
      return json;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function prettyName(name) {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function calcStats(base) {
  const other = (b) => Math.floor(((2 * b + 31) * LEVEL) / 100) + 5;
  return {
    hp: Math.floor(((2 * base.hp + 31) * LEVEL) / 100) + LEVEL + 10,
    atk: other(base.attack),
    def: other(base.defense),
    spa: other(base['special-attack']),
    spd: other(base['special-defense']),
    spe: other(base.speed),
  };
}

const FALLBACK_MOVE = { name: 'Tackle', type: 'normal', power: 40, accuracy: 100, cls: 'physical' };

async function pickMoves(data, types) {
  const candidates = shuffle(data.moves)
    .filter((m) => !EXCLUDED_MOVES.has(m.move.name))
    .slice(0, MOVE_CANDIDATES);

  const details = await Promise.all(
    candidates.map((m) => getJson(m.move.url).catch(() => null)),
  );

  const usable = details
    .filter((m) => m && m.power && m.damage_class?.name !== 'status' && m.power <= 150)
    .map((m) => ({
      name: prettyName(m.name),
      type: m.type.name,
      power: m.power,
      accuracy: m.accuracy ?? 100,
      cls: m.damage_class.name,
    }));

  const scored = usable
    .map((m) => ({
      m,
      score:
        m.power * (m.accuracy / 100) * (types.includes(m.type) ? 1.5 : 1) * (0.7 + Math.random() * 0.6),
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m);

  const moves = scored.slice(0, 4);
  while (moves.length < 4) moves.push({ ...FALLBACK_MOVE });
  return moves;
}

async function buildMon(id) {
  const data = await getJson(`${BASE}/pokemon/${id}`);
  const base = Object.fromEntries(data.stats.map((s) => [s.stat.name, s.base_stat]));
  const bst = Object.values(base).reduce((a, b) => a + b, 0);
  const types = data.types.map((t) => t.type.name);
  const stats = calcStats(base);

  return {
    id,
    name: prettyName(data.species?.name || data.name),
    types,
    bst,
    stats,
    maxHp: stats.hp,
    hp: stats.hp,
    moves: await pickMoves(data, types),
    sprite:
      data.sprites?.other?.['official-artwork']?.front_default ||
      data.sprites?.front_default ||
      null,
  };
}

/** Squadra casuale di `size` Pokémon, senza doppioni e senza leggendari "pesanti". */
async function randomTeam(size = 3) {
  const team = [];
  const used = new Set();
  while (team.length < size) {
    const ids = [];
    while (ids.length < size - team.length) {
      const id = 1 + Math.floor(Math.random() * MAX_ID);
      if (!used.has(id)) {
        used.add(id);
        ids.push(id);
      }
    }
    const mons = await Promise.all(ids.map(buildMon));
    team.push(...mons.filter((m) => m.bst < MAX_BST));
  }
  return team;
}

/** Numero di risposte PokéAPI in cache (per la pagina di stato). */
const cacheSize = () => cache.size;

module.exports = { randomTeam, buildMon, cacheSize };
