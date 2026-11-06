require('dotenv').config();

const crypto = require('node:crypto');
const {
  Client,
  GatewayIntentBits,
  Events,
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');

const { Battle } = require('./battle');
const { randomTeam, cacheSize } = require('./pokeapi');
const { createStatusServer } = require('./status');
const { battlePayload, moveMenu, switchMenu, challengeButtons } = require('./ui');
const { gameCommands, handleGameCommand, handleWildButton, handleTradeInteraction, handleShopButton, isAllowedChannel, getGameStats } = require('./game');

const TURN_TIMEOUT_MS = 2 * 60 * 1000;
const CHALLENGE_TIMEOUT_MS = 60 * 1000;
const TEAM_SIZE = 3;

const battles = new Map(); // battleId -> Battle
const userBattle = new Map(); // userId -> battleId
const challenges = new Map(); // challengeId -> { challenger, target, timer }

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('battaglia')
    .setDescription('Battaglie Pokémon')
    .addSubcommand((s) =>
      s
        .setName('sfida')
        .setDescription('Sfida un altro utente a una battaglia 3v3')
        .addUserOption((o) => o.setName('utente').setDescription("L'avversario").setRequired(true)),
    )
    .addSubcommand((s) => s.setName('annulla').setDescription('Annulla la tua battaglia in corso')),
].map((c) => c.toJSON()).concat(gameCommands());

// ---------- helpers ----------

const newId = () => crypto.randomBytes(4).toString('hex');

function busy(userId) {
  return userBattle.has(userId);
}

function armTimer(battle) {
  clearTimeout(battle.timer);
  battle.timer = setTimeout(() => onTimeout(battle), TURN_TIMEOUT_MS);
}

async function editMain(battle) {
  try {
    await battle.message.edit(battlePayload(battle));
  } catch (err) {
    console.error('Impossibile aggiornare il messaggio di battaglia:', err.message);
  }
}

function cleanup(battle) {
  clearTimeout(battle.timer);
  battles.delete(battle.id);
  for (const p of battle.players) {
    if (userBattle.get(p.id) === battle.id) userBattle.delete(p.id);
  }
}

async function finish(battle) {
  await editMain(battle);
  cleanup(battle);
}

async function onTimeout(battle) {
  if (battle.phase === 'over') return;
  const waiting = battle.waitingFor();
  if (waiting.length === 1) {
    battle.forfeit(waiting[0]);
    battle.log = [`⏰ **${battle.players[waiting[0]].name}** ha esaurito il tempo e perde la battaglia.`];
  } else {
    battle.phase = 'over';
    battle.winner = null;
    battle.log = ['⏰ Nessuno ha giocato in tempo: battaglia annullata.'];
  }
  await finish(battle);
}

// ---------- slash command ----------

async function handleCommand(i) {
  if (!isAllowedChannel(i)) return i.reply({ content: `Puoi usare il bot solo in <#${getGameStats().channelId}>.`, flags: MessageFlags.Ephemeral });
  const sub = i.options.getSubcommand();

  if (sub === 'annulla') {
    const bid = userBattle.get(i.user.id);
    const battle = bid && battles.get(bid);
    if (!battle) return i.reply({ content: 'Non hai battaglie in corso.', flags: MessageFlags.Ephemeral });
    battle.forfeit(battle.playerIndex(i.user.id));
    await i.reply({ content: 'Hai lasciato la battaglia.', flags: MessageFlags.Ephemeral });
    return finish(battle);
  }

  // sfida
  const target = i.options.getUser('utente');
  if (target.bot) return i.reply({ content: 'Non puoi sfidare un bot.', flags: MessageFlags.Ephemeral });
  if (target.id === i.user.id) return i.reply({ content: 'Non puoi sfidare te stesso.', flags: MessageFlags.Ephemeral });
  if (busy(i.user.id)) return i.reply({ content: 'Sei già in una battaglia.', flags: MessageFlags.Ephemeral });
  if (busy(target.id)) return i.reply({ content: `${target} è già in una battaglia.`, flags: MessageFlags.Ephemeral });

  const id = newId();
  await i.reply({
    content: `${target}, **${i.user.displayName}** ti sfida a una battaglia Pokémon 3v3! Hai 60 secondi per rispondere.`,
    components: challengeButtons(id),
    allowedMentions: { users: [target.id] },
  });
  const message = await i.fetchReply();

  const timer = setTimeout(async () => {
    if (!challenges.delete(id)) return;
    await message
      .edit({ content: `⌛ La sfida a ${target} è scaduta.`, components: challengeButtons(id, true) })
      .catch(() => {});
  }, CHALLENGE_TIMEOUT_MS);

  challenges.set(id, { challenger: i.user, target, timer });
}

// ---------- challenge buttons ----------

async function handleChallenge(i, id, action) {
  if (!isAllowedChannel(i)) return i.reply({ content: `Puoi usare il bot solo in <#${getGameStats().channelId}>.`, flags: MessageFlags.Ephemeral });
  const ch = challenges.get(id);
  if (!ch) return i.reply({ content: 'Questa sfida non è più valida.', flags: MessageFlags.Ephemeral });
  if (i.user.id !== ch.target.id) {
    return i.reply({ content: 'Solo lo sfidato può rispondere.', flags: MessageFlags.Ephemeral });
  }

  clearTimeout(ch.timer);
  challenges.delete(id);

  if (action === 'dec') {
    return i.update({ content: `✖️ ${ch.target.displayName} ha rifiutato la sfida.`, components: [] });
  }

  if (busy(ch.challenger.id) || busy(ch.target.id)) {
    return i.update({ content: 'Uno dei due è già in un\'altra battaglia.', components: [] });
  }

  await i.update({ content: '🎲 Preparo le squadre…', components: [] });

  let teams;
  try {
    teams = await Promise.all([randomTeam(TEAM_SIZE), randomTeam(TEAM_SIZE)]);
  } catch (err) {
    console.error('Errore PokéAPI:', err);
    return i.message.edit({ content: '❌ Non riesco a contattare PokéAPI, riprova tra poco.' }).catch(() => {});
  }

  if (busy(ch.challenger.id) || busy(ch.target.id)) {
    return i.message.edit({ content: 'Uno dei due è già in un\'altra battaglia.' }).catch(() => {});
  }

  const battle = new Battle(
    newId(),
    { id: ch.challenger.id, name: ch.challenger.displayName, team: teams[0] },
    { id: ch.target.id, name: ch.target.displayName, team: teams[1] },
  );
  battle.message = i.message;
  battles.set(battle.id, battle);
  userBattle.set(ch.challenger.id, battle.id);
  userBattle.set(ch.target.id, battle.id);

  armTimer(battle);
  await editMain(battle);
}

// ---------- battle buttons ----------

async function handleBattle(i, bid, kind, arg) {
  if (!isAllowedChannel(i)) return i.reply({ content: `Puoi usare il bot solo in <#${getGameStats().channelId}>.`, flags: MessageFlags.Ephemeral });
  const battle = battles.get(bid);
  if (!battle) return i.reply({ content: 'Questa battaglia è terminata.', flags: MessageFlags.Ephemeral });

  const pi = battle.playerIndex(i.user.id);
  if (pi === -1) return i.reply({ content: 'Non stai partecipando a questa battaglia.', flags: MessageFlags.Ephemeral });

  if (kind === 'ff') {
    await i.deferUpdate();
    battle.forfeit(pi);
    return finish(battle);
  }

  if (kind === 'menu') {
    if (battle.players[pi].action) {
      return i.reply({ content: 'Hai già scelto: aspetta l\'avversario.', flags: MessageFlags.Ephemeral });
    }
    if (battle.phase === 'forceSwitch' && !battle.needSwitch.has(pi)) {
      return i.reply({ content: 'Aspetta che l\'avversario scelga il sostituto.', flags: MessageFlags.Ephemeral });
    }
    if (arg === 'move') {
      if (battle.phase !== 'choose') {
        return i.reply({ content: 'Devi cambiare Pokémon.', flags: MessageFlags.Ephemeral });
      }
      return i.reply({ ...moveMenu(battle, pi), flags: MessageFlags.Ephemeral });
    }
    return i.reply({ ...switchMenu(battle, pi), flags: MessageFlags.Ephemeral });
  }

  // kind === 'm' | 's'
  const action = { type: kind === 'm' ? 'move' : 'switch', idx: Number(arg) };
  const res = battle.submit(pi, action);
  if (!res.ok) return i.update({ content: `❌ ${res.error}`, components: [] });

  await i.update({ content: `✅ Scelto: ${res.label}. In attesa dell'avversario…`, components: [] });

  if (battle.ready()) {
    battle.resolve();
    if (battle.phase === 'over') return finish(battle);
    armTimer(battle);
    await editMain(battle);
  } else {
    armTimer(battle);
  }
}

// ---------- wiring ----------

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand()) {
      if (i.commandName === 'battaglia') return await handleCommand(i);
      return await handleGameCommand(i);
    }

    if (i.isStringSelectMenu() && i.customId.startsWith('trade:')) return await handleTradeInteraction(i);

    if (i.isButton()) {
      const [scope, id, kind, arg] = i.customId.split(':');
      if (scope === 'c') return await handleChallenge(i, id, kind);
      if (scope === 'b') return await handleBattle(i, id, kind, arg);
      if (scope === 'wild') return await handleWildButton(i);
      if (scope === 'trade') return await handleTradeInteraction(i);
      if (scope === 'shop' && kind === 'buy') return await handleShopButton(i);
    }
  } catch (err) {
    console.error('Errore interazione:', err);
    const msg = { content: 'Si è verificato un errore.', flags: MessageFlags.Ephemeral };
    if (i.deferred || i.replied) await i.followUp(msg).catch(() => {});
    else await i.reply(msg).catch(() => {});
  }
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Online come ${c.user.tag}`);
  const guildId = process.env.GUILD_ID;
  if (guildId) {
    const guild = await c.guilds.fetch(guildId);
    await guild.commands.set(commands);
    console.log('Comandi registrati nel server di test.');
  } else {
    await c.application.commands.set(commands);
    console.log('Comandi registrati globalmente (possono impiegare un po\' a comparire).');
  }
});

// Render (Web Service) richiede una porta HTTP in ascolto: qui serviamo la pagina di stato
// che UptimeRobot può pingare per tenere il servizio sveglio.
const port = process.env.PORT || 3000;
createStatusServer(() => ({
  ready: client.isReady(),
  botTag: client.user?.tag,
  servers: client.guilds.cache.size,
  battles: battles.size,
  pokemonCached: cacheSize(),
  version: (process.env.RENDER_GIT_COMMIT || 'locale').slice(0, 7),
  node: process.version,
  uptimeSeconds: process.uptime(),
})).listen(port, () => console.log(`Pagina di stato sulla porta ${port}`));

if (!process.env.DISCORD_TOKEN) {
  console.error('Manca DISCORD_TOKEN nelle variabili d\'ambiente.');
  process.exit(1);
}

process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));
client.login(process.env.DISCORD_TOKEN);
