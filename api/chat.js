'use strict';
const { PROVIDERS, headersFor, modelAllowed } = require('../lib/providers.cjs');
const { setCors, json, bodyJson, endOptions } = require('../lib/http.cjs');

module.exports = async function chat(req, res) {
  if (endOptions(req, res)) return;
  if (!setCors(req, res)) return json(res, 403, { error: 'Origin is not allowed.' });
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });

  const key = String(req.headers['x-eltes-provider-key'] || '').trim();
  if (!key || key.length > 4096 || /[\r\n]/.test(key)) return json(res, 400, { error: 'A provider API key is required.' });
  let payload;
  try { payload = await bodyJson(req); }
  catch (error) { return json(res, error.status || 400, { error: 'Request JSON is invalid or too large.' }); }

  const providerId = String(payload.provider || '');
  const provider = PROVIDERS[providerId];
  const modelId = String(payload.model || '');
  if (!provider || !modelAllowed(providerId, modelId)) return json(res, 400, { error: 'Provider/model pair is not on the server allowlist.' });
  if (!Array.isArray(payload.messages) || payload.messages.length > 64) return json(res, 400, { error: 'Messages must be an array with at most 64 entries.' });
  const requestBody = { ...payload };
  delete requestBody.provider;
  if (provider.api === 'anthropic') {
    requestBody.max_tokens = Math.min(Math.max(Number(requestBody.max_tokens) || 1024, 1), 8192);
    requestBody.stream = requestBody.stream !== false;
  } else {
    requestBody.stream = requestBody.stream !== false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    const upstream = await fetch(provider.base + provider.path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headersFor(provider, key) },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
      redirect: 'error'
    });
    if (!upstream.ok) {
      if (upstream.body) await upstream.body.cancel().catch(() => {});
      const statuses = {
        400: 'The provider rejected the request.', 401: 'The provider rejected this API key.',
        403: 'The provider denied access to this model.', 404: 'This model is not available to the provider account.',
        429: 'The provider reported a rate limit or quota limit.'
      };
      return json(res, upstream.status, { error: statuses[upstream.status] || `Provider request failed (${upstream.status}).`, status: upstream.status });
    }

    const contentType = upstream.headers.get('content-type') || (requestBody.stream ? 'text/event-stream; charset=utf-8' : 'application/json; charset=utf-8');
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store, no-cache, no-transform');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (requestBody.stream) {
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (res.flushHeaders) res.flushHeaders();
    }
    if (!upstream.body) return res.end();
    for await (const chunk of upstream.body) {
      if (res.destroyed || controller.signal.aborted) break;
      if (!res.write(Buffer.from(chunk))) {
        await new Promise((resolve) => {
          const resume = () => { res.off('drain', resume); res.off('close', resume); resolve(); };
          res.once('drain', resume);
          res.once('close', resume);
        });
      }
    }
    if (!res.writableEnded && !res.destroyed) res.end();
  } catch (error) {
    if (!res.headersSent) return json(res, error.name === 'AbortError' ? 504 : 502, { error: error.name === 'AbortError' ? 'Provider timed out.' : 'Backend could not reach the provider.' });
    if (!res.writableEnded && !res.destroyed) res.end();
  } finally {
    clearTimeout(timer);
  }
};
