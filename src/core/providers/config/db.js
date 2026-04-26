// Compatibility shim — forwards to the SQLite driver in sqlite/db.js.
// Existing imports of { db, DATA_DIR } from this path keep working.
const { getSqliteDb, DATA_DIR } = require('./sqlite/db');

const provider = getSqliteDb();

// Expose the raw better-sqlite3 instance for legacy code that calls
// db.prepare() directly (sqliteTenantStore, Discord commands).
const db = provider._db;

module.exports = { db, DATA_DIR };
