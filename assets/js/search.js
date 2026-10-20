/* Eltes — web search provider catalogue (v3.6)
   Metadata for the optional search backends. The actual endpoints live in
   lib/search.cjs and are a fixed server allowlist; this file only drives UI. */
window.EltesSearch = (function () {
  'use strict';

  const PROVIDERS = {
    brave: {
      name: 'Brave Search',
      keyHint: 'BSA…',
      keyUrl: 'https://api.search.brave.com/app/keys',
      blurb: 'Independent web index with a free developer tier.',
      answer: false
    },
    tavily: {
      name: 'Tavily',
      keyHint: 'tvly-…',
      keyUrl: 'https://app.tavily.com/home',
      blurb: 'Search built for AI agents; returns a short answer with sources.',
      answer: true
    },
    serper: {
      name: 'Serper',
      keyHint: '…',
      keyUrl: 'https://serper.dev/api-key',
      blurb: 'Google results with answer boxes and knowledge panels.',
      answer: true
    },
    exa: {
      name: 'Exa',
      keyHint: '…',
      keyUrl: 'https://dashboard.exa.ai/api-keys',
      blurb: 'Neural web search with page text and dates.',
      answer: false
    }
  };

  const DEFAULT = 'brave';
  const byId = (id) => PROVIDERS[id] || null;

  return { PROVIDERS, DEFAULT, byId };
})();
