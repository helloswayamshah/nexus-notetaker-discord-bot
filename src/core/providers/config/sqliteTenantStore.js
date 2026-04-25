const { TenantConfigStore } = require('../../interfaces/TenantConfigStore');
const { db } = require('./db');

const selectStmt = db.prepare(
  'SELECT * FROM tenant_config WHERE platform = ? AND tenant_id = ?'
);
const insertWithDefaultsStmt = db.prepare(
  `INSERT INTO tenant_config (platform, tenant_id, llm_base_url, llm_model, updated_at)
   VALUES (?, ?, ?, ?, ?)`
);

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

class SqliteTenantStore extends TenantConfigStore {
  async get({ platform, tenantId }) {
    let row = selectStmt.get(platform, tenantId);
    if (!row) {
      const llmBaseUrl =
        process.env.LLM_DEFAULT_BASE_URL || 'http://localhost:11434';
      const llmModel = process.env.LLM_DEFAULT_MODEL || 'llama3.1';
      insertWithDefaultsStmt.run(platform, tenantId, llmBaseUrl, llmModel, Date.now());
      row = selectStmt.get(platform, tenantId);
    }
    return row;
  }

  async update({ platform, tenantId }, patch) {
    this.get({ platform, tenantId });
    const keys = Object.keys(patch).filter((k) => ALLOWED_FIELDS.has(k));
    if (keys.length === 0) return this.get({ platform, tenantId });
    const setClause = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => patch[k]);
    db.prepare(
      `UPDATE tenant_config SET ${setClause}, updated_at = ? WHERE platform = ? AND tenant_id = ?`
    ).run(...values, Date.now(), platform, tenantId);
    return this.get({ platform, tenantId });
  }
}

// Export a singleton instance for backward compatibility with the old guildConfig pattern.
const tenantConfig = new SqliteTenantStore();

module.exports = tenantConfig;
module.exports.SqliteTenantStore = SqliteTenantStore;
