import { lstat, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { compare, serialize, type Diagnostic } from '../core.js';
import { safePath } from '../paths.js';
import { loadPlan, sha256, type LoadedPlan } from './specs.js';
import { weightable } from './scorecard.js';
import { cloneAt, hasCommit } from './git.js';
import { BoundaryError, guard, loadRecords, locationDiagnostics, locations, readJsonFile, writeVerified, type Locations } from './store.js';
import { canonicalDiagnostics, frozenDiagnostics, pilotDiagnostics } from './plans.js';
import { nextAttempt } from './attempts.js';

export interface RunEntry { run_id: string; task: string; condition: string; profile: string; repetition: number; order_index: number }
export interface Manifest { kind: 'keystone-bench-work-manifest'; schema_version: 1; plan: { id: string; hash: string }; seed: number; runs: RunEntry[] }
export interface RunState {
  status: 'prepared' | 'running' | 'awaiting-record' | 'recorded' | 'done' | 'unrecorded';
  /** The plan hash the run's workspace and staged inputs were prepared under (review B3). */
  plan: string;
  files_staged: number;
  setup?: unknown; manual?: unknown;
  /** Version 2: the attempt number of this preparation of the planned run (TASK-0015 item 7). */
  attempt?: number;
}

export const runId = (plan: string, task: string, condition: string, profile: string, repetition: number) =>
  `R-${sha256([plan, task, condition, profile, String(repetition)].join('\0')).slice(0, 12)}`;

/** Deterministic seeded order: a Fisher–Yates shuffle driven by SHA-256 of the seed and position. */
export function seededOrder<T>(items: T[], seed: number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = parseInt(sha256(`${seed}:${i}`).slice(0, 8), 16) % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Every run is task × condition × agent profile × repetition, in seeded order. */
export function matrix(plan: LoadedPlan): RunEntry[] {
  const runs: Omit<RunEntry, 'order_index'>[] = [];
  for (const task of plan.tasks) for (const condition of plan.conditions) for (const profile of plan.profiles) {
    for (let repetition = 1; repetition <= plan.spec.repetitions; repetition++) {
      runs.push({ run_id: runId(plan.spec.id, task.spec.id, condition.spec.id, profile.spec.id, repetition), task: task.spec.id, condition: condition.spec.id, profile: profile.spec.id, repetition });
    }
  }
  runs.sort((a, b) => compare(a.run_id, b.run_id));
  return seededOrder(runs, plan.spec.seed).map((run, order_index) => ({ ...run, order_index }));
}

export const runPaths = (where: Locations, id: string) => {
  const base = path.join(where.runs, id);
  return { base, workspace: path.join(base, 'workspace'), harness: path.join(base, 'harness'), state: path.join(base, 'harness', 'state.json') };
};

export type Outcome = 'valid' | 'invalid' | 'prepared' | 'unchanged' | 'completed' | 'awaiting-record' | 'recorded' | 'scored' | 'reported' | 'blocked' | 'failed'
  | 'verified' | 'frozen' | 'released' | 'calibrated' | 'analyzed' | 'classified';
export interface Result { command: string; outcome: Outcome; plan: { id: string; hash: string } | null; diagnostics: Diagnostic[]; [key: string]: unknown }

export interface Context { plan: LoadedPlan; where: Locations }

/** Gates a command applies to version 2 experiment plans (TASK-0015): the canonical location, a
 * matching freeze record, and pilot condition-blindness. Version 1 plans pass every gate.
 */
export type Gate = 'canonical' | 'frozen' | 'pilot';
export interface OpenOptions { repos?: string; gates?: Gate[] }

/** Loads the plan, checks locations and refuses to continue a plan whose content changed. */
export async function open(command: string, planFile: string, root: string, work: string | undefined, options: OpenOptions = {}): Promise<{ context?: Context; result?: Result }> {
  const { plan, diagnostics, unresolved } = await loadPlan(planFile, weightable, { repos: options.repos, root });
  if (unresolved) return { result: { command, outcome: 'blocked', plan: null, diagnostics, resolved: false } };
  if (!plan) return { result: { command, outcome: 'invalid', plan: null, diagnostics } };
  const identity = { id: plan.spec.id, hash: plan.hash };
  const where = locations(plan, root, work);
  const located = await locationDiagnostics(plan, where);
  if (located.length) return { result: { command, outcome: 'blocked', plan: identity, diagnostics: located } };
  const gates = options.gates ?? [];
  const gated = [
    ...(gates.includes('canonical') ? await canonicalDiagnostics(plan, root) : []),
    ...(gates.includes('frozen') ? await frozenDiagnostics(plan, root) : []),
    ...(gates.includes('pilot') ? await pilotDiagnostics(plan, root) : []),
  ];
  if (gated.length) return { result: { command, outcome: 'blocked', plan: identity, diagnostics: gated } };
  return { context: { plan, where } };
}

/** Existing work or results made under different plan content stop prepare and run (ADR-0004 guarantee 8). */
export async function planChanges(context: Context): Promise<Diagnostic[]> {
  const { plan, where } = context;
  const diagnostics: Diagnostic[] = [];
  const manifest = await readJsonFile<Manifest>(path.join(where.work, 'manifest.json'));
  if (manifest && (manifest.plan?.id !== plan.spec.id || manifest.plan?.hash !== plan.hash)) {
    diagnostics.push({ code: 'BENCH_PLAN_CHANGED', path: path.join(where.work, 'manifest.json'), message: `The work directory was prepared for plan hash ${manifest.plan?.hash}; the plan now hashes to ${plan.hash}. A plan is fixed before its runs begin.` });
  }
  const { refused } = await loadRecords(plan, where);
  for (const d of refused.filter(r => r.code === 'BENCH_PLAN_MISMATCH')) {
    diagnostics.push({ ...d, code: 'BENCH_PLAN_CHANGED', message: `Existing results were made under different plan content. ${d.message}` });
  }
  return diagnostics;
}

/** Prepares one planned run: a fresh clone of the subject at its pinned commit, then the condition's
 * declared files. A failure removes only that run's directory. `attempt` is recorded in run state
 * for version 2 reruns (TASK-0015 item 7).
 */
export async function prepareRun(context: Context, run: RunEntry, attempt?: number): Promise<Diagnostic[] | null> {
  const { plan, where } = context;
  const paths = runPaths(where, run.run_id);
  try {
    await guard(where.boundaries.work, paths.base);
    await rm(paths.base, { recursive: true, force: true });
    await guard(where.boundaries.work, paths.harness);
    await mkdir(paths.harness, { recursive: true });
    await guard(where.boundaries.work, paths.workspace);
    await cloneAt(plan.subjectPath, paths.workspace, plan.subject.commit);
    const condition = plan.conditions.find(c => c.spec.id === run.condition)!;
    for (const entry of condition.spec.setup.files) {
      await guard(where.boundaries.work, paths.workspace);
      const destination = await safePath(paths.workspace, entry.to);
      await mkdir(path.dirname(destination), { recursive: true });
      const staged = await writeVerified(destination, await readFile(path.join(condition.directory, ...entry.from.split('/'))), where.boundaries.work);
      if (staged) throw staged;
    }
    const state: RunState = { status: 'prepared', plan: plan.hash, files_staged: condition.spec.setup.files.length, ...(attempt ? { attempt } : {}) };
    const failure = await writeVerified(paths.state, serialize(state), where.boundaries.work);
    if (failure) throw failure;
    return null;
  } catch (error) {
    // Cleanup removes only a run directory that is still inside its boundary.
    try { await guard(where.boundaries.work, paths.base); await rm(paths.base, { recursive: true, force: true }); } catch { /* Left in place; reported below. */ }
    return error instanceof BoundaryError ? [error.diagnostic] : (error as { diagnostics?: Diagnostic[] }).diagnostics ??
      [{ code: (error as Error).name === 'BenchGitError' ? 'BENCH_CLONE_FAILED' : 'BENCH_PREPARE_FAILED', path: run.run_id, message: `Workspace preparation failed (${(error as Error).message}); the run was not prepared.` }];
  }
}

/** The subject must be a local directory containing the pinned commit. */
export async function subjectDiagnostics(plan: LoadedPlan): Promise<Diagnostic[]> {
  const label = plan.spec.subject?.repository ?? plan.subject.id;
  try {
    if (!(await lstat(plan.subjectPath)).isDirectory()) throw new Error();
  } catch {
    return [{ code: 'BENCH_SUBJECT_INVALID', path: label, message: 'The subject repository is not a local directory.' }];
  }
  if (!(await hasCommit(plan.subjectPath, plan.subject.commit))) {
    return [{ code: 'BENCH_SUBJECT_COMMIT_MISSING', path: label, message: `The subject does not contain commit ${plan.subject.commit}.` }];
  }
  return [];
}

export async function prepare(planFile: string, root: string, work?: string, repos?: string): Promise<Result> {
  const opened = await open('prepare', planFile, root, work, { repos, gates: ['canonical', 'frozen'] });
  if (!opened.context) return opened.result!;
  const { plan, where } = opened.context;
  const identity = { id: plan.spec.id, hash: plan.hash };
  const changed = await planChanges(opened.context);
  if (changed.length) return { command: 'prepare', outcome: 'blocked', plan: identity, diagnostics: changed };
  const subject = await subjectDiagnostics(plan);
  if (subject.length) return { command: 'prepare', outcome: 'blocked', plan: identity, diagnostics: subject };
  const runs = matrix(plan);
  // The manifest is fixed before any run is prepared, so even a failed preparation binds the work
  // directory to this plan's content (review B3).
  const manifest: Manifest = { kind: 'keystone-bench-work-manifest', schema_version: 1, plan: identity, seed: plan.spec.seed, runs };
  const pinned = await writeVerified(path.join(where.work, 'manifest.json'), serialize(manifest), where.boundaries.work);
  if (pinned) return { command: 'prepare', outcome: 'failed', plan: identity, diagnostics: pinned.diagnostics, prepared: [], unchanged: [], work: where.work };
  const prepared: string[] = [];
  const unchanged: string[] = [];
  for (const run of runs) {
    const paths = runPaths(where, run.run_id);
    const existing = await readJsonFile<RunState>(paths.state);
    if (existing && existing.plan !== plan.hash) {
      return { command: 'prepare', outcome: 'blocked', plan: identity, diagnostics: [{ code: 'BENCH_PLAN_CHANGED', path: run.run_id, message: 'The run was prepared under different plan content.' }], prepared, unchanged, work: where.work };
    }
    if (existing) { unchanged.push(run.run_id); continue; }
    // Version 2: a fresh preparation continues the run's durable attempt history; it never reuses
    // an attempt number or ignores archived attempts (TASK-0015 item 7).
    let attempt: number | undefined;
    if (plan.version === 2) {
      const next = await nextAttempt(opened.context, run.run_id);
      if ('diagnostics' in next) {
        if (next.diagnostics.some(d => d.code === 'BENCH_ATTEMPT_TERMINAL')) { unchanged.push(run.run_id); continue; }
        return { command: 'prepare', outcome: 'blocked', plan: identity, diagnostics: next.diagnostics, prepared, unchanged, work: where.work };
      }
      attempt = next.attempt > 1 ? next.attempt : undefined;
    }
    const failed = await prepareRun(opened.context, run, attempt);
    if (failed) return { command: 'prepare', outcome: 'failed', plan: identity, diagnostics: failed, prepared, unchanged, work: where.work };
    prepared.push(run.run_id);
  }
  return { command: 'prepare', outcome: prepared.length ? 'prepared' : 'unchanged', plan: identity, diagnostics: [], prepared, unchanged, runs, work: where.work };
}
