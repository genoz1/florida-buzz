// Thin wrapper around the Anthropic Messages API.
// Uses global fetch (Node 18+) so we don't need an extra dependency.

const MODEL = 'claude-sonnet-4-6';

async function askClaude(systemPrompt, userPrompt, maxTokens = 1500) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const textBlock = data.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text.trim() : '';
}

// Same as askClaude, but gives the model the web_search tool so it can ground
// its answer in current information instead of relying on training data.
// The Anthropic API runs searches server-side and folds results back into the
// same response automatically — no manual multi-turn loop needed here.
// Returns both the final text and how many searches were actually used, so
// callers can log/verify the model did real research rather than skipping it.
async function askClaudeWithSearch(systemPrompt, userPrompt, maxTokens = 3000, maxSearches = 10) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const textBlocks = data.content.filter((b) => b.type === 'text');
  const searchesUsed = data.content.filter(
    (b) => b.type === 'server_tool_use' && b.name === 'web_search'
  ).length;

  return {
    text: textBlocks.map((b) => b.text).join('\n').trim(),
    searchesUsed,
  };
}

module.exports = { askClaude, askClaudeWithSearch };
