const { NotImplementedError } = require('./_abstract');

class TranscriberProvider {
  /**
   * @param {string} wavPath
   * @returns {Promise<{ text?: string, segments?: Array<{ startMs: number, endMs: number, text: string }> }>}
   */
  async transcribe(wavPath) { throw new NotImplementedError('transcribe'); }
}

module.exports = { TranscriberProvider };
