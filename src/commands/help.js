const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const guildConfig = require('../config/guildConfig');

const TOPICS = [
  { name: 'Overview (all commands)', value: 'overview' },
  { name: 'First-time setup walkthrough', value: 'setup' },
  { name: '/join', value: 'join' },
  { name: '/leave', value: 'leave' },
  { name: '/config show', value: 'config-show' },
  { name: '/config llm', value: 'config-llm' },
  { name: '/config stt (transcription setup)', value: 'config-stt' },
  { name: '/config channel', value: 'config-channel' },
  { name: '/config role', value: 'config-role' },
];

const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show commands, setup instructions, and current configuration status.')
  .setDMPermission(false)
  .addStringOption((o) =>
    o
      .setName('topic')
      .setDescription('Pick a command or topic for detailed help')
      .addChoices(...TOPICS)
  );

async function execute(interaction) {
  const topic = interaction.options.getString('topic') || 'overview';
  const cfg = guildConfig.get(interaction.guildId);
  const embed = buildEmbed(topic, cfg);
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

function buildEmbed(topic, cfg) {
  switch (topic) {
    case 'setup':
      return setupEmbed();
    case 'join':
      return joinEmbed();
    case 'leave':
      return leaveEmbed();
    case 'config-show':
      return configShowEmbed();
    case 'config-llm':
      return configLlmEmbed();
    case 'config-stt':
      return configSttEmbed();
    case 'config-channel':
      return configChannelEmbed();
    case 'config-role':
      return configRoleEmbed();
    case 'overview':
    default:
      return overviewEmbed(cfg);
  }
}

function overviewEmbed(cfg) {
  return new EmbedBuilder()
    .setTitle('AI Call Summarizer — Help')
    .setDescription(
      'Joins a voice channel, records every speaker separately, transcribes with speaker labels, and posts a Markdown summary with action items. Transcription and LLM backends are pluggable.\n\n'
      + 'Run `/help topic:<name>` for details on any command.'
    )
    .addFields(
      {
        name: 'Recording',
        value:
          '`/join` — join your voice channel and start recording\n'
          + '`/leave` — stop, transcribe, summarize, post',
      },
      {
        name: 'Configuration (Manage Server or config role)',
        value:
          '`/config show` — view current config\n'
          + '`/config llm` — set LLM provider / URL / model\n'
          + '`/config stt` — set transcription provider + options\n'
          + '`/config channel` — set where summaries are posted\n'
          + '`/config role` — grant a role access to `/config`',
      },
      {
        name: 'Help & setup',
        value:
          '`/help` — this screen\n'
          + '`/help topic:setup` — full first-time setup walkthrough\n'
          + '`/help topic:config-stt` — detailed whisper.cpp / OpenAI setup',
      },
      {
        name: 'Current status',
        value: buildStatus(cfg),
      }
    );
}

function setupEmbed() {
  return new EmbedBuilder()
    .setTitle('First-time setup')
    .setDescription('Three external pieces need to be set up once per host machine, plus a few config commands per Discord server.')
    .addFields(
      {
        name: '1. Ollama (local LLM) — ~5 min',
        value:
          '• Install from https://ollama.com/download\n'
          + '• Pull a model: `ollama pull llama3.1` (~4.7 GB)\n'
          + '• Verify: `curl http://localhost:11434/api/tags` should return JSON',
      },
      {
        name: '2. whisper.cpp (local STT) — ~10 min',
        value:
          '• Download Windows zip from https://github.com/ggerganov/whisper.cpp/releases\n'
          + '• Extract to e.g. `C:\\tools\\whisper.cpp\\`\n'
          + '• Grab a GGML model from https://huggingface.co/ggerganov/whisper.cpp/tree/main (start with `ggml-base.en.bin`, 142 MB)\n'
          + '• Either add the folder to PATH or set `WHISPER_CPP_BIN=C:\\tools\\whisper.cpp\\whisper-cli.exe` in `.env`\n'
          + '• Run `/help topic:config-stt` for the detailed walkthrough',
      },
      {
        name: '3. Configure the bot in this server',
        value:
          '```\n'
          + '/config channel channel:#summaries\n'
          + '/config stt provider:whispercpp model:base.en\n'
          + '/config llm provider:ollama base_url:http://localhost:11434 model:llama3.1\n'
          + '/help\n'
          + '```',
      },
      {
        name: '4. Record',
        value: '`/join` while in a voice channel → talk → `/leave`. Summary and `transcript.txt` land in your configured channel.',
      }
    );
}

function joinEmbed() {
  return new EmbedBuilder()
    .setTitle('/join — start recording')
    .setDescription('Bot joins the voice channel you are currently in and subscribes to every speaker as they talk.')
    .addFields(
      { name: 'Usage', value: '`/join`' },
      { name: 'Options', value: 'None.' },
      {
        name: 'Prerequisites',
        value:
          '• You must be connected to a voice channel in this server.\n'
          + '• Bot needs **Connect** + **Speak** + **View Channel** on that channel.\n'
          + '• No recording session can already be active in this server.',
      },
      {
        name: 'What happens',
        value:
          '1. Bot joins the channel, self-muted (not deafened).\n'
          + '2. Each speaker\'s audio is captured to a separate per-user PCM file — this is where the speaker labels come from.\n'
          + '3. Recording continues until `/leave` is run.',
      },
      { name: 'Errors', value: '*"You need to be in a voice channel first"* — join a VC, then retry.\n*"A recording session is already active"* — run `/leave` first.' }
    );
}

function leaveEmbed() {
  return new EmbedBuilder()
    .setTitle('/leave — stop, transcribe, summarize')
    .setDescription('Stops recording, runs each per-user audio file through the configured STT provider, builds a speaker-labeled transcript, sends it to the LLM for summarization, and posts to the configured summary channel with the raw transcript attached.')
    .addFields(
      { name: 'Usage', value: '`/leave`' },
      { name: 'Options', value: 'None.' },
      {
        name: 'Output',
        value:
          'Posted to the channel set via `/config channel`:\n'
          + '• Markdown message with **TL;DR**, **Key Points**, **Action Items**\n'
          + '• `transcript.txt` file attachment with the full speaker-labeled transcript',
      },
      {
        name: 'Required configuration',
        value: 'Summary channel, STT provider, and LLM provider all need to be configured. Run `/help` to see which are still missing.',
      },
      {
        name: 'Error handling',
        value:
          'The bot always leaves the voice channel, even if transcription or summarization fails. A useful error message is returned ephemerally to you, and full stack traces appear in the bot console. Progress is reported as you wait: *"Transcribing N segments..."* → *"Generating summary..."* → *"Summary posted to #channel"*.',
      }
    );
}

function configShowEmbed() {
  return new EmbedBuilder()
    .setTitle('/config show — view current configuration')
    .setDescription('Displays the full current configuration for this server as an ephemeral embed. API keys are masked.')
    .addFields(
      { name: 'Usage', value: '`/config show`' },
      { name: 'Permission', value: 'Manage Server, or the role configured via `/config role`.' },
      { name: 'See also', value: '`/help` — also shows a summary status with what\'s still unset.' }
    );
}

function configLlmEmbed() {
  return new EmbedBuilder()
    .setTitle('/config llm — configure the LLM provider')
    .setDescription('Controls which language model is used to write the final summary.')
    .addFields(
      { name: 'Usage', value: '`/config llm [provider:<ollama>] [base_url:<url>] [model:<name>]`' },
      {
        name: 'Options',
        value:
          '• `provider` — currently only `ollama`. More adapters can be added in `src/llm/`.\n'
          + '• `base_url` — where Ollama is reachable (default `http://localhost:11434`).\n'
          + '• `model` — the pulled model name, e.g. `llama3.1`, `mistral`, `qwen2.5`, `phi4`.',
      },
      {
        name: 'Setup',
        value:
          '1. Install Ollama: https://ollama.com/download\n'
          + '2. Pull a model: `ollama pull llama3.1`\n'
          + '3. Verify: `curl http://localhost:11434/api/tags`\n'
          + '4. Then in Discord: `/config llm model:llama3.1`',
      },
      { name: 'Example', value: '`/config llm provider:ollama base_url:http://192.168.1.50:11434 model:llama3.1`' },
      { name: 'Permission', value: 'Manage Server, or the role configured via `/config role`.' }
    );
}

function configSttEmbed() {
  const { MODELS } = require('../transcription/whisperModels');
  const modelsTable = MODELS.map((m) => `\`${m.name}\` — ${m.size}, ${m.description}`).join('\n');

  return new EmbedBuilder()
    .setTitle('/config stt — configure speech-to-text')
    .setDescription('Controls how recorded audio is transcribed. Two providers are supported: **`whispercpp`** (local, free) and **`openai`** (cloud API, paid).')
    .addFields(
      { name: 'Usage', value: '`/config stt [provider:<whispercpp|openai>] [model:<choice>] [api_key:<sk-...>]`' },
      {
        name: 'Options',
        value:
          '• `provider` — `whispercpp` or `openai`.\n'
          + '• `model` — **required for `whispercpp`**. Pick from the dropdown; the bot resolves it to `<WHISPER_MODELS_DIR>/ggml-<name>.bin`.\n'
          + '• `api_key` — **required for `openai`**. Stored plaintext in SQLite (see README).',
      },
      {
        name: 'Models directory',
        value:
          'The whisper.cpp models are read from the directory set by the env var `WHISPER_MODELS_DIR` '
          + '(default: `<repo>/models`). Populate it with any of the GGML files below. '
          + 'In Docker/fly.io deployments this is typically `/opt/whisper-models`.',
      },
      {
        name: 'Supported whisper.cpp models',
        value: modelsTable,
      },
      {
        name: 'Local setup (dev)',
        value:
          '1. Install whisper.cpp (https://github.com/ggerganov/whisper.cpp/releases) and make sure `whisper-cli` is on PATH or set `WHISPER_CPP_BIN` in `.env`.\n'
          + '2. `mkdir models` in the repo root (or set `WHISPER_MODELS_DIR=<folder>` in `.env`).\n'
          + '3. Download one or more GGML files from https://huggingface.co/ggerganov/whisper.cpp/tree/main into that folder.\n'
          + '4. In Discord: `/config stt provider:whispercpp model:base.en`.',
      },
      {
        name: 'Deployed setup (Docker / fly.io)',
        value:
          'Bake models into the image at a fixed path and set `WHISPER_MODELS_DIR=/opt/whisper-models`. '
          + 'See `docs/hosting.md` for a ready-to-use Dockerfile. Users then switch models live with '
          + '`/config stt model:<choice>` — no redeploy.',
      },
      {
        name: 'OpenAI Whisper (cloud, simpler)',
        value:
          '1. Create an API key at https://platform.openai.com/api-keys.\n'
          + '2. `/config stt provider:openai api_key:sk-...`\n'
          + 'Audio is uploaded to OpenAI. Billed per minute — see OpenAI pricing.',
      },
      { name: 'Test it', value: 'Run `/help` — the STT line flips to ✅ when the model file is present or an `api_key` is set.' },
      { name: 'Permission', value: 'Manage Server, or the role configured via `/config role`.' }
    );
}

function configChannelEmbed() {
  return new EmbedBuilder()
    .setTitle('/config channel — set the summary channel')
    .setDescription('Chooses which text channel the bot posts summaries (and attaches the transcript) to.')
    .addFields(
      { name: 'Usage', value: '`/config channel channel:<#channel>`' },
      {
        name: 'Required permissions for the bot in that channel',
        value: '**View Channel**, **Send Messages**, **Attach Files**.',
      },
      { name: 'Example', value: '`/config channel channel:#meeting-notes`' },
      { name: 'Permission', value: 'Manage Server, or the role configured via `/config role`.' }
    );
}

function configRoleEmbed() {
  return new EmbedBuilder()
    .setTitle('/config role — delegate config access to a role')
    .setDescription('Lets non-admins configure the bot. Members with Manage Server can always configure; this adds a role that also has access.')
    .addFields(
      { name: 'Usage', value: '`/config role [role:<@role>]`' },
      { name: 'Options', value: '`role` — the role to grant. Omit to clear and revert to admin-only.' },
      { name: 'Example', value: '`/config role role:@Bot Manager`' },
      { name: 'Permission', value: 'Manage Server.' }
    );
}

function buildStatus(cfg) {
  const check = (ok) => (ok ? '✅' : '❌');
  const llmOk = !!cfg.llm_base_url && !!cfg.llm_model;
  const sttOk =
    cfg.stt_provider === 'whispercpp'
      ? !!(cfg.stt_model_name || cfg.stt_model_path)
      : cfg.stt_provider === 'openai'
        ? !!cfg.stt_api_key
        : false;
  const channelOk = !!cfg.summary_channel_id;

  const sttDetail =
    cfg.stt_provider === 'whispercpp'
      ? cfg.stt_model_name
        ? `model \`${cfg.stt_model_name}\``
        : cfg.stt_model_path
          ? `legacy path \`${cfg.stt_model_path}\``
          : '**run `/config stt model:<choice>`**'
      : cfg.stt_provider === 'openai'
        ? cfg.stt_api_key
          ? 'api_key set'
          : '**run `/config stt api_key:<sk-...>`**'
        : '';

  return [
    `${check(llmOk)} LLM: \`${cfg.llm_provider}\` @ ${cfg.llm_base_url || '(unset)'} / model \`${cfg.llm_model || '(unset)'}\``,
    `${check(sttOk)} STT: \`${cfg.stt_provider}\` / ${sttDetail}`,
    `${check(channelOk)} Summary channel: ${cfg.summary_channel_id ? `<#${cfg.summary_channel_id}>` : '**run `/config channel channel:<#channel>`**'}`,
  ].join('\n');
}

module.exports = { data, execute };
