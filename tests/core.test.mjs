import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, unlink, symlink, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inspect, writeIndex } from '../dist/commands/index.js';
import { loadConfig, defaultConfig } from '../dist/context/config.js';
import { serialize } from '../dist/core.js';
import { artifact, temporary, put, snapshot } from './helpers.mjs';

const task = (overrides = {}) => artifact('task', { id: 'TASK-0001', title: 'Task', status: 'active', ...overrides });
const adr = (id, overrides = {}) => artifact('adr', { id, title: 'Decision', status: 'accepted', ...overrides });
const codes = result => result.diagnostics.map(diagnostic => diagnostic.code);

test('valid fixture indexes every artifact type and resolves ID, rule, skill, and file links', async t => {
  const root = await temporary(t);
  const before = await snapshot(root);
  const result = await inspect(root);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.index.artifacts.length, 9);
  assert.equal(new Set(result.index.artifacts.map(a => a.type)).size, 8);
  assert.ok(result.index.links.some(link => link.source === 'TASK-0001' && link.target === 'core'));
  assert.ok(result.index.links.some(link => link.target === 'rules/GLOBAL.md'));
  assert.ok(result.index.links.some(link => link.target === 'skills/testing.md'));
  assert.ok(result.index.links.some(link => link.target === 'src/example.txt' && link.kind === 'file'));
  assert.deepEqual(await snapshot(root), before, 'inspection must be read-only');
});

test('index is deterministic across roots and source order; idempotent writes preserve mtime', async t => {
  const first = await temporary(t);
  const second = await temporary(t);
  await put(second, '.context/config.yaml', 'sources:\n' + [...defaultConfig.sources].reverse().map(source => `  - ${source}`).join('\n'));
  const one = await inspect(first);
  const two = await inspect(second);
  assert.equal(serialize(one.index), serialize(two.index));
  assert.ok(!serialize(one.index).includes(first));
  assert.equal(await writeIndex(one), true);
  const output = path.join(first, '.context/index.json');
  const initial = await readFile(output, 'utf8');
  const initialStat = await stat(output, { bigint: true });
  assert.equal(await writeIndex(await inspect(first)), false);
  assert.equal((await stat(output, { bigint: true })).mtimeNs, initialStat.mtimeNs);
  assert.equal(await readFile(output, 'utf8'), initial);
  await unlink(output);
  assert.equal(await writeIndex(await inspect(first)), true);
  assert.equal(await readFile(output, 'utf8'), initial, 'deleted generated state must rebuild byte-for-byte');
  assert.deepEqual(await readdir(path.dirname(output)), ['index.json']);
});

test('newline style and BOM do not change index hashes', async t => {
  const first = await temporary(t);
  const second = await temporary(t);
  const files = await snapshot(second);
  for (const [file, encoded] of Object.entries(files)) {
    if (file.endsWith('.md')) await put(second, file, '\uFEFF' + Buffer.from(encoded, 'base64').toString('utf8').replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n'));
  }
  assert.equal(serialize((await inspect(first)).index), serialize((await inspect(second)).index));
});

test('deleting all generated Keystone files does not prevent an identical rebuild', async t => {
  const root = await temporary(t);
  const generated = ['.context/index.json', '.context/current-envelope.json', '.context/telemetry/run.json', 'context/STATE.md'];
  const files = ['.context\\index.json', ...generated.slice(1), 'src/example.txt', '.context/config.yaml'];
  await put(root, '.context/config.yaml', 'schema_version: 1\n');
  await put(root, 'tasks/TASK-0001.md', task({ files }));
  for (const file of generated.slice(1)) await put(root, file, '---\ninvalid generated content');
  const inspection = await inspect(root);
  assert.deepEqual(inspection.diagnostics, []);
  assert.deepEqual(inspection.index.artifacts.find(a => a.id === 'TASK-0001').metadata.files, files);
  assert.ok(!inspection.index.links.some(link => generated.includes(link.target)));
  assert.ok(inspection.index.links.some(link => link.target === '.context/config.yaml'));
  await writeIndex(inspection);
  const initial = await readFile(path.join(root, '.context/index.json'), 'utf8');
  for (const file of generated) await unlink(path.join(root, file));
  const rebuilt = await inspect(root);
  assert.deepEqual(rebuilt.diagnostics, []);
  assert.equal(serialize(rebuilt.index), initial);
  assert.equal(await writeIndex(rebuilt), true);
  assert.equal(await readFile(path.join(root, '.context/index.json'), 'utf8'), initial);
  assert.equal(await writeIndex(await inspect(root)), false);
  // The config is authoritative, so an explicit file reference still requires it.
  await unlink(path.join(root, '.context/config.yaml'));
  assert.ok(codes(await inspect(root)).includes('FILE_MISSING'));
});

test('unsupported YAML values cannot replace an existing valid index', async t => {
  const root = await temporary(t);
  await writeIndex(await inspect(root));
  const initial = await readFile(path.join(root, '.context/index.json'), 'utf8');
  await put(root, 'tasks/TASK-0001.md', '---\ncontext_type: task\nschema_version: 1\nid: TASK-0001\ntitle: Task\nstatus: active\nextension: !!set\n  first: null\n---');
  const invalid = await inspect(root);
  assert.ok(codes(invalid).includes('YAML_INVALID'));
  await assert.rejects(writeIndex(invalid), error => error.diagnostic.code === 'INDEX_INVALID');
  assert.equal(await readFile(path.join(root, '.context/index.json'), 'utf8'), initial);
});

test('authoritative edits rebuild generated state without touching source files', async t => {
  const root = await temporary(t);
  await writeIndex(await inspect(root));
  const old = await readFile(path.join(root, '.context/index.json'), 'utf8');
  // Include a meaningful body change, independently of metadata changes.
  const taskPath = path.join(root, 'tasks/TASK-0001.md');
  await writeFile(taskPath, (await readFile(taskPath, 'utf8')) + '\nNew durable statement.\n');
  const before = await snapshot(root);
  assert.equal(await writeIndex(await inspect(root)), true);
  const after = await snapshot(root);
  delete before['.context/index.json'];
  const newIndex = after['.context/index.json'];
  delete after['.context/index.json'];
  assert.deepEqual(after, before);
  assert.notEqual(Buffer.from(newIndex, 'base64').toString('utf8'), old);
});

test('missing optional conventional folders and empty repositories are valid', async t => {
  const root = await temporary(t, false);
  assert.deepEqual(await loadConfig(root), defaultConfig);
  const result = await inspect(root);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.index.artifacts, []);
  assert.deepEqual(await snapshot(root), {});
  await put(root, '.context/config.yaml', 'schema_version: 1');
  assert.deepEqual((await inspect(root)).diagnostics, [], 'omitting sources keeps the conventional locations optional');
});

test('custom sources, overlapping roots, and Windows separators are supported', async t => {
  const root = await temporary(t, false);
  await put(root, '.context/config.yaml', 'schema_version: 1\nsources: [knowledge, "knowledge\\\\tasks"]\n');
  await put(root, 'knowledge/tasks/task.md', task());
  await put(root, 'tasks/ignored.md', '---\nbroken');
  const result = await inspect(root);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.index.artifacts.length, 1);
});

test('generated aggregates, unrelated Markdown, and excluded directories are not artifacts', async t => {
  const root = await temporary(t);
  for (const file of ['context/STATE.md', 'context/INDEX.md', 'adr/INDEX.md', 'skills/INDEX.md', 'tasks/README.md']) {
    await put(root, file, '# Human-readable aggregate\n');
  }
  await put(root, 'context/notes.md', '---\ntitle: ordinary document\n---\n# Note');
  await put(root, 'context/node_modules/broken.md', '---\nbad');
  await put(root, '.context/current-envelope.json', '{invalid generated state');
  const result = await inspect(root);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.index.artifacts.length, 9);
});

for (const [name, value, code] of [
  ['unknown config key', 'surprise: true', 'CONFIG_INVALID'],
  ['unsupported version', 'schema_version: 2', 'CONFIG_INVALID'],
  ['non-array sources', 'sources: tasks', 'CONFIG_INVALID'],
  ['empty sources', 'sources: []', 'CONFIG_INVALID'],
  ['malformed config', 'sources: [', 'YAML_INVALID'],
  ['escape source', 'sources: [../outside]', 'PATH_INVALID'],
  ['generated source', 'sources: [.context]', 'CONFIG_INVALID'],
  ['generated Markdown source', 'sources: [context/STATE.md]', 'CONFIG_INVALID'],
]) test(`reject ${name}`, async t => {
  const root = await temporary(t, false);
  await put(root, '.context/config.yaml', value);
  await assert.rejects(inspect(root), error => error.diagnostic.code === code);
});

for (const [name, file, contents, expected] of [
  ['required metadata', 'tasks/TASK-0001.md', '# Missing metadata', 'FRONTMATTER_MISSING'],
  ['malformed YAML', 'tasks/TASK-0001.md', '---\nid: [\n---', 'YAML_INVALID'],
  ['unclosed front matter', 'tasks/TASK-0001.md', '---\nid: X', 'FRONTMATTER_UNCLOSED'],
  ['missing schema field', 'tasks/TASK-0001.md', artifact('task', { id: 'TASK-0001' }), 'SCHEMA_INVALID'],
  ['unsupported artifact type', 'tasks/TASK-0001.md', artifact('unknown', { id: 'TASK-0001' }), 'ARTIFACT_TYPE_INVALID'],
  ['wrong artifact type at conventional path', 'tasks/TASK-0001.md', adr('ADR-9000'), 'ARTIFACT_TYPE_MISMATCH'],
  ['nonportable ID', 'tasks/TASK-0001.md', task({ id: 'invalid id' }), 'ID_INVALID'],
  ['missing reference', 'tasks/TASK-0001.md', task({ adrs: ['ADR-9999'] }), 'LINK_MISSING'],
  ['invalid reference', 'tasks/TASK-0001.md', task({ adrs: ['../outside.md'] }), 'LINK_INVALID'],
  ['wrong target type', 'tasks/TASK-0001.md', task({ adrs: ['core'] }), 'LINK_TYPE_MISMATCH'],
  ['missing file', 'tasks/TASK-0001.md', task({ files: ['src/missing.ts'] }), 'FILE_MISSING'],
  ['directory as file', 'tasks/TASK-0001.md', task({ files: ['src'] }), 'FILE_NOT_REGULAR'],
  ['file traversal', 'tasks/TASK-0001.md', task({ files: ['../outside.ts'] }), 'PATH_INVALID'],
  ['self supersession', 'adr/ADR-0002.md', adr('ADR-0002', { supersedes: ['ADR-0002'] }), 'SUPERSESSION_SELF'],
  ['missing supersession', 'adr/ADR-0002.md', adr('ADR-0002', { supersedes: ['ADR-9999'] }), 'LINK_MISSING'],
  ['wrong supersession type', 'adr/ADR-0002.md', adr('ADR-0002', { supersedes: ['TASK-0001'] }), 'LINK_TYPE_MISMATCH'],
]) test(`validation reports ${name}`, async t => {
  const root = await temporary(t);
  await put(root, file, contents);
  const result = await inspect(root);
  assert.ok(codes(result).includes(expected), serialize(result.diagnostics));
  await assert.rejects(writeIndex(result), error => error.diagnostic.code === 'INDEX_INVALID');
});

test('duplicate IDs and ambiguous references are reported without selecting a winner', async t => {
  const root = await temporary(t);
  await put(root, 'adr/duplicate.md', adr('ADR-0002'));
  const result = await inspect(root);
  assert.equal(codes(result).filter(code => code === 'ID_DUPLICATE').length, 2);
  assert.ok(codes(result).includes('LINK_AMBIGUOUS'));
  assert.equal(serialize(result.diagnostics), serialize((await inspect(root)).diagnostics));
});

test('three-node supersession cycles are detected; reciprocal declarations are not cycles', async t => {
  const root = await temporary(t);
  assert.deepEqual((await inspect(root)).diagnostics, []);
  await put(root, 'adr/ADR-0001.md', adr('ADR-0001', { superseded_by: ['ADR-0002'] }));
  await put(root, 'adr/ADR-0002.md', adr('ADR-0002', { superseded_by: ['ADR-0003'] }));
  await put(root, 'adr/ADR-0003.md', adr('ADR-0003', { superseded_by: ['ADR-0001'] }));
  assert.equal(codes(await inspect(root)).filter(code => code === 'SUPERSESSION_CYCLE').length, 3);
});

test('one-sided supersession works without imposing lifecycle or reciprocal-field policy', async t => {
  const root = await temporary(t);
  await put(root, 'adr/ADR-0001.md', adr('ADR-0001', { status: 'custom-status' }));
  assert.deepEqual((await inspect(root)).diagnostics, []);
});

test('only ADRs interpret supersession; other types retain the fields as uninterpreted extensions', async t => {
  const root = await temporary(t);
  const examples = [
    ['project', 'PROJECT.md', { project_id: 'fixture-project', status: 'active' }],
    ['task', 'tasks/TASK-0001.md', { id: 'TASK-0001', title: 'Task', status: 'active' }],
    ['feature', 'features/core/FEATURE.md', { feature: 'core', status: 'active' }],
    ['learning', 'context/learnings/LRN-0001.md', { id: 'LRN-0001', status: 'candidate' }],
    ['trap', 'context/traps/TRAP-0001.md', { id: 'TRAP-0001', status: 'active' }],
    ['rule', 'rules/GLOBAL.md', {}],
    ['skill', 'skills/testing.md', {}],
  ];
  for (const [type, file, fields] of examples) {
    await put(root, file, artifact(type, { ...fields, supersedes: ['DOES-NOT-EXIST'], superseded_by: { extension: 'not an ADR relationship' } }));
  }
  const result = await inspect(root);
  assert.deepEqual(result.diagnostics, []);
  const adrs = new Set(result.index.artifacts.filter(a => a.type === 'adr').map(a => a.id));
  assert.ok(result.index.links.filter(link => link.field.startsWith('supersed')).every(link => adrs.has(link.source) && adrs.has(link.target)));
  for (const entry of result.index.artifacts.filter(a => a.type !== 'adr')) {
    assert.deepEqual(entry.metadata.supersedes, ['DOES-NOT-EXIST']);
    assert.deepEqual(entry.metadata.superseded_by, { extension: 'not an ADR relationship' });
  }
});

test('typed rules and skills can be referenced by stable ID or by path', async t => {
  const root = await temporary(t);
  await put(root, 'rules/GLOBAL.md', artifact('rule', { id: 'RULE-0001' }));
  await put(root, 'skills/testing.md', artifact('skill', { id: 'SKILL-0001' }));
  await put(root, 'tasks/TASK-0001.md', task({ rules: ['RULE-0001', 'rules/GLOBAL.md'], skills: ['SKILL-0001', 'skills\\testing.md'] }));
  const result = await inspect(root);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.index.links.filter(link => link.source === 'TASK-0001' && link.field === 'rules').length, 1);
  assert.equal(result.index.links.filter(link => link.source === 'TASK-0001' && link.field === 'skills').length, 1);
});

test('extension metadata with JavaScript prototype names is preserved without creating links', async t => {
  const root = await temporary(t);
  await put(root, 'tasks/TASK-0001.md', task({ constructor: ['ADR-0002'], toString: ['core'] }));
  const result = await inspect(root);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(!result.index.links.some(link => link.field === 'constructor' || link.field === 'toString'));
  assert.deepEqual(result.index.artifacts.find(a => a.id === 'TASK-0001').metadata.constructor, ['ADR-0002']);
});

test('source and file-reference casing must match on Windows and Unix alike', async t => {
  const root = await temporary(t);
  await put(root, 'tasks/TASK-0001.md', task({ files: ['SRC/example.txt'] }));
  assert.ok(codes(await inspect(root)).includes('PATH_CASE_MISMATCH'));
  await put(root, '.context/config.yaml', 'sources: [Tasks]');
  await assert.rejects(inspect(root), error => error.diagnostic.code === 'PATH_CASE_MISMATCH');
});

test('explicit missing sources fail deterministically and preserve the last valid index', async t => {
  const root = await temporary(t);
  await writeIndex(await inspect(root));
  const initial = await readFile(path.join(root, '.context/index.json'), 'utf8');
  const errors = [];
  for (const sources of [['zzz-missing', 'tasks', 'aaa-missing'], ['aaa-missing', 'tasks', 'zzz-missing']]) {
    await put(root, '.context/config.yaml', `sources: ${JSON.stringify(sources)}\n`);
    await assert.rejects(inspect(root), error => {
      errors.push(error.diagnostic);
      return error.diagnostic.code === 'CONFIG_INVALID' && error.diagnostic.message.includes('aaa-missing');
    });
  }
  assert.deepEqual(errors[0], errors[1]);
  assert.equal(await readFile(path.join(root, '.context/index.json'), 'utf8'), initial);
  await put(root, '.context/config.yaml', 'sources: [tasks/missing.md]');
  await assert.rejects(inspect(root), error => error.diagnostic.code === 'CONFIG_INVALID');
});

test('unrecognized index files are preserved; validation failures retain the last valid index', async t => {
  const root = await temporary(t);
  for (const contents of ['project-owned notes', '{"private":"data"}', '{"generated_by":"keystone","schema_version":2,"artifacts":[],"links":[]}']) {
    await put(root, '.context/index.json', contents);
    await assert.rejects(writeIndex(await inspect(root)), error => error.diagnostic.code === 'INDEX_OVERWRITE_REFUSED');
    assert.equal(await readFile(path.join(root, '.context/index.json'), 'utf8'), contents);
  }
  await unlink(path.join(root, '.context/index.json'));
  await writeIndex(await inspect(root));
  const before = await snapshot(root);
  await put(root, 'tasks/TASK-0001.md', '# invalid');
  await assert.rejects(writeIndex(await inspect(root)), error => error.diagnostic.code === 'INDEX_INVALID');
  assert.equal((await snapshot(root))['.context/index.json'], before['.context/index.json']);
});

test('pre-existing directory junctions are rejected by discovery, file validation, and index writing', async t => {
  const root = await temporary(t);
  const outside = await temporary(t, false);
  await put(outside, 'secret.md', task());
  const before = await snapshot(outside);
  // Junction creation on Windows does not require symbolic-link privilege.
  await symlink(outside, path.join(root, 'context/outside'), process.platform === 'win32' ? 'junction' : 'dir');
  await put(root, 'tasks/TASK-0001.md', task({ files: ['context/outside/secret.md'] }));
  assert.equal(codes(await inspect(root)).filter(code => code === 'PATH_SYMLINK').length, 2);
  const clean = await temporary(t, false);
  await symlink(outside, path.join(clean, '.context'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(inspect(clean), error => error.diagnostic.code === 'PATH_SYMLINK');
  const inspection = await inspect(await temporary(t, false));
  await symlink(outside, path.join(inspection.root, '.context'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(writeIndex(inspection), error => error.diagnostic.code === 'PATH_SYMLINK');
  assert.deepEqual(await snapshot(outside), before);
});

test('read failures and invalid roots produce structured errors', async t => {
  const root = await temporary(t, false);
  await mkdir(path.join(root, '.context/config.yaml'), { recursive: true });
  await assert.rejects(inspect(root), error => error.diagnostic.code === 'IO_ERROR');
  await assert.rejects(inspect(path.join(root, 'missing')), error => error.diagnostic.code === 'ROOT_INVALID');
  await put(root, 'file.txt', 'plain file');
  await assert.rejects(inspect(path.join(root, 'file.txt')), error => error.diagnostic.code === 'ROOT_INVALID');
});
