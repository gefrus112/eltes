'use strict';
const { setCors, json, endOptions } = require('../lib/http.cjs');

module.exports = function health(req, res) {
  if (endOptions(req, res)) return;
  if (!setCors(req, res)) return json(res, 403, { error: 'Origin is not allowed.' });
  if (req.method !== 'GET') return json(res, 405, { error: 'Use GET.' });
  res.setHeader('Cache-Control', 'no-store');
  return json(res, 200, { service: 'eltes-byok-proxy', status: 'ok', keyMode: 'transient-byok' });
};
