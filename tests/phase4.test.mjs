import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { compileReview, review } from '../dist/commands/review.js';
import { compileStart } from '../dist/commands/start.js';
import { loadConfig } from '../dist/context/config.js';
import { unifiedDiff } from '../dist/review/diff.js';
import { partitionTask, classifyMetadata } from '../dist/review/task.js';
import { reviewGitEnv } from '../dist/review/git.js';
import { parseMarkdown } from '../dist/parser/frontmatter.js';
import { temporary, put, artifact, snapshot, project } from './helpers.mjs';

function git(root, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  const result = spawnSync('git', ['-c', 'init.templateDir=', '-c', 'user.name=Keystone test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-C', root, ...args], { encoding: 'utf8', windowsHide: true, env });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const taskBody = (extra = {}) => `# TASK-0001 — Example
## Objective
Change the app.
## Acceptance Criteria
${extra.criteria ?? 'The app says two.'}
## Scope
src/app.txt
## Implementation Notes
${extra.notes ?? 'Pending.'}
## Tests
${extra.tests ?? 'Pending.'}
## Review Findings
${extra.findings ?? 'Pending.'}
## Outcome
${extra.outcome ?? 'Pending.'}
${extra.tail ?? ''}`;

const task = (fields = {}, body = taskBody()) => artifact('task', { id: 'TASK-0001', title: 'Example', status: 'active', adrs: ['ADR-0001'], ...fields }, body);

async function repo(t, extra = {}, { ignoreContext = false } = {}) {
  const root = await temporary(t, false);
  git(root, 'init', '--quiet');
  const files = {
    'PROJECT.md': artifact('project', { project_id: 'p', status: 'active' }, '# P\n## Non-Negotiable Constraints\nBe careful.\n'),
    'tasks/TASK-0001.md': task(),
    'adr/ADR-0001.md': artifact('adr', { id: 'ADR-0001', title: 'A', status: 'accepted' }, '# ADR-0001\n## Decision\nDo it.\n## Constraints\nCarefully.\n'),
    'src/app.txt': 'one\n',
    ...(ignoreContext ? { '.gitignore': '/.context/*\n' } : {}),
    ...extra,
  };
  for (const [file, contents] of Object.entries(files)) await put(root, file, contents);
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'base');
  return root;
}

const read = async (root, role, task = 'TASK-0001') => JSON.parse(await readFile(path.join(root, '.context', 'review', task, `${role}.json`), 'utf8'));
const run = (root, ...args) => {
  const result = spawnSync(process.execPath, [path.join(project, 'dist/cli/index.js'), 'review', ...args, '--root', root, '--json'], {
    encoding: 'utf8', timeout: 60000, env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' },
  });
  return { ...result, result: JSON.parse(result.stdout) };
};

test('review prepares three isolated role packages; implementer claims are never objective evidence', async t => {
  const root = await repo(t);
  await put(root, 'src/app.txt', 'two\n');
  await put(root, 'tasks/TASK-0001.md', task({}, taskBody({ notes: 'CLAIM-MARKER: everything verified.' })));
  const result = run(root, 'TASK-0001');
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.result.outcome, 'complete');
  const [architecture, code, context] = await Promise.all(['architecture', 'code', 'context'].map(role => read(root, role)));
  for (const pkg of [architecture, code, context]) {
    assert.equal(pkg.kind, 'review-package');
    assert.equal(pkg.verdict, 'not-determined');
    assert.equal(pkg.authorization, 'not-established');
    assert.equal(pkg.evidence_hash, result.result.evidence_hash);
    assert.equal(pkg.requirements.source, 'base');
    assert.match(pkg.subject.find(e => e.path === 'src/app.txt').diff, /-one\n\+two/);
    assert.equal(pkg.subject.find(e => e.path === 'tasks/TASK-0001.md').diff, undefined);
  }
  for (const pkg of [architecture, code]) {
    assert.ok(!JSON.stringify(pkg).includes('CLAIM-MARKER'));
    assert.ok(pkg.withheld.some(w => w.name === 'Implementation Notes' && w.side === 'working' && /^[a-f0-9]{64}$/.test(w.hash)));
    assert.equal(pkg.under_review, undefined);
  }
  assert.match(context.under_review.label, /unverified/);
  assert.ok(context.under_review.items.some(i => i.name === 'Implementation Notes' && /CLAIM-MARKER/.test(i.content)));
  assert.equal(context.withheld, undefined);
  assert.equal(context.checks.index_freshness, 'missing');
  assert.equal(code.checks.index_freshness, undefined);
  assert.notEqual(code.charter.content, context.charter.content);
  assert.notEqual(code.package_hash, context.package_hash);
  assert.equal(code.report.path, 'reviews/TASK-0001/code-1.md');
});

test('evidence identity is deterministic and uncontaminated by review output, reports, dispositions and commits', async t => {
  const root = await repo(t);
  const base = git(root, 'rev-parse', 'HEAD');
  await put(root, 'src/app.txt', 'two\n');
  const first = run(root, 'TASK-0001', '--base', base);
  const hash = first.result.evidence_hash;
  const bytes = await readFile(path.join(root, '.context/review/TASK-0001/code.json'), 'utf8');
  // .context is not ignored here: generated packages must still stay outside the evidence.
  const again = run(root, 'TASK-0001', '--base', base);
  assert.equal(again.result.evidence_hash, hash);
  assert.deepEqual(again.result.written.map(w => w.changed), [false, false, false]);
  assert.equal(await readFile(path.join(root, '.context/review/TASK-0001/code.json'), 'utf8'), bytes);
  await compileStart(root, 'TASK-0001');
  await put(root, '.context/current-envelope.json', '{}');
  await put(root, 'reviews/TASK-0001/code-1.md', '---\nkind: keystone-review-report\n---\n## Findings\nNone.\n');
  await put(root, 'tasks/TASK-0001.md', task({ status: 'accepted', completed: '2026-10-04' }, taskBody({ findings: 'Approved by reviewers.', outcome: 'Accepted.' })));
  const after = run(root, 'TASK-0001', '--base', base);
  assert.equal(after.result.evidence_hash, hash);
  assert.equal((await read(root, 'code')).report.round, 2);
  assert.equal((await read(root, 'context')).report.round, 1);
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'TASK-0001: work and review records');
  const committed = run(root, 'TASK-0001', '--base', base);
  assert.equal(committed.result.evidence_hash, hash);
  assert.deepEqual((await read(root, 'code')).baseline.commits.map(c => c.task_id_present), [true]);
  await put(root, 'src/app.txt', 'three\n');
  assert.notEqual(run(root, 'TASK-0001', '--base', base).result.evidence_hash, hash);
});

test('requirements come from the baseline and working-tree edits are shown beside them', async t => {
  const root = await repo(t);
  await put(root, 'tasks/TASK-0001.md', task({ status: 'review', priority: 'low' }, taskBody({ criteria: 'Anything goes.' })));
  const result = await compileReview(root, 'TASK-0001', { type: 'architecture' });
  const pkg = result.packages[0];
  assert.equal(pkg.requirements.sections.find(s => s.name === 'Acceptance Criteria').content, 'The app says two.');
  assert.ok(pkg.requirements.changes.some(c => c.kind === 'section' && c.name === 'Acceptance Criteria' && c.working === 'Anything goes.'));
  assert.ok(pkg.requirements.changes.some(c => c.kind === 'field' && c.name === 'priority'));
  assert.deepEqual(pkg.lifecycle, { base: { status: 'active' }, working: { status: 'review' } });
  assert.ok(result.diagnostics.some(d => d.code === 'REVIEW_REQUIREMENTS_CHANGED'));
  assert.equal(result.installed, false);
});

test('a task introduced by the work defines its requirements without becoming base authority', async t => {
  const root = await repo(t);
  await put(root, 'adr/ADR-0009.md', artifact('adr', { id: 'ADR-0009', title: 'New', status: 'accepted' }, '# New\n## Decision\nX.\n## Constraints\nY.\n'));
  await put(root, 'tasks/TASK-0002.md', artifact('task', { id: 'TASK-0002', title: 'New', status: 'active', adrs: ['ADR-0001', 'ADR-0009'] },
    taskBody().replace('TASK-0001', 'TASK-0002')));
  const result = await compileReview(root, 'TASK-0002', { type: 'code' });
  const pkg = result.packages[0];
  assert.equal(pkg.requirements.source, 'working');
  assert.ok(result.diagnostics.some(d => d.code === 'REVIEW_TASK_INTRODUCED_IN_SUBJECT'));
  assert.ok(pkg.context.gaps.some(g => g.code === 'REVIEW_BASE_LINK_UNRESOLVED' && g.field === 'adrs'));
  assert.equal(result.outcome, 'incomplete/conflicted');
  assert.ok(pkg.context.entries.some(e => e.id === 'ADR-0001' && e.role === 'binding'));
  assert.ok(!pkg.context.entries.some(e => e.id === 'ADR-0009' || e.id === 'TASK-0002'));
});

test('review records are ineligible for START and review context through every path', async t => {
  const root = await repo(t, { 'reviews/TASK-0001/code-1.md': '# report\n' });
  await put(root, 'tasks/TASK-0001.md', task({ files: ['reviews/TASK-0001/code-1.md', 'src/app.txt'] }));
  const startResult = await compileStart(root, 'TASK-0001');
  assert.equal(startResult.outcome, 'complete');
  assert.ok(startResult.diagnostics.some(d => d.code === 'START_REVIEW_RECORD_INELIGIBLE'));
  assert.ok(startResult.envelope.omissions.some(o => o.path === 'reviews/TASK-0001/code-1.md' && o.reason === 'review-record-ineligible'));
  assert.ok(!startResult.envelope.entries.some(e => e.path.startsWith('reviews/')));
  // Typed-looking content under reviews/ is never discovered.
  await put(root, 'reviews/tasks/TASK-0009.md', artifact('task', { id: 'TASK-0009', title: 'x', status: 'active' }));
  await put(root, '.context/config.yaml', 'schema_version: 1\nsources: [PROJECT.md, tasks, adr]\n');
  assert.equal((await compileStart(root, 'TASK-0001')).outcome, 'complete');
  for (const source of ['reviews', 'Reviews/TASK-0001']) {
    await put(root, '.context/config.yaml', `schema_version: 1\nsources: [PROJECT.md, tasks, ${source}]\n`);
    await assert.rejects(loadConfig(root), error => error.diagnostic.code === 'CONFIG_INVALID');
  }
  await rm(path.join(root, '.context'), { recursive: true });
  // Ordinary path validation runs first: a missing review record keeps its normal diagnostic.
  await put(root, 'tasks/TASK-0001.md', task({ files: ['reviews/TASK-0001/missing.md'] }));
  const missing = await compileStart(root, 'TASK-0001');
  assert.equal(missing.outcome, 'failed');
  assert.equal(missing.diagnostics[0].code, 'FILE_MISSING');
  // Review mode applies the same refusal to base links.
  await put(root, 'tasks/TASK-0001.md', task({ files: ['reviews/TASK-0001/code-1.md'] }));
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'link report');
  const reviewed = await compileReview(root, 'TASK-0001', { type: 'context' });
  assert.ok(reviewed.packages[0].omissions.some(o => o.reason === 'review-record-ineligible'));
  assert.ok(!reviewed.packages[0].context.entries.some(e => e.path.startsWith('reviews/')));
});

test('structural failures install nothing and keep earlier packages', async t => {
  const root = await repo(t);
  await put(root, 'src/app.txt', 'two\n');
  assert.equal(run(root, 'TASK-0001').status, 0);
  const before = await snapshot(root, '.context/review');
  const expect = (args, code) => {
    const result = run(root, ...args);
    assert.equal(result.status, 2, result.stdout);
    assert.equal(result.result.outcome, 'failed');
    assert.equal(result.result.installed, false);
    assert.ok(result.result.diagnostics.some(d => d.code === code), `${code}: ${result.stdout}`);
  };
  expect(['TASK-0404'], 'REVIEW_TASK_NOT_FOUND');
  expect(['TASK-0001', '--base', 'no-such-rev'], 'REVIEW_BASE_INVALID');
  git(root, 'commit', '--quiet', '--allow-empty', '-m', 'later');
  const later = git(root, 'rev-parse', 'HEAD');
  git(root, 'reset', '--quiet', '--hard', 'HEAD~1');
  await put(root, 'src/app.txt', 'two\n');
  expect(['TASK-0001', '--base', later], 'REVIEW_BASE_NOT_ANCESTOR');
  const gitDir = path.join(root, '.git');
  await writeFile(path.join(gitDir, 'MERGE_HEAD'), `${later}\n`);
  expect(['TASK-0001'], 'REVIEW_OPERATION_IN_PROGRESS');
  await rm(path.join(gitDir, 'MERGE_HEAD'));
  await put(root, 'tasks/TASK-0001.md', task({}, taskBody({ tail: '# Second title\n' })));
  expect(['TASK-0001'], 'REVIEW_TASK_SECTIONS_UNPARSEABLE');
  await put(root, 'tasks/TASK-0001.md', task());
  await put(root, 'tasks/copy.md', task());
  expect(['TASK-0001'], 'REVIEW_ROOT_AMBIGUOUS');
  await rm(path.join(root, 'tasks/copy.md'));
  assert.equal(run(path.join(root, 'src'), 'TASK-0001').result.diagnostics[0].code, 'REVIEW_ROOT_INVALID');
  assert.deepEqual(await snapshot(root, '.context/review'), before);
});

test('governing context that cannot be identified fails; unrelated base problems are incomplete', async t => {
  const malformed = await repo(t, { 'adr/ADR-0002.md': '---\nbad: [\n---\n# Broken\n' });
  await put(malformed, 'tasks/TASK-0001.md', task({ adrs: ['ADR-0002'] }));
  git(malformed, 'add', '-A');
  git(malformed, 'commit', '--quiet', '-m', 'link broken ADR');
  assert.equal((await compileReview(malformed, 'TASK-0001')).diagnostics[0].code, 'REVIEW_BINDING_UNIDENTIFIABLE');
  const twoProjects = await repo(t, { 'context/other.md': artifact('project', { project_id: 'q', status: 'active' }) });
  assert.equal((await compileReview(twoProjects, 'TASK-0001')).diagnostics[0].code, 'REVIEW_PROJECT_AMBIGUOUS');
  const unrelated = await repo(t, { 'adr/ADR-0005.md': artifact('adr', { id: 'ADR-0005', title: 'U', status: 'accepted', rules: ['MISSING'] }) });
  await put(unrelated, 'src/app.txt', 'two\n');
  const result = await compileReview(unrelated, 'TASK-0001');
  assert.equal(result.outcome, 'incomplete/conflicted');
  assert.ok(result.diagnostics.some(d => d.code === 'REVIEW_BASE_STRUCTURE_GAPS'));
  assert.ok(result.packages[0].context.base_diagnostics.some(d => d.code === 'LINK_MISSING'));
});

test('review never modifies project files or Git state', async t => {
  const root = await repo(t, {}, { ignoreContext: true });
  await put(root, 'src/app.txt', 'two\n');
  await put(root, 'notes.txt', 'untracked\n');
  const outside = async () => Object.fromEntries(Object.entries(await snapshot(root)).filter(([file]) => !file.startsWith('.context/')));
  const before = await outside();
  assert.equal(run(root, 'TASK-0001').status, 0);
  assert.deepEqual(await outside(), before);
  const generated = Object.keys(await snapshot(root, '.context'));
  assert.ok(generated.every(file => file.startsWith('.context/review/TASK-0001/') && file.endsWith('.json')), generated.join());
});

test('inherited Git tracing cannot write files and is removed from the review environment', async t => {
  const root = await repo(t);
  const trace = path.join(root, '..', `${path.basename(root)}-trace2.log`);
  const legacy = path.join(root, '..', `${path.basename(root)}-trace.log`);
  t.after(() => Promise.all([rm(trace, { force: true }), rm(legacy, { force: true })]));
  const result = spawnSync(process.execPath, [path.join(project, 'dist/cli/index.js'), 'review', 'TASK-0001', '--root', root, '--json'], {
    encoding: 'utf8', env: { ...process.env, GIT_TRACE2: trace, GIT_TRACE: legacy, GIT_TRACE2_EVENT: trace, GIT_DIR: path.join(root, 'nowhere') },
  });
  assert.equal(JSON.parse(result.stdout).outcome, 'incomplete/conflicted');
  await assert.rejects(access(trace));
  await assert.rejects(access(legacy));
  const env = reviewGitEnv({ GIT_DIR: 'x', git_trace2: 'y', GIT_CONFIG_COUNT: '1', PATH: 'p' });
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.git_trace2, undefined);
  assert.equal(env.GIT_TRACE2, '0');
  assert.equal(env.GIT_NO_LAZY_FETCH, '1');
  assert.equal(env.GIT_NO_REPLACE_OBJECTS, '1');
  assert.equal(env.GIT_CONFIG_COUNT, '1');
  assert.equal(env.PATH, 'p');
});

test('unrepresentable content and ignored or generated changes are handled explicitly', async t => {
  const root = await repo(t, { '.gitignore': 'build/\n' });
  await put(root, 'image.bin', Buffer.from([0, 1, 2, 3]));
  await put(root, 'build/out.txt', 'ignored\n');
  await put(root, 'context/STATE.md', '# generated\n');
  const result = await compileReview(root, 'TASK-0001', { type: 'code' });
  const pkg = result.packages[0];
  const binary = pkg.subject.find(e => e.path === 'image.bin');
  assert.equal(binary.kind, 'non-text');
  assert.equal(binary.diff, undefined);
  assert.match(binary.working.hash, /^[a-f0-9]{64}$/);
  assert.equal(result.outcome, 'incomplete/conflicted');
  assert.ok(result.diagnostics.some(d => d.code === 'REVIEW_CONTENT_UNREPRESENTED' && d.path === 'image.bin'));
  assert.ok(!pkg.subject.some(e => e.path.startsWith('build/') || e.path === 'context/STATE.md'));
});

test('an empty subject leaves code review incomplete while other roles are complete', async t => {
  const root = await repo(t);
  const result = await compileReview(root, 'TASK-0001');
  const outcome = Object.fromEntries(result.packages.map(p => [p.role, p.outcome]));
  assert.deepEqual(outcome, { architecture: 'complete', code: 'incomplete/conflicted', context: 'complete' });
  assert.ok(result.packages.find(p => p.role === 'code').diagnostics.some(d => d.code === 'REVIEW_SUBJECT_EMPTY'));
});

test('base project charters replace defaults; placeholders and working-tree edits do not', async t => {
  const root = await repo(t, {
    'agents/code-reviewer.md': '# code-reviewer\nPROJECT CODE CHARTER.\n',
    'agents/architecture-reviewer.md': '# architecture-reviewer\n',
  });
  await put(root, 'agents/code-reviewer.md', '# code-reviewer\nREWRITTEN BY THE WORK.\n');
  const result = await compileReview(root, 'TASK-0001');
  const charter = role => result.packages.find(p => p.role === role).charter;
  assert.equal(charter('code').provenance, 'base:agents/code-reviewer.md');
  assert.match(charter('code').content, /PROJECT CODE CHARTER/);
  assert.equal(charter('architecture').provenance, 'default:templates/agents/architecture-reviewer.md');
  assert.equal(charter('context').provenance, 'default:templates/agents/context-reviewer.md');
  const changed = result.packages[0].subject.find(e => e.path === 'agents/code-reviewer.md');
  assert.ok(changed.classes.includes('keystone-managed'));
});

test('unrecognised task content and extension fields are withheld, reported and incomplete', async t => {
  const root = await repo(t);
  await put(root, 'tasks/TASK-0001.md', task({ verified: true }, taskBody({ tail: '## Notes\nSIDE-NOTE\n' })));
  const result = await compileReview(root, 'TASK-0001');
  assert.equal(result.outcome, 'incomplete/conflicted');
  const code = result.packages.find(p => p.role === 'code');
  const context = result.packages.find(p => p.role === 'context');
  assert.ok(code.withheld.some(w => w.name === 'Notes' && w.class === 'unrecognised'));
  assert.ok(code.withheld.some(w => w.kind === 'field' && w.name === 'verified'));
  assert.ok(!JSON.stringify(code).includes('SIDE-NOTE'));
  assert.ok(context.under_review.items.some(i => i.name === 'Notes' && i.content === 'SIDE-NOTE'));
});

test('commit flags read full messages without exposing message text', async t => {
  const root = await repo(t);
  const base = git(root, 'rev-parse', 'HEAD');
  await put(root, 'src/app.txt', 'two\n');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'feat: subject without id', '-m', 'TASK-0001; ADR-0001. SECRET-BODY.');
  const pkg = (await compileReview(root, 'TASK-0001', { type: 'code', base })).packages[0];
  assert.deepEqual(pkg.baseline.commits.map(c => [c.task_id_present, c.adr_ids]), [[true, ['ADR-0001']]]);
  assert.ok(!JSON.stringify(pkg).includes('SECRET-BODY'));
  // The subject is baseline-to-working-tree, so committed work remains under review.
  assert.deepEqual(pkg.subject.map(e => e.path), ['src/app.txt']);
});

test('task partition and diff mechanics', () => {
  const ok = partitionTask('# Title\n## Objective\nGoal\n### Detail\nMore\n```\n# not a heading\n```\n## Tests\nRan\n## Tests\nAgain\n');
  assert.equal(ok.unsafe, undefined);
  assert.match(ok.requirements[0].content, /### Detail[\s\S]*# not a heading/);
  assert.equal(ok.claims.length, 2);
  assert.match(partitionTask('# A\n## Objective\nx\n# B\n').unsafe, /level-1/);
  assert.match(partitionTask('## Objective\nx\n## Objective\ny\n').unsafe, /duplicate/);
  assert.match(partitionTask('## Objective\nText\n---\n').unsafe, /setext/);
  assert.match(partitionTask('## Objective\n```\nopen\n').unsafe, /fence/);
  assert.equal(partitionTask('# T\nPreface\n## Objective\nx\n').unrecognised[0].name, '(preamble)');
  const classes = classifyMetadata(parseMarkdown(task({ verified: 1 }), 't').metadata);
  assert.deepEqual(Object.keys(classes.unrecognised), ['verified']);
  assert.deepEqual(Object.keys(classes.lifecycle), ['status']);
  assert.equal(unifiedDiff('a\nb\nc\n', 'a\nB\nc\n'), '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n');
  assert.equal(unifiedDiff('', 'x\n'), '@@ -0,0 +1,1 @@\n+x\n');
  assert.equal(unifiedDiff('same\n', 'same\n'), '');
  const big = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n');
  assert.equal(unifiedDiff(big, big.replace('line 1500', 'changed')).split('\n').filter(l => /^[-+]/.test(l)).length, 2);
});

test('review report template satisfies the report contract and is never discovered', async () => {
  const schema = JSON.parse(await readFile(path.join(project, 'schemas/review-report.schema.json'), 'utf8'));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const template = parseMarkdown(await readFile(path.join(project, 'templates/review.md'), 'utf8'), 'templates/review.md');
  assert.ok(validate(template.metadata), JSON.stringify(validate.errors));
  for (const section of ['## Findings', '## Evidence Examined', '## Limitations']) assert.ok(template.body.includes(section));
  assert.equal(validate({ ...template.metadata, context_type: 'task' }), false);
  assert.equal(validate({ ...template.metadata, verdict: 'approved' }), false);
});

test('review CLI usage errors are explicit', async t => {
  const root = await temporary(t, false);
  for (const args of [['review'], ['review', 'TASK-1', '--type', 'everything'], ['start', 'TASK-1', '--base', 'HEAD'], ['validate', '--type', 'code']]) {
    const result = spawnSync(process.execPath, [path.join(project, 'dist/cli/index.js'), ...args, '--root', root, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'CLI_USAGE');
  }
  assert.equal((await review(root, 'TASK-0001')).diagnostics[0].code, 'REVIEW_ROOT_INVALID');
});

test('regression: invalid UTF-8 mandatory governing context fails instead of being decoded', async t => {
  const invalid = Buffer.concat([Buffer.from('# Global\nAlways '), Buffer.from([0xff, 0xfe]), Buffer.from(' obey.\n')]);
  const root = await repo(t, { 'rules/GLOBAL.md': invalid });
  await put(root, 'src/app.txt', 'two\n');
  const result = run(root, 'TASK-0001');
  assert.equal(result.status, 2, result.stdout);
  assert.equal(result.result.outcome, 'failed');
  assert.equal(result.result.diagnostics[0].code, 'REVIEW_CONTEXT_UNREADABLE');
  assert.equal(result.result.diagnostics[0].path, 'rules/GLOBAL.md');
  assert.equal(result.result.installed, false);
});

test('regression: a malformed competing task candidate blocks root identity even with a valid root', async t => {
  const root = await repo(t, { 'tasks/TASK-0001-copy.md': '---\nid: TASK-0001\ntitle: [unclosed\n---\n# Copy\n' });
  await put(root, 'src/app.txt', 'two\n');
  const base = await compileReview(root, 'TASK-0001');
  assert.equal(base.outcome, 'failed');
  assert.equal(base.diagnostics[0].code, 'REVIEW_ROOT_AMBIGUOUS');
  assert.equal(base.diagnostics[0].path, 'tasks/TASK-0001-copy.md');
  // The same applies to a malformed candidate in the working tree.
  const working = await repo(t);
  await put(working, 'tasks/TASK-0001-draft.md', Buffer.concat([Buffer.from('---\nid: TASK-0001\n'), Buffer.from([0xff]), Buffer.from('\n---\n')]));
  assert.equal((await compileReview(working, 'TASK-0001')).diagnostics[0].code, 'REVIEW_ROOT_AMBIGUOUS');
  // A malformed candidate whose readable ID differs is ruled out; review proceeds.
  const other = await repo(t, { 'tasks/TASK-0099.md': '---\ncontext_type: task\nschema_version: 1\nid: TASK-0099\nstatus: active\n---\n' });
  await put(other, 'src/app.txt', 'two\n');
  const proceeded = await compileReview(other, 'TASK-0001');
  assert.equal(proceeded.outcome, 'incomplete/conflicted');
  assert.ok(proceeded.diagnostics.some(d => d.code === 'REVIEW_BASE_STRUCTURE_GAPS'));
});
