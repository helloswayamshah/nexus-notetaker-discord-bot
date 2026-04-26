class SqliteChannelConfigStore {
  constructor(db) {
    this._db = db; // DatabaseProvider
  }

  listForWorkspace(workspaceId) {
    return this._db.queryAll(
      'SELECT * FROM slack_channel_config WHERE workspace_id = ? AND enabled = 1',
      [workspaceId]
    );
  }

  get(workspaceId, sourceChannel) {
    return this._db.queryOne(
      'SELECT * FROM slack_channel_config WHERE workspace_id = ? AND source_channel = ?',
      [workspaceId, sourceChannel]
    ) || null;
  }

  set(workspaceId, sourceChannel, { outputChannel, intervalMinutes }) {
    this._db.run(
      `INSERT INTO slack_channel_config
         (workspace_id, source_channel, output_channel, interval_minutes, enabled, updated_at)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(workspace_id, source_channel) DO UPDATE SET
         output_channel   = excluded.output_channel,
         interval_minutes = excluded.interval_minutes,
         enabled          = 1,
         updated_at       = excluded.updated_at`,
      [workspaceId, sourceChannel, outputChannel, intervalMinutes, Date.now()]
    );
  }

  markSummarized(workspaceId, sourceChannel, lastTs) {
    this._db.run(
      `UPDATE slack_channel_config SET last_summary_ts = ?, updated_at = ?
       WHERE workspace_id = ? AND source_channel = ?`,
      [lastTs, Date.now(), workspaceId, sourceChannel]
    );
  }

  remove(workspaceId, sourceChannel) {
    this._db.run(
      'DELETE FROM slack_channel_config WHERE workspace_id = ? AND source_channel = ?',
      [workspaceId, sourceChannel]
    );
  }
}

module.exports = { SqliteChannelConfigStore };
