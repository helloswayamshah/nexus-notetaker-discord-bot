const { runChannelSummary } = require('./channelSummary');
const { createLogger } = require('../../../src/core/utils/logger');

const log = createLogger('slack:scheduler');

class ChannelScheduler {
  constructor({ client, channelConfigStore, tenantConfigStore }) {
    this._client = client;
    this._channelConfigStore = channelConfigStore;
    this._tenantConfigStore = tenantConfigStore;
    this._timers = new Map(); // key: `${workspaceId}:${sourceChannel}`
  }

  // Call once at boot — loads persisted configs for all workspaces already in DB.
  start() {
    if (typeof this._channelConfigStore.listWorkspaces !== 'function') {
      throw new Error('channelConfigStore.listWorkspaces() is required by ChannelScheduler.start()');
    }

    const all = this._channelConfigStore.listWorkspaces();
    for (const workspace of all) {
      const workspaceId =
        typeof workspace === 'string'
          ? workspace
          : workspace.workspace_id || workspace.workspaceId;

      if (!workspaceId) continue;
      this._loadWorkspace(workspaceId);
    }
    log.info({ workspaces: all.length }, 'Scheduler started');
  }

  // Call after a new OAuth install for a workspace.
  loadWorkspace(workspaceId) {
    this._loadWorkspace(workspaceId);
  }

  // Call after /config channel add or remove.
  reloadChannel(workspaceId, sourceChannel) {
    const key = `${workspaceId}:${sourceChannel}`;
    this._clearTimer(key);
    const cfg = this._channelConfigStore.get(workspaceId, sourceChannel);
    if (cfg && cfg.enabled) this._startTimer(workspaceId, cfg);
  }

  stop() {
    for (const timer of this._timers.values()) clearInterval(timer);
    this._timers.clear();
    log.info('Scheduler stopped');
  }

  _loadWorkspace(workspaceId) {
    const configs = this._channelConfigStore.listForWorkspace(workspaceId);
    for (const cfg of configs) this._startTimer(workspaceId, cfg);
    log.info({ workspaceId, count: configs.length }, 'Loaded channel schedules');
  }

  _startTimer(workspaceId, channelCfg) {
    const key = `${workspaceId}:${channelCfg.source_channel}`;
    this._clearTimer(key);
    const intervalMs = channelCfg.interval_minutes * 60 * 1000;
    const timer = setInterval(() => this._runOnce(workspaceId, channelCfg.source_channel), intervalMs);
    this._timers.set(key, timer);
    log.info({ key, intervalMinutes: channelCfg.interval_minutes }, 'Timer started');
  }

  _clearTimer(key) {
    if (this._timers.has(key)) {
      clearInterval(this._timers.get(key));
      this._timers.delete(key);
    }
  }

  async _runOnce(workspaceId, sourceChannel) {
    const cfg = this._channelConfigStore.get(workspaceId, sourceChannel);
    if (!cfg || !cfg.enabled) {
      this._clearTimer(`${workspaceId}:${sourceChannel}`);
      return;
    }

    const tenantConfig = await this._tenantConfigStore.get({ platform: 'slack', tenantId: workspaceId });

    try {
      const newestTs = await runChannelSummary({
        client: this._client,
        workspaceId,
        sourceChannel: cfg.source_channel,
        outputChannel: cfg.output_channel,
        tenantConfig,
        oldestTs: cfg.last_summary_ts || undefined,
      });
      if (newestTs) {
        this._channelConfigStore.markSummarized(workspaceId, sourceChannel, newestTs);
      }
    } catch (err) {
      log.error({ err, workspaceId, sourceChannel }, 'Scheduled summary failed');
    }
  }
}

module.exports = { ChannelScheduler };
