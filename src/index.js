require('dotenv').config();

const { Client, GatewayIntentBits, Events } = require('discord.js');
const { generateDependencyReport } = require('@discordjs/voice');
const { registerCommands, buildCommandMap } = require('./commands/register');
const { createDispatcher } = require('./commands/dispatch');
const { createLogger } = require('./utils/logger');

const log = createLogger('main');

const TOKEN = process.env.DISCORD_TOKEN;
const APP_ID = process.env.DISCORD_APP_ID;
const DEV_GUILD_ID = process.env.DISCORD_DEV_GUILD_ID || null;

if (!TOKEN || !APP_ID) {
  log.error('missing required env', {
    DISCORD_TOKEN: !!TOKEN,
    DISCORD_APP_ID: !!APP_ID,
    hint: 'Set DISCORD_TOKEN and DISCORD_APP_ID in .env (local) or pass them through docker-compose.',
  });
  process.exit(1);
}

log.info('voice dependency report', {
  report: '\n' + generateDependencyReport(),
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const commandMap = buildCommandMap();
client.on(Events.InteractionCreate, createDispatcher(commandMap));

client.once(Events.ClientReady, (c) => {
  log.info('client ready', {
    user: c.user.tag,
    userId: c.user.id,
    guilds: c.guilds.cache.size,
  });
});

client.on(Events.Error, (err) => log.error('client error', { err }));
client.on(Events.Warn, (msg) => log.warn('client warn', { msg }));

process.on('unhandledRejection', (err) => log.error('unhandledRejection', { err }));
process.on('uncaughtException', (err) => log.error('uncaughtException', { err }));

(async () => {
  try {
    await registerCommands({ token: TOKEN, appId: APP_ID, devGuildId: DEV_GUILD_ID });
    await client.login(TOKEN);
  } catch (err) {
    log.error('startup failed', { err });
    process.exit(1);
  }
})();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log.info('shutdown', { signal });
    client.destroy();
    process.exit(0);
  });
}
