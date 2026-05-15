// Prints all slash commands the Slack bot expects to exist in the app portal.
// Run: npm run slack:list-commands
//
// Cross-check this list against api.slack.com/apps > Slash Commands.
// Every command listed here must be registered there before it will work.

const { COMMANDS } = require('../src/platforms/slack/commands/index');

console.log('\nSlack slash commands that must be registered in the app portal:\n');
for (const cmd of COMMANDS) {
  console.log(`  ${cmd.name.padEnd(24)} — ${cmd.description}`);
}
console.log(`\nTotal: ${COMMANDS.length} command(s)\n`);
