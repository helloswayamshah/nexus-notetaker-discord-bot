const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { DatabaseProvider } = require('../../../interfaces/DatabaseProvider');

const DATA_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', 'data');
const DB_PATH = process.env.SQLITE_PATH || path.join(DATA_DIR, 'bot.db');

class SqliteDatabaseProvider extends DatabaseProvider {
  constructor() {
    super();
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    this._db = new Database(DB_PATH);
    this._db.pragma('journal_mode = WAL');
    this._runMigrations();
  }

  exec(sql) { return this._db.exec(sql); }
  queryOne(sql, params = []) { return this._db.prepare(sql).get(...params); }
  queryAll(sql, params = []) { return this._db.prepare(sql).all(...params); }
  run(sql, params = []) { return this._db.prepare(sql).run(...params); }

  _runMigrations() {
    const hasGuildConfig = this._db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'"
    ).get();

    const hasTenantConfig = this._db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tenant_config'"
    ).get();

    if (hasGuildConfig && !hasTenantConfig) {
      const cols = this._db.prepare('PRAGMA table_info(guild_config)').all();
      if (!cols.some((c) => c.name === 'stt_model_name')) {
        this._db.exec('ALTER TABLE guild_config ADD COLUMN stt_model_name TEXT');
      }

      this._db.transaction(() => {
        this._db.exec(`
          CREATE TABLE tenant_config (
            tenant_id          TEXT NOT NULL,
            platform           TEXT NOT NULL DEFAULT 'discord',
            llm_provider       TEXT NOT NULL DEFAULT 'ollama',
            llm_base_url       TEXT NOT NULL DEFAULT 'http://localhost:11434',
            llm_model          TEXT NOT NULL DEFAULT 'llama3.1',
            stt_provider       TEXT NOT NULL DEFAULT 'whispercpp',
            stt_model_path     TEXT,
            stt_model_name     TEXT,
            stt_api_key        TEXT,
            summary_channel_id TEXT,
            config_role_id     TEXT,
            slack_config_role  TEXT,
            updated_at         INTEGER NOT NULL
          );
          INSERT INTO tenant_config (
            tenant_id, platform, llm_provider, llm_base_url, llm_model,
            stt_provider, stt_model_path, stt_model_name, stt_api_key,
            summary_channel_id, config_role_id, updated_at
          )
          SELECT
            guild_id, 'discord', llm_provider, llm_base_url, llm_model,
            stt_provider, stt_model_path, stt_model_name, stt_api_key,
            summary_channel_id, config_role_id, updated_at
          FROM guild_config;
          DROP TABLE guild_config;
          CREATE UNIQUE INDEX tenant_config_pk ON tenant_config(platform, tenant_id);
        `);
      })();
    } else if (!hasTenantConfig) {
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS tenant_config (
          tenant_id          TEXT NOT NULL,
          platform           TEXT NOT NULL DEFAULT 'discord',
          llm_provider       TEXT NOT NULL DEFAULT 'ollama',
          llm_base_url       TEXT NOT NULL DEFAULT 'http://localhost:11434',
          llm_model          TEXT NOT NULL DEFAULT 'llama3.1',
          stt_provider       TEXT NOT NULL DEFAULT 'whispercpp',
          stt_model_path     TEXT,
          stt_model_name     TEXT,
          stt_api_key        TEXT,
          summary_channel_id TEXT,
          config_role_id     TEXT,
          slack_config_role  TEXT,
          updated_at         INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS tenant_config_pk ON tenant_config(platform, tenant_id);
      `);
    } else {
      // Incremental column additions for existing installs
      const cols = this._db.prepare('PRAGMA table_info(tenant_config)').all();
      if (!cols.some((c) => c.name === 'stt_model_name')) {
        this._db.exec('ALTER TABLE tenant_config ADD COLUMN stt_model_name TEXT');
      }
      if (!cols.some((c) => c.name === 'slack_config_role')) {
        this._db.exec('ALTER TABLE tenant_config ADD COLUMN slack_config_role TEXT');
      }
      const hasIndex = this._db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='tenant_config_pk'"
      ).get();
      if (!hasIndex) {
        this._db.exec('CREATE UNIQUE INDEX tenant_config_pk ON tenant_config(platform, tenant_id)');
      }
    }

    // Slack channel schedule table
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS slack_channel_config (
        workspace_id     TEXT NOT NULL,
        source_channel   TEXT NOT NULL,
        output_channel   TEXT NOT NULL,
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        last_summary_ts  TEXT,
        enabled          INTEGER NOT NULL DEFAULT 1,
        updated_at       INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, source_channel)
      );
    `);
  }
}

let _instance = null;
function getSqliteDb() {
  if (!_instance) _instance = new SqliteDatabaseProvider();
  return _instance;
}

module.exports = { getSqliteDb, SqliteDatabaseProvider, DATA_DIR };
