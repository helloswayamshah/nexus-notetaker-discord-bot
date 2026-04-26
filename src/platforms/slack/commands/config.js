const { SlackPermissionChecker } = require('../SlackPermissionChecker');
const { encrypt } = require('../../../core/utils/crypto');

async function handleConfig({ command, ack, respond, client, tenantConfigStore, channelConfigStore, scheduler }) {
  await ack();

  const workspaceId = command.team_id;
  const userId = command.user_id;
  const tenantCfg = tenantConfigStore.get({ platform: 'slack', tenantId: workspaceId });

  const checker = new SlackPermissionChecker(client);
  if (!await checker.canConfigure(userId, tenantCfg)) {
    return respond({ response_type: 'ephemeral', text: ':lock: You need to be a workspace admin or have the configured bot role to run this command.' });
  }

  const [sub, ...rest] = (command.text || '').trim().split(/\s+/);

  switch (sub) {
    case 'llm': {
      const args = parseKV(rest);
      const patch = {};
      if (args.provider) patch.llm_provider = args.provider;
      if (args.base_url) patch.llm_base_url = args.base_url;
      if (args.model)    patch.llm_model    = args.model;
      if (Object.keys(patch).length === 0) {
        return respond({ response_type: 'ephemeral', text: 'Usage: `/config llm provider=ollama base_url=http://localhost:11434 model=llama3.1`' });
      }
      tenantConfigStore.update({ platform: 'slack', tenantId: workspaceId }, patch);
      return respond({ response_type: 'ephemeral', text: ':white_check_mark: LLM config updated.' });
    }

    case 'stt': {
      const args = parseKV(rest);
      const patch = {};
      if (args.provider) patch.stt_provider   = args.provider;
      if (args.model)    patch.stt_model_name  = args.model;
      if (args.api_key) {
        try { patch.stt_api_key = encrypt(args.api_key); }
        catch (err) { return respond({ response_type: 'ephemeral', text: `:x: Could not store API key: ${err.message}` }); }
      }
      if (Object.keys(patch).length === 0) {
        return respond({ response_type: 'ephemeral', text: 'Usage: `/config stt provider=whispercpp model=base.en`' });
      }
      tenantConfigStore.update({ platform: 'slack', tenantId: workspaceId }, patch);
      return respond({ response_type: 'ephemeral', text: args.api_key ? ':white_check_mark: STT config updated (API key encrypted at rest).' : ':white_check_mark: STT config updated.' });
    }

    case 'channel': {
      const [action, ...cRest] = rest;
      const cArgs = parseKV(cRest);

      if (action === 'add') {
        const source = resolveChannelId(cArgs.source);
        const output = resolveChannelId(cArgs.output);
        if (!source || !output) {
          return respond({ response_type: 'ephemeral', text: 'Usage: `/config channel add source=<#channel> output=<#channel> interval=60`' });
        }
        const intervalMinutes = parseInt(cArgs.interval || '60', 10);
        if (isNaN(intervalMinutes) || intervalMinutes < 1) {
          return respond({ response_type: 'ephemeral', text: ':x: `interval` must be a positive number of minutes.' });
        }
        channelConfigStore.set(workspaceId, source, { outputChannel: output, intervalMinutes });
        scheduler.reloadChannel(workspaceId, source);
        return respond({ response_type: 'ephemeral', text: `:white_check_mark: Schedule set: <#${source}> → <#${output}> every ${intervalMinutes} min.` });
      }

      if (action === 'remove') {
        const source = resolveChannelId(cArgs.source);
        if (!source) {
          return respond({ response_type: 'ephemeral', text: 'Usage: `/config channel remove source=<#channel>`' });
        }
        channelConfigStore.remove(workspaceId, source);
        scheduler.reloadChannel(workspaceId, source);
        return respond({ response_type: 'ephemeral', text: `:white_check_mark: Schedule removed for <#${source}>.` });
      }

      if (action === 'list') {
        const configs = channelConfigStore.listForWorkspace(workspaceId);
        if (configs.length === 0) {
          return respond({ response_type: 'ephemeral', text: 'No channels configured. Use `/config channel add` to add one.' });
        }
        const lines = configs.map((c) =>
          `• <#${c.source_channel}> → <#${c.output_channel}> every ${c.interval_minutes} min`
        );
        return respond({ response_type: 'ephemeral', text: `*Monitored channels:*\n${lines.join('\n')}` });
      }

      return respond({ response_type: 'ephemeral', text: 'Unknown action. Use: `add`, `remove`, or `list`.' });
    }

    case 'role': {
      const roleId = rest[0] || '';
      tenantConfigStore.update({ platform: 'slack', tenantId: workspaceId }, { slack_config_role: roleId });
      return respond({
        response_type: 'ephemeral',
        text: roleId ? `:white_check_mark: Config role set to <@${roleId}>. They can now run \`/config\`.` : ':white_check_mark: Config role cleared — workspace admins only.',
      });
    }

    case 'show': {
      const cfg = tenantConfigStore.get({ platform: 'slack', tenantId: workspaceId });
      const channels = channelConfigStore.listForWorkspace(workspaceId);
      const lines = [
        `*LLM:* ${cfg.llm_provider} / \`${cfg.llm_model}\` (${cfg.llm_base_url})`,
        `*STT:* ${cfg.stt_provider}${cfg.stt_model_name ? ' / `' + cfg.stt_model_name + '`' : ''}`,
        `*Config role:* ${cfg.slack_config_role ? `<@${cfg.slack_config_role}>` : 'workspace admins only'}`,
        `*Channels monitored:* ${channels.length}`,
      ];
      return respond({ response_type: 'ephemeral', text: lines.join('\n') });
    }

    default:
      return respond({ response_type: 'ephemeral', text: 'Usage: `/config [llm | stt | channel | role | show]`' });
  }
}

// Parse ["key=value", ...] → { key: 'value', ... }
// Handles values that contain = (e.g. base_url=http://host:11434)
function parseKV(parts) {
  const out = {};
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

// Strip Slack mention syntax <#CXXX|name> or <#CXXX> → CXXX
// Also accepts a bare channel ID like C0123ABC directly
function resolveChannelId(raw) {
  if (!raw) return null;
  const m = raw.match(/^<#([A-Z0-9]+)(?:\|[^>]*)?>$/);
  if (m) return m[1];
  if (/^[A-Z0-9]{6,}$/.test(raw)) return raw;
  return null;
}

module.exports = { handleConfig };
