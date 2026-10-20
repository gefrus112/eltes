'use strict';

/* Fixed search-provider targets.
   Every endpoint is hard-coded here so the proxy can never be pointed at an
   arbitrary URL. Each provider receives the user's own search key and returns
   normalized `{ title, url, snippet }` records. */

const MAX_RESULTS = 10;
const MAX_QUERY = 400;

/* Recency filters, mapped per provider below. `any` adds no upstream filter. */
const FRESHNESS = Object.freeze({
  any: 'Any time',
  day: 'Past day',
  week: 'Past week',
  month: 'Past month',
  year: 'Past year'
});
const BRAVE_FRESHNESS = { day: 'pd', week: 'pw', month: 'pm', year: 'py' };
const SERPER_FRESHNESS = { day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' };
const DAYS = { day: 1, week: 7, month: 31, year: 365 };

const PROVIDERS = Object.freeze({
  brave: {
    name: 'Brave Search',
    endpoint: 'https://api.search.brave.com/res/v1/web/search',
    method: 'GET',
    keyHint: 'BSA…',
    keyUrl: 'https://api.search.brave.com/app/keys',
    blurb: 'Independent web index with a free developer tier. One key, no Google account.'
  },
  tavily: {
    name: 'Tavily',
    endpoint: 'https://api.tavily.com/search',
    method: 'POST',
    keyHint: 'tvly-…',
    keyUrl: 'https://app.tavily.com/home',
    blurb: 'Search API built for AI agents; can return a short synthesized answer with sources.'
  },
  serper: {
    name: 'Serper',
    endpoint: 'https://google.serper.dev/search',
    method: 'POST',
    keyHint: '…',
    keyUrl: 'https://serper.dev/api-key',
    blurb: 'Google SERP results through a simple API, including answer boxes and knowledge panels.'
  },
  exa: {
    name: 'Exa',
    endpoint: 'https://api.exa.ai/search',
    method: 'POST',
    keyHint: '…',
    keyUrl: 'https://dashboard.exa.ai/api-keys',
    blurb: 'Neural search over the web with extracted page text and publication dates.'
  }
});

const ids = () => Object.keys(PROVIDERS);

const TEXT_LIMIT = 320;

function sanitizeText(value, limit = TEXT_LIMIT) {
  const text = String(value == null ? '' : value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function safeUrl(raw) {
  let url;
  try { url = new URL(String(raw || '')); }
  catch { return ''; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  if (url.username || url.password) return '';
  url.hash = '';
  const out = url.toString();
  return out.length > 2048 ? '' : out;
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

function normalizeQuery(value) {
  const query = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!query || query.length > MAX_QUERY) return '';
  if (/[\u0000-\u001f\u007f]/.test(query)) return '';
  return query;
}

function normalizeCount(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 6;
  return n > MAX_RESULTS ? MAX_RESULTS : n;
}

function normalizeFreshness(value) {
  const key = String(value == null ? '' : value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(FRESHNESS, key) ? key : 'any';
}

function headersFor(providerId, key) {
  const headers = { accept: 'application/json', 'user-agent': 'Eltes/3.7 (+https://github.com/gefrus112/eltes)' };
  if (providerId === 'brave') headers['x-subscription-token'] = key;
  else if (providerId === 'serper') headers['x-api-key'] = key;
  else if (providerId === 'exa') headers['x-api-key'] = key;
  else headers.authorization = `Bearer ${key}`;
  if (providerId !== 'brave') headers['content-type'] = 'application/json';
  return headers;
}

function buildRequest(providerId, query, count, key, freshness = 'any', now = Date.now()) {
  const provider = PROVIDERS[providerId];
  if (!provider) return null;
  const headers = headersFor(providerId, key);
  const window = normalizeFreshness(freshness);
  if (providerId === 'brave') {
    const url = new URL(provider.endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(count));
    url.searchParams.set('safesearch', 'moderate');
    if (BRAVE_FRESHNESS[window]) url.searchParams.set('freshness', BRAVE_FRESHNESS[window]);
    return { url: url.toString(), init: { method: 'GET', headers } };
  }
  if (providerId === 'tavily') {
    const body = { query, max_results: count, include_answer: true, search_depth: 'basic' };
    if (DAYS[window]) body.days = DAYS[window];
    return { url: provider.endpoint, init: { method: 'POST', headers, body: JSON.stringify(body) } };
  }
  if (providerId === 'serper') {
    const body = { q: query, num: count };
    if (SERPER_FRESHNESS[window]) body.tbs = SERPER_FRESHNESS[window];
    return { url: provider.endpoint, init: { method: 'POST', headers, body: JSON.stringify(body) } };
  }
  const body = { query, numResults: count, type: 'auto', contents: { text: { maxCharacters: 600 } } };
  if (DAYS[window]) {
    const since = new Date(now - DAYS[window] * 86400000);
    body.startPublishedDate = since.toISOString().slice(0, 10);
  }
  return { url: provider.endpoint, init: { method: 'POST', headers, body: JSON.stringify(body) } };
}

function dedupe(results, count) {
  const seen = new Set();
  const out = [];
  results.forEach((item) => {
    if (!item || !item.url || seen.has(item.url)) return;
    seen.add(item.url);
    out.push(item);
  });
  return out.slice(0, count);
}

function resultFrom(title, url, snippet) {
  const safe = safeUrl(url);
  if (!safe) return null;
  return {
    title: sanitizeText(title, 180) || domainOf(safe) || safe,
    url: safe,
    snippet: sanitizeText(snippet),
    domain: domainOf(safe)
  };
}

function normalize(providerId, payload, count) {
  const json = payload && typeof payload === 'object' ? payload : {};
  let results = [];
  let answer = '';

  if (providerId === 'brave') {
    const web = json.web && Array.isArray(json.web.results) ? json.web.results : [];
    results = web.map((r) => resultFrom(r.title, r.url, r.description || r.snippet));
  } else if (providerId === 'tavily') {
    answer = sanitizeText(json.answer, 700);
    const list = Array.isArray(json.results) ? json.results : [];
    results = list.map((r) => resultFrom(r.title, r.url, r.content || r.snippet));
  } else if (providerId === 'serper') {
    const box = json.answerBox || {};
    answer = sanitizeText(box.answer || box.snippet || (json.knowledgeGraph && json.knowledgeGraph.description), 700);
    const list = Array.isArray(json.organic) ? json.organic : [];
    results = list.map((r) => resultFrom(r.title, r.link, r.snippet));
  } else if (providerId === 'exa') {
    const list = Array.isArray(json.results) ? json.results : [];
    results = list.map((r) => resultFrom(r.title, r.url, r.text || r.summary || ''));
  }

  return {
    answer,
    results: dedupe(results.filter(Boolean), count)
  };
}

module.exports = {
  PROVIDERS,
  FRESHNESS,
  MAX_RESULTS,
  MAX_QUERY,
  ids,
  sanitizeText,
  safeUrl,
  domainOf,
  normalizeQuery,
  normalizeCount,
  normalizeFreshness,
  headersFor,
  buildRequest,
  normalize
};
