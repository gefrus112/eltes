#!/usr/bin/env node
/* ==========================================================================
   Eltes — internal link and asset check
   --------------------------------------------------------------------------
   Walks every page at the repository root and checks that

     - every href/src that points at a file resolves on disk
     - every #fragment exists as an id on the page it targets
     - same-page fragments exist too

   External URLs (http, https, mailto, tel, data, javascript) are skipped: the
   site must not depend on the network to build or validate.

   Usage
     node tools/check-links.mjs            # every *.html at the root
     node tools/check-links.mjs docs.html  # just these pages
   ========================================================================== */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pages = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(root).filter((name) => name.endsWith('.html')).sort();

const ids = new Map();
const stripCode = (html) => html.replace(/<pre[\s\S]*?<\/pre>/gi, '').replace(/<code[\s\S]*?<\/code>/gi, '');

for (const page of pages) {
  const html = stripCode(readFileSync(join(root, page), 'utf8'));
  ids.set(page, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])));
}

let checked = 0;
let problems = 0;
const fail = (...parts) => {
  problems += 1;
  console.log(parts.join(' '));
};

for (const page of pages) {
  const html = stripCode(readFileSync(join(root, page), 'utf8'));
  for (const [, ref] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (!ref || /^(?:https?:|mailto:|tel:|data:|javascript:|blob:)/i.test(ref)) continue;

    if (ref.startsWith('#')) {
      if (ref.length > 1 && !ids.get(page).has(ref.slice(1))) fail('missing anchor  ', page, ref);
      continue;
    }

    const [pathPart, hash] = ref.split('#');
    const target = pathPart.split('?')[0];
    checked += 1;
    if (!existsSync(resolve(root, target))) {
      fail('missing file    ', page, '->', ref);
      continue;
    }
    if (hash && target.endsWith('.html')) {
      const targetIds = ids.get(target.split('/').pop());
      if (targetIds && !targetIds.has(hash)) fail('missing anchor  ', page, '->', ref);
    }
  }
}

if (problems) {
  console.log(`\n${problems} broken reference${problems === 1 ? '' : 's'} in ${pages.length} pages`);
  process.exitCode = 1;
} else {
  console.log(`all internal links and assets resolve — ${checked} references across ${pages.length} pages`);
}
