const { NotImplementedError } = require('./_abstract');

class TenantConfigStore {
  /** @returns {object} — with defaults applied if the row is new */
  get({ platform, tenantId }) { throw new NotImplementedError('get'); }
  update({ platform, tenantId }, patch) { throw new NotImplementedError('update'); }
}

module.exports = { TenantConfigStore };
