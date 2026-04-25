const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const ENV_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const MIN_LEVEL = LEVELS[ENV_LEVEL] ?? LEVELS.info;
const USE_JSON = process.env.LOG_FORMAT === 'json';

function safeStringify(value) {
  if (value === undefined) return 'undefined';
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emit(level, module, message, meta) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const ts = new Date().toISOString();

  if (USE_JSON) {
    const record = { ts, level, module, msg: message };
    if (meta && typeof meta === 'object') {
      for (const [k, v] of Object.entries(meta)) {
        record[k] = v instanceof Error ? { message: v.message, stack: v.stack } : v;
      }
    }
    const line = JSON.stringify(record);
    writeLine(level, line);
    return;
  }

  let line = `${ts} ${level.toUpperCase().padEnd(5)} [${module}] ${message}`;
  if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
    const parts = [];
    for (const [k, v] of Object.entries(meta)) {
      if (v instanceof Error) {
        parts.push(`${k}=${v.message}`);
      } else {
        parts.push(`${k}=${safeStringify(v)}`);
      }
    }
    line += ` | ${parts.join(' ')}`;
    // If any value is an Error, dump its stack on a following line
    for (const v of Object.values(meta)) {
      if (v instanceof Error && v.stack) line += `\n${v.stack}`;
    }
  }
  writeLine(level, line);
}

function writeLine(level, line) {
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

function createLogger(module) {
  return {
    debug: (msg, meta) => emit('debug', module, msg, meta),
    info: (msg, meta) => emit('info', module, msg, meta),
    warn: (msg, meta) => emit('warn', module, msg, meta),
    error: (msg, meta) => emit('error', module, msg, meta),
    child: (suffix) => createLogger(`${module}:${suffix}`),
    time: (label) => {
      const started = Date.now();
      return {
        end: (msg, meta = {}) =>
          emit('info', module, msg, { ...meta, label, durationMs: Date.now() - started }),
        fail: (msg, err, meta = {}) =>
          emit('error', module, msg, { ...meta, label, durationMs: Date.now() - started, err }),
      };
    },
  };
}

module.exports = { createLogger };
