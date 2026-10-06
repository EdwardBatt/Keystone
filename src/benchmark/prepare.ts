import { lstat, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { compare, serialize, type Diagnostic } from '../core.js';
import { safePath } from '../paths.js';
import { loadPlan, sha256, type LoadedPlan } from './specs.js';
import { weightable } from './scorecard.js';
import { cloneAt, hasCommit } from './git.js';
import { BoundaryError, guard, loadRecords, locationDiagnostics, locations, readJsonFile, writeVerified, type Locations } from './store.js';

export interface RunEntry { run_id: string; task: string; condition: string; profile: string; repetition: number; order_index: number }
export interface Manifest { kind: 'keystone-bench-work-manifest'; schema_version: 1; plan: { id: string; hash: string }; seed: number; runs: RunEntry[] }
export interface RunState {
  status: 'prepared' | 'running' | 'awaiting-record' | 'recorded' | 'done' | 'unrecorded';
  /** The plan hash the run's workspace and staged inputs were prepared under (review B3). */
  plan: string;
  files_staged: number;
  setup?: unknown; manual?: unknown;
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

export type Outcome = 'valid' | 'invalid' | 'prepared' | 'unchanged' | 'completed' | 'awaiting-record' | 'recorded' | 'scored' | 'reported' | 'blocked' | 'failed';
export interface Result { command: string; outcome: Outcome; plan: { id: string; hash: string } | null; diagnostics: Diagnostic[]; [key: string]: unknown }

export interface Context { plan: LoadedPlan; where: Locations }

/** Loads the plan, checks locations and refuses to continue a plan whose content changed. */
export async function open(command: string, planFile: string, root: string, work: string | undefined): Promise<{ context?: Context; result?: Result }> {
  const { plan, diagnostics } = await loadPlan(planFile, weightable);
  if (!plan) return { result: { command, outcome: 'invalid', plan: null, diagnostics } };
  const where = locations(plan, root, work);
  const located = await locationDiagnostics(plan, where);
  if (located.length) return { result: { command, outcome: 'blocked', plan: { id: plan.spec.id, hash: plan.hash }, diagnostics: located } };
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

export async function prepare(planFile: string, root: string, work?: string): Promise<Result> {
  const opened = await open('prepare', planFile, root, work);
  if (!opened.context) return opened.result!;
  const { plan, where } = opened.context;
  const identity = { id: plan.spec.id, hash: plan.hash };
  const changed = await planChanges(opened.context);
  if (changed.length) return { command: 'prepare', outcome: 'blocked', plan: identity, diagnostics: changed };
  try {
    if (!(await lstat(plan.subjectPath)).isDirectory()) throw new Error();
  } catch {
    return { command: 'prepare', outcome: 'blocked', plan: identity, diagnostics: [{ code: 'BENCH_SUBJECT_INVALID', path: plan.spec.subject.repository, message: 'The subject repository is not a local directory.' }] };
  }
  if (!(await hasCommit(plan.subjectPath, plan.spec.subject.commit))) {
    return { command: 'prepare', outcome: 'blocked', plan: identity, diagnostics: [{ code: 'BENCH_SUBJECT_COMMIT_MISSING', path: plan.spec.subject.repository, message: `The subject does not contain commit ${plan.spec.subject.commit}.` }] };
  }
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
    try {
      await guard(where.boundaries.work, paths.base);
      await rm(paths.base, { recursive: true, force: true });
      await guard(where.boundaries.work, paths.harness);
      await mkdir(paths.harness, { recursive: true });
      await guard(where.boundaries.work, paths.workspace);
      await cloneAt(plan.subjectPath, paths.workspace, plan.spec.subject.commit);
      const condition = plan.conditions.find(c => c.spec.id === run.condition)!;
      for (const entry of condition.spec.setup.files) {
        await guard(where.boundaries.work, paths.workspace);
        const destination = await safePath(paths.workspace, entry.to);
        await mkdir(path.dirname(destination), { recursive: true });
        const staged = await writeVerified(destination, await readFile(path.join(condition.directory, ...entry.from.split('/'))), where.boundaries.work);
        if (staged) throw staged;
      }
      const failure = await writeVerified(paths.state, serialize({ status: 'prepared', plan: plan.hash, files_staged: condition.spec.setup.files.length } satisfies RunState), where.boundaries.work);
      if (failure) throw failure;
      prepared.push(run.run_id);
    } catch (error) {
      // Cleanup removes only a run directory that is still inside its boundary.
      try { await guard(where.boundaries.work, paths.base); await rm(paths.base, { recursive: true, force: true }); } catch { /* Left in place; reported below. */ }
      const diagnostics = error instanceof BoundaryError ? [error.diagnostic] : (error as { diagnostics?: Diagnostic[] }).diagnostics ??
        [{ code: (error as Error).name === 'BenchGitError' ? 'BENCH_CLONE_FAILED' : 'BENCH_PREPARE_FAILED', path: run.run_id, message: `Workspace preparation failed (${(error as Error).message}); the run was not prepared.` }];
      return { command: 'prepare', outcome: 'failed', plan: identity, diagnostics, prepared, unchanged, work: where.work };
    }
  }
  return { command: 'prepare', outcome: prepared.length ? 'prepared' : 'unchanged', plan: identity, diagnostics: [], prepared, unchanged, runs, work: where.work };
}
