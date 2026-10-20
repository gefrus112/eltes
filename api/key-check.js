'use strict';
const { PROVIDERS, headersFor } = require('../lib/providers.cjs');
const { setCors, json, bodyJson, endOptions } = require('../lib/http.cjs');

module.exports = async function keyCheck(req, res) {
  if (endOptions(req, res)) return;
  if (!setCors(req, res)) return json(res, 403, { error: 'Origin is not allowed.' });
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
  const key = String(req.headers['x-eltes-provider-key'] || '').trim();
  if (!key || key.length > 4096 || /[\r\n]/.test(key)) return json(res, 400, { error: 'Provide a valid-looking provider key.' });

  let input;
  try { input = await bodyJson(req); }
  catch (error) { return json(res, error.status || 400, { error: 'Request JSON is invalid or too large.' }); }
  const provider = PROVIDERS[String(input.provider || '')];
  if (!provider) return json(res, 400, { error: 'Provider is not supported by the key tester.' });

  const url = /^https:\/\//.test(provider.keyTest) ? provider.keyTest : provider.base + provider.keyTest;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method: 'GET', headers: headersFor(provider, key, true), signal: controller.signal,
      redirect: 'error', credentials: 'omit'
    });
    if (response.body) await response.body.cancel().catch(() => {});
    if (response.ok) return json(res, 200, { valid: true, provider: provider.name, message: 'The provider accepted this key.' });
    if (response.status === 401 || response.status === 403) {
      return json(res, 200, { valid: false, status: response.status, provider: provider.name, message: 'The provider rejected this key.' });
    }
    if (response.status === 429) {
      return json(res, 200, { valid: false, status: 429, provider: provider.name, message: 'The provider rate-limited the key check. Wait and retry.' });
    }
    return json(res, 200, { valid: false, status: response.status, provider: provider.name, message: 'The provider could not confirm this key; try a live request or check its dashboard.' });
  } catch (error) {
    return json(res, 502, { valid: false, provider: provider.name, message: 'Could not reach the provider from the backend.' });
  } finally {
    clearTimeout(timer);
  }
};
