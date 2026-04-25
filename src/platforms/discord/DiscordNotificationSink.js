const { AttachmentBuilder } = require('discord.js');
const { NotificationSink } = require('../../core/interfaces/NotificationSink');

const MAX_DISCORD_MESSAGE = 1800;

/**
 * Discord notification sink. Posts summary + transcript attachment to a text channel.
 */
class DiscordNotificationSink extends NotificationSink {
  /**
   * @param {object} payload
   * @param {string} payload.header
   * @param {string} payload.summary
   * @param {string} payload.transcript
   * @param {object} payload.context
   * @param {import('discord.js').TextChannel} payload.context.summaryChannel
   */
  async post({ header, summary, transcript, context }) {
    const { summaryChannel } = context;
    const attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf8'), {
      name: 'transcript.txt',
    });
    const body =
      summary.length > MAX_DISCORD_MESSAGE
        ? summary.slice(0, MAX_DISCORD_MESSAGE) + '\n\n... (truncated — see transcript.txt)'
        : summary;
    await summaryChannel.send({ content: `${header}\n\n${body}`, files: [attachment] });
  }
}

module.exports = { DiscordNotificationSink, MAX_DISCORD_MESSAGE };
