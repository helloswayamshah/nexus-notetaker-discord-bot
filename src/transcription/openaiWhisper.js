const fs = require('node:fs');
const path = require('node:path');
const { request, FormData } = require('undici');
const { createLogger } = require('../utils/logger');

const log = createLogger('stt:openai');

function createOpenAIWhisperTranscriber({ apiKey, model = 'whisper-1' }) {
  if (!apiKey) {
    throw new Error(
      'OpenAI Whisper requires an API key. Run `/config stt provider:openai api_key:<sk-...>`.'
    );
  }
  log.info('transcriber ready', { model });

  return {
    async transcribe(wavPath) {
      const timer = log.time('transcribe');
      log.debug('transcribe start', { wavPath });
      const buf = await fs.promises.readFile(wavPath);
      const form = new FormData();
      form.append('file', new Blob([buf], { type: 'audio/wav' }), path.basename(wavPath));
      form.append('model', model);
      form.append('response_format', 'verbose_json');

      const { statusCode, body } = await request(
        'https://api.openai.com/v1/audio/transcriptions',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}` },
          body: form,
          bodyTimeout: 0,
          headersTimeout: 0,
        }
      );
      const text = await body.text();
      if (statusCode < 200 || statusCode >= 300) {
        const err = new Error(`OpenAI Whisper returned ${statusCode}: ${text.slice(0, 500)}`);
        timer.fail('openai whisper failed', err, { wavPath, statusCode });
        throw err;
      }
      const data = JSON.parse(text);
      const segments = (data.segments || []).map((s) => ({
        startMs: Math.round((s.start ?? 0) * 1000),
        endMs: Math.round((s.end ?? 0) * 1000),
        text: (s.text || '').trim(),
      }));
      const outText = (data.text || '').trim();
      timer.end('transcribe ok', {
        wavPath,
        segments: segments.length,
        chars: outText.length,
      });
      return { text: outText, segments };
    },
  };
}

module.exports = { createOpenAIWhisperTranscriber };
