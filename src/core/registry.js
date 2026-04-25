const { createWhisperCppTranscriber } = require('./providers/transcription/whisperCpp');
const { createOpenAIWhisperTranscriber } = require('./providers/transcription/openaiWhisper');
const { createOllamaProvider } = require('./providers/llm/ollama');
const { decrypt, isEncrypted } = require('./utils/crypto');
const { createLogger } = require('./utils/logger');

const log = createLogger('registry');

function getTranscriber(cfg) {
  switch (cfg.stt_provider) {
    case 'whispercpp':
      return createWhisperCppTranscriber({
        modelName: cfg.stt_model_name,
        modelPath: cfg.stt_model_path,
      });
    case 'openai': {
      let apiKey = cfg.stt_api_key || '';
      if (apiKey && !isEncrypted(apiKey)) {
        log.warn('stt_api_key stored in plaintext (legacy) — rotate via `/config stt api_key:...` to encrypt');
      }
      try {
        apiKey = decrypt(apiKey);
      } catch (err) {
        throw new Error(
          `Could not decrypt OpenAI Whisper API key: ${err.message}`
        );
      }
      return createOpenAIWhisperTranscriber({ apiKey });
    }
    default:
      throw new Error(`Unknown STT provider: ${cfg.stt_provider}`);
  }
}

function getLLM(cfg) {
  switch (cfg.llm_provider) {
    case 'ollama':
      return createOllamaProvider({
        baseUrl: cfg.llm_base_url,
        model: cfg.llm_model,
      });
    default:
      throw new Error(`Unknown LLM provider: ${cfg.llm_provider}`);
  }
}

module.exports = { getTranscriber, getLLM };
