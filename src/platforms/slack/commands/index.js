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
    name: '/hello',
    description: 'Health-check — replies hello to the channel',
    makeHandler: () => async ({ ack, respond, command }) => {
      await ack();
      await respond({ response_type: 'in_channel', text: `Hello <@${command.user_id}>! :wave: AI Call Summarizer is up and running.` });
    },
  },
  {
    name: '/config',
    description: 'Configure LLM, STT, channel schedules, and access roles',
    makeHandler: (deps) => (ctx) => handleConfig({ ...ctx, ...deps }),
  },
  {
    name: '/report',
    description: 'On-demand summary for a channel over a given time window',
    makeHandler: (deps) => (ctx) => handleReport({ ...ctx, ...deps }),
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

*/hello* — Health-check

*/config llm* \`provider=ollama base_url=http://localhost:11434 model=llama3.1\`
*/config stt* \`provider=whispercpp model=base.en\`
*/config channel add* \`source=<#channel> output=<#channel> interval=60\`
*/config channel remove* \`source=<#channel>\`
*/config channel list*
*/config role* \`<@user>\`
*/config show*

*/report* \`channel=<#channel> interval=60\`
`.trim();

module.exports = { COMMANDS };
