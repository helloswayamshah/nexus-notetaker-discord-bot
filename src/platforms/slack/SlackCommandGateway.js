const { App } = require('@slack/bolt');
const { CommandGateway } = require('../../core/interfaces/CommandGateway');
const { COMMANDS } = require('./commands/index');
const { ChannelScheduler } = require('./channelScheduler');
const { createLogger } = require('../../core/utils/logger');

const log = createLogger('slack:gateway');

class SlackCommandGateway extends CommandGateway {
  constructor({ botToken, signingSecret, appToken, port, tenantConfigStore, channelConfigStore }) {
    super();

    const useSocketMode = !!appToken;

    this.app = new App({
      token: botToken,
      signingSecret,
      socketMode: useSocketMode,
      appToken: useSocketMode ? appToken : undefined,
      port: useSocketMode ? undefined : port,
    });

    this._tenantConfigStore = tenantConfigStore;
    this._channelConfigStore = channelConfigStore;

    this._scheduler = new ChannelScheduler({
      client: this.app.client,
      channelConfigStore,
      tenantConfigStore,
    });
  }

  async start() {
    const { app, _scheduler, _tenantConfigStore, _channelConfigStore } = this;

    const deps = {
      tenantConfigStore: _tenantConfigStore,
      channelConfigStore: _channelConfigStore,
      scheduler: _scheduler,
    };

    for (const cmd of COMMANDS) {
      app.command(cmd.name, cmd.makeHandler(deps));
    }

    log.info('registered commands', { commands: COMMANDS.map((c) => c.name) });

    await app.start();
    _scheduler.start();
    log.info('Slack bot started');
  }

  async stop() {
    this._scheduler.stop();
    await this.app.stop();
    log.info('Slack bot stopped');
  }
}

module.exports = { SlackCommandGateway };
