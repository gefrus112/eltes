'use strict';

// Fixed provider targets prevent arbitrary URL proxying / SSRF. Model IDs are the
// API IDs the app already sends; custom endpoints stay browser-direct.
const PROVIDERS = Object.freeze({
  openai: {
    name: 'OpenAI', base: 'https://api.openai.com/v1', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['gpt-6-sol', 'gpt-6-1-sol', 'gpt-6-luna', 'gpt-4.1']
  },
  anthropic: {
    name: 'Anthropic', base: 'https://api.anthropic.com/v1', path: '/messages', keyTest: '/models?limit=1', api: 'anthropic',
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'claude-opus-4-5-20251101']
  },
  google: {
    name: 'Google', base: 'https://generativelanguage.googleapis.com/v1beta/openai', path: '/chat/completions', keyTest: 'https://generativelanguage.googleapis.com/v1beta/models', api: 'google',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash']
  },
  deepseek: {
    name: 'DeepSeek', base: 'https://api.deepseek.com/v1', path: '/chat/completions', keyTest: 'https://api.deepseek.com/models', api: 'openai',
    models: ['deepseek-flash', 'deepseek-v4-pro']
  },
  zai: {
    name: 'Z.ai', base: 'https://api.z.ai/api/paas/v4', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air']
  },
  xai: {
    name: 'xAI', base: 'https://api.x.ai/v1', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['grok-4', 'grok-3']
  },
  qwen: {
    name: 'Qwen', base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['qwen3-max', 'qwen3-coder-plus']
  },
  mistral: {
    name: 'Mistral', base: 'https://api.mistral.ai/v1', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['mistral-large-latest', 'codestral-latest']
  },
  groq: {
    name: 'Groq', base: 'https://api.groq.com/openai/v1', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct']
  },
  nvidia: {
    name: 'NVIDIA NIM', base: 'https://integrate.api.nvidia.com/v1', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['meta/llama-3.3-70b-instruct', 'nvidia/llama-3.1-nemotron-ultra-253b-v1']
  },
  openrouter: {
    name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', path: '/chat/completions', keyTest: '/models', api: 'openai',
    models: ['openrouter/auto', 'anthropic/claude-sonnet-5.5', 'openai/gpt-6-sol', 'google/gemini-2.5-pro', 'z-ai/glm-4.6', 'deepseek/deepseek-flash', 'qwen/qwen3-coder']
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
