import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { compact, prepareCompact } from '../dist/commands/compact.js';
import { prepareClose } from '../dist/commands/close.js';
import { compileReview } from '../dist/commands/review.js';
import { compileStart } from '../dist/commands/start.js';
import { inspect } from '../dist/commands/index.js';
import { parseMarkdown } from '../dist/parser/frontmatter.js';
import { temporary, put, artifact, snapshot, cli } from './helpers.mjs';

const body = id => `# ${id}\n## Observation\nReusable.\n## Evidence\nSee task.\n`;
const learning = (id, fields = {}) => artifact('learning', { id, status: 'accepted', tasks: ['TASK-0001'], evidence: [`${id}: observed`], ...fields }, body(id));
const trap = (id, fields = {}) => artifact('trap', { id, status: 'active', severity: 'medium', tasks: ['TASK-0001'], files: ['src/app.txt'], evidence: [`${id}: hit`], ...fields }, `# ${id}\n## Failure Mode\nX.\n`);
const task = (id, status) => artifact('task', { id, title: id, status }, `# ${id}\n## Objective\nWork.\n`);

/** A repository with knowledge, high-authority artifacts and navigation that COMPACT must never touch. */
async function repo(t, extra = {}, dir) {
  let root = await temporary(t, false);
  if (dir) { root = path.join(root, dir); await mkdir(root); }
  const files = {
    'PROJECT.md': artifact('project', { project_id: 'p', status: 'active' }, '# P\n'),
    'TASKS.md': '# Tasks\n',
    'context/LEARNINGS.md': '# Learnings\n',
    'context/TRAPS.md': '# Traps\n',
    'reviews/TASK-0001/code-1.md': '# A durable reviewer record\n',
    'src/app.txt': 'app\n',
    'src/other.txt': 'other\n',
    'tasks/TASK-0001.md': task('TASK-0001', 'accepted'),
    'tasks/TASK-0002.md': task('TASK-0002', 'active'),
    'tasks/TASK-0003.md': task('TASK-0003', 'proposed'),
    'adr/ADR-0001.md': artifact('adr', { id: 'ADR-0001', title: 'A', status: 'accepted' }, '# A\n'),
    'rules/GLOBAL.md': '# Global\n',
    'skills/testing.md': '# Testing\n',
    'features/core/FEATURE.md': artifact('feature', { feature: 'core', status: 'active' }, '# Core\n'),
    'context/learnings/LRN-0001.md': learning('LRN-0001', { features: ['core'] }),
    'context/learnings/LRN-0002.md': learning('LRN-0002', { tasks: ['TASK-0001', 'TASK-0002'], evidence: ['LRN-0001: observed', 'LRN-0002: observed'] }),
    'context/learnings/LRN-0003.md': learning('LRN-0003', { status: 'candidate' }),
    'context/learnings/LRN-0004.md': learning('LRN-0004', { status: 'candidate', tasks: ['TASK-0002'] }),
    'context/traps/TRAP-0001.md': trap('TRAP-0001'),
    ...extra,
  };
  for (const [file, contents] of Object.entries(files)) if (contents !== null) await put(root, file, contents);
  return root;
}

const read = async (root, file) => parseMarkdown(await readFile(path.join(root, file), 'utf8'), file);
const changed = (before, after) => Object.keys({ ...before, ...after }).filter(f => before[f] !== after[f]).sort();
const codes = result => result.diagnostics.map(d => d.code);

test('S1/S2: compact without operations is a read-only, reproducible report of deterministic signals', async t => {
  const root = await repo(t, {
    'context/learnings/LRN-0005.md': learning('LRN-0005', { tasks: [], evidence: ['x'] }),
    'context/traps/TRAP-0002.md': trap('TRAP-0002', { status: 'proposed' }),
  });
  const before = await snapshot(root);
  const first = cli(root, 'compact');
  const second = cli(root, 'compact');
  assert.equal(first.status, 0, first.stdout);
  assert.equal(first.result.outcome, 'reported');
  assert.equal(first.stdout, second.stdout);
  assert.deepEqual(await snapshot(root), before);
  const report = first.result.report;
  // LRN-0004 is linked to an active task, so it is not stale.
  assert.deepEqual(report.stale_candidates.map(c => c.id), ['LRN-0003', 'TRAP-0002']);
  assert.deepEqual(report.binding.by_task, { 'TASK-0001': ['LRN-0001', 'LRN-0002', 'TRAP-0001'], 'TASK-0002': ['LRN-0002'] });
  assert.deepEqual(report.binding.by_feature, { core: ['LRN-0001'] });
  assert.deepEqual(report.binding.unlinked, ['LRN-0005']);
  assert.deepEqual(report.retired, []);
  assert.deepEqual(report.binding_removals, []);
});

test('S3: retiring a candidate sets retired and the record; nothing else in the file changes', async t => {
  const root = await repo(t);
  const file = 'context/learnings/LRN-0003.md';
  const original = await read(root, file);
  const before = await snapshot(root);
  const result = await compact(root, { task: 'TASK-0002', retire: [{ id: 'LRN-0003', reason: 'Never confirmed.' }] });
  assert.equal(result.outcome, 'compacted', JSON.stringify(result.diagnostics));
  assert.deepEqual(result.retired, ['LRN-0003']);
  assert.deepEqual(changed(before, await snapshot(root)), [file]);
  const after = await read(root, file);
  const { status, retirement, ...rest } = after.metadata;
  const { status: was, ...originalRest } = original.metadata;
  assert.equal(was, 'candidate');
  assert.equal(status, 'retired');
  assert.deepEqual(retirement, { task: 'TASK-0002', reason: 'Never confirmed.', previous_status: 'candidate' });
  assert.deepEqual(rest, originalRest);
  assert.equal(after.body, original.body);
  assert.ok(!result.diagnostics.some(d => d.code === 'COMPACT_BINDING_REMOVAL'), 'a candidate was never binding');
  assert.deepEqual((await inspect(root)).diagnostics, []);
});

test('S4/S15: retiring with an eligible successor leaves START binding the successor and showing history only', async t => {
  const root = await repo(t);
  const before = await snapshot(root);
  const successorBytes = before['context/learnings/LRN-0002.md'];
  const result = cli(root, 'compact', '--task', 'TASK-0002', '--retire', 'LRN-0001', '--reason', 'Consolidated into LRN-0002.', '--by', 'LRN-0002');
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.result.outcome, 'compacted');
  const after = await snapshot(root);
  assert.deepEqual(changed(before, after), ['context/learnings/LRN-0001.md']);
  assert.equal(after['context/learnings/LRN-0002.md'], successorBytes, 'the successor is not edited');
  const retired = await read(root, 'context/learnings/LRN-0001.md');
  assert.deepEqual(retired.metadata.superseded_by, ['LRN-0002']);
  assert.equal(retired.metadata.retirement.previous_status, 'accepted');
  assert.deepEqual(result.result.report.retired.map(r => [r.id, r.endpoints, r.binding_removal]), [['LRN-0001', ['LRN-0002'], false]]);
  const start = await compileStart(root, 'TASK-0001');
  assert.equal(start.outcome, 'complete', JSON.stringify(start.diagnostics));
  const entry = id => start.envelope.entries.find(e => e.id === id);
  assert.equal(entry('LRN-0001').role, 'history');
  assert.equal(entry('LRN-0001').tier, 3);
  assert.equal(entry('LRN-0002').role, 'supporting');
  assert.ok(!start.diagnostics.some(d => d.code === 'START_AUTHORITY_UNKNOWN'));
});

test('S4: a retired learning reached through review material is history, never review or binding', async t => {
  const root = await repo(t, {
    'tasks/TASK-0002.md': artifact('task', { id: 'TASK-0002', title: 'T', status: 'active', adrs: ['ADR-0002'] }, '# TASK-0002\n'),
    'adr/ADR-0002.md': artifact('adr', { id: 'ADR-0002', title: 'P', status: 'proposed', files: ['context/learnings/LRN-0003.md'] }, '# P\n'),
  });
  assert.equal((await compact(root, { task: 'TASK-0002', retire: [{ id: 'LRN-0003', reason: 'Withdrawn.' }] })).outcome, 'compacted');
  const start = await compileStart(root, 'TASK-0002');
  const entry = start.envelope.entries.find(e => e.id === 'LRN-0003');
  assert.equal(entry.role, 'history');
  assert.equal(entry.tier, 3);
  assert.ok(!start.diagnostics.some(d => d.code === 'START_AUTHORITY_UNKNOWN'));
});

test('S5–S7: unsafe successors block the whole run without writing', async t => {
  const root = await repo(t, {
    'context/learnings/LRN-0006.md': learning('LRN-0006', { evidence: ['LRN-0006: observed'] }),
    'context/learnings/LRN-0007.md': learning('LRN-0007', { tasks: ['TASK-0002'], evidence: ['LRN-0001: observed'] }),
    'context/traps/TRAP-0002.md': trap('TRAP-0002', { files: ['src/other.txt'], evidence: ['TRAP-0001: hit'] }),
    'context/traps/TRAP-0003.md': trap('TRAP-0003', { severity: 'high', evidence: ['TRAP-0001: hit'] }),
    'context/traps/TRAP-0004.md': trap('TRAP-0004', { status: 'proposed', evidence: ['TRAP-0001: hit'] }),
  });
  const before = await snapshot(root);
  const cases = [
    ['LRN-0001', 'LRN-0006', /does not contain its provenance \(evidence: LRN-0001: observed\)/],
    ['LRN-0001', 'LRN-0007', /does not contain its provenance \(tasks: TASK-0001\)/],
    ['TRAP-0001', 'TRAP-0002', /files: src\/app\.txt/],
    ['TRAP-0001', 'TRAP-0003', /not eligible/],
    ['TRAP-0001', 'TRAP-0004', /not eligible/],
    ['LRN-0001', 'TRAP-0001', /is a trap, not a learning/],
    ['LRN-0001', 'LRN-0003', /not eligible/],
    ['LRN-0001', 'LRN-0001', /cannot succeed itself/],
    ['LRN-0001', 'LRN-9999', /does not exist/],
  ];
  for (const [id, by, message] of cases) {
    const result = await compact(root, { task: 'TASK-0002', retire: [{ id, reason: 'r', by }] });
    assert.equal(result.outcome, 'blocked', `${id} by ${by}`);
    assert.ok(result.diagnostics.some(d => d.code === 'COMPACT_RETIREMENT_INVALID' && message.test(d.message)), JSON.stringify(result.diagnostics));
  }
  const same = await compact(root, { task: 'TASK-0002', retire: [{ id: 'LRN-0001', reason: 'r', by: 'LRN-0002' }, { id: 'LRN-0002', reason: 'r' }] });
  assert.equal(same.outcome, 'blocked');
  assert.ok(same.diagnostics.some(d => /itself being retired in this run/.test(d.message)));
  assert.deepEqual(await snapshot(root), before);
});

test('S8/S9/S11: other artifact types, invalid tasks and any failing request block everything', async t => {
  const root = await repo(t);
  const before = await snapshot(root);
  for (const id of ['ADR-0001', 'rules/GLOBAL.md', 'skills/testing.md', 'p', 'core', 'TASK-0001']) {
    const result = await compact(root, { task: 'TASK-0002', retire: [{ id, reason: 'r' }] });
    assert.equal(result.outcome, 'blocked', id);
    assert.ok(result.diagnostics.some(d => /never retired by COMPACT/.test(d.message)), id);
  }
  for (const id of ['TASK-9999', 'TASK-0001', 'TASK-0003']) {
    const result = cli(root, 'compact', '--task', id, '--retire', 'LRN-0003', '--reason', 'r');
    assert.equal(result.status, 1, id);
    assert.deepEqual(codes(result.result), ['COMPACT_TASK_INVALID'], id);
  }
  const mixed = await compact(root, { task: 'TASK-0002', retire: [{ id: 'LRN-0003', reason: 'ok' }, { id: 'LRN-9999', reason: 'missing' }] });
  assert.equal(mixed.outcome, 'blocked');
  assert.deepEqual(mixed.written, []);
  assert.deepEqual(await snapshot(root), before);
});

test('S10: compaction usage errors are explicit and exit 2', async t => {
  const root = await repo(t);
  const before = await snapshot(root);
  for (const args of [
    ['compact', '--retire', 'LRN-0003', '--reason', 'r'],
    ['compact', '--task', 'TASK-0002', '--retire', 'LRN-0003'],
    ['compact', '--task', 'TASK-0002', '--retire', 'LRN-0003', '--reason', '   '],
    ['compact', '--task', 'TASK-0002'],
    ['compact', '--reason', 'r'],
    ['compact', '--by', 'LRN-0002'],
    ['compact', '--task', 'TASK-0002', '--retire', 'LRN-0003', '--reason', 'r', '--reason', 's'],
    ['compact', '--task', 'TASK-0002', '--retire', 'LRN-0001', '--reason', 'r', '--by', 'LRN-0002', '--by', 'LRN-0002'],
    ['compact', '--task', 'TASK-0002', '--retire', 'LRN-0003', '--reason', 'r', '--retire', 'LRN-0003', '--reason', 'r'],
    ['compact', 'extra'],
    ['validate', '--retire', 'LRN-0003'],
    ['close', 'TASK-0002', '--task', 'TASK-0002'],
  ]) {
    const result = cli(root, ...args);
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.result.diagnostics[0].code, 'CLI_USAGE', args.join(' '));
  }
  assert.deepEqual(await snapshot(root), before);
});

test('S12: identical re-runs are unchanged; a different record for a retired artifact is blocked', async t => {
  const root = await repo(t, { 'tasks/TASK-0004.md': task('TASK-0004', 'active') });
  const request = { task: 'TASK-0002', retire: [{ id: 'LRN-0001', reason: 'Merged.', by: 'LRN-0002' }] };
  assert.equal((await compact(root, request)).outcome, 'compacted');
  const before = await snapshot(root);
  const again = cli(root, 'compact', '--task', 'TASK-0002', '--retire', 'LRN-0001', '--reason', 'Merged.', '--by', 'LRN-0002');
  assert.equal(again.status, 0);
  assert.equal(again.result.outcome, 'unchanged');
  assert.deepEqual(again.result.unchanged, ['LRN-0001']);
  for (const retire of [{ id: 'LRN-0001', reason: 'Other.', by: 'LRN-0002' }, { id: 'LRN-0001', reason: 'Merged.' }]) {
    const result = await compact(root, { task: 'TASK-0002', retire: [retire] });
    assert.equal(result.outcome, 'blocked');
    assert.deepEqual(codes(result), ['COMPACT_ALREADY_RETIRED']);
  }
  const otherTask = await compact(root, { task: 'TASK-0004', retire: request.retire });
  assert.equal(otherTask.outcome, 'blocked');
  assert.deepEqual(await snapshot(root), before);
  const mixed = await compact(root, { task: 'TASK-0002', retire: [...request.retire, { id: 'LRN-0003', reason: 'Stale.' }] });
  assert.equal(mixed.outcome, 'compacted');
  assert.deepEqual(mixed.retired, ['LRN-0003']);
  assert.deepEqual(mixed.unchanged, ['LRN-0001']);
});

test('S13: a failed rename restores every original file and leaves no temporary files', async t => {
  const root = await repo(t);
  const before = await snapshot(root);
  let calls = 0;
  const realRename = fs.rename;
  t.mock.method(fs, 'rename', async (...args) => {
    if (++calls === 2) throw new Error('Injected rename failure');
    return realRename(...args);
  });
  syncBuiltinESMExports();
  let result;
  try { result = await compact(root, { task: 'TASK-0002', retire: [{ id: 'LRN-0003', reason: 'a' }, { id: 'LRN-0004', reason: 'b' }] }); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(result.outcome, 'failed');
  assert.ok(codes(result).includes('COMPACT_WRITE_FAILED'));
  assert.deepEqual(await snapshot(root), before);
});

test('S13: a partially written temporary file is removed and originals are unchanged', async t => {
  const root = await repo(t);
  const before = await snapshot(root);
  const realWriteFile = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (file, contents, options) => {
    if (String(file).includes('.compact-') && String(file).endsWith('.tmp')) {
      await realWriteFile(file, String(contents).slice(0, 10), options);
      throw new Error('Injected partial write failure');
    }
    return realWriteFile(file, contents, options);
  });
  syncBuiltinESMExports();
  let result;
  try { result = await compact(root, { task: 'TASK-0002', retire: [{ id: 'LRN-0003', reason: 'a' }] }); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(result.outcome, 'failed');
  const after = await snapshot(root);
  assert.deepEqual(after, before);
  assert.ok(!Object.keys(after).some(file => /\.compact-.*\.tmp$/.test(file)));
});

test('I1: a successor may be retired without its own successor; the binding removal stays visible', async t => {
  const root = await repo(t);
  assert.equal((await compact(root, { task: 'TASK-0002', retire: [{ id: 'LRN-0001', reason: 'Merged.', by: 'LRN-0002' }] })).outcome, 'compacted');
  const result = await compact(root, { task: 'TASK-0002', retire: [{ id: 'LRN-0002', reason: 'Obsolete.' }] });
  assert.equal(result.outcome, 'compacted', JSON.stringify(result.diagnostics));
  const removal = result.diagnostics.find(d => d.code === 'COMPACT_BINDING_REMOVAL');
  assert.match(removal.message, /LRN-0002 is retired without a successor; its binding knowledge is removed; it ends the successor chain of LRN-0001/);
  assert.deepEqual(result.report.binding_removals, ['LRN-0001', 'LRN-0002']);
  const report = cli(root, 'compact').result.report;
  assert.deepEqual(report.binding_removals, ['LRN-0001', 'LRN-0002']);
  assert.deepEqual(report.retired.find(r => r.id === 'LRN-0001').endpoints, ['LRN-0002']);
  assert.deepEqual((await inspect(root)).diagnostics, [], 'the provenance chain still validates');
});

test('S16: compaction works on a path with spaces without Git or network access', async t => {
  const root = await repo(t, {}, 'repo with spaces');
  const result = cli(root, 'compact', '--task', 'TASK-0002', '--retire', 'TRAP-0001', '--reason', 'Fixed at the source.');
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.result.outcome, 'compacted');
  assert.deepEqual(result.result.written, ['context/traps/TRAP-0001.md']);
  assert.deepEqual(result.result.report.binding_removals, ['TRAP-0001']);
});

test('S17/I2: validation enforces retirement records, typed successor links and provenance containment', async t => {
  const retired = (id, fields = {}) => learning(id, { status: 'retired', retirement: { task: 'TASK-0002', reason: 'r' }, ...fields });
  const cases = [
    ['retired without a record', { 'context/learnings/LRN-0001.md': learning('LRN-0001', { status: 'retired' }) }, 'RETIREMENT_RECORD_MISSING'],
    ['a record on a live learning', { 'context/learnings/LRN-0001.md': learning('LRN-0001', { retirement: { task: 'TASK-0002', reason: 'r' } }) }, 'RETIREMENT_RECORD_UNEXPECTED'],
    ['superseded_by on a live learning', { 'context/learnings/LRN-0001.md': learning('LRN-0001', { superseded_by: ['LRN-0002'] }) }, 'SUPERSESSION_NOT_RETIRED'],
    ['a record without a reason', { 'context/learnings/LRN-0001.md': learning('LRN-0001', { status: 'retired', retirement: { task: 'TASK-0002' } }) }, 'SCHEMA_INVALID'],
    ['a blank reason', { 'context/learnings/LRN-0001.md': retired('LRN-0001', { retirement: { task: 'TASK-0002', reason: ' ' } }) }, 'SCHEMA_INVALID'],
    ['a malformed successor list', { 'context/learnings/LRN-0001.md': retired('LRN-0001', { superseded_by: { id: 'LRN-0002' } }) }, 'SCHEMA_INVALID'],
    ['an unknown record task', { 'context/learnings/LRN-0001.md': retired('LRN-0001', { retirement: { task: 'TASK-9999', reason: 'r' } }) }, 'LINK_MISSING'],
    ['a record naming a non-task', { 'context/learnings/LRN-0001.md': retired('LRN-0001', { retirement: { task: 'ADR-0001', reason: 'r' } }) }, 'LINK_TYPE_MISMATCH'],
    ['an unknown successor', { 'context/learnings/LRN-0001.md': retired('LRN-0001', { superseded_by: ['LRN-9999'] }) }, 'LINK_MISSING'],
    ['a successor of another type', { 'context/learnings/LRN-0001.md': retired('LRN-0001', { superseded_by: ['TRAP-0001'] }) }, 'LINK_TYPE_MISMATCH'],
    ['a self successor', { 'context/learnings/LRN-0001.md': retired('LRN-0001', { superseded_by: ['LRN-0001'] }) }, 'SUPERSESSION_SELF'],
    ['a successor cycle', {
      'context/learnings/LRN-0001.md': retired('LRN-0001', { superseded_by: ['LRN-0002'], tasks: ['TASK-0001', 'TASK-0002'], evidence: ['LRN-0001: observed', 'LRN-0002: observed'] }),
      'context/learnings/LRN-0002.md': retired('LRN-0002', { superseded_by: ['LRN-0001'], tasks: ['TASK-0001', 'TASK-0002'], evidence: ['LRN-0001: observed', 'LRN-0002: observed'] }),
    }, 'SUPERSESSION_CYCLE'],
    ['a successor that dropped evidence', {
      'context/learnings/LRN-0001.md': retired('LRN-0001', { superseded_by: ['LRN-0002'] }),
      'context/learnings/LRN-0002.md': learning('LRN-0002', { evidence: ['LRN-0002: observed'] }),
    }, 'SUCCESSION_CONTAINMENT_BROKEN'],
    ['a trap successor that dropped a file', {
      'context/traps/TRAP-0001.md': trap('TRAP-0001', { status: 'retired', retirement: { task: 'TASK-0002', reason: 'r' }, superseded_by: ['TRAP-0002'] }),
      'context/traps/TRAP-0002.md': trap('TRAP-0002', { files: ['src/other.txt'], evidence: ['TRAP-0001: hit'] }),
    }, 'SUCCESSION_CONTAINMENT_BROKEN'],
  ];
  for (const [name, files, code] of cases) {
    const root = await repo(t, files);
    const result = await inspect(root);
    assert.ok(result.diagnostics.some(d => d.code === code), `${name}: ${JSON.stringify(result.diagnostics)}`);
    const validate = cli(root, 'validate');
    assert.equal(validate.status, 1, name);
    const blocked = await prepareCompact(root, {});
    assert.equal(blocked.outcome, 'failed', name);
    assert.ok(codes(blocked).includes('COMPACT_VALIDATION_FAILED'), name);
  }
  const clean = await repo(t, { 'context/learnings/LRN-0001.md': learning('LRN-0001', { superseded_by: [] }) });
  assert.deepEqual((await inspect(clean)).diagnostics, [], 'an empty successor list declares nothing');
});

function git(root, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  const result = spawnSync('git', ['-c', 'init.templateDir=', '-c', 'user.name=Keystone test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-C', root, ...args], { encoding: 'utf8', windowsHide: true, env });
  assert.equal(result.status, 0, result.stderr);
}

test('S14: CLOSE refuses to promote a retired artifact', async t => {
  const root = await temporary(t, false);
  git(root, 'init', '--quiet');
  for (const [file, contents] of Object.entries({
    '.gitignore': '/.context/*\n',
    'PROJECT.md': artifact('project', { project_id: 'p', status: 'active' }, '# P\n'),
    'tasks/TASK-0001.md': artifact('task', { id: 'TASK-0001', title: 'Example', status: 'review' }, '# TASK-0001\n## Objective\nWork.\n## Acceptance Criteria\nDone.\n'),
  })) await put(root, file, contents);
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'base');
  await put(root, 'context/learnings/LRN-0001.md', learning('LRN-0001', { status: 'retired', retirement: { task: 'TASK-0001', reason: 'Withdrawn.' } }));
  const evidence = await compileReview(root, 'TASK-0001', { type: 'context' });
  assert.notEqual(evidence.outcome, 'failed', JSON.stringify(evidence.diagnostics));
  const front = role => ({ kind: 'keystone-review-report', schema_version: 1, task: 'TASK-0001', role, round: 1, verdict: 'approve',
    evidence_hash: evidence.evidence_hash, base: evidence.packages[0].baseline.base, reviewer: 'Independent test reviewer' });
  for (const role of ['architecture', 'code', 'context']) {
    await put(root, `reviews/TASK-0001/${role}-1.md`, `---\n${JSON.stringify(front(role))}\n---\n# Review\n## Findings\nNone.\n## Evidence Examined\nThe package.\n`);
  }
  const result = await prepareClose(root, 'TASK-0001', { promote: ['LRN-0001'] });
  assert.equal(result.gate, 'satisfied', JSON.stringify(result.diagnostics));
  assert.equal(result.outcome, 'blocked');
  assert.ok(result.diagnostics.some(d => d.code === 'CLOSE_PROMOTION_INVALID' && /not a candidate learning/.test(d.message)));
});

// --- TASK-0011 independent review remediation (round 1) ---

test('review B1: trap succession preserves every files entry, including generated paths the graph does not link', async t => {
  const generated = ['src/app.txt', 'context/STATE.md', '.context/telemetry/run.json'];
  const root = await repo(t, {
    'context/traps/TRAP-0001.md': trap('TRAP-0001', { files: generated }),
    'context/traps/TRAP-0002.md': trap('TRAP-0002', { files: ['src/app.txt'], evidence: ['TRAP-0001: hit'] }),
    'context/traps/TRAP-0003.md': trap('TRAP-0003', { files: ['src\\app.txt', 'context/STATE.md', '.context/telemetry/run.json'], evidence: ['TRAP-0001: hit'] }),
  });
  const before = await snapshot(root);
  const blocked = await compact(root, { task: 'TASK-0002', retire: [{ id: 'TRAP-0001', reason: 'r', by: 'TRAP-0002' }] });
  assert.equal(blocked.outcome, 'blocked');
  assert.match(blocked.diagnostics[0].message, /files: context\/STATE\.md; files: \.context\/telemetry\/run\.json/);
  assert.deepEqual(await snapshot(root), before);
  // A successor declaring the same paths (here one with a backslash separator) contains them.
  const ok = await compact(root, { task: 'TASK-0002', retire: [{ id: 'TRAP-0001', reason: 'r', by: 'TRAP-0003' }] });
  assert.equal(ok.outcome, 'compacted', JSON.stringify(ok.diagnostics));

  // The standing invariant reports a hand-authored chain that drops a generated path.
  const manual = await repo(t, {
    'context/traps/TRAP-0001.md': trap('TRAP-0001', { files: generated, status: 'retired', retirement: { task: 'TASK-0002', reason: 'r' }, superseded_by: ['TRAP-0002'] }),
    'context/traps/TRAP-0002.md': trap('TRAP-0002', { files: ['src/app.txt', 'context/STATE.md'], evidence: ['TRAP-0001: hit'] }),
  });
  const diagnostics = (await inspect(manual)).diagnostics;
  assert.deepEqual(diagnostics.map(d => d.code), ['SUCCESSION_CONTAINMENT_BROKEN']);
  assert.match(diagnostics[0].message, /files: \.context\/telemetry\/run\.json/);
});

test('review B2: a failed restoration is reported as unrecovered, never as restored', async t => {
  const root = await repo(t);
  const original = await readFile(path.join(root, 'context/learnings/LRN-0003.md'));
  let calls = 0;
  const realRename = fs.rename;
  // The first retirement rename succeeds; the second and every restoration rename fail.
  t.mock.method(fs, 'rename', async (...args) => {
    if (++calls >= 2) throw new Error('Injected rename failure');
    return realRename(...args);
  });
  syncBuiltinESMExports();
  let result;
  try { result = await compact(root, { task: 'TASK-0002', retire: [{ id: 'LRN-0003', reason: 'a' }, { id: 'LRN-0004', reason: 'b' }] }); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(result.outcome, 'failed');
  assert.deepEqual(result.unrestored, ['context/learnings/LRN-0003.md']);
  assert.deepEqual(result.temporary_files, []);
  const failure = result.diagnostics.find(d => d.code === 'COMPACT_WRITE_FAILED');
  assert.match(failure.message, /recovery is incomplete/);
  assert.doesNotMatch(failure.message, /was restored/);
  assert.ok(result.diagnostics.some(d => d.code === 'COMPACT_ROLLBACK_INCOMPLETE' && d.path === 'context/learnings/LRN-0003.md'));
  // The report is truthful: the file really still holds the retirement edit.
  const now = await readFile(path.join(root, 'context/learnings/LRN-0003.md'));
  assert.notDeepEqual(now, original);
  assert.equal((await read(root, 'context/learnings/LRN-0003.md')).metadata.status, 'retired');
  assert.ok(!Object.keys(await snapshot(root)).some(file => /\.compact-.*\.tmp$/.test(file)));
});

test('review B2: a temporary file that cannot be removed is reported and really remains', async t => {
  const root = await repo(t);
  const before = await snapshot(root);
  let calls = 0;
  const realRename = fs.rename;
  t.mock.method(fs, 'rename', async (...args) => {
    if (++calls === 2) throw new Error('Injected rename failure');
    return realRename(...args);
  });
  t.mock.method(fs, 'unlink', async () => { throw Object.assign(new Error('Injected unlink failure'), { code: 'EPERM' }); });
  syncBuiltinESMExports();
  let result;
  try { result = await compact(root, { task: 'TASK-0002', retire: [{ id: 'LRN-0003', reason: 'a' }, { id: 'LRN-0004', reason: 'b' }] }); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(result.outcome, 'failed');
  assert.deepEqual(result.unrestored, []);
  assert.equal(result.temporary_files.length, 1);
  assert.match(result.temporary_files[0], /^context\/learnings\/\.LRN-0004\.md\.compact-.*\.tmp$/);
  assert.ok(result.diagnostics.some(d => d.code === 'COMPACT_TEMPORARY_FILE_REMAINS' && d.path === result.temporary_files[0]));
  assert.doesNotMatch(result.diagnostics.find(d => d.code === 'COMPACT_WRITE_FAILED').message, /no temporary file remains/);
  const after = await snapshot(root);
  assert.ok(Object.hasOwn(after, result.temporary_files[0]), 'the reported temporary file exists');
  delete after[result.temporary_files[0]];
  assert.deepEqual(after, before, 'every original is restored');
});

test('review B2: a recovered failure says so only after verification', async t => {
  const root = await repo(t);
  const before = await snapshot(root);
  let calls = 0;
  const realRename = fs.rename;
  t.mock.method(fs, 'rename', async (...args) => {
    if (++calls === 2) throw new Error('Injected rename failure');
    return realRename(...args);
  });
  syncBuiltinESMExports();
  let result;
  try { result = await compact(root, { task: 'TASK-0002', retire: [{ id: 'LRN-0003', reason: 'a' }, { id: 'LRN-0004', reason: 'b' }] }); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.deepEqual([result.unrestored, result.temporary_files], [[], []]);
  assert.match(result.diagnostics.find(d => d.code === 'COMPACT_WRITE_FAILED').message, /restored and verified, and no temporary file remains/);
  assert.deepEqual(await snapshot(root), before);
});

test('review B3: retirement preserves BOM, CRLF, comments, quoting, spacing and the body byte for byte', async t => {
  const front = [
    '---',
    'context_type: learning',
    'schema_version: 1',
    'id: LRN-0003   # keep this comment',
    'status:   "candidate"  # and this one',
    'tasks: [ TASK-0001 ]',
    'evidence:',
    '  - "LRN-0003: observed"',
    '',
    '# a trailing comment',
    '---',
  ].join('\r\n');
  const body = '\r\n# LRN-0003\r\n\r\nBody  with  spacing   \r\n\tTabbed line\r\nNo final newline';
  const raw = `﻿${front}${body}`;
  const root = await repo(t, { 'context/learnings/LRN-0003.md': raw });
  const result = await compact(root, { task: 'TASK-0002', retire: [{ id: 'LRN-0003', reason: 'Never "confirmed".' }] });
  assert.equal(result.outcome, 'compacted', JSON.stringify(result.diagnostics));
  const expected = raw.replace('"candidate"', '"retired"').replace('# a trailing comment\r\n---',
    '# a trailing comment\r\nretirement:\r\n  task: "TASK-0002"\r\n  reason: "Never \\"confirmed\\"."\r\n  previous_status: "candidate"\r\n---');
  assert.deepEqual(await readFile(path.join(root, 'context/learnings/LRN-0003.md')), Buffer.from(expected, 'utf8'));
});

test('review B3: flow-style front matter and an existing empty successor list are edited in place', async t => {
  const flow = '---\n{"context_type":"learning", "schema_version":1,"id":"LRN-0003","status":\'candidate\',"tasks":["TASK-0001"],"evidence":["LRN-0003: observed"] }\n---\r\nBody\r\n';
  const block = '---\rcontext_type: learning\rschema_version: 1\rid: LRN-0001\rstatus: accepted\rtasks: [TASK-0001]\revidence: [\'LRN-0001: observed\']\rsuperseded_by: []   # empty\r---\rBody\r';
  const root = await repo(t, { 'context/learnings/LRN-0003.md': flow, 'context/learnings/LRN-0001.md': block });
  const result = await compact(root, { task: 'TASK-0002', retire: [{ id: 'LRN-0003', reason: 'r' }, { id: 'LRN-0001', reason: 'm', by: 'LRN-0002' }] });
  assert.equal(result.outcome, 'compacted', JSON.stringify(result.diagnostics));
  assert.equal(await readFile(path.join(root, 'context/learnings/LRN-0003.md'), 'utf8'), flow
    .replace("'candidate'", "'retired'")
    .replace('] }', '], "retirement": {"task":"TASK-0002","reason":"r","previous_status":"candidate"} }'));
  assert.equal(await readFile(path.join(root, 'context/learnings/LRN-0001.md'), 'utf8'), block
    .replace('status: accepted', 'status: retired')
    .replace('superseded_by: []', 'superseded_by: ["LRN-0002"]')
    .replace('# empty\r---', '# empty\rretirement:\r  task: "TASK-0002"\r  reason: "m"\r  previous_status: "accepted"\r---'));
  assert.deepEqual((await inspect(root)).diagnostics, []);
});

test('review N1: binding-removal reporting follows START semantics, including trap severity', async t => {
  const root = await repo(t, {
    'context/traps/TRAP-0002.md': trap('TRAP-0002', { severity: 'high' }),
  });
  const result = await compact(root, { task: 'TASK-0002', retire: [{ id: 'TRAP-0001', reason: 'a' }, { id: 'TRAP-0002', reason: 'b' }] });
  assert.equal(result.outcome, 'compacted');
  const removals = result.diagnostics.filter(d => d.code === 'COMPACT_BINDING_REMOVAL').map(d => d.path);
  assert.deepEqual(removals, ['context/traps/TRAP-0001.md'], 'an unclassified-severity trap was never binding');
  const entry = id => result.report.retired.find(r => r.id === id);
  assert.deepEqual([entry('TRAP-0001').was_binding, entry('TRAP-0001').binding_removal], [true, true]);
  assert.deepEqual([entry('TRAP-0002').previous_status, entry('TRAP-0002').was_binding, entry('TRAP-0002').binding_removal], ['active', false, false]);
  assert.deepEqual(result.report.binding_removals, ['TRAP-0001']);
});

test('review N2: compaction flags on context explain are usage errors, not COMMAND_NOT_IMPLEMENTED', async t => {
  const root = await temporary(t, false);
  for (const args of [['context', 'explain', 'X', '--retire', 'LRN-1'], ['context', 'explain', 'X', '--task', 'TASK-1']]) {
    const result = cli(root, ...args);
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.result.diagnostics[0].code, 'CLI_USAGE', args.join(' '));
  }
  assert.equal(cli(root, 'context', 'explain', 'X').result.diagnostics[0].code, 'COMMAND_NOT_IMPLEMENTED');
});

test('multi-successor branching: every branch must contain the provenance, and chain endpoints stay visible', async t => {
  const branched = (fields = {}) => learning('LRN-0001', { status: 'retired', retirement: { task: 'TASK-0002', reason: 'Split.', previous_status: 'accepted' }, superseded_by: ['LRN-0002', 'LRN-0006'], ...fields });
  const second = learning('LRN-0006', { evidence: ['LRN-0001: observed'] });
  const root = await repo(t, { 'context/learnings/LRN-0001.md': branched(), 'context/learnings/LRN-0006.md': second });
  assert.deepEqual((await inspect(root)).diagnostics, []);
  const entry = async () => (await prepareCompact(root)).report.retired.find(r => r.id === 'LRN-0001');
  assert.deepEqual((await entry()).endpoints, ['LRN-0002', 'LRN-0006']);
  assert.equal((await entry()).binding_removal, false);
  // Retiring one branch keeps binding knowledge through the other.
  assert.equal((await compact(root, { task: 'TASK-0002', retire: [{ id: 'LRN-0002', reason: 'Obsolete.' }] })).outcome, 'compacted');
  assert.deepEqual([(await entry()).endpoints, (await entry()).binding_removal], [['LRN-0002', 'LRN-0006'], false]);
  // Retiring the last branch removes it, and every report says so.
  const last = await compact(root, { task: 'TASK-0002', retire: [{ id: 'LRN-0006', reason: 'Obsolete.' }] });
  assert.ok(last.diagnostics.some(d => d.code === 'COMPACT_BINDING_REMOVAL' && /ends the successor chain of LRN-0001/.test(d.message)));
  assert.equal((await entry()).binding_removal, true);
  // A branch that lacks the provenance is reported on that branch only.
  const broken = await repo(t, { 'context/learnings/LRN-0001.md': branched(), 'context/learnings/LRN-0006.md': learning('LRN-0006') });
  const diagnostics = (await inspect(broken)).diagnostics;
  assert.deepEqual(diagnostics.map(d => [d.code, d.path]), [['SUCCESSION_CONTAINMENT_BROKEN', 'context/learnings/LRN-0006.md']]);
  const start = await compileStart(root, 'TASK-0001');
  assert.equal(start.envelope.entries.find(e => e.id === 'LRN-0001').role, 'history');
});

test('START: retired knowledge is history on every retirement-specific path', async t => {
  const retiredFields = { status: 'retired', retirement: { task: 'TASK-0002', reason: 'r', previous_status: 'accepted' } };
  const root = await repo(t, {
    'tasks/TASK-0005.md': artifact('task', { id: 'TASK-0005', title: 'T', status: 'active', features: ['core'], files: ['src/app.txt', 'context/learnings/LRN-0008.md'] }, '# TASK-0005\n'),
    // Reverse feature association, reverse trap file overlap, and a direct task `files` link.
    'context/learnings/LRN-0007.md': learning('LRN-0007', { ...retiredFields, tasks: [], features: ['core'] }),
    'context/traps/TRAP-0005.md': trap('TRAP-0005', { ...retiredFields, retirement: { ...retiredFields.retirement, previous_status: 'active' }, tasks: [] }),
    'context/learnings/LRN-0008.md': learning('LRN-0008', { ...retiredFields, tasks: [] }),
  });
  assert.deepEqual((await inspect(root)).diagnostics, []);
  const start = await compileStart(root, 'TASK-0005');
  assert.notEqual(start.outcome, 'failed', JSON.stringify(start.diagnostics));
  for (const id of ['LRN-0007', 'TRAP-0005', 'LRN-0008']) {
    const entry = start.envelope.entries.find(e => e.id === id);
    assert.ok(entry, `${id} is selected`);
    assert.deepEqual([entry.role, entry.tier], ['history', 3], id);
  }
  assert.ok(!start.diagnostics.some(d => d.code === 'START_AUTHORITY_UNKNOWN'));
  assert.equal(start.outcome, 'complete');
});

// --- TASK-0011 independent review remediation (round 2) ---

/** Valid portable IDs that name inherited Object.prototype members. IDs are global, so each run uses them for one type. */
const hostile = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString'];
const member = id => `LRN-01${hostile.indexOf(id)}0`;

/** Hostile IDs as task IDs (`toString` active, the rest accepted) or as feature IDs. */
async function hostileRepo(t, kind) {
  const files = {};
  const link = ids => kind === 'task' ? { tasks: ids } : { tasks: ['TASK-0001'], features: ids };
  for (const id of hostile) {
    if (kind === 'task') files[`tasks/${id}.md`] = task(id, id === 'toString' ? 'active' : 'accepted');
    else files[`features/${id}/FEATURE.md`] = artifact('feature', { feature: id, status: 'active' }, `# ${id}\n`);
    files[`context/learnings/${member(id)}.md`] = learning(member(id), { ...link([id]), evidence: [`${member(id)}: observed`] });
  }
  // One learning spans every hostile ID; its successor contains its provenance.
  files['context/learnings/LRN-0200.md'] = learning('LRN-0200', { ...link(hostile), evidence: ['LRN-0200: observed'] });
  files['context/learnings/LRN-0201.md'] = learning('LRN-0201', { ...link(hostile), evidence: ['LRN-0200: observed', 'LRN-0201: observed'] });
  // A stale candidate whose only task is an inherited-member name.
  if (kind === 'task') files['context/learnings/LRN-0202.md'] = learning('LRN-0202', { status: 'candidate', tasks: ['hasOwnProperty'] });
  const root = await repo(t, files);
  assert.deepEqual((await inspect(root)).diagnostics, []);
  return root;
}

const assertOwnGroups = (groups, label) => {
  assert.equal(Object.getPrototypeOf(groups), Object.prototype, label);
  for (const id of hostile) assert.ok(Object.hasOwn(groups, id), `${label}: ${id} is an own property`);
};

for (const kind of ['task', 'feature']) {
  const field = kind === 'task' ? 'by_task' : 'by_feature';

  test(`review R2: read-only report groups hostile-but-valid ${kind} IDs as own data`, async t => {
    const root = await hostileRepo(t, kind);
    const before = await snapshot(root);
    const first = cli(root, 'compact');
    assert.equal(first.status, 0, first.stdout);
    assert.equal(first.result.outcome, 'reported');
    assert.equal(cli(root, 'compact').stdout, first.stdout, 'reproducible');
    assert.deepEqual(await snapshot(root), before, 'read-only');
    const groups = first.result.report.binding[field];
    for (const id of hostile) assert.deepEqual(groups[id], [member(id), 'LRN-0200', 'LRN-0201'], `${kind} ${id}`);
    const fixture = kind === 'task' ? ['TASK-0001', 'TASK-0002'] : ['core'];
    assert.deepEqual(Object.keys(groups), [...fixture, ...hostile].sort(), 'sorted, with no extra keys');
    if (kind === 'task') assert.deepEqual(first.result.report.stale_candidates.map(c => c.id), ['LRN-0003', 'LRN-0202']);
    const library = (await prepareCompact(root)).report.binding[field];
    assertOwnGroups(library, kind);
    assert.deepEqual(library, groups);
  });

  test(`review R2: retirement over hostile ${kind} groups stays correct`, async t => {
    const root = await hostileRepo(t, kind);
    const authority = kind === 'task' ? 'toString' : 'TASK-0002';
    if (kind === 'task') {
      const blocked = cli(root, 'compact', '--task', 'constructor', '--retire', 'LRN-0200', '--reason', 'r');
      assert.equal(blocked.status, 1, blocked.stdout);
      assert.deepEqual(codes(blocked.result), ['COMPACT_TASK_INVALID'], 'an accepted task named constructor cannot authorize');
    }
    const result = cli(root, 'compact', '--task', authority, '--retire', 'LRN-0200', '--reason', 'Merged.', '--by', 'LRN-0201',
      '--retire', member('hasOwnProperty'), '--reason', 'Obsolete.');
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.result.outcome, 'compacted');
    assert.deepEqual((await read(root, 'context/learnings/LRN-0200.md')).metadata.retirement,
      { task: authority, reason: 'Merged.', previous_status: 'accepted' });
    const groups = result.result.report.binding[field];
    for (const id of hostile) {
      assert.deepEqual(groups[id], [...(id === 'hasOwnProperty' ? [] : [member(id)]), 'LRN-0201'], `${kind} ${id}`);
    }
    assert.deepEqual(result.result.report.binding_removals, [member('hasOwnProperty')]);
    assertOwnGroups((await prepareCompact(root)).report.binding[field], kind);
    assert.deepEqual((await inspect(root)).diagnostics, []);
    const again = cli(root, 'compact', '--task', authority, '--retire', 'LRN-0200', '--reason', 'Merged.', '--by', 'LRN-0201');
    assert.equal(again.result.outcome, 'unchanged');
  });
}
