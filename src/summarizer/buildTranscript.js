const { formatTimestamp } = require('../utils/audio');

function buildTranscript(utterances) {
  const sorted = [...utterances].sort((a, b) => a.startMs - b.startMs);
  const lines = sorted
    .filter((u) => u.text && u.text.trim().length > 0)
    .map((u) => `[${formatTimestamp(u.startMs)}] ${u.displayName}: ${u.text.trim()}`);
  return lines.join('\n');
}

function collectSpeakerNames(utterances) {
  const names = new Set();
  for (const u of utterances) names.add(u.displayName);
  return [...names];
}

module.exports = { buildTranscript, collectSpeakerNames };
