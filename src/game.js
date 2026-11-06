const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
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
const prices = { pokeball: 100, potion: 50 };
const labels = { pokeball: 'Poké Ball', potion: 'Pozione' };
function profile(id) {
  if (!STORE.users[id]) STORE.users[id] = { coins: 200, inventory: { pokeball: 3, potion: 2 }, team: [] };
  return STORE.users[id];
}
function allowed(i) {
  if (!STORE.channelId || i.commandName === 'canale') return true;
  return i.channelId === STORE.channelId;
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
module.exports = { gameCommands, handleGameCommand, handleWildButton, isAllowedChannel: allowed, getGameStats: () => ({ channelId: STORE.channelId, encounters: encounters.size }) };
