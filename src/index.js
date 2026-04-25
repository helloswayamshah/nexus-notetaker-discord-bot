// Multi-platform launcher. Gate each platform with its env flag so a single
// failing platform never takes down the others, and individual platforms can
// be deployed or updated independently with no downtime on the rest.
//
// Flags: ENABLE_DISCORD=true  ENABLE_SLACK=true
//
// For single-platform deployments prefer the dedicated entrypoints:
//   Discord: bin/start-discord.js  /  npm run start:discord
require('dotenv').config();
const { createLogger } = require('./core/utils/logger');

const log = createLogger('main');

const PLATFORMS = [
  { name: 'discord', flag: 'ENABLE_DISCORD', path: './platforms/discord/entrypoint' },
  { name: 'slack',   flag: 'ENABLE_SLACK',   path: './platforms/slack/entrypoint' },
];

async function main() {
  const active = PLATFORMS.filter((p) => process.env[p.flag] === 'true');

  if (active.length === 0) {
    log.warn('no platforms enabled', {
      hint: 'Set ENABLE_DISCORD=true and/or ENABLE_SLACK=true',
    });
    return;
  }

  const results = await Promise.allSettled(
    active.map(({ name, path }) => {
      const mod = require(path);
      if (typeof mod.start !== 'function') {
        return Promise.reject(new Error(`${name} entrypoint does not export a start() function`));
      }
      return mod
        .start()
        .catch((err) => {
          log.error(`${name} platform failed to start`, { err });
          throw err; // propagate so allSettled records 'rejected'
        });
    }),
  );

  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed === active.length) {
    log.error('all platforms failed to start — exiting', { failed, total: active.length });
    process.exit(1);
  }
}

main().catch((err) => {
  log.error('fatal startup error', { err });
  process.exit(1);
});