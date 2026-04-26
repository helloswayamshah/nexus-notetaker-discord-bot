const { NotImplementedError } = require('./_abstract');

class SummarizerLLM {
  /**
   * @param {{ role: 'system'|'user'|'assistant', content: string }[]} messages
   * @returns {Promise<string>}
   */
  async chat(messages) { throw new NotImplementedError('chat'); }
}

module.exports = { SummarizerLLM };
