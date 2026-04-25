// Backward-compatibility shim — delegates to the Discord platform entrypoint.
// New deployments should use `bin/start-discord.js` or `npm run start:discord` instead.
require('dotenv').config();
require('./platforms/discord/entrypoint').start();
require('./platforms/slack/entrypoint').start();