const { buildTranscript } = require('../../core/pipeline/buildTranscript');
const { summarize } = require('../../core/pipeline/summarize');
const { getLLM } = require('../../core/registry');
const { SlackNotificationSink } = require('./SlackNotificationSink');
const { createLogger } = require('../../core/utils/logger');

const log = createLogger('slack:channelSummary');

/**
 * Fetch messages from sourceChannel since oldestTs, summarize them,
 * and post to outputChannel.
 *
 * Returns the Slack ts of the newest message processed, or null if none.
 */
async function runChannelSummary({ client, workspaceId, sourceChannel, outputChannel, tenantConfig, oldestTs }) {
  const result = await client.conversations.history({
    channel: sourceChannel,
    oldest: oldestTs,
    limit: 200,
    inclusive: false,
  });

  // Slack returns newest-first; filter out system messages
  const messages = (result.messages || []).filter(
    (m) => m.type === 'message' && !m.subtype && m.text
  );

  if (messages.length === 0) {
    log.info({ workspaceId, sourceChannel }, 'No new messages — skipping summary');
    return null;
  }

  const newestTs = messages[0].ts;

  // Oldest-first utterance list
  const utterances = messages.slice().reverse().map((m) => ({
    userId: m.user || 'unknown',
    displayName: m.user || 'unknown',
    startMs: Math.floor(parseFloat(m.ts) * 1000),
    endMs: Math.floor(parseFloat(m.ts) * 1000) + 1,
    text: m.text,
  }));

  // Resolve display names, one users.info call per unique user, cached
  const cache = new Map();
  for (const u of utterances) {
    if (u.userId === 'unknown') continue;
    if (!cache.has(u.userId)) {
      try {
        const { user } = await client.users.info({ user: u.userId });
        cache.set(u.userId, user.profile.display_name || user.real_name || u.userId);
      } catch {
        cache.set(u.userId, u.userId);
      }
    }
    u.displayName = cache.get(u.userId);
  }

  const transcript = buildTranscript(utterances);

  let summary;
  try {
    const llm = getLLM(tenantConfig);
    summary = await summarize(llm, transcript);
  } catch (err) {
    log.error({ err, workspaceId, sourceChannel }, 'LLM summarization failed');
    summary = '_Summary unavailable — LLM error. See logs._';
  }

  let channelName = sourceChannel;
  try {
    const info = await client.conversations.info({ channel: sourceChannel });
    channelName = info.channel?.name || sourceChannel;
  } catch { /* best-effort */ }

  const sink = new SlackNotificationSink(client);
  await sink.post({
    header: `Channel summary — #${channelName}`,
    summary,
    transcript,
    context: { outputChannel },
  });

  return newestTs;
}

module.exports = { runChannelSummary };
