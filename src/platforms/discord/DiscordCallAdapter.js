const { CallAdapter } = require('../../core/interfaces/CallAdapter');

/**
 * Discord call adapter. Wraps VoiceSession to conform to the CallAdapter interface.
 */
class DiscordCallAdapter extends CallAdapter {
  /**
   * @param {object} ctx          CallAdapter context
   * @param {import('./voiceSession').VoiceSession} session
   */
  constructor(ctx, session) {
    super(ctx);
    this.session = session;
  }

  async start() {
    this.session.start();
  }

  async stop() {
    return this.session.stop();
  }
}

module.exports = { DiscordCallAdapter };
