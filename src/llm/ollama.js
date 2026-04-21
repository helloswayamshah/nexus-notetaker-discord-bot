const { request } = require('undici');
const { createLogger } = require('../utils/logger');

const log = createLogger('llm:ollama');

function createOllamaProvider({ baseUrl, model }) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
  log.info('provider ready', { baseUrl, model });

  return {
    async chat(messages) {
      const promptChars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
      const timer = log.time('chat');
      log.debug('chat start', { url, model, messages: messages.length, promptChars });
      const { statusCode, body } = await request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false }),
        bodyTimeout: 0,
        headersTimeout: 0,
      });
      const text = await body.text();
      if (statusCode < 200 || statusCode >= 300) {
        const err = new Error(`Ollama returned ${statusCode}: ${text.slice(0, 500)}`);
        timer.fail('chat failed', err, { statusCode });
        throw err;
      }
      const data = JSON.parse(text);
      const content = data?.message?.content ?? '';
      timer.end('chat ok', {
        responseChars: content.length,
        evalCount: data?.eval_count,
        promptEvalCount: data?.prompt_eval_count,
      });
      return content;
    },
  };
}

module.exports = { createOllamaProvider };
