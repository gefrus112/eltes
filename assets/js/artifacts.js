/* Guardrails for user-approved, browser-downloadable project files. This never executes content. */
(function attachArtifacts(root, factory) {
  const api = factory();
  if (root) root.EltesArtifacts = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis, function createArtifacts() {
  'use strict';

  const MAX_FILE_BYTES = 100 * 1024;
  const TYPES = {
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
    ts: 'text/plain', py: 'text/x-python', php: 'text/plain', json: 'application/json', md: 'text/markdown',
    txt: 'text/plain', sh: 'text/plain', sql: 'text/plain', svg: 'image/svg+xml', xml: 'application/xml',
    yaml: 'text/yaml', yml: 'text/yaml', toml: 'text/plain', csv: 'text/csv', rs: 'text/plain', go: 'text/plain'
  };
  const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

  function prepare({ filename, content } = {}) {
    const name = String(filename || '').trim();
    if (!name || name.length > 100 || !/^[a-zA-Z0-9._-]+$/.test(name) || name === '.' || name === '..' || name.endsWith('.') || RESERVED_WINDOWS_NAME.test(name)) {
      throw new Error('Use a simple filename (letters, numbers, dot, dash, underscore; max 100 characters). Folder paths are not allowed.');
    }
    if (typeof content !== 'string') throw new Error('File content must be text.');
    const size = new TextEncoder().encode(content).byteLength;
    if (size > MAX_FILE_BYTES) throw new Error('Generated files are limited to 100 KiB each.');
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    return { filename: name, content, size, mime: TYPES[ext] || 'text/plain' };
  }

  return { prepare, MAX_FILE_BYTES };
});
