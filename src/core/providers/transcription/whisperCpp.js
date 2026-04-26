const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createLogger } = require('../../utils/logger');
const {
  modelsDir,
  modelPath: resolveModelPath,
  modelFilename,
  listSupported,
} = require('./whisperModels');

const log = createLogger('stt:whispercpp');

function createWhisperCppTranscriber({ modelName, modelPath: legacyPath }) {
  const modelPath = resolveModelFile({ modelName, legacyPath });

  const requested = process.env.WHISPER_CPP_BIN || 'whisper-cli';
  const binary = resolveBinary(requested);
  if (!binary) {
    throw new Error(
      `whisper.cpp binary '${requested}' not found on PATH.\n`
      + 'Install whisper.cpp from https://github.com/ggerganov/whisper.cpp/releases, '
      + 'then either add its folder to PATH or set WHISPER_CPP_BIN=<full path to whisper-cli.exe> in .env.'
    );
  }
  log.info('transcriber ready', { binary, modelPath, modelName: modelName || null });

  return {
    async transcribe(wavPath) {
      const timer = log.time('transcribe');
      log.debug('transcribe start', { wavPath });
      try {
        await runWhisper(binary, modelPath, wavPath);
      } catch (err) {
        timer.fail('whisper.cpp failed', err, { wavPath });
        throw err;
      }
      const jsonPath = `${wavPath}.json`;
      const raw = await fs.promises.readFile(jsonPath, 'utf8');
      const data = JSON.parse(raw);
      const segments = (data.transcription || []).map((s) => ({
        startMs: Number(s.offsets?.from ?? 0),
        endMs: Number(s.offsets?.to ?? 0),
        text: (s.text || '').trim(),
      }));
      const text = segments.map((s) => s.text).join(' ').trim();
      await fs.promises.unlink(jsonPath).catch(() => {});
      timer.end('transcribe ok', {
        wavPath,
        segments: segments.length,
        chars: text.length,
      });
      return { text, segments };
    },
  };
}

function runWhisper(binary, modelPath, wavPath) {
  return new Promise((resolve, reject) => {
    const args = ['-m', modelPath, '-f', wavPath, '-oj', '-of', wavPath];
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            `whisper.cpp binary '${binary}' not found on PATH.\n`
            + 'Install whisper.cpp from https://github.com/ggerganov/whisper.cpp/releases, '
            + 'then either add its folder to PATH or set WHISPER_CPP_BIN=<full path to whisper-cli.exe> in .env.'
          )
        );
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        const message = `${binary} exited with code ${code}: ${stderr.slice(-500)}`;
        reject(new Error(message));
      } else {
        resolve();
      }
    });
  });
}

function resolveModelFile({ modelName, legacyPath }) {
  if (modelName) {
    if (!listSupported().includes(modelName)) {
      throw new Error(
        `Unsupported whisper model '${modelName}'. Supported: ${listSupported().join(', ')}.`
      );
    }
    const resolved = resolveModelPath(modelName);
    if (!fs.existsSync(resolved)) {
      const dir = modelsDir();
      const available = safeListBinFiles(dir);
      throw new Error(
        `whisper.cpp model '${modelName}' not found at: ${resolved}\n`
        + `Expected file: ${modelFilename(modelName)} inside ${dir}\n`
        + (available.length
          ? `Available in that folder: ${available.join(', ')}`
          : `That folder is empty or missing. Download models from `
            + `https://huggingface.co/ggerganov/whisper.cpp/tree/main and place them there, `
            + `or set WHISPER_MODELS_DIR=<folder> in .env.`)
      );
    }
    return resolved;
  }

  if (legacyPath) {
    if (!fs.existsSync(legacyPath)) {
      throw new Error(
        `whisper.cpp model file not found at: ${legacyPath}\n`
        + 'Fix via `/config stt model:<choice>` (recommended), or update the legacy path.'
      );
    }
    return legacyPath;
  }

  throw new Error(
    'No whisper.cpp model configured. Run `/config stt model:<choice>` (e.g. base.en). '
    + 'Models are read from WHISPER_MODELS_DIR (default: ./models).'
  );
}

function safeListBinFiles(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.bin'))
      .sort();
  } catch {
    return [];
  }
}

function resolveBinary(name) {
  // Absolute or explicit relative path — use as-is if it exists (on Windows, also try common extensions).
  if (path.isAbsolute(name) || name.includes('\\') || name.includes('/')) {
    if (fs.existsSync(name)) return name;
    if (process.platform === 'win32') {
      for (const ext of windowsExtensions()) {
        const candidate = name + ext;
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return null;
  }

  // Bare name — search PATH, honoring PATHEXT on Windows (Node's spawn doesn't).
  const sep = process.platform === 'win32' ? ';' : ':';
  const dirs = (process.env.PATH || '').split(sep).filter(Boolean);
  const exts = process.platform === 'win32'
    ? (path.extname(name) ? [''] : windowsExtensions())
    : [''];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function windowsExtensions() {
  return (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((e) => e.toLowerCase())
    .filter(Boolean);
}

module.exports = { createWhisperCppTranscriber };
