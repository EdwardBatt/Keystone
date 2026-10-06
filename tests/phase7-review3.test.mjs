// TASK-0013 independent review (Codex, round 3) under the owner's clarified threat boundary: the
// harness defends against deterministic aliases present when it performs an operation (paths,
// symbolic links, junctions, pre-existing hard links), not against concurrent hostile mutation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { cp, link, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { schemaDiagnostics } from '../dist/benchmark/specs.js';
import { snapshot, put } from './helpers.mjs';
import { fixtures, bench, area, writePlan, common, experiment } from './bench-helpers.mjs';

const junction = process.platform === 'win32' ? 'junction' : 'dir';
const plain = path.join(fixtures, 'conditions', 'plain', 'condition.json');
const codes = result => result.diagnostics.map(d => d.code);

async function preparedRun(t, name, fields = {}) {
  const a = await area(t);
  const plan = await writePlan(a, name, { conditions: [plain], ...fields });
  const prepared = bench(['prepare', plan, ...common(a)]);
  assert.equal(prepared.status, 0, JSON.stringify(prepared.result));
  const base = path.join(a.work, 'runs', prepared.result.runs[0].run_id);
  return { a, plan, workspace: path.join(base, 'workspace'), harness: path.join(base, 'harness') };
}

test('review R3-1: a pre-existing snapshots.git alias to a protected repository is refused before any Git operation', async t => {
  const { a, plan, harness } = await preparedRun(t, 'snap-alias');
  await symlink(path.join(a.subject, '.git'), path.join(harness, 'snapshots.git'), junction);
  const before = await snapshot(a.subject);
  const ran = bench(['run', plan, ...common(a)]);
  assert.notEqual(ran.result.outcome, 'completed', JSON.stringify(ran.result));
  assert.equal(ran.result.diagnostics[0].code, 'BENCH_WORK_INVALID', JSON.stringify(ran.result.diagnostics));
  assert.deepEqual(await snapshot(a.subject), before, 'a snapshot operation ran against the subject repository');
});

test('review R3-1 variant: an alias created inside snapshots.git during a session is refused before the next snapshot', async t => {
  const a = await area(t);
  const swapper = path.join(a.base, 'swapper.mjs');
  const task = path.join(a.base, 'swap task');
  await cp(path.join(fixtures, 'tasks', 'change-app'), task, { recursive: true });
  await writeFile(path.join(task, 'session-1.md'), `FAKE * write src/app.txt two\\n\nFAKE * run "${process.execPath}" "${swapper}"\n`);
  const plan = await writePlan(a, 'snap-objects', { tasks: [path.join(task, 'task.json')], conditions: [plain] });
  const prepared = bench(['prepare', plan, ...common(a)]);
  const objects = path.join(a.work, 'runs', prepared.result.runs[0].run_id, 'harness', 'snapshots.git', 'objects');
  // During the session, the snapshot repository's object store becomes a junction to the subject's.
  await writeFile(swapper, `import { renameSync, symlinkSync } from 'node:fs';
renameSync(${JSON.stringify(objects)}, ${JSON.stringify(objects + ' moved')});
symlinkSync(${JSON.stringify(path.join(a.subject, '.git', 'objects'))}, ${JSON.stringify(objects)}, ${JSON.stringify(junction)});
`);
  const before = await snapshot(a.subject);
  const ran = bench(['run', plan, ...common(a)]);
  assert.ok(existsSync(objects + ' moved'), 'the substitution happened during the session');
  assert.notEqual(ran.result.outcome, 'completed', JSON.stringify(ran.result));
  assert.equal(ran.result.diagnostics[0].code, 'BENCH_WORK_INVALID', JSON.stringify(ran.result.diagnostics));
  assert.ok(!codes(ran.result).includes('BENCH_RUN_ERROR'));
  assert.deepEqual(await snapshot(a.subject), before, 'snapshot objects were written into the subject repository');
});

test('review R3-2: a pre-existing hard-linked prompt destination is replaced, never written through', async t => {
  const { a, plan, harness } = await preparedRun(t, 'prompt-link');
  await mkdir(path.join(harness, 'prompts'), { recursive: true });
  await link(path.join(a.subject, 'README.md'), path.join(harness, 'prompts', 's1.md'));
  const before = await snapshot(a.subject);
  const ran = bench(['run', plan, ...common(a)]);
  assert.equal(ran.result.outcome, 'completed', JSON.stringify(ran.result));
  assert.deepEqual(await snapshot(a.subject), before, 'the prompt was written through a hard link into the subject');
  assert.match(await readFile(path.join(harness, 'prompts', 's1.md'), 'utf8'), /FAKE \* write src\/app\.txt too/);
});

test('review R3-2: hard-linked blinded-export destinations never receive packet content', async t => {
  const { a, plan } = await experiment(t, { repetitions: 1, conditions: [plain] }, 'packet-link');
  const before = await snapshot(a.subject);
  // A destination already holding a hard link into the subject is not empty, and is refused.
  const packet = path.join(a.base, 'linked packet');
  await mkdir(packet, { recursive: true });
  await link(path.join(a.subject, 'README.md'), path.join(packet, 'packet.json'));
  const refused = bench(['score', plan, ...common(a), '--blind', packet]);
  assert.equal(refused.status, 1, JSON.stringify(refused.result));
  assert.equal(refused.result.diagnostics[0].code, 'BENCH_BLIND_OUTPUT_INVALID');
  assert.deepEqual(await snapshot(a.subject), before);
  // Every harness output write (packet files included) replaces the entry rather than writing
  // through it, so even a hard-linked file at a destination is never modified.
  const { writeVerified } = await import('../dist/benchmark/store.js');
  const target = path.join(a.base, 'hard-linked output.json');
  await link(path.join(a.subject, 'src', 'app.txt'), target);
  const failure = await writeVerified(target, '{"packet":true}\n', { base: a.base, forbidden: [a.subject], code: 'BENCH_BLIND_OUTPUT_INVALID', what: 'Test' });
  assert.equal(failure, null);
  assert.equal(await readFile(target, 'utf8'), '{"packet":true}\n');
  assert.deepEqual(await snapshot(a.subject), before, 'output was written through a hard link into the subject');
  // The export itself writes its files through the same replace strategy.
  assert.equal(bench(['score', plan, ...common(a), '--blind', path.join(a.base, 'fresh packet')]).status, 0);
  assert.deepEqual(await snapshot(a.subject), before);
});

test('review R3-3: a trusted model list whose serialization exceeds the durable bound is rejected at validation', async t => {
  const a = await area(t);
  const longModel = i => `model-${String(i).padStart(2, '0')}-${'x'.repeat(100)}`;
  const tooMany = { tools: ['fake-agent'], models: [longModel(1), longModel(2), longModel(3)] };
  const profile = path.join(a.base, 'wide profile');
  const spec = JSON.parse(await readFile(path.join(fixtures, 'profiles', 'fake', 'profile.json'), 'utf8'));
  await cp(path.join(fixtures, 'profiles', 'fake'), profile, { recursive: true });
  await writeFile(path.join(profile, 'profile.json'), JSON.stringify({ ...spec, trusted: tooMany }));
  // Each identifier is individually schema-valid.
  assert.deepEqual(tooMany.models.map(m => schemaDiagnostics('agent-profile', { ...spec, trusted: { models: [m] } }, 'p').length), [0, 0, 0]);
  const plan = await writePlan(a, 'wide', { conditions: [plain], profiles: [path.join(profile, 'profile.json')] });
  const validated = bench(['validate', plan]);
  assert.equal(validated.status, 1, JSON.stringify(validated.result));
  assert.ok(codes(validated.result).includes('BENCH_TRUSTED_IDENTITY_INVALID'), JSON.stringify(validated.result.diagnostics));
  assert.equal(bench(['prepare', plan, ...common(a)]).status, 1);
  // Trusted entries may not contain the list separator.
  await writeFile(path.join(profile, 'profile.json'), JSON.stringify({ ...spec, trusted: { tools: [], models: ['a,b'] } }));
  assert.equal(bench(['validate', plan]).status, 1);
  // At the bound, every reported combination serializes to a schema-valid durable record.
  const { parseUsage } = await import('../dist/benchmark/run.js');
  const fits = { models: [longModel(1), `model-02-${'y'.repeat(137)}`] };
  assert.equal(fits.models.join(',').length, 256);
  await writeFile(path.join(profile, 'profile.json'), JSON.stringify({ ...spec, trusted: fits }));
  assert.equal(bench(['validate', plan]).status, 0);
  const usage = parseUsage('keystone-bench-json', Buffer.alloc(0), { tool: 'fake-agent', model: fits.models.join(',') }, fits);
  assert.equal(usage.model, [...fits.models].sort().join(','));
  const record = { kind: 'keystone-bench-manual-record', schema_version: 1, fix_sessions: 0, sessions: [{ id: 's1', status: 'ok', duration_seconds: 1, usage }] };
  assert.deepEqual(schemaDiagnostics('manual-record', record, 'r'), []);
});
