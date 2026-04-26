// Compatibility shim — Discord command handlers import this directly.
// New code should use src/core/providers/config/index.js getTenantStore() instead.
const { getSqliteDb } = require('./sqlite/db');
const { SqliteTenantStore } = require('./sqlite/sqliteTenantStore');

const tenantConfig = new SqliteTenantStore(getSqliteDb());

module.exports = tenantConfig;
module.exports.SqliteTenantStore = SqliteTenantStore;
