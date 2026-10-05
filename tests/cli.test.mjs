import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cli, temporary, put, snapshot, project } from './helpers.mjs';

test('CLI validates read-only and indexes offline with stable JSON and successful exit codes', async t => {
  const root = await temporary(t);
  const before = await snapshot(root);
  const validation = cli(root, 'validate');
  assert.equal(validation.status, 0, validation.stderr);
  assert.equal(validation.result.ok, true);
  assert.equal(validation.result.artifact_count, 9);
  assert.deepEqual(await snapshot(root), before);
  const first = cli(root, 'index');
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(first.result.changed, true);
  const second = cli(root, 'index');
  assert.equal(second.status, 0);
  assert.equal(second.result.changed, false);
  const after = await snapshot(root);
  delete after['.context/index.json'];
  assert.deepEqual(after, before);
});

test('CLI reports deterministic validation diagnostics, exits nonzero, and never writes invalid indexes', async t => {
  const root = await temporary(t);
  await put(root, 'tasks/TASK-0001.md', '---\nid: [\n---');
  const before = await snapshot(root);
  const first = cli(root, 'validate');
  const second = cli(root, 'validate');
  assert.equal(first.status, 1);
  assert.equal(first.result.ok, false);
  assert.ok(first.result.diagnostics.some(error => error.code === 'YAML_INVALID'));
  assert.equal(first.stdout, second.stdout);
  assert.equal(cli(root, 'index').status, 1);
  assert.deepEqual(await snapshot(root), before);
});

test('CLI exposes overwrite refusal with no source mutation', async t => {
  const root = await temporary(t);
  await put(root, '.context/index.json', 'project-owned');
  const before = await snapshot(root);
  const result = cli(root, 'index');
  assert.equal(result.status, 1);
  assert.equal(result.result.diagnostics[0].code, 'INDEX_OVERWRITE_REFUSED');
  assert.deepEqual(await snapshot(root), before);
});

test('CLI fails on explicit missing sources without replacing the index', async t => {
  const root = await temporary(t);
  assert.equal(cli(root, 'index').status, 0);
  await put(root, '.context/config.yaml', 'sources: [taskz]');
  const before = await snapshot(root);
  for (const command of ['index', 'validate']) {
    const result = cli(root, command);
    assert.equal(result.status, 1);
    assert.equal(result.result.diagnostics[0].code, 'CONFIG_INVALID');
  }
  assert.deepEqual(await snapshot(root), before);
});

test('CLI defaults to working directory and supports root paths containing spaces', async t => {
  const parent = await temporary(t, false);
  const root = path.join(parent, 'repo with spaces');
  await put(root, 'PROJECT.md', '---\ncontext_type: project\nschema_version: 1\nproject_id: test\nstatus: active\n---');
  assert.equal(cli(root, 'validate').status, 0);
  const run = spawnSync(process.execPath, [path.join(project, 'dist/cli/index.js'), 'validate'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /Validation passed: 1 artifact/);
});

test('help, version, usage errors, and later-phase commands are explicit', async t => {
  const root = await temporary(t, false);
  for (const [args, code] of [
    [[], 'CLI_USAGE'], [['unknown'], 'CLI_USAGE'], [['validate', '--force'], 'CLI_USAGE'],
    [['context'], 'CLI_USAGE'],
    [['start'], 'CLI_USAGE'], [['review'], 'CLI_USAGE'],
    [['close'], 'CLI_USAGE'], [['compact', 'extra'], 'CLI_USAGE'],
    [['context', 'explain', 'TASK-0002'], 'COMMAND_NOT_IMPLEMENTED'],
  ]) {
    const result = cli(root, ...args);
    assert.equal(result.status, 2);
    assert.equal(result.result.diagnostics[0].code, code);
  }
  for (const arg of ['--help', '-h', '--version']) {
    const result = spawnSync(process.execPath, [path.join(project, 'dist/cli/index.js'), arg], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, arg === '--version' ? /0\.1\.0/ : /Phase 6/);
  }
  assert.deepEqual(await snapshot(root), {});
});

test('human-readable validation failures include stable codes on stderr', async t => {
  const root = await temporary(t, false);
  await put(root, 'tasks/task.md', '# missing front matter');
  const result = spawnSync(process.execPath, [path.join(project, 'dist/cli/index.js'), 'validate', '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FRONTMATTER_MISSING tasks\/task.md/);
  assert.equal(result.stdout, '');
});
