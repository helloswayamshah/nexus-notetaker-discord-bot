const { DiscordCommandGateway } = require('./DiscordCommandGateway');
const { createLogger } = require('../../core/utils/logger');

const log = createLogger('discord:main');

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

function validateEnv() {
  const token = process.env.DISCORD_TOKEN;
  const appId = process.env.DISCORD_APP_ID;
  const errors = [];

  if (!token) errors.push('DISCORD_TOKEN is not set');
  else if (!token.includes('.')) errors.push('DISCORD_TOKEN looks wrong — expected a bot token containing dots');

  if (!appId) errors.push('DISCORD_APP_ID is not set');
  else if (!/^\d+$/.test(appId)) errors.push('DISCORD_APP_ID must be a numeric snowflake ID');

  if (errors.length > 0) {
    throw new Error(
      'Discord: missing or invalid env vars:\n' +
      errors.map((e) => `  • ${e}`).join('\n')
    );
  }

  return { token, appId, devGuildId: process.env.DISCORD_DEV_GUILD_ID || null };
}

async function start() {
  const { token, appId, devGuildId } = validateEnv();

  _gateway = new DiscordCommandGateway({ token, appId, devGuildId });

  try {
    await _gateway.start();
  } catch (err) {
    log.error('startup failed', { err });
    throw err;
  }
}

module.exports = { start };

