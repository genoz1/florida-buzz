const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateText,
  generateTextWithResearch,
  generateStructuredText,
  generateStructuredTextWithResearch,
  AIProviderError,
} = require('../lib/aiText');

const testSchema = {
  name: 'test_response',
  schema: {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
  },
};

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  };
}

test.beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key-never-sent';
  process.env.AI_TEXT_PROVIDER = 'openai';
  process.env.AI_TEXT_MODEL = 'gpt-5.6-terra';
  process.env.AI_RESEARCH_MODEL = 'gpt-5.6-terra';
  process.env.AI_MAX_ATTEMPTS = '3';
});

test.afterEach(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

test('generateText preserves prompts and normalizes a Responses API result', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return response(200, {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: ' YES ' }] }],
    });
  };
  assert.equal(await generateText('system prompt', 'user prompt', 16), 'YES');
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.body.instructions, 'system prompt');
  assert.equal(request.body.input, 'user prompt');
  assert.equal(request.body.model, 'gpt-5.6-terra');
  assert.equal(request.body.max_output_tokens, 16);
  assert.equal(request.body.tools, undefined);
});

test('Responses API output limit is clamped to 16 for the production suitability failure', async () => {
  let requestBody;
  global.fetch = async (url, options) => {
    requestBody = JSON.parse(options.body);
    return response(200, { status: 'completed', output_text: 'YES' });
  };

  assert.equal(await generateText('suitability instructions', 'headline and summary', 10), 'YES');
  assert.equal(requestBody.max_output_tokens, 16);
});

test('research requires live web search and reports normalized metadata', async () => {
  let requestBody;
  global.fetch = async (url, options) => {
    requestBody = JSON.parse(options.body);
    return response(200, {
      status: 'completed',
      output: [
        { type: 'web_search_call', action: { type: 'search', query: 'current Florida rules' } },
        { type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] },
      ],
    });
  };
  const result = await generateTextWithResearch('research instructions', 'topic', 500, 3);
  assert.equal(result.text, '{"ok":true}');
  assert.equal(result.searchesUsed, 1);
  assert.equal(result.provider, 'openai');
  assert.equal(requestBody.tools[0].type, 'web_search');
  assert.equal(requestBody.tools[0].external_web_access, true);
  assert.equal(requestBody.tool_choice, 'required');
});

test('structured text uses strict Responses API JSON Schema output', async () => {
  let requestBody;
  global.fetch = async (url, options) => {
    requestBody = JSON.parse(options.body);
    return response(200, { status: 'completed', output_text: '{"answer":"ready"}' });
  };

  assert.deepEqual(
    await generateStructuredText('structured instructions', 'topic', testSchema, 100),
    { answer: 'ready' }
  );
  assert.deepEqual(requestBody.text.format, {
    type: 'json_schema',
    name: 'test_response',
    schema: testSchema.schema,
    strict: true,
  });
});

test('malformed structured output is rejected after bounded retries', async () => {
  process.env.AI_MAX_ATTEMPTS = '2';
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return response(200, { status: 'completed', output_text: 'not valid JSON' });
  };

  await assert.rejects(
    () => generateStructuredText('structured instructions', 'topic', testSchema, 100),
    (err) => err.code === 'malformed_response' && err.retryable === true
  );
  assert.equal(calls, 2);
});

test('structured research preserves search enforcement and parsed value', async () => {
  let requestBody;
  global.fetch = async (url, options) => {
    requestBody = JSON.parse(options.body);
    return response(200, {
      status: 'completed',
      output: [
        { type: 'web_search_call', action: { type: 'search', query: 'current information' } },
        { type: 'message', content: [{ type: 'output_text', text: '{"answer":"grounded"}' }] },
      ],
    });
  };

  const result = await generateStructuredTextWithResearch(
    'research instructions', 'topic', testSchema, 500, 3
  );
  assert.deepEqual(result.value, { answer: 'grounded' });
  assert.equal(result.searchesUsed, 1);
  assert.equal(requestBody.tool_choice, 'required');
  assert.equal(requestBody.text.format.type, 'json_schema');
});

test('authentication failure is classified and not immediately retried', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return response(401, { error: { message: 'invalid API key' } });
  };
  await assert.rejects(() => generateText('s', 'u'), (err) => {
    assert.ok(err instanceof AIProviderError);
    assert.equal(err.code, 'authentication_error');
    return true;
  });
  assert.equal(calls, 1);
});

test('rate limits and provider 5xx errors retry and can recover', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) return response(429, { error: { message: 'rate limited' } });
    if (calls === 2) return response(503, { error: { message: 'temporarily unavailable' } });
    return response(200, { status: 'completed', output_text: 'recovered' });
  };
  assert.equal(await generateText('s', 'u'), 'recovered');
  assert.equal(calls, 3);
});

test('timeout is retryable but bounded', async () => {
  process.env.AI_MAX_ATTEMPTS = '2';
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  };
  await assert.rejects(() => generateText('s', 'u'), (err) => err.code === 'timeout');
  assert.equal(calls, 2);
});

test('malformed empty provider responses are rejected after bounded retries', async () => {
  process.env.AI_MAX_ATTEMPTS = '2';
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return response(200, { status: 'completed', output: [] });
  };
  await assert.rejects(() => generateText('s', 'u'), (err) => err.code === 'malformed_response');
  assert.equal(calls, 2);
});

test('research output without a web search is rejected', async () => {
  global.fetch = async () => response(200, { status: 'completed', output_text: '{"answer":true}' });
  await assert.rejects(() => generateTextWithResearch('s', 'u'), (err) => err.code === 'research_not_performed');
});
