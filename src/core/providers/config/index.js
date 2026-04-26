const { getSqliteDb } = require('./sqlite/db');
const { SqliteTenantStore } = require('./sqlite/sqliteTenantStore');
const { SqliteChannelConfigStore } = require('./sqlite/sqliteChannelConfigStore');

function getDb() {
  const driver = (process.env.DB_DRIVER || 'sqlite').toLowerCase();
  switch (driver) {
    case 'sqlite': return getSqliteDb();
    // case 'postgres': return getPostgresDb();
    default: throw new Error(`Unknown DB_DRIVER "${driver}". Supported: sqlite`);
  }
}

function getTenantStore() {
  return new SqliteTenantStore(getDb());
}

function getChannelStore() {
  return new SqliteChannelConfigStore(getDb());
}

module.exports = { getDb, getTenantStore, getChannelStore };
