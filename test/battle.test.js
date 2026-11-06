const test = require('node:test');
const assert = require('node:assert');
const { Battle } = require('../src/battle');
const { effectiveness } = require('../src/typeChart');

function mon(name, types, spe, hp = 150) {
  return {
    name,
    types,
    stats: { hp, atk: 100, def: 80, spa: 100, spd: 80, spe },
    maxHp: hp,
    hp,
    moves: [
      { name: 'Tackle', type: 'normal', power: 40, accuracy: 100, cls: 'physical' },
      { name: 'Ember', type: 'fire', power: 40, accuracy: 100, cls: 'special' },
    ],
  };
}

const mk = (teamA, teamB) =>
  new Battle('t', { id: 'a', name: 'A', team: teamA }, { id: 'b', name: 'B', team: teamB });

test('tabella dei tipi', () => {
  assert.strictEqual(effectiveness('fire', ['grass']), 2);
  assert.strictEqual(effectiveness('water', ['fire', 'rock']), 4);
  assert.strictEqual(effectiveness('normal', ['ghost']), 0);
  assert.strictEqual(effectiveness('electric', ['ground']), 0);
});

test('il turno si risolve solo con entrambe le scelte', () => {
  const b = mk([mon('X', ['normal'], 50)], [mon('Y', ['normal'], 60)]);
  assert.ok(b.submit(0, { type: 'move', idx: 0 }).ok);
  assert.strictEqual(b.ready(), false);
  assert.strictEqual(b.submit(0, { type: 'move', idx: 1 }).ok, false); // doppia scelta
  assert.ok(b.submit(1, { type: 'move', idx: 0 }).ok);
  assert.strictEqual(b.ready(), true);
  b.resolve();
  assert.ok(b.activeMon(0).hp < 150 && b.activeMon(1).hp < 150);
  assert.strictEqual(b.turn, 2);
});

test('il più veloce attacca per primo e il KO salta la risposta', () => {
  const fast = mon('Fast', ['normal'], 200, 300);
  const slow = mon('Slow', ['normal'], 10, 1);
  fast.moves[0].power = 120;
  const b = mk([fast, mon('F2', ['normal'], 5)], [slow, mon('S2', ['normal'], 5)]);
  b.submit(0, { type: 'move', idx: 0 });
  b.submit(1, { type: 'move', idx: 0 });
  b.resolve();
  assert.strictEqual(fast.hp, 300); // Slow è esausto prima di agire
  assert.strictEqual(b.phase, 'forceSwitch');
  assert.deepStrictEqual([...b.needSwitch], [1]);
});

test('cambio forzato e poi ritorno alla fase di scelta', () => {
  const b = mk(
    [mon('A1', ['normal'], 200, 300), mon('A2', ['normal'], 5)],
    [mon('B1', ['normal'], 10, 1), mon('B2', ['normal'], 5)],
  );
  b.submit(0, { type: 'move', idx: 0 });
  b.submit(1, { type: 'move', idx: 0 });
  b.resolve();
  assert.strictEqual(b.submit(0, { type: 'switch', idx: 1 }).ok, false); // non tocca a lui
  assert.strictEqual(b.submit(1, { type: 'move', idx: 0 }).ok, false); // deve cambiare
  assert.strictEqual(b.submit(1, { type: 'switch', idx: 0 }).ok, false); // esausto
  assert.ok(b.submit(1, { type: 'switch', idx: 1 }).ok);
  assert.ok(b.ready());
  b.resolve();
  assert.strictEqual(b.phase, 'choose');
  assert.strictEqual(b.activeMon(1).name, 'B2');
});

test('vittoria quando cade l\'ultimo Pokémon', () => {
  const fast = mon('Fast', ['normal'], 200, 300);
  const b = mk([fast], [mon('Slow', ['normal'], 10, 1)]);
  b.submit(0, { type: 'move', idx: 0 });
  b.submit(1, { type: 'move', idx: 0 });
  b.resolve();
  assert.strictEqual(b.phase, 'over');
  assert.strictEqual(b.winner, 0);
});

test('resa', () => {
  const b = mk([mon('A', ['normal'], 5)], [mon('B', ['normal'], 5)]);
  b.forfeit(0);
  assert.strictEqual(b.winner, 1);
  assert.strictEqual(b.phase, 'over');
});

test('partita simulata completa termina sempre', () => {
  for (let n = 0; n < 200; n++) {
    const b = mk(
      [mon('A1', ['fire'], 80), mon('A2', ['water'], 60), mon('A3', ['grass'], 40)],
      [mon('B1', ['grass'], 70), mon('B2', ['normal'], 50), mon('B3', ['ghost'], 30)],
    );
    let guard = 0;
    while (b.phase !== 'over' && guard++ < 500) {
      for (const pi of b.waitingFor()) {
        const p = b.players[pi];
        const alive = p.team.map((m, i) => i).filter((i) => p.team[i].hp > 0 && i !== p.active);
        if (b.phase === 'forceSwitch') b.submit(pi, { type: 'switch', idx: alive[0] });
        else b.submit(pi, { type: 'move', idx: Math.floor(Math.random() * 2) });
      }
      b.resolve();
    }
    assert.strictEqual(b.phase, 'over');
    assert.ok(b.winner === 0 || b.winner === 1);
  }
});
