const { NotImplementedError } = require('./_abstract');

class DiarizationProvider {
  /**
   * @param {string} wavPath  mono 16kHz input
   * @returns {Promise<Array<{ speakerId: string, startMs: number, endMs: number }>>}
   */
  async diarize(wavPath) { throw new NotImplementedError('diarize'); }
}

module.exports = { DiarizationProvider };
