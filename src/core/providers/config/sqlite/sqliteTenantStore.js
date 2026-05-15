const { TenantConfigStore } = require('../../../interfaces/TenantConfigStore');
const { encrypt } = require('../../../utils/crypto');

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
  'slack_config_role',
]);

class SqliteTenantStore extends TenantConfigStore {
  constructor(db) {
    super();
    this._db = db; // DatabaseProvider
  }

  get({ platform, tenantId }) {
    let row = this._db.queryOne(
      'SELECT * FROM tenant_config WHERE platform = ? AND tenant_id = ?',
      [platform, tenantId]
    );
    if (!row) {
      const llmBaseUrl = process.env.LLM_DEFAULT_BASE_URL || 'http://localhost:11434';
      const llmModel = process.env.LLM_DEFAULT_MODEL || 'llama3.1';
      this._db.run(
        `INSERT INTO tenant_config (platform, tenant_id, llm_base_url, llm_model, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [platform, tenantId, llmBaseUrl, llmModel, Date.now()]
      );
      row = this._db.queryOne(
        'SELECT * FROM tenant_config WHERE platform = ? AND tenant_id = ?',
        [platform, tenantId]
      );
    }
    return row;
  }

  update({ platform, tenantId }, patch) {
    this.get({ platform, tenantId });
    const keys = Object.keys(patch).filter((k) => ALLOWED_FIELDS.has(k) && patch[k] !== undefined);
    if (keys.length === 0) return this.get({ platform, tenantId });
    const setClause = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => patch[k]);
    this._db.run(
      `UPDATE tenant_config SET ${setClause}, updated_at = ? WHERE platform = ? AND tenant_id = ?`,
      [...values, Date.now(), platform, tenantId]
    );
    return this.get({ platform, tenantId });
  }
}

module.exports = { SqliteTenantStore };
