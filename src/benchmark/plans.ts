import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { compare, type Diagnostic } from '../core.js';
import type { LoadedPlan } from './specs.js';
import { evidenceHash, physical, readJsonFile } from './store.js';

/** Version 2 experiment plans live at `benchmark/plans/<plan-id>/` in the Keystone tree (TASK-0015
 * item 4). The directory is experiment-control material, excluded from protocol discovery and START
 * like results and analysis (ADR-0004, 2026-10-07 clarification).
 */
export const planDirectory = (root: string, id: string) => path.join(path.resolve(root), 'benchmark', 'plans', id);
export const freezeFile = (root: string, id: string) => path.join(planDirectory(root, id), 'freeze.json');

/** A version 2 experiment plan must be run from its canonical location. */
export async function canonicalDiagnostics(plan: LoadedPlan, root: string): Promise<Diagnostic[]> {
  if (plan.version !== 2 || plan.spec.purpose !== 'experiment') return [];
  const expected = path.join(planDirectory(root, plan.spec.id), 'plan.json');
  const [actual, wanted] = await Promise.all([physical(plan.file), physical(expected)]);
  const norm = (p: string) => process.platform === 'win32' ? p.toLowerCase() : p;
  if (norm(actual) === norm(wanted)) return [];
  return [{ code: 'BENCH_PLAN_LOCATION_INVALID', path: path.basename(plan.file), message: `An experiment plan is run from benchmark/plans/${plan.spec.id}/plan.json in the Keystone tree given by --root.` }];
}

export interface FreezeRecord {
  kind: 'keystone-bench-freeze'; schema_version: 1; plan: { id: string; hash: string };
  stage: string; calibrated_from: { id: string; hash: string } | null; [key: string]: unknown;
}

/** The freeze record of a plan, when it is intact (its evidence hash matches). */
export async function readFreeze(root: string, id: string): Promise<FreezeRecord | undefined> {
  const record = await readJsonFile<FreezeRecord & { evidence_hash?: string }>(freezeFile(root, id));
  if (!record || record.kind !== 'keystone-bench-freeze' || record.evidence_hash !== evidenceHash(record as Record<string, unknown>)) return undefined;
  return record;
}

/** `prepare` and `run` refuse a version 2 experiment plan without a freeze record for its current hash. */
export async function frozenDiagnostics(plan: LoadedPlan, root: string): Promise<Diagnostic[]> {
  if (plan.version !== 2 || plan.spec.purpose !== 'experiment') return [];
  const record = await readFreeze(root, plan.spec.id);
  if (record?.plan.id === plan.spec.id && record.plan.hash === plan.hash) return [];
  return [{ code: 'BENCH_PLAN_NOT_FROZEN', path: `benchmark/plans/${plan.spec.id}/freeze.json`, message: record ? `The freeze record names plan hash ${record.plan.hash}; the plan now hashes to ${plan.hash}. Freeze the plan again under a new plan ID.` : 'Run keystone-bench freeze before preparing or running an experiment plan.' }];
}

/** A pilot stays condition-blind until a main plan calibrated from it has been frozen (TASK-0015 item 6). */
export async function pilotReleased(plan: LoadedPlan, root: string): Promise<boolean> {
  let names: string[] = [];
  try { names = (await readdir(path.join(path.resolve(root), 'benchmark', 'plans'))).sort(compare); } catch { return false; }
  for (const name of names) {
    const record = await readFreeze(root, name);
    if (record?.calibrated_from?.id === plan.spec.id && record.calibrated_from.hash === plan.hash) return true;
  }
  return false;
}

export const isPilot = (plan: LoadedPlan) => plan.version === 2 && plan.spec.purpose === 'experiment' && plan.spec.stage === 'pilot';

/** `score`, `report` and `analyze` refuse a pilot until it is released; afterwards its output is non-evidence. */
export async function pilotDiagnostics(plan: LoadedPlan, root: string): Promise<Diagnostic[]> {
  if (!isPilot(plan) || await pilotReleased(plan, root)) return [];
  return [{ code: 'BENCH_PILOT_CONDITION_BLIND', path: plan.spec.id, message: 'A pilot stays condition-blind until a main plan calibrated from it is frozen; use calibrate for its condition-blind export.' }];
}
