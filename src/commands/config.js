const {
  SlashCommandBuilder,
  MessageFlags,
  ChannelType,
  EmbedBuilder,
} = require('discord.js');
const guildConfig = require('../config/guildConfig');
const { canConfigure } = require('../utils/permissions');
const { MODELS } = require('../transcription/whisperModels');
const { encrypt, isEncrypted } = require('../utils/crypto');

const LLM_PROVIDERS = [{ name: 'ollama', value: 'ollama' }];
const STT_PROVIDERS = [
  { name: 'whispercpp', value: 'whispercpp' },
  { name: 'openai', value: 'openai' },
];
const WHISPER_MODEL_CHOICES = MODELS.map((m) => ({
  name: `${m.name} (${m.size}) — ${m.description}`.slice(0, 100),
  value: m.name,
}));

const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Configure the AI Call Summarizer bot for this server.')
  .setDMPermission(false)
  .addSubcommand((sc) =>
    sc
      .setName('llm')
      .setDescription('Set the LLM provider, endpoint, and model.')
      .addStringOption((o) =>
        o.setName('provider').setDescription('LLM provider').addChoices(...LLM_PROVIDERS)
      )
      .addStringOption((o) =>
        o.setName('base_url').setDescription('Base URL (e.g. http://localhost:11434)')
      )
      .addStringOption((o) => o.setName('model').setDescription('Model name (e.g. llama3.1)'))
  )
  .addSubcommand((sc) =>
    sc
      .setName('stt')
      .setDescription('Set the speech-to-text provider and options.')
      .addStringOption((o) =>
        o.setName('provider').setDescription('STT provider').addChoices(...STT_PROVIDERS)
      )
      .addStringOption((o) =>
        o
          .setName('model')
          .setDescription('whisper.cpp model (resolved from WHISPER_MODELS_DIR)')
          .addChoices(...WHISPER_MODEL_CHOICES)
      )
      .addStringOption((o) =>
        o.setName('api_key').setDescription('API key (openai only — stored in DB, see README)')
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName('channel')
      .setDescription('Set the channel where summaries are posted.')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Summary target channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName('role')
      .setDescription('Allow a role to run /config (in addition to Manage Server admins).')
      .addRoleOption((o) =>
        o.setName('role').setDescription('Role to grant config access (omit to clear).')
      )
  )
  .addSubcommand((sc) => sc.setName('show').setDescription('Show the current configuration.'));

async function execute(interaction) {
  const cfg = guildConfig.get(interaction.guildId);
  if (!canConfigure(interaction, cfg)) {
    return interaction.reply({
      content:
        'You need the **Manage Server** permission or the configured bot role to change settings.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'llm':
      return handleLlm(interaction);
    case 'stt':
      return handleStt(interaction);
    case 'channel':
      return handleChannel(interaction);
    case 'role':
      return handleRole(interaction);
    case 'show':
      return handleShow(interaction, cfg);
  }
}

async function handleLlm(interaction) {
  const patch = {};
  const provider = interaction.options.getString('provider');
  const baseUrl = interaction.options.getString('base_url');
  const model = interaction.options.getString('model');
  if (provider) patch.llm_provider = provider;
  if (baseUrl) patch.llm_base_url = baseUrl;
  if (model) patch.llm_model = model;
  if (Object.keys(patch).length === 0) {
    return interaction.reply({
      content: 'No LLM fields provided. Pass at least one of `provider`, `base_url`, or `model`.',
      flags: MessageFlags.Ephemeral,
    });
  }
  guildConfig.update(interaction.guildId, patch);
  return interaction.reply({ content: 'LLM settings updated.', flags: MessageFlags.Ephemeral });
}

async function handleStt(interaction) {
  const patch = {};
  const provider = interaction.options.getString('provider');
  const model = interaction.options.getString('model');
  const apiKey = interaction.options.getString('api_key');
  if (provider) patch.stt_provider = provider;
  if (model) patch.stt_model_name = model;
  if (apiKey) {
    try {
      patch.stt_api_key = encrypt(apiKey);
    } catch (err) {
      return interaction.reply({
        content: `Could not store API key: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
  if (Object.keys(patch).length === 0) {
    return interaction.reply({
      content: 'No STT fields provided. Pass at least one of `provider`, `model`, or `api_key`.',
      flags: MessageFlags.Ephemeral,
    });
  }
  guildConfig.update(interaction.guildId, patch);
  return interaction.reply({
    content: apiKey
      ? 'STT settings updated (API key encrypted at rest).'
      : 'STT settings updated.',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleChannel(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  guildConfig.update(interaction.guildId, { summary_channel_id: channel.id });
  return interaction.reply({
    content: `Summary channel set to <#${channel.id}>.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRole(interaction) {
  const role = interaction.options.getRole('role');
  guildConfig.update(interaction.guildId, { config_role_id: role ? role.id : null });
  return interaction.reply({
    content: role
      ? `Members with **${role.name}** can now run \`/config\`.`
      : 'Config role cleared. Only Manage Server admins can run `/config`.',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleShow(interaction, cfg) {
  // Never decrypt or preview API keys here — this is a display-only path.
  const keyStatus = (v) => {
    if (!v) return '_(unset)_';
    return isEncrypted(v) ? '🔒 set (encrypted)' : '⚠️ set (plaintext — rotate to encrypt)';
  };
  const sttDetail =
    cfg.stt_provider === 'whispercpp'
      ? cfg.stt_model_name
        ? `model: \`${cfg.stt_model_name}\``
        : cfg.stt_model_path
          ? `legacy path: \`${cfg.stt_model_path}\``
          : '_(no model set — run `/config stt model:<choice>`)_'
      : cfg.stt_provider === 'openai'
        ? `api key: ${keyStatus(cfg.stt_api_key)}`
        : '';
  const embed = new EmbedBuilder()
    .setTitle('AI Call Summarizer — Configuration')
    .addFields(
      { name: 'LLM provider', value: cfg.llm_provider, inline: true },
      { name: 'LLM base URL', value: cfg.llm_base_url, inline: true },
      { name: 'LLM model', value: cfg.llm_model, inline: true },
      { name: 'STT provider', value: cfg.stt_provider, inline: true },
      { name: 'STT model', value: sttDetail || '_(unset)_', inline: true },
      { name: 'STT API key', value: keyStatus(cfg.stt_api_key), inline: true },
      {
        name: 'Summary channel',
        value: cfg.summary_channel_id ? `<#${cfg.summary_channel_id}>` : '_(unset)_',
        inline: true,
      },
      {
        name: 'Config role',
        value: cfg.config_role_id ? `<@&${cfg.config_role_id}>` : '_(only Manage Server admins)_',
        inline: true,
      }
    );
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
