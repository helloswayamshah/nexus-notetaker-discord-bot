const { NotImplementedError } = require('./_abstract');

class DatabaseProvider {
  exec(sql) { throw new NotImplementedError('exec'); }
  queryOne(sql, params) { throw new NotImplementedError('queryOne'); }
  queryAll(sql, params) { throw new NotImplementedError('queryAll'); }
  run(sql, params) { throw new NotImplementedError('run'); }
}

module.exports = { DatabaseProvider };
