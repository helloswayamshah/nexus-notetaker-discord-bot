const fs = require('node:fs');
const { pcmToWav } = require('../utils/audio');
const { buildTranscript } = require('./buildTranscript');
const { summarize } = require('./summarize');

/**
 * Platform-agnostic summarization pipeline.
 * Extracts the post-session.stop() logic: filter segments → transcribe → build transcript → summarize → post via sink.
 *
 * @param {object} opts
 * @param {import('../interfaces/CallAdapter').SpeakerSegment[]} opts.segments
 * @param {{ sampleRate: number, channels: number, bitsPerSample?: number }} opts.audioFormat
 * @param {object} opts.tenantConfig         tenant config row
 * @param {{ transcribe: Function }} opts.transcriber   TranscriberProvider instance
 * @param {{ chat: Function }} opts.llm               SummarizerLLM instance
 * @param {{ post: Function }} opts.sink              NotificationSink instance
 * @param {object} opts.sinkContext          platform-specific routing context
 * @param {object} opts.logger               scoped logger
 * @param {(msg: string) => Promise<void>} [opts.onProgress]  optional progress callback
 * @param {number} [opts.minSegmentBytes]    override for minimum segment size filter
 */
async function runSummarization({
  segments,
  audioFormat,
  tenantConfig,
  transcriber,
  llm,
  sink,
  sinkContext,
  logger,
  onProgress,
  minSegmentBytes,
}) {
  const sampleRate = audioFormat.sampleRate;
  const channels = audioFormat.channels;
  const MIN_SEGMENT_BYTES = minSegmentBytes ?? (sampleRate * channels * 2 * 0.3); // ~300ms of 16-bit

  const usable = segments.filter((s) => s.size >= MIN_SEGMENT_BYTES);
  logger.info('segments filtered', {
    total: segments.length,
    usable: usable.length,
    skipped: segments.length - usable.length,
  });

  if (usable.length === 0) {
    return { status: 'no_audio', utterances: 0, summary: null, transcript: null };
  }

  if (onProgress) await onProgress(`Transcribing ${usable.length} segment(s)...`);

  const utterances = [];
  let failedCount = 0;
  let fatalErr = null;

  for (const [i, seg] of usable.entries()) {
    const wavPath = `${seg.pcmPath}.wav`;
    logger.debug('processing segment', {
      index: i + 1,
      total: usable.length,
      userId: seg.userId,
      displayName: seg.displayName,
      bytes: seg.size,
    });
    try {
      await pcmToWav(seg.pcmPath, wavPath, {
        sampleRate,
        channels,
        bitsPerSample: audioFormat.bitsPerSample || 16,
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
      logger.error('segment transcription failed', {
        index: i + 1,
        userId: seg.userId,
        err,
      });
      if (isFatalTranscriberError(err)) {
        fatalErr = err;
        logger.error('transcriber is unusable; aborting remaining segments', { err });
        break;
      }
    }
  }

  if (fatalErr) {
    return { status: 'transcriber_fatal', fatalErr, utterances: utterances.length };
  }

  logger.info('transcription complete', {
    utterances: utterances.length,
    failedSegments: failedCount,
  });

  if (utterances.length === 0) {
    return { status: 'no_utterances', failedSegments: failedCount, summary: null, transcript: null };
  }

  const transcript = buildTranscript(utterances);
  logger.info('transcript built', {
    lines: transcript.split('\n').length,
    chars: transcript.length,
  });

  if (onProgress) await onProgress('Generating summary...');

  const summary = await summarize(llm, transcript);
  logger.info('summary generated', { chars: summary.length });

  const header = sinkContext.header || 'Call summary';
  await sink.post({ header, summary, transcript, context: sinkContext });
  logger.info('summary posted');

  return { status: 'ok', utterances: utterances.length, summary, transcript };
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

module.exports = { runSummarization, cleanupSession };
