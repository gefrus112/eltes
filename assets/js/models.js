/* Eltes — provider catalogue
   OpenAI-compatible endpoints plus native Anthropic. No demo models: every entry is a
   real API target that needs a key (or a custom base URL pointed at your own server). */
window.EltesModels = (function () {
  'use strict';

  const PROVIDERS = {
    anthropic: {
      name: 'Anthropic',
      brand: 'claude',
      api: 'anthropic',
      keyHint: 'sk-ant-…',
      keyUrl: 'https://console.anthropic.com/settings/keys',
      baseUrl: 'https://api.anthropic.com/v1',
      blurb: 'Claude Opus, Sonnet and Haiku. Native Messages API and streaming.'
    },
    openai: {
      name: 'OpenAI',
      brand: 'openai',
      api: 'openai',
      keyHint: 'sk-proj-…',
      keyUrl: 'https://platform.openai.com/api-keys',
      baseUrl: 'https://api.openai.com/v1',
      blurb: 'GPT-4.1, GPT-4.1 mini and the o-series reasoning models.'
    },
    google: {
      name: 'Google',
      brand: 'gemini',
      api: 'openai',
      keyHint: 'AIza…',
      keyUrl: 'https://aistudio.google.com/app/apikey',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      blurb: 'Gemini 2.5 Pro and Flash through the OpenAI-compatible endpoint.'
    },
    zai: {
      name: 'Z.ai · GLM',
      brand: 'glm',
      api: 'openai',
      keyHint: '…',
      keyUrl: 'https://z.ai/manage-apikey/apikey-list',
      baseUrl: 'https://api.z.ai/api/paas/v4',
      blurb: 'GLM-4.6 and GLM-4.5 from Zhipu, OpenAI-compatible with tool calling.'
    },
    deepseek: {
      name: 'DeepSeek',
      brand: 'deepseek',
      api: 'openai',
      keyHint: 'sk-…',
      keyUrl: 'https://platform.deepseek.com/api_keys',
      baseUrl: 'https://api.deepseek.com/v1',
      blurb: 'DeepSeek V3 chat and R1-style reasoning at low cost.'
    },
    xai: {
      name: 'xAI',
      brand: 'grok',
      api: 'openai',
      keyHint: 'xai-…',
      keyUrl: 'https://console.x.ai',
      baseUrl: 'https://api.x.ai/v1',
      blurb: 'Grok 4 and Grok 3 through an OpenAI-compatible API.'
    },
    qwen: {
      name: 'Qwen · Alibaba',
      brand: 'qwen',
      api: 'openai',
      keyHint: 'sk-…',
      keyUrl: 'https://bailian.console.alibabacloud.com/',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      blurb: 'Qwen3 Max and Coder models on Alibaba Cloud Model Studio.'
    },
    mistral: {
      name: 'Mistral',
      brand: 'mistral',
      api: 'openai',
      keyHint: '…',
      keyUrl: 'https://console.mistral.ai/api-keys',
      baseUrl: 'https://api.mistral.ai/v1',
      blurb: 'Mistral Large and Codestral with function calling.'
    },
    groq: {
      name: 'Groq',
      brand: 'groq',
      api: 'openai',
      keyHint: 'gsk_…',
      keyUrl: 'https://console.groq.com/keys',
      baseUrl: 'https://api.groq.com/openai/v1',
      blurb: 'Llama and Qwen open weights at very high tokens per second.'
    },
    openrouter: {
      name: 'OpenRouter',
      brand: 'openrouter',
      api: 'openai',
      keyHint: 'sk-or-v1-…',
      keyUrl: 'https://openrouter.ai/keys',
      baseUrl: 'https://openrouter.ai/api/v1',
      blurb: 'One key for hundreds of models, with automatic routing and fallbacks.'
    },
    custom: {
      name: 'Custom endpoint',
      brand: 'glm',
      api: 'openai',
      keyHint: 'gateway token (optional)',
      keyUrl: '',
      baseUrl: '',
      blurb: 'Ollama, vLLM, LiteLLM, a Cloudflare Worker — any OpenAI-compatible URL.'
    }
  };

  const MODELS = [
    /* ------------------------------- Anthropic ------------------------------ */
    {
      id: 'claude-sonnet-4-5', apiId: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5',
      provider: 'anthropic', context: '200K', tier: 'Balanced', tools: true, vision: true,
      tags: ['coding', 'tools', 'reasoning'], blurb: 'Best default for code, long context and careful writing.'
    },
    {
      id: 'claude-opus-4-1', apiId: 'claude-opus-4-1', name: 'Claude Opus 4.1',
      provider: 'anthropic', context: '200K', tier: 'Frontier', tools: true, vision: true,
      tags: ['reasoning', 'coding'], blurb: 'Deepest reasoning in the Claude family. Slower, pricier.'
    },
    {
      id: 'claude-haiku-4-5', apiId: 'claude-haiku-4-5', name: 'Claude Haiku 4.5',
      provider: 'anthropic', context: '200K', tier: 'Fast', tools: true, vision: true,
      tags: ['fast'], blurb: 'Instant answers for short tasks and quick edits.'
    },
    /* --------------------------------- OpenAI ------------------------------- */
    {
      id: 'gpt-4-1', apiId: 'gpt-4.1', name: 'GPT-4.1',
      provider: 'openai', context: '1M', tier: 'Balanced', tools: true, vision: true,
      tags: ['coding', 'tools'], blurb: 'Very long context with dependable instruction following.'
    },
    {
      id: 'gpt-4-1-mini', apiId: 'gpt-4.1-mini', name: 'GPT-4.1 mini',
      provider: 'openai', context: '1M', tier: 'Fast', tools: true, vision: true,
      tags: ['fast'], blurb: 'Cheap and quick for drafts, extraction and classification.'
    },
    {
      id: 'o4-mini', apiId: 'o4-mini', name: 'o4-mini',
      provider: 'openai', context: '200K', tier: 'Reasoning', tools: true, vision: false,
      tags: ['reasoning'], blurb: 'Thinks before answering. Good for maths and tricky bugs.'
    },
    /* --------------------------------- Google ------------------------------- */
    {
      id: 'gemini-2-5-pro', apiId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro',
      provider: 'google', context: '1M', tier: 'Frontier', tools: true, vision: true,
      tags: ['vision', 'reasoning'], blurb: 'Huge context and strong multimodal understanding.'
    },
    {
      id: 'gemini-2-5-flash', apiId: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash',
      provider: 'google', context: '1M', tier: 'Fast', tools: true, vision: true,
      tags: ['fast', 'vision'], blurb: 'Latency-first workhorse with a million-token window.'
    },
    /* -------------------------------- Z.ai GLM ------------------------------ */
    {
      id: 'glm-4-6', apiId: 'glm-4.6', name: 'GLM-4.6',
      provider: 'zai', context: '200K', tier: 'Frontier', tools: true, vision: false,
      tags: ['coding', 'tools', 'reasoning'], blurb: 'Zhipu’s flagship coding model with strong agentic tool use.'
    },
    {
      id: 'glm-4-5', apiId: 'glm-4.5', name: 'GLM-4.5',
      provider: 'zai', context: '128K', tier: 'Balanced', tools: true, vision: false,
      tags: ['coding', 'tools'], blurb: 'Hybrid reasoning model, OpenAI-compatible API.'
    },
    {
      id: 'glm-4-5-air', apiId: 'glm-4.5-air', name: 'GLM-4.5 Air',
      provider: 'zai', context: '128K', tier: 'Fast', tools: true, vision: false,
      tags: ['fast'], blurb: 'Lightweight GLM for high-volume and latency-sensitive work.'
    },
    /* -------------------------------- DeepSeek ------------------------------ */
    {
      id: 'deepseek-chat', apiId: 'deepseek-chat', name: 'DeepSeek V3',
      provider: 'deepseek', context: '128K', tier: 'Balanced', tools: true, vision: false,
      tags: ['coding', 'tools'], blurb: 'Open weights, strong code, very low cost per token.'
    },
    {
      id: 'deepseek-reasoner', apiId: 'deepseek-reasoner', name: 'DeepSeek R1',
      provider: 'deepseek', context: '128K', tier: 'Reasoning', tools: false, vision: false,
      tags: ['reasoning'], blurb: 'Long chain-of-thought reasoning, no tool calling.'
    },
    /* ---------------------------------- xAI --------------------------------- */
    {
      id: 'grok-4', apiId: 'grok-4', name: 'Grok 4',
      provider: 'xai', context: '256K', tier: 'Frontier', tools: true, vision: false,
      tags: ['reasoning', 'tools'], blurb: 'Direct answers with tool use through an OpenAI-compatible API.'
    },
    {
      id: 'grok-3', apiId: 'grok-3', name: 'Grok 3',
      provider: 'xai', context: '131K', tier: 'Balanced', tools: true, vision: false,
      tags: ['reasoning'], blurb: 'Lower-cost Grok for everyday drafting and analysis.'
    },
    /* ---------------------------------- Qwen -------------------------------- */
    {
      id: 'qwen3-max', apiId: 'qwen3-max', name: 'Qwen3 Max',
      provider: 'qwen', context: '256K', tier: 'Frontier', tools: true, vision: false,
      tags: ['coding', 'tools'], blurb: 'Alibaba’s flagship Qwen, strong bilingual reasoning.'
    },
    {
      id: 'qwen3-coder', apiId: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus',
      provider: 'qwen', context: '256K', tier: 'Balanced', tools: true, vision: false,
      tags: ['coding'], blurb: 'Code-focused Qwen with repository-scale context.'
    },
    /* --------------------------------- Mistral ------------------------------ */
    {
      id: 'mistral-large', apiId: 'mistral-large-latest', name: 'Mistral Large',
      provider: 'mistral', context: '128K', tier: 'Balanced', tools: true, vision: false,
      tags: ['tools'], blurb: 'European frontier model with tidy function calling.'
    },
    {
      id: 'codestral', apiId: 'codestral-latest', name: 'Codestral',
      provider: 'mistral', context: '256K', tier: 'Fast', tools: false, vision: false,
      tags: ['coding', 'fast'], blurb: 'Completion and code-editing specialist.'
    },
    /* ---------------------------------- Groq -------------------------------- */
    {
      id: 'llama-3-3-70b', apiId: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B',
      provider: 'groq', context: '128K', tier: 'Open', tools: true, vision: false,
      tags: ['fast', 'open'], blurb: 'Meta open weights served at very high throughput.'
    },
    {
      id: 'llama-4-scout', apiId: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout',
      provider: 'groq', context: '128K', tier: 'Open', tools: true, vision: true,
      tags: ['open', 'vision'], blurb: 'Llama 4 with vision, fast on Groq.'
    },
    /* ------------------------------- OpenRouter ----------------------------- */
    {
      id: 'openrouter-auto', apiId: 'openrouter/auto', name: 'OpenRouter Auto',
      provider: 'openrouter', context: 'varies', tier: 'Auto', tools: true, vision: true,
      tags: ['auto'], blurb: 'Routes each request to the best available model and falls back on errors.'
    },
    {
      id: 'or-claude-sonnet', apiId: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5',
      provider: 'openrouter', context: '200K', tier: 'Balanced', tools: true, vision: true,
      tags: ['coding'], blurb: 'Anthropic’s Sonnet billed through OpenRouter credits.'
    },
    {
      id: 'or-gemini-pro', apiId: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro',
      provider: 'openrouter', context: '1M', tier: 'Frontier', tools: true, vision: true,
      tags: ['vision'], blurb: 'Google’s Pro model through OpenRouter.'
    },
    {
      id: 'or-glm', apiId: 'z-ai/glm-4.6', name: 'GLM-4.6',
      provider: 'openrouter', context: '200K', tier: 'Frontier', tools: true, vision: false,
      tags: ['coding', 'tools'], blurb: 'Z.ai GLM-4.6 routed by OpenRouter.'
    },
    {
      id: 'or-deepseek', apiId: 'deepseek/deepseek-chat', name: 'DeepSeek V3',
      provider: 'openrouter', context: '128K', tier: 'Balanced', tools: true, vision: false,
      tags: ['coding'], blurb: 'DeepSeek chat through OpenRouter with fallbacks.'
    },
    {
      id: 'or-qwen-coder', apiId: 'qwen/qwen3-coder', name: 'Qwen3 Coder',
      provider: 'openrouter', context: '256K', tier: 'Open', tools: true, vision: false,
      tags: ['coding', 'open'], blurb: 'Open code model with a large context window.'
    },
    /* --------------------------------- Custom ------------------------------- */
    {
      id: 'custom-endpoint', apiId: '', name: 'Custom endpoint',
      provider: 'custom', context: 'yours', tier: 'Custom', tools: true, vision: false,
      tags: ['self-hosted'], blurb: 'Your own OpenAI-compatible server. Set the model ID in Settings.'
    }
  ];

  const DEFAULT_MODEL = 'claude-sonnet-4-5';

  const byId = (id) => MODELS.find((m) => m.id === id) || MODELS[0];
  const providerOf = (model) => PROVIDERS[(model && model.provider) || 'anthropic'] || PROVIDERS.anthropic;
  const brandOf = (model) => providerOf(model).brand;

  return { PROVIDERS, MODELS, DEFAULT_MODEL, byId, providerOf, brandOf };
})();
