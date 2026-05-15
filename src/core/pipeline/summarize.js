async function summarize(llm, userPrompt, systemPrompt) {
  return llm.chat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);
}

module.exports = { summarize };
