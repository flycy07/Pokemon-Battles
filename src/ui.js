const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const TYPE_EMOJI = {
  normal: '⚪', fire: '🔥', water: '💧', electric: '⚡', grass: '🌿', ice: '❄️',
  fighting: '🥊', poison: '☠️', ground: '🌍', flying: '🪽', psychic: '🔮', bug: '🐛',
  rock: '🪨', ghost: '👻', dragon: '🐉', dark: '🌑', steel: '⚙️', fairy: '🧚',
};

const typeLabel = (t) => `${TYPE_EMOJI[t] || ''} ${t}`;

function hpBar(hp, max) {
  const ratio = max ? hp / max : 0;
  let filled = Math.round(ratio * 10);
  if (hp > 0 && filled === 0) filled = 1;
  const color = ratio > 0.5 ? '🟩' : ratio > 0.2 ? '🟨' : '🟥';
  return color.repeat(filled) + '⬛'.repeat(10 - filled);
}

function teamDots(team) {
  return team.map((m) => (m.hp > 0 ? '🔴' : '⚫')).join(' ');
}

function battleEmbed(battle) {
  const [p1, p2] = battle.players;
  const m1 = p1.team[p1.active];
  const m2 = p2.team[p2.active];

  const field = (p, m) => ({
    name: `${p.name} — ${m.name}`,
    value:
      `${m.types.map(typeLabel).join(' · ')}\n` +
      `${hpBar(m.hp, m.maxHp)}\n` +
      `**${m.hp}/${m.maxHp}** PS\n` +
      `Squadra: ${teamDots(p.team)}`,
    inline: true,
  });

  const embed = new EmbedBuilder()
    .setColor(battle.phase === 'over' ? 0xf1c40f : 0x3498db)
    .setTitle(`⚔️ ${p1.name} vs ${p2.name}`)
    .addFields(field(p1, m1), field(p2, m2));

  if (m1.sprite) embed.setThumbnail(m1.sprite);
  if (m2.sprite) embed.setImage(m2.sprite);

  const log = battle.log.join('\n').slice(0, 1800);
  if (log) embed.setDescription(log);

  if (battle.phase === 'over') {
    embed.setFooter({ text: 'Battaglia terminata' });
  } else if (battle.phase === 'forceSwitch') {
    const names = [...battle.needSwitch].map((i) => battle.players[i].name).join(' e ');
    embed.setFooter({ text: `${names}: scegli il prossimo Pokémon` });
  } else {
    embed.setFooter({ text: `Turno ${battle.turn} — scegliete la vostra azione` });
  }
  return embed;
}

function mainButtons(battle) {
  if (battle.phase === 'over') return [];
  const row = new ActionRowBuilder();
  if (battle.phase === 'choose') {
    row.addComponents(
      new ButtonBuilder().setCustomId(`b:${battle.id}:menu:move`).setLabel('Scegli mossa').setEmoji('⚔️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`b:${battle.id}:menu:switch`).setLabel('Cambia').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    );
  } else {
    row.addComponents(
      new ButtonBuilder().setCustomId(`b:${battle.id}:menu:switch`).setLabel('Scegli sostituto').setEmoji('🔄').setStyle(ButtonStyle.Primary),
    );
  }
  row.addComponents(
    new ButtonBuilder().setCustomId(`b:${battle.id}:ff`).setLabel('Arrenditi').setEmoji('🏳️').setStyle(ButtonStyle.Danger),
  );
  return [row];
}

function battlePayload(battle) {
  return { content: '', embeds: [battleEmbed(battle)], components: mainButtons(battle) };
}

/** Menu privato (ephemeral) con le 4 mosse. */
function moveMenu(battle, pi) {
  const mon = battle.activeMon(pi);
  const rows = [];
  for (let i = 0; i < mon.moves.length; i += 2) {
    const row = new ActionRowBuilder();
    for (const [j, mv] of mon.moves.slice(i, i + 2).entries()) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`b:${battle.id}:m:${i + j}`)
          .setLabel(`${mv.name} (${mv.power})`.slice(0, 80))
          .setEmoji(TYPE_EMOJI[mv.type] || '❔')
          .setStyle(ButtonStyle.Primary),
      );
    }
    rows.push(row);
  }
  return { content: `Scegli la mossa per **${mon.name}**:`, components: rows };
}

/** Menu privato (ephemeral) con la squadra. */
function switchMenu(battle, pi) {
  const p = battle.players[pi];
  const row = new ActionRowBuilder();
  p.team.forEach((m, idx) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`b:${battle.id}:s:${idx}`)
        .setLabel(`${m.name} ${m.hp}/${m.maxHp}`.slice(0, 80))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(m.hp <= 0 || idx === p.active),
    );
  });
  const content = battle.phase === 'forceSwitch' ? 'Chi mandi in campo?' : 'Chi vuoi mandare in campo?';
  return { content, components: [row] };
}

function challengeButtons(id, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`c:${id}:acc`).setLabel('Accetta').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId(`c:${id}:dec`).setLabel('Rifiuta').setEmoji('✖️').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    ),
  ];
}

module.exports = { battlePayload, moveMenu, switchMenu, challengeButtons };
