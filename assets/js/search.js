/* Eltes — web search provider catalogue (v3.9)
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

  /* Recency filter labels shared with the backend allowlist. */
  const FRESHNESS = {
    any: { label: 'Any time', short: 'any time' },
    day: { label: 'Past 24 hours', short: 'past day' },
    week: { label: 'Past week', short: 'past week' },
    month: { label: 'Past month', short: 'past month' },
    year: { label: 'Past year', short: 'past year' }
  };

  const DEFAULT = 'brave';
  const DEFAULT_FRESHNESS = 'any';
  const byId = (id) => PROVIDERS[id] || null;
  const freshnessLabel = (id) => (FRESHNESS[id] || FRESHNESS.any).label;

  return { PROVIDERS, FRESHNESS, DEFAULT, DEFAULT_FRESHNESS, byId, freshnessLabel };
})();
