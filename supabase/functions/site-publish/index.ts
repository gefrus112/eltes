/* ==========================================================================
   Eltes — publish the static site into Supabase Storage
   --------------------------------------------------------------------------
   Supabase has no "static site" product, but a public Storage bucket is a
   CDN-backed home for one: every file is served from
   https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path> with the
   right content type, and relative links keep working.

   This function copies the repository's published files from GitHub into that
   bucket. It is the Supabase-side twin of .github/workflows/pages.yml.

   Call it with the publishing token:
     GET /functions/v1/site-publish?token=…&dry=1              → list only
     GET /functions/v1/site-publish?token=…                    → upload all
     GET /functions/v1/site-publish?token=…&path=index.html    → one file

   Secrets:
     ELTES_PUBLISH_TOKEN  required, a long random string
     ELTES_BUCKET         optional, default "eltes"
     ELTES_REPO           optional, default "gefrus112/eltes"
     ELTES_BRANCH         optional, default "main"

   Plain JavaScript in a .ts file (no imports), so it deploys as one file and
   runs under test/supabase.test.cjs with a Deno shim.
   ========================================================================== */

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const TOKEN = Deno.env.get('ELTES_PUBLISH_TOKEN') || '';
const BUCKET = Deno.env.get('ELTES_BUCKET') || 'eltes';
const REPO = Deno.env.get('ELTES_REPO') || 'gefrus112/eltes';
const BRANCH = Deno.env.get('ELTES_BRANCH') || 'main';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-eltes-token',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

// What the site is made of. Tests, migrations and the desktop harness are not
// published — only pages, their assets and the Windows launcher zip.
const PUBLISHED = [/^[a-z0-9-]+\.html$/i, /^config\.js$/, /^site\.webmanifest$/, /^assets\//, /^downloads\//];

const TYPES = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  zip: 'application/zip',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  wasm: 'application/wasm',
  map: 'application/json; charset=utf-8'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function typeFor(path) {
  const ext = String(path).split('.').pop().toLowerCase();
  return TYPES[ext] || 'application/octet-stream';
}

function wanted(path) {
  return PUBLISHED.some((pattern) => pattern.test(path));
}

async function ensureBucket() {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: true,
      file_size_limit: 52428800,
      allowed_mime_types: null
    })
  });
  if (response.ok) return 'ready';
  const text = await response.text();
  if (/already exists|duplicate|409/i.test(text)) return 'exists';
  throw new Error(`bucket: ${response.status} ${text.slice(0, 200)}`);
}

async function upload(path, bytes) {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': typeFor(path),
        'Cache-Control': 'public, max-age=600',
        'x-upsert': 'true'
      },
      body: bytes
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path}: ${response.status} ${text.slice(0, 160)}`);
  }
}

const GITHUB_HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'eltes-site-publish' };

/* Pin every read to a commit, not a branch: GitHub's CDN caches branch URLs
   for a few minutes, and a mirror that quietly serves last week's news is
   worse than one that refuses. */
async function resolveRef() {
  const response = await fetch(`https://api.github.com/repos/${REPO}/git/ref/heads/${BRANCH}`, {
    headers: GITHUB_HEADERS,
    cache: 'no-store'
  });
  if (!response.ok) {
    const text = await response.text();
    return { ref: BRANCH, sha: '', status: response.status, error: text.slice(0, 160) };
  }
  const data = await response.json();
  const sha = String((data && data.object && data.object.sha) || '');
  return { ref: sha || BRANCH, sha, status: response.status, error: sha ? '' : 'no_sha' };
}

async function listSite(ref) {
  const response = await fetch(`https://api.github.com/repos/${REPO}/git/trees/${ref}?recursive=1`, {
    headers: GITHUB_HEADERS,
    cache: 'no-store'
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`github tree: ${response.status} ${text.slice(0, 200)}`);
  }
  const data = await response.json();
  const tree = Array.isArray(data.tree) ? data.tree : [];
  return tree
    .filter((entry) => entry.type === 'blob' && wanted(String(entry.path || '')))
    .map((entry) => ({ path: String(entry.path), size: Number(entry.size) || 0 }));
}

async function download(path, ref) {
  const response = await fetch(`https://raw.githubusercontent.com/${REPO}/${ref}/${path}`, {
    headers: { 'User-Agent': 'eltes-site-publish' },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`${path}: raw ${response.status}`);
  return response.arrayBuffer();
}

async function handle(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: 'no_backend' }, 500);
  if (!TOKEN) return json({ ok: false, error: 'publish_token_not_configured' }, 503);

  const url = new URL(req.url);
  const token = url.searchParams.get('token') || req.headers.get('x-eltes-token') || '';
  if (token !== TOKEN) return json({ ok: false, error: 'bad_token' }, 401);

  try {
    const pinned = String(url.searchParams.get('sha') || '').trim();
    const head = /^[0-9a-f]{7,40}$/i.test(pinned)
      ? { ref: pinned, sha: pinned, status: 200, error: '' }
      : await resolveRef();
    const files = await listSite(head.ref);
    const total = files.reduce((sum, file) => sum + file.size, 0);
    const base = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

    if (url.searchParams.get('dry') === '1') {
      return json({
        ok: true, dry: true, bucket: BUCKET, sha: head.sha, refStatus: head.status, refError: head.error,
        files: files.length, bytes: total, base,
        sample: files.slice(0, 12)
      });
    }

    const bucket = await ensureBucket();
    const only = url.searchParams.get('path');
    const queue = only ? files.filter((file) => file.path === only) : files;
    if (only && !queue.length) return json({ ok: false, error: 'not_published', path: only }, 404);

    const failures = [];
    let uploaded = 0;
    let bytes = 0;

    const workers = Math.min(8, queue.length);
    let cursor = 0;
    const run = async () => {
      while (cursor < queue.length) {
        const file = queue[cursor++];
        try {
          const body = await download(file.path, head.ref);
          await upload(file.path, body);
          uploaded += 1;
          bytes += body.byteLength;
        } catch (error) {
          failures.push({ path: file.path, error: String(error.message).slice(0, 180) });
        }
      }
    };
    await Promise.all(Array.from({ length: workers }, run));

    return json({
      ok: failures.length === 0,
      bucket,
      repo: `${REPO}@${BRANCH}`,
      sha: head.sha,
      // No sha means GitHub's branch caches answered: the copy may lag by minutes.
      stale: head.sha ? undefined : true,
      uploaded,
      bytes,
      failures,
      base,
      index: `${base}index.html`
    });
  } catch (error) {
    return json({ ok: false, error: String(error.message).slice(0, 300) }, 500);
  }
}

Deno.serve(handle);
