/* Eltes — provider catalogue (v3.5, October 2026)
   OpenAI-compatible endpoints plus native Anthropic and the on-device Eltes CAI family.
   No demo models: every hosted entry is a real API target that needs a key (or a custom
   base URL pointed at your own server). CAI models run locally in this tab and say so. */
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
      blurb: 'Claude Opus, Sonnet, Haiku and Fable. Native Messages API and streaming.'
    },
    openai: {
      name: 'OpenAI',
      brand: 'openai',
      api: 'openai',
      keyHint: 'sk-proj-…',
      keyUrl: 'https://platform.openai.com/api-keys',
      baseUrl: 'https://api.openai.com/v1',
      blurb: 'GPT‑6 Sol, GPT‑6.1 Sol and Luna through the OpenAI-compatible API. Streaming requires your API key.'
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
      blurb: 'DeepSeek V4.1 Flash and V4 Pro — low cost, million-token context.'
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
    nvidia: {
      name: 'NVIDIA NIM',
      brand: 'nvidia',
      api: 'openai',
      keyHint: 'nvapi-…',
      keyUrl: 'https://build.nvidia.com/',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      blurb: 'NVIDIA-hosted open models through the OpenAI-compatible NIM endpoint. Availability and free quotas depend on your NVIDIA account.'
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
    cohere: {
      name: 'Cohere',
      brand: 'cohere',
      api: 'openai',
      keyHint: '…',
      keyUrl: 'https://dashboard.cohere.com/api-keys',
      baseUrl: 'https://api.cohere.ai/compatibility/v1',
      blurb: 'Command R+ and Command A — retrieval-focused models with strong tool use and multilingual support.'
    },
    eltes: {
      name: 'Eltes CAI',
      brand: 'eltes',
      api: 'eltes',
      keyHint: '',
      keyUrl: '',
      baseUrl: '',
      local: true,
      blurb: 'Our own on-device conversational models. No key, no network, no waiting.'
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
    /* ------------------------------- Eltes CAI ------------------------------ */
    {
      id: 'eltes-cai-1', apiId: 'eltes-cai-1', name: 'Eltes CAI-1',
      provider: 'eltes', context: 'on-device', tier: 'On-device', tools: false, vision: false,
      local: true, tags: ['local', 'chat', 'no-key'],
      blurb: 'Our own conversational model. Understands plain chat and answers instantly, offline.'
    },
    {
      id: 'eltes-cai-1-fast', apiId: 'eltes-cai-1-fast', name: 'Eltes CAI-1 Fast',
      provider: 'eltes', context: 'on-device', tier: 'Fast', tools: false, vision: false,
      local: true, tags: ['local', 'fast', 'no-key'],
      blurb: 'Short, tight answers from the CAI engine. The quickest way to test a thought.'
    },
    {
      id: 'eltes-cai-docs', apiId: 'eltes-cai-docs', name: 'Eltes CAI Docs',
      provider: 'eltes', context: 'on-device', tier: 'On-device', tools: false, vision: false,
      local: true, tags: ['local', 'docs', 'no-key'],
      blurb: 'A local specialist for Eltes itself: setup, keys, models, accounts and downloads.'
    },
    /* ------------------------------- Anthropic ------------------------------ */
    {
      id: 'claude-sonnet-5-5', apiId: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5',
      provider: 'anthropic', context: '200K', tier: 'Balanced', tools: true, vision: true,
      realtime: true, tags: ['coding', 'tools', 'reasoning', 'streaming', 'default'],
      blurb: 'Anthropic Messages API with real token streaming. Requires an Anthropic API key.'
    },
    {
      id: 'claude-opus-5-5', apiId: 'claude-opus-5-5', name: 'Claude Opus 5.5',
      provider: 'anthropic', context: '200K', tier: 'Frontier', tools: true, vision: true,
      tags: ['reasoning', 'coding'], blurb: 'The deepest Claude for hard reasoning and large refactors.'
    },
    {
      id: 'claude-haiku-5-5', apiId: 'claude-haiku-5-5', name: 'Claude Haiku 5.5',
      provider: 'anthropic', context: '200K', tier: 'Fast', tools: true, vision: true,
      tags: ['fast'], blurb: 'Instant answers for short tasks and quick edits.'
    },
    {
      id: 'claude-fable-5-1', apiId: 'claude-fable-5-1', name: 'Claude Fable 5.1',
      provider: 'anthropic', context: '200K', tier: 'Balanced', tools: true, vision: true,
      tags: ['writing', 'creative'], blurb: 'Voice-first Claude for narrative, product copy and editing.'
    },
    {
      id: 'claude-opus-4-5', apiId: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5',
      provider: 'anthropic', context: '200K', tier: 'Frontier', tools: true, vision: true,
      tags: ['reasoning'], blurb: 'The previous Opus generation, still strong and widely available.'
    },
    {
      id: 'claude-sonnet-4', apiId: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4',
      provider: 'anthropic', context: '200K', tier: 'Balanced', tools: true, vision: true,
      tags: ['coding', 'tools'], blurb: 'Sonnet 4 — excellent balance of speed and reasoning.'
    },
    {
      id: 'claude-haiku-4', apiId: 'claude-haiku-4-20250514', name: 'Claude Haiku 4',
      provider: 'anthropic', context: '200K', tier: 'Fast', tools: true, vision: true,
      tags: ['fast'], blurb: 'Haiku 4 — sub-second latency for classification and extraction.'
    },
    /* --------------------------------- OpenAI ------------------------------- */
    {
      id: 'gpt-6-sol', apiId: 'gpt-6-sol', name: 'GPT‑6 Sol',
      provider: 'openai', context: 'varies', tier: 'Balanced', tools: true, vision: true,
      tags: ['coding', 'tools'], blurb: 'The balanced GPT‑6 tier — dependable tool calling and code.'
    },
    {
      id: 'gpt-6-1-sol', apiId: 'gpt-6-1-sol', name: 'GPT‑6.1 Sol',
      provider: 'openai', context: 'varies', tier: 'Balanced', tools: true, vision: true,
      tags: ['coding', 'tools'], blurb: 'A refinement of Sol with better instruction following.'
    },
    {
      id: 'gpt-6-luna', apiId: 'gpt-6-luna', name: 'GPT‑6 Luna',
      provider: 'openai', context: 'varies', tier: 'Fast', tools: true, vision: true,
      tags: ['fast'], blurb: 'Low-latency GPT‑6 for drafts, extraction and chat.'
    },
    {
      id: 'gpt-4-1', apiId: 'gpt-4.1', name: 'GPT‑4.1',
      provider: 'openai', context: '1M', tier: 'Balanced', tools: true, vision: true,
      tags: ['coding', 'tools'], blurb: 'Legacy but reliable: very long context, steady instruction following.'
    },
    {
      id: 'gpt-4o', apiId: 'gpt-4o', name: 'GPT‑4o',
      provider: 'openai', context: '128K', tier: 'Frontier', tools: true, vision: true,
      tags: ['vision', 'coding', 'tools'], blurb: 'Flagship multimodal GPT‑4o with vision and tool calling.'
    },
    {
      id: 'gpt-4o-mini', apiId: 'gpt-4o-mini', name: 'GPT‑4o mini',
      provider: 'openai', context: '128K', tier: 'Fast', tools: true, vision: true,
      tags: ['fast', 'vision'], blurb: 'Small, fast GPT‑4o variant for high-volume tasks.'
    },
    {
      id: 'o1', apiId: 'o1', name: 'o1',
      provider: 'openai', context: '200K', tier: 'Reasoning', tools: true, vision: true,
      tags: ['reasoning', 'coding'], blurb: 'OpenAI reasoning model with extended thinking.'
    },
    {
      id: 'o1-mini', apiId: 'o1-mini', name: 'o1-mini',
      provider: 'openai', context: '128K', tier: 'Reasoning', tools: true, vision: false,
      tags: ['reasoning', 'fast'], blurb: 'Faster reasoning model for math and code.'
    },
    {
      id: 'o3-mini', apiId: 'o3-mini', name: 'o3-mini',
      provider: 'openai', context: '200K', tier: 'Reasoning', tools: true, vision: false,
      tags: ['reasoning', 'coding'], blurb: 'Latest mini reasoning model with strong STEM performance.'
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
    {
      id: 'gemini-2-0-flash', apiId: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash',
      provider: 'google', context: '1M', tier: 'Fast', tools: true, vision: true,
      tags: ['fast', 'vision'], blurb: 'Gemini 2.0 Flash — next-gen speed and efficiency.'
    },
    {
      id: 'gemini-1-5-pro', apiId: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro',
      provider: 'google', context: '2M', tier: 'Balanced', tools: true, vision: true,
      tags: ['vision', 'reasoning'], blurb: '2M context, excellent long-document understanding.'
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
    {
      id: 'glm-4-7', apiId: 'glm-4.7', name: 'GLM-4.7',
      provider: 'zai', context: '200K', tier: 'Frontier', tools: true, vision: false,
      tags: ['coding', 'reasoning'], blurb: 'Newest GLM with improved reasoning and longer context.'
    },
    /* -------------------------------- DeepSeek ------------------------------ */
    {
      id: 'deepseek-flash', apiId: 'deepseek-flash', name: 'DeepSeek V4.1 Flash',
      provider: 'deepseek', context: '1M', tier: 'Fast', tools: true, vision: true,
      tags: ['fast', 'vision', 'new'], blurb: 'V4.1 Flash (1017): fast, multimodal and very cheap at 1M context.'
    },
    {
      id: 'deepseek-v4-pro', apiId: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro',
      provider: 'deepseek', context: '1M', tier: 'Frontier', tools: true, vision: true,
      tags: ['reasoning', 'coding'], blurb: 'The heavy DeepSeek tier for reasoning, code and long documents.'
    },
    {
      id: 'deepseek-chat', apiId: 'deepseek-chat', name: 'DeepSeek Chat',
      provider: 'deepseek', context: '128K', tier: 'Balanced', tools: true, vision: false,
      tags: ['coding', 'tools'], blurb: 'General-purpose chat model with strong instruction following.'
    },
    {
      id: 'deepseek-reasoner', apiId: 'deepseek-reasoner', name: 'DeepSeek Reasoner',
      provider: 'deepseek', context: '128K', tier: 'Reasoning', tools: true, vision: false,
      tags: ['reasoning', 'coding'], blurb: 'Reasoning-focused DeepSeek with chain-of-thought.'
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
    {
      id: 'grok-4-fast', apiId: 'grok-4-fast-reasoning', name: 'Grok 4 Fast',
      provider: 'xai', context: '256K', tier: 'Fast', tools: true, vision: false,
      tags: ['reasoning', 'fast'], blurb: 'Fast reasoning Grok with reduced latency.'
    },
    {
      id: 'grok-3-mini', apiId: 'grok-3-mini', name: 'Grok 3 Mini',
      provider: 'xai', context: '131K', tier: 'Fast', tools: true, vision: false,
      tags: ['fast'], blurb: 'Compact Grok for quick chat and classification.'
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
    {
      id: 'qwen2-5-32b', apiId: 'qwen2.5-32b-instruct', name: 'Qwen2.5 32B',
      provider: 'qwen', context: '128K', tier: 'Balanced', tools: true, vision: false,
      tags: ['coding', 'tools'], blurb: 'Popular 32B Qwen with strong coding and math.'
    },
    {
      id: 'qwen3-30b-a3b', apiId: 'qwen3-30b-a3b', name: 'Qwen3 30B A3B',
      provider: 'qwen', context: '128K', tier: 'Fast', tools: true, vision: false,
      tags: ['fast', 'coding'], blurb: 'MoE Qwen3 — 30B total, 3B active per token.'
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
    {
      id: 'mistral-small', apiId: 'mistral-small-latest', name: 'Mistral Small',
      provider: 'mistral', context: '128K', tier: 'Fast', tools: true, vision: false,
      tags: ['fast'], blurb: 'Efficient Mistral for high-volume inference.'
    },
    {
      id: 'pixtral-large', apiId: 'pixtral-large-latest', name: 'Pixtral Large',
      provider: 'mistral', context: '128K', tier: 'Balanced', tools: true, vision: true,
      tags: ['vision'], blurb: 'Mistral vision model for image understanding.'
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
    {
      id: 'llama-3-1-8b', apiId: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant',
      provider: 'groq', context: '128K', tier: 'Fast', tools: true, vision: false,
      tags: ['fast', 'open'], blurb: 'Ultra-fast 8B Llama for instant responses.'
    },
    {
      id: 'groq-qwen3-32b', apiId: 'qwen/qwen3-32b', name: 'Qwen3 32B · Groq',
      provider: 'groq', context: '128K', tier: 'Open', tools: true, vision: false,
      tags: ['open', 'coding'], blurb: 'Qwen3 32B at Groq speed for coding and multilingual.'
    },
    /* -------------------------------- NVIDIA NIM --------------------------- */
    {
      id: 'nvidia-llama-3-3', apiId: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B · NVIDIA',
      provider: 'nvidia', context: '128K', tier: 'Open', tools: true, vision: false,
      tags: ['open', 'coding', 'nvidia'], blurb: 'Open-weight Llama served through NVIDIA NIM. Requires your NVIDIA API key; free quota is subject to NVIDIA account availability.'
    },
    {
      id: 'nvidia-nemotron-ultra', apiId: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', name: 'Nemotron Ultra · NVIDIA',
      provider: 'nvidia', context: '128K', tier: 'Open', tools: true, vision: false,
      tags: ['open', 'reasoning', 'nvidia'], blurb: 'NVIDIA Nemotron via NIM. Requires your NVIDIA API key; endpoint access may vary by account.'
    },
    {
      id: 'nvidia-deepseek-r1', apiId: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1 · NVIDIA',
      provider: 'nvidia', context: '128K', tier: 'Reasoning', tools: true, vision: false,
      tags: ['reasoning', 'nvidia'], blurb: 'DeepSeek R1 reasoning model via NVIDIA NIM.'
    },
    {
      id: 'nvidia-mixtral', apiId: 'mistralai/mixtral-8x22b-instruct-v0.1', name: 'Mixtral 8×22B · NVIDIA',
      provider: 'nvidia', context: '64K', tier: 'Open', tools: true, vision: false,
      tags: ['open', 'nvidia'], blurb: 'Mixtral MoE via NVIDIA NIM for balanced performance.'
    },
    /* -------------------------------- Cohere -------------------------------- */
    {
      id: 'command-r-plus', apiId: 'command-r-plus', name: 'Command R+',
      provider: 'cohere', context: '128K', tier: 'Balanced', tools: true, vision: false,
      tags: ['tools', 'reasoning'], blurb: 'Cohere Command R+ — strong RAG and tool use, multilingual.'
    },
    {
      id: 'command-a', apiId: 'command-a-03-2025', name: 'Command A',
      provider: 'cohere', context: '256K', tier: 'Frontier', tools: true, vision: false,
      tags: ['reasoning', 'coding'], blurb: 'Cohere flagship Command A with 256K context and agents.'
    },
    /* ------------------------------- OpenRouter ----------------------------- */
    {
      id: 'openrouter-auto', apiId: 'openrouter/auto', name: 'OpenRouter Auto',
      provider: 'openrouter', context: 'varies', tier: 'Auto', tools: true, vision: true,
      tags: ['auto'], blurb: 'Routes each request to the best available model and falls back on errors.'
    },
    {
      id: 'or-claude-sonnet', apiId: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5',
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
      id: 'or-deepseek', apiId: 'deepseek/deepseek-flash', name: 'DeepSeek V4.1 Flash',
      provider: 'openrouter', context: '1M', tier: 'Fast', tools: true, vision: true,
      tags: ['coding'], blurb: 'DeepSeek Flash through OpenRouter with fallbacks.'
    },
    {
      id: 'or-qwen-coder', apiId: 'qwen/qwen3-coder', name: 'Qwen3 Coder',
      provider: 'openrouter', context: '256K', tier: 'Open', tools: true, vision: false,
      tags: ['coding', 'open'], blurb: 'Open code model with a large context window.'
    },
    {
      id: 'or-llama-maverick', apiId: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick',
      provider: 'openrouter', context: '1M', tier: 'Balanced', tools: true, vision: true,
      tags: ['open', 'vision'], blurb: 'Llama 4 Maverick via OpenRouter with huge context.'
    },
    {
      id: 'or-gemini-flash', apiId: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash',
      provider: 'openrouter', context: '1M', tier: 'Fast', tools: true, vision: true,
      tags: ['fast', 'vision'], blurb: 'Gemini 2.0 Flash via OpenRouter.'
    },
    {
      id: 'or-deepseek-r1', apiId: 'deepseek/deepseek-r1', name: 'DeepSeek R1',
      provider: 'openrouter', context: '128K', tier: 'Reasoning', tools: true, vision: false,
      tags: ['reasoning'], blurb: 'DeepSeek R1 reasoning through OpenRouter.'
    },
    {
      id: 'or-claude-35', apiId: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet',
      provider: 'openrouter', context: '200K', tier: 'Balanced', tools: true, vision: true,
      tags: ['coding'], blurb: 'Claude 3.5 Sonnet via OpenRouter.'
    },
    {
      id: 'or-qwen72b', apiId: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B',
      provider: 'openrouter', context: '128K', tier: 'Balanced', tools: true, vision: false,
      tags: ['coding'], blurb: 'Qwen 2.5 72B via OpenRouter.'
    },
    /* --------------------------------- Custom ------------------------------- */
    {
      id: 'custom-endpoint', apiId: '', name: 'Custom endpoint',
      provider: 'custom', context: 'yours', tier: 'Custom', tools: true, vision: false,
      tags: ['self-hosted'], blurb: 'Your own OpenAI-compatible server. Set the model ID in Settings.'
    }
  ];

  const DEFAULT_MODEL = 'eltes-cai-1';

  const byId = (id) => MODELS.find((m) => m.id === id) || MODELS[0];
  const providerOf = (model) => PROVIDERS[(model && model.provider) || 'anthropic'] || PROVIDERS.anthropic;
  const brandOf = (model) => providerOf(model).brand;
  const isLocal = (model) => !!(model && model.local);

  return { PROVIDERS, MODELS, DEFAULT_MODEL, byId, providerOf, brandOf, isLocal };
})();
