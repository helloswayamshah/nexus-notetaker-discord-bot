const { Client, GatewayIntentBits, Events } = require('discord.js');
const { generateDependencyReport } = require('@discordjs/voice');
const { CommandGateway } = require('../../core/interfaces/CommandGateway');
const { registerCommands, buildCommandMap } = require('./commands/register');
const { createDispatcher } = require('./commands/dispatch');
const { createLogger } = require('../../core/utils/logger');

const log = createLogger('discord:gateway');

/**
 * Discord command gateway. Wraps the Discord.js client lifecycle:
 * command registration, event wiring, login, and shutdown.
 */
class DiscordCommandGateway extends CommandGateway {
  constructor({ token, appId, devGuildId }) {
    super();
    this.token = token;
    this.appId = appId;
    this.devGuildId = devGuildId;
    this.client = null;
  }

  async start() {
    log.info('voice dependency report', {
      report: '\n' + generateDependencyReport(),
    });

    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });

    const commandMap = buildCommandMap();
    this.client.on(Events.InteractionCreate, createDispatcher(commandMap));

    this.client.once(Events.ClientReady, (c) => {
      log.info('client ready', {
        user: c.user.tag,
        userId: c.user.id,
        guilds: c.guilds.cache.size,
      });
    });

    this.client.on(Events.Error, (err) => log.error('client error', { err }));
    this.client.on(Events.Warn, (msg) => log.warn('client warn', { msg }));

    await registerCommands({ token: this.token, appId: this.appId, devGuildId: this.devGuildId });
    await this.client.login(this.token);
  }

  async stop() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }
}

module.exports = { DiscordCommandGateway };
