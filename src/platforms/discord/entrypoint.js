const { DiscordCommandGateway } = require('./DiscordCommandGateway');
const { createLogger } = require('../../core/utils/logger');

const log = createLogger('main');

// Register process-level handlers once at module load, not inside start(),
// so they don't stack if start() is ever retried.
let _gateway = null;

process.on('unhandledRejection', (err) => log.error('unhandledRejection', { err }));
process.on('uncaughtException', (err) => log.error('uncaughtException', { err }));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log.info('shutdown', { signal });
    const stop = _gateway ? _gateway.stop() : Promise.resolve();
    stop.finally(() => process.exit(0));
  });
}

async function start() {
  const TOKEN = process.env.DISCORD_TOKEN;
  const APP_ID = process.env.DISCORD_APP_ID;
  const DEV_GUILD_ID = process.env.DISCORD_DEV_GUILD_ID || null;

  if (!TOKEN || !APP_ID) {
    throw new Error(
      'Discord: missing required env vars — set DISCORD_TOKEN and DISCORD_APP_ID in .env or docker-compose.',
    );
  }

  _gateway = new DiscordCommandGateway({ token: TOKEN, appId: APP_ID, devGuildId: DEV_GUILD_ID });

  try {
    await _gateway.start();
  } catch (err) {
    log.error('startup failed', { err });
    throw err;
  }
}

module.exports = { start };

