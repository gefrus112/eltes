'use strict';

// Fixed provider targets prevent arbitrary URL proxying / SSRF. Model IDs are the
// API IDs the app already sends; custom endpoints stay browser-direct.
const PROVIDERS = Object.freeze({
  openai: {
    name: 'OpenAI', base: 'https://api.openai.com/v1', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['gpt-6-sol', 'gpt-6-1-sol', 'gpt-6-luna', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'o3-mini']
  },
  anthropic: {
    name: 'Anthropic', base: 'https://api.anthropic.com/v1', path: '/messages', keyTest: '/models?limit=1', api: 'anthropic',
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'claude-opus-4-5-20251101', 'claude-sonnet-4-20250514', 'claude-haiku-4-20250514']
  },
  google: {
    name: 'Google', base: 'https://generativelanguage.googleapis.com/v1beta/openai', path: '/chat/completions', keyTest: 'https://generativelanguage.googleapis.com/v1beta/models', api: 'google',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro']
  },
  deepseek: {
    name: 'DeepSeek', base: 'https://api.deepseek.com/v1', path: '/chat/completions', keyTest: 'https://api.deepseek.com/models', api: 'openai',
    models: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner']
  },
  zai: {
    name: 'Z.ai', base: 'https://api.z.ai/api/paas/v4', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air', 'glm-4.7']
  },
  xai: {
    name: 'xAI', base: 'https://api.x.ai/v1', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['grok-4', 'grok-3', 'grok-4-fast-reasoning', 'grok-3-mini']
  },
  qwen: {
    name: 'Qwen', base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['qwen3-max', 'qwen3-coder-plus', 'qwen2.5-32b-instruct', 'qwen3-30b-a3b']
  },
  mistral: {
    name: 'Mistral', base: 'https://api.mistral.ai/v1', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['mistral-large-latest', 'codestral-latest', 'mistral-small-latest', 'pixtral-large-latest']
  },
  groq: {
    name: 'Groq', base: 'https://api.groq.com/openai/v1', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.1-8b-instant', 'qwen/qwen3-32b']
  },
  nvidia: {
    name: 'NVIDIA NIM', base: 'https://integrate.api.nvidia.com/v1', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['meta/llama-3.3-70b-instruct', 'nvidia/llama-3.1-nemotron-ultra-253b-v1', 'deepseek-ai/deepseek-r1', 'mistralai/mixtral-8x22b-instruct-v0.1']
  },
  openrouter: {
    name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['openrouter/auto', 'anthropic/claude-sonnet-5.5', 'openai/gpt-6-sol', 'google/gemini-2.5-pro', 'z-ai/glm-4.6', 'deepseek/deepseek-flash', 'qwen/qwen3-coder', 'meta-llama/llama-4-maverick', 'google/gemini-2.0-flash', 'deepseek/deepseek-r1', 'qwen/qwen-2.5-72b-instruct', 'anthropic/claude-3.5-sonnet']
  },
  cohere: {
    name: 'Cohere', base: 'https://api.cohere.ai/compatibility/v1', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['command-r-plus', 'command-a-03-2025']
  }
});

function headersFor(provider, key, isTest = false) {
  const headers = { accept: isTest ? 'application/json' : '*/*' };
  if (provider.api === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  } else if (provider.api === 'google') {
    headers['x-goog-api-key'] = key;
  } else {
    headers.authorization = `Bearer ${key}`;
  }
  return headers;
}

function modelAllowed(providerId, modelId) {
  const provider = PROVIDERS[providerId];
  return !!provider && provider.models.includes(modelId);
}

module.exports = { PROVIDERS, headersFor, modelAllowed };
