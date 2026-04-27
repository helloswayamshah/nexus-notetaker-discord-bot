const { runChannelSummary } = require('../channelSummary');
const { createLogger } = require('../../../core/utils/logger');

const log = createLogger('slack:cmd:report');

/**
 * /report — on-demand channel summary.
 *
 * Usage:
 *   /report                          → summary of current channel, last 60 min
 *   /report interval=30              → current channel, last 30 min
 *   /report channel=#general         → specific channel, last 60 min
 *   /report channel=#general interval=120
 */
async function handleReport({ command, ack, respond, client, tenantConfigStore }) {
  await ack();

  const workspaceId = command.team_id;
  const rawText = (command.text || '').trim();
  const args = parseKV(rawText.split(/\s+/).filter(Boolean));

  // Default: current channel if none specified
  const channelId = args.channel ? resolveChannelId(args.channel) : command.channel_id;
  if (!channelId) {
    return respond({
      response_type: 'ephemeral',
      text: [
        ':x: Could not determine which channel to summarize.',
        'Usage: `/report` _(current channel, last 60 min)_',
        'Or: `/report channel=#general interval=30`',
      ].join('\n'),
    });
  }

  const intervalMinutes = parseInt(args.interval || '60', 10);
  if (isNaN(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 10080) {
    return respond({
      response_type: 'ephemeral',
      text: ':x: `interval` must be a number of minutes between 1 and 10080 (1 week).',
    });
  }

  const oldestTs = String((Date.now() / 1000) - intervalMinutes * 60);

  await respond({
    response_type: 'ephemeral',
    text: `:hourglass_flowing_sand: Generating summary for <#${channelId}> (last ${intervalMinutes} min)…`,
  });

  const tenantConfig = tenantConfigStore.get({ platform: 'slack', tenantId: workspaceId });

  try {
    const newestTs = await runChannelSummary({
      client,
      workspaceId,
      sourceChannel: channelId,
      outputChannel: channelId,
      tenantConfig,
      oldestTs,
    });
    if (!newestTs) {
      await respond({
        response_type: 'ephemeral',
        text: ':information_source: No messages found in that time window — nothing to summarize.',
      });
    }
  } catch (err) {
    log.error({ err, workspaceId, channelId }, 'On-demand report failed');
    await respond({
      response_type: 'ephemeral',
      text: `:x: Failed to generate summary: ${err.message}`,
    });
  }
}

function parseKV(parts) {
  const out = {};
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function resolveChannelId(raw) {
  if (!raw) return null;
  const m = raw.match(/^<#([A-Z0-9]+)(?:\|[^>]*)?>$/);
  if (m) return m[1];
  if (/^[A-Z0-9]{6,}$/.test(raw)) return raw;
  return null;
}

module.exports = { handleReport };
