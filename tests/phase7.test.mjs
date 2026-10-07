import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadPlan } from '../dist/benchmark/specs.js';
import { matrix, seededOrder } from '../dist/benchmark/prepare.js';
import { compileStart } from '../dist/commands/start.js';
import { compileReview } from '../dist/commands/review.js';
import { loadConfig } from '../dist/context/config.js';
import { inspect } from '../dist/commands/index.js';
import { temporary, put, artifact, snapshot, project } from './helpers.mjs';

import { fixtures, reference, benchCli, offline, git, bench, keystone, area, writePlan, common, records, byCondition, scores, experiment } from './bench-helpers.mjs';

test('validate accepts the reference specifications and rejects malformed ones with stable codes', async t => {
  const valid = bench(['validate', '--root', project]);
  assert.equal(valid.status, 0, JSON.stringify(valid.result));
  assert.equal(valid.result.outcome, 'valid');
  assert.ok(valid.result.specifications >= 3);
  // The reference conditions are peer declarative definitions; neither is built into harness code.
  for (const id of ['baseline', 'keystone']) {
    const spec = JSON.parse(await readFile(path.join(reference, id, 'condition.json'), 'utf8'));
    assert.equal(spec.kind, 'keystone-bench-condition');
    assert.equal(spec.id, id);
  }
  const sources = await Promise.all((await readdir(path.join(project, 'src', 'benchmark'))).map(f => readFile(path.join(project, 'src', 'benchmark', f), 'utf8')));
  assert.ok(!sources.some(s => /['"]baseline['"]/.test(s)), 'no condition is special-cased in harness code');
  // The only such literals are the PATH guard that keeps harness executables out of every condition
  // alike, and (TASK-0015) the name of the Keystone repository in version 2 bundle references.
  assert.equal(sources.flatMap(s => s.match(/['"]keystone['"]/g) ?? []).length, 2);
  assert.ok(sources.some(s => /export const keystoneRepository = 'keystone' as const;/.test(s)));

  const a = await area(t);
  const root = path.join(a.base, 'spec root');
  const spec = (file, value) => put(root, `benchmark/specification/${file}`, JSON.stringify(value));
  await spec('tasks/bad-task/task.json', { kind: 'keystone-bench-task', schema_version: 1, id: 'bad-task', statement: 'missing.md', sessions: [{ id: 's1', prompt: 'missing.md' }], oracles: [] });
  await spec('conditions/bad/condition.json', { kind: 'keystone-bench-condition', schema_version: 1, id: 'bad', instructions: null, setup: { files: [], commands: [{ id: 'x', command: ['{task}/x'] }] }, tools: [] });
  await spec('profiles/bad/profile.json', { kind: 'keystone-bench-agent-profile', schema_version: 1, id: 'bad', mode: 'command', declared: { tool: 't', model: 'm' } });
  await spec('plans/bad.json', { kind: 'keystone-bench-plan', schema_version: 1, id: 'bad', purpose: 'experiment', subject: { id: 's', repository: '.', commit: 'abc' } });
  await spec('other.json', { kind: 'something-else' });
  const invalid = bench(['validate', '--root', root]);
  assert.equal(invalid.status, 1);
  assert.equal(invalid.result.outcome, 'invalid');
  const codes = new Set(invalid.result.diagnostics.map(d => `${d.path.split('/').slice(2, 3)[0]}:${d.code}`));
  for (const expected of ['tasks:BENCH_SPEC_INVALID', 'conditions:BENCH_PLACEHOLDER_INVALID', 'profiles:BENCH_SPEC_INVALID', 'plans:BENCH_SPEC_INVALID', 'other.json:BENCH_SPEC_KIND_UNKNOWN']) {
    assert.ok(codes.has(expected), `${expected} in ${[...codes]}`);
  }
  // Semantic plan checks: missing references, and weights on a diagnostic or a verdict.
  const missing = await writePlan(a, 'missing-ref', { conditions: [path.join(a.base, 'nowhere', 'condition.json')] });
  assert.equal(bench(['validate', missing]).result.diagnostics[0].code, 'BENCH_REFERENCE_MISSING');
  const weighted = await writePlan(a, 'weighted', { composite: { weights: { setup_seconds: 1, review_verdict: 1 } } });
  const weightCodes = bench(['validate', weighted]).result.diagnostics.map(d => d.code);
  assert.deepEqual(weightCodes, ['BENCH_PLAN_WEIGHT_INVALID', 'BENCH_PLAN_WEIGHT_INVALID']);
});

test('prepare clones once per run at the pinned commit, isolates runs, and never modifies the subject or Keystone tree', async t => {
  const { a, plan, subjectBefore, prepared } = await experiment(t);
  assert.equal(prepared.outcome, 'prepared');
  assert.equal(prepared.runs.length, 4);
  const workspaces = prepared.runs.map(r => path.join(a.work, 'runs', r.run_id, 'workspace'));
  assert.equal(new Set(workspaces).size, 4);
  for (const workspace of workspaces) {
    assert.equal(git(workspace, 'rev-parse', 'HEAD'), a.commit);
    assert.equal(git(workspace, 'remote'), '', 'no remote back to the subject');
    assert.ok(!existsSync(path.join(workspace, '.git', 'objects', 'info', 'alternates')), 'no shared object store');
    const hooks = path.join(workspace, '.git', 'hooks');
    assert.ok(!existsSync(hooks) || (await readdir(hooks)).length === 0, 'no hooks');
  }
  // Two repetitions of the same arm share nothing: configuration written in one is absent in the other.
  const guided = prepared.runs.filter(r => r.condition === 'guided').map(r => path.join(a.work, 'runs', r.run_id, 'workspace'));
  git(guided[0], 'config', 'bench.marker', 'one');
  assert.equal(spawnSync('git', ['-C', guided[1], 'config', 'bench.marker'], { encoding: 'utf8' }).status, 1);
  assert.notEqual(path.resolve(guided[0], '.git'), path.resolve(guided[1], '.git'));
  // prepare staged declared files only; it launched no declared program (owner decision I2).
  assert.ok(existsSync(path.join(guided[1], 'NOTES.md')));
  const unstarted = path.join(a.base, 'unstarted');
  const unstartedPlan = await writePlan(a, 'unstarted', { conditions: [path.join(fixtures, 'conditions', 'guided', 'condition.json')] });
  assert.equal(bench(['prepare', unstartedPlan, '--root', a.root, '--work', unstarted]).status, 0);
  const [only] = await readdir(path.join(unstarted, 'runs'));
  assert.ok(existsSync(path.join(unstarted, 'runs', only, 'workspace', 'NOTES.md')));
  assert.ok(!existsSync(path.join(unstarted, 'runs', only, 'workspace', '.bench-fixture', 'helper.txt')), 'setup commands wait for run');
  // Re-preparing is idempotent.
  assert.equal(bench(['prepare', plan, ...common(a)]).result.outcome, 'unchanged');
  // The subject is byte-identical, including .git, after preparing, running and scoring.
  assert.equal(bench(['score', plan, ...common(a)]).status, 0);
  assert.deepEqual(await snapshot(a.subject), subjectBefore);
  // The Keystone tree gains only result records and generated analysis.
  const rootFiles = Object.keys(await snapshot(a.root));
  assert.ok(rootFiles.every(f => f === 'PROJECT.md' || f.startsWith(`benchmark/results/main/`) || f.startsWith('benchmark/analysis/main/')), rootFiles.join(', '));
  // The work directory may not live inside the Keystone tree.
  const inside = bench(['prepare', plan, '--root', a.root, '--work', path.join(a.root, 'work')]);
  assert.equal(inside.status, 1);
  assert.equal(inside.result.diagnostics[0].code, 'BENCH_WORK_INVALID');
});

test('run executes multi-session tasks as separate processes and scores known answers', async t => {
  const { a, plan, ran } = await experiment(t);
  assert.equal(ran.outcome, 'completed');
  assert.ok(ran.runs.every(r => r.outcome === 'completed'));
  const all = await records(a, 'main');
  assert.equal(all.length, 4);
  for (const r of all) {
    const pids = readFileSync(path.join(a.work, 'runs', r.run_id, 'workspace', '.bench-fixture', 'pids.txt'), 'utf8').trim().split('\n');
    assert.equal(pids.length, 2);
    assert.notEqual(pids[0].split(':')[1], pids[1].split(':')[1], 'each session is its own process');
    assert.ok(r.sessions.every(s => Number.isInteger(s.duration_ms) && s.duration_source === 'deterministic'));
    assert.ok(r.checks.length >= 1 && r.checks.every(c => c.results.length === 3));
  }
  assert.equal(bench(['score', plan, ...common(a)]).status, 0);
  const runs = (await scores(a, 'main')).runs;
  const value = (condition, name) => [...new Set(runs.filter(r => r.condition === condition).map(r => (r.measures[name] ?? r.diagnostics[name]).value))];
  // plain: the trap recurs, and two fix sessions are needed (fix2 passes).
  assert.deepEqual(value('plain', 'task_oracle_pass_rate'), [1]);
  assert.deepEqual(value('plain', 'regression_oracle_pass_rate'), [1]);
  assert.deepEqual(value('plain', 'trap_recurrences'), [1]);
  assert.deepEqual(value('plain', 'rework_sessions'), [2]);
  assert.deepEqual(value('plain', 'input_tokens'), [300]);
  assert.deepEqual(value('plain', 'total_tokens'), [360]);
  assert.deepEqual(value('plain', 'turns'), [8]);
  assert.deepEqual(value('plain', 'tool_calls'), [12]);
  // guided: its instructions avoid the trap and finish in the planned sessions.
  assert.deepEqual(value('guided', 'trap_recurrences'), [0]);
  assert.deepEqual(value('guided', 'rework_sessions'), [0]);
  assert.deepEqual(value('guided', 'total_tokens'), [240]);
  assert.deepEqual(value('guided', 'failed_sessions'), [0]);
  // Instrumentation applied identically: git is universal (primary); helper exists only under guided (diagnostic).
  assert.deepEqual(value('plain', 'tool_invocations:git'), [1]);
  assert.ok(runs.every(r => 'tool_seconds:git' in r.measures && 'tool_seconds:helper' in r.diagnostics));
  assert.deepEqual(value('guided', 'tool_invocations:helper'), [1]);
  // Setup timing is recorded separately from agent execution (I2).
  const guidedRecord = byCondition(all, 'guided')[0];
  assert.equal(guidedRecord.setup.commands[0].id, 'mark');
  assert.ok(Number.isInteger(guidedRecord.setup.duration_ms));
  assert.ok(runs.every(r => 'setup_seconds' in r.diagnostics && !('setup_seconds' in r.measures)));
});

test('a session timeout or agent failure is recorded truthfully and the record stays valid', async t => {
  const a = await area(t);
  const task = path.join(a.base, 'flaky task');
  await cp(path.join(fixtures, 'tasks', 'change-app'), task, { recursive: true });
  await writeFile(path.join(task, 'session-1.md'), 'FAKE * exit 3\n');
  await writeFile(path.join(task, 'session-2.md'), 'FAKE * sleep 20000\n');
  const plan = await writePlan(a, 'flaky', {
    tasks: [path.join(task, 'task.json')], conditions: [path.join(fixtures, 'conditions', 'plain', 'condition.json')],
    limits: { session_timeout_seconds: 2, setup_timeout_seconds: 60, oracle_timeout_seconds: 60 },
  });
  assert.equal(bench(['prepare', plan, ...common(a)]).status, 0);
  const started = Date.now();
  const ran = bench(['run', plan, ...common(a)]);
  assert.equal(ran.status, 0, JSON.stringify(ran.result));
  assert.ok(Date.now() - started < 60000, 'the timed-out session was stopped');
  const [record] = await records(a, 'flaky');
  assert.equal(record.status, 'completed');
  const [s1, s2] = record.sessions;
  assert.deepEqual([s1.status, s1.exit_code], ['failed', 3]);
  assert.deepEqual([s2.status, s2.exit_code], ['timed-out', null]);
  assert.equal(bench(['score', plan, ...common(a)]).status, 0);
  assert.ok((await scores(a, 'flaky')).runs[0].measures.failed_sessions.value >= 2);

  // A failing condition setup is a failed run, recorded without sessions.
  const condition = path.join(a.base, 'broken condition');
  await put(condition, 'condition.json', JSON.stringify({ kind: 'keystone-bench-condition', schema_version: 1, id: 'broken', instructions: null,
    setup: { files: [], commands: [{ id: 'explode', command: ['{node}', '-e', 'process.exit(4)'] }] }, tools: [] }));
  const broken = await writePlan(a, 'broken', { conditions: [path.join(condition, 'condition.json')] });
  assert.equal(bench(['prepare', broken, '--root', a.root, '--work', path.join(a.base, 'work broken')]).status, 0);
  assert.equal(bench(['run', broken, '--root', a.root, '--work', path.join(a.base, 'work broken')]).status, 0);
  const [failed] = await records(a, 'broken');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure.code, 'BENCH_SETUP_FAILED');
  assert.deepEqual(failed.sessions, []);
  assert.deepEqual(failed.setup.commands.map(c => [c.id, c.status, c.exit_code]), [['explode', 'failed', 4]]);
});

test('a manual profile waits for record and scores identically to an equivalent automated run', async t => {
  const { a: auto, plan: autoPlan } = await experiment(t, { conditions: [path.join(fixtures, 'conditions', 'guided', 'condition.json')], repetitions: 1 }, 'auto');
  assert.equal(bench(['score', autoPlan, ...common(auto)]).status, 0);
  const a = await area(t);
  const plan = await writePlan(a, 'manual', {
    conditions: [path.join(fixtures, 'conditions', 'guided', 'condition.json')], profiles: [path.join(fixtures, 'profiles', 'manual', 'profile.json')],
  });
  assert.equal(bench(['prepare', plan, ...common(a)]).status, 0);
  const waiting = bench(['run', plan, ...common(a)]);
  assert.equal(waiting.status, 0);
  assert.equal(waiting.result.outcome, 'awaiting-record');
  const id = waiting.result.runs[0].run_id;
  const harness = path.join(a.work, 'runs', id, 'harness');
  for (const file of ['s1.md', 's2.md', 'fix.md']) assert.ok(existsSync(path.join(harness, 'prompts', file)));
  const workspace = path.join(a.work, 'runs', id, 'workspace');
  assert.ok(existsSync(path.join(workspace, '.bench-fixture', 'helper.txt')), 'condition setup ran under run');
  // Recording validates the session list against the task.
  const input = path.join(a.base, 'manual-input.json');
  const usage = { input_tokens: 100, output_tokens: 20, turns: 3, tool_calls: 4, tool: 'person', model: null };
  await writeFile(input, JSON.stringify({ kind: 'keystone-bench-manual-record', schema_version: 1, fix_sessions: 0, sessions: [{ id: 's2', status: 'ok', duration_seconds: 1, usage }] }));
  const wrong = bench(['record', id, '--plan', plan, '--input', input, ...common(a)]);
  assert.equal(wrong.status, 1);
  assert.equal(wrong.result.diagnostics[0].code, 'BENCH_MANUAL_RECORD_INVALID');
  // The person makes the same change the fake agent makes, then records the sessions.
  await writeFile(path.join(workspace, 'src', 'app.txt'), 'two\n');
  await writeFile(input, JSON.stringify({ kind: 'keystone-bench-manual-record', schema_version: 1, fix_sessions: 0,
    sessions: [{ id: 's1', status: 'ok', duration_seconds: 60, usage }, { id: 's2', status: 'ok', duration_seconds: 30, usage }] }));
  const recorded = bench(['record', id, '--plan', plan, '--input', input, ...common(a)]);
  assert.equal(recorded.result.outcome, 'recorded', JSON.stringify(recorded.result));
  assert.ok(!(await readdir(path.join(a.root))).includes('benchmark'), 'record launches nothing and writes no result');
  assert.equal(bench(['record', id, '--plan', plan, '--input', input, ...common(a)]).result.diagnostics[0].code, 'BENCH_RUN_ALREADY_RECORDED');
  const finished = bench(['run', plan, ...common(a)]);
  assert.equal(finished.result.outcome, 'completed', JSON.stringify(finished.result));
  assert.equal(bench(['score', plan, ...common(a)]).status, 0);
  const manual = (await scores(a, 'manual')).runs[0];
  const automated = (await scores(auto, 'auto')).runs[0];
  for (const name of ['task_oracle_pass_rate', 'regression_oracle_pass_rate', 'trap_recurrences', 'rework_sessions', 'failed_sessions', 'input_tokens', 'output_tokens', 'total_tokens', 'turns', 'tool_calls']) {
    assert.equal(manual.measures[name].value, automated.measures[name].value, name);
  }
  assert.equal(manual.measures.session_seconds.value, 90);
  assert.equal(manual.measures.session_seconds.source, 'reported');
  assert.equal(automated.measures.session_seconds.source, 'deterministic');
  // A command profile's run cannot be recorded by hand.
  const autoRun = (await records(auto, 'auto'))[0].run_id;
  assert.equal(bench(['record', autoRun, '--plan', autoPlan, '--input', input, ...common(auto)]).result.diagnostics[0].code, 'BENCH_RUN_NOT_MANUAL');
});

test('repetitions and ordering are seeded, recorded and reproducible', async t => {
  const a = await area(t);
  const file = await writePlan(a, 'seeded', { repetitions: 3, seed: 99 });
  const { plan } = await loadPlan(file);
  const first = matrix(plan);
  assert.deepEqual(matrix(plan), first);
  assert.equal(first.length, 6);
  assert.deepEqual(first.map(r => r.order_index), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(new Set(first.map(r => r.repetition)), new Set([1, 2, 3]));
  const items = Array.from({ length: 20 }, (_, i) => i);
  assert.deepEqual(seededOrder(items, 5), seededOrder(items, 5));
  assert.notDeepEqual(seededOrder(items, 5), seededOrder(items, 6));
  // The recorded seed and order reproduce the run order.
  const { a: b, plan: p } = await experiment(t, { seed: 42 }, 'order');
  const recorded = await records(b, 'order');
  const reloaded = matrix((await loadPlan(p)).plan);
  for (const r of recorded) {
    assert.equal(r.provenance.seed, 42);
    assert.equal(reloaded.find(m => m.run_id === r.run_id).order_index, r.provenance.order_index);
  }
});

test('protocol commands stay read-only and unchanged under every harness telemetry setting', async t => {
  for (const enabled of [true, false]) {
    const a = await area(t);
    const plan = await writePlan(a, `ref-${enabled}`, {
      conditions: [path.join(reference, 'keystone', 'condition.json')],
      telemetry: enabled ? { enabled: true, wrap: ['keystone', 'git'] } : { enabled: false },
    });
    assert.equal(bench(['prepare', plan, ...common(a)]).status, 0);
    const ran = bench(['run', plan, ...common(a)]);
    assert.equal(ran.status, 0, JSON.stringify(ran.result));
    const id = ran.result.runs[0].run_id;
    const workspace = path.join(a.work, 'runs', id, 'workspace');
    const harness = path.join(a.work, 'runs', id, 'harness');
    assert.ok(existsSync(path.join(workspace, '.context', 'config.yaml')), 'the keystone condition set up Keystone itself');
    // Run the protocol commands through the harness's own shims and environment.
    const shimDir = path.join(harness, enabled ? 'telemetry-bin' : 'tools');
    const env = { PATH: [shimDir, path.join(harness, 'tools'), process.env.PATH].join(path.delimiter) };
    const before = await snapshot(workspace);
    for (const args of ['validate', 'context status']) {
      const result = spawnSync(`keystone ${args} --root .`, { cwd: workspace, shell: true, encoding: 'utf8', env: { ...process.env, ...env } });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    assert.deepEqual(await snapshot(workspace), before, `validate and context status wrote nothing (telemetry ${enabled})`);
    if (enabled) assert.ok(readFileSync(path.join(harness, 'tool-log.jsonl'), 'utf8').includes('"tool":"keystone"'), 'telemetry stays in the harness record area');
    // The workspace's reserved .context/telemetry/ stays empty.
    const reserved = path.join(workspace, '.context', 'telemetry');
    assert.ok(!existsSync(reserved) || (await readdir(reserved)).length === 0);
  }
  // Read-only validation of this repository itself is unchanged.
  const before = await snapshot(project, 'tasks');
  assert.equal(keystone(['validate', '--root', project], project).status, 0);
  assert.deepEqual(await snapshot(project, 'tasks'), before);
});

test('protocol commands cannot launch declared programs; keystone-bench is a separate executable', async () => {
  const pkg = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.bin, { keystone: './dist/cli/index.js', 'keystone-bench': './dist/benchmark/cli.js' });
  // No model-provider SDK, network or credential dependency.
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['ajv', 'yaml']);
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file); else if (file.endsWith('.ts')) files.push(file);
    }
  }
  await walk(path.join(project, 'src'));
  for (const file of files) {
    const relative = path.relative(path.join(project, 'src'), file).replace(/\\/g, '/');
    const source = await readFile(file, 'utf8');
    const harness = relative.startsWith('benchmark/');
    if (!harness) assert.ok(!/from ['"][./]*\/?benchmark\//.test(source), `${relative} imports the harness`);
    // Only the existing fixed Git wrappers (owner decision I1) and the harness spawn processes.
    if (/node:child_process/.test(source)) assert.ok(harness || ['context/git.ts', 'review/git.ts'].includes(relative), `${relative} spawns processes`);
    assert.ok(!/\bfetch\(|node:https?['"]|node:net['"]/.test(source), `${relative} contains network code`);
  }
  assert.deepEqual((await readdir(path.join(project, 'src', 'telemetry'))).filter(f => f !== '.gitkeep'), [], 'src/telemetry stays reserved and unused');
  const protocol = keystone(['bench', 'run'], project);
  assert.equal(protocol.status, 2);
  assert.equal(JSON.parse(protocol.stdout).diagnostics[0].code, 'CLI_USAGE');
  const help = spawnSync(process.execPath, [path.join(project, 'dist', 'cli', 'index.js'), '--help'], { encoding: 'utf8' }).stdout;
  assert.ok(!/bench/i.test(help));
  // keystone-bench usage errors.
  for (const args of [['frobnicate'], ['run'], ['validate', '--work', 'x'], ['record', 'R-000000000000'], ['score', 'p.json', '--blind', 'a', '--judged', 'b']]) {
    const result = bench(args);
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.result.diagnostics[0].code, 'BENCH_USAGE');
  }
});

test('telemetry is opt-in, content-free and stored with the run record outside the workspace', async t => {
  const { a } = await experiment(t, { repetitions: 1 }, 'content');
  for (const r of await records(a, 'content')) {
    const text = JSON.stringify(r);
    for (const marker of ['STATEMENT-CONTENT-MARKER', 'PROMPT-CONTENT-MARKER', 'Never leave debug.log', 'Fixture subject']) assert.ok(!text.includes(marker), marker);
    assert.equal(r.telemetry.enabled, true);
    const log = readFileSync(path.join(a.work, 'runs', r.run_id, 'harness', 'tool-log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(log.every(e => Object.keys(e).sort().join() === 'duration_ms,exit_code,tool'));
    assert.ok(!existsSync(path.join(a.work, 'runs', r.run_id, 'workspace', '.context')), 'nothing written into the workspace');
  }
  const b = await area(t);
  const off = await writePlan(b, 'off', { telemetry: { enabled: false } });
  assert.equal(bench(['prepare', off, ...common(b)]).status, 0);
  assert.equal(bench(['run', off, ...common(b)]).status, 0);
  for (const r of await records(b, 'off')) {
    assert.deepEqual(r.telemetry, { enabled: false, tools: [], keystone_envelope: null, keystone_validation: null });
    assert.ok(!existsSync(path.join(b.work, 'runs', r.run_id, 'harness', 'telemetry-bin')));
    assert.ok(!existsSync(path.join(b.work, 'runs', r.run_id, 'harness', 'tool-log.jsonl')));
  }
});

test('neutrality: a baseline run gets no Keystone, even with keystone installed on the operator PATH', async t => {
  const a = await area(t);
  const global = path.join(a.base, 'operator bin');
  await put(global, process.platform === 'win32' ? 'keystone.cmd' : 'keystone', process.platform === 'win32' ? '@echo operator keystone\r\n' : '#!/bin/sh\necho operator keystone\n');
  if (process.platform !== 'win32') spawnSync('chmod', ['755', path.join(global, 'keystone')]);
  const plan = await writePlan(a, 'neutral', { conditions: [path.join(reference, 'baseline', 'condition.json'), path.join(reference, 'keystone', 'condition.json')], telemetry: { enabled: true, wrap: ['git'] } });
  const env = { PATH: `${global}${path.delimiter}${process.env.PATH}`, BENCH_CANARY_SECRET: 'canary' };
  assert.equal(bench(['prepare', plan, ...common(a)], env).status, 0);
  assert.equal(bench(['run', plan, ...common(a)], env).status, 0);
  const all = await records(a, 'neutral');
  const workspaceOf = r => path.join(a.work, 'runs', r.run_id, 'workspace');
  const [baseline] = byCondition(all, 'baseline');
  const [keystoneRun] = byCondition(all, 'keystone');
  assert.equal(readFileSync(path.join(workspaceOf(baseline), '.bench-fixture', 'probe-keystone.txt'), 'utf8'), 'absent\n');
  assert.equal(readFileSync(path.join(workspaceOf(keystoneRun), '.bench-fixture', 'probe-keystone.txt'), 'utf8'), 'present\n');
  assert.ok(baseline.environment.removed_path_entries >= 1);
  assert.equal(baseline.environment.base_path_hash, keystoneRun.environment.base_path_hash, 'one base environment for every condition');
  // The baseline workspace holds the subject plus the agent's own changes only.
  const tracked = Object.keys(await snapshot(workspaceOf(baseline))).filter(f => !f.startsWith('.git/')).sort();
  assert.deepEqual(tracked, ['.bench-fixture/env.txt', '.bench-fixture/pids.txt', '.bench-fixture/probe-keystone.txt', 'README.md', 'debug.log', 'src/app.txt']);
  for (const r of [baseline, keystoneRun]) {
    const names = readFileSync(path.join(workspaceOf(r), '.bench-fixture', 'env.txt'), 'utf8').trim().split('\n');
    assert.ok(!names.includes('BENCH_CANARY_SECRET'), 'only allow-listed variables reach sessions');
    assert.ok(!names.some(n => n.startsWith('KEYSTONE')));
  }
});

test('neutrality: every condition receives identical inputs; only declared setup and instructions differ', async t => {
  const { a } = await experiment(t, { repetitions: 1 }, 'inputs');
  const [plain] = byCondition(await records(a, 'inputs'), 'plain');
  const [guided] = byCondition(await records(a, 'inputs'), 'guided');
  for (const key of ['statement', 'prompts', 'fix_prompt', 'oracles', 'profile', 'limits', 'instrumentation']) assert.deepEqual(plain.inputs[key], guided.inputs[key], key);
  assert.notEqual(plain.inputs.setup, guided.inputs.setup);
  assert.equal(plain.inputs.instructions, null);
  assert.match(guided.inputs.instructions, /^[a-f0-9]{64}$/);
  assert.notEqual(plain.provenance.condition.hash, guided.provenance.condition.hash);
  assert.deepEqual(plain.provenance.profile, guided.provenance.profile);
});

test('judged measures are blind to condition; diagnostics stay out of comparisons and composites', async t => {
  const { a, plan } = await experiment(t, { repetitions: 1 }, 'judged');
  const packet = path.join(a.base, 'judge packet');
  assert.equal(bench(['score', plan, ...common(a), '--blind', path.join(a.root, 'packet')]).result.diagnostics[0].code, 'BENCH_BLIND_OUTPUT_INVALID');
  const exported = bench(['score', plan, ...common(a), '--blind', packet]);
  assert.equal(exported.status, 0, JSON.stringify(exported.result));
  const data = JSON.parse(await readFile(path.join(packet, 'packet.json'), 'utf8'));
  assert.equal(data.items.length, 2);
  const all = await records(a, 'judged');
  const everything = (await Promise.all((await readdir(packet, { recursive: true })).map(async f => {
    const file = path.join(packet, f);
    return (await stat(file)).isFile() ? `${f}\n${await readFile(file, 'utf8')}` : f;
  }))).join('\n');
  for (const secret of ['plain', 'guided', 'NOTES', ...all.map(r => r.run_id), ...all.map(r => r.provenance.condition.hash)]) assert.ok(!everything.includes(secret), `packet leaks ${secret}`);
  assert.ok(data.items.every(i => /^J-[a-f0-9]{16}$/.test(i.blind_id) && existsSync(path.join(packet, i.patch))));
  assert.ok(readFileSync(path.join(packet, data.items[0].patch), 'utf8').includes('src/app.txt'));
  // Attested judgements import against blinded IDs only.
  const judgements = path.join(a.base, 'judgements.json');
  const write = list => writeFile(judgements, JSON.stringify({ kind: 'keystone-bench-judgements', schema_version: 1, plan: data.plan,
    attestation: { judge: 'fixture judge', procedure: data.procedure, date: '2026-10-06', statement: 'Judged blind to condition.' }, judgements: list }));
  await write([{ blind_id: 'J-0000000000000000', verdict: 'approve', blocking: 0, non_blocking: 0 }]);
  assert.equal(bench(['score', plan, ...common(a), '--judged', judgements]).result.diagnostics[0].code, 'BENCH_JUDGEMENT_UNKNOWN');
  await write(data.items.map((item, i) => ({ blind_id: item.blind_id, verdict: i ? 'changes-requested' : 'approve', blocking: i, non_blocking: 2 })));
  const imported = bench(['score', plan, ...common(a), '--judged', judgements]);
  assert.equal(imported.status, 0, JSON.stringify(imported.result));
  const runs = (await scores(a, 'judged')).runs;
  assert.deepEqual(runs.map(r => r.measures.review_verdict.value).sort(), ['approve', 'changes-requested']);
  assert.ok(runs.every(r => r.measures.review_verdict.source === 'judged' && r.measures.review_non_blocking_findings.value === 2));
  // Re-importing the same file changes nothing; a conflicting second import is refused.
  assert.equal(bench(['score', plan, ...common(a), '--judged', judgements]).status, 0);
  await write(data.items.slice(0, 1).map(item => ({ blind_id: item.blind_id, verdict: 'reject', blocking: 9, non_blocking: 9 })));
  assert.equal(bench(['score', plan, ...common(a), '--judged', judgements]).result.diagnostics[0].code, 'BENCH_JUDGEMENT_DUPLICATE');
  // Report: diagnostics are separate, never in the comparable scorecard or the composite.
  assert.equal(bench(['report', plan, ...common(a)]).status, 0);
  const report = JSON.parse(await readFile(path.join(a.root, 'benchmark', 'analysis', 'judged', 'report.json'), 'utf8'));
  for (const arm of report.arms) {
    for (const name of Object.keys(arm.measures)) assert.notEqual((await import('../dist/benchmark/scorecard.js')).definition(name).scope, 'diagnostic', name);
    assert.ok(!('setup_seconds' in arm.measures) && !('tool_seconds:helper' in arm.measures));
  }
  assert.ok(report.diagnostics.some(d => 'setup_seconds' in d.measures));
  const verdicts = report.arms.map(arm => arm.measures.review_verdict.counts);
  assert.deepEqual(verdicts.flatMap(Object.keys).sort(), ['approve', 'changes-requested']);
  assert.ok(verdicts.every(counts => Object.values(counts).reduce((s, n) => s + n, 0) === 1));
});

test('report builds a balanced, source-labelled scorecard; score and report are byte-identical on re-run', async t => {
  const { a, plan } = await experiment(t, {}, 'report');
  const analysis = path.join(a.root, 'benchmark', 'analysis', 'report');
  assert.equal(bench(['score', plan, ...common(a)]).status, 0);
  assert.equal(bench(['report', plan, ...common(a)]).status, 0);
  const first = await snapshot(analysis);
  assert.equal(bench(['score', plan, ...common(a)]).status, 0);
  assert.equal(bench(['report', plan, ...common(a)]).status, 0);
  assert.deepEqual(await snapshot(analysis), first);
  const report = JSON.parse(await readFile(path.join(analysis, 'report.json'), 'utf8'));
  const categories = new Set();
  const { definition } = await import('../dist/benchmark/scorecard.js');
  for (const arm of report.arms) {
    for (const [name, summary] of Object.entries(arm.measures)) {
      categories.add(definition(name).category);
      assert.ok(summary.sources.length >= 1);
    }
    assert.equal(arm.runs, 2);
  }
  assert.deepEqual([...categories].sort(), ['continuity', 'efficiency', 'quality']);
  const plain = report.arms.find(r => r.condition === 'plain');
  const guided = report.arms.find(r => r.condition === 'guided');
  assert.equal(plain.composite.value, 0.8);
  assert.equal(guided.composite.value, 1);
  assert.equal(plain.measures.input_tokens.sources[0], 'reported');
  const markdown = readFileSync(path.join(analysis, 'report.md'), 'utf8');
  assert.match(markdown, /never verified/);
  assert.match(markdown, /input_tokens \[reported\]/);
  assert.match(markdown, /not compared across conditions/);
  // Without declared weights there is no composite.
  const { a: b, plan: unweighted } = await experiment(t, { repetitions: 1, composite: undefined }, 'noweights');
  assert.equal(bench(['report', unweighted, ...common(b)]).status, 0);
  const plainReport = JSON.parse(await readFile(path.join(b.root, 'benchmark', 'analysis', 'noweights', 'report.json'), 'utf8'));
  assert.equal(plainReport.composite, null);
  assert.ok(plainReport.arms.every(arm => !('composite' in arm)));
});

test('result records are schema-valid, carry full provenance and an evidence hash, and detect tampering', async t => {
  const { a, plan } = await experiment(t, { repetitions: 1 }, 'provenance');
  const { schemaDiagnostics } = await import('../dist/benchmark/specs.js');
  const { evidenceHash } = await import('../dist/benchmark/store.js');
  const loaded = (await loadPlan(plan)).plan;
  for (const r of await records(a, 'provenance')) {
    assert.deepEqual(schemaDiagnostics('run-record', r, 'record'), []);
    assert.equal(r.evidence_hash, evidenceHash(r));
    assert.deepEqual(r.plan, { id: 'provenance', hash: loaded.hash });
    const p = r.provenance;
    assert.equal(p.keystone.version, '0.1.0');
    assert.match(p.keystone.commit, /^[a-f0-9]{40}$/);
    assert.equal(typeof p.keystone.dirty, 'boolean');
    assert.deepEqual(p.subject, { id: 'fixture', commit: a.commit });
    for (const key of ['task', 'condition', 'profile']) assert.match(p[key].hash, /^[a-f0-9]{64}$/);
    assert.deepEqual(p.profile.declared, { tool: 'fake-agent', model: 'fake-model' });
    assert.ok(r.sessions.every(s => s.usage.tool === 'fake-agent' && s.usage.model === 'fake-model'));
    assert.equal(p.repetition, 1);
    assert.ok(Date.parse(p.started_at) <= Date.parse(p.finished_at));
  }
  // A tampered record is refused, and scoring is blocked rather than partial.
  const directory = path.join(a.root, 'benchmark', 'results', 'provenance', 'runs');
  const [name] = await readdir(directory);
  const record = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
  record.sessions[0].usage.input_tokens = 1;
  await writeFile(path.join(directory, name), JSON.stringify(record));
  const scored = bench(['score', plan, ...common(a)]);
  assert.equal(scored.status, 1);
  assert.equal(scored.result.diagnostics[0].code, 'BENCH_RESULT_EVIDENCE_MISMATCH');
});

test('plan provenance: changing a plan after runs exist is detected and refused', async t => {
  const { a, plan } = await experiment(t, { repetitions: 1, conditions: [path.join(fixtures, 'conditions', 'plain', 'condition.json')] }, 'fixed');
  assert.equal(bench(['score', plan, ...common(a)]).status, 0);
  const original = await readFile(plan, 'utf8');
  await writeFile(plan, JSON.stringify({ ...JSON.parse(original), description: 'edited after runs began' }));
  for (const command of ['score', 'report']) {
    const result = bench([command, plan, ...common(a)]);
    assert.equal(result.status, 1, command);
    assert.equal(result.result.diagnostics[0].code, 'BENCH_PLAN_MISMATCH');
  }
  for (const command of ['run', 'prepare']) {
    const result = bench([command, plan, ...common(a)]);
    assert.equal(result.status, 1, command);
    assert.ok(result.result.diagnostics.some(d => d.code === 'BENCH_PLAN_CHANGED'));
  }
  // A change inside a referenced bundle is a plan change too.
  await writeFile(plan, original);
  assert.equal(bench(['score', plan, ...common(a)]).status, 0);
  const b = await area(t);
  const condition = path.join(b.base, 'own condition');
  await cp(path.join(fixtures, 'conditions', 'plain'), condition, { recursive: true });
  const own = await writePlan(b, 'bundle', { conditions: [path.join(condition, 'condition.json')] });
  assert.equal(bench(['prepare', own, ...common(b)]).status, 0);
  assert.equal(bench(['run', own, ...common(b)]).status, 0);
  await writeFile(path.join(condition, 'extra.md'), 'changed\n');
  assert.equal(bench(['score', own, ...common(b)]).result.diagnostics[0].code, 'BENCH_PLAN_MISMATCH');
  assert.ok(bench(['run', own, ...common(b)]).result.diagnostics.some(d => d.code === 'BENCH_PLAN_CHANGED'));
});

test('benchmark results and analysis are never discovered, refused as sources, and ineligible for START and review context', async t => {
  const root = await temporary(t, false);
  git(root, 'init', '--quiet');
  const task = (files) => artifact('task', { id: 'TASK-0001', title: 'Example', status: 'active', adrs: ['ADR-0001'], files }, '# TASK-0001\n## Objective\nChange.\n');
  const files = {
    'PROJECT.md': artifact('project', { project_id: 'p', status: 'active' }, '# P\n'),
    'tasks/TASK-0001.md': task(['benchmark/results/main/runs/R-000000000000.json', 'benchmark/Analysis/main/report.md', 'src/app.txt']),
    'adr/ADR-0001.md': artifact('adr', { id: 'ADR-0001', title: 'A', status: 'accepted' }, '# ADR-0001\n## Decision\nDo it.\n'),
    'src/app.txt': 'one\n',
    'benchmark/results/main/runs/R-000000000000.json': '{}\n',
    'benchmark/Analysis/main/report.md': '# report\n',
    'benchmark/specification/README.md': '# Specification\n',
  };
  for (const [file, contents] of Object.entries(files)) await put(root, file, contents);
  const started = await compileStart(root, 'TASK-0001');
  assert.equal(started.outcome, 'complete');
  assert.equal(started.diagnostics.filter(d => d.code === 'START_BENCHMARK_RECORD_INELIGIBLE').length, 2);
  assert.deepEqual(started.envelope.omissions.filter(o => o.reason === 'benchmark-record-ineligible').map(o => o.path).sort(), ['benchmark/Analysis/main/report.md', 'benchmark/results/main/runs/R-000000000000.json']);
  assert.ok(!started.envelope.entries.some(e => /^benchmark\/(results|analysis)\//i.test(e.path)));
  assert.ok(started.envelope.entries.some(e => e.path === 'src/app.txt'));
  // Typed-looking content under them is never discovered, even under a configured parent source.
  await put(root, 'benchmark/results/tasks/TASK-0009.md', artifact('task', { id: 'TASK-0009', title: 'x', status: 'active' }));
  await put(root, 'benchmark/analysis/TASK-0008.md', artifact('task', { id: 'TASK-0008', title: 'x', status: 'active' }));
  await put(root, '.context/config.yaml', 'schema_version: 1\nsources: [PROJECT.md, tasks, adr, benchmark]\n');
  const inventory = await inspect(root);
  assert.deepEqual(inventory.diagnostics, []);
  assert.ok(!inventory.index.artifacts.some(x => x.id === 'TASK-0009' || x.id === 'TASK-0008'));
  for (const source of ['benchmark/results', 'Benchmark/Analysis', 'benchmark/results/main']) {
    await put(root, '.context/config.yaml', `schema_version: 1\nsources: [PROJECT.md, tasks, ${source}]\n`);
    await assert.rejects(loadConfig(root), error => error.diagnostic.code === 'CONFIG_INVALID', source);
  }
  await rm(path.join(root, '.context'), { recursive: true });
  // Review-context selection applies the same refusal.
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'base');
  await put(root, 'src/app.txt', 'two\n');
  const reviewed = await compileReview(root, 'TASK-0001', { type: 'context' });
  assert.ok(reviewed.packages[0].omissions.some(o => o.reason === 'benchmark-record-ineligible'));
  assert.ok(!reviewed.packages[0].context.entries.some(e => /^benchmark\/(results|analysis)\//i.test(e.path)));
});

test('usage parsers read numbers and identifiers only, and tolerate missing or malformed output', async () => {
  const { parseUsage } = await import('../dist/benchmark/run.js');
  const claude = Buffer.from(`progress line\n${JSON.stringify({ type: 'result', is_error: false, num_turns: 4, result: 'AGENT-OUTPUT-TEXT',
    usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 85, output_tokens: 30 }, modelUsage: { 'model-b': {}, 'model-a': {} } })}\n`);
  const parsed = parseUsage('claude-code-json', claude, undefined, { models: ['model-a', 'model-b'] });
  assert.deepEqual(parsed, { input_tokens: 100, output_tokens: 30, turns: 4, tool_calls: null, tool: 'claude-code', model: 'model-a,model-b' });
  assert.ok(!JSON.stringify(parsed).includes('AGENT-OUTPUT-TEXT'));
  assert.equal(parseUsage('claude-code-json', Buffer.from('not json'), undefined), null);
  assert.deepEqual(parseUsage('keystone-bench-json', Buffer.alloc(0), { input_tokens: -1, output_tokens: 2.5, turns: 3, tool: 'x', extra: 'ignored' }, { tools: ['x'] }),
    { input_tokens: null, output_tokens: null, turns: 3, tool_calls: null, tool: 'x', model: null });
  assert.equal(parseUsage('none', Buffer.from('{}'), {}), null);
});

test('a smoke run is never stored or scored as a benchmark result', async t => {
  const a = await area(t);
  const smoke = await writePlan(a, 'smoke', { purpose: 'smoke', conditions: [path.join(fixtures, 'conditions', 'plain', 'condition.json')] });
  assert.equal(bench(['prepare', smoke, ...common(a)]).status, 0);
  const ran = bench(['run', smoke, ...common(a)]);
  assert.equal(ran.status, 0);
  assert.ok(!existsSync(path.join(a.root, 'benchmark')), 'nothing under the Keystone tree');
  const smokeRuns = path.join(a.work, 'smoke', 'results', 'runs');
  const [file] = await readdir(smokeRuns);
  const record = JSON.parse(await readFile(path.join(smokeRuns, file), 'utf8'));
  assert.equal(record.purpose, 'smoke');
  assert.equal(bench(['report', smoke, ...common(a)]).status, 0);
  assert.ok(!existsSync(path.join(a.root, 'benchmark')));
  // Placing a smoke record among an experiment's results is refused.
  const experimentPlan = await writePlan(a, 'smoke', { conditions: [path.join(fixtures, 'conditions', 'plain', 'condition.json')] });
  await put(a.root, `benchmark/results/smoke/runs/${file}`, readFileSync(path.join(smokeRuns, file), 'utf8'));
  const refused = bench(['score', experimentPlan, ...common(a)]);
  assert.equal(refused.status, 1);
  assert.equal(refused.result.diagnostics[0].code, 'BENCH_SMOKE_NOT_EVIDENCE');
});

test('a failed record write installs nothing partial, leaves no temporary file, and is reported truthfully', async t => {
  const a = await area(t);
  const plan = await writePlan(a, 'unwritable', { conditions: [path.join(fixtures, 'conditions', 'plain', 'condition.json')] });
  assert.equal(bench(['prepare', plan, ...common(a)]).status, 0);
  await put(a.root, 'benchmark/results/unwritable/runs', 'a file where the runs directory belongs\n');
  const ran = bench(['run', plan, ...common(a)]);
  assert.equal(ran.status, 2, JSON.stringify(ran.result));
  assert.equal(ran.result.outcome, 'failed');
  assert.equal(ran.result.diagnostics[0].code, 'BENCH_WRITE_FAILED');
  const all = Object.keys(await snapshot(a.root));
  assert.ok(!all.some(f => f.includes('.tmp-')), all.join(', '));
  // A staged temporary file whose rename fails is removed; nothing is installed under the target name.
  const { writeVerified } = await import('../dist/benchmark/store.js');
  const target = path.join(a.base, 'occupied');
  await mkdir(path.join(target, 'child'), { recursive: true });
  const failure = await writeVerified(target, 'contents\n', { base: a.base, forbidden: [a.subject], code: 'BENCH_WORK_INVALID', what: 'Test' });
  assert.equal(failure.diagnostics[0].code, 'BENCH_WRITE_FAILED');
  assert.deepEqual(failure.temporary_files, []);
  assert.deepEqual(await readdir(a.base).then(names => names.filter(n => n.includes('.tmp-'))), []);
  assert.ok((await stat(target)).isDirectory());
  // The workspace is no longer clean, so the run cannot silently continue.
  const again = bench(['run', plan, ...common(a)]);
  assert.equal(again.status, 1);
  assert.equal(again.result.diagnostics[0].code, 'BENCH_RUN_INTERRUPTED');
});
