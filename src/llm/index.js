const { createOllamaProvider } = require('./ollama');

function getLLM(guildCfg) {
  switch (guildCfg.llm_provider) {
    case 'ollama':
      return createOllamaProvider({
        baseUrl: guildCfg.llm_base_url,
        model: guildCfg.llm_model,
      });
    default:
      throw new Error(`Unknown LLM provider: ${guildCfg.llm_provider}`);
  }
}

module.exports = { getLLM };
