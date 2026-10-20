'use strict';
const { PROVIDERS, normalizeQuery, normalizeCount, normalizeFreshness, buildRequest, normalize } = require('../lib/search.cjs');
const { setCors, json, bodyJson, endOptions } = require('../lib/http.cjs');

/* POST /api/search
   Body:    { provider: "brave"|"tavily"|"serper"|"exa", query: string, count?: number, freshness?: "any"|"day"|"week"|"month"|"year" }
   Header:  x-eltes-search-key: <user's own search API key>
   Returns: { provider, query, answer, results: [{ title, url, snippet, domain }] }

   The upstream host comes from a fixed allowlist, never from the request, and
   keys are used for a single request and never stored or logged. */

module.exports = async function search(req, res) {
  if (endOptions(req, res)) return;
  if (!setCors(req, res)) return json(res, 403, { error: 'Origin is not allowed.' });
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });

  const key = String(req.headers['x-eltes-search-key'] || '').trim();
  if (!key || key.length > 4096 || /[\r\n]/.test(key)) {
    return json(res, 400, { error: 'A web-search API key is required.' });
  }

  let payload;
  try { payload = await bodyJson(req); }
  catch (error) { return json(res, error.status || 400, { error: 'Request JSON is invalid or too large.' }); }

  const providerId = String((payload && payload.provider) || '');
  const provider = PROVIDERS[providerId];
  if (!provider) return json(res, 400, { error: 'Search provider is not on the server allowlist.' });

  const query = normalizeQuery(payload && payload.query);
  if (!query) return json(res, 400, { error: 'Query must be 1–400 characters of plain text.' });
  const count = normalizeCount(payload && payload.count);
  const freshness = normalizeFreshness(payload && payload.freshness);

  const request = buildRequest(providerId, query, count, key, freshness);
  if (!request) return json(res, 400, { error: 'Search provider is not supported.' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });

  try {
    const upstream = await fetch(request.url, {
      ...request.init,
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit'
    });

    if (!upstream.ok) {
      if (upstream.body) await upstream.body.cancel().catch(() => {});
      const statuses = {
        400: `${provider.name} rejected the query.`,
        401: `${provider.name} rejected this search key.`,
        403: `${provider.name} denied access — check the plan or key permissions.`,
        422: `${provider.name} could not process that query.`,
        429: `${provider.name} reported a rate or quota limit.`
      };
      return json(res, upstream.status, {
        error: statuses[upstream.status] || `${provider.name} search failed (${upstream.status}).`,
        status: upstream.status
      });
    }

    let data;
    try { data = await upstream.json(); }
    catch { return json(res, 502, { error: `${provider.name} returned a response Eltes could not read.` }); }

    const { results, answer } = normalize(providerId, data, count);
    if (!results.length && !answer) {
      return json(res, 200, { provider: providerId, query, freshness, answer: '', results: [], empty: true });
    }
    return json(res, 200, { provider: providerId, query, freshness, answer, results });
  } catch (error) {
    const timedOut = error && error.name === 'AbortError';
    return json(res, timedOut ? 504 : 502, {
      error: timedOut ? `${provider.name} timed out. Try again or raise the result count.` : `Could not reach ${provider.name}.`
    });
  } finally {
    clearTimeout(timer);
  }
};
