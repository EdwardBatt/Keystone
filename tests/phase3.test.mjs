import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { compileStart, start } from '../dist/commands/start.js';
import { excerpt, estimate } from '../dist/context/envelope.js';
import { serialize } from '../dist/core.js';
import { temporary, put, artifact, snapshot, cli } from './helpers.mjs';

async function doc(root, type, id, fields = {}, body = `# ${id}\nBody for ${id}.\n`) {
  const location = type === 'project' ? 'PROJECT.md' : type === 'feature' ? `features/${id}/FEATURE.md` :
    `${({ task: 'tasks', adr: 'adr', rule: 'rules', skill: 'skills', learning: 'context', trap: 'context' })[type]}/${id}.md`;
  await put(root, location, artifact(type, {
    ...(type === 'project' ? { project_id: id } : type === 'feature' ? { feature: id } : { id }),
    title: id, status: ['adr', 'learning'].includes(type) ? 'accepted' : 'active', ...fields,
  }, body));
  return location;
}
async function setup(t, fields = {}) {
  const root = await temporary(t, false);
  await doc(root, 'project', 'P');
  await doc(root, 'task', 'TASK-0001', fields);
  return root;
}
const entry = (result, id) => result.envelope.entries.find(e => e.id === id);
const compile = root => compileStart(root, 'TASK-0001');

test('proposed feature cannot promote accepted ADR, including its one-hop descendants', async t => {
  const root = await setup(t, { features: ['F'] });
  await doc(root, 'feature', 'F', { status: 'proposed', adrs: ['A'] });
  await doc(root, 'adr', 'A', { rules: ['R'] });
  await doc(root, 'rule', 'R');
  const result = await compile(root);
  assert.equal(result.outcome, 'complete');
  assert.equal(entry(result, 'F').role, 'review');
  assert.equal(entry(result, 'F').tier, 1);
  assert.equal(entry(result, 'A').role, 'review');
  assert.equal(entry(result, 'A').tier, 2);
  assert.equal(entry(result, 'R'), undefined);
});

test('independent binding path and file alias retain all roles/reasons without duplicate content', async t => {
  const root = await setup(t, { features: ['F'], adrs: ['A'], files: ['adr\\A.md'] });
  await doc(root, 'feature', 'F', { status: 'proposed', adrs: ['A'] });
  await doc(root, 'adr', 'A');
  const result = await compile(root);
  const a = entry(result, 'A');
  assert.equal(a.role, 'binding');
  assert.equal(a.tier, 1);
  assert.equal(a.reasons.length, 3);
  assert.ok(a.reasons.some(r => r.role === 'review'));
  assert.equal(result.envelope.entries.filter(e => e.path === 'adr/A.md').length, 1);
});

for (const form of ['supersedes', 'superseded_by']) {
  test(`one-sided ${form} resolves A→B→C with whole-artifact history`, async t => {
    const root = await setup(t, { adrs: ['A'] });
    await doc(root, 'adr', 'A', { status: 'superseded', ...(form === 'superseded_by' ? { superseded_by: ['B'] } : {}) });
    await doc(root, 'adr', 'B', { status: 'superseded', ...(form === 'supersedes' ? { supersedes: ['A'] } : { superseded_by: ['C'] }) });
    await doc(root, 'adr', 'C', form === 'supersedes' ? { supersedes: ['B'] } : {});
    const result = await compile(root);
    assert.equal(result.outcome, 'complete');
    assert.equal(entry(result, 'A').role, 'history');
    assert.equal(entry(result, 'B').role, 'history');
    assert.equal(entry(result, 'C').role, 'binding');
    assert.equal(result.envelope.replacements.length, 2);
  });
}

test('proposed successor cannot retire an accepted decision or enter automatically', async t => {
  const root = await setup(t, { adrs: ['A'] });
  await doc(root, 'adr', 'A');
  await doc(root, 'adr', 'B', { status: 'proposed', supersedes: ['A'] });
  let result = await compile(root);
  assert.equal(result.outcome, 'complete');
  assert.equal(entry(result, 'A').role, 'binding');
  assert.equal(entry(result, 'B'), undefined);
  assert.equal(result.envelope.replacements[0].qualified, false);
  await doc(root, 'task', 'TASK-0001', { adrs: ['A', 'B'] });
  result = await compile(root);
  assert.equal(entry(result, 'B').role, 'review');
});

test('competing replacements stay conflicted despite reconvergence and independent links', async t => {
  const root = await setup(t, { adrs: ['A', 'D'] });
  await doc(root, 'adr', 'A');
  await doc(root, 'adr', 'B', { supersedes: ['A'] });
  await doc(root, 'adr', 'C', { supersedes: ['A'] });
  await doc(root, 'adr', 'D', { supersedes: ['B', 'C'] });
  const result = await compile(root);
  assert.equal(result.outcome, 'incomplete/conflicted');
  for (const id of ['A', 'B', 'C', 'D']) {
    assert.equal(entry(result, id).role, 'conflicted');
    assert.equal(entry(result, id).tier, 1);
    assert.match(entry(result, id).content, /Body/);
  }
});

test('missing accepted endpoint and unknown successor are incomplete; cycles remain structural failures', async t => {
  const root = await setup(t, { adrs: ['A'] });
  await doc(root, 'adr', 'A', { superseded_by: ['B'] });
  await doc(root, 'adr', 'B', { status: 'superseded' });
  assert.equal((await compile(root)).outcome, 'incomplete/conflicted');
  await doc(root, 'adr', 'B', { status: 'mystery' });
  assert.equal((await compile(root)).outcome, 'incomplete/conflicted');
  await doc(root, 'adr', 'B', { superseded_by: ['A'] });
  assert.equal((await compile(root)).outcome, 'failed');
});

test('excerpt boundaries include nested content and conservatively fall back on ambiguity', () => {
  const body = '# A\n\n## Decision\nChoose.\n### Detail\nKeep.\n## Constraints\nMust.\n';
  assert.deepEqual(excerpt(body), { content: body.slice(5), excerpt: 'sections' });
  for (const other of ['# A\nNo headings.\n', body + '## Decision\nOther.\n', body + '## Notes\nPotential constraint.\n', body + '```\n', 'Decision\n========\nText.\n']) {
    assert.equal(excerpt(other).content, other);
    assert.equal(excerpt(other).excerpt, 'whole-body');
  }
  const fenced = '# A\n## Decision\n```md\n## Decision\n```\nReal.\n## Constraints\nMust.\n';
  assert.equal(excerpt(fenced).excerpt, 'sections');
  assert.equal(estimate('😀'), 1);
});

test('ADR without template headings retains complete body at Tier 1', async t => {
  const root = await setup(t, { adrs: ['A'] });
  await doc(root, 'adr', 'A', {}, '# Custom\nEvery sentence is required.\n');
  const a = entry(await compile(root), 'A');
  assert.equal(a.excerpt, 'whole-body');
  assert.equal(a.content, '# Custom\nEvery sentence is required.\n');
});

test('explicit discovery excludes conventional project/global and file aliases cannot restore authority', async t => {
  const root = await setup(t, { files: ['PROJECT.md', 'rules/GLOBAL.md'] });
  await put(root, 'rules/GLOBAL.md', '# Established rule\n');
  await put(root, '.context/config.yaml', 'sources: [tasks]\n');
  const result = await compile(root);
  assert.equal(result.outcome, 'incomplete/conflicted');
  assert.equal(entry(result, 'P'), undefined);
  assert.equal(entry(result, 'file:PROJECT.md').role, 'evidence');
  assert.equal(entry(result, 'file:rules/GLOBAL.md').tier, 3);
  await put(root, '.context/config.yaml', 'sources: [PROJECT.md, tasks, rules]\n');
  const explicit = await compile(root);
  assert.equal(entry(explicit, 'rules/GLOBAL.md').tier, 1); // explicit file relevance, not always-load
});

test('mandatory project absence/conflict and unknown mandatory rule remain inspectable', async t => {
  const root = await setup(t);
  await fs.unlink(path.join(root, 'PROJECT.md'));
  assert.equal((await compile(root)).outcome, 'incomplete/conflicted');
  await doc(root, 'project', 'P', { key_rules: ['R'] });
  await doc(root, 'rule', 'R', { status: 'unknown' });
  let result = await compile(root);
  assert.equal(result.outcome, 'incomplete/conflicted');
  assert.equal(entry(result, 'R').role, 'review');
  assert.equal(entry(result, 'R').tier, 0);
  await put(root, 'context/project.md', artifact('project', { project_id: 'Q', status: 'active' }));
  result = await compile(root);
  assert.ok(result.diagnostics.some(d => d.code === 'START_PROJECT_CONFLICT'));
  assert.equal(entry(result, 'P').role, 'review');
});

test('unknown directly requested authority stays diagnosed review material without promoting descendants', async t => {
  const root = await setup(t, { features: ['F'] });
  await doc(root, 'feature', 'F', { status: 'unknown', rules: ['R'] });
  await doc(root, 'rule', 'R');
  const result = await compile(root);
  assert.equal(entry(result, 'F').role, 'review');
  assert.equal(entry(result, 'R').role, 'review');
  assert.ok(result.diagnostics.some(d => d.code === 'START_AUTHORITY_UNKNOWN'));
});

for (const files of [['PROJECT.md'], ['PROJECT.md', 'context/Q.md']]) {
  test(`project conflicts stay non-binding with file aliases: ${files.join(', ')}`, async t => {
    const root = await setup(t, { files, features: ['F'] });
    await doc(root, 'project', 'P', { key_rules: ['R'] });
    await doc(root, 'rule', 'R');
    await put(root, 'context/Q.md', artifact('project', { project_id: 'Q', status: 'active' }));
    await doc(root, 'feature', 'F', { status: 'proposed', files: ['context/Q.md'] });
    const result = await compile(root);
    assert.equal(result.outcome, 'incomplete/conflicted');
    assert.ok(result.diagnostics.some(d => d.code === 'START_PROJECT_CONFLICT'));
    for (const id of ['P', 'Q']) {
      const candidate = entry(result, id);
      assert.equal(candidate.role, 'review');
      assert.equal(candidate.tier, 0);
      assert.ok(candidate.reasons.every(reason => reason.role === 'review'));
      assert.ok(candidate.content);
      assert.equal(result.envelope.entries.filter(e => e.id === id).length, 1);
    }
    assert.ok(entry(result, 'P').reasons.some(r => r.source === 'TASK-0001' && r.field === 'files'));
    assert.ok(entry(result, 'Q').reasons.some(r => r.source === 'F' && r.field === 'files'));
    assert.equal(entry(result, 'R'), undefined);
  });
}

test('ADR extraction exempts only a unique leading title and preserves other heading content', async t => {
  const sections = '## Decision\nUse local storage.\n## Constraints\nEncrypt stored records.\n';
  assert.equal(excerpt('\n   # ADR title\n' + sections).excerpt, 'sections');
  assert.equal(excerpt(sections).excerpt, 'sections');
  for (const body of [
    '# ADR\n' + sections + '# Never transmit credentials\n',
    sections + '# Never transmit credentials\n',
    '# ADR\n# Never transmit credentials\n' + sections,
    'Preserve this preamble.\n# ADR\n' + sections,
  ]) {
    assert.deepEqual(excerpt(body), { content: body, excerpt: 'whole-body' });
  }
  const root = await setup(t, { adrs: ['A'] });
  const body = '# ADR\n' + sections + '# Never transmit credentials\n';
  await doc(root, 'adr', 'A', {}, body);
  const result = await compile(root);
  assert.equal(result.outcome, 'complete');
  assert.equal(entry(result, 'A').tier, 1);
  assert.equal(entry(result, 'A').excerpt, 'whole-body');
  assert.equal(entry(result, 'A').content, body);
});

test('non-active featureless root uses task facts and does not authorize or reopen work', async t => {
  const root = await setup(t, { status: 'completed' });
  await put(root, 'TASKS.md', '# TASK-0001 active with invented scope\n');
  const before = await snapshot(root);
  const result = await compile(root);
  assert.equal(result.outcome, 'complete');
  assert.equal(result.envelope.task.status, 'completed');
  assert.equal(result.envelope.authorization, 'not-established');
  assert.deepEqual(await snapshot(root), before);
});

test('cross-cutting features and cyclic dependencies stay bounded and deduplicate reasons', async t => {
  const root = await setup(t, { features: ['F', 'G'], depends_on: ['TASK-0002'] });
  await doc(root, 'feature', 'F', { depends_on: ['H'], adrs: ['A'] });
  await doc(root, 'feature', 'G', { depends_on: ['H'], adrs: ['A'] });
  await doc(root, 'feature', 'H', { depends_on: ['F'], rules: ['R'] });
  await doc(root, 'rule', 'R');
  await doc(root, 'adr', 'A');
  await doc(root, 'adr', 'Z');
  await doc(root, 'task', 'TASK-0002', { depends_on: ['TASK-0001'], adrs: ['Z'] });
  const result = await compile(root);
  assert.equal(result.outcome, 'complete');
  assert.equal(entry(result, 'H').tier, 2);
  assert.equal(entry(result, 'R').tier, 2);
  assert.equal(entry(result, 'A').reasons.length, 2);
  assert.equal(entry(result, 'Z'), undefined);
  assert.equal(entry(result, 'TASK-0001').role, 'scope');
});

test('project key rules and default GLOBAL are mandatory; unrelated rules and project catalog are not selected', async t => {
  const root = await setup(t);
  await doc(root, 'project', 'P', { key_rules: ['R'], rules: ['S'], features: ['F'] });
  await doc(root, 'rule', 'R'); await doc(root, 'rule', 'S'); await doc(root, 'rule', 'Z');
  await doc(root, 'feature', 'F');
  await put(root, 'rules/GLOBAL.md', '# Global\nAlways.\n');
  const result = await compile(root);
  assert.equal(entry(result, 'R').tier, 0);
  assert.equal(entry(result, 'S').tier, 1);
  assert.equal(entry(result, 'rules/GLOBAL.md').tier, 0);
  assert.equal(entry(result, 'Z'), undefined);
  assert.equal(entry(result, 'F'), undefined);
});

test('reverse learning/trap matching only uses root, active direct features and exact root files', async t => {
  const root = await setup(t, { features: ['F', 'PROPOSAL'], files: ['code.txt'] });
  await put(root, 'code.txt', 'code');
  await doc(root, 'feature', 'F', { depends_on: ['DEP'] });
  await doc(root, 'feature', 'DEP');
  await doc(root, 'feature', 'PROPOSAL', { status: 'proposed' });
  await doc(root, 'learning', 'L', { tasks: ['TASK-0001'] });
  await doc(root, 'learning', 'LF', { features: ['F'] });
  await doc(root, 'learning', 'LC', { status: 'candidate', tasks: ['TASK-0001'] });
  await doc(root, 'learning', 'LD', { features: ['DEP'] });
  await doc(root, 'learning', 'LP', { features: ['PROPOSAL'] });
  await doc(root, 'trap', 'T', { severity: 'medium', files: ['code.txt'] });
  const result = await compile(root);
  for (const id of ['L', 'LF', 'T']) assert.equal(entry(result, id).tier, 2);
  for (const id of ['LC', 'LD', 'LP']) assert.equal(entry(result, id), undefined);
});

test('unknown trap severity is protected non-binding Tier 1 and incomplete', async t => {
  const root = await setup(t);
  await doc(root, 'trap', 'T', { severity: 'critical', tasks: ['TASK-0001'] });
  const result = await compile(root);
  assert.equal(result.outcome, 'incomplete/conflicted');
  assert.equal(entry(result, 'T').role, 'review');
  assert.equal(entry(result, 'T').tier, 1);
});

test('budget retains Tier 0/1 and visibly omits Tier 3 ordinary proposal text', async t => {
  const root = await setup(t, { adrs: ['A'], files: ['proposal.md'] });
  await doc(root, 'adr', 'A', {}, 'A'.repeat(40000));
  await put(root, 'proposal.md', '# Proposed thing\n' + 'P'.repeat(40000));
  const result = await compile(root);
  assert.equal(entry(result, 'A').content.length, 40000);
  assert.equal(result.envelope.budget.exceeded, true);
  assert.equal(entry(result, 'file:proposal.md').content, undefined);
  assert.deepEqual(result.envelope.omissions, [{ id: 'file:proposal.md', path: 'proposal.md', reason: 'budget' }]);
});

test('oversized Tier 2 item is skipped whole while later small items fit', async t => {
  const root = await setup(t, { skills: ['A', 'B'] });
  await doc(root, 'skill', 'A', {}, 'A'.repeat(40000));
  await doc(root, 'skill', 'B', {}, 'Small procedure.');
  const result = await compile(root);
  assert.equal(entry(result, 'A').content, undefined);
  assert.equal(entry(result, 'B').content, 'Small procedure.');
  const { budget, ...rest } = result.envelope;
  assert.equal(budget.estimated_tokens, estimate(serialize(rest)));
});

test('all outcomes have distinct CLI exits; failed requests preserve prior envelope', async t => {
  const root = await setup(t);
  assert.equal(cli(root, 'start', 'TASK-0001').status, 0);
  await fs.unlink(path.join(root, 'PROJECT.md'));
  const incomplete = cli(root, 'start', 'TASK-0001');
  assert.equal(incomplete.status, 1);
  assert.equal(incomplete.result.installed, true);
  assert.equal(incomplete.result.envelope.outcome, 'incomplete/conflicted');
  const prior = await fs.readFile(path.join(root, '.context/current-envelope.json'), 'utf8');
  await put(root, 'tasks/broken.md', '# Invalid');
  const failed = cli(root, 'start', 'TASK-0001');
  assert.equal(failed.status, 2);
  assert.equal(failed.result.envelope, null);
  assert.equal(failed.result.installed, false);
  assert.equal(await fs.readFile(path.join(root, '.context/current-envelope.json'), 'utf8'), prior);
});

test('source immutability, reproducibility, deletion rebuild, stable bytes and idempotent mtime', async t => {
  const root = await setup(t, { files: ['note.txt'] });
  await put(root, 'note.txt', '\uFEFFhello\r\nworld\r\n');
  const before = await snapshot(root);
  const first = await start(root, 'TASK-0001');
  const destination = path.join(root, '.context/current-envelope.json');
  const stamp = (await fs.stat(destination, { bigint: true })).mtimeNs;
  const second = await start(root, 'TASK-0001');
  assert.equal(second.changed, false);
  assert.equal((await fs.stat(destination, { bigint: true })).mtimeNs, stamp);
  assert.equal(serialize(first.envelope), serialize(second.envelope));
  assert.equal(await fs.readFile(destination, 'utf8'), serialize(first.envelope));
  const after = await snapshot(root);
  for (const [file, content] of Object.entries(before)) assert.equal(after[file], content);
  await fs.unlink(destination);
  assert.equal(serialize((await start(root, 'TASK-0001')).envelope), serialize(first.envelope));
});

test('unknown destination and injected rename failure preserve existing bytes and remove temporary files', async t => {
  const root = await setup(t);
  await put(root, '.context/current-envelope.json', 'project-owned');
  assert.equal((await start(root, 'TASK-0001')).diagnostics[0].code, 'START_ENVELOPE_OVERWRITE_REFUSED');
  assert.equal(await fs.readFile(path.join(root, '.context/current-envelope.json'), 'utf8'), 'project-owned');
  await fs.unlink(path.join(root, '.context/current-envelope.json'));
  await start(root, 'TASK-0001');
  const before = await snapshot(root);
  await doc(root, 'task', 'TASK-0001', { status: 'review' });
  t.mock.method(fs, 'rename', async () => { throw new Error('Injected rename failure'); });
  syncBuiltinESMExports();
  let result;
  try { result = await start(root, 'TASK-0001'); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(result.outcome, 'failed');
  const after = await snapshot(root);
  assert.equal(after['.context/current-envelope.json'], before['.context/current-envelope.json']);
  assert.ok(!Object.keys(after).some(f => f.endsWith('.tmp')));
});

test('missing task, invalid links and duplicate IDs fail; binary evidence is visibly omitted', async t => {
  const root = await setup(t, { files: ['binary.dat'] });
  await put(root, 'binary.dat', Buffer.from([0, 255]));
  const result = await compile(root);
  assert.equal(result.envelope.omissions[0].reason, 'non-text-file');
  assert.equal((await compileStart(root, 'TASK-9999')).outcome, 'failed');
  await doc(root, 'task', 'TASK-0001', { adrs: ['missing'] });
  assert.equal((await compile(root)).outcome, 'failed');
  await doc(root, 'task', 'TASK-0001');
  await put(root, 'tasks/duplicate.md', artifact('task', { id: 'TASK-0001', title: 'Duplicate', status: 'active' }));
  assert.equal((await compile(root)).outcome, 'failed');
});

test('source order and repository location do not change output; indexes never supply input facts', async t => {
  const first = await setup(t, { adrs: ['A'] });
  const second = await temporary(t, false);
  await doc(first, 'adr', 'A');
  await put(first, '.context/config.yaml', 'sources: [tasks, PROJECT.md, adr]\n');
  await fs.cp(first, second, { recursive: true });
  await put(second, '.context/config.yaml', 'sources: [adr, PROJECT.md, tasks]\n');
  await put(second, '.context/index.json', 'invalid stale generated index');
  assert.equal(serialize((await compile(first)).envelope), serialize((await compile(second)).envelope));
  await doc(second, 'task', 'TASK-0001', { status: 'completed', adrs: ['A'] });
  assert.equal((await compile(second)).envelope.task.status, 'completed');
});

test('explicit default-equivalent sources do not implicitly select GLOBAL', async t => {
  const root = await setup(t);
  for (const dir of ['features', 'adr', 'rules', 'skills', 'context']) await fs.mkdir(path.join(root, dir));
  await put(root, 'rules/GLOBAL.md', '# Global\n');
  assert.equal(entry(await compile(root), 'rules/GLOBAL.md').tier, 0);
  await put(root, '.context/config.yaml', 'sources: [PROJECT.md, features, tasks, adr, rules, skills, context]\n');
  assert.equal(entry(await compile(root), 'rules/GLOBAL.md'), undefined);
});

test('typed file proposals stay Tier 1; unknown status mapping is artifact-specific', async t => {
  const root = await setup(t, { files: ['adr/A.md', 'context/L.md'] });
  await doc(root, 'adr', 'A', { status: 'candidate' });
  await doc(root, 'learning', 'L', { status: 'candidate' });
  const result = await compile(root);
  for (const id of ['A', 'L']) {
    assert.equal(entry(result, id).role, 'review');
    assert.equal(entry(result, id).tier, 1);
  }
  assert.ok(result.diagnostics.some(d => d.code === 'START_AUTHORITY_UNKNOWN' && d.path === 'adr/A.md'));
  assert.ok(!result.diagnostics.some(d => d.path === 'context/L.md'));
});

test('related tasks remain Tier 3 history without importing their neighborhoods', async t => {
  const root = await setup(t, { tasks: ['TASK-0002'] });
  await doc(root, 'task', 'TASK-0002', { status: 'completed', adrs: ['A'] });
  await doc(root, 'adr', 'A');
  const result = await compile(root);
  assert.equal(entry(result, 'TASK-0002').tier, 3);
  assert.equal(entry(result, 'TASK-0002').role, 'history');
  assert.equal(entry(result, 'A'), undefined);
});

test('complete atomically replaces incomplete; failed partial write preserves last complete output', async t => {
  const root = await setup(t);
  await fs.unlink(path.join(root, 'PROJECT.md'));
  assert.equal((await start(root, 'TASK-0001')).outcome, 'incomplete/conflicted');
  await doc(root, 'project', 'P');
  const complete = await start(root, 'TASK-0001');
  assert.equal(complete.outcome, 'complete');
  assert.equal(complete.changed, true);
  const before = await fs.readFile(path.join(root, '.context/current-envelope.json'), 'utf8');
  await doc(root, 'task', 'TASK-0001', { status: 'completed' });
  const original = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (file, contents, options) => {
    if (String(file).includes('.envelope-')) {
      await original(file, 'partial', options);
      throw new Error('Injected partial write');
    }
    return original(file, contents, options);
  });
  syncBuiltinESMExports();
  let result;
  try { result = await start(root, 'TASK-0001'); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(result.outcome, 'failed');
  assert.equal(await fs.readFile(path.join(root, '.context/current-envelope.json'), 'utf8'), before);
  assert.ok(!(await fs.readdir(path.join(root, '.context'))).some(f => f.endsWith('.tmp')));
});

test('unsafe envelope junction is rejected without touching its target', async t => {
  const root = await setup(t);
  const outside = await temporary(t, false);
  await fs.symlink(outside, path.join(root, '.context'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await start(root, 'TASK-0001');
  assert.equal(result.outcome, 'failed');
  assert.equal(result.diagnostics[0].code, 'PATH_SYMLINK');
  assert.deepEqual(await snapshot(outside), {});
});
