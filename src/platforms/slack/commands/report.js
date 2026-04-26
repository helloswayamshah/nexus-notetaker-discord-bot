const { runChannelSummary } = require('../channelSummary');
const { createLogger } = require('../../../core/utils/logger');

const log = createLogger('slack:cmd:report');

async function handleReport({ command, ack, respond, client, tenantConfigStore }) {
  await ack();

  const workspaceId = command.team_id;
  const args = parseKV((command.text || '').trim().split(/\s+/));

  const channelId = resolveChannelId(args.channel);
  if (!channelId) {
    return respond({ response_type: 'ephemeral', text: 'Usage: `/report channel=<#channel> interval=60`' });
  }

  const intervalMinutes = parseInt(args.interval || '60', 10);
  if (isNaN(intervalMinutes) || intervalMinutes < 1) {
    return respond({ response_type: 'ephemeral', text: ':x: `interval` must be a positive number of minutes.' });
  }

  const oldestTs = String((Date.now() / 1000) - intervalMinutes * 60);

  // Acknowledge immediately — summarization can take a while
  await respond({ response_type: 'ephemeral', text: `:hourglass: Generating summary for <#${channelId}> (last ${intervalMinutes} min)…` });

  const tenantConfig = tenantConfigStore.get({ platform: 'slack', tenantId: workspaceId });

  try {
    const newestTs = await runChannelSummary({
      client,
      workspaceId,
      sourceChannel: channelId,
      outputChannel: channelId, // on-demand: post back into the requested channel
      tenantConfig,
      oldestTs,
    });
    if (!newestTs) {
      await respond({ response_type: 'ephemeral', text: ':information_source: No messages found in that window — nothing to summarize.' });
    }
  } catch (err) {
    log.error({ err, workspaceId, channelId }, 'On-demand report failed');
    await respond({ response_type: 'ephemeral', text: `:x: Failed to generate summary: ${err.message}` });
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
