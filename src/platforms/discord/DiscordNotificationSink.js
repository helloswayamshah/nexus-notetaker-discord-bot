const { AttachmentBuilder } = require('discord.js');
const { NotificationSink } = require('../../core/interfaces/NotificationSink');

const DISCORD_CHAR_LIMIT = 2000;
const TRUNCATION_SUFFIX = '\n\n... (truncated — see transcript.txt)';

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
    const separator = '\n\n';
    const budget = DISCORD_CHAR_LIMIT - header.length - separator.length;
    const body =
      summary.length > budget
        ? summary.slice(0, budget - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
        : summary;
    await summaryChannel.send({ content: `${header}${separator}${body}`, files: [attachment] });
  }
}

module.exports = { DiscordNotificationSink, DISCORD_CHAR_LIMIT };
