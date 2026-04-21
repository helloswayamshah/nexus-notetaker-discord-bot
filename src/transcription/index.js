const { createWhisperCppTranscriber } = require('./whisperCpp');
const { createOpenAIWhisperTranscriber } = require('./openaiWhisper');

function getTranscriber(guildCfg) {
  switch (guildCfg.stt_provider) {
    case 'whispercpp':
      return createWhisperCppTranscriber({ modelPath: guildCfg.stt_model_path });
    case 'openai':
      return createOpenAIWhisperTranscriber({ apiKey: guildCfg.stt_api_key });
    default:
      throw new Error(`Unknown STT provider: ${guildCfg.stt_provider}`);
  }
}

module.exports = { getTranscriber };
