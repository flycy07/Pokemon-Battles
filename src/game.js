const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { buildMon, randomTeam } = require('./pokeapi');

const DATA_FILE = path.join(process.env.DATA_DIR || process.cwd(), 'data.json');
const STORE = { users: {}, channelId: null };
function load() {
  try { const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); STORE.users = saved.users || {}; STORE.channelId = saved.channelId || null; }
  catch (e) { if (e.code !== 'ENOENT') console.error('Lettura data.json:', e); }
}
function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(STORE, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
load();
const encounters = new Map();
const trades = new Map();
const userTrades = new Map();
const prices = { pokeball: 100, potion: 50 };
const labels = { pokeball: 'Poké Ball', potion: 'Pozione' };
function profile(id) {
  if (!STORE.users[id]) STORE.users[id] = { coins: 200, inventory: { pokeball: 3, potion: 2 }, team: [] };
  return STORE.users[id];
}
function isInConfiguredChannel(i) {
  if (!STORE.channelId) return true;
  return i.channelId === STORE.channelId;
}
function allowed(i) {
  // Solo gli incontri selvatici sono vincolati al canale configurato.
  // Shop, squadra, trade e configurazione restano utilizzabili negli altri canali.
  if (i.commandName !== 'selvatico' && !i.customId?.startsWith('wild:')) return true;
  return isInConfiguredChannel(i);
}
function gameCommands() {
  return [
    new SlashCommandBuilder().setName('selvatico').setDescription('Cerca un Pokémon selvatico e combatti'),
    new SlashCommandBuilder().setName('shop').setDescription('Negozio Pokémon')
      .addSubcommand(s => s.setName('compra').setDescription('Compra strumenti')
        .addStringOption(o => o.setName('oggetto').setDescription('Oggetto').setRequired(true).addChoices(
          { name: 'Poké Ball (100 monete)', value: 'pokeball' }, { name: 'Pozione (50 monete)', value: 'potion' }))
        .addIntegerOption(o => o.setName('quantita').setDescription('Quantità').setMinValue(1).setMaxValue(20)))
      .addSubcommand(s => s.setName('usa').setDescription('Usa una pozione sul tuo Pokémon attivo')
        .addStringOption(o => o.setName('oggetto').setDescription('Oggetto').setRequired(true).addChoices({ name: 'Pozione', value: 'potion' }))),
    new SlashCommandBuilder().setName('squadra').setDescription('Mostra i Pokémon catturati'),
    new SlashCommandBuilder().setName('trade').setDescription('Scambia un Pokémon con un altro giocatore')
      .addUserOption(o => o.setName('utente').setDescription('Giocatore con cui scambiare').setRequired(true))
      .addIntegerOption(o => o.setName('pokemon').setDescription('Numero del tuo Pokémon mostrato da /squadra').setRequired(true).setMinValue(1).setMaxValue(25)),
    new SlashCommandBuilder().setName('canale').setDescription('Configura il canale autorizzato')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(s => s.setName('set').setDescription('Imposta l’unico canale in cui usare il bot')
        .addChannelOption(o => o.setName('canale').setDescription('Canale autorizzato').setRequired(true))),
  ].map(c => c.toJSON());
}
function hpBar(mon) { return '🟥'.repeat(Math.max(0, Math.round(10 * mon.hp / mon.maxHp))) + '⬛'.repeat(10 - Math.max(0, Math.round(10 * mon.hp / mon.maxHp))); }
function encounterPayload(e) {
  const p = e.mon, w = e.wild;
  const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle('🌿 Pokémon selvatico!')
    .setDescription(`**${p.name}** contro **${w.name}**\n\n${p.name}: ${p.hp}/${p.maxHp} PS\n${hpBar(p)}\n\n${w.name}: ${w.hp}/${w.maxHp} PS\n${hpBar(w)}`)
    .setThumbnail(w.sprite || p.sprite || null).setFooter({ text: 'Scegli una mossa oppure prova a catturarlo!' });
  const moves = p.moves.slice(0, 4).map((m, idx) => new ButtonBuilder().setCustomId(`wild:${e.id}:move:${idx}`).setLabel(m.name.slice(0, 80)).setStyle(ButtonStyle.Primary));
  const row1 = new ActionRowBuilder().addComponents(...moves);
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`wild:${e.id}:catch`).setLabel('Lancia Poké Ball').setEmoji('⚾').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`wild:${e.id}:run`).setLabel('Fuggi').setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: [row1, row2] };
}
async function finish(e, text) {
  encounters.delete(e.id);
  if (text) e.message.edit({ content: text, embeds: [], components: [] }).catch(() => {});
}
async function begin(i) {
  const user = profile(i.user.id);
  if (!user.team.length) {
    await i.deferReply();
    user.team = await randomTeam(1);
    save();
  } else await i.deferReply();
  if (encounters.has(i.user.id)) return i.editReply('Hai già un incontro in corso.');
  const wild = (await randomTeam(1))[0];
  const mon = user.team.find(x => x.hp > 0) || user.team[0];
  if (mon.hp <= 0) mon.hp = mon.maxHp;
  const e = { id: crypto.randomBytes(4).toString('hex'), userId: i.user.id, user, mon, wild, message: null };
  encounters.set(i.user.id, e);
  e.message = await i.editReply(encounterPayload(e));
}
async function handleGameCommand(i) {
  if (!allowed(i)) return i.reply({ content: `Puoi usare il bot solo in <#${STORE.channelId}>.`, flags: MessageFlags.Ephemeral });
  if (i.commandName === 'selvatico') return begin(i);
  if (i.commandName === 'trade') return startTrade(i);
  if (i.commandName === 'canale') {
    const channel = i.options.getChannel('canale');
    STORE.channelId = channel.id; save();
    return i.reply({ content: `Canale autorizzato impostato su ${channel}. Da ora gli altri comandi funzionano solo lì.`, flags: MessageFlags.Ephemeral });
  }
  if (i.commandName === 'squadra') {
    const u = profile(i.user.id); save();
    const lines = u.team.length ? u.team.map((m, n) => `**${n + 1}. ${m.name}** — ${m.hp}/${m.maxHp} PS · ${m.types.join('/')}`) : ['Nessun Pokémon catturato.'];
    return i.reply({ content: `🪙 ${u.coins} monete\n⚾ Poké Ball: ${u.inventory.pokeball} · 🧪 Pozioni: ${u.inventory.potion}\n${lines.join('\n')}`, flags: MessageFlags.Ephemeral });
  }
  if (i.commandName === 'shop') {
    const sub = i.options.getSubcommand(), u = profile(i.user.id);
    if (sub === 'compra') {
      const item = i.options.getString('oggetto'), qty = i.options.getInteger('quantita') || 1, total = prices[item] * qty;
      if (u.coins < total) return i.reply({ content: `Non hai abbastanza monete. Servono ${total}, ne hai ${u.coins}.`, flags: MessageFlags.Ephemeral });
      u.coins -= total; u.inventory[item] = (u.inventory[item] || 0) + qty; save();
      return i.reply({ content: `Hai comprato ${qty} ${labels[item]} per ${total} monete. Saldo: ${u.coins} 🪙.`, flags: MessageFlags.Ephemeral });
    }
    const item = i.options.getString('oggetto');
    if (!u.inventory[item]) return i.reply({ content: 'Non hai pozioni. Comprane con /shop compra.', flags: MessageFlags.Ephemeral });
    const mon = u.team.find(x => x.hp > 0 && x.hp < x.maxHp);
    if (!mon) return i.reply({ content: 'Tutti i tuoi Pokémon hanno già tutti i PS.', flags: MessageFlags.Ephemeral });
    u.inventory[item]--; const healed = Math.min(20, mon.maxHp - mon.hp); mon.hp += healed; save();
    return i.reply({ content: `🧪 ${mon.name} recupera ${healed} PS. Pozioni rimaste: ${u.inventory[item]}.`, flags: MessageFlags.Ephemeral });
  }
}

function tradeRows(id, mode) {
  if (mode === 'request') return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(\`trade:\${id}:accept\`).setLabel('Accetta').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(\`trade:\${id}:reject\`).setLabel('Rifiuta').setStyle(ButtonStyle.Danger)
  )];
  if (mode === 'confirm') return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(\`trade:\${id}:confirm\`).setLabel('Conferma scambio').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(\`trade:\${id}:cancel\`).setLabel('Annulla').setStyle(ButtonStyle.Danger)
  )];
  return [];
}
function clearTrade(t) {
  clearTimeout(t.timer);
  trades.delete(t.id);
  userTrades.delete(t.fromId);
  userTrades.delete(t.toId);
}
function tradeSummary(t) {
  return \`🔁 **Proposta di scambio**\n<@\${t.fromId}> offre **\${t.fromPokemon.name}**\n<@\${t.toId}> offre **\${t.toPokemon.name}**\n\nEntrambi devono premere **Conferma scambio** per completare.\`;
}
async function startTrade(i) {
  const target = i.options.getUser('utente');
  const number = i.options.getInteger('pokemon');
  if (target.bot || target.id === i.user.id) return i.reply({ content: 'Scegli un altro giocatore, non un bot o te stesso.', flags: MessageFlags.Ephemeral });
  if (userTrades.has(i.user.id) || userTrades.has(target.id)) return i.reply({ content: 'Tu o l’altro giocatore avete già uno scambio in corso.', flags: MessageFlags.Ephemeral });
  const from = profile(i.user.id), to = profile(target.id);
  const offered = from.team[number - 1];
  if (!offered) return i.reply({ content: 'Numero Pokémon non valido. Controlla /squadra.', flags: MessageFlags.Ephemeral });
  if (!to.team.length) return i.reply({ content: 'L’altro giocatore non ha ancora Pokémon da scambiare.', flags: MessageFlags.Ephemeral });
  const id = crypto.randomBytes(4).toString('hex');
  const t = { id, fromId: i.user.id, toId: target.id, fromPokemon: offered, toPokemon: null, confirmations: new Set(), message: null, timer: null };
  trades.set(id, t);
  userTrades.set(t.fromId, id);
  userTrades.set(t.toId, id);
  await i.reply({ content: \`<@\${target.id}>, <@\${i.user.id}> vuole scambiare **\${offered.name}** con te. Hai 2 minuti per rispondere.\`, components: tradeRows(id, 'request'), allowedMentions: { users: [target.id, i.user.id] } });
  t.message = await i.fetchReply();
  t.timer = setTimeout(() => {
    if (!trades.has(id)) return;
    clearTrade(t);
    t.message.edit({ content: '⌛ Richiesta di scambio scaduta.', components: [] }).catch(() => {});
  }, 120000);
}
async function handleTradeInteraction(i) {
  const [, id, action] = i.customId.split(':');
  const t = trades.get(id);
  if (!t) return i.reply({ content: 'Questo scambio non è più attivo.', flags: MessageFlags.Ephemeral });
  if (action === 'accept') {
    if (i.user.id !== t.toId) return i.reply({ content: 'Solo il giocatore invitato può accettare.', flags: MessageFlags.Ephemeral });
    clearTimeout(t.timer);
    const team = profile(t.toId).team;
    const menu = new StringSelectMenuBuilder()
      .setCustomId(\`trade:\${id}:pick\`)
      .setPlaceholder('Scegli il Pokémon da offrire')
      .addOptions(team.slice(0, 25).map((p, n) => ({
        label: \`\${n + 1}. \${p.name}\`.slice(0, 100),
        value: String(n),
        description: \`\${p.hp}/\${p.maxHp} PS\`.slice(0, 100)
      })));
    t.timer = setTimeout(() => {
      if (!trades.has(id)) return;
      clearTrade(t);
      t.message.edit({ content: '⌛ Scambio scaduto.', components: [] }).catch(() => {});
    }, 120000);
    return i.update({ content: \`<@\${t.toId}>, scegli il Pokémon da offrire in cambio di **\${t.fromPokemon.name}**.\`, components: [new ActionRowBuilder().addComponents(menu)] });
  }
  if (action === 'reject') {
    if (i.user.id !== t.toId) return i.reply({ content: 'Solo il giocatore invitato può rifiutare.', flags: MessageFlags.Ephemeral });
    clearTrade(t);
    return i.update({ content: '❌ Richiesta di scambio rifiutata.', components: [] });
  }
  if (action === 'pick') {
    if (i.user.id !== t.toId) return i.reply({ content: 'Solo il giocatore invitato può scegliere il Pokémon.', flags: MessageFlags.Ephemeral });
    const selected = profile(t.toId).team[Number(i.values[0])];
    if (!selected) return i.reply({ content: 'Pokémon non trovato. Avvia un nuovo scambio.', flags: MessageFlags.Ephemeral });
    t.toPokemon = selected;
    t.confirmations.clear();
    t.timer = setTimeout(() => {
      if (!trades.has(id)) return;
      clearTrade(t);
      t.message.edit({ content: '⌛ Scambio scaduto.', components: [] }).catch(() => {});
    }, 180000);
    return i.update({ content: tradeSummary(t), components: tradeRows(id, 'confirm') });
  }
  if (action === 'cancel') {
    if (i.user.id !== t.fromId && i.user.id !== t.toId) return i.reply({ content: 'Non partecipi a questo scambio.', flags: MessageFlags.Ephemeral });
    clearTrade(t);
    return i.update({ content: '🚫 Scambio annullato. Nessun Pokémon è stato trasferito.', components: [] });
  }
  if (action === 'confirm') {
    if (i.user.id !== t.fromId && i.user.id !== t.toId) return i.reply({ content: 'Non partecipi a questo scambio.', flags: MessageFlags.Ephemeral });
    if (!t.toPokemon) return i.reply({ content: 'Prima scegli il Pokémon da offrire.', flags: MessageFlags.Ephemeral });
    t.confirmations.add(i.user.id);
    if (t.confirmations.size < 2) return i.update({ content: \`\${tradeSummary(t)}\n\n✅ <@\${i.user.id}> ha confermato. In attesa dell’altro giocatore.\`, components: tradeRows(id, 'confirm') });
    const a = profile(t.fromId), b = profile(t.toId);
    const ai = a.team.indexOf(t.fromPokemon), bi = b.team.indexOf(t.toPokemon);
    if (ai < 0 || bi < 0) {
      clearTrade(t);
      return i.update({ content: 'Scambio annullato: uno dei Pokémon non è più disponibile.', components: [] });
    }
    a.team.splice(ai, 1, t.toPokemon);
    b.team.splice(bi, 1, t.fromPokemon);
    save();
    clearTrade(t);
    return i.update({ content: \`🎉 Scambio completato! <@\${t.fromId}> ha ricevuto **\${t.toPokemon.name}** e <@\${t.toId}> ha ricevuto **\${t.fromPokemon.name}**.\`, components: [] });
  }
}

async function handleWildButton(i) {
  if (!allowed(i)) return i.reply({ content: `Puoi usare il bot solo in <#${STORE.channelId}>.`, flags: MessageFlags.Ephemeral });
  const [, id, action, arg] = i.customId.split(':');
  const e = encounters.get(i.user.id);
  if (!e || e.id !== id) return i.reply({ content: 'Questo incontro non è più attivo.', flags: MessageFlags.Ephemeral });
  if (action === 'run') { encounters.delete(i.user.id); return i.update({ content: 'Sei fuggito. Alla prossima!', embeds: [], components: [] }); }
  if (action === 'catch') {
    if (e.wild.hp <= 0) return i.reply({ content: 'Il Pokémon è esausto e non può essere catturato.', flags: MessageFlags.Ephemeral });
    if (!e.user.inventory.pokeball) return i.reply({ content: 'Non hai Poké Ball! Comprane con /shop compra.', flags: MessageFlags.Ephemeral });
    e.user.inventory.pokeball--;
    const chance = Math.min(0.9, 0.2 + (1 - e.wild.hp / e.wild.maxHp) * 0.65);
    if (Math.random() < chance) {
      e.user.team.push({ ...e.wild, hp: Math.max(1, e.wild.hp) });
      save(); encounters.delete(i.user.id);
      return i.update({ content: `✨ Hai catturato **${e.wild.name}**! Usa /squadra per vederlo.`, embeds: [], components: [] });
    }
    save();
    if (e.wild.hp <= 0) return i.update({ content: 'Il Pokémon è esausto e non può essere catturato.', embeds: [], components: [] });
    return i.update({ ...encounterPayload(e), content: 'La Poké Ball si è aperta! Riprova o continua a lottare.' });
  }
  if (action === 'move') {
    const move = e.mon.moves[Number(arg)];
    if (!move) return i.reply({ content: 'Mossa non valida.', flags: MessageFlags.Ephemeral });
    const damage = Math.max(1, Math.floor((move.power || 40) * (0.55 + Math.random() * 0.25)));
    e.wild.hp = Math.max(0, e.wild.hp - damage);
    let log = `**${e.mon.name}** usa **${move.name}**: ${damage} danni!`;
    if (e.wild.hp <= 0) {
      e.user.coins += 50; save(); encounters.delete(i.user.id);
      return i.update({ content: `${log}\n🏆 Hai sconfitto **${e.wild.name}** e guadagnato 50 monete!`, embeds: [], components: [] });
    }
    const enemyMove = e.wild.moves[Math.floor(Math.random() * e.wild.moves.length)];
    const enemyDamage = Math.max(1, Math.floor((enemyMove.power || 40) * (0.35 + Math.random() * 0.2)));
    e.mon.hp = Math.max(0, e.mon.hp - enemyDamage);
    log += `\n**${e.wild.name}** risponde con **${enemyMove.name}**: ${enemyDamage} danni.`;
    if (e.mon.hp <= 0) {
      e.user.coins += 15; save(); encounters.delete(i.user.id);
      return i.update({ content: `${log}\n💤 ${e.mon.name} è esausto. Hai ricevuto 15 monete per l'incontro.`, embeds: [], components: [] });
    }
    save();
    return i.update({ ...encounterPayload(e), content: log });
  }
}
module.exports = { gameCommands, handleGameCommand, handleWildButton, handleTradeInteraction, isAllowedChannel: allowed, getGameStats: () => ({ channelId: STORE.channelId, encounters: encounters.size }) };
