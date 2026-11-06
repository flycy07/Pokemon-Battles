const { effectiveness } = require('./typeChart');

const LEVEL = 50;

/**
 * Stato di una battaglia 1v1 a squadre, a turni.
 * Fasi:
 *  - 'choose'      : entrambi scelgono mossa o cambio
 *  - 'forceSwitch' : chi ha l'attivo esausto deve scegliere un sostituto
 *  - 'over'        : finita
 */
class Battle {
  constructor(id, p1, p2) {
    this.id = id;
    this.players = [p1, p2].map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      active: 0,
      action: null,
    }));
    this.phase = 'choose';
    this.needSwitch = new Set();
    this.turn = 1;
    this.log = [];
    this.winner = null; // indice giocatore
    this.message = null;
    this.timer = null;
  }

  playerIndex(userId) {
    return this.players.findIndex((p) => p.id === userId);
  }

  activeMon(pi) {
    const p = this.players[pi];
    return p.team[p.active];
  }

  /** Chi deve ancora agire in questa fase. */
  waitingFor() {
    if (this.phase === 'choose') {
      return [0, 1].filter((i) => !this.players[i].action);
    }
    if (this.phase === 'forceSwitch') {
      return [...this.needSwitch].filter((i) => !this.players[i].action);
    }
    return [];
  }

  /** Registra una scelta. Ritorna { ok, error?, label? }. */
  submit(pi, action) {
    if (this.phase === 'over') return { ok: false, error: 'La battaglia è finita.' };
    const player = this.players[pi];

    if (this.phase === 'forceSwitch' && !this.needSwitch.has(pi)) {
      return { ok: false, error: "Non devi scegliere ora: aspetta l'avversario." };
    }
    if (player.action) return { ok: false, error: 'Hai già scelto per questo turno.' };

    if (action.type === 'move') {
      if (this.phase !== 'choose') return { ok: false, error: 'Devi cambiare Pokémon.' };
      const move = this.activeMon(pi).moves[action.idx];
      if (!move) return { ok: false, error: 'Mossa non valida.' };
      player.action = action;
      return { ok: true, label: `⚔️ ${move.name}` };
    }

    if (action.type === 'switch') {
      const target = player.team[action.idx];
      if (!target) return { ok: false, error: 'Pokémon non valido.' };
      if (target.hp <= 0) return { ok: false, error: 'Quel Pokémon è esausto.' };
      if (action.idx === player.active) return { ok: false, error: 'È già in campo.' };
      player.action = action;
      return { ok: true, label: `🔄 ${target.name}` };
    }

    return { ok: false, error: 'Azione non valida.' };
  }

  ready() {
    return this.phase !== 'over' && this.waitingFor().length === 0;
  }

  /** Risolve la fase corrente e ritorna le righe di log. */
  resolve() {
    const log = [];

    if (this.phase === 'forceSwitch') {
      for (const pi of this.needSwitch) this._doSwitch(pi, log);
      this.needSwitch.clear();
      this.phase = 'choose';
      this.turn++;
      this.log = log;
      return log;
    }

    // 1) cambi
    for (const pi of [0, 1]) {
      if (this.players[pi].action?.type === 'switch') this._doSwitch(pi, log);
    }

    // 2) mosse, ordinate per velocità
    const attackers = [0, 1]
      .filter((pi) => this.players[pi].action?.type === 'move')
      .map((pi) => ({ pi, speed: this.activeMon(pi).stats.spe, tie: Math.random() }))
      .sort((a, b) => b.speed - a.speed || b.tie - a.tie);

    for (const { pi } of attackers) {
      const attacker = this.activeMon(pi);
      if (attacker.hp <= 0) continue;
      const move = attacker.moves[this.players[pi].action.idx];
      this._doMove(pi, move, log);
      if (this._checkWinner(log)) break;
    }

    for (const p of this.players) p.action = null;

    if (this.phase !== 'over') {
      const faint = [0, 1].filter((pi) => this.activeMon(pi).hp <= 0);
      if (faint.length) {
        this.phase = 'forceSwitch';
        this.needSwitch = new Set(faint);
      } else {
        this.turn++;
      }
    }

    this.log = log;
    return log;
  }

  forfeit(pi) {
    this.winner = 1 - pi;
    this.phase = 'over';
    this.log = [`🏳️ **${this.players[pi].name}** si arrende!`];
  }

  _doSwitch(pi, log) {
    const p = this.players[pi];
    const next = p.team[p.action.idx];
    p.active = p.action.idx;
    p.action = null;
    log.push(`🔄 **${p.name}** manda in campo **${next.name}**!`);
  }

  _doMove(pi, move, log) {
    const attacker = this.activeMon(pi);
    const defender = this.activeMon(1 - pi);

    log.push(`**${attacker.name}** usa **${move.name}**!`);

    if (Math.random() * 100 >= (move.accuracy ?? 100)) {
      log.push('…ma manca il bersaglio!');
      return;
    }

    const eff = effectiveness(move.type, defender.types);
    if (eff === 0) {
      log.push(`Non ha effetto su **${defender.name}**…`);
      return;
    }

    const physical = move.cls === 'physical';
    const A = physical ? attacker.stats.atk : attacker.stats.spa;
    const D = physical ? defender.stats.def : defender.stats.spd;
    const base = Math.floor(Math.floor((Math.floor((2 * LEVEL) / 5 + 2) * move.power * A) / D) / 50) + 2;
    const stab = attacker.types.includes(move.type) ? 1.5 : 1;
    const crit = Math.random() < 1 / 16;
    const rand = 0.85 + Math.random() * 0.15;
    const dmg = Math.max(1, Math.floor(base * stab * eff * rand * (crit ? 1.5 : 1)));

    defender.hp = Math.max(0, defender.hp - dmg);

    const notes = [];
    if (crit) notes.push('💥 Brutto colpo!');
    if (eff > 1) notes.push('È superefficace!');
    if (eff < 1) notes.push('Non è molto efficace…');
    log.push(`${notes.length ? notes.join(' ') + ' ' : ''}−${dmg} PS`);

    if (defender.hp <= 0) log.push(`💀 **${defender.name}** è esausto!`);
  }

  _checkWinner(log) {
    for (const pi of [0, 1]) {
      if (this.players[pi].team.every((m) => m.hp <= 0)) {
        this.winner = 1 - pi;
        this.phase = 'over';
        log.push(`🏆 **${this.players[this.winner].name}** vince la battaglia!`);
        return true;
      }
    }
    return false;
  }
}

module.exports = { Battle, LEVEL };
