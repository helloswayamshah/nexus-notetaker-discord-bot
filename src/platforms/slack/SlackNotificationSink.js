const { NotificationSink } = require('../../core/interfaces/NotificationSink');

class SlackNotificationSink extends NotificationSink {
  constructor(client) {
    super();
    this._client = client;
  }

  async post({ header, summary, transcript, context }) {
    // context: { outputChannel: string }
    await this._client.chat.postMessage({
      channel: context.outputChannel,
      text: header, // plain-text fallback for push notifications
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: header.slice(0, 150) } },
        { type: 'section', text: { type: 'mrkdwn', text: summary.slice(0, 3000) } },
      ],
    });

    if (transcript) {
      await this._client.filesUploadV2({
        channel_id: context.outputChannel,
        filename: 'transcript.txt',
        content: transcript,
        title: `Transcript — ${header}`.slice(0, 255),
      });
    }
  }
}

module.exports = { SlackNotificationSink };
