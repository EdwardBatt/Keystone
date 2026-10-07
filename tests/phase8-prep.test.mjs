import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, readdir, rename, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadPlan, schemaDiagnostics, directoryHash, planDirectoryHashes } from '../dist/benchmark/specs.js';
import { parseUsage } from '../dist/benchmark/run.js';
import { classify, estimate, relativeReduction, improves, deteriorates, required } from '../dist/benchmark/analysis.js';
import { auditSample, redact } from '../dist/benchmark/judging.js';
import { requiredR, sampleSd } from '../dist/benchmark/calibrate.js';
import { archiveHash } from '../dist/benchmark/attempts.js';
import { compileStart } from '../dist/commands/start.js';
import { loadConfig } from '../dist/context/config.js';
import { inspect } from '../dist/commands/index.js';
import { temporary, put, artifact, project } from './helpers.mjs';
import { fixtures, git, bench, writePlan, common } from './bench-helpers.mjs';
import { area2, commitRoot, writePlan2, opts, freezePlan, ran2, readJsonFile, results, analysisDir, defaultAnalysis, defaultCalibration, calibratedPilot } from './bench2-helpers.mjs';

/** TASK-0015: Phase 8 preparation items 1–10 and the C1 benchmark/plans exclusion. Offline, synthetic. */

test('version 1 plans, profiles and records keep their Phase 7 semantics; codex-jsonl is an additive parser value', async t => {
  const a = await area2(t);
  const v1 = await writePlan(a, 'v1-plan');
  const loaded = await loadPlan(v1);
  assert.equal(loaded.plan.version, 1);
  assert.equal(loaded.plan.subject.id, 'fixture');
  // A version 1 plan cannot reference a version 2 profile.
  const mixed = await writePlan(a, 'v1-mixed', { profiles: [path.join(a.root, 'fixtures', 'profiles', 'fake', 'profile.json')] });
  assert.ok((await loadPlan(mixed)).diagnostics.some(d => d.code === 'BENCH_SPEC_INVALID' && /version 2 profile/.test(d.message)));
  // The new parser value is accepted by the version 1 profile schema, so no version 1 material is invalidated.
  const v1profile = JSON.parse(await readFile(path.join(fixtures, 'profiles', 'fake', 'profile.json'), 'utf8'));
  assert.deepEqual(schemaDiagnostics('agent-profile', { ...v1profile, usage: 'codex-jsonl' }, 'p'), []);
  // A version 1 run still writes a version 1 record with Phase 7 provenance.
  assert.equal(bench(['prepare', v1, ...common(a)]).result.outcome, 'prepared');
  assert.equal(bench(['run', v1, ...common(a)]).result.outcome, 'completed');
  const [name] = await readdir(results(a, 'v1-plan', 'runs'));
  const record = await readJsonFile(results(a, 'v1-plan', 'runs', name));
  assert.equal(record.schema_version, 1);
  assert.ok(record.provenance.subject && !record.provenance.repositories && !('attempt' in record.provenance) && !('observed' in record.provenance.profile));
  // Version 2 commands are refused for version 1 plans.
  const classification = path.join(a.base, 'c.json');
  await writeFile(classification, '{}');
  assert.equal(bench(['rerun', record.run_id, '--plan', v1, '--classification', classification, ...common(a)]).result.diagnostics[0].code, 'BENCH_RERUN_UNSUPPORTED');
  assert.equal(bench(['verify-exposure', v1, ...common(a)]).result.diagnostics[0].code, 'BENCH_EXPOSURE_UNSUPPORTED');
});

test('a version 2 plan names repositories by ID: structural validation always, resolution only with a locations file', async t => {
  const a = await area2(t);
  const plan = await writePlan2(a, 'structural');
  const unresolved = bench(['validate', plan, '--root', a.root]);
  assert.equal(unresolved.status, 0);
  assert.equal(unresolved.result.outcome, 'valid');
  assert.equal(unresolved.result.resolved, false);
  assert.equal(unresolved.result.plan, null);
  assert.deepEqual(unresolved.result.diagnostics.map(d => d.code), ['BENCH_REPOSITORY_UNAVAILABLE', 'BENCH_REPOSITORY_UNAVAILABLE']);
  // Every other plan command needs the repositories.
  assert.equal(bench(['prepare', plan, '--root', a.root, '--work', a.work]).result.outcome, 'blocked');
  const resolved = bench(['validate', plan, '--root', a.root, '--repos', a.repos]);
  assert.equal(resolved.result.outcome, 'valid', JSON.stringify(resolved.result));
  assert.equal(resolved.result.resolved, true);
  assert.match(resolved.result.plan.hash, /^[a-f0-9]{64}$/);
  // The plan file is <plan-id>/plan.json; structural errors are reported without any repository.
  const elsewhere = path.join(a.base, 'wrong-name', 'plan.json');
  await mkdir(path.dirname(elsewhere), { recursive: true });
  await cp(plan, elsewhere);
  assert.equal(bench(['validate', elsewhere]).result.diagnostics[0].code, 'BENCH_PLAN_LOCATION_INVALID');
  // The locations file is machine-local: never inside the Keystone tree.
  const inside = path.join(a.root, 'locations.json');
  await cp(a.repos, inside);
  assert.equal(bench(['validate', plan, '--root', a.root, '--repos', inside]).result.diagnostics[0].code, 'BENCH_LOCATIONS_INVALID');
  // Plan-directory files are part of the plan hash: a changed analysis specification is a changed plan.
  const analysis = path.join(path.dirname(plan), 'analysis.json');
  await writeFile(analysis, JSON.stringify(defaultAnalysis({ description: 'changed' })));
  assert.notEqual(bench(['validate', plan, '--root', a.root, '--repos', a.repos]).result.plan.hash, resolved.result.plan.hash);
});

test('pinned repositories must contain their commit, sit at it, and be clean under referenced bundles', async t => {
  const a = await area2(t);
  const plan = await writePlan2(a, 'pins');
  const codes = () => bench(['validate', plan, '--root', a.root, '--repos', a.repos]).result.diagnostics.map(d => d.code);
  await writeFile(path.join(a.benchRepo, 'tasks', 'change-app', 'statement.md'), 'tampered\n');
  assert.deepEqual(codes(), ['BENCH_REPOSITORY_DIRTY']);
  git(a.benchRepo, 'checkout', '--quiet', '--', '.');
  await writeFile(path.join(a.benchRepo, 'tasks', 'change-app', 'extra.md'), 'untracked\n');
  assert.deepEqual(codes(), ['BENCH_REPOSITORY_DIRTY']);
  await rm(path.join(a.benchRepo, 'tasks', 'change-app', 'extra.md'));
  await writeFile(path.join(a.benchRepo, 'later.md'), 'later\n');
  git(a.benchRepo, 'add', '-A');
  git(a.benchRepo, 'commit', '--quiet', '-m', 'later');
  assert.deepEqual(codes(), ['BENCH_REPOSITORY_NOT_AT_COMMIT']);
  await writePlan2(a, 'pins', { repositories: { subject: { id: 'fixture-app', commit: a.commit }, benchmark: { id: 'fixture-bench', commit: 'f'.repeat(40) } } });
  assert.deepEqual(codes(), ['BENCH_REPOSITORY_COMMIT_MISSING']);
});

test('experiment plans run only from benchmark/plans/<id>/ and only once frozen; a frozen plan never changes', async t => {
  const a = await area2(t);
  const plan = await writePlan2(a, 'gated', { calibrated_from: await calibratedPilot(a) });
  assert.equal(bench(['prepare', plan, ...opts(a)]).result.diagnostics[0].code, 'BENCH_PLAN_NOT_FROZEN');
  // Not at the canonical location for this --root.
  const copy = path.join(a.base, 'copies', 'gated', 'plan.json');
  await cp(path.dirname(plan), path.dirname(copy), { recursive: true });
  assert.equal(bench(['prepare', copy, ...opts(a)]).result.diagnostics[0].code, 'BENCH_PLAN_LOCATION_INVALID');
  // Freezing needs a passing exposure verification and a committed plan directory.
  let frozen = bench(['freeze', plan, ...opts(a)]);
  assert.deepEqual(frozen.result.diagnostics.map(d => d.code).sort(), ['BENCH_EXPOSURE_NOT_VERIFIED', 'BENCH_KEYSTONE_DIRTY']);
  assert.equal(bench(['verify-exposure', plan, ...opts(a)]).result.outcome, 'verified');
  frozen = bench(['freeze', plan, ...opts(a)]);
  assert.deepEqual(frozen.result.diagnostics.map(d => d.code), ['BENCH_KEYSTONE_DIRTY']);
  commitRoot(a);
  frozen = bench(['freeze', plan, ...opts(a)]);
  assert.equal(frozen.result.outcome, 'frozen', JSON.stringify(frozen.result));
  const record = await readJsonFile(path.join(path.dirname(plan), 'freeze.json'));
  assert.equal(record.plan.hash, frozen.result.plan.hash);
  assert.deepEqual(Object.keys(record.files).sort(), ['analysis.json', 'plan.json', 'preregistration.md']);
  assert.ok(record.exposure_verification);
  assert.equal(bench(['freeze', plan, ...opts(a)]).result.outcome, 'unchanged');
  assert.equal(bench(['prepare', plan, ...opts(a)]).result.outcome, 'prepared');
  // Any later change to the plan directory is refused everywhere.
  await writeFile(path.join(path.dirname(plan), 'preregistration.md'), '# changed\n');
  assert.equal(bench(['freeze', plan, ...opts(a)]).result.diagnostics[0].code, 'BENCH_PLAN_CHANGED');
  assert.equal(bench(['prepare', plan, ...opts(a)]).result.diagnostics[0].code, 'BENCH_PLAN_NOT_FROZEN');
});

test('version probe pins the tool version; version 2 records carry both repositories, observed identity and the attempt', async t => {
  const a = await area2(t);
  const plan = await writePlan2(a, 'identity', { calibrated_from: await calibratedPilot(a), repetitions: 1, conditions: [{ repository: 'benchmark', path: 'conditions/plain' }, { repository: 'benchmark', path: 'conditions/other-model' }] },
    { analysis: defaultAnalysis({ conditions: { reference: 'plain', treatment: 'other-model' } }) });
  await freezePlan(a, plan);
  assert.equal(bench(['prepare', plan, ...opts(a)]).result.outcome, 'prepared');
  // A trusted but different version, and an untrusted string: nothing starts, no attempt is consumed.
  for (const [version, said] of [['fake-agent 2.0.0', /reported fake-agent 2\.0\.0/], ['UNTRUSTED-VERSION-TEXT', /untrusted version/]]) {
    const refused = bench(['run', plan, ...opts(a)], { FAKE_AGENT_VERSION: version });
    assert.equal(refused.result.outcome, 'blocked');
    assert.ok(refused.result.diagnostics.every(d => d.code === 'BENCH_TOOL_VERSION_MISMATCH' && said.test(d.message)));
    assert.ok(!JSON.stringify(refused.result).includes('UNTRUSTED-VERSION-TEXT'));
  }
  for (const run of await readdir(path.join(a.work, 'runs'))) assert.equal((await readJsonFile(path.join(a.work, 'runs', run, 'harness', 'state.json'))).status, 'prepared');
  assert.equal(bench(['run', plan, ...opts(a)]).result.outcome, 'completed');
  const records = await Promise.all((await readdir(results(a, 'identity', 'runs'))).map(n => readJsonFile(results(a, 'identity', 'runs', n))));
  for (const record of records) {
    assert.equal(record.schema_version, 2);
    assert.deepEqual(record.provenance.repositories, { subject: { id: 'fixture-app', commit: a.commit }, benchmark: { id: 'fixture-bench', commit: a.benchCommit } });
    assert.equal(record.provenance.attempt, 1);
    assert.equal(record.provenance.profile.declared.tool_version, 'fake-agent 1.0.0');
    assert.equal(record.provenance.profile.observed.tool_version, 'fake-agent 1.0.0');
    assert.equal(record.provenance.profile.observed.tool_version_source, 'deterministic');
  }
  const other = records.find(r => r.provenance.condition.id === 'other-model');
  assert.ok(other.sessions.every(s => s.usage.model_mismatch === true));
  assert.deepEqual(other.provenance.profile.observed.models, ['fake-model-other']);
  assert.ok(records.find(r => r.provenance.condition.id === 'plain').sessions.every(s => !s.usage.model_mismatch));
  // Mismatches are listed by report, never excluded.
  const reported = bench(['report', plan, ...opts(a)]);
  assert.equal(reported.result.outcome, 'reported');
  const body = await readJsonFile(analysisDir(a, 'identity', 'report.json'));
  assert.deepEqual(body.identity.model_mismatch, [other.run_id]);
  assert.equal(body.arms.length, 2);
});

test('the codex-jsonl parser maps the synthetic, unverified stream and never fabricates zero usage', async () => {
  const stream = await readFile(path.join(fixtures, 'usage', 'codex-jsonl.synthetic.jsonl'));
  assert.match(await readFile(path.join(fixtures, 'usage', 'README.md'), 'utf8'), /SYNTHETIC AND UNVERIFIED/);
  const usage = parseUsage('codex-jsonl', stream, undefined, {});
  assert.deepEqual(usage, { input_tokens: 1500, output_tokens: 200, turns: 2, tool_calls: 3, tool: 'codex', model: null });
  assert.ok(!JSON.stringify(usage).includes('SYNTHETIC'));
  assert.equal(parseUsage('codex-jsonl', Buffer.from('{"type":"thread.started"}\nnot json\n'), undefined, {}), null);
  assert.equal(parseUsage('codex-jsonl', Buffer.alloc(0), undefined, {}), null);
  const partial = parseUsage('codex-jsonl', Buffer.from('{"type":"turn.completed","usage":{"input_tokens":5}}\n'), undefined, {});
  assert.equal(partial.input_tokens, null);
  assert.equal(partial.turns, 1);
});

test('rerun archives an infrastructure-failed attempt without deleting it, within the plan limit, before any scoring', async t => {
  const a = await area2(t);
  const { plan } = await ran2(a, 'attempts', { repetitions: 1, limits: { session_timeout_seconds: 60, setup_timeout_seconds: 120, oracle_timeout_seconds: 60, max_infrastructure_reruns: 1 } });
  const [name] = (await readdir(results(a, 'attempts', 'runs'))).sort();
  const runId = name.replace(/\.json$/, '');
  const classification = async (fields = {}) => {
    const file = path.join(a.base, `classification-${Math.random().toString(16).slice(2)}.json`);
    await writeFile(file, JSON.stringify({ kind: 'keystone-bench-attempt-classification', schema_version: 1, run_id: runId, attempt: 1, class: 'infrastructure', cause: 'provider-outage', evidence: ['harness/state.json'], classified_by: 'owner', date: '2026-10-07', note: 'synthetic outage', ...fields }));
    return file;
  };
  const rerun = async fields => bench(['rerun', runId, '--plan', plan, '--classification', await classification(fields), ...opts(a)]);
  assert.equal((await rerun({ attempt: 2 })).result.diagnostics[0].code, 'BENCH_ATTEMPT_CLASSIFICATION_INVALID');
  assert.equal((await rerun({ class: 'agent' })).result.diagnostics[0].code, 'BENCH_ATTEMPT_CLASSIFICATION_INVALID');
  const classify = async fields => bench(['classify', runId, '--plan', plan, '--classification', await classification(fields), ...opts(a)]);
  assert.equal((await classify()).result.diagnostics[0].code, 'BENCH_RERUN_AVAILABLE');
  // Finding 6: an interrupted transition (the run directory archived, nothing logged yet) can never
  // reset the numbering. A fresh prepare refuses; the same rerun command resumes it.
  const archive = path.join(a.work, 'attempts', runId, '1');
  await mkdir(path.dirname(archive), { recursive: true });
  await rename(path.join(a.work, 'runs', runId), archive);
  assert.equal(bench(['prepare', plan, ...opts(a)]).result.diagnostics[0].code, 'BENCH_ATTEMPT_HISTORY_INCOMPLETE');
  const done = await rerun();
  assert.equal(done.result.outcome, 'prepared', JSON.stringify(done.result));
  assert.equal(done.result.attempt, 2);
  assert.equal(done.result.resumed, true);
  // Moved, never deleted: the whole run directory and its record, with the classification.
  for (const file of ['workspace', 'harness/state.json', 'record.json', 'classification.json']) assert.ok(existsSync(path.join(archive, file)), file);
  assert.ok(!existsSync(results(a, 'attempts', 'runs', name)));
  const log = await readJsonFile(results(a, 'attempts', 'attempts', name));
  assert.equal(log.attempts.length, 1);
  assert.equal(log.attempts[0].classification.cause, 'provider-outage');
  assert.ok(log.attempts[0].record_archived && /^[a-f0-9]{64}$/.test(log.attempts[0].archive_hash));
  assert.ok(!JSON.stringify(log).includes('synthetic outage'), 'free text stays in the work directory');
  // A preparation lost after the log was written is redone by prepare as attempt 2, never attempt 1.
  await rm(path.join(a.work, 'runs', runId), { recursive: true });
  assert.equal(bench(['prepare', plan, ...opts(a)]).result.outcome, 'prepared');
  assert.equal((await readJsonFile(path.join(a.work, 'runs', runId, 'harness', 'state.json'))).attempt, 2);
  // The rerun is attempt 2 of the same planned run; only it supplies evidence.
  assert.equal(bench(['run', plan, ...opts(a)]).result.outcome, 'completed');
  assert.equal((await readJsonFile(results(a, 'attempts', 'runs', name))).provenance.attempt, 2);
  assert.equal((await rerun({ attempt: 2 })).result.diagnostics[0].code, 'BENCH_RERUN_EXHAUSTED');
  // Finding 7: the exhausted infrastructure failure is recorded as terminal, and is then missing.
  const terminal = await classify({ attempt: 2 });
  assert.equal(terminal.result.outcome, 'classified', JSON.stringify(terminal.result));
  const after = await readJsonFile(results(a, 'attempts', 'attempts', name));
  assert.deepEqual(after.attempts.map(e => [e.attempt, e.terminal]), [[1, false], [2, true]]);
  assert.equal((await rerun({ attempt: 2 })).result.diagnostics[0].code, 'BENCH_ATTEMPT_TERMINAL');
  assert.equal((await classify({ attempt: 2 })).result.diagnostics[0].code, 'BENCH_ATTEMPT_TERMINAL');
  const analyzed = bench(['analyze', plan, ...opts(a)]);
  assert.equal(analyzed.result.outcome, 'analyzed', JSON.stringify(analyzed.result));
  const body = await readJsonFile(analysisDir(a, 'attempts', 'analysis.json'));
  assert.equal(body.matrix.infrastructure_missing, 1);
  assert.equal(body.matrix.missing, 1);
  assert.equal(body.classification.overall, 'unclassifiable', 'the terminal run is missing, never an outcome');
  assert.equal((await rerun({ attempt: 2 })).result.diagnostics[0].code, 'BENCH_RERUN_AFTER_SCORING');
});

test('version 2 judging: symmetric inspection, audit sample, owner release gate, per-judge judgements, verdicts never averaged', async t => {
  const a = await area2(t);
  const judging = {
    procedure: 'Blinded review of the statement and the change.',
    judges: [
      { id: 'vendor-a', role: 'vendor', kind: 'model', model: 'judge-a', version: 'judge-a 1' },
      { id: 'vendor-b', role: 'vendor', kind: 'model', model: 'judge-b', version: 'judge-b 1' },
      { id: 'owner', role: 'audit', kind: 'owner' },
    ],
    audit: { judge: 'owner', fraction: 0.5, seed: 3, stratify: 'task' },
    rubric: { repository: 'benchmark', path: 'judging/rubric' },
    prompt: { repository: 'benchmark', path: 'judging/prompt' },
    inspection: { terms: ['terms.json'], replacement: '[REDACTED]' },
  };
  const terms = { kind: 'keystone-bench-inspection-terms', schema_version: 1, id: 'experiment-terms', terms: [{ id: 'constructor', literal: 'PROMPT-CONTENT-MARKER' }] };
  const { plan } = await ran2(a, 'judged', { judging }, { terms });
  const packet = path.join(a.base, 'judge packet');
  const exported = bench(['score', plan, '--blind', packet, ...opts(a)]);
  assert.equal(exported.result.outcome, 'scored', JSON.stringify(exported.result));
  const manifest = await readJsonFile(path.join(packet, 'packet.json'));
  assert.equal(manifest.schema_version, 2);
  // Finding 8: a term ID such as "constructor" is counted like any other.
  assert.ok(Number.isInteger(manifest.inspection.hits.constructor) && manifest.inspection.hits.constructor >= 1 && manifest.inspection.hits.keystone >= 1, JSON.stringify(manifest.inspection));
  for (const item of manifest.items) {
    const patch = await readFile(path.join(packet, item.patch), 'utf8');
    assert.ok(!/PROMPT-CONTENT-MARKER|keystone/i.test(patch), 'every term is redacted, in every condition');
  }
  const audit = await readJsonFile(path.join(packet, 'audit.json'));
  assert.equal(audit.items.length, 2);
  const log = path.join(a.work, 'judging', 'inspection', `${manifest.inspection.log_hash.slice(0, 16)}.json`);
  assert.ok((await readJsonFile(log)).hits.some(h => h.term === 'constructor'), 'the inspection log stays in the work directory');
  // Judgement provenance.
  const rubric = { commit: a.benchCommit, hash: await directoryHash(path.join(a.benchRepo, 'judging', 'rubric')) };
  const promptHash = await directoryHash(path.join(a.benchRepo, 'judging', 'prompt'));
  const planHash = exported.result.plan;
  let counter = 0;
  const judgements = async (judge, items, fields = {}) => {
    const file = path.join(a.base, `judgements-${counter++}.json`);
    await writeFile(file, JSON.stringify({ kind: 'keystone-bench-judgements', schema_version: 2, plan: planHash,
      attestation: { judge, procedure: judging.procedure, date: '2026-10-07', statement: 'Judged blind.', rubric, prompt_hash: promptHash, ...fields }, judgements: items }));
    return bench(['score', plan, '--judged', file, ...opts(a)]);
  };
  const items = (fields) => manifest.items.map(i => ({ blind_id: i.blind_id, ...fields }));
  assert.equal((await judgements('vendor-a', items({ verdict: 'approve', blocking: 1, non_blocking: 2, condition_guess: 'guided' }))).result.diagnostics[0].code, 'BENCH_PACKET_NOT_RELEASED');
  const attestation = async logHash => {
    const file = path.join(a.base, `release-${counter++}.json`);
    await writeFile(file, JSON.stringify({ kind: 'keystone-bench-packet-release', schema_version: 1, plan: planHash, packet_hash: (await import('node:crypto')).createHash('sha256').update(await readFile(path.join(packet, 'packet.json'))).digest('hex'), inspection_log_hash: logHash, reviewed_by: 'owner', date: '2026-10-07', statement: 'Reviewed every hit.' }));
    return file;
  };
  assert.equal(bench(['release', plan, '--attestation', await attestation('0'.repeat(64)), ...opts(a)]).result.diagnostics[0].code, 'BENCH_RELEASE_INVALID');
  const released = bench(['release', plan, '--attestation', await attestation(manifest.inspection.log_hash), ...opts(a)]);
  assert.equal(released.result.outcome, 'released', JSON.stringify(released.result));
  assert.ok(!(await readFile(released.result.release, 'utf8')).includes('PROMPT-CONTENT-MARKER'));
  // Finding 5: the work-directory manifest is mutable. Adding every item to its audit sample neither
  // passes a new release nor changes the sealed audit membership that import uses.
  const packetHash = JSON.parse(await readFile(released.result.release, 'utf8')).packet_hash;
  const manifestFile = path.join(a.work, 'judging', 'packets', `${packetHash}.json`);
  const stored = await readJsonFile(manifestFile);
  await writeFile(manifestFile, JSON.stringify({ ...stored, audit_text: JSON.stringify({ kind: 'keystone-bench-audit-sample', judge: 'owner', items: manifest.items.map(i => i.blind_id) }) }));
  assert.equal(bench(['release', plan, '--attestation', await attestation(manifest.inspection.log_hash), ...opts(a)]).result.diagnostics[0].code, 'BENCH_RELEASE_INVALID');
  const sealed = await readJsonFile(released.result.release);
  assert.deepEqual(sealed.audit, audit.items);
  assert.equal((await judgements('stranger', items({ verdict: 'approve', blocking: 0, non_blocking: 0 }))).result.diagnostics[0].code, 'BENCH_JUDGEMENT_PROVENANCE_INVALID');
  assert.equal((await judgements('vendor-a', items({ verdict: 'approve', blocking: 0, non_blocking: 0 }), { prompt_hash: '0'.repeat(64) })).result.diagnostics[0].code, 'BENCH_JUDGEMENT_PROVENANCE_INVALID');
  assert.equal((await judgements('vendor-a', items({ verdict: 'approve', blocking: 1, non_blocking: 2, condition_guess: 'guided' }))).result.outcome, 'scored');
  assert.equal((await judgements('vendor-a', items({ verdict: 'reject', blocking: 9, non_blocking: 9 }))).result.diagnostics[0].code, 'BENCH_JUDGEMENT_DUPLICATE');
  assert.equal((await judgements('vendor-b', items({ verdict: 'reject', blocking: 3, non_blocking: 0 }))).result.outcome, 'scored');
  const outside = manifest.items.find(i => !audit.items.includes(i.blind_id));
  assert.equal((await judgements('owner', [{ blind_id: outside.blind_id, verdict: 'approve', blocking: 0, non_blocking: 0 }])).result.diagnostics[0].code, 'BENCH_JUDGEMENT_NOT_SAMPLED');
  assert.equal((await judgements('owner', audit.items.map(id => ({ blind_id: id, verdict: 'approve', blocking: 0, non_blocking: 0 })))).result.outcome, 'scored');
  // Counts are the vendor mean; verdicts stay per judge, never averaged or combined.
  const scores = await readJsonFile(analysisDir(a, 'judged', 'scores.json'));
  for (const run of scores.runs) {
    assert.equal(run.measures.review_blocking_findings.value, 2);
    assert.equal(run.measures.review_non_blocking_findings.value, 1);
    assert.equal(run.measures['review_verdict:vendor-a'].value, 'approve');
    assert.equal(run.measures['review_verdict:vendor-b'].value, 'reject');
    assert.ok(!('review_verdict' in run.measures));
  }
  // Agreement and blinding statistics are reported by analyze, never used for classification.
  const analyzed = bench(['analyze', plan, ...opts(a)]);
  assert.equal(analyzed.result.outcome, 'analyzed', JSON.stringify(analyzed.result));
  const { judged } = await readJsonFile(analysisDir(a, 'judged', 'analysis.json'));
  const vendorA = judged.judges.find(j => j.judge === 'vendor-a');
  assert.equal(vendorA.blinding.guess_participation, 1);
  assert.equal(vendorA.blinding.guess_accuracy, 0.5);
  const pair = judged.agreement.find(p => p.judges.join() === 'vendor-a,vendor-b');
  assert.equal(pair.verdict_agreement, 0);
  assert.equal(pair.mean_abs_blocking_difference, 2);
  assert.equal(judged.agreement.filter(p => p.judges.includes('owner')).length, 2);
});

test('exposure verification fails for an exposed profile, a manual profile and staged hidden text; it launches nothing', async t => {
  const a = await area2(t);
  const variants = [
    ['exposed-profile', { profiles: [{ repository: 'benchmark', path: 'profiles/fake' }] }, 'E1'],
    // A benchmark-repository condition whose tool expands {condition} into a shim on the session PATH.
    ['exposed-tool', { conditions: [{ repository: 'benchmark', path: 'conditions/plain' }, { repository: 'benchmark', path: 'conditions/guided' }] }, 'E1'],
    ['manual-profile', { profiles: [{ repository: 'benchmark', path: 'profiles/manual' }] }, 'E2'],
    ['staged-statement', { conditions: [{ repository: 'benchmark', path: 'conditions/plain' }, { repository: 'benchmark', path: 'conditions/leaky' }] }, 'E3'],
  ];
  for (const [id, fields, check] of variants) {
    const analysis = defaultAnalysis(id === 'staged-statement' ? { conditions: { reference: 'plain', treatment: 'leaky' } } : {});
    const plan = await writePlan2(a, id, fields, { analysis });
    const verified = bench(['verify-exposure', plan, ...opts(a)]);
    assert.equal(verified.result.outcome, 'invalid', id);
    assert.deepEqual(verified.result.diagnostics.map(d => d.path).filter(p => p !== 'E6'), [check], id);
    const record = await readJsonFile(verified.result.record);
    assert.equal(record.passed, false);
    assert.ok(record.owner_attestations.every(o => o.attested === false) && /not sandboxed/.test(record.residual_risk));
    commitRoot(a);
    assert.equal(bench(['freeze', plan, ...opts(a)]).result.diagnostics[0].code, 'BENCH_EXPOSURE_NOT_VERIFIED');
  }
  // E4: a work directory inside the benchmark repository is refused before any check.
  const plan = await writePlan2(a, 'clean');
  assert.equal(bench(['verify-exposure', plan, '--root', a.root, '--work', path.join(a.benchRepo, 'work'), '--repos', a.repos]).result.diagnostics[0].code, 'BENCH_WORK_INVALID');
  assert.equal(bench(['verify-exposure', plan, ...opts(a)]).result.outcome, 'verified');
});

test('exposure check E4 fails when the benchmark repository is on the base PATH every session inherits', async t => {
  const a = await area2(t);
  const plan = await writePlan2(a, 'path-exposure', { calibrated_from: await calibratedPilot(a) });
  // Override the existing PATH variable under its own name (Path on Windows), so no duplicate key arises.
  const key = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';
  const withBench = { [key]: [path.join(a.benchRepo, 'profiles'), process.env[key]].join(path.delimiter) };
  const exposed = bench(['verify-exposure', plan, ...opts(a)], withBench);
  assert.equal(exposed.result.outcome, 'invalid', JSON.stringify(exposed.result));
  assert.deepEqual(exposed.result.diagnostics.map(d => d.path), ['E4']);
  const e4 = exposed.result.checks.find(c => c.id === 'E4');
  assert.equal(e4.passed, false);
  assert.equal(e4.findings, 1);
  const record = await readJsonFile(exposed.result.record);
  assert.equal(record.passed, false);
  assert.ok(!JSON.stringify(record).includes(a.benchRepo), 'the record names no path');
  commitRoot(a);
  assert.equal(bench(['freeze', plan, ...opts(a)]).result.diagnostics[0].code, 'BENCH_EXPOSURE_NOT_VERIFIED');
  // Without the benchmark repository on PATH, the same plan verifies and its record is replaced.
  assert.equal(bench(['verify-exposure', plan, ...opts(a)]).result.outcome, 'verified');
  // The replaced record was committed above, so the Keystone tree is dirty until committed again.
  assert.equal(bench(['freeze', plan, ...opts(a)]).result.diagnostics[0].code, 'BENCH_KEYSTONE_DIRTY');
  commitRoot(a);
  assert.equal(bench(['freeze', plan, ...opts(a)]).result.outcome, 'frozen');
});

test('calibrate exports a condition-blind dataset; a pilot stays blind until a main plan calibrated from it is frozen', async t => {
  const a = await area2(t);
  const calibration = {
    measure: 'task_oracle_pass_rate', recurrence_measure: 'trap_recurrences', floor: 0.1, ceiling: 0.9, se_target: 0.075,
    repetitions: { min: 5, max: 10 }, infrastructure_threshold: 0.1, target_tasks: ['change-app', 'unpiloted-arc'],
    unpiloted_sigma: 'max-observed-same-profile', resources: { tokens: 'total_tokens', seconds: 'session_seconds', control_tasks: ['control-a'] },
  };
  const { plan: pilot, prepared } = await ran2(a, 'pilot', { stage: 'pilot', limits: { session_timeout_seconds: 60, setup_timeout_seconds: 120, oracle_timeout_seconds: 60, max_infrastructure_reruns: 0 } }, { analysis: defaultAnalysis({ calibration }) });
  for (const command of ['score', 'report', 'analyze']) assert.equal(bench([command, pilot, ...opts(a)]).result.diagnostics[0].code, 'BENCH_PILOT_CONDITION_BLIND', command);
  // Finding 7: one guided run is an exhausted infrastructure failure (no reruns allowed).
  const failed = prepared.runs.find(r => r.condition === 'guided').run_id;
  const classification = path.join(a.base, 'terminal.json');
  await writeFile(classification, JSON.stringify({ kind: 'keystone-bench-attempt-classification', schema_version: 1, run_id: failed, attempt: 1, class: 'infrastructure', cause: 'rate-limit', evidence: ['harness/state.json'], classified_by: 'owner', date: '2026-10-07' }));
  assert.equal(bench(['classify', failed, '--plan', pilot, '--classification', classification, ...opts(a)]).result.outcome, 'classified');
  const calibrated = bench(['calibrate', pilot, ...opts(a)]);
  assert.equal(calibrated.result.outcome, 'calibrated', JSON.stringify(calibrated.result));
  assert.equal(calibrated.result.r, 5);
  const text = await readFile(analysisDir(a, 'pilot', 'calibration.json'), 'utf8');
  for (const forbidden of ['plain', 'guided', a.base, a.work, ...prepared.runs.map(r => r.run_id), 'condition_id']) assert.ok(!text.includes(forbidden), `calibration export contains ${forbidden}`);
  const body = JSON.parse(text);
  assert.equal(body.dataset.length, 3, 'the terminal infrastructure failure is not an outcome');
  assert.deepEqual([body.infrastructure.attempts, body.infrastructure.infrastructure_attempts, body.infrastructure.terminal_infrastructure_failures], [4, 1, 1]);
  assert.equal(body.infrastructure.rate, 0.25);
  assert.equal(body.infrastructure.exceeds_threshold, true);
  assert.deepEqual(Object.keys(body.dataset[0]).sort(), ['attempts', 'calibration_id', 'measure', 'opportunities', 'profile', 'recurrences', 'seconds', 'sessions', 'task', 'tokens', 'valid']);
  assert.deepEqual(body.discrimination[0].flags, ['ceiling']);
  assert.equal(body.discrimination[0].recurrence_rate, 0.666667);
  const unpiloted = body.precision.cells.find(c => c.task === 'unpiloted-arc');
  assert.deepEqual(unpiloted.source, { kind: 'substituted', task: 'change-app', profile: 'fake-v2' });
  assert.equal(body.precision.designation, 'normal');
  assert.equal(body.resources.projections.length, 6);
  assert.equal(body.resources.projections[0].runs, 2 * 2 * 5 + 1 * 2 * 5);
  // A main plan names the pilot it was calibrated from; freezing it releases the pilot as non-evidence.
  const pilotHash = calibrated.result.plan.hash;
  const main = await writePlan2(a, 'main', { calibrated_from: { id: 'pilot', hash: pilotHash } });
  await freezePlan(a, main);
  const scored = bench(['score', pilot, ...opts(a)]);
  assert.equal(scored.result.outcome, 'scored');
  assert.equal((await readJsonFile(analysisDir(a, 'pilot', 'scores.json'))).non_evidence, true);
  // A main plan naming a pilot without a calibration export cannot be frozen.
  const orphan = await writePlan2(a, 'orphan', { calibrated_from: { id: 'pilot', hash: 'a'.repeat(64) } });
  assert.equal(bench(['verify-exposure', orphan, ...opts(a)]).result.outcome, 'verified');
  commitRoot(a);
  assert.equal(bench(['freeze', orphan, ...opts(a)]).result.diagnostics[0].code, 'BENCH_CALIBRATION_MISSING');
});

test('calibration and classification rules: R per cell, zero-value recurrence, completeness and every class trigger', () => {
  assert.equal(requiredR(0, 0.075, 5), 5);
  assert.equal(requiredR(0.15, 0.075, 5), 8);
  assert.equal(requiredR(0.3, 0.075, 5), 32);
  assert.equal(sampleSd([1]), null);
  assert.equal(required('ceil-half-R', 5), 3);
  assert.equal(required('ceil-half-R', 10), 5);
  assert.equal(required('all-planned', 5), 5);
  // The four zero-value cases.
  assert.equal(relativeReduction(0, 0), 0);
  assert.equal(relativeReduction(0, 2), 'unbounded-deterioration');
  assert.equal(relativeReduction(2, 0), 1);
  assert.equal(relativeReduction(2, 1), 0.5);
  assert.ok(deteriorates('unbounded-deterioration', 0.3) && !improves('unbounded-deterioration', 0.3));
  assert.equal(estimate('difference', [{ treatment: 1, reference: 0.5 }, { treatment: 0.5, reference: 0.5 }]), 0.25);
  assert.ok(improves(0.15, 0.15) && deteriorates(-0.15, 0.15));
  const order = ['mixed', 'unclassifiable', 'positive', 'negative', 'neutral'];
  const e = (value, margin = 0.15) => ({ value, defined: value !== null, improvement: improves(value, margin), deterioration: deteriorates(value, margin) });
  const evidence = (pass, recurrence, guardrails = ['ok', 'ok', 'ok'], tools = {}) => ({
    primaries: [{ id: 'pass', pooled: e(pass), perTool: new Map(Object.entries(tools.pass ?? {}).map(([k, v]) => [k, e(v)])) },
      { id: 'recurrence', pooled: e(recurrence, 0.3), perTool: new Map(Object.entries(tools.recurrence ?? {}).map(([k, v]) => [k, e(v, 0.3)])) }],
    guardrails,
  });
  const cls = (...args) => classify(order, evidence(...args), true);
  assert.equal(cls(0.2, 0).result, 'positive');
  assert.equal(cls(0, 0.5).result, 'positive');
  assert.equal(cls(-0.2, 0).result, 'negative');
  assert.equal(cls(0, 'unbounded-deterioration').result, 'negative');
  assert.equal(cls(0.05, 0.1).result, 'neutral');
  // Mixed triggers: tool contradiction, primary contradiction, improvement with a known breach.
  assert.deepEqual(cls(0.05, 0.1, undefined, { pass: { a: 0.3, b: -0.3 } }).triggers, ['tool-contradiction:pass']);
  assert.deepEqual(cls(0.2, -0.5).triggers, ['primary-contradiction:pass>recurrence']);
  assert.deepEqual(cls(0.2, 0, ['ok', 'breached', 'ok']).triggers, ['improvement-with-breached-guardrail']);
  // Mixed is never overridden by missing evidence elsewhere.
  assert.equal(cls(0.2, -0.5, ['unknown', 'ok', 'ok']).result, 'mixed');
  assert.equal(cls(null, 0.1, undefined, { pass: { a: 0.3, b: -0.3 } }).result, 'mixed');
  // UNCLASSIFIABLE triggers: an undefined primary; Positive margins with an unknown guardrail.
  assert.deepEqual(cls(null, 0.1).triggers, ['undefined-primary:pass']);
  assert.deepEqual(cls(0.2, 0, ['ok', 'unknown', 'ok']).triggers, ['positive-with-unknown-guardrail']);
  // Negative does not need guardrails; unknown ones are reported, not erased.
  assert.equal(cls(-0.2, 0, ['unknown', 'unknown', 'unknown']).result, 'negative');
  // Neutral is a measured finding: breached or unknown guardrails do not change it.
  assert.equal(cls(0.05, 0.1, ['breached', 'unknown', 'ok']).result, 'neutral');
  // The declared order decides: a plan may order the predicates differently.
  assert.equal(classify(['unclassifiable', 'mixed', 'positive', 'negative', 'neutral'], evidence(null, 0.1, undefined, { pass: { a: 0.3, b: -0.3 } }), true).result, 'unclassifiable');
  // Audit sample and redaction are deterministic and symmetric.
  const items = [1, 2, 3, 4, 5].map(i => ({ blind_id: `J-000000000000000${i}`, task: i < 4 ? 'x' : 'y' }));
  const sample = auditSample(items, { fraction: 0.2, seed: 9 });
  assert.equal(sample.length, 2);
  assert.deepEqual(auditSample(items, { fraction: 0.2, seed: 9 }), sample);
  const redacted = redact(Buffer.from('a Keystone line\nplain line\n'), 'J-1', 'patch', [{ id: 'k', expression: /keystone/gi }], '[X]');
  assert.equal(redacted.bytes.toString(), 'a [X] line\nplain line\n');
  assert.deepEqual(redacted.hits.map(h => [h.term, h.line]), [['k', 1]]);
});

test('analyze applies the pre-registered procedure deterministically; missing data is UNCLASSIFIABLE, never imputed', async t => {
  const a = await area2(t);
  // Wall-clock time varies on a real machine; this end-to-end plan declares a time threshold wide
  // enough to be deterministic (thresholds are plan-supplied; breach logic is unit-tested above).
  const analysis = defaultAnalysis();
  analysis.analysis.guardrails.find(g => g.id === 'time').breach = { relative_increase_above: 1000 };
  const { plan } = await ran2(a, 'final', {}, { analysis });
  const first = bench(['analyze', plan, ...opts(a)]);
  assert.equal(first.result.outcome, 'analyzed', JSON.stringify(first.result));
  const file = analysisDir(a, 'final', 'analysis.json');
  const bytes = await readFile(file, 'utf8');
  const body = JSON.parse(bytes);
  assert.equal(first.result.classification, 'positive', JSON.stringify({ classification: body.classification, guardrails: body.guardrails.map(g => [g.id, g.pooled]) }));
  assert.equal(body.primary.find(p => p.id === 'pass').pooled.value, 0);
  assert.equal(body.primary.find(p => p.id === 'recurrence').pooled.value, 1);
  assert.ok(body.guardrails.every(g => g.pooled.status === 'ok'));
  assert.equal(body.statistics.primary[0].permutation.iterations, 200);
  assert.deepEqual(body.matrix, { planned: 4, recorded: 4, infrastructure_missing: 0, missing: 0, missing_by_cell: {}, imputed: 0, reweighted: false });
  assert.equal(bench(['analyze', plan, ...opts(a)]).result.outcome, 'analyzed');
  assert.equal(await readFile(file, 'utf8'), bytes, 'byte-identical on re-run');
  // Missing evidence: the treatment arm has no observation, so the cell, and the headline, are undefined.
  for (const name of await readdir(results(a, 'final', 'runs'))) {
    const record = await readJsonFile(results(a, 'final', 'runs', name));
    if (record.provenance.condition.id === 'guided') await rm(results(a, 'final', 'runs', name));
  }
  const missing = bench(['analyze', plan, ...opts(a)]);
  assert.equal(missing.result.classification, 'unclassifiable');
  const after = await readJsonFile(file);
  assert.equal(after.matrix.missing, 2);
  assert.ok(after.guardrails.every(g => g.pooled.status === 'unknown'), 'no guardrail is computed from an insufficient subset');
  // A changed parameter is a changed plan.
  await writeFile(path.join(path.dirname(plan), 'analysis.json'), JSON.stringify(defaultAnalysis({ description: 'a later edit' })));
  assert.equal(bench(['analyze', plan, ...opts(a)]).result.diagnostics[0].code, 'BENCH_PLAN_MISMATCH');
});

test('benchmark/plans is excluded from discovery, configuration and START like results and analysis (C1)', async t => {
  const root = await temporary(t, false);
  git(root, 'init', '--quiet');
  await put(root, 'PROJECT.md', artifact('project', { project_id: 'p', status: 'active' }, '# P\n'));
  await put(root, 'tasks/TASK-0001.md', artifact('task', { id: 'TASK-0001', title: 'Example', status: 'active', files: ['benchmark/Plans/main/plan.json', 'benchmark/specification/README.md'] }, '# TASK-0001\n## Objective\nChange.\n'));
  await put(root, 'benchmark/Plans/main/plan.json', '{}\n');
  await put(root, 'benchmark/plans/tasks/TASK-0009.md', artifact('task', { id: 'TASK-0009', title: 'x', status: 'active' }));
  await put(root, 'benchmark/specification/README.md', '# Specification\n');
  const started = await compileStart(root, 'TASK-0001');
  assert.equal(started.outcome, 'complete');
  assert.deepEqual(started.diagnostics.filter(d => d.code === 'START_BENCHMARK_RECORD_INELIGIBLE').map(d => d.message), ['Benchmark record benchmark/Plans/main/plan.json is ineligible for START and review-context selection.']);
  assert.ok(started.envelope.omissions.some(o => o.reason === 'benchmark-record-ineligible' && o.path === 'benchmark/Plans/main/plan.json'));
  assert.ok(started.envelope.entries.some(e => e.path === 'benchmark/specification/README.md'), 'other benchmark/ directories are unaffected');
  await put(root, '.context/config.yaml', 'schema_version: 1\nsources: [PROJECT.md, tasks, benchmark]\n');
  const inventory = await inspect(root);
  assert.ok(!inventory.index.artifacts.some(x => x.id === 'TASK-0009'));
  for (const source of ['benchmark/plans', 'Benchmark/Plans/main']) {
    await put(root, '.context/config.yaml', `schema_version: 1\nsources: [PROJECT.md, tasks, ${source}]\n`);
    await assert.rejects(loadConfig(root), error => error.diagnostic.code === 'CONFIG_INVALID', source);
  }
});

test('the protocol stays separate: no protocol module imports the harness, and Keystone gains no network code', async () => {
  const walk = async directory => (await readdir(directory, { withFileTypes: true })).flatMap(e => e.isDirectory() ? [] : [path.join(directory, e.name)]);
  const sources = [];
  for (const directory of ['commands', 'context', 'parser', 'cli', 'review', 'close', 'compact']) {
    const full = path.join(project, 'src', directory);
    if (existsSync(full)) sources.push(...await walk(full));
  }
  for (const file of sources) assert.ok(!/from ['"][^'"]*benchmark\//.test(await readFile(file, 'utf8')), file);
  const harness = await Promise.all((await walk(path.join(project, 'src', 'benchmark'))).map(f => readFile(f, 'utf8')));
  assert.ok(!harness.some(s => /node:(https?|net|tls|dgram)|from ['"](https?|net|tls)['"]|fetch\(/.test(s)));
  const pkg = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['ajv', 'yaml']);
});

// Independent-review remediation (TASK-0015, findings 1–9).

test('review finding 1: an analysis specification cannot promote a diagnostic or a verdict into comparative evidence', async t => {
  const a = await area2(t);
  const variants = [
    ['primary', s => { s.analysis.primary[0].measure = 'setup_seconds'; }, '/analysis/primary/0/measure'],
    ['guardrail', s => { s.analysis.guardrails[1].measure = 'keystone_envelope_tokens'; }, '/analysis/guardrails/1/measure'],
    ['verdict', s => { s.analysis.primary[1].measure = 'review_verdict'; }, '/analysis/primary/1/measure'],
    ['calibration', s => { s.calibration = defaultCalibration({ measure: 'keystone_validation_diagnostics' }); }, '/calibration/measure'],
    ['resources', s => { s.calibration = defaultCalibration({ resources: { tokens: 'setup_seconds', seconds: 'session_seconds', control_tasks: [] } }); }, '/calibration/resources/tokens'],
  ];
  for (const [id, mutate, field] of variants) {
    const analysis = defaultAnalysis();
    mutate(analysis);
    const plan = await writePlan2(a, `measure-${id}`, {}, { analysis });
    const result = bench(['validate', plan, '--root', a.root, '--repos', a.repos]).result;
    assert.equal(result.outcome, 'invalid', id);
    assert.deepEqual(result.diagnostics.map(d => [d.code, d.field]), [['BENCH_ANALYSIS_MEASURE_INVALID', field]], id);
  }
  // Eligible measures, judged counts included, stay valid.
  const fine = defaultAnalysis();
  fine.analysis.guardrails.push({ id: 'blocking', measure: 'review_blocking_findings', statistic: 'mean', breach: { lower_by_more_than: 1 } });
  assert.equal(bench(['validate', await writePlan2(a, 'measure-fine', {}, { analysis: fine }), '--root', a.root, '--repos', a.repos]).result.outcome, 'valid');
});

test('review finding 2: the plan hash covers every plan-directory file; only the generated freeze record is outside it', async t => {
  const a = await area2(t);
  const plan = await writePlan2(a, 'every-file', { calibrated_from: await calibratedPilot(a) });
  const hash = () => bench(['validate', plan, '--root', a.root, '--repos', a.repos]).result.plan.hash;
  const base = hash();
  const directory = path.dirname(plan);
  await mkdir(path.join(directory, 'notes'), { recursive: true });
  await writeFile(path.join(directory, 'notes', 'unreferenced.md'), 'an unreferenced note\n');
  const withNote = hash();
  assert.notEqual(withNote, base, 'an unreferenced file in a subdirectory changes the hash');
  await writeFile(path.join(directory, 'notes', 'unreferenced.md'), 'an edited note\n');
  assert.notEqual(hash(), withNote);
  // The generated freeze record is excluded, and is verified wherever it is read.
  await writeFile(path.join(directory, 'freeze.json'), '{"forged": true}\n');
  const withForgery = hash();
  assert.equal(bench(['prepare', plan, ...opts(a)]).result.diagnostics[0].code, 'BENCH_PLAN_NOT_FROZEN', 'a forged freeze record is never trusted');
  await rm(path.join(directory, 'freeze.json'));
  assert.equal(hash(), withForgery);
  const frozen = await freezePlan(a, plan);
  const record = await readJsonFile(path.join(directory, 'freeze.json'));
  assert.deepEqual(Object.keys(record.files).sort(), ['analysis.json', 'notes/unreferenced.md', 'plan.json', 'preregistration.md']);
  assert.equal(record.plan.hash, frozen.plan.hash);
  // Any file added after freezing is a changed plan.
  await writeFile(path.join(directory, 'late.md'), 'added after freezing\n');
  assert.equal(bench(['prepare', plan, ...opts(a)]).result.diagnostics[0].code, 'BENCH_PLAN_NOT_FROZEN');
});

test('review finding 3: a main plan freezes only when calibrated from a frozen pilot with a determined R', async t => {
  const a = await area2(t);
  const attempt = async (id, fields) => {
    const plan = await writePlan2(a, id, fields);
    assert.equal(bench(['verify-exposure', plan, ...opts(a)]).result.outcome, 'verified');
    commitRoot(a);
    return bench(['freeze', plan, ...opts(a)]).result;
  };
  const missing = r => r.diagnostics.filter(d => d.code === 'BENCH_CALIBRATION_MISSING').map(d => d.message);
  assert.match(missing(await attempt('uncalibrated', {}))[0], /names the pilot/);
  assert.match(missing(await attempt('unknown-pilot', { calibrated_from: { id: 'nowhere', hash: 'b'.repeat(64) } }))[0], /No pilot nowhere was frozen/);
  // A frozen pilot that was never run has no determined R: the main plan still cannot freeze.
  const pilotWork = path.join(a.base, 'empty pilot work');
  const pilot = await writePlan2(a, 'empty-pilot', { stage: 'pilot', repetitions: 1 }, { analysis: defaultAnalysis({ calibration: defaultCalibration() }) });
  await freezePlan(a, pilot, pilotWork);
  const empty = bench(['calibrate', pilot, '--root', a.root, '--work', pilotWork, '--repos', a.repos]);
  assert.equal(empty.result.outcome, 'calibrated');
  assert.equal(empty.result.r, null);
  assert.match(missing(await attempt('undetermined', { calibrated_from: { id: 'empty-pilot', hash: empty.result.plan.hash } }))[0], /no determined R/);
  // A properly calibrated pilot lets the main plan freeze.
  const result = await attempt('calibrated', { calibrated_from: await calibratedPilot(a) });
  assert.equal(result.outcome, 'frozen', JSON.stringify(result));
});

test('review finding 4: E1 inspects inherited variable values without recording them; E3 has no length exemption', async t => {
  const a = await area2(t);
  const plan = await writePlan2(a, 'env-value');
  // The fake profile passes FAKE_AGENT_VERSION through; its inherited value names the benchmark repository.
  const exposed = bench(['verify-exposure', plan, ...opts(a)], { FAKE_AGENT_VERSION: `see ${a.benchRepo}` });
  assert.equal(exposed.result.outcome, 'invalid');
  assert.deepEqual(exposed.result.diagnostics.map(d => d.path), ['E1']);
  assert.ok(!JSON.stringify(exposed.result).includes(a.benchRepo), 'the value never enters a diagnostic');
  assert.ok(!(await readFile(exposed.result.record, 'utf8')).includes(a.benchRepo), 'the value never enters the record');
  assert.equal(bench(['verify-exposure', plan, ...opts(a)]).result.outcome, 'verified');
  // A staged file containing an 11-character hidden task file fails E3.
  const short = await writePlan2(a, 'short-leak', { conditions: [{ repository: 'benchmark', path: 'conditions/plain' }, { repository: 'benchmark', path: 'conditions/short-leak' }] },
    { analysis: defaultAnalysis({ conditions: { reference: 'plain', treatment: 'short-leak' } }) });
  const leaked = bench(['verify-exposure', short, ...opts(a)]);
  assert.equal(leaked.result.outcome, 'invalid');
  assert.deepEqual(leaked.result.diagnostics.map(d => d.path), ['E3']);
});

test('review finding 9: incomplete Codex usage raises BENCH_USAGE_UNREPORTED, not only absent usage', async t => {
  const a = await area2(t);
  // A version 2 smoke plan: integration-shaped, never evidence, needs no freezing.
  const directory = path.join(a.base, 'smokes', 'partial-usage');
  await mkdir(directory, { recursive: true });
  const plan = path.join(directory, 'plan.json');
  await writeFile(plan, JSON.stringify({
    kind: 'keystone-bench-plan', schema_version: 2, id: 'partial-usage', purpose: 'smoke',
    repositories: { subject: { id: 'fixture-app', commit: a.commit }, benchmark: { id: 'fixture-bench', commit: a.benchCommit } },
    tasks: [{ repository: 'benchmark', path: 'tasks/change-app' }], conditions: [{ repository: 'benchmark', path: 'conditions/plain' }],
    profiles: [{ repository: 'keystone', path: 'fixtures/profiles/codex-partial' }], repetitions: 1, seed: 1,
    limits: { session_timeout_seconds: 60, setup_timeout_seconds: 120, oracle_timeout_seconds: 60 }, telemetry: { enabled: false },
  }));
  assert.equal(bench(['prepare', plan, ...opts(a)]).result.outcome, 'prepared');
  const ran = bench(['run', plan, ...opts(a)]);
  assert.equal(ran.result.outcome, 'completed', JSON.stringify(ran.result));
  const notices = ran.result.diagnostics.filter(d => d.code === 'BENCH_USAGE_UNREPORTED');
  assert.ok(notices.length >= 1 && notices.every(d => /incomplete usage/.test(d.message)), JSON.stringify(ran.result.diagnostics));
  const [name] = await readdir(path.join(a.work, 'smoke', 'results', 'runs'));
  const record = await readJsonFile(path.join(a.work, 'smoke', 'results', 'runs', name));
  assert.deepEqual([record.sessions[0].usage.input_tokens, record.sessions[0].usage.output_tokens], [null, null]);
  assert.ok(!existsSync(path.join(a.root, 'benchmark', 'results', 'partial-usage')), 'a smoke run is never stored as a benchmark result');
});

// Targeted re-review remediation (TASK-0015, blockers 1 and 2).

test('review blocker 1: a file named __proto__ participates in plan, bundle and archive hashes', async t => {
  const a = await area2(t);
  const plan = await writePlan2(a, 'proto-file', { calibrated_from: await calibratedPilot(a) });
  const directory = path.dirname(plan);
  const hash = () => bench(['validate', plan, '--root', a.root, '--repos', a.repos]).result.plan.hash;
  const base = hash();
  await writeFile(path.join(directory, '__proto__'), 'one\n');
  const added = hash();
  assert.notEqual(added, base, 'adding __proto__ changes the plan hash');
  await writeFile(path.join(directory, '__proto__'), 'two\n');
  const changed = hash();
  assert.notEqual(changed, added, 'changing __proto__ changes the plan hash');
  await mkdir(path.join(directory, 'nested'), { recursive: true });
  await writeFile(path.join(directory, 'nested', 'constructor'), 'x\n');
  assert.notEqual(hash(), changed, 'a nested constructor file participates too');
  const files = await planDirectoryHashes(directory);
  assert.deepEqual(Object.keys(files).sort(), ['__proto__', 'analysis.json', 'nested/constructor', 'plan.json', 'preregistration.md']);
  // The freeze record lists it, and survives the JSON round trip with an intact evidence hash.
  await freezePlan(a, plan);
  const record = await readJsonFile(path.join(directory, 'freeze.json'));
  assert.ok(Object.keys(record.files).includes('__proto__'));
  assert.equal(bench(['prepare', plan, ...opts(a)]).result.outcome, 'prepared', 'the frozen record is read back as intact');
  await rm(path.join(directory, '__proto__'));
  assert.equal(bench(['prepare', plan, ...opts(a)]).result.diagnostics[0].code, 'BENCH_PLAN_NOT_FROZEN', 'removing __proto__ is a changed plan');
  // The same collision class in bundle and archive hashing.
  const scratch = await temporary(t, false);
  const one = path.join(scratch, 'one');
  await mkdir(one, { recursive: true });
  await writeFile(path.join(one, 'a.txt'), 'a\n');
  const [bundleBefore, archiveBefore] = [await directoryHash(one), await archiveHash(one)];
  await writeFile(path.join(one, '__proto__'), 'p\n');
  const [bundleWith, archiveWith] = [await directoryHash(one), await archiveHash(one)];
  assert.notEqual(bundleWith, bundleBefore);
  assert.notEqual(archiveWith, archiveBefore);
  await writeFile(path.join(one, '__proto__'), 'q\n');
  assert.notEqual(await directoryHash(one), bundleWith);
  assert.notEqual(await archiveHash(one), archiveWith);
});

test('review blocker 2: rerun never removes an installed record until its exact bytes are preserved', async t => {
  const a = await area2(t);
  const { plan } = await ran2(a, 'archive-conflict', { repetitions: 1 });
  const [first, second] = (await readdir(results(a, 'archive-conflict', 'runs'))).sort().map(n => n.replace(/\.json$/, ''));
  const recordOf = id => results(a, 'archive-conflict', 'runs', `${id}.json`);
  const logOf = id => results(a, 'archive-conflict', 'attempts', `${id}.json`);
  const rerun = async id => {
    const file = path.join(a.base, `classification-${id}-${Math.random().toString(16).slice(2)}.json`);
    await writeFile(file, JSON.stringify({ kind: 'keystone-bench-attempt-classification', schema_version: 1, run_id: id, attempt: 1, class: 'infrastructure', cause: 'machine-fault', evidence: ['harness/state.json'], classified_by: 'owner', date: '2026-10-07' }));
    return bench(['rerun', id, '--plan', plan, '--classification', file, ...opts(a)]);
  };
  // A directory at the archive destination is not proof of preservation.
  const original = await readFile(recordOf(first));
  await mkdir(path.join(a.work, 'runs', first, 'record.json'), { recursive: true });
  let result = await rerun(first);
  assert.equal(result.result.outcome, 'failed');
  assert.deepEqual(result.result.diagnostics.map(d => d.code), ['BENCH_ATTEMPT_ARCHIVE_CONFLICT', 'BENCH_ATTEMPT_HISTORY_INCOMPLETE']);
  assert.ok((await readFile(recordOf(first))).equals(original), 'the installed record is untouched');
  assert.ok(!existsSync(logOf(first)), 'nothing is logged');
  assert.equal(bench(['prepare', plan, ...opts(a)]).result.diagnostics[0].code, 'BENCH_ATTEMPT_HISTORY_INCOMPLETE', 'no attempt-number bypass');
  // A regular file with different content is not trusted either.
  const destination = path.join(a.work, 'attempts', first, '1', 'record.json');
  await rm(destination, { recursive: true });
  await writeFile(destination, '{"kind":"keystone-bench-run-record"}\n');
  result = await rerun(first);
  assert.equal(result.result.diagnostics[0].code, 'BENCH_ATTEMPT_ARCHIVE_CONFLICT');
  assert.ok((await readFile(recordOf(first))).equals(original));
  // With the conflict removed, the same command resumes and preserves the exact bytes.
  await rm(destination);
  result = await rerun(first);
  assert.equal(result.result.outcome, 'prepared', JSON.stringify(result.result));
  assert.equal(result.result.attempt, 2);
  assert.ok((await readFile(destination)).equals(original), 'the archived copy is the original');
  assert.ok(!existsSync(recordOf(first)));
  assert.equal((await readJsonFile(logOf(first))).attempts[0].record_archived, true);
  // Recovery after the original is gone accepts only an intact record of this run, plan and attempt.
  const secondOriginal = await readFile(recordOf(second));
  const secondArchive = path.join(a.work, 'attempts', second, '1');
  await mkdir(path.dirname(secondArchive), { recursive: true });
  await rename(path.join(a.work, 'runs', second), secondArchive);
  const tampered = JSON.parse(secondOriginal.toString('utf8'));
  tampered.status = tampered.status === 'completed' ? 'failed' : 'completed';
  await writeFile(path.join(secondArchive, 'record.json'), JSON.stringify(tampered));
  await rm(recordOf(second));
  result = await rerun(second);
  assert.equal(result.result.diagnostics[0].code, 'BENCH_ATTEMPT_ARCHIVE_CONFLICT');
  assert.ok(!existsSync(logOf(second)));
  await writeFile(path.join(secondArchive, 'record.json'), secondOriginal);
  result = await rerun(second);
  assert.equal(result.result.outcome, 'prepared', JSON.stringify(result.result));
  assert.equal((await readJsonFile(logOf(second))).attempts[0].record_archived, true);
});
