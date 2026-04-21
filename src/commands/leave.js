const fs = require('node:fs');
const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const { getSession, clearSession } = require('../voice/sessionManager');
const { pcmToWav } = require('../utils/audio');
const { SAMPLE_RATE, CHANNELS } = require('../voice/voiceSession');
const { getTranscriber } = require('../transcription');
const { getLLM } = require('../llm');
const { buildTranscript } = require('../summarizer/buildTranscript');
const { summarize } = require('../summarizer/summarize');
const guildConfig = require('../config/guildConfig');
const { createLogger } = require('../utils/logger');

const MIN_SEGMENT_BYTES = SAMPLE_RATE * CHANNELS * 2 * 0.3; // ~300ms of 16-bit stereo
const MAX_DISCORD_MESSAGE = 1800;

const log = createLogger('cmd:leave');

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

  const cfg = guildConfig.get(interaction.guildId);
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

  const usable = segments.filter((s) => s.size >= MIN_SEGMENT_BYTES);
  flowLog.info('segments filtered', {
    total: segments.length,
    usable: usable.length,
    skipped: segments.length - usable.length,
  });
  if (usable.length === 0) {
    await cleanupSession(session.outDir, flowLog);
    flowTimer.end('leave flow (no usable audio)');
    return interaction.editReply('Stopped — but no usable audio was captured. Nothing to summarize.');
  }

  await interaction.editReply(`Transcribing ${usable.length} segment(s)...`);

  let transcriber;
  try {
    transcriber = getTranscriber(cfg);
    flowLog.info('transcriber loaded', { provider: cfg.stt_provider });
  } catch (err) {
    flowTimer.fail('getTranscriber failed', err);
    await cleanupSession(session.outDir, flowLog);
    return interaction.editReply(`Transcriber error: ${err.message}`);
  }

  const utterances = [];
  let failedCount = 0;
  let fatalErr = null;
  for (const [i, seg] of usable.entries()) {
    const wavPath = `${seg.pcmPath}.wav`;
    flowLog.debug('processing segment', {
      index: i + 1,
      total: usable.length,
      userId: seg.userId,
      displayName: seg.displayName,
      bytes: seg.size,
    });
    try {
      await pcmToWav(seg.pcmPath, wavPath, {
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        bitsPerSample: 16,
      });
      const result = await transcriber.transcribe(wavPath);
      const sttSegments = result.segments || [];
      if (sttSegments.length > 0) {
        for (const s of sttSegments) {
          if (!s.text) continue;
          utterances.push({
            userId: seg.userId,
            displayName: seg.displayName,
            startMs: seg.startMs + s.startMs,
            endMs: seg.startMs + s.endMs,
            text: s.text,
          });
        }
      } else if (result.text) {
        utterances.push({
          userId: seg.userId,
          displayName: seg.displayName,
          startMs: seg.startMs,
          endMs: seg.endMs,
          text: result.text,
        });
      }
    } catch (err) {
      failedCount++;
      flowLog.error('segment transcription failed', {
        index: i + 1,
        userId: seg.userId,
        err,
      });
      if (isFatalTranscriberError(err)) {
        fatalErr = err;
        flowLog.error('transcriber is unusable; aborting remaining segments', { err });
        break;
      }
    }
  }

  if (fatalErr) {
    await cleanupSession(session.outDir, flowLog);
    flowTimer.fail('leave flow (transcriber fatal)', fatalErr);
    return interaction.editReply(
      `Transcription aborted: ${fatalErr.message}\n\nRun \`/help topic:config-stt\` for setup instructions.`
    );
  }

  flowLog.info('transcription complete', {
    utterances: utterances.length,
    failedSegments: failedCount,
  });

  if (utterances.length === 0) {
    await cleanupSession(session.outDir, flowLog);
    flowTimer.end('leave flow (no utterances)');
    return interaction.editReply(
      `Transcription produced no usable text (failed segments: ${failedCount}). Check logs for details.`
    );
  }

  const transcript = buildTranscript(utterances);
  flowLog.info('transcript built', {
    lines: transcript.split('\n').length,
    chars: transcript.length,
  });

  await interaction.editReply('Generating summary...');

  let summary;
  try {
    const llm = getLLM(cfg);
    flowLog.info('llm loaded', {
      provider: cfg.llm_provider,
      model: cfg.llm_model,
      baseUrl: cfg.llm_base_url,
    });
    summary = await summarize(llm, transcript);
    flowLog.info('summary generated', { chars: summary.length });
  } catch (err) {
    flowTimer.fail('summarize failed', err);
    await cleanupSession(session.outDir, flowLog);
    return interaction.editReply(`LLM error: ${err.message}`);
  }

  const attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf8'), {
    name: 'transcript.txt',
  });
  const header = `**Call summary** — requested by <@${interaction.user.id}>`;
  const body =
    summary.length > MAX_DISCORD_MESSAGE
      ? summary.slice(0, MAX_DISCORD_MESSAGE) + '\n\n... (truncated — see transcript.txt)'
      : summary;

  try {
    await summaryChannel.send({ content: `${header}\n\n${body}`, files: [attachment] });
    flowLog.info('summary posted', {
      channelId: summaryChannel.id,
      summaryChars: body.length,
      transcriptChars: transcript.length,
    });
  } catch (err) {
    flowTimer.fail('post to summary channel failed', err, { channelId: summaryChannel.id });
    await cleanupSession(session.outDir, flowLog);
    return interaction.editReply(
      `Could not post to <#${summaryChannel.id}>: ${err.message}. The bot may be missing permissions.`
    );
  }

  await cleanupSession(session.outDir, flowLog);
  flowTimer.end('leave flow ok');
  return interaction.editReply(`Summary posted to <#${summaryChannel.id}>.`);
}

function isFatalTranscriberError(err) {
  const msg = err?.message || '';
  return (
    err?.code === 'ENOENT'
    || msg.includes('not found on PATH')
    || msg.includes('model file not found')
    || msg.includes('WHISPER_CPP_BIN')
    || msg.startsWith('OpenAI Whisper returned 401')
    || msg.startsWith('OpenAI Whisper returned 403')
  );
}

async function cleanupSession(dir, logger) {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
    logger.debug('session files cleaned up', { dir });
  } catch (err) {
    logger.warn('cleanup failed', { dir, err });
  }
}

module.exports = { data, execute };
