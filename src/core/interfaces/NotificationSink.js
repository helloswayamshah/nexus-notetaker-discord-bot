const { NotImplementedError } = require('./_abstract');

class NotificationSink {
  /**
   * @param {object} payload
   * @param {string} payload.header       e.g. "Call summary — requested by @alice"
   * @param {string} payload.summary      markdown, LLM-produced
   * @param {string} payload.transcript   full transcript text — usually an attachment
   * @param {object} payload.context      platform-specific routing (channel ID, thread ts, email, …)
   */
  async post(payload) { throw new NotImplementedError('post'); }
}

module.exports = { NotificationSink };
