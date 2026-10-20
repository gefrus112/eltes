#!/usr/bin/env node
/* ==========================================================================
   Eltes — publish the static site to the Supabase Storage mirror
   --------------------------------------------------------------------------
   The heavy lifting is the `site-publish` Edge Function (it copies the files
   from GitHub into the project's public bucket). This script only calls it,
   so the token never has to be typed into a URL by hand.

     ELTES_PUBLISH_TOKEN=… npm run site:publish -- --dry
     ELTES_PUBLISH_TOKEN=… npm run site:publish
     ELTES_PUBLISH_TOKEN=… npm run site:publish -- --path=index.html

   The project URL is read from config.js, so there is one source of truth.
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function projectUrl() {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL.replace(/\/+$/, '');
  const source = readFileSync(resolve(root, 'config.js'), 'utf8');
  const match = source.match(/supabaseUrl:\s*['"]([^'"]+)['"]/);
  if (!match) throw new Error('config.js does not name a supabaseUrl');
  return match[1].replace(/\/+$/, '');
}

const token = process.env.ELTES_PUBLISH_TOKEN || '';
if (!token) {
  console.error('Set ELTES_PUBLISH_TOKEN first (Supabase → Edge Functions → Secrets holds the same value).');
  process.exit(1);
}

const flags = new Set(process.argv.slice(2));
const query = new URLSearchParams({ token });
if (flags.has('--dry')) query.set('dry', '1');
const single = process.argv.slice(2).find((arg) => arg.startsWith('--path='));
if (single) query.set('path', single.slice('--path='.length));

const url = `${projectUrl()}/functions/v1/site-publish?${query}`;
console.log(`publishing → ${projectUrl()}/storage/v1/object/public/${process.env.ELTES_BUCKET || 'eltes'}/`);

const started = Date.now();
const response = await fetch(url, { headers: { 'User-Agent': 'eltes-publish-site' } });
const text = await response.text();

let data;
try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 400) }; }

if (!response.ok || data.ok === false) {
  console.error(`failed (${response.status}):`, data);
  process.exit(1);
}

if (data.dry) {
  console.log(`dry run — ${data.files} files, ${(data.bytes / 1048576).toFixed(2)} MB would be published`);
} else {
  console.log(`uploaded ${data.uploaded} files (${(data.bytes / 1048576).toFixed(2)} MB) in ${Date.now() - started} ms`);
  if (data.failures && data.failures.length) {
    console.warn(`${data.failures.length} file(s) failed:`);
    for (const failure of data.failures) console.warn(`  ${failure.path} — ${failure.error}`);
    process.exit(1);
  }
  console.log(`live → ${data.index}`);
}
