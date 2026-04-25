const { DiscordCommandGateway } = require('./DiscordCommandGateway');
const { createLogger } = require('../../core/utils/logger');

const log = createLogger('main');

async function start() {
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

  const gateway = new DiscordCommandGateway({ token: TOKEN, appId: APP_ID, devGuildId: DEV_GUILD_ID });

  process.on('unhandledRejection', (err) => log.error('unhandledRejection', { err }));
  process.on('uncaughtException', (err) => log.error('uncaughtException', { err }));

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      log.info('shutdown', { signal });
      gateway.stop();
      process.exit(0);
    });
  }

  try {
    await gateway.start();
  } catch (err) {
    log.error('startup failed', { err });
    process.exit(1);
  }
}

module.exports = { start };
