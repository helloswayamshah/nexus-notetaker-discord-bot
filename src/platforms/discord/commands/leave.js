const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getSession, clearSession } = require('../sessionManager');
const { SAMPLE_RATE, CHANNELS } = require('../voiceSession');
const { DiscordNotificationSink } = require('../DiscordNotificationSink');
const { getTranscriber, getLLM } = require('../../../core/registry');
const { runSummarization, cleanupSession } = require('../../../core/pipeline/runSummarization');
const { SYSTEM_PROMPT, buildUserPrompt } = require('../prompts');
const tenantConfig = require('../../../core/providers/config/sqliteTenantStore');
const { createLogger } = require('../../../core/utils/logger');

const log = createLogger('cmd:leave');
const sink = new DiscordNotificationSink();

const data = new SlashCommandBuilder()
  .setName('leave')
  .setDescription('Stop recording, transcribe the call, and post a summary.')
  .setDMPermission(false);

async function execute(interaction) {
  const session = getSession(interaction.guildId);
  if (!session) {
    return interaction.reply({
      content: 'No active recording session in this server.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const flowLog = log.child(interaction.guildId);
  const flowTimer = flowLog.time('leave flow');

  clearSession(interaction.guildId);

  let segments;
  try {
    flowLog.info('stopping recording');
    segments = await session.stop();
    flowLog.info('session stopped', { totalSegments: segments.length });
  } catch (err) {
    flowTimer.fail('session.stop threw', err);
    await cleanupSession(session.outDir, flowLog);
    return interaction.editReply(`Failed to stop recording: ${err.message}`);
  }

  const cfg = tenantConfig.get({ platform: 'discord', tenantId: interaction.guildId });
  if (!cfg.summary_channel_id) {
    flowLog.warn('no summary channel configured');
    await cleanupSession(session.outDir, flowLog);
    flowTimer.end('leave flow (no summary channel)');
    return interaction.editReply(
      'Left the voice channel, but no summary channel is configured. Run `/config channel channel:<#channel>` and try again next call.'
    );
  }
  const summaryChannel =
    interaction.guild?.channels.cache.get(cfg.summary_channel_id)
    ?? await interaction.guild?.channels.fetch(cfg.summary_channel_id).catch(() => null);
  if (!summaryChannel?.isTextBased()) {
    flowLog.warn('configured summary channel invalid', { channelId: cfg.summary_channel_id });
    await cleanupSession(session.outDir, flowLog);
    flowTimer.end('leave flow (invalid summary channel)');
    return interaction.editReply(
      'Left the voice channel, but the configured summary channel is missing or not a text channel. Run `/config channel` to fix.'
    );
  }

  let transcriber;
  try {
    transcriber = getTranscriber(cfg);
    flowLog.info('transcriber loaded', { provider: cfg.stt_provider });
  } catch (err) {
    flowTimer.fail('getTranscriber failed', err);
    await cleanupSession(session.outDir, flowLog);
    return interaction.editReply(`Transcriber error: ${err.message}`);
  }

  let llm;
  try {
    llm = getLLM(cfg);
    flowLog.info('llm loaded', {
      provider: cfg.llm_provider,
      model: cfg.llm_model,
      baseUrl: cfg.llm_base_url,
    });
  } catch (err) {
    flowTimer.fail('getLLM failed', err);
    await cleanupSession(session.outDir, flowLog);
    return interaction.editReply(`LLM error: ${err.message}`);
  }

  try {
    const result = await runSummarization({
      segments,
      audioFormat: { sampleRate: SAMPLE_RATE, channels: CHANNELS, bitsPerSample: 16 },
      tenantConfig: cfg,
      transcriber,
      llm,
      sink,
      sinkContext: {
        summaryChannel,
        header: `**Call summary** — requested by <@${interaction.user.id}>`,
      },
      logger: flowLog,
      systemPrompt: SYSTEM_PROMPT,
      buildUserPrompt,
      onProgress: (msg) => interaction.editReply(msg),
    });

    await cleanupSession(session.outDir, flowLog);

    switch (result.status) {
      case 'no_audio':
        flowTimer.end('leave flow (no usable audio)');
        return interaction.editReply('Stopped — but no usable audio was captured. Nothing to summarize.');
      case 'transcriber_fatal':
        flowTimer.fail('leave flow (transcriber fatal)', result.fatalErr);
        return interaction.editReply(
          `Transcription aborted: ${result.fatalErr.message}\n\nRun \`/help topic:config-stt\` for setup instructions.`
        );
      case 'no_utterances':
        flowTimer.end('leave flow (no utterances)');
        return interaction.editReply(
          `Transcription produced no usable text (failed segments: ${result.failedSegments}). Check logs for details.`
        );
      case 'llm_error':
        flowTimer.fail('leave flow (llm error)', result.llmErr);
        return interaction.editReply(`LLM error: ${result.llmErr.message}`);
      case 'ok':
        flowTimer.end('leave flow ok');
        return interaction.editReply(`Summary posted to <#${summaryChannel.id}>.`);
      default:
        flowTimer.end('leave flow (unknown status)');
        return interaction.editReply('Something unexpected happened. Check logs.');
    }
  } catch (err) {
    flowTimer.fail('runSummarization threw', err);
    await cleanupSession(session.outDir, flowLog);
    return interaction.editReply(`Pipeline error: ${err.message}`);
  }
}

module.exports = { data, execute };
