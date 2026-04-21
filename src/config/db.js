const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'bot.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id           TEXT PRIMARY KEY,
    llm_provider       TEXT NOT NULL DEFAULT 'ollama',
    llm_base_url       TEXT NOT NULL DEFAULT 'http://localhost:11434',
    llm_model          TEXT NOT NULL DEFAULT 'llama3.1',
    stt_provider       TEXT NOT NULL DEFAULT 'whispercpp',
    stt_model_path     TEXT,
    stt_api_key        TEXT,
    summary_channel_id TEXT,
    config_role_id     TEXT,
    updated_at         INTEGER NOT NULL
  );
`);

addColumnIfMissing('stt_model_name', 'TEXT');

function addColumnIfMissing(column, type) {
  const cols = db.prepare(`PRAGMA table_info(guild_config)`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE guild_config ADD COLUMN ${column} ${type}`);
  }
}

module.exports = { db, DATA_DIR };
