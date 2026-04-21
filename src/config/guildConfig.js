const { db } = require('./db');

const selectStmt = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?');
const insertWithDefaultsStmt = db.prepare(
  `INSERT INTO guild_config (guild_id, llm_base_url, llm_model, updated_at)
   VALUES (?, ?, ?, ?)`
);

function get(guildId) {
  let row = selectStmt.get(guildId);
  if (!row) {
    const llmBaseUrl =
      process.env.LLM_DEFAULT_BASE_URL || 'http://localhost:11434';
    const llmModel = process.env.LLM_DEFAULT_MODEL || 'llama3.1';
    insertWithDefaultsStmt.run(guildId, llmBaseUrl, llmModel, Date.now());
    row = selectStmt.get(guildId);
  }
  return row;
}

const ALLOWED_FIELDS = new Set([
  'llm_provider',
  'llm_base_url',
  'llm_model',
  'stt_provider',
  'stt_model_path',
  'stt_model_name',
  'stt_api_key',
  'summary_channel_id',
  'config_role_id',
]);

function update(guildId, patch) {
  get(guildId);
  const keys = Object.keys(patch).filter((k) => ALLOWED_FIELDS.has(k));
  if (keys.length === 0) return get(guildId);
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => patch[k]);
  db.prepare(
    `UPDATE guild_config SET ${setClause}, updated_at = ? WHERE guild_id = ?`
  ).run(...values, Date.now(), guildId);
  return get(guildId);
}

module.exports = { get, update };
