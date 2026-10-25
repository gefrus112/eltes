/* Reviewed local-project text operations. Path checks are not an OS sandbox. */
import { mkdir, lstat, readdir, readFile, writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { resolve, join, dirname, extname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
const MAX_BYTES = 100 * 1024;
const EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.json', '.md', '.txt', '.svg', '.csv', '.yaml', '.yml', '.xml', '.sh', '.ps1', '.jac']);
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function partsOf(path, directory = false) {
  if (directory && (path === '' || path === '.')) return [];
  if (typeof path !== 'string' || path.length > 240) fail('Use a workspace-relative path up to 240 characters.');
  const parts = path.split('/');
  if (parts.length > 8 || parts.some(p => !/^[a-zA-Z0-9][a-zA-Z0-9_. -]*$/.test(p) || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p) || /(?:secret|credential|private|production|deploy|id_rsa|id_ed25519|vercel|firebase|netlify|wrangler)/i.test(p))) fail('Unsafe or protected workspace path.');
  if (!directory && !EXTENSIONS.has(extname(path).toLowerCase())) fail('Only supported source/text files are allowed.');
  return parts;
}
export function createProjectFiles(root) {
  root = resolve(root);
  async function locate(path, directory = false) {
    const parts = partsOf(path, directory);
    await mkdir(root, { recursive: true });
    let current = root;
    for (let i = -1; i < parts.length; i++) {
      if (i >= 0) current = join(current, parts[i]);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) fail('Symbolic links are not allowed in project operations.', 403);
        if ((i < parts.length - 1 || directory) && !info.isDirectory()) fail('Parent is not a directory.');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return current;
  }
  async function snapshot(path) {
    const target = await locate(path);
    let data;
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.size > MAX_BYTES) fail('Select a regular text file up to 100 KB.');
      data = await readFile(target);
    } catch (error) { if (error.code === 'ENOENT') return { filePath: path, exists: false, content: '', version: null }; throw error; }
    if (data.length > MAX_BYTES) fail('File exceeds 100 KB.');
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { fail('File must contain valid UTF-8 text.'); }
    if (content.includes('\0')) fail('Binary files are not supported.');
    return { filePath: path, exists: true, content, version: createHash('sha256').update(data).digest('hex') };
  }
  async function list(directory = '') {
    await locate(directory, true);
    const files = []; let truncated = false, visited = 0;
    const queue = [directory === '.' ? '' : directory];
    while (queue.length && !truncated) {
      const relative = queue.shift();
      let entries;
      try { entries = await readdir(await locate(relative, true), { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      for (const entry of entries) {
        if (++visited > 1500 || files.length >= 500) { truncated = true; break; }
        if (entry.isSymbolicLink() || ['node_modules', 'dist', 'build', 'coverage', 'vendor'].includes(entry.name)) continue;
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        try { partsOf(path, entry.isDirectory()); } catch { continue; }
        if (entry.isDirectory()) queue.push(path);
        else if (entry.isFile()) files.push(path);
      }
    }
    return { directory, files: files.sort(), truncated, note: 'Supported text files only; hidden/protected paths, symlinks and dependency/build folders omitted.' };
  }
  async function write(filePath, content, expectedVersion) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_BYTES || content.includes('\0')) fail('Provide UTF-8 source up to 100 KB.');
    const target = await locate(filePath);
    const before = await snapshot(filePath);
    if (expectedVersion !== before.version) fail('File changed since review. Review the current source again.', 409);
    await mkdir(dirname(target), { recursive: true });
    await locate(filePath);
    const mode = before.exists ? (await lstat(target)).mode & 0o777 : 0o600;
    const temporary = join(dirname(target), `.eltes-${randomBytes(12).toString('hex')}.tmp`);
    try {
      await writeFile(temporary, content, { flag: 'wx', mode });
      await chmod(temporary, mode);
      if ((await snapshot(filePath)).version !== expectedVersion) fail('File changed during write. No replacement made.', 409);
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => {}); }
    return { filePath, bytes: Buffer.byteLength(content), version: createHash('sha256').update(content).digest('hex') };
  }
  // Do not return raw OS errors (which can include absolute host paths) to a model.
  const safe = (operation, message) => async (...args) => {
    try { return await operation(...args); }
    catch (error) { if (error.status) throw error; fail(message); }
  };
  return {
    ensureRoot: safe(() => locate('', true), 'Could not prepare the project workspace. Check local permissions.'),
    list: safe(list, 'Could not read that project directory. Check local permissions.'),
    snapshot: safe(snapshot, 'Could not read that project file. Check local permissions.'),
    write: safe(write, 'Could not write that project file. Check local permissions.')
  };
}
