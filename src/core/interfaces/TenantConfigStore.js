const { NotImplementedError } = require('./_abstract');

class TenantConfigStore {
  /** @returns {object} — with defaults applied if the row is new */
  async get({ platform, tenantId }) { throw new NotImplementedError('get'); }
  async update({ platform, tenantId }, patch) { throw new NotImplementedError('update'); }
}

module.exports = { TenantConfigStore };
