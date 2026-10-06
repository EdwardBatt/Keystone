// TASK-0013 independent review (Codex, round 2) remediation: descendant alias substitution after
// earlier validation, blinded-export destinations, and trusted identity for reported identifiers.
// Each test reproduces Codex's bypass or an adjacent variant.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { cp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { snapshot } from './helpers.mjs';
import { fixtures, bench, area, writePlan, common, records, experiment } from './bench-helpers.mjs';

const junction = process.platform === 'win32' ? 'junction' : 'dir';
const plain = path.join(fixtures, 'conditions', 'plain', 'condition.json');
const codes = result => result.diagnostics.map(d => d.code);

/** Prepares a one-run plain plan and returns its run paths. */
async function preparedRun(t, name, fields = {}) {
  const a = await area(t);
  const plan = await writePlan(a, name, { conditions: [plain], ...fields });
  const prepared = bench(['prepare', plan, ...common(a)]);
  assert.equal(prepared.status, 0, JSON.stringify(prepared.result));
  const id = prepared.result.runs[0].run_id;
  const base = path.join(a.work, 'runs', id);
  return { a, plan, id, base, workspace: path.join(base, 'workspace'), harness: path.join(base, 'harness') };
}
async function noRecords(a, plan) {
  const directory = path.join(a.root, 'benchmark', 'results', plan, 'runs');
  try { return (await readdir(directory)).length === 0; } catch { return true; }
}

test('review R2-B2a: a workspace replaced by a junction to the subject after prepare is refused before anything runs', async t => {
  const { a, plan, workspace } = await preparedRun(t, 'ws-swap');
  await fs.rm(workspace, { recursive: true, force: true });
  await symlink(a.subject, workspace, junction);
  const before = await snapshot(a.subject);
  const ran = bench(['run', plan, ...common(a)]);
  assert.notEqual(ran.result.outcome, 'completed', JSON.stringify(ran.result));
  assert.ok(codes(ran.result).includes('BENCH_WORK_INVALID'), JSON.stringify(ran.result.diagnostics));
  assert.deepEqual(await snapshot(a.subject), before, 'the run modified the subject through a substituted workspace');
  assert.ok(await noRecords(a, 'ws-swap'));
});

test('review R2-B2a variant: a harness directory substituted during a session stops the run before the next harness write', async t => {
  // During its first session the agent swaps the run's harness directory for a junction to an
  // empty directory inside the subject. The agent itself writes nothing there; any later write
  // into the subject would be the harness's own (snapshot index, prompts, state, usage).
  const a = await area(t);
  await mkdir(path.join(a.subject, 'empty'), { recursive: true });
  const swapper = path.join(a.base, 'swapper.mjs');
  const task = path.join(a.base, 'swap task');
  await cp(path.join(fixtures, 'tasks', 'change-app'), task, { recursive: true });
  await writeFile(path.join(task, 'session-1.md'), `FAKE * run "${process.execPath}" "${swapper}"\n`);
  const plan = await writePlan(a, 'mid-swap', { tasks: [path.join(task, 'task.json')], conditions: [plain] });
  const prepared = bench(['prepare', plan, ...common(a)]);
  assert.equal(prepared.status, 0, JSON.stringify(prepared.result));
  const harness = path.join(a.work, 'runs', prepared.result.runs[0].run_id, 'harness');
  // The swapper lives outside every bundle, so writing it now does not change the plan.
  await writeFile(swapper, `import { renameSync, symlinkSync } from 'node:fs';
renameSync(${JSON.stringify(harness)}, ${JSON.stringify(harness + ' moved')});
symlinkSync(${JSON.stringify(path.join(a.subject, 'empty'))}, ${JSON.stringify(harness)}, ${JSON.stringify(junction)});
`);
  const before = await snapshot(a.subject);
  const ran = bench(['run', plan, ...common(a)]);
  assert.ok(existsSync(harness + ' moved'), 'the substitution happened during the session');
  assert.notEqual(ran.result.outcome, 'completed', JSON.stringify(ran.result));
  assert.equal(ran.result.diagnostics[0].code, 'BENCH_WORK_INVALID', JSON.stringify(ran.result.diagnostics));
  // The refusal comes from the point-of-use check, before any harness operation (such as a Git
  // snapshot) is attempted on the substituted path, not from that operation happening to fail.
  assert.ok(!codes(ran.result).includes('BENCH_RUN_ERROR'), JSON.stringify(ran.result.diagnostics));
  assert.deepEqual(await snapshot(a.subject), before, 'the harness wrote into the subject after the substitution');
  assert.ok(await noRecords(a, 'mid-swap'));
});

test('review R2-B2b: a results runs directory substituted by a junction to the subject never receives a record', async t => {
  const { a, plan } = await preparedRun(t, 'runs-swap');
  await mkdir(path.join(a.root, 'benchmark', 'results', 'runs-swap'), { recursive: true });
  await symlink(a.subject, path.join(a.root, 'benchmark', 'results', 'runs-swap', 'runs'), junction);
  const before = await snapshot(a.subject);
  const ran = bench(['run', plan, ...common(a)]);
  assert.notEqual(ran.result.outcome, 'completed', JSON.stringify(ran.result));
  assert.ok(codes(ran.result).includes('BENCH_RESULTS_INVALID'), JSON.stringify(ran.result.diagnostics));
  assert.deepEqual(await snapshot(a.subject), before, 'a durable record was installed inside the subject');
});

test('review R2-B2c: harness, judgements and analysis destinations substituted by junctions are refused at the point of use', async t => {
  // The run's harness directory (state, shims, prompts, snapshots) swapped for a junction into the subject.
  const r = await preparedRun(t, 'harness-swap');
  const inside = path.join(r.a.subject, 'harness copy');
  await cp(r.harness, inside, { recursive: true });
  await fs.rm(r.harness, { recursive: true, force: true });
  await symlink(inside, r.harness, junction);
  const before = await snapshot(r.a.subject);
  const ran = bench(['run', r.plan, ...common(r.a)]);
  assert.notEqual(ran.result.outcome, 'completed', JSON.stringify(ran.result));
  assert.ok(codes(ran.result).includes('BENCH_WORK_INVALID'), JSON.stringify(ran.result.diagnostics));
  assert.deepEqual(await snapshot(r.a.subject), before, 'harness state, shims or snapshots were written into the subject');
  // Judgement import into a judgements directory that is a junction into the subject.
  const { a, plan } = await experiment(t, { repetitions: 1, conditions: [plain] }, 'judge-swap');
  const packet = path.join(a.base, 'judge packet');
  assert.equal(bench(['score', plan, ...common(a), '--blind', packet]).status, 0);
  const data = JSON.parse(await readFile(path.join(packet, 'packet.json'), 'utf8'));
  const judgements = path.join(a.base, 'judgements.json');
  await writeFile(judgements, JSON.stringify({ kind: 'keystone-bench-judgements', schema_version: 1, plan: data.plan,
    attestation: { judge: 'j', procedure: data.procedure, date: '2026-10-06', statement: 'Blind.' },
    judgements: data.items.map(i => ({ blind_id: i.blind_id, verdict: 'approve', blocking: 0, non_blocking: 0 })) }));
  await symlink(a.subject, path.join(a.root, 'benchmark', 'results', 'judge-swap', 'judgements'), junction);
  const subjectBefore = await snapshot(a.subject);
  const imported = bench(['score', plan, ...common(a), '--judged', judgements]);
  assert.notEqual(imported.status, 0, JSON.stringify(imported.result));
  assert.ok(codes(imported.result).includes('BENCH_RESULTS_INVALID'), JSON.stringify(imported.result.diagnostics));
  assert.deepEqual(await snapshot(a.subject), subjectBefore, 'a judgement record was written into the subject');
  // Analysis output whose plan directory is a junction into the subject.
  await fs.rm(path.join(a.root, 'benchmark', 'results', 'judge-swap', 'judgements'));
  await fs.rm(path.join(a.root, 'benchmark', 'analysis', 'judge-swap'), { recursive: true, force: true });
  await symlink(a.subject, path.join(a.root, 'benchmark', 'analysis', 'judge-swap'), junction);
  for (const command of ['score', 'report']) {
    const refused = bench([command, plan, ...common(a)]);
    assert.notEqual(refused.status, 0, `${command}: ${JSON.stringify(refused.result)}`);
    assert.ok(codes(refused.result).includes('BENCH_RESULTS_INVALID'), command);
  }
  assert.deepEqual(await snapshot(a.subject), subjectBefore, 'analysis was written into the subject');
});

test('review R2-new: a blinded export destination physically inside the subject is refused and writes nothing', async t => {
  const { a, plan } = await experiment(t, { repetitions: 1, conditions: [plain] }, 'blind-swap');
  // Codex's case: an empty destination reached through a junction into the subject.
  await symlink(a.subject, path.join(a.base, 'subject alias'), junction);
  const before = await snapshot(a.subject);
  const through = bench(['score', plan, ...common(a), '--blind', path.join(a.base, 'subject alias', 'packet')]);
  assert.equal(through.status, 1, JSON.stringify(through.result));
  assert.equal(through.result.diagnostics[0].code, 'BENCH_BLIND_OUTPUT_INVALID');
  assert.deepEqual(await snapshot(a.subject), before, 'packet files were written into the subject');
  // Adjacent: the destination itself is a junction to an empty directory inside the subject.
  await mkdir(path.join(a.subject, 'empty'), { recursive: true });
  const withEmpty = await snapshot(a.subject);
  await symlink(path.join(a.subject, 'empty'), path.join(a.base, 'packet link'), junction);
  const linked = bench(['score', plan, ...common(a), '--blind', path.join(a.base, 'packet link')]);
  assert.equal(linked.status, 1, JSON.stringify(linked.result));
  assert.equal(linked.result.diagnostics[0].code, 'BENCH_BLIND_OUTPUT_INVALID');
  // Adjacent: a destination reached through a junction into the work directory or the Keystone tree.
  await symlink(a.work, path.join(a.base, 'work alias'), junction);
  assert.equal(bench(['score', plan, ...common(a), '--blind', path.join(a.base, 'work alias', 'packet')]).result.diagnostics[0].code, 'BENCH_BLIND_OUTPUT_INVALID');
  await symlink(a.root, path.join(a.base, 'root alias'), junction);
  assert.equal(bench(['score', plan, ...common(a), '--blind', path.join(a.base, 'root alias', 'packet')]).result.diagnostics[0].code, 'BENCH_BLIND_OUTPUT_INVALID');
  assert.deepEqual(await snapshot(a.subject), withEmpty, 'packet files were written into the subject');
  assert.ok(!existsSync(path.join(a.work, 'packet')) && !existsSync(path.join(a.root, 'packet')));
  // A legitimate external destination still works.
  assert.equal(bench(['score', plan, ...common(a), '--blind', path.join(a.base, 'real packet')]).status, 0);
});

test('review R2-B8: only declared, trusted identities are persisted; arbitrary agent-reported identifiers never are', async t => {
  const a = await area(t);
  const task = path.join(a.base, 'trusted identity task');
  await cp(path.join(fixtures, 'tasks', 'change-app'), task, { recursive: true });
  await writeFile(path.join(task, 'session-1.md'), 'FAKE * identity fake-agent SECRET_TASK_CHANGE_SRC_APP_TXT_TO_TWO\nFAKE * write src/app.txt two\\n\n');
  await writeFile(path.join(task, 'session-2.md'), 'FAKE * identity https://example.invalid/leak?task=change-app fake-model\n');
  const plan = await writePlan(a, 'trusted', { tasks: [path.join(task, 'task.json')], conditions: [plain] });
  assert.equal(bench(['prepare', plan, ...common(a)]).status, 0);
  assert.equal(bench(['run', plan, ...common(a)]).status, 0);
  const [record] = await records(a, 'trusted');
  const text = JSON.stringify(record);
  assert.ok(!text.includes('SECRET_TASK') && !text.includes('example.invalid'), 'an untrusted reported identifier entered the record');
  assert.deepEqual(record.sessions.map(s => [s.usage.tool, s.usage.model, s.usage.unrecognized_identity]), [['fake-agent', null, true], [null, 'fake-model', true]]);
  const { parseUsage } = await import('../dist/benchmark/run.js');
  const trusted = { tools: ['claude-code'], models: ['claude-sonnet-5-5', 'claude-haiku-4-5'] };
  const output = models => Buffer.from(JSON.stringify({ num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: Object.fromEntries(models.map(m => [m, {}])) }));
  const pick = u => [u.tool, u.model, u.unrecognized_identity];
  // Legitimate Claude Code multi-model reporting is preserved when every model is trusted.
  assert.deepEqual(pick(parseUsage('claude-code-json', output(['claude-sonnet-5-5', 'claude-haiku-4-5']), undefined, trusted)), ['claude-code', 'claude-haiku-4-5,claude-sonnet-5-5', undefined]);
  assert.deepEqual(pick(parseUsage('claude-code-json', output(['claude-sonnet-5-5', 'SECRET_TASK_CHANGE_SRC_APP_TXT_TO_TWO']), undefined, trusted)), ['claude-code', 'claude-sonnet-5-5', true]);
  assert.deepEqual(pick(parseUsage('claude-code-json', output(['claude-sonnet-5-5']), undefined, { tools: [], models: [] })), ['claude-code', null, true]);
  // A manual record may only name the profile's trusted identities.
  const m = await area(t);
  const manualPlan = await writePlan(m, 'manual-identity', { conditions: [plain], profiles: [path.join(fixtures, 'profiles', 'manual', 'profile.json')] });
  assert.equal(bench(['prepare', manualPlan, ...common(m)]).status, 0);
  const waiting = bench(['run', manualPlan, ...common(m)]).result;
  const input = path.join(m.base, 'manual.json');
  const usage = model => ({ input_tokens: 1, output_tokens: 1, turns: 1, tool_calls: 1, tool: 'person', model });
  await writeFile(input, JSON.stringify({ kind: 'keystone-bench-manual-record', schema_version: 1, fix_sessions: 0,
    sessions: [{ id: 's1', status: 'ok', duration_seconds: 1, usage: usage('SECRET_TASK_CHANGE_SRC_APP_TXT_TO_TWO') }, { id: 's2', status: 'ok', duration_seconds: 1, usage: usage(null) }] }));
  const refused = bench(['record', waiting.runs[0].run_id, '--plan', manualPlan, '--input', input, ...common(m)]);
  assert.equal(refused.status, 1, JSON.stringify(refused.result));
  assert.equal(refused.result.diagnostics[0].code, 'BENCH_MANUAL_RECORD_INVALID');
});
