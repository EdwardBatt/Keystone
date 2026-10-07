import { readdir, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { compare, serialize, type Diagnostic } from '../core.js';
import { readJson, schemaDiagnostics, sha256 } from './specs.js';
import { definition, type Source } from './scorecard.js';
import { patch, snapshots } from './git.js';
import { BoundaryError, evidenceHash, guard, guardTree, loadRecords, readJsonFile, sealRecord, writeVerified, type Boundary, type StoredRecord } from './store.js';
import { matrix, open, runPaths, type Context, type Result } from './prepare.js';
import { exportPacket2, importJudgements2, judgedValues, loadJudgements2 } from './judging.js';
import { isPilot } from './plans.js';

export interface Value { value: number | string | null; source: Source }
export interface RunScore {
  run_id: string; task: string; condition: string; profile: string; repetition: number; status: string;
  measures: Record<string, Value>; diagnostics: Record<string, Value>;
}
interface Judgement { run_id: string; verdict: string; blocking: number; non_blocking: number }

const seconds = (ms: number) => Math.round(ms) / 1000;
const sum = (values: (number | null | undefined)[]) => values.length && values.every(v => typeof v === 'number') ? (values as number[]).reduce((a, b) => a + b, 0) : null;

/** Measures for one run. Primary measures exist for every condition; diagnostics are condition-specific. */
export function measure(record: Record<string, any>, judgement: Judgement | undefined, universalTools: Set<string>, judged2?: ReturnType<typeof judgedValues>): RunScore {
  const manual = record.provenance.profile.mode === 'manual';
  const final = record.checks.at(-1) as { results: { role: string; passed: boolean }[] } | undefined;
  const rate = (role: string) => {
    if (!final) return null;
    const results = final.results.filter(r => r.role === role);
    return results.length ? results.filter(r => r.passed).length / results.length : null;
  };
  const sessions = record.sessions as { kind: string; status: string; duration_ms: number | null; usage: Record<string, any> | null }[];
  const usage = (field: string) => sessions.length ? sum(sessions.map(s => s.usage?.[field])) : null;
  const measures: Record<string, Value> = {};
  const diagnostics: Record<string, Value> = {};
  const put = (name: string, value: number | string | null, source?: Source) => {
    const found = definition(name)!;
    (found.scope === 'diagnostic' || found.scope === 'primary-if-universal' && !universalTools.has(name.slice(name.indexOf(':') + 1)) ? diagnostics : measures)[name] = { value, source: source ?? found.source };
  };
  const completed = record.status === 'completed';
  put('task_oracle_pass_rate', completed ? rate('task') : null);
  put('regression_oracle_pass_rate', completed ? rate('regression') : null);
  put('failed_sessions', completed ? sessions.filter(s => s.status !== 'ok').length : null);
  const traps = final?.results.filter(r => r.role === 'trap') ?? [];
  put('trap_recurrences', completed && traps.length ? traps.filter(r => !r.passed).length : null);
  put('rework_sessions', completed ? sessions.filter(s => s.kind === 'fix').length : null, manual ? 'reported' : undefined);
  const durations = sum(sessions.map(s => s.duration_ms));
  put('session_seconds', completed && durations !== null ? seconds(durations) : null, manual ? 'reported' : undefined);
  const input = usage('input_tokens');
  const output = usage('output_tokens');
  put('input_tokens', input);
  put('output_tokens', output);
  put('total_tokens', input !== null && output !== null ? input + output : null);
  put('turns', usage('turns'));
  put('tool_calls', usage('tool_calls'));
  if (judged2) {
    // Version 2 (C2): counts are the vendor-judge mean; each judge's verdict stays separate.
    for (const [judge, verdict] of Object.entries(judged2.verdicts)) put(`review_verdict:${judge}`, verdict);
    put('review_blocking_findings', judged2.blocking);
    put('review_non_blocking_findings', judged2.non_blocking);
  } else {
    put('review_verdict', judgement?.verdict ?? null);
    put('review_blocking_findings', judgement?.blocking ?? null);
    put('review_non_blocking_findings', judgement?.non_blocking ?? null);
  }
  for (const tool of record.telemetry.tools as { name: string; resolved: boolean; invocations: number; duration_ms: number }[]) {
    put(`tool_seconds:${tool.name}`, tool.resolved ? seconds(tool.duration_ms) : null);
    put(`tool_invocations:${tool.name}`, tool.resolved ? tool.invocations : null);
  }
  put('setup_seconds', record.setup.duration_ms === null ? null : seconds(record.setup.duration_ms));
  put('keystone_envelope_tokens', record.telemetry.keystone_envelope?.estimated_tokens ?? null);
  put('keystone_envelope_omissions', record.telemetry.keystone_envelope?.omissions ?? null);
  put('keystone_validation_diagnostics', record.telemetry.keystone_validation?.diagnostics ?? null);
  const p = record.provenance;
  return { run_id: record.run_id, task: p.task.id, condition: p.condition.id, profile: p.profile.id, repetition: p.repetition, status: record.status, measures, diagnostics };
}

async function loadJudgements(context: Context): Promise<{ judgements: Map<string, Judgement>; refused: Diagnostic[] }> {
  const directory = path.join(context.where.results, 'judgements');
  const judgements = new Map<string, Judgement>();
  const refused: Diagnostic[] = [];
  let names: string[] = [];
  try { names = (await readdir(directory)).filter(n => n.endsWith('.json')).sort(compare); } catch { /* None imported. */ }
  for (const name of names) {
    const record = await readJsonFile<Record<string, any>>(path.join(directory, name));
    const label = `judgements/${name}`;
    if (!record || record.kind !== 'keystone-bench-judgement-record' || record.evidence_hash !== evidenceHash(record)) { refused.push({ code: 'BENCH_RESULT_EVIDENCE_MISMATCH', path: label, message: 'Judgement record is unreadable or does not match its evidence hash.' }); continue; }
    if (record.plan?.hash !== context.plan.hash) { refused.push({ code: 'BENCH_PLAN_MISMATCH', path: label, message: 'Judgement record was made under different plan content.' }); continue; }
    for (const j of record.judgements as Judgement[]) {
      if (judgements.has(j.run_id)) refused.push({ code: 'BENCH_JUDGEMENT_DUPLICATE', path: label, message: `A run already has a judgement; each run is judged once.` });
      else judgements.set(j.run_id, j);
    }
  }
  return { judgements, refused };
}

/** Deterministic scores from durable records. Any refused record blocks scoring: nothing is partially scored. */
export async function computeScores(context: Context): Promise<{ scores: RunScore[]; refused: Diagnostic[]; records: StoredRecord[] }> {
  const { records, refused } = await loadRecords(context.plan, context.where);
  if (context.plan.version === 2) {
    const judged = await loadJudgements2(context);
    const universal = universalTools(context, records);
    const judges = context.plan.spec.judging?.judges ?? [];
    const scores = records.map(r => measure(r.record, undefined, universal, judgedValues(judges, judged.judgements.get(r.record.run_id)))).sort((a, b) => compare(a.run_id, b.run_id));
    return { scores, refused: [...refused, ...judged.refused], records };
  }
  const judged = await loadJudgements(context);
  const universal = universalTools(context, records);
  const scores = records.map(r => measure(r.record, judged.judgements.get(r.record.run_id), universal)).sort((a, b) => compare(a.run_id, b.run_id));
  return { scores, refused: [...refused, ...judged.refused], records };
}

/** A tool is universal only when every planned run is recorded and resolved it, whatever the run's
 * status: an absent or failed run cannot vouch for a condition (review B6).
 */
function universalTools(context: Context, records: StoredRecord[]): Set<string> {
  const recorded = new Map(records.map(r => [r.record.run_id as string, r.record]));
  const planned = matrix(context.plan).map(run => recorded.get(run.run_id));
  const universal = new Set<string>();
  for (const name of context.plan.spec.telemetry.wrap ?? []) {
    if (planned.every(r => r && (r.telemetry.tools as { name: string; resolved: boolean }[]).some(t => t.name === name && t.resolved))) universal.add(name);
  }
  return universal;
}

async function blindKey(context: Context): Promise<string> {
  const file = path.join(context.where.work, 'judging', `${context.plan.hash.slice(0, 16)}.key.json`);
  const existing = await readJsonFile<{ secret: string }>(file);
  if (existing?.secret) return existing.secret;
  const secret = randomBytes(32).toString('hex');
  const failure = await writeVerified(file, serialize({ kind: 'keystone-bench-blinding-key', plan: context.plan.hash, secret }), context.where.boundaries.work);
  if (failure) throw Object.assign(new Error('key'), { diagnostics: failure.diagnostics });
  return secret;
}

/** Blinded identifiers: keyed by a secret held outside the judge's packet and outside Keystone. */
export const blindId = (secret: string, runId: string) => `J-${sha256(`${secret}\0${runId}`).slice(0, 16)}`;

async function exportPacket(context: Context, records: StoredRecord[], output: string): Promise<Diagnostic[]> {
  const { plan, where } = context;
  if (!plan.spec.judging) return [{ code: 'BENCH_JUDGING_NOT_DECLARED', path: plan.spec.id, message: 'The plan declares no judging procedure.' }];
  const target = path.resolve(output);
  // The packet holds the subject's change, so its destination is a write boundary of its own: the
  // destination and everything below it must be real directories, physically outside the subject,
  // the Keystone tree and the work directory, checked again before every write (review round 2).
  const boundary: Boundary = { base: path.dirname(target), forbidden: [where.subject, where.root, where.work, ...(plan.benchmark ? [plan.benchmark.path] : [])], code: 'BENCH_BLIND_OUTPUT_INVALID', what: 'Judging packet' };
  try { await guard(boundary, target); } catch (error) { if (error instanceof BoundaryError) return [error.diagnostic]; throw error; }
  try { if ((await readdir(target)).length) return [{ code: 'BENCH_BLIND_OUTPUT_INVALID', path: output, message: 'The judging packet directory must be empty or absent.' }]; } catch { /* Absent. */ }
  const put = async (file: string, data: string | Buffer) => {
    const failure = await writeVerified(file, data, boundary);
    if (failure) throw new BoundaryError(failure.diagnostics[0]);
  };
  const secret = await blindKey(context);
  // Version 2: inspection and symmetric redaction before any packet file is written (item 8).
  if (plan.version === 2) return exportPacket2(context, records, target, boundary, secret, blindId);
  const items: { blind_id: string; task: string; statement: string; patch: string }[] = [];
  for (const task of plan.tasks) await put(path.join(target, 'tasks', `${task.spec.id}.md`), await readFile(path.join(task.directory, ...task.spec.statement.split('/'))));
  for (const { record } of records.filter(r => r.record.status === 'completed')) {
    // The judged change comes from the trees sealed in the record, never from mutable run state (review B5).
    const { setup_tree, final_tree } = record.evidence ?? {};
    if (!setup_tree || !final_tree) return [{ code: 'BENCH_JUDGING_EVIDENCE_MISSING', path: record.run_id, message: 'The record names no evidence trees.' }];
    const id = blindId(secret, record.run_id);
    let change: Buffer;
    const store = snapshots(runPaths(where, record.run_id).harness);
    try { await guardTree(where.boundaries.work, store.gitDir); } catch (error) { if (error instanceof BoundaryError) return [error.diagnostic]; throw error; }
    try { change = await patch(store, setup_tree, final_tree, plan.spec.judging.exclude ?? []); } catch {
      return [{ code: 'BENCH_JUDGING_EVIDENCE_MISSING', path: record.run_id, message: 'The record’s evidence trees are not available in this work directory.' }];
    }
    await put(path.join(target, `${id}.patch`), change);
    items.push({ blind_id: id, task: record.provenance.task.id, statement: `tasks/${record.provenance.task.id}.md`, patch: `${id}.patch` });
  }
  items.sort((a, b) => compare(a.blind_id, b.blind_id));
  // The packet names no condition, run, profile or workspace: judging is blind to condition.
  await put(path.join(target, 'packet.json'), serialize({ kind: 'keystone-bench-judging-packet', schema_version: 1, plan: { id: plan.spec.id, hash: plan.hash }, procedure: plan.spec.judging.procedure, items }));
  return [];
}

async function importJudgements(context: Context, records: StoredRecord[], file: string): Promise<Diagnostic[]> {
  const label = path.basename(file);
  const { data, diagnostics } = await readJson(path.resolve(file), label);
  if (diagnostics.length) return diagnostics.map(d => ({ ...d, code: 'BENCH_JUDGEMENTS_INVALID' }));
  const schema = schemaDiagnostics('judgements', data, label, 'BENCH_JUDGEMENTS_INVALID');
  if (schema.length) return schema;
  const input = data as { plan: { id: string; hash: string }; attestation: Record<string, string>; judgements: { blind_id: string; verdict: string; blocking: number; non_blocking: number }[] };
  if (input.plan.id !== context.plan.spec.id || input.plan.hash !== context.plan.hash) return [{ code: 'BENCH_PLAN_MISMATCH', path: label, message: 'The judgements were made for different plan content.' }];
  const keyFile = path.join(context.where.work, 'judging', `${context.plan.hash.slice(0, 16)}.key.json`);
  const key = await readJsonFile<{ secret: string }>(keyFile);
  if (!key?.secret) return [{ code: 'BENCH_BLIND_KEY_MISSING', path: keyFile, message: 'No blinding key for this plan; export a judging packet first.' }];
  if (context.plan.version === 2) return importJudgements2(context, records, file, key.secret, blindId);
  if ((data as { schema_version?: unknown }).schema_version !== 1) return [{ code: 'BENCH_JUDGEMENTS_INVALID', path: label, message: 'A version 1 plan imports version 1 judgements.' }];
  const byBlind = new Map(records.map(r => [blindId(key.secret, r.record.run_id), r.record.run_id]));
  const seen = new Set<string>();
  const out: Judgement[] = [];
  const problems: Diagnostic[] = [];
  for (const j of input.judgements) {
    const run = byBlind.get(j.blind_id);
    if (!run) { problems.push({ code: 'BENCH_JUDGEMENT_UNKNOWN', path: label, message: `${j.blind_id} is not a blinded run of this plan.` }); continue; }
    if (seen.has(run)) { problems.push({ code: 'BENCH_JUDGEMENT_DUPLICATE', path: label, message: `${j.blind_id} is judged more than once.` }); continue; }
    seen.add(run);
    out.push({ run_id: run, verdict: j.verdict, blocking: j.blocking, non_blocking: j.non_blocking });
  }
  if (problems.length) return problems;
  const source = sha256(await readFile(path.resolve(file)));
  const target = path.join(context.where.results, 'judgements', `${source.slice(0, 16)}.json`);
  if (await readJsonFile(target)) return [];
  const existing = await loadJudgements(context);
  const dup = out.filter(j => existing.judgements.has(j.run_id));
  if (dup.length) return [{ code: 'BENCH_JUDGEMENT_DUPLICATE', path: label, message: `${dup.length} run(s) already have an imported judgement.` }];
  out.sort((a, b) => compare(a.run_id, b.run_id));
  const failure = await writeVerified(target, sealRecord({ kind: 'keystone-bench-judgement-record', schema_version: 1, plan: input.plan, source_hash: source, attestation: input.attestation, judgements: out }), context.where.boundaries.results);
  return failure?.diagnostics ?? [];
}

/** `keystone-bench score <plan> [--blind <dir>] [--judged <file>]`. Launches nothing; byte-identical on re-run. */
export async function score(planFile: string, root: string, work: string | undefined, options: { blind?: string; judged?: string; repos?: string } = {}): Promise<Result> {
  const opened = await open('score', planFile, root, work, { repos: options.repos, gates: ['pilot'] });
  if (!opened.context) return opened.result!;
  const context = opened.context;
  const identity = { id: context.plan.spec.id, hash: context.plan.hash };
  // A released pilot is scored as non-evidence (TASK-0015 item 6).
  const nonEvidence = isPilot(context.plan) ? { non_evidence: true } : {};
  const first = await computeScores(context);
  if (first.refused.length) return { command: 'score', outcome: 'blocked', plan: identity, diagnostics: first.refused };
  if (options.blind) {
    try {
      const problems = await exportPacket(context, first.records, options.blind);
      if (problems.length) return { command: 'score', outcome: 'blocked', plan: identity, diagnostics: problems };
    } catch (error) {
      if (error instanceof BoundaryError) return { command: 'score', outcome: 'blocked', plan: identity, diagnostics: [error.diagnostic] };
      return { command: 'score', outcome: 'failed', plan: identity, diagnostics: (error as { diagnostics?: Diagnostic[] }).diagnostics ?? [{ code: 'BENCH_JUDGING_EXPORT_FAILED', path: options.blind, message: 'The judging packet could not be written.' }] };
    }
  }
  if (options.judged) {
    const problems = await importJudgements(context, first.records, options.judged);
    if (problems.length) return { command: 'score', outcome: problems.some(p => p.code === 'BENCH_WRITE_FAILED') ? 'failed' : 'blocked', plan: identity, diagnostics: problems };
  }
  const { scores, refused } = options.judged ? await computeScores(context) : first;
  if (refused.length) return { command: 'score', outcome: 'blocked', plan: identity, diagnostics: refused };
  const file = path.join(context.where.analysis, 'scores.json');
  const failure = await writeVerified(file, serialize({ kind: 'keystone-bench-scores', schema_version: 1, generated_by: 'keystone-bench', plan: identity, ...nonEvidence, runs: scores }), context.where.boundaries.analysis);
  if (failure) return { command: 'score', outcome: 'failed', plan: identity, diagnostics: failure.diagnostics };
  return { command: 'score', outcome: 'scored', plan: identity, diagnostics: [], runs: scores.length, scores: file };
}
