/* Remember where the Eltes window was, safely.
   Pure Node: desktop/main.js passes in the display list from Electron's screen
   module, which keeps this testable without a running Electron process. */

'use strict';

const { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs');
const { dirname } = require('node:path');
const { clampBounds } = require('./shell');

function readState(file) {
  try {
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (!raw || !raw.bounds) return null;
    const b = raw.bounds;
    if (![b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n))) return null;
    return { bounds: b, maximized: !!raw.maximized, savedAt: raw.savedAt || null };
  } catch (error) {
    return null;
  }
}

function restore(file, displays, options = {}) {
  const saved = options.reset ? null : readState(file);
  const bounds = clampBounds(saved && saved.bounds, displays);
  return { bounds, maximized: !!(saved && saved.maximized), restored: !!saved };
}

function save(file, state) {
  if (!state || !state.bounds) return false;
  try {
    const payload = {
      bounds: {
        x: Math.round(state.bounds.x),
        y: Math.round(state.bounds.y),
        width: Math.round(state.bounds.width),
        height: Math.round(state.bounds.height)
      },
      maximized: !!state.maximized,
      savedAt: new Date().toISOString()
    };
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
    renameSync(tmp, file);
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = { readState, restore, save };
