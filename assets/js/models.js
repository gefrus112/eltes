/* Eltes — model catalogue and provider metadata
   Shared by the app, the settings view and the model picker. */
window.EltesModels = (function () {
  'use strict';

  const PROVIDERS = {
    openai: {
      name: 'OpenAI',
      badge: 'G',
      cls: 'mb-openai',
      api: 'openai',
      keyHint: 'sk-proj-…',
      keyUrl: 'https://platform.openai.com/api-keys',
      baseUrl: 'https://api.openai.com/v1',
      blurb: 'GPT-4.1, GPT-4.1 mini and the o-series reasoning models.'
    },
    anthropic: {
      name: 'Anthropic',
      badge: 'C',
      cls: 'mb-anthropic',
      api: 'anthropic',
      keyHint: 'sk-ant-…',
      keyUrl: 'https://console.anthropic.com/settings/keys',
      baseUrl: 'https://api.anthropic.com/v1',
      blurb: 'Claude Sonnet, Opus and Haiku — strong at long context and code.'
    },
    google: {
      name: 'Google',
      badge: 'G',
      cls: 'mb-google',
      api: 'openai',
      keyHint: 'AIza…',
      keyUrl: 'https://aistudio.google.com/app/apikey',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      blurb: 'Gemini 2.5 Pro and Flash with a very large context window.'
    },
    xai: {
      name: 'xAI',
      badge: 'X',
      cls: 'mb-xai',
      api: 'openai',
      keyHint: 'xai-…',
      keyUrl: 'https://console.x.ai',
      baseUrl: 'https://api.x.ai/v1',
      blurb: 'Grok models, OpenAI-compatible endpoint.'
    },
    deepseek: {
      name: 'DeepSeek',
      badge: 'D',
      cls: 'mb-deepseek',
      api: 'openai',
      keyHint: 'sk-…',
      keyUrl: 'https://platform.deepseek.com/api_keys',
      baseUrl: 'https://api.deepseek.com/v1',
      blurb: 'Strong reasoning and code models at low cost.'
    },
    groq: {
      name: 'Groq',
      badge: 'Q',
      cls: 'mb-groq',
      api: 'openai',
      keyHint: 'gsk_…',
      keyUrl: 'https://console.groq.com/keys',
      baseUrl: 'https://api.groq.com/openai/v1',
      blurb: 'Open weights at very high tokens-per-second.'
    },
    mistral: {
      name: 'Mistral',
      badge: 'M',
      cls: 'mb-mistral',
      api: 'openai',
      keyHint: '…',
      keyUrl: 'https://console.mistral.ai/api-keys',
      baseUrl: 'https://api.mistral.ai/v1',
      blurb: 'Mistral Large and Codestral.'
    },
    openrouter: {
      name: 'OpenRouter',
      badge: 'R',
      cls: 'mb-openrouter',
      api: 'openai',
      keyHint: 'sk-or-v1-…',
      keyUrl: 'https://openrouter.ai/keys',
      baseUrl: 'https://openrouter.ai/api/v1',
      blurb: 'One key, hundreds of models from every lab.'
    },
    custom: {
      name: 'Custom endpoint',
      badge: '+',
      cls: 'mb-openrouter',
      api: 'openai',
      keyHint: 'your gateway token',
      keyUrl: '',
      baseUrl: '',
      blurb: 'Ollama, vLLM, LiteLLM — any OpenAI-compatible base URL.'
    }
  };

  const MODELS = [
    {
      id: 'claude-sonnet-4-5',
      apiId: 'claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
      provider: 'anthropic',
      context: '200K',
      tier: 'Balanced',
      tags: ['tools', 'vision', 'reasoning', 'coding'],
      blurb: 'Best default for code, long context and careful writing.'
    },
    {
      id: 'claude-opus-4-1',
      apiId: 'claude-opus-4-1',
      name: 'Claude Opus 4.1',
      provider: 'anthropic',
      context: '200K',
      tier: 'Frontier',
      tags: ['tools', 'vision', 'reasoning', 'coding'],
      blurb: 'Deepest reasoning in the Claude family. Slower, pricier.'
    },
    {
      id: 'claude-haiku-4-5',
      apiId: 'claude-haiku-4-5',
      name: 'Claude Haiku 4.5',
      provider: 'anthropic',
      context: '200K',
      tier: 'Fast',
      tags: ['tools', 'vision'],
      blurb: 'Instant answers for short tasks and quick edits.'
    },
    {
      id: 'gpt-4-1',
      apiId: 'gpt-4.1',
      name: 'GPT-4.1',
      provider: 'openai',
      context: '1M',
      tier: 'Balanced',
      tags: ['tools', 'vision', 'coding'],
      blurb: 'Very long context with dependable instruction following.'
    },
    {
      id: 'gpt-4-1-mini',
      apiId: 'gpt-4.1-mini',
      name: 'GPT-4.1 mini',
      provider: 'openai',
      context: '1M',
      tier: 'Fast',
      tags: ['tools', 'vision'],
      blurb: 'Cheap and quick; good for drafts and extraction.'
    },
    {
      id: 'o4-mini',
      apiId: 'o4-mini',
      name: 'o4-mini',
      provider: 'openai',
      context: '200K',
      tier: 'Reasoning',
      tags: ['tools', 'reasoning', 'coding'],
      blurb: 'Thinks before answering. Good for maths and tricky bugs.'
    },
    {
      id: 'gemini-2-5-pro',
      apiId: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      provider: 'google',
      context: '1M',
      tier: 'Frontier',
      tags: ['tools', 'vision', 'reasoning'],
      blurb: 'Huge context and strong multimodal understanding.'
    },
    {
      id: 'gemini-2-5-flash',
      apiId: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      provider: 'google',
      context: '1M',
      tier: 'Fast',
      tags: ['tools', 'vision'],
      blurb: 'Latency-first workhorse with a million-token window.'
    },
    {
      id: 'grok-4',
      apiId: 'grok-4',
      name: 'Grok 4',
      provider: 'xai',
      context: '256K',
      tier: 'Frontier',
      tags: ['tools', 'reasoning'],
      blurb: 'Direct answers with tool use through an OpenAI-compatible API.'
    },
    {
      id: 'deepseek-v3',
      apiId: 'deepseek-chat',
      name: 'DeepSeek V3',
      provider: 'deepseek',
      context: '128K',
      tier: 'Balanced',
      tags: ['tools', 'reasoning', 'coding'],
      blurb: 'Open weights, strong code, very low cost per token.'
    },
    {
      id: 'llama-4-maverick',
      apiId: 'meta-llama/llama-4-maverick-17b-128e-instruct',
      name: 'Llama 4 Maverick',
      provider: 'groq',
      context: '1M',
      tier: 'Open',
      tags: ['tools', 'vision'],
      blurb: 'Meta open weights, served fast through Groq.'
    },
    {
      id: 'mistral-large',
      apiId: 'mistral-large-latest',
      name: 'Mistral Large',
      provider: 'mistral',
      context: '128K',
      tier: 'Balanced',
      tags: ['tools'],
      blurb: 'European frontier model with tidy function calling.'
    },
    {
      id: 'qwen-3-coder',
      apiId: 'qwen/qwen3-coder',
      name: 'Qwen3 Coder',
      provider: 'openrouter',
      context: '256K',
      tier: 'Open',
      tags: ['tools', 'reasoning', 'coding'],
      blurb: 'Code-focused open model routed through OpenRouter.'
    },
    {
      id: 'auto',
      apiId: 'openrouter/auto',
      name: 'Eltes Auto',
      provider: 'openrouter',
      context: 'varies',
      tier: 'Auto',
      tags: ['tools', 'reasoning'],
      blurb: 'Routes each request to the best available connected model.'
    },
    {
      id: 'custom-endpoint',
      apiId: '',
      name: 'Custom endpoint',
      provider: 'custom',
      context: 'yours',
      tier: 'Custom',
      tags: ['tools'],
      blurb: 'Your own OpenAI-compatible server. Set the model ID in Settings.'
    }
  ];

  const DEFAULT_MODEL = 'claude-sonnet-4-5';
  const DEMO_LABEL = 'Demo mode';

  const byId = (id) => MODELS.find((m) => m.id === id) || MODELS[0];
  const providerOf = (model) => PROVIDERS[(model && model.provider) || 'openai'] || PROVIDERS.openai;

  return {
    PROVIDERS,
    MODELS,
    DEFAULT_MODEL,
    DEMO_LABEL,
    byId,
    providerOf,
    isDemo: (id) => !MODELS.some((m) => m.id === id)
  };
})();
