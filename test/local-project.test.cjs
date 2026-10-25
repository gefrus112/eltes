const test = require('node:test');
const assert = require('node:assert/strict');
const { create, readWindow, tools } = require('../assets/js/local-project.js');
const { replaceExact } = require('../assets/js/project-sandbox.js');
test('native persistent registry has precise schemas and bounded line windows', () => {
  assert.deepEqual(tools.map(t => t.name), ['list_files', 'read_file', 'write_file', 'patch_file', 'execute_bash_command']);
  assert.deepEqual(readWindow('a\nb\nc', 2, 1), { startLine: 2, endLine: 2, totalLines: 3, content: 'b' });
  assert.throws(() => readWindow('x', 0)); assert.throws(() => readWindow('x', 1, 401));
});
test('local file tools never write or share source after a denial; exact patches use reviewed versions', async () => {
  const original = global.fetch;
  let writes = [], consent = false, reviewed;
  global.fetch = async (_, req) => {
    const body = JSON.parse(req.body);
    if (body.operation === 'write') { writes.push(body); return Response.json({ filePath: body.filePath }); }
    return Response.json({ exists: true, content: 'a\nb\nc', version: 'v1' });
  };
  try {
    const client = create({ token: () => 'fixture', review: async file => { reviewed = file; return consent; }, stopped: () => false, replaceExact });
    assert.match((await client.run('read_file', { filePath: 'main.js', startLine: 2, lineCount: 1 })).error, /declined/);
    assert.equal(reviewed.content, 'b');
    assert.match((await client.run('write_file', { filePath: 'main.js', content: 'new' })).error, /declined/);
    assert.equal(writes.length, 0);
    consent = true;
    assert.ok((await client.run('patch_file', { filePath: 'main.js', searchString: 'b', replaceString: 'B' })).result);
    assert.equal(writes[0].expectedVersion, 'v1'); assert.equal(writes[0].content, 'a\nB\nc');
    assert.match(reviewed.content, /BEFORE[\s\S]*AFTER/);
  } finally { global.fetch = original; }
});

test('local file requests propagate the active cancellation signal', async () => {
  const original = global.fetch, controller = new AbortController();
  let received;
  global.fetch = async (_, options) => { received = options.signal; return Response.json({ files: [] }); };
  try {
    const client = create({ token: () => 'test', signal: () => controller.signal });
    await client.run('list_files'); assert.equal(received, controller.signal);
  } finally { global.fetch = original; }
});
