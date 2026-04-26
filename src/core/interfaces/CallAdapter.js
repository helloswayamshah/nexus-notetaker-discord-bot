const { NotImplementedError } = require('./_abstract');

/**
 * Represents a single in-progress or completed call on a platform.
 * The pipeline does not care whether segments come from live Discord streams
 * or a downloaded Zoom MP4 — only that stop() resolves to an array of SpeakerSegment.
 *
 * @typedef {object} SpeakerSegment
 * @property {string} userId        platform-local user ID (or diarization-assigned ID)
 * @property {string} displayName   human label for the transcript
 * @property {number} startMs       ms from call start
 * @property {number} endMs         ms from call start
 * @property {string} pcmPath       path to raw PCM file on disk
 * @property {number} size          bytes — used to filter segments below MIN_SEGMENT_BYTES
 */
class CallAdapter {
  /**
   * @param {object} ctx
   * @param {string} ctx.platform        'discord' | 'slack' | 'zoom' | ...
   * @param {string} ctx.tenantId        guild / workspace / account ID
   * @param {string} ctx.callId          channel ID, meeting ID, file upload ID
   * @param {string} ctx.outDir          scratch dir for PCM/WAV files
   * @param {(id: string) => Promise<string>} ctx.resolveDisplayName
   */
  constructor(ctx) { this.ctx = ctx; }

  /** Begin capturing. Resolves once ready to receive audio. */
  async start() { throw new NotImplementedError('start'); }

  /**
   * Stop capturing and return all segments produced during this call.
   * @returns {Promise<SpeakerSegment[]>}
   */
  async stop() { throw new NotImplementedError('stop'); }
}

module.exports = { CallAdapter };
