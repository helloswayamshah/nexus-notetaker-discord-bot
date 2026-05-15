/**
 * OracleClient — Node.js client for the Python FastAPI backend.
 * Handles event ingestion and config retrieval.
 */

const { createLogger } = require('../utils/logger');

const log = createLogger('core:oracle');

class OracleClient {
  constructor() {
    this.baseUrl = (process.env.ORACLE_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
    this.enabled = process.env.USE_ORACLE === 'true';
    this._orgId = process.env.ORACLE_ORG_ID || null;
    this._configCache = new Map();
  }

  /**
   * Post an event to the Oracle.
   * @param {object} event 
   * @returns {Promise<object>}
   */
  async postEvent(event) {
    if (!this.enabled) return null;

    // Auto-resolve orgId if missing
    if (!this._orgId) {
      const config = await this.getConfig(event.platform, event.external_id);
      if (!config) return null;
      this._orgId = config.org_id;
    }

    const url = `${this.baseUrl}/orgs/${this._orgId}/events`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        log.error('oracle event post failed', { status: response.status, error });
        return null;
      }

      return await response.json();
    } catch (err) {
      log.error('failed to post event to oracle', { err: err.message, url });
      return null;
    }
  }

  /**
   * Get tenant configuration from Oracle.
   * Resolves platform+externalId to a Nexus Org and its config.
   */
  async getConfig(platform, externalId) {
    if (!this.enabled) return null;

    const cacheKey = `${platform}:${externalId}`;
    if (this._configCache.has(cacheKey)) return this._configCache.get(cacheKey);

    const url = `${this.baseUrl}/orgs/platform-links/resolve/${platform}/${externalId}`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 404) {
          log.warn('no nexus org linked for platform identity', { platform, externalId });
        } else {
          log.error('oracle resolve failed', { status: response.status });
        }
        return null;
      }

      const data = await response.json();
      // data: { org_id: "...", config_json: { ... }, ... }
      const config = {
        org_id: data.org_id,
        ...data.config_json
      };

      this._configCache.set(cacheKey, config);
      if (!this._orgId) this._orgId = data.org_id;
      
      return config;
    } catch (err) {
      log.error('failed to fetch config from oracle', { err: err.message, url });
      return null;
    }
  }
}

// Singleton instance
const oracleClient = new OracleClient();

module.exports = { oracleClient, OracleClient };
