/* Native tool schemas for the paired server's persistent .studio text workspace. */
(function (root) {
  'use strict';
  const path = { type: 'string', description: 'Relative path within .studio/, e.g. src/app.js. No absolute/hidden/protected paths or symlinks.' };
  const tools = [
    { name: 'list_files', description: 'List supported text files recursively in the paired local .studio workspace. Bounded to 500 files; skips hidden/protected paths, symlinks and dependency/build folders. Not a general device scan.', parameters: { type: 'object', properties: { directory: path } } },
    { name: 'read_file', description: 'Read a window of a local .studio text file. User must approve the exact source sent to the provider. This is separate from transient read_project_file. Default 200 lines, maximum 400; file maximum 100 KB.', parameters: { type: 'object', properties: { filePath: path, startLine: { type: 'integer', minimum: 1 }, lineCount: { type: 'integer', minimum: 1, maximum: 400 } }, required: ['filePath'] } },
    { name: 'write_file', description: 'Create or replace one persistent .studio source file up to 100 KB. Show Plan: first; user reviews full before/after source and approves. Rejects stale versions and unsafe paths. Does not execute code.', parameters: { type: 'object', properties: { filePath: path, content: { type: 'string' } }, required: ['filePath', 'content'] } },
    { name: 'patch_file', description: 'Make a single exact, unique text replacement in a persistent .studio source file. Read relevant source first; show Plan:. Full before/after approval and stale-version checks are required. Never changes unrelated text or runs code.', parameters: { type: 'object', properties: { filePath: path, searchString: { type: 'string' }, replaceString: { type: 'string' } }, required: ['filePath', 'searchString', 'replaceString'] } },
    { name: 'execute_bash_command', description: 'Compatibility tool name for one approved command in persistent .studio. Uses bash on Linux/macOS or PowerShell on Windows, not bash syntax on Windows. Show Plan:. Requires installed runtimes and individual command approval. Host-account access, NOT an OS sandbox. Streams logs, limited to 30 seconds and 32 KB output; not a persistent dev-server supervisor.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }
  ];
  function readWindow(content, startLine = 1, lineCount = 200) {
    if (!Number.isInteger(startLine) || startLine < 1 || !Number.isInteger(lineCount) || lineCount < 1 || lineCount > 400) throw new Error('Use a positive startLine and lineCount from 1 to 400.');
    const lines = content.split('\n');
    if (startLine > lines.length) throw new Error(`File has ${lines.length} lines.`);
    return { startLine, endLine: Math.min(lines.length, startLine + lineCount - 1), totalLines: lines.length, content: lines.slice(startLine - 1, startLine - 1 + lineCount).join('\n') };
  }
  function create({ token, review, stopped, command, replaceExact }) {
    async function request(body) {
      if (!token()) throw new Error('Pair the opt-in local runner first. No local file action was taken.');
      const response = await fetch('/api/shell/files', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: JSON.stringify(body), cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Local file API returned HTTP ${response.status}.`);
      return data;
    }
    return {
      tools,
      async run(name, args = {}) {
        try {
          if (name === 'execute_bash_command') return await command(args);
          if (name === 'list_files') return { result: JSON.stringify(await request({ operation: 'list', directory: args.directory || '' })) };
          const before = await request({ operation: 'read', filePath: args.filePath });
          if (name === 'read_file') {
            if (!before.exists) throw new Error('File does not exist.');
            const window = readWindow(before.content, args.startLine, args.lineCount);
            if (!await review({ filename: `${args.filePath} · lines ${window.startLine}–${window.endLine}`, content: window.content }, 'local-read')) return { error: 'User declined source sharing. Do not retry unless asked.' };
            if (stopped()) return { error: 'Stopped before sharing source.' };
            return { result: JSON.stringify({ filePath: args.filePath, version: before.version, ...window }) };
          }
          if (!['write_file', 'patch_file'].includes(name)) throw new Error('Unknown local file tool.');
          if (name === 'patch_file' && !before.exists) throw new Error('Read an existing file before patching.');
          const content = name === 'patch_file' ? replaceExact(before.content, args.searchString, args.replaceString) : args.content;
          if (typeof content !== 'string' || new TextEncoder().encode(content).length > 100 * 1024 || content.includes('\0')) throw new Error('Provide complete text source up to 100 KB.');
          const display = `BEFORE (${before.exists ? 'existing file' : 'new file'})\n${before.content}\n\nAFTER\n${content}`;
          if (!await review({ filename: args.filePath, content: display }, 'local-write')) return { error: 'User declined this local file write. Do not retry unless asked.' };
          if (stopped()) return { error: 'Stopped before writing.' };
          const result = await request({ operation: 'write', filePath: args.filePath, content, expectedVersion: before.version });
          return { result: JSON.stringify({ ...result, note: 'Saved in persistent .studio after approval; no execution performed.' }) };
        } catch (error) { return { error: error.message }; }
      }
    };
  }
  const api = { create, tools, readWindow };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EltesLocalProject = api;
})(typeof window === 'object' ? window : globalThis);
