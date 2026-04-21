const fs = require('node:fs');
const path = require('node:path');

function writeWavHeader(buffer, { sampleRate, channels, bitsPerSample, dataLength }) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
}

async function pcmToWav(pcmPath, wavPath, { sampleRate = 48000, channels = 2, bitsPerSample = 16 } = {}) {
  const pcm = await fs.promises.readFile(pcmPath);
  const header = Buffer.alloc(44);
  writeWavHeader(header, { sampleRate, channels, bitsPerSample, dataLength: pcm.length });
  const out = Buffer.concat([header, pcm]);
  await fs.promises.mkdir(path.dirname(wavPath), { recursive: true });
  await fs.promises.writeFile(wavPath, out);
  return wavPath;
}

function formatTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

module.exports = { pcmToWav, formatTimestamp };
