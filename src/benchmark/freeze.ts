import path from 'node:path';
import { serialize, type Diagnostic } from '../core.js';
import { checkout } from './git.js';
import { pinDiagnostics } from './repos.js';
import { readJsonFile, sealRecord, writeVerified } from './store.js';
import { open, type Result } from './prepare.js';
import { freezeFile, readFreeze } from './plans.js';
import { exposureVerified } from './exposure.js';

/** `keystone-bench freeze <plan>` (TASK-0015 item 4, P12): for a version 2 experiment plan at its
 * canonical location, checks the freezing preconditions and writes `freeze.json`. Launches nothing.
 * A frozen plan never changes: a corrected plan is a new plan ID.
 */
export async function freeze(planFile: string, root: string, work: string | undefined, repos?: string): Promise<Result> {
  const opened = await open('freeze', planFile, root, work, { repos, gates: ['canonical'] });
  if (!opened.context) return opened.result!;
  const context = opened.context;
  const { plan } = context;
  const identity = { id: plan.spec.id, hash: plan.hash };
  const blocked = (diagnostics: Diagnostic[]): Result => ({ command: 'freeze', outcome: 'blocked', plan: identity, diagnostics });
  if (plan.version !== 2 || plan.spec.purpose !== 'experiment') return blocked([{ code: 'BENCH_FREEZE_UNSUPPORTED', path: plan.spec.id, message: 'Only version 2 experiment plans are frozen.' }]);
  const existing = await readFreeze(root, plan.spec.id);
  if (existing) {
    if (existing.plan.hash === plan.hash) return { command: 'freeze', outcome: 'unchanged', plan: identity, diagnostics: [], freeze: freezeFile(root, plan.spec.id) };
    return blocked([{ code: 'BENCH_PLAN_CHANGED', path: `benchmark/plans/${plan.spec.id}/freeze.json`, message: `The plan was frozen at hash ${existing.plan.hash}; a frozen plan never changes. A corrected plan needs a new plan ID.` }]);
  }
  const problems: Diagnostic[] = [];
  // The plan directory is committed and unchanged, and the Keystone checkout is clean (P12).
  const keystone = await checkout(root);
  const relative = `benchmark/plans/${plan.spec.id}`;
  if (!keystone.commit) problems.push({ code: 'BENCH_KEYSTONE_DIRTY', path: '.', message: 'The Keystone tree has no commit; commit the plan before freezing.' });
  else {
    if (keystone.dirty !== false) problems.push({ code: 'BENCH_KEYSTONE_DIRTY', path: '.', message: 'The Keystone checkout has uncommitted changes to tracked files.' });
    const committed = await pinDiagnostics([{ name: 'subject', id: 'the Keystone tree', commit: keystone.commit, path: path.resolve(root), bundles: [relative] }], relative);
    if (committed.length) problems.push({ code: 'BENCH_KEYSTONE_DIRTY', path: relative, message: 'The plan directory must be committed: every file tracked and unchanged, nothing untracked.' });
  }
  if (!(await exposureVerified(context))) problems.push({ code: 'BENCH_EXPOSURE_NOT_VERIFIED', path: plan.spec.id, message: 'No passing exposure verification exists for the current plan hash; run verify-exposure.' });
  // A main plan is calibrated from a frozen pilot (P6, P12): it names the pilot, the pilot was frozen
  // at that hash, and the pilot's calibration export exists for that hash with a determined R.
  if (plan.spec.stage === 'main') {
    const from = plan.spec.calibrated_from;
    if (!from) problems.push({ code: 'BENCH_CALIBRATION_MISSING', path: plan.spec.id, field: '/calibrated_from', message: 'A main plan names the pilot it was calibrated from (calibrated_from).' });
    else {
      const pilot = await readFreeze(root, from.id);
      if (!pilot || pilot.plan.hash !== from.hash || pilot.stage !== 'pilot') {
        problems.push({ code: 'BENCH_CALIBRATION_MISSING', path: plan.spec.id, field: '/calibrated_from', message: `No pilot ${from.id} was frozen at hash ${from.hash}.` });
      }
      const calibration = await readJsonFile<{ kind?: string; plan?: { id: string; hash: string }; precision?: { r?: number | null } }>(path.join(path.resolve(root), 'benchmark', 'analysis', from.id, 'calibration.json'));
      if (calibration?.kind !== 'keystone-bench-calibration' || calibration.plan?.id !== from.id || calibration.plan?.hash !== from.hash) {
        problems.push({ code: 'BENCH_CALIBRATION_MISSING', path: plan.spec.id, field: '/calibrated_from', message: `No calibration export exists for pilot ${from.id} at hash ${from.hash}.` });
      } else if (typeof calibration.precision?.r !== 'number') {
        problems.push({ code: 'BENCH_CALIBRATION_MISSING', path: plan.spec.id, field: '/calibrated_from', message: `The calibration export of pilot ${from.id} has no determined R.` });
      }
    }
  }
  if (problems.length) return blocked(problems);
  const record = {
    kind: 'keystone-bench-freeze', schema_version: 1, plan: identity, stage: plan.spec.stage!, calibrated_from: plan.spec.calibrated_from ?? null,
    // Every plan-directory file the plan hash covers (all but this generated record).
    files: plan.planDirectoryFiles,
    repositories: { subject: plan.subject, benchmark: plan.benchmark ? { id: plan.benchmark.id, commit: plan.benchmark.commit } : null },
    keystone: { commit: keystone.commit },
    exposure_verification: (await exposureVerified(context))!.hash,
    date: new Date().toISOString().slice(0, 10),
  };
  const failure = await writeVerified(freezeFile(root, plan.spec.id), sealRecord(record), context.where.boundaries.plans);
  if (failure) return { command: 'freeze', outcome: 'failed', plan: identity, diagnostics: failure.diagnostics };
  return { command: 'freeze', outcome: 'frozen', plan: identity, diagnostics: [], freeze: freezeFile(root, plan.spec.id), record: JSON.parse(serialize(record)) };
}
