const { buildTranscript } = require('../../core/pipeline/buildTranscript');
const { summarize } = require('../../core/pipeline/summarize');
const { SYSTEM_PROMPT, buildUserPrompt } = require('./prompts');
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
  // Get the bot's own user ID so we can exclude its messages from the summary
  let botUserId;
  try {
    const { user_id } = await client.auth.test();
    botUserId = user_id;
  } catch { /* best-effort — if this fails we still filter by bot_id */ }

  const result = await client.conversations.history({
    channel: sourceChannel,
    oldest: oldestTs,
    limit: 200,
    inclusive: false,
  });

  // Slack returns newest-first; filter out system messages, bot messages, and our own posts
  const messages = (result.messages || []).filter(
    (m) => m.type === 'message'
      && !m.subtype
      && m.text
      && !m.bot_id
      && (!botUserId || m.user !== botUserId)
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

  let channelName = sourceChannel;
  try {
    const info = await client.conversations.info({ channel: sourceChannel });
    channelName = info.channel?.name || sourceChannel;
  } catch { /* best-effort */ }

  const periodDescription = oldestTs
    ? `since ${new Date(parseFloat(oldestTs) * 1000).toUTCString()}`
    : 'recent activity';

  let summary;
  try {
    const llm = getLLM(tenantConfig);
    const userPrompt = buildUserPrompt(transcript, { channelName, periodDescription });
    summary = await summarize(llm, userPrompt, SYSTEM_PROMPT);
  } catch (err) {
    log.error({ err, workspaceId, sourceChannel }, 'LLM summarization failed');
    summary = '_Summary unavailable — LLM error. See logs._';
  }

  const sink = new SlackNotificationSink(client);
  await sink.post({
    header: `*Daily update* — <#${sourceChannel}>:`,
    summary,
    transcript,
    context: { outputChannel, channelId: sourceChannel, messageCount: messages.length, periodDescription },
  });

  return newestTs;
}

module.exports = { runChannelSummary };
