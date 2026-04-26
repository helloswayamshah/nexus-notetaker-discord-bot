const { SlackCommandGateway } = require('./SlackCommandGateway');
const { getTenantStore, getChannelStore } = require('../../core/providers/config');
const { createLogger } = require('../../core/utils/logger');

const log = createLogger('slack:main');

// Registered at module load, not inside start(), so they don't stack if start() is retried.
let _gateway = null;

process.on('unhandledRejection', (err) => log.error('unhandledRejection', { err }));
process.on('uncaughtException',  (err) => log.error('uncaughtException',  { err }));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log.info('shutdown', { signal });
    const stop = _gateway ? _gateway.stop() : Promise.resolve();
    stop.finally(() => process.exit(0));
  });
}

function validateEnv() {
  const botToken      = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const appToken      = process.env.SLACK_APP_TOKEN; // optional — Socket Mode only
  const errors = [];

  if (!botToken) errors.push('SLACK_BOT_TOKEN is not set');
  else if (!botToken.startsWith('xoxb-')) errors.push('SLACK_BOT_TOKEN looks wrong — must start with "xoxb-"');

  if (!signingSecret) errors.push('SLACK_SIGNING_SECRET is not set');
  else if (signingSecret.length < 32) errors.push('SLACK_SIGNING_SECRET looks wrong — expected a 32-char hex string');

  if (appToken && !appToken.startsWith('xapp-')) errors.push('SLACK_APP_TOKEN looks wrong — must start with "xapp-"');

  if (errors.length > 0) {
    throw new Error(
      'Slack: missing or invalid env vars:\n' +
      errors.map((e) => `  • ${e}`).join('\n') +
      '\n\nSee docs/slack-bot-implementation.md — Environment Variables.'
    );
  }

  return {
    botToken,
    signingSecret,
    appToken,
    port: parseInt(process.env.SLACK_PORT || '3001', 10),
  };
}

async function start() {
  const { botToken, signingSecret, appToken, port } = validateEnv();

  // Stores are singletons backed by the same SQLite connection
  const tenantConfigStore = getTenantStore();
  const channelConfigStore = getChannelStore();

  _gateway = new SlackCommandGateway({
    botToken,
    signingSecret,
    appToken,
    port,
    tenantConfigStore,
    channelConfigStore,
  });

  try {
    await _gateway.start();
  } catch (err) {
    log.error('startup failed', { err });
    throw err;
  }
}

module.exports = { start };
