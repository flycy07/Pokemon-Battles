const test = require('node:test');
const assert = require('node:assert');

// Risposte finte nello stesso formato di PokéAPI.
const MOVES = {
  thunderbolt: { name: 'thunderbolt', power: 90, accuracy: 100, type: { name: 'electric' }, damage_class: { name: 'special' } },
  'quick-attack': { name: 'quick-attack', power: 40, accuracy: 100, type: { name: 'normal' }, damage_class: { name: 'physical' } },
  'iron-tail': { name: 'iron-tail', power: 100, accuracy: 75, type: { name: 'steel' }, damage_class: { name: 'physical' } },
  growl: { name: 'growl', power: null, accuracy: 100, type: { name: 'normal' }, damage_class: { name: 'status' } },
  'hyper-beam': { name: 'hyper-beam', power: 150, accuracy: 90, type: { name: 'normal' }, damage_class: { name: 'special' } },
};

function fakePokemon(id) {
  return {
    id,
    name: `mon-${id}`,
    species: { name: `mon-${id}` },
    types: [{ type: { name: 'electric' } }],
    stats: [
      ['hp', 35], ['attack', 55], ['defense', 40], ['special-attack', 50], ['special-defense', 50], ['speed', 90],
    ].map(([n, v]) => ({ base_stat: v, stat: { name: n } })),
    moves: Object.keys(MOVES).map((m) => ({ move: { name: m, url: `https://pokeapi.co/api/v2/move/${m}` } })),
    sprites: { other: { 'official-artwork': { front_default: 'https://img/x.png' } } },
  };
}

global.fetch = async (url) => {
  const mon = url.match(/\/pokemon\/(\d+)$/);
  const mv = url.match(/\/move\/([\w-]+)$/);
  const body = mon ? fakePokemon(Number(mon[1])) : MOVES[mv[1]];
  return { ok: true, json: async () => body };
};

const { buildMon, randomTeam } = require('../src/pokeapi');

test('buildMon calcola statistiche e sceglie 4 mosse offensive valide', async () => {
  const m = await buildMon(25);
  assert.strictEqual(m.name, 'Mon 25');
  assert.deepStrictEqual(m.types, ['electric']);
  assert.strictEqual(m.stats.hp, Math.floor(((2 * 35 + 31) * 50) / 100) + 60);
  assert.strictEqual(m.hp, m.maxHp);
  assert.strictEqual(m.moves.length, 4);
  for (const mv of m.moves) {
    assert.ok(mv.power > 0 && ['physical', 'special'].includes(mv.cls));
  }
  const names = m.moves.map((x) => x.name);
  assert.ok(!names.includes('Growl'), 'le mosse di stato vanno escluse');
  assert.ok(!names.includes('Hyper Beam'), 'le mosse con ricarica vanno escluse');
  assert.ok(names.includes('Tackle'), 'se mancano mosse si riempie con Tackle');
});

test('randomTeam dà 3 Pokémon distinti', async () => {
  const team = await randomTeam(3);
  assert.strictEqual(team.length, 3);
  assert.strictEqual(new Set(team.map((m) => m.id)).size, 3);
});
