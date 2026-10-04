import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { close, prepareClose } from '../dist/commands/close.js';
import { compileReview } from '../dist/commands/review.js';
import { compileStart } from '../dist/commands/start.js';
import { parseMarkdown } from '../dist/parser/frontmatter.js';
import { temporary, put, artifact, snapshot, project } from './helpers.mjs';

function git(root, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  const result = spawnSync('git', ['-c', 'init.templateDir=', '-c', 'user.name=Keystone test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-C', root, ...args], { encoding: 'utf8', windowsHide: true, env });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const body = `# TASK-0001 — Example
## Objective
Change the app.
## Acceptance Criteria
The app says two.
## Implementation Notes
Done.
## Review Findings
Pending.
## Outcome
Pending.
`;
const learning = (id, fields = {}) => artifact('learning', { id, status: 'candidate', tasks: ['TASK-0001'], evidence: ['TASK-0001: observed while changing the app'], ...fields },
  `# ${id}\n## Observation\nReusable.\n## Evidence\nSee task.\n## Why It Matters\nAvoids rework.\n## Proposed Promotion\nAccept.\n`);
const trap = (id, fields = {}) => artifact('trap', { id, status: 'proposed', severity: 'medium', tasks: ['TASK-0001'], evidence: ['TASK-0001: hit during work'], ...fields },
  `# ${id}\n## Failure Mode\nX.\n## Avoidance\nY.\n`);

/** Base commit without candidates; the working tree adds the work and its candidate knowledge. */
async function repo(t, { base = {}, work = {} } = {}) {
  const root = await temporary(t, false);
  git(root, 'init', '--quiet');
  const files = {
    '.gitignore': '/.context/*\n',
    'PROJECT.md': artifact('project', { project_id: 'p', status: 'active' }, '# P\n'),
    'tasks/TASK-0001.md': artifact('task', { id: 'TASK-0001', title: 'Example', status: 'review', adrs: ['ADR-0001'] }, body),
    'adr/ADR-0001.md': artifact('adr', { id: 'ADR-0001', title: 'A', status: 'accepted' }, '# A\n## Decision\nD.\n## Constraints\nC.\n'),
    'src/app.txt': 'one\n',
    ...base,
  };
  for (const [file, contents] of Object.entries(files)) await put(root, file, contents);
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'base');
  for (const [file, contents] of Object.entries({
    'src/app.txt': 'two\n',
    'context/learnings/LRN-0001.md': learning('LRN-0001'),
    'context/learnings/LRN-0002.md': learning('LRN-0002'),
    'context/traps/TRAP-0001.md': trap('TRAP-0001'),
    ...work,
  })) await put(root, file, contents);
  return root;
}

async function evidence(root) {
  const result = await compileReview(root, 'TASK-0001', { type: 'context' });
  assert.notEqual(result.outcome, 'failed', JSON.stringify(result.diagnostics));
  return { hash: result.evidence_hash, base: result.packages[0].baseline.base };
}

async function report(root, role, verdict, { round = 1, hash, base, file, findings = 'No blocking issues.', extra = '## Evidence Examined\nThe package.\n', meta = {} } = {}) {
  const front = { kind: 'keystone-review-report', schema_version: 1, task: 'TASK-0001', role, round, verdict, evidence_hash: hash, base, reviewer: 'Independent test reviewer', ...meta };
  await put(root, file ?? `reviews/TASK-0001/${role}-${round}.md`, `---\n${JSON.stringify(front)}\n---\n# Review\n## Findings\n${findings}\n${extra}`);
}

async function approveAll(root, verdicts = {}) {
  const current = await evidence(root);
  for (const role of ['architecture', 'code', 'context']) await report(root, role, verdicts[role] ?? 'approve', current);
  return current;
}

const meta = async (root, file) => parseMarkdown(await readFile(path.join(root, file), 'utf8'), file).metadata;
const outside = async root => Object.fromEntries(Object.entries(await snapshot(root)).filter(([file]) => !file.startsWith('.context/') && !file.startsWith('.git/')));
const cli = (root, ...args) => {
  const result = spawnSync(process.execPath, [path.join(project, 'dist/cli/index.js'), 'close', ...args, '--root', root, '--json'], {
    encoding: 'utf8', timeout: 60000, env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' },
  });
  return { ...result, result: result.stdout ? JSON.parse(result.stdout) : null };
};

test('closes after a current three-role approve gate, promotes only requested candidates and records closure', async t => {
  const root = await repo(t);
  const current = await approveAll(root);
  const reports = await snapshot(root, 'reviews');
  const untouched = await readFile(path.join(root, 'context/learnings/LRN-0002.md'), 'utf8');
  const result = cli(root, 'TASK-0001', '--promote', 'LRN-0001', '--promote', 'TRAP-0001');
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.result.outcome, 'closed');
  assert.ok(result.result.diagnostics.some(d => d.code === 'CLOSE_INDEX_UPDATE_REQUIRED'));
  const task = await meta(root, 'tasks/TASK-0001.md');
  assert.equal(task.status, 'accepted');
  assert.match(task.completed, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(task.closure.gate, 'satisfied');
  assert.deepEqual(task.closure.reviews.map(r => [r.role, r.state, r.verdict, r.evidence_hash, r.base]),
    ['architecture', 'code', 'context'].map(role => [role, 'current', 'approve', current.hash, current.base]));
  assert.deepEqual(task.closure.promoted, ['LRN-0001', 'TRAP-0001']);
  assert.deepEqual(task.closure.unpromoted, ['LRN-0002']);
  assert.equal(task.closure.override_reason, undefined);
  const promoted = await meta(root, 'context/learnings/LRN-0001.md');
  assert.equal(promoted.status, 'accepted');
  assert.deepEqual(promoted.evidence, ['TASK-0001: observed while changing the app', `close:TASK-0001 context-review:reviews/TASK-0001/context-1.md@${current.hash}`]);
  assert.equal((await meta(root, 'context/traps/TRAP-0001.md')).status, 'active');
  assert.equal(await readFile(path.join(root, 'context/learnings/LRN-0002.md'), 'utf8'), untouched);
  assert.deepEqual(await snapshot(root, 'reviews'), reports);
  await assert.rejects(readFile(path.join(root, 'TASKS.md')));
  // Promoted knowledge now participates in START as accepted learning; candidates do not.
  const start = await compileStart(root, 'TASK-0001');
  assert.equal(start.outcome, 'complete');
  assert.ok(start.envelope.entries.some(e => e.id === 'LRN-0001' && e.role === 'supporting'));
  assert.ok(!start.envelope.entries.some(e => e.id === 'LRN-0002'));
});

test('closing without promotion keeps recorded evidence current; re-running is already-closed and writes nothing', async t => {
  const root = await repo(t);
  const current = await approveAll(root);
  assert.equal((await close(root, 'TASK-0001')).outcome, 'closed');
  // The closure record is lifecycle information: it cannot invalidate the evidence it records.
  assert.equal((await evidence(root)).hash, current.hash);
  const before = await outside(root);
  const again = cli(root, 'TASK-0001');
  assert.equal(again.status, 0);
  assert.equal(again.result.outcome, 'already-closed');
  for (const args of [['--promote', 'LRN-0001'], ['--override', 'late override']]) {
    const refused = cli(root, 'TASK-0001', ...args);
    assert.equal(refused.status, 1);
    assert.equal(refused.result.outcome, 'blocked');
    assert.equal(refused.result.diagnostics[0].code, 'CLOSE_ALREADY_CLOSED_REQUEST_REFUSED');
  }
  assert.deepEqual(await outside(root), before);
});

test('an unsatisfied review gate blocks CLOSE without writing', async t => {
  const cases = {
    'missing report': async root => { const c = await evidence(root); await report(root, 'architecture', 'approve', c); await report(root, 'code', 'approve', c); },
    'stale evidence': async root => { await approveAll(root); await put(root, 'src/app.txt', 'three\n'); },
    'changes-requested': async root => approveAll(root, { code: 'changes-requested' }),
    'inconclusive': async root => { const c = await approveAll(root); await report(root, 'context', 'inconclusive', { ...c, extra: '## Evidence Examined\nX.\n## Limitations\nNo access.\n' }); },
    'wrong task': async root => { const c = await approveAll(root); await report(root, 'code', 'approve', { ...c, meta: { task: 'TASK-0002' } }); },
    'round mismatch': async root => { const c = await approveAll(root); await report(root, 'code', 'approve', { ...c, round: 1, file: 'reviews/TASK-0001/code-2.md' }); },
    'schema violation': async root => { const c = await approveAll(root); await report(root, 'code', 'approved', c); },
    'missing evidence examined': async root => { const c = await approveAll(root); await report(root, 'code', 'approve', { ...c, extra: '' }); },
    'blank findings for changes-requested': async root => { const c = await approveAll(root); await report(root, 'code', 'changes-requested', { ...c, findings: '' }); },
    'inconclusive without limitations': async root => { const c = await approveAll(root); await report(root, 'code', 'inconclusive', c); },
    'invalid latest round': async root => { const c = await approveAll(root); await put(root, 'reviews/TASK-0001/code-2.md', '# not a report\n'); },
  };
  for (const [name, arrange] of Object.entries(cases)) {
    const root = await repo(t);
    await arrange(root);
    const before = await outside(root);
    const result = cli(root, 'TASK-0001');
    assert.equal(result.status, 1, `${name}: ${result.stdout}`);
    assert.equal(result.result.outcome, 'blocked', name);
    assert.equal(result.result.gate, 'unsatisfied', name);
    assert.ok(result.result.diagnostics.some(d => d.code === 'CLOSE_GATE_UNSATISFIED'), name);
    assert.deepEqual(await outside(root), before, name);
  }
});

test('an owner override closes with a recorded reason, preserves actual verdicts and never enables promotion', async t => {
  const root = await repo(t);
  const current = await approveAll(root, { code: 'changes-requested' });
  const reports = await snapshot(root, 'reviews');
  const blockedPromotion = cli(root, 'TASK-0001', '--override', 'Owner accepts the known risk', '--promote', 'LRN-0001');
  assert.equal(blockedPromotion.status, 1);
  assert.ok(blockedPromotion.result.diagnostics.some(d => d.code === 'CLOSE_PROMOTION_REQUIRES_APPROVED_REVIEW'));
  assert.equal((await meta(root, 'tasks/TASK-0001.md')).closure, undefined);
  const blank = cli(root, 'TASK-0001', '--override', '   ');
  assert.equal(blank.status, 2);
  assert.equal(blank.result.diagnostics[0].code, 'CLI_USAGE');
  const result = cli(root, 'TASK-0001', '--override', 'Owner accepts the known risk');
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.result.gate, 'overridden');
  const task = await meta(root, 'tasks/TASK-0001.md');
  assert.equal(task.closure.gate, 'overridden');
  assert.equal(task.closure.override_reason, 'Owner accepts the known risk');
  assert.deepEqual(task.closure.reviews.find(r => r.role === 'code'), { role: 'code', report: 'reviews/TASK-0001/code-1.md', round: 1, verdict: 'changes-requested', evidence_hash: current.hash, base: current.base, state: 'current' });
  assert.deepEqual(task.closure.promoted, []);
  assert.deepEqual(task.closure.unpromoted, ['LRN-0001', 'LRN-0002', 'TRAP-0001']);
  assert.equal((await meta(root, 'context/learnings/LRN-0001.md')).status, 'candidate');
  assert.deepEqual(await snapshot(root, 'reviews'), reports);
  const satisfied = await repo(t);
  await approveAll(satisfied);
  const unused = await close(satisfied, 'TASK-0001', { override: 'Not needed' });
  assert.equal(unused.gate, 'satisfied');
  assert.ok(unused.diagnostics.some(d => d.code === 'CLOSE_OVERRIDE_NOT_REQUIRED'));
  assert.equal((await meta(satisfied, 'tasks/TASK-0001.md')).closure.override_reason, undefined);
});

test('promotion is explicit, checked and all-or-nothing', async t => {
  const root = await repo(t, {
    base: { 'context/learnings/LRN-0006.md': learning('LRN-0006') },
    work: {
      'context/learnings/LRN-0003.md': learning('LRN-0003', { status: 'accepted' }),
      'context/learnings/LRN-0004.md': learning('LRN-0004', { tasks: [] }),
      'context/learnings/LRN-0005.md': learning('LRN-0005', { evidence: [] }),
      'context/traps/TRAP-0002.md': trap('TRAP-0002', { severity: 'high' }),
    },
  });
  await approveAll(root);
  const before = await outside(root);
  for (const [id, reason] of [['LRN-0404', /no such artifact/], ['ADR-0001', /never promoted/], ['LRN-0003', /not a candidate/],
    ['LRN-0004', /not a candidate/], ['LRN-0005', /evidence is empty/], ['TRAP-0002', /medium/], ['LRN-0006', /subject of the current approved context review/]]) {
    const result = await prepareClose(root, 'TASK-0001', { promote: ['LRN-0001', id] });
    assert.equal(result.outcome, 'blocked', id);
    const diagnostic = result.diagnostics.find(d => d.code === 'CLOSE_PROMOTION_INVALID');
    assert.match(diagnostic.message, reason, id);
    assert.equal(cli(root, 'TASK-0001', '--promote', 'LRN-0001', '--promote', id).status, 1, id);
    assert.deepEqual(await outside(root), before, id);
  }
  // Reviewer approval alone never promotes anything.
  assert.deepEqual((await close(root, 'TASK-0001')).promoted, []);
  assert.equal((await meta(root, 'context/learnings/LRN-0001.md')).status, 'candidate');
});

test('structural, input and evidence failures fail without writing', async t => {
  const root = await repo(t);
  await approveAll(root);
  const before = await outside(root);
  const unknown = cli(root, 'TASK-0404');
  assert.equal(unknown.status, 2);
  assert.equal(unknown.result.diagnostics[0].code, 'CLOSE_TASK_NOT_FOUND');
  await put(root, 'adr/ADR-0002.md', '---\nbad: [\n---\n');
  const invalid = cli(root, 'TASK-0001');
  assert.equal(invalid.status, 2);
  assert.ok(invalid.result.diagnostics.some(d => d.code === 'CLOSE_VALIDATION_FAILED'));
  await rm(path.join(root, 'adr/ADR-0002.md'));
  await writeFile(path.join(root, '.git', 'MERGE_HEAD'), `${git(root, 'rev-parse', 'HEAD')}\n`);
  const evidenceFailure = cli(root, 'TASK-0001');
  assert.equal(evidenceFailure.status, 2);
  assert.ok(evidenceFailure.result.diagnostics.some(d => d.code === 'CLOSE_EVIDENCE_UNAVAILABLE'));
  await rm(path.join(root, '.git', 'MERGE_HEAD'));
  assert.deepEqual(await outside(root), before);
});

test('a write failure restores every original file and leaves no temporary files', async t => {
  const root = await repo(t);
  await approveAll(root);
  const before = await outside(root);
  let calls = 0;
  const realRename = fs.rename;
  t.mock.method(fs, 'rename', async (...args) => {
    if (++calls === 2) throw new Error('Injected rename failure');
    return realRename(...args);
  });
  syncBuiltinESMExports();
  let result;
  try { result = await close(root, 'TASK-0001', { promote: ['LRN-0001'] }); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(result.outcome, 'failed');
  assert.ok(result.diagnostics.some(d => d.code === 'CLOSE_WRITE_FAILED'));
  assert.deepEqual(await outside(root), before);
});

test('close CLI usage errors are explicit', async t => {
  const root = await temporary(t, false);
  for (const args of [['close'], ['close', 'TASK-1', '--override'], ['review', 'TASK-1', '--promote', 'LRN-1'], ['validate', '--override', 'x']]) {
    const result = spawnSync(process.execPath, [path.join(project, 'dist/cli/index.js'), ...args, '--root', root, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'CLI_USAGE', args.join(' '));
  }
});

test('regression: headings inside a four-backtick fence never satisfy the report contract', async t => {
  const root = await repo(t);
  const current = await approveAll(root);
  // A three-backtick line inside a four-backtick fence does not close it.
  await report(root, 'code', 'approve', { ...current, findings: 'See below.', extra: '' });
  const front = { kind: 'keystone-review-report', schema_version: 1, task: 'TASK-0001', role: 'code', round: 1, verdict: 'approve', evidence_hash: current.hash, base: current.base, reviewer: 'r' };
  await put(root, 'reviews/TASK-0001/code-1.md', `---\n${JSON.stringify(front)}\n---\n# Review\n\`\`\`\`markdown\n\`\`\`\n## Findings\nNone.\n## Evidence Examined\nPackage.\n\`\`\`\`\n`);
  const before = await outside(root);
  const result = cli(root, 'TASK-0001');
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.result.outcome, 'blocked');
  assert.deepEqual(result.result.reviews.find(r => r.role === 'code').state, 'invalid');
  assert.ok(result.result.diagnostics.some(d => d.code === 'CLOSE_GATE_UNSATISFIED' && /Findings or Evidence Examined section is missing/.test(d.message)));
  assert.deepEqual(await outside(root), before);
});

test('regression: a partially written temporary file is removed and originals are unchanged', async t => {
  const root = await repo(t);
  await approveAll(root);
  const before = await outside(root);
  const realWriteFile = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (file, contents, options) => {
    if (String(file).includes('.close-') && String(file).endsWith('.tmp')) {
      await realWriteFile(file, String(contents).slice(0, 10), options);
      throw new Error('Injected partial write failure');
    }
    return realWriteFile(file, contents, options);
  });
  syncBuiltinESMExports();
  let result;
  try { result = await close(root, 'TASK-0001', { promote: ['LRN-0001'] }); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(result.outcome, 'failed');
  assert.ok(result.diagnostics.some(d => d.code === 'CLOSE_WRITE_FAILED'));
  const after = await outside(root);
  assert.deepEqual(after, before);
  assert.ok(!Object.keys(after).some(file => /\.close-.*\.tmp$/.test(file)));
});
