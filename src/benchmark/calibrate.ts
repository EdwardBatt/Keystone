import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { compare, serialize, type Diagnostic } from '../core.js';
import { loadRecords, writeVerified } from './store.js';
import { open, type Result } from './prepare.js';
import { measure } from './score.js';
import { loadAttempts, terminalRuns } from './attempts.js';
import { isPilot } from './plans.js';
import { analysisMeasureDiagnostics } from './specs.js';
import { weightable } from './scorecard.js';

/** The condition-blind calibration and resource export of a pilot (TASK-0015 item 6, P6,
 * clarification 2). The dataset keeps only task, profile, outcomes, resource use and attempt
 * counts, under fresh random IDs whose secret is discarded, so it cannot be joined back to condition
 * identity. Every parameter comes from the plan's analysis specification; no rule reads effect
 * direction.
 */

const round = (value: number | null) => value === null ? null : Math.round(value * 1e6) / 1e6;
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
/** Sample standard deviation (n − 1); undefined below two observations. */
export function sampleSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}
/** R_cell = ⌈2σ² ÷ SE²⌉, so that σ·√(2/R) ≤ SE; the minimum when σ = 0. */
export function requiredR(sigma: number, se: number, minimum: number): number {
  return sigma === 0 ? minimum : Math.max(1, Math.ceil(2 * sigma * sigma / (se * se) - 1e-9));
}

export interface Row { calibration_id: string; task: string; profile: string; valid: boolean; measure: number | null; recurrences: number | null; opportunities: number; tokens: number | null; seconds: number | null; sessions: number; attempts: number }

export async function calibrate(planFile: string, root: string, work: string | undefined, repos?: string): Promise<Result> {
  const opened = await open('calibrate', planFile, root, work, { repos });
  if (!opened.context) return opened.result!;
  const context = opened.context;
  const { plan, where } = context;
  const identity = { id: plan.spec.id, hash: plan.hash };
  const blocked = (diagnostics: Diagnostic[]): Result => ({ command: 'calibrate', outcome: 'blocked', plan: identity, diagnostics });
  const c = plan.analysis?.calibration;
  if (!isPilot(plan) || !c || !plan.analysis) return blocked([{ code: 'BENCH_CALIBRATION_UNSUPPORTED', path: plan.spec.id, message: 'calibrate runs on a version 2 pilot plan whose analysis specification declares calibration.' }]);
  const spec = plan.analysis;
  const ineligible = analysisMeasureDiagnostics(spec, plan.spec, weightable, plan.spec.analysis!);
  if (ineligible.length) return blocked(ineligible);
  const { records, refused } = await loadRecords(plan, where);
  const attempts = await loadAttempts(context);
  if (refused.length || attempts.refused.length) return blocked([...refused, ...attempts.refused]);

  // A terminal infrastructure failure is not an outcome: it is excluded from the dataset and counted
  // as an infrastructure failure (P6, P10).
  const terminal = terminalRuns(attempts.logs);
  const rows: Row[] = records.filter(({ record }) => !terminal.has(record.run_id)).map(({ record }) => {
    const scored = measure(record, undefined, new Set());
    // Only comparative measures are read; a condition-specific diagnostic never enters calibration.
    const value = (name: string) => { const v = scored.measures[name]?.value; return typeof v === 'number' ? v : null; };
    const final = (record.checks.at(-1)?.results ?? []) as { role: string }[];
    return {
      calibration_id: `C-${randomBytes(6).toString('hex')}`, task: scored.task, profile: scored.profile, valid: record.status === 'completed',
      measure: value(c.measure), recurrences: value(c.recurrence_measure), opportunities: final.filter(r => r.role === 'trap').length,
      tokens: value(c.resources.tokens), seconds: value(c.resources.seconds), sessions: record.sessions.length,
      attempts: (attempts.logs.get(record.run_id)?.attempts.length ?? 0) + 1,
    };
  }).sort((a, b) => compare(a.calibration_id, b.calibration_id));

  const tasks = plan.tasks.map(t => t.spec.id).sort(compare);
  const profiles = plan.profiles.map(p => p.spec.id).sort(compare);
  const numbers = (list: Row[], pick: (r: Row) => number | null) => list.map(pick).filter((v): v is number => v !== null);

  // Task discrimination, pooled over conditions and profiles.
  const discrimination = tasks.map(task => {
    const mine = rows.filter(r => r.task === task);
    const pass = mean(numbers(mine, r => r.measure));
    const opportunities = mine.reduce((s, r) => s + (r.recurrences === null ? 0 : r.opportunities), 0);
    const failed = mine.reduce((s, r) => s + (r.recurrences ?? 0), 0);
    const recurrence = opportunities ? failed / opportunities : null;
    const flags = [
      ...(pass !== null && pass >= c.ceiling ? ['ceiling'] : []),
      ...(pass !== null && pass <= c.floor ? ['floor'] : []),
      ...(spec.task_groups.headline.includes(task) && recurrence !== null && (recurrence === 0 || recurrence === 1) ? ['recurrence-extreme'] : []),
    ];
    return { task, runs: mine.length, pass_rate: round(pass), recurrence_rate: round(recurrence), opportunities, non_discriminating: flags.length > 0, flags };
  });

  // Infrastructure reliability: classified infrastructure attempts over all attempts.
  // Every logged attempt (archived or terminal) is a classified infrastructure failure.
  const archived = [...attempts.logs.values()].reduce((s, log) => s + log.attempts.length, 0);
  const totalAttempts = rows.length + archived;
  const infraRate = totalAttempts ? archived / totalAttempts : 0;

  // Precision: condition-blind pooled σ per piloted headline cell; substitution for unpiloted targets.
  const observed = spec.task_groups.headline.flatMap(task => profiles.map(profile => {
    const values = numbers(rows.filter(r => r.task === task && r.profile === profile && r.valid), r => r.measure);
    return { task, profile, n: values.length, sigma: sampleSd(values) };
  }));
  const cells = c.target_tasks.flatMap(task => profiles.map(profile => {
    const own = observed.find(o => o.task === task && o.profile === profile && o.sigma !== null);
    if (own) return { task, profile, sigma: own.sigma!, source: { kind: 'observed' as const, task, profile } };
    const candidates = observed.filter(o => o.profile === profile && o.sigma !== null).sort((a, b) => b.sigma! - a.sigma! || compare(a.task, b.task));
    return candidates.length
      ? { task, profile, sigma: candidates[0].sigma!, source: { kind: 'substituted' as const, task: candidates[0].task, profile } }
      : { task, profile, sigma: null, source: { kind: 'unavailable' as const, task: null, profile } };
  }));
  const withR = cells.map(cell => ({ ...cell, sigma: round(cell.sigma), r_cell: cell.sigma === null ? null : requiredR(cell.sigma, c.se_target, c.repetitions.min) }));
  const undefinedCells = withR.filter(cell => cell.r_cell === null);
  const maximum = undefinedCells.length ? null : Math.max(...withR.map(cell => cell.r_cell!));
  const R = maximum === null ? null : Math.min(Math.max(maximum, c.repetitions.min), c.repetitions.max);
  const lower = maximum !== null && maximum > c.repetitions.max;
  const precision = {
    se_target: c.se_target, repetitions: c.repetitions, r: R, maximum_r_cell: maximum,
    designation: R === null ? 'undetermined' : lower ? 'LOWER PRECISION' : 'normal',
    cells: withR.map(cell => ({ ...cell, expected_se: cell.sigma === null || R === null ? null : round(cell.sigma * Math.sqrt(2 / R)), meets_target: cell.r_cell === null ? null : cell.r_cell <= c.repetitions.max })),
    observed: observed.map(o => ({ ...o, sigma: round(o.sigma) })),
  };

  // Resources: means per run by task group and profile; projections over the declared R range.
  const group = (task: string) => spec.task_groups.headline.includes(task) ? 'headline' : 'control';
  const usage = (['headline', 'control'] as const).flatMap(g => profiles.map(profile => {
    const mine = rows.filter(r => group(r.task) === g && r.profile === profile);
    return { group: g, profile, runs: mine.length, mean_tokens: round(mean(numbers(mine, r => r.tokens))), mean_seconds: round(mean(numbers(mine, r => r.seconds))), mean_sessions: round(mean(mine.map(r => r.sessions))) };
  }));
  const conditions = plan.conditions.length;
  const plannedTasks = { headline: c.target_tasks.length, control: c.resources.control_tasks.length };
  const projections = [];
  for (let r = c.repetitions.min; r <= c.repetitions.max; r++) {
    let tokens: number | null = 0, seconds: number | null = 0, runs = 0;
    for (const u of usage) {
      const n = plannedTasks[u.group] * conditions * r;
      if (!n) continue;
      runs += n;
      tokens = tokens === null || u.mean_tokens === null ? null : tokens + n * (1 + infraRate) * u.mean_tokens;
      seconds = seconds === null || u.mean_seconds === null ? null : seconds + n * (1 + infraRate) * u.mean_seconds;
    }
    projections.push({ r, runs, runs_with_rerun_allowance: round(runs * (1 + infraRate)), tokens: round(tokens), seconds: round(seconds) });
  }

  const body = {
    kind: 'keystone-bench-calibration', schema_version: 1, generated_by: 'keystone-bench', plan: identity, non_evidence: true,
    note: 'Condition-blind: no condition, condition-derived hash, setup data, diagnostics, path, telemetry or failure text; random IDs whose secret is discarded. No rule reads effect direction.',
    parameters: c,
    dataset: rows,
    discrimination,
    infrastructure: { attempts: totalAttempts, infrastructure_attempts: archived, terminal_infrastructure_failures: terminal.size, rate: round(infraRate), threshold: c.infrastructure_threshold, exceeds_threshold: infraRate > c.infrastructure_threshold },
    precision,
    resources: { usage, projections },
  };
  const lines = [`# Calibration — ${plan.spec.id} (condition-blind, non-evidence)`, '',
    `Runs: ${rows.length}. Infrastructure attempts: ${archived} of ${totalAttempts} (rate ${round(infraRate)}; threshold ${c.infrastructure_threshold}${infraRate > c.infrastructure_threshold ? ', EXCEEDED' : ''}).`, '',
    '## Task discrimination', '', '| Task | Runs | Pass rate | Recurrence rate | Flags |', '|---|---|---|---|---|',
    ...discrimination.map(d => `| ${d.task} | ${d.runs} | ${d.pass_rate ?? '—'} | ${d.recurrence_rate ?? '—'} | ${d.flags.join(', ') || '—'} |`),
    '', `## Precision: R = ${R ?? 'undetermined'} (${precision.designation})`, '', '| Task | Profile | σ | Source | R_cell | Expected SE |', '|---|---|---|---|---|---|',
    ...precision.cells.map(cell => `| ${cell.task} | ${cell.profile} | ${cell.sigma ?? '—'} | ${cell.source.kind}${cell.source.kind === 'substituted' ? ` from ${cell.source.task}` : ''} | ${cell.r_cell ?? '—'} | ${cell.expected_se ?? '—'} |`),
    '', '## Resource projection (for the owner’s budget approval)', '', '| R | Runs | With rerun allowance | Tokens | Seconds |', '|---|---|---|---|---|',
    ...projections.map(p => `| ${p.r} | ${p.runs} | ${p.runs_with_rerun_allowance} | ${p.tokens ?? '—'} | ${p.seconds ?? '—'} |`), ''];
  for (const [name, contents] of [['calibration.json', serialize(body)], ['calibration.md', lines.join('\n')]] as const) {
    const failure = await writeVerified(path.join(where.analysis, name), contents, where.boundaries.analysis);
    if (failure) return { command: 'calibrate', outcome: 'failed', plan: identity, diagnostics: failure.diagnostics };
  }
  const diagnostics: Diagnostic[] = undefinedCells.length ? [{ code: 'BENCH_CALIBRATION_INCOMPLETE', path: plan.spec.id, message: `${undefinedCells.length} target cell(s) have no observed σ for their profile; R is undetermined.` }] : [];
  return { command: 'calibrate', outcome: 'calibrated', plan: identity, diagnostics, r: R, designation: precision.designation, calibration: path.join(where.analysis, 'calibration.json') };
}
