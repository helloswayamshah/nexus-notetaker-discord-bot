const path = require('node:path');
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const { VoiceSession, waitUntilReady } = require('../voice/voiceSession');
const { getSession, setSession } = require('../voice/sessionManager');
const { DATA_DIR } = require('../config/db');
const { createLogger } = require('../utils/logger');

const log = createLogger('cmd:join');

const data = new SlashCommandBuilder()
  .setName('join')
  .setDescription('Join your current voice channel and start recording.')
  .setDMPermission(false);

async function execute(interaction) {
  const flowLog = log.child(interaction.guildId);

  if (getSession(interaction.guildId)) {
    flowLog.info('rejected: session already active');
    return interaction.reply({
      content: 'A recording session is already active. Run `/leave` to finish it first.',
      flags: MessageFlags.Ephemeral,
    });
  }

  let guild = interaction.guild;
  if (!guild) {
    try {
      guild = await interaction.client.guilds.fetch(interaction.guildId);
    } catch (err) {
      flowLog.error('guild fetch failed', { err });
      return interaction.reply({
        content: `Could not resolve this server: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  let voiceState = guild.voiceStates.cache.get(interaction.user.id);
  if (!voiceState?.channelId) {
    try {
      voiceState = await guild.voiceStates.fetch(interaction.user.id);
    } catch (err) {
      flowLog.debug('voice state fetch failed', { err });
      voiceState = null;
    }
  }
  const channelId = voiceState?.channelId;
  if (!channelId) {
    flowLog.info('user not in voice channel', { userId: interaction.user.id });
    return interaction.reply({
      content: 'You need to be in a voice channel first.',
      flags: MessageFlags.Ephemeral,
    });
  }
  const voiceChannel =
    guild.channels.cache.get(channelId)
    ?? await guild.channels.fetch(channelId).catch(() => null);
  if (!voiceChannel) {
    flowLog.warn('could not access voice channel', { channelId });
    return interaction.reply({
      content: 'Could not access the voice channel you are in.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  flowLog.info('joining voice', { channelId: voiceChannel.id, channelName: voiceChannel.name });

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: interaction.guildId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
    debug: process.env.VOICE_DEBUG === '1',
  });

  const voiceLog = flowLog.child('conn');
  connection.on('stateChange', (oldState, newState) => {
    voiceLog.info('state change', {
      from: oldState.status,
      to: newState.status,
      reason: newState.reason,
    });
  });
  connection.on('debug', (msg) => voiceLog.debug('ws', { msg }));
  connection.on('error', (err) => voiceLog.error('connection error', { err }));

  try {
    const readyTimer = flowLog.time('voice ready');
    await waitUntilReady(connection);
    readyTimer.end('voice connected');
  } catch (err) {
    flowLog.error('voice failed to reach Ready', { err });
    try {
      connection.destroy();
    } catch {}
    return interaction.editReply(`Failed to connect to voice: ${err.message}`);
  }

  const sessionDir = path.join(DATA_DIR, 'sessions', `${interaction.guildId}_${Date.now()}`);
  const session = new VoiceSession({
    connection,
    guildId: interaction.guildId,
    channelId: voiceChannel.id,
    outDir: sessionDir,
    resolveDisplayName: async (userId) => {
      try {
        const guildMember = await guild.members.fetch(userId);
        return guildMember.displayName || guildMember.user.username || userId;
      } catch {
        return userId;
      }
    },
  });
  session.start();
  setSession(interaction.guildId, session);
  flowLog.info('session registered', { sessionDir });

  await interaction.editReply(
    `Recording **${voiceChannel.name}**. Run \`/leave\` when the call ends.`
  );
}

module.exports = { data, execute };
