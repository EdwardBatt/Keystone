import test from 'node:test';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { link, mkdir, readFile, stat, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { initialize } from '../dist/commands/init.js';
import { contextStatus } from '../dist/commands/status.js';
import { inspect, writeIndex } from '../dist/commands/index.js';
import { temporary, put, snapshot, cli, artifact } from './helpers.mjs';

function git(...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  const result = spawnSync('git', ['-c', 'init.templateDir=', ...args], { encoding: 'utf8', windowsHide: true, env });
  assert.equal(result.status, 0, result.stderr);
}

async function repo(t, fixture = false) {
  const root = await temporary(t, fixture);
  git('init', '--quiet', root);
  return root;
}

test('init creates the Phase 2 scaffold, validates, and offers opt-in thin adapters', async t => {
  const root = await repo(t);
  const result = cli(root, 'init', '--adapter', 'codex', '--adapter', 'claude', '--adapter', 'gemini');
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(result.result.diagnostics, []);
  for (const file of ['PROJECT.md', 'TASKS.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.context/config.yaml', '.context/index.json', 'context/STATE.md', 'context/INDEX.md', 'context/DECISIONS.md', 'context/LEARNINGS.md', 'context/TRAPS.md', 'adr/INDEX.md', 'skills/INDEX.md']) {
    assert.ok((await stat(path.join(root, file))).isFile(), file);
  }
  for (const directory of ['features', 'tasks', 'context/archive', 'agents', 'reviews', '.context/telemetry']) {
    assert.ok((await stat(path.join(root, directory))).isDirectory(), directory);
  }
  const inspection = await inspect(root);
  assert.deepEqual(inspection.diagnostics, []);
  assert.equal(inspection.index.artifacts.filter(a => a.type === 'task' || a.type === 'feature').length, 0);
  assert.equal(await readFile(path.join(root, '.context/config.yaml'), 'utf8'), 'schema_version: 1\n');
  for (const file of ['CLAUDE.md', 'GEMINI.md']) {
    const text = await readFile(path.join(root, file), 'utf8');
    assert.match(text, /AGENTS\.md and PROJECT\.md/);
    assert.ok(!text.includes('project_id:'));
  }
  await assert.rejects(stat(path.join(root, '.context/current-envelope.json')), { code: 'ENOENT' });
});

test('init is repeatable and preserves index and config modification times', async t => {
  const root = await repo(t);
  await initialize(root);
  const before = await snapshot(root);
  const config = await stat(path.join(root, '.context/config.yaml'), { bigint: true });
  const index = await stat(path.join(root, '.context/index.json'), { bigint: true });
  const result = await initialize(root);
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.replaced, []);
  assert.equal(result.index_changed, false);
  assert.deepEqual(await snapshot(root), before);
  assert.equal((await stat(path.join(root, '.context/config.yaml'), { bigint: true })).mtimeNs, config.mtimeNs);
  assert.equal((await stat(path.join(root, '.context/index.json'), { bigint: true })).mtimeNs, index.mtimeNs);
  await assert.rejects(stat(path.join(root, 'CLAUDE.md')), { code: 'ENOENT' });
});

test('init and status resolve the Git root from nested directories containing spaces', async t => {
  const root = await repo(t);
  const nested = path.join(root, 'nested folder', 'inner');
  await mkdir(nested, { recursive: true });
  assert.equal(cli(nested, 'init').status, 0);
  const result = cli(nested, 'context', 'status');
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.result.root, root);
  assert.equal(result.result.index, 'current');
  await assert.rejects(stat(path.join(nested, '.context')), { code: 'ENOENT' });
});

test('Git discovery supports repositories with a .git file', async t => {
  const container = await temporary(t, false);
  const root = path.join(container, 'worktree');
  await mkdir(root);
  git('init', '--quiet', '--separate-git-dir', path.join(container, 'git-data'), root);
  assert.ok((await stat(path.join(root, '.git'))).isFile());
  assert.deepEqual((await initialize(root)).diagnostics, []);
  assert.equal((await contextStatus(root)).index, 'current');
});

test('init and status reject non-Git directories without writing anything', async t => {
  const root = await temporary(t, false);
  for (const args of [['init'], ['context', 'status']]) {
    const result = cli(root, ...args);
    assert.equal(result.status, 1);
    assert.equal(result.result.diagnostics[0].code, 'GIT_ROOT_NOT_FOUND');
  }
  assert.deepEqual(await snapshot(root), {});
});

test('existing project knowledge is preserved even with --force', async t => {
  const root = await repo(t, true);
  await put(root, 'TASKS.md', '# Existing task index\n');
  await put(root, 'AGENTS.md', '# Existing project protocol\n');
  await put(root, 'CLAUDE.md', '# Existing adapter instructions\n');
  await put(root, '.context/config.yaml', 'schema_version: 1\nsources: [PROJECT.md, tasks, adr, rules, features, skills, context]\n');
  const before = await snapshot(root);
  const initial = await initialize(root, { adapters: ['claude'] });
  assert.deepEqual(initial.diagnostics, []);
  const preserved = await snapshot(root);
  for (const [file, contents] of Object.entries(before)) assert.equal(preserved[file], contents, file);
  const forced = await initialize(root, { force: true, adapters: ['claude'] });
  assert.deepEqual(forced.replaced, ['.context/config.yaml']);
  const after = await snapshot(root);
  for (const [file, contents] of Object.entries(before)) {
    if (file !== '.context/config.yaml') assert.equal(after[file], contents, file);
  }
});

test('force resets malformed config by replacing its entry, preserving hard-linked files', async t => {
  const root = await repo(t);
  await put(root, 'notes.yaml', 'invalid: [');
  await mkdir(path.join(root, '.context'));
  await link(path.join(root, 'notes.yaml'), path.join(root, '.context/config.yaml'));
  const initial = await initialize(root);
  assert.ok(initial.diagnostics.some(d => d.code === 'YAML_INVALID'));
  await assert.rejects(stat(path.join(root, '.context/index.json')), { code: 'ENOENT' });
  const result = await initialize(root, { force: true });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(await readFile(path.join(root, 'notes.yaml'), 'utf8'), 'invalid: [');
  assert.equal(await readFile(path.join(root, '.context/config.yaml'), 'utf8'), 'schema_version: 1\n');
});

test('file/directory collisions are rejected before any scaffold writes', async t => {
  const root = await repo(t);
  await put(root, 'rules', 'project-owned file');
  const before = await snapshot(root);
  const result = cli(root, 'init', '--force');
  assert.equal(result.status, 1);
  assert.equal(result.result.diagnostics[0].code, 'INIT_CONFLICT');
  assert.deepEqual(await snapshot(root), before);
});

test('unrecognized generated-index destinations are preserved before scaffold writes', async t => {
  const root = await repo(t);
  await put(root, '.context/index.json', 'project-owned data');
  const before = await snapshot(root);
  const result = cli(root, 'init', '--force');
  assert.equal(result.status, 1);
  assert.equal(result.result.diagnostics[0].code, 'INDEX_OVERWRITE_REFUSED');
  assert.deepEqual(await snapshot(root), before);
});

test('pre-existing junctions in scaffold paths are refused', async t => {
  const root = await repo(t);
  const outside = await temporary(t, false);
  await symlink(outside, path.join(root, 'rules'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = cli(root, 'init');
  assert.equal(result.status, 1);
  assert.equal(result.result.diagnostics[0].code, 'PATH_SYMLINK');
  assert.deepEqual(await snapshot(outside), {});
  await assert.rejects(stat(path.join(root, 'PROJECT.md')), { code: 'ENOENT' });
});

test('init reports existing validation failures and does not write an invalid index', async t => {
  const root = await repo(t);
  await put(root, 'tasks/broken.md', '# Missing task metadata');
  const result = cli(root, 'init');
  assert.equal(result.status, 1);
  assert.ok(result.result.diagnostics.some(d => d.code === 'FRONTMATTER_MISSING'));
  assert.equal(await readFile(path.join(root, 'tasks/broken.md'), 'utf8'), '# Missing task metadata');
  await assert.rejects(stat(path.join(root, '.context/index.json')), { code: 'ENOENT' });
});

test('status reports missing config/index read-only without initializing the repository', async t => {
  const root = await repo(t);
  const before = await snapshot(root);
  const result = cli(root, 'context', 'status');
  assert.equal(result.status, 0);
  assert.equal(result.result.configuration, 'missing');
  assert.equal(result.result.index, 'missing');
  assert.equal(result.result.artifact_count, 0);
  assert.deepEqual(await snapshot(root), before);
});

test('status distinguishes current, stale, missing, invalid and unverified indexes without writing', async t => {
  const root = await repo(t);
  await initialize(root);
  assert.equal((await contextStatus(root)).index, 'current');
  await put(root, 'tasks/TASK-1000.md', artifact('task', { id: 'TASK-1000', title: 'Task', status: 'active' }));
  let before = await snapshot(root);
  assert.equal((await contextStatus(root)).index, 'stale');
  assert.deepEqual(await snapshot(root), before);
  await unlink(path.join(root, '.context/index.json'));
  assert.equal((await contextStatus(root)).index, 'missing');
  await writeIndex(await inspect(root));
  await put(root, 'tasks/TASK-1000.md', '# Invalid task');
  before = await snapshot(root);
  const invalidSources = cli(root, 'context', 'status');
  assert.equal(invalidSources.status, 1);
  assert.equal(invalidSources.result.index, 'unverified');
  assert.deepEqual(await snapshot(root), before);
  await put(root, '.context/index.json', 'invalid JSON');
  const invalidIndex = cli(root, 'context', 'status');
  assert.equal(invalidIndex.status, 1);
  assert.equal(invalidIndex.result.index, 'invalid');
  assert.ok(invalidIndex.result.diagnostics.some(d => d.code === 'INDEX_INVALID'));
});

test('status handles malformed config and reports stable JSON', async t => {
  const root = await repo(t);
  await initialize(root);
  await put(root, '.context/config.yaml', 'sources: [missing]');
  const before = await snapshot(root);
  const first = cli(root, 'context', 'status');
  const second = cli(root, 'context', 'status');
  assert.equal(first.status, 1);
  assert.equal(first.result.index, 'unverified');
  assert.equal(first.stdout, second.stdout);
  assert.ok(first.result.diagnostics.some(d => d.code === 'CONFIG_INVALID'));
  assert.deepEqual(await snapshot(root), before);
});

test('generated index remains byte-for-byte rebuildable after initialization', async t => {
  const root = await repo(t);
  await initialize(root);
  const initial = await readFile(path.join(root, '.context/index.json'), 'utf8');
  await unlink(path.join(root, '.context/index.json'));
  await unlink(path.join(root, 'context/STATE.md'));
  assert.equal(cli(root, 'index').status, 0);
  assert.equal(await readFile(path.join(root, '.context/index.json'), 'utf8'), initial);
});

test('Phase 2 options reject invalid usage and deferred commands stay unavailable', async t => {
  const root = await repo(t);
  const before = await snapshot(root);
  for (const args of [['init', '--adapter', 'unknown'], ['context', 'status', '--force'], ['validate', '--adapter', 'claude'], ['context', 'status', 'extra']]) {
    const result = cli(root, ...args);
    assert.equal(result.status, 2);
    assert.equal(result.result.diagnostics[0].code, 'CLI_USAGE');
  }
  for (const args of [['close', 'TASK-0002'], ['review', 'TASK-0002'], ['compact'], ['context', 'explain', 'TASK-0002']]) {
    const result = cli(root, ...args);
    assert.equal(result.status, 2);
    assert.equal(result.result.diagnostics[0].code, 'COMMAND_NOT_IMPLEMENTED');
  }
  assert.deepEqual(await snapshot(root), before);
});


for (const stage of ['write', 'rename', 'index']) {
  test(`init recovers from injected ${stage} failure without partial scaffold files`, async t => {
    const root = await repo(t);
    const originalWrite = fs.writeFile;
    const originalRename = fs.rename;
    let injected = false;
    t.mock.method(fs, 'writeFile', async (file, contents, options) => {
      if (stage === 'write' && !injected && String(file).includes('.keystone-') && String(contents).includes('Agent Protocol')) {
        injected = true;
        await originalWrite(file, 'partial', options);
        throw Object.assign(new Error('Injected disk full'), { code: 'ENOSPC' });
      }
      return originalWrite(file, contents, options);
    });
    t.mock.method(fs, 'rename', async (from, to) => {
      if (!injected && ((stage === 'rename' && path.basename(to) === 'AGENTS.md') ||
        (stage === 'index' && path.basename(to) === 'index.json'))) {
        injected = true;
        throw Object.assign(new Error('Injected rename failure'), { code: 'EACCES' });
      }
      return originalRename(from, to);
    });
    syncBuiltinESMExports();
    let failed;
    try { failed = await initialize(root); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(injected, true);
    assert.ok(failed.diagnostics.some(d => d.code === 'IO_ERROR'));
    assert.ok(failed.created.includes('.context/config.yaml'));
    assert.equal(failed.index_changed, false);
    if (stage !== 'index') await assert.rejects(stat(path.join(root, 'AGENTS.md')), { code: 'ENOENT' });
    const before = await snapshot(root);
    assert.ok(!Object.keys(before).some(f => f.endsWith('.tmp')));
    const retried = await initialize(root);
    assert.deepEqual(retried.diagnostics, []);
    assert.match(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), /Agent Protocol/);
    for (const [file, bytes] of Object.entries(before)) assert.equal((await snapshot(root))[file], bytes);
    assert.equal((await contextStatus(root)).index, 'current');
  });
}

for (const name of ['123', 'true', 'false', 'null']) {
  test(`init quotes YAML-sensitive project directory ${name}`, async t => {
    const container = await temporary(t, false);
    const root = path.join(container, name);
    await mkdir(root);
    git('init', '--quiet', root);
    assert.deepEqual((await initialize(root)).diagnostics, []);
    const project = (await inspect(root)).index.artifacts.find(a => a.type === 'project');
    assert.equal(project.metadata.project_id, name);
    assert.deepEqual((await initialize(root)).created, []);
  });
}

test('Git discovery preserves configuration environment and classifies execution failures', async t => {
  const root = await repo(t);
  const original = { ...process.env };
  try {
    // Invalid injected Git configuration must reach Git, rather than being silently discarded.
    process.env.GIT_CONFIG_COUNT = 'not-an-integer';
    const failed = cli(root, 'context', 'status');
    assert.equal(failed.result.diagnostics[0].code, 'GIT_DISCOVERY_FAILED');
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'safe.directory';
    process.env.GIT_CONFIG_VALUE_0 = root;
    process.env.GIT_DIR = path.join(root, 'nonexistent');
    process.env.GIT_WORK_TREE = path.join(root, 'wrong');
    assert.equal(cli(root, 'context', 'status').status, 0);
    process.env.PATH = '';
    const unavailable = cli(root, 'context', 'status');
    assert.equal(unavailable.result.diagnostics[0].code, 'GIT_DISCOVERY_FAILED');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});

test('init and status support an actual local linked Git worktree', async t => {
  const root = await repo(t);
  git('-C', root, '-c', 'user.name=Keystone test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Local fixture');
  const container = await temporary(t, false);
  const worktree = path.join(container, 'linked worktree');
  git('-C', root, 'worktree', 'add', '--detach', worktree, 'HEAD');
  assert.ok((await stat(path.join(worktree, '.git'))).isFile());
  assert.deepEqual((await initialize(worktree)).diagnostics, []);
  assert.equal((await contextStatus(worktree)).index, 'current');
  await assert.rejects(stat(path.join(root, 'PROJECT.md')), { code: 'ENOENT' });
});

test('status rejects malformed artifact and link records without modifying generated state', async t => {
  const root = await repo(t);
  await initialize(root);
  const valid = JSON.parse(await readFile(path.join(root, '.context/index.json'), 'utf8'));
  for (const malformed of [
    { ...valid, artifacts: [null] },
    { ...valid, artifacts: [{ ...valid.artifacts[0], metadata: [] }] },
    { ...valid, artifacts: [{ ...valid.artifacts[0], hash: 'bad' }] },
    { ...valid, links: [{}] },
    { ...valid, links: [{ source: 'a', target: 'b', field: 'files', kind: 'unknown' }] },
  ]) {
    await put(root, '.context/index.json', JSON.stringify(malformed));
    const before = await snapshot(root);
    const result = cli(root, 'context', 'status');
    assert.equal(result.status, 1);
    assert.equal(result.result.index, 'invalid');
    assert.equal(result.result.diagnostics[0].code, 'INDEX_INVALID');
    assert.deepEqual(await snapshot(root), before);
  }
  // Ownership recognition still permits rebuilding a damaged disposable cache.
  assert.equal(cli(root, 'index').status, 0);
  assert.equal((await contextStatus(root)).index, 'current');
});

test('failed final validation reports incomplete initialization and completed file lists', async t => {
  const root = await repo(t);
  await put(root, 'tasks/broken.md', '# Invalid task');
  const first = cli(root, 'init');
  assert.equal(first.result.ok, false);
  assert.ok(first.result.created.includes('PROJECT.md'));
  const human = spawnSync(process.execPath, ['dist/cli/index.js', 'init', '--root', root], { encoding: 'utf8' });
  assert.equal(human.status, 1);
  assert.match(human.stdout, /Initialization incomplete/);
  assert.doesNotMatch(human.stdout, /Initialized |Validation passed/);
  const retried = cli(root, 'init');
  assert.ok(retried.result.preserved.includes('PROJECT.md'));
  assert.deepEqual(retried.result.created, []);
});

test('force resets custom discovery configuration but preserves its source files', async t => {
  const root = await repo(t);
  await put(root, 'custom/notes.md', '# Custom knowledge');
  await put(root, '.context/config.yaml', 'schema_version: 1\nsources: [custom]\n');
  assert.deepEqual((await initialize(root)).diagnostics, []);
  const forced = await initialize(root, { force: true });
  assert.deepEqual(forced.replaced, ['.context/config.yaml']);
  assert.equal(await readFile(path.join(root, '.context/config.yaml'), 'utf8'), 'schema_version: 1\n');
  assert.equal(await readFile(path.join(root, 'custom/notes.md'), 'utf8'), '# Custom knowledge');
});


test('failed forced config replacement preserves custom configuration and reports progress', async t => {
  const root = await repo(t);
  await initialize(root);
  const custom = 'schema_version: 1\nsources: [tasks]\n';
  await put(root, '.context/config.yaml', custom);
  const before = await snapshot(root);
  const original = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (path.basename(to) === 'config.yaml') throw Object.assign(new Error('Injected failure'), { code: 'EACCES' });
    return original(from, to);
  });
  syncBuiltinESMExports();
  let failed;
  try { failed = await initialize(root, { force: true }); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(failed.diagnostics[0].code, 'IO_ERROR');
  assert.deepEqual(failed.replaced, []);
  assert.deepEqual(await snapshot(root), before);
  assert.deepEqual((await initialize(root, { force: true })).replaced, ['.context/config.yaml']);
});

test('an abandoned partial temporary sibling cannot become authoritative or block retry', async t => {
  const root = await repo(t);
  await put(root, '.keystone-abandoned.tmp', 'partial protocol');
  await put(root, '.context/.keystone-abandoned.tmp', 'partial configuration');
  const result = await initialize(root);
  assert.deepEqual(result.diagnostics, []);
  assert.match(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), /Agent Protocol/);
  assert.equal((await inspect(root)).index.artifacts.some(a => a.path.endsWith('.tmp')), false);
});
