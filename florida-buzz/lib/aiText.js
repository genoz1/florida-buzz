// Provider-neutral text-generation boundary for Florida Buzz.
//
// The rest of the application deliberately depends only on generateText() and
// generateTextWithResearch(). Provider-specific request/response handling stays
// in this module so changing vendors never requires rebuilding the publishing
// pipeline or rewriting its editorial prompts.

const DEFAULT_PROVIDER = 'openai';
const DEFAULT_MODEL = 'gpt-5.6-terra';
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_ATTEMPTS = 3;
const MIN_OUTPUT_TOKENS = 16;

class AIProviderError extends Error {
  constructor(message, { code = 'provider_error', status = null, retryable = false, cause = null } = {}) {
    super(message);
    this.name = 'AIProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

function providerName() {
  return (process.env.AI_TEXT_PROVIDER || DEFAULT_PROVIDER).toLowerCase();
}

function modelName(withResearch) {
  if (withResearch) {
    return process.env.AI_RESEARCH_MODEL || process.env.AI_TEXT_MODEL || DEFAULT_MODEL;
  }
  return process.env.AI_TEXT_MODEL || DEFAULT_MODEL;
}

function timeoutMs() {
  const configured = Number.parseInt(process.env.AI_REQUEST_TIMEOUT_MS, 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

function maxAttempts() {
  const configured = Number.parseInt(process.env.AI_MAX_ATTEMPTS, 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_ATTEMPTS;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of data?.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) {
      if ((content.type === 'output_text' || content.type === 'text') && typeof content.text === 'string') {
        parts.push(content.text);
      }
    }
  }
  return parts.join('\n').trim();
}

function countSearches(data) {
  return (data?.output || []).filter((item) => (
    item.type === 'web_search_call' && (!item.action || item.action.type === 'search')
  )).length;
}

function stopReason(data) {
  if (data?.status === 'incomplete') {
    const reason = data?.incomplete_details?.reason;
    if (reason === 'max_output_tokens') return 'max_tokens';
    return reason || 'incomplete';
  }
  return data?.status === 'completed' ? 'end_turn' : (data?.status || 'unknown');
}

function safeProviderMessage(body, status) {
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 500);
  } catch {
    // Fall through to a status-only error; raw provider bodies are not logged.
  }
  return `request failed with HTTP ${status}`;
}

function classifyHttpError(status, body) {
  if (status === 401 || status === 403) {
    return new AIProviderError(`OpenAI authentication/authorization failed: ${safeProviderMessage(body, status)}`, {
      code: 'authentication_error', status, retryable: false,
    });
  }
  if (status === 429) {
    return new AIProviderError(`OpenAI rate limit reached: ${safeProviderMessage(body, status)}`, {
      code: 'rate_limit', status, retryable: true,
    });
  }
  if (status >= 500) {
    return new AIProviderError(`OpenAI service error: ${safeProviderMessage(body, status)}`, {
      code: 'provider_5xx', status, retryable: true,
    });
  }
  return new AIProviderError(`OpenAI request rejected: ${safeProviderMessage(body, status)}`, {
    code: 'request_rejected', status, retryable: false,
  });
}

async function openAIRequest({ systemPrompt, userPrompt, maxTokens, withResearch, maxSearches }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new AIProviderError('OPENAI_API_KEY is not configured.', {
      code: 'authentication_error', retryable: false,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  const researchInstruction = withResearch
    ? `\n\nUse live web search before answering. Prefer current primary or official sources. Use no more than ${maxSearches} search actions unless a fact cannot otherwise be verified.`
    : '';

  const requestBody = {
    model: modelName(withResearch),
    instructions: `${systemPrompt}${researchInstruction}`,
    input: userPrompt,
    // The Responses API rejects values below 16. Clamp at the provider
    // boundary as a final guard even when a caller accidentally asks for less.
    max_output_tokens: Math.max(MIN_OUTPUT_TOKENS, maxTokens),
    reasoning: { effort: withResearch ? 'medium' : 'none' },
  };

  if (withResearch) {
    requestBody.tools = [{
      type: 'web_search',
      external_web_access: true,
      search_context_size: maxSearches >= 10 ? 'high' : 'medium',
    }];
    // Research-backed workflows must not silently fall back to model memory.
    requestBody.tool_choice = 'required';
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw classifyHttpError(response.status, await response.text());
    }

    const data = await response.json();
    const text = extractResponseText(data);
    if (!text) {
      throw new AIProviderError('OpenAI returned no usable text.', {
        code: 'malformed_response', retryable: true,
      });
    }

    return {
      text,
      searchesUsed: countSearches(data),
      stopReason: stopReason(data),
      provider: 'openai',
      model: modelName(withResearch),
    };
  } catch (err) {
    if (err instanceof AIProviderError) throw err;
    if (err?.name === 'AbortError') {
      throw new AIProviderError('OpenAI request timed out.', {
        code: 'timeout', retryable: true, cause: err,
      });
    }
    throw new AIProviderError(`OpenAI network request failed: ${err?.message || 'unknown network error'}`, {
      code: 'network_error', retryable: true, cause: err,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function requestWithRetry(options) {
  if (providerName() !== 'openai') {
    throw new AIProviderError(`Unsupported AI_TEXT_PROVIDER: ${providerName()}`, {
      code: 'unsupported_provider', retryable: false,
    });
  }

  const attempts = maxAttempts();
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await openAIRequest(options);
    } catch (err) {
      lastError = err;
      if (!err.retryable || attempt === attempts) throw err;
      await sleep(250 * (2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function generateText(systemPrompt, userPrompt, maxTokens = 1500) {
  const result = await requestWithRetry({ systemPrompt, userPrompt, maxTokens, withResearch: false, maxSearches: 0 });
  return result.text;
}

async function generateTextWithResearch(systemPrompt, userPrompt, maxTokens = 3000, maxSearches = 10) {
  const result = await requestWithRetry({ systemPrompt, userPrompt, maxTokens, withResearch: true, maxSearches });
  if (result.searchesUsed < 1) {
    throw new AIProviderError('Research response completed without using live web search.', {
      code: 'research_not_performed', retryable: true,
    });
  }
  return result;
}

module.exports = {
  AIProviderError,
  generateText,
  generateTextWithResearch,
  _test: { extractResponseText, countSearches, stopReason, classifyHttpError, requestWithRetry },
};
