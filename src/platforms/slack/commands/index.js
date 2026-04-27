// Central command registry for the Slack bot.
//
// Each entry defines the slash command name, a one-line description (shown on
// startup and by the slack:list-commands script), and a factory function that
// receives injected dependencies and returns the Bolt handler.
//
// To add a command:
//   1. Add an entry here.
//   2. Run `npm run slack:list-commands` to see what to register in the portal.
//   3. Register it once in the Slack app portal (api.slack.com/apps).

const { handleConfig } = require('./config');
const { handleReport } = require('./report');

const COMMANDS = [
  {
    name: '/summarize',
    description: 'Summarize a channel\'s messages over a time window and post the result',
    makeHandler: (deps) => (ctx) => handleReport({ ...ctx, ...deps }),
  },
  {
    name: '/report',
    description: 'Alias for /summarize — on-demand channel summary',
    makeHandler: (deps) => (ctx) => handleReport({ ...ctx, ...deps }),
  },
  {
    name: '/config',
    description: 'Configure LLM, STT, channel schedules, and access roles',
    makeHandler: (deps) => (ctx) => handleConfig({ ...ctx, ...deps }),
  },
  {
    name: '/help',
    description: 'Show available commands and usage',
    makeHandler: () => async ({ ack, respond }) => {
      await ack();
      await respond({ response_type: 'ephemeral', text: HELP_TEXT });
    },
  },
];

const HELP_TEXT = `
*AI Call Summarizer — Slack Bot*

*Summarize a channel*
\`/summarize\` — Summarize the current channel (last 60 min)
\`/summarize interval=30\` — Summarize the current channel (last 30 min)
\`/summarize channel=#general\` — Summarize a specific channel
\`/summarize channel=#general interval=120\` — Specific channel + custom window
\`/report\` — Same as \`/summarize\`

*Configuration* _(workspace admins or configured role only)_
\`/config show\` — Show current settings
\`/config llm provider=ollama base_url=http://localhost:11434 model=llama3.1\`
\`/config stt provider=whispercpp model=base.en\`
\`/config stt provider=openai api_key=sk-...\`

*Scheduled summaries*
\`/config channel add source=#standup output=#summaries interval=60\`
\`/config channel remove source=#standup\`
\`/config channel list\`

*Access control*
\`/config role @rolename\` — Grant a Slack user group config access
\`/config role\` — Reset to workspace admins only

*Help*
\`/help\` — Show this message
`.trim();

module.exports = { COMMANDS };
