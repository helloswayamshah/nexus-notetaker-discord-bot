const path = require('node:path');

const DEFAULT_MODELS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'models');

// Canonical list of whisper.cpp GGML models. The filename convention is
// `ggml-<name>.bin` on the official HuggingFace repo.
// Keep this list under 25 entries (Discord slash-command choice limit).
const MODELS = [
  { name: 'tiny.en',   size: '75 MB',   description: 'English-only, fastest, lowest quality' },
  { name: 'tiny',      size: '75 MB',   description: 'Multilingual, fastest' },
  { name: 'base.en',   size: '142 MB',  description: 'English-only, balanced (recommended default)' },
  { name: 'base',      size: '142 MB',  description: 'Multilingual, balanced' },
  { name: 'small.en',  size: '466 MB',  description: 'English-only, better accuracy' },
  { name: 'small',     size: '466 MB',  description: 'Multilingual, better accuracy' },
  { name: 'medium.en', size: '1.5 GB',  description: 'English-only, great accuracy, slower' },
  { name: 'medium',    size: '1.5 GB',  description: 'Multilingual, great accuracy, slower' },
  { name: 'large-v3',  size: '3.1 GB',  description: 'Multilingual, best quality (GPU recommended)' },
];

function modelsDir() {
  return process.env.WHISPER_MODELS_DIR || DEFAULT_MODELS_DIR;
}

function modelFilename(name) {
  return `ggml-${name}.bin`;
}

function modelPath(name) {
  return path.join(modelsDir(), modelFilename(name));
}

function listSupported() {
  return MODELS.map((m) => m.name);
}

function getModelMeta(name) {
  return MODELS.find((m) => m.name === name) || null;
}

module.exports = {
  MODELS,
  modelsDir,
  modelFilename,
  modelPath,
  listSupported,
  getModelMeta,
  DEFAULT_MODELS_DIR,
};
