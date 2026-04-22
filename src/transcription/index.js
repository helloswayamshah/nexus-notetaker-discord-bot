const { createWhisperCppTranscriber } = require('./whisperCpp');
const { createOpenAIWhisperTranscriber } = require('./openaiWhisper');
const { decrypt, isEncrypted } = require('../utils/crypto');
const { createLogger } = require('../utils/logger');

const log = createLogger('stt');

function getTranscriber(guildCfg) {
  switch (guildCfg.stt_provider) {
    case 'whispercpp':
      return createWhisperCppTranscriber({
        modelName: guildCfg.stt_model_name,
        modelPath: guildCfg.stt_model_path,
      });
    case 'openai': {
      let apiKey = guildCfg.stt_api_key || '';
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
      throw new Error(`Unknown STT provider: ${guildCfg.stt_provider}`);
  }
}

module.exports = { getTranscriber };
