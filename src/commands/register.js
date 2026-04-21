const { REST, Routes } = require('discord.js');
const join = require('./join');
const leave = require('./leave');
const config = require('./config');
const help = require('./help');
const { createLogger } = require('../utils/logger');

const log = createLogger('commands');

const COMMANDS = [join, leave, config, help];

function buildCommandMap() {
  const map = new Map();
  for (const c of COMMANDS) map.set(c.data.name, c);
  return map;
}

async function registerCommands({ token, appId, devGuildId }) {
  const rest = new REST({ version: '10' }).setToken(token);
  const body = COMMANDS.map((c) => c.data.toJSON());
  const timer = log.time('registerCommands');
  try {
    if (devGuildId) {
      await rest.put(Routes.applicationGuildCommands(appId, devGuildId), { body });
      timer.end('commands registered (guild)', { count: body.length, devGuildId });
    } else {
      await rest.put(Routes.applicationCommands(appId), { body });
      timer.end('commands registered (global)', { count: body.length });
    }
  } catch (err) {
    timer.fail('command registration failed', err, { devGuildId });
    throw err;
  }
}

module.exports = { registerCommands, buildCommandMap };
