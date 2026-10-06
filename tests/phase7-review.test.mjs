// TASK-0013 independent review (Codex, round 1) remediation: one or more regression tests per
// blocking finding. Each test reproduces the reported attack or failure against the harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { cp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadPlan, schemaDiagnostics } from '../dist/benchmark/specs.js';
import { matrix } from '../dist/benchmark/prepare.js';
import { put, snapshot } from './helpers.mjs';
import { fixtures, git, bench, area, writePlan, common, records, scores, experiment } from './bench-helpers.mjs';

const node = process.execPath.replace(/\\/g, '/');
const junction = process.platform === 'win32' ? 'junction' : 'dir';

/** A marker program: appends its label to a log, then passes stdin through or prints a named file. */
async function markerProgram(dir) {
  const script = path.join(dir, 'marker.mjs');
  const log = path.join(dir, 'markers.log');
  await writeFile(script, `import { appendFileSync, readFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(log)}, process.argv[2] + '\\n');
if (process.argv[3]) process.stdout.write(readFileSync(process.argv[3]));
else process.stdin.pipe(process.stdout);
`);
  // A Git config value, quoted so the shell receives the quoted node and script paths.
  const command = label => `\\"${node}\\" \\"${script.replace(/\\/g, '/')}\\" ${label}`;
  return { log, command };
}
const markers = log => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];

async function customTask(a, name, prompts) {
  const task = path.join(a.base, name);
  await cp(path.join(fixtures, 'tasks', 'change-app'), task, { recursive: true });
  for (const [file, text] of Object.entries(prompts)) await writeFile(path.join(task, file), text);
  return path.join(task, 'task.json');
}
const plain = path.join(fixtures, 'conditions', 'plain', 'condition.json');
const guided = path.join(fixtures, 'conditions', 'guided', 'condition.json');
const condition = async (dir, spec) => {
  await put(dir, 'condition.json', JSON.stringify({ kind: 'keystone-bench-condition', schema_version: 1, instructions: null, tools: [], ...spec }));
  return path.join(dir, 'condition.json');
};

test('review B1: no harness Git operation executes configured filter, textconv or fsmonitor programs', async t => {
  const a = await area(t);
  const { log, command } = await markerProgram(a.base);
  // The subject routes every path through attribute-selected drivers.
  await writeFile(path.join(a.subject, '.gitattributes'), '* filter=evil diff=evil\n');
  git(a.subject, 'add', '.gitattributes');
  git(a.subject, 'commit', '--quiet', '-m', 'attributes');
  a.commit = git(a.subject, 'rev-parse', 'HEAD');
  // The operator's global configuration defines those drivers, as git-lfs does on many machines.
  const home = path.join(a.base, 'operator home');
  await put(home, '.gitconfig', `[filter "evil"]\n\tsmudge = "${command('global-smudge')}"\n\tclean = "${command('global-clean')}"\n\trequired = true\n` +
    `[diff "evil"]\n\ttextconv = "${command('global-textconv')}"\n[core]\n\tfsmonitor = "${command('global-fsmonitor')}"\n`);
  // The agent, a declared program, may define drivers in its own workspace; the harness must never run them.
  const drivers = `[filter "agent"]\\n\\tclean = "${command('agent-clean')}"\\n[diff "agent"]\\n\\ttextconv = "${command('agent-textconv')}"\\n`;
  const task = await customTask(a, 'driver task', {
    'session-1.md': `FAKE * append .git/config ${drivers}\nFAKE * write .gitattributes * filter=agent diff=agent\\n\nFAKE * write src/app.txt two\\n\n`,
    'session-2.md': 'FAKE * write notes.txt more\\n\n',
  });
  const plan = await writePlan(a, 'drivers', { tasks: [task], conditions: [plain], judging: { procedure: 'Blind review.' } });
  const env = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home };
  // The configuration is live: an ordinary Git command in the subject does run the driver.
  const probe = path.join(a.base, 'probe clone');
  const { spawnSync } = await import('node:child_process');
  spawnSync('git', ['clone', '--quiet', a.subject, probe], { env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.ok(markers(log).includes('global-smudge'), 'the attack configuration is not active; the test would prove nothing');
  await fs.rm(log);
  assert.equal(bench(['prepare', plan, ...common(a)], env).status, 0);
  assert.deepEqual(markers(log), [], 'prepare ran a configured program');
  const ran = bench(['run', plan, ...common(a)], env);
  assert.equal(ran.status, 0, JSON.stringify(ran.result));
  // Only the fake agent itself ran; every marker would come from a harness Git operation.
  assert.deepEqual(markers(log), [], 'run executed an undeclared configured program');
  assert.equal(bench(['score', plan, ...common(a), '--blind', path.join(a.base, 'packet')], env).status, 0);
  assert.equal(bench(['report', plan, ...common(a)], env).status, 0);
  assert.deepEqual(markers(log), [], 'score or report ran a configured program');
  // Snapshots still capture the agent's change faithfully.
  const [record] = await records(a, 'drivers');
  assert.ok(record.sessions[0].changes.files >= 2, JSON.stringify(record.sessions[0]));
  const packet = JSON.parse(await readFile(path.join(a.base, 'packet', 'packet.json'), 'utf8'));
  assert.match(readFileSync(path.join(a.base, 'packet', packet.items[0].patch), 'utf8'), /src\/app\.txt/);
});

test('review B2: physical aliases (junctions) cannot place work or results inside the subject or Keystone tree', async t => {
  const a = await area(t);
  const plan = await writePlan(a, 'aliases', { conditions: [plain] });
  const subjectBefore = await snapshot(a.subject);
  // A work directory reached through a junction into the subject.
  await symlink(a.subject, path.join(a.base, 'subject alias'), junction);
  const intoSubject = bench(['prepare', plan, '--root', a.root, '--work', path.join(a.base, 'subject alias', 'work')]);
  assert.equal(intoSubject.status, 1, JSON.stringify(intoSubject.result));
  assert.equal(intoSubject.result.diagnostics[0].code, 'BENCH_WORK_INVALID');
  // A work directory reached through a junction into the Keystone tree.
  await symlink(a.root, path.join(a.base, 'root alias'), junction);
  const intoRoot = bench(['prepare', plan, '--root', a.root, '--work', path.join(a.base, 'root alias', 'work')]);
  assert.equal(intoRoot.status, 1, JSON.stringify(intoRoot.result));
  assert.equal(intoRoot.result.diagnostics[0].code, 'BENCH_WORK_INVALID');
  // A results directory that is a junction into the subject.
  await mkdir(path.join(a.root, 'benchmark'), { recursive: true });
  await symlink(path.join(a.subject, 'src'), path.join(a.root, 'benchmark', 'results'), junction);
  for (const command of ['prepare', 'run', 'score', 'report']) {
    const refused = bench([command, plan, ...common(a)]);
    assert.equal(refused.status, 1, `${command}: ${JSON.stringify(refused.result)}`);
    assert.equal(refused.result.diagnostics[0].code, 'BENCH_RESULTS_INVALID', command);
  }
  assert.deepEqual(await snapshot(a.subject), subjectBefore, 'the subject was modified through an alias');
});

test('review B3: inputs staged under one plan are never adopted by a changed plan', async t => {
  const a = await area(t);
  const good = path.join(a.base, 'staging condition');
  await condition(good, { id: 'staging', setup: { files: [{ from: 'seed.txt', to: 'SEED.txt' }], commands: [] } });
  await put(good, 'seed.txt', 'version one\n');
  const bad = path.join(a.base, 'broken staging');
  await condition(bad, { id: 'broken', setup: { files: [{ from: 'seed.txt', to: 'README.md/inside.txt' }], commands: [] } });
  await put(bad, 'seed.txt', 'x\n');
  // Pick a seed that prepares a staging run before the broken one fails.
  let seed = 0;
  let plan;
  for (; seed < 100; seed++) {
    plan = await writePlan(a, 'stale', { conditions: [path.join(good, 'condition.json'), path.join(bad, 'condition.json')], seed });
    if (matrix((await loadPlan(plan)).plan)[0].condition === 'staging') break;
  }
  const failed = bench(['prepare', plan, ...common(a)]);
  assert.equal(failed.result.outcome, 'failed', JSON.stringify(failed.result));
  assert.ok(failed.result.prepared.length >= 1, 'a staging run was prepared before the failure');
  // The owner fixes the broken condition and changes the staged input: the plan hash changes.
  await condition(bad, { id: 'broken', setup: { files: [], commands: [] } });
  await put(good, 'seed.txt', 'version two\n');
  const again = bench(['prepare', plan, ...common(a)]);
  assert.equal(again.status, 1, JSON.stringify(again.result));
  assert.ok(again.result.diagnostics.some(d => d.code === 'BENCH_PLAN_CHANGED'), JSON.stringify(again.result));
  const ran = bench(['run', plan, ...common(a)]);
  assert.equal(ran.status, 1, JSON.stringify(ran.result));
  assert.ok(!existsSync(path.join(a.root, 'benchmark', 'results', 'stale')), 'a record paired stale inputs with the new plan hash');
});

test('review B4a: a partial temporary write is removed or reported, and unverified content is never installed', async t => {
  const { writeVerified } = await import('../dist/benchmark/store.js');
  const a = await area(t);
  const target = path.join(a.base, 'record.json');
  const boundary = { base: a.base, forbidden: [a.subject], code: 'BENCH_WORK_INVALID', what: 'Test' };
  const temporaries = async () => (await readdir(a.base)).filter(n => n.includes('.tmp-'));
  const realWriteFile = fs.writeFile;
  const partial = async (file, contents, options) => {
    if (String(file).includes('.tmp-')) { await realWriteFile(file, String(contents).slice(0, 5), options); throw new Error('Injected partial write'); }
    return realWriteFile(file, contents, options);
  };
  t.mock.method(fs, 'writeFile', partial);
  syncBuiltinESMExports();
  let failure;
  try { failure = await writeVerified(target, 'complete contents\n', boundary); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(failure.diagnostics[0].code, 'BENCH_WRITE_FAILED');
  assert.deepEqual(await temporaries(), [], 'the partial temporary file escaped cleanup');
  assert.deepEqual(failure.temporary_files, []);
  assert.ok(!existsSync(target));
  // When removal also fails, the leftover is reported, never silent.
  t.mock.method(fs, 'writeFile', partial);
  t.mock.method(fs, 'unlink', async () => { throw Object.assign(new Error('Injected unlink failure'), { code: 'EPERM' }); });
  syncBuiltinESMExports();
  try { failure = await writeVerified(target, 'complete contents\n', boundary); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  const left = await temporaries();
  assert.equal(left.length, 1);
  assert.deepEqual(failure.temporary_files.map(f => path.basename(f)), left);
  assert.ok(failure.diagnostics.some(d => d.code === 'BENCH_TEMPORARY_FILE_REMAINS'));
  await fs.rm(path.join(a.base, left[0]));
  // Content that fails verification is never installed under the target name.
  const realReadFile = fs.readFile;
  t.mock.method(fs, 'readFile', async (file, ...rest) => String(file).includes('.tmp-') ? 'corrupted' : realReadFile(file, ...rest));
  syncBuiltinESMExports();
  try { failure = await writeVerified(target, 'complete contents\n', boundary); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(failure.diagnostics[0].code, 'BENCH_WRITE_FAILED');
  assert.ok(!existsSync(target), 'unverified content was installed');
  assert.deepEqual(await temporaries(), []);
});

test('review B4b: a run whose final state cannot be persisted is never reported completed', async t => {
  const { run } = await import('../dist/benchmark/run.js');
  const a = await area(t);
  const plan = await writePlan(a, 'state', { conditions: [plain] });
  assert.equal(bench(['prepare', plan, ...common(a)]).status, 0);
  const realWriteFile = fs.writeFile;
  let stateWrites = 0;
  t.mock.method(fs, 'writeFile', async (file, contents, options) => {
    if (String(file).includes('state.json.tmp-') && ++stateWrites === 2) throw new Error('Injected state write failure');
    return realWriteFile(file, contents, options);
  });
  syncBuiltinESMExports();
  let result;
  try { result = await run(plan, a.root, a.work, []); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(stateWrites, 2, 'the final state write was attempted');
  assert.equal(result.outcome, 'failed', JSON.stringify(result));
  assert.ok(result.diagnostics.some(d => d.code === 'BENCH_STATE_WRITE_FAILED'), JSON.stringify(result.diagnostics));
  // The installed record stays valid evidence, and the run is not executed again over it.
  assert.equal((await records(a, 'state')).length, 1);
  const again = bench(['run', plan, ...common(a)]);
  assert.notEqual(again.result.outcome, 'completed');
});

test('review B5: blinded evidence is bound to the sealed record, not to mutable run state', async t => {
  const { a, plan } = await experiment(t, { repetitions: 1, conditions: [plain] }, 'bound');
  const [record] = await records(a, 'bound');
  assert.match(record.evidence.setup_tree, /^[a-f0-9]{40}$/);
  assert.match(record.evidence.final_tree, /^[a-f0-9]{40}$/);
  // Substitute the final tree in the mutable state with the setup tree (an empty change).
  const stateFile = path.join(a.work, 'runs', record.run_id, 'harness', 'state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  await writeFile(stateFile, JSON.stringify({ ...state, final_tree: record.evidence.setup_tree, setup_tree: record.evidence.setup_tree }));
  const packet = path.join(a.base, 'bound packet');
  assert.equal(bench(['score', plan, ...common(a), '--blind', packet]).status, 0);
  const data = JSON.parse(await readFile(path.join(packet, 'packet.json'), 'utf8'));
  assert.match(readFileSync(path.join(packet, data.items[0].patch), 'utf8'), /src\/app\.txt/, 'the packet followed substituted state');
  // Substituting the trees in the record itself breaks its evidence hash.
  const directory = path.join(a.root, 'benchmark', 'results', 'bound', 'runs');
  const sealed = JSON.parse(await readFile(path.join(directory, `${record.run_id}.json`), 'utf8'));
  sealed.evidence.final_tree = sealed.evidence.setup_tree;
  await writeFile(path.join(directory, `${record.run_id}.json`), JSON.stringify(sealed));
  assert.equal(bench(['score', plan, ...common(a), '--blind', path.join(a.base, 'second packet')]).result.diagnostics[0].code, 'BENCH_RESULT_EVIDENCE_MISMATCH');
});

test('review B6: a tool is universal only when it resolves in every planned run', async t => {
  const a = await area(t);
  const broken = await condition(path.join(a.base, 'broken condition'), { id: 'broken', setup: { files: [], commands: [{ id: 'explode', command: ['{node}', '-e', 'process.exit(4)'] }] } });
  const plan = await writePlan(a, 'universal', { conditions: [guided, broken], telemetry: { enabled: true, wrap: ['helper'] }, composite: { weights: { 'tool_seconds:helper': 1 } } });
  assert.equal(bench(['prepare', plan, ...common(a)]).status, 0);
  assert.equal(bench(['run', plan, ...common(a)]).status, 0);
  assert.equal(bench(['report', plan, ...common(a)]).status, 0);
  const report = JSON.parse(await readFile(path.join(a.root, 'benchmark', 'analysis', 'universal', 'report.json'), 'utf8'));
  for (const arm of report.arms) {
    assert.ok(!('tool_seconds:helper' in arm.measures), `${arm.condition}: a condition-specific tool entered the comparable scorecard`);
    assert.equal(arm.composite.value, null);
  }
  assert.ok(report.diagnostics.some(d => 'tool_seconds:helper' in d.measures));
  // Universality needs every planned run recorded: running a subset decides nothing.
  const b = await area(t);
  const partial = await writePlan(b, 'partial', { telemetry: { enabled: true, wrap: ['git'] } });
  const prepared = bench(['prepare', partial, ...common(b)]).result;
  const subset = prepared.runs.filter(r => r.condition === 'plain').flatMap(r => ['--run', r.run_id]);
  assert.equal(bench(['run', partial, ...common(b), ...subset]).status, 0);
  assert.equal(bench(['score', partial, ...common(b)]).status, 0);
  assert.ok((await scores(b, 'partial')).runs.every(r => !('tool_seconds:git' in r.measures) && 'tool_seconds:git' in r.diagnostics));
  // Once every planned run is recorded with the tool resolved, it is primary.
  assert.equal(bench(['run', partial, ...common(b)]).status, 0);
  assert.equal(bench(['score', partial, ...common(b)]).status, 0);
  assert.ok((await scores(b, 'partial')).runs.every(r => 'tool_seconds:git' in r.measures));
});

test('review B7: the report labels each value with its recorded source, including reported manual values', async t => {
  const a = await area(t);
  const plan = await writePlan(a, 'sources', { conditions: [guided], profiles: [path.join(fixtures, 'profiles', 'fake', 'profile.json'), path.join(fixtures, 'profiles', 'manual', 'profile.json')] });
  assert.equal(bench(['prepare', plan, ...common(a)]).status, 0);
  const waiting = bench(['run', plan, ...common(a)]).result;
  const manualRun = waiting.runs.find(r => r.outcome === 'awaiting-record').run_id;
  await writeFile(path.join(a.work, 'runs', manualRun, 'workspace', 'src', 'app.txt'), 'two\n');
  const input = path.join(a.base, 'manual.json');
  const usage = { input_tokens: 1, output_tokens: 1, turns: 1, tool_calls: 1, tool: 'person', model: null };
  await writeFile(input, JSON.stringify({ kind: 'keystone-bench-manual-record', schema_version: 1, fix_sessions: 0,
    sessions: [{ id: 's1', status: 'ok', duration_seconds: 5, usage }, { id: 's2', status: 'ok', duration_seconds: 5, usage }] }));
  assert.equal(bench(['record', manualRun, '--plan', plan, '--input', input, ...common(a)]).status, 0);
  assert.equal(bench(['run', plan, ...common(a)]).status, 0);
  assert.equal(bench(['report', plan, ...common(a)]).status, 0);
  const lines = readFileSync(path.join(a.root, 'benchmark', 'analysis', 'sources', 'report.md'), 'utf8').split('\n');
  const header = lines.find(l => l.startsWith('| Task |') && l.includes('session_seconds')).split('|').map(c => c.trim());
  const column = header.findIndex(c => c.startsWith('session_seconds'));
  assert.equal(header[column], 'session_seconds [deterministic, reported]');
  const row = profile => lines.find(l => l.includes(`| ${profile} |`)).split('|').map(c => c.trim());
  assert.match(row('manual')[column], /\[reported\]$/);
  assert.match(row('fake')[column], /\[deterministic\]$/);
  const rework = header.findIndex(c => c.startsWith('rework_sessions'));
  assert.match(row('manual')[rework], /\[reported\]$/);
});

test('review B8: agent-reported tool and model identifiers cannot carry content into results', async t => {
  const a = await area(t);
  const task = await customTask(a, 'identity task', {
    'session-1.md': 'FAKE * identity fake-agent IDENTITY-CONTENT-MARKER: change src/app.txt so that it says two\nFAKE * write src/app.txt two\\n\n',
    'session-2.md': 'FAKE * identity CONTENT\\nMARKER valid-model-1.0\n',
  });
  const plan = await writePlan(a, 'identity', { tasks: [task], conditions: [plain] });
  assert.equal(bench(['prepare', plan, ...common(a)]).status, 0);
  assert.equal(bench(['run', plan, ...common(a)]).status, 0);
  const [record] = await records(a, 'identity');
  assert.ok(!JSON.stringify(record).includes('MARKER'), 'agent-supplied content entered the result');
  assert.deepEqual(record.sessions.map(s => [s.usage.tool, s.usage.model]), [['fake-agent', null], [null, null]]);
  const { parseUsage } = await import('../dist/benchmark/run.js');
  const claude = parseUsage('claude-code-json', Buffer.from(JSON.stringify({ num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 },
    modelUsage: { 'claude-ok-1': {}, 'Please summarise the secret plan': {} } })), undefined, { models: ['claude-ok-1'] });
  assert.equal(claude.model, 'claude-ok-1');
  // Manual records and profiles are held to the same identifier rule.
  assert.ok(schemaDiagnostics('manual-record', { kind: 'keystone-bench-manual-record', schema_version: 1, fix_sessions: 0,
    sessions: [{ id: 's1', status: 'ok', duration_seconds: 1, usage: { tool: 'a person who wrote this sentence', model: null } }] }, 'm').length);
  assert.ok(schemaDiagnostics('agent-profile', { kind: 'keystone-bench-agent-profile', schema_version: 1, id: 'p', mode: 'manual', declared: { tool: 'free text here', model: 'm' } }, 'p').length);
});
