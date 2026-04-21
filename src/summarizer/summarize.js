const { collectSpeakerNames } = require('./buildTranscript');

const SYSTEM_PROMPT = `You are a meeting-summary assistant. You will receive a transcript of a voice call with timestamps and speaker labels.

Return STRICT Markdown with these sections, in this order, and nothing else:

## TL;DR
2-3 sentences capturing the overall purpose and outcome of the call.

## Key Points
- Short bullet points covering decisions, discussions, and important context.

## Action Items
- **<Name>** - <specific task they agreed to do>

Rules:
- Only use names that actually appear as speakers in the transcript.
- Attribute action items to the person who committed to them, not the person who asked.
- If no action items were agreed on, write exactly: "None identified."
- Do not invent facts that are not in the transcript.
- Do not include any prefix, suffix, or preamble text outside the three sections.`;

async function summarize(llm, transcript) {
  const speakers = collectSpeakerNames(parseUtterancesFromTranscript(transcript));
  const userPrompt = [
    `Speakers present: ${speakers.join(', ') || '(unknown)'}`,
    '',
    'Transcript:',
    transcript,
  ].join('\n');

  return llm.chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]);
}

function parseUtterancesFromTranscript(transcript) {
  const out = [];
  for (const line of transcript.split('\n')) {
    const m = line.match(/^\[[^\]]+\]\s+([^:]+):\s*(.*)$/);
    if (m) out.push({ displayName: m[1].trim(), text: m[2] });
  }
  return out;
}

module.exports = { summarize };
