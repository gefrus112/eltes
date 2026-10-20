'use strict';

const MAX_BODY = 1024 * 1024;

function allowedOrigins() {
  return String(process.env.ELTES_ALLOWED_ORIGINS || '')
    .split(',').map((v) => v.trim()).filter(Boolean);
}

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const host = req.headers.host || '';
  const sameOrigin = origin && host && origin.replace(/^https?:\/\//, '').replace(/\/$/, '') === host;
  const allowed = allowedOrigins();
  if (origin && !sameOrigin && !allowed.includes(origin)) return false;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Eltes-Provider-Key');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

async function bodyJson(req) {
  if (req.body && typeof req.body === 'object') {
    if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY) {
      throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    }
    return req.body;
  }
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body) > MAX_BODY) {
      throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    }
    return JSON.parse(req.body || '{}');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function json(res, status, data) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function endOptions(req, res) {
  if (req.method !== 'OPTIONS') return false;
  if (!setCors(req, res)) { json(res, 403, { error: 'Origin is not allowed.' }); return true; }
  res.statusCode = 204;
  res.end();
  return true;
}

module.exports = { allowedOrigins, setCors, bodyJson, json, endOptions };
