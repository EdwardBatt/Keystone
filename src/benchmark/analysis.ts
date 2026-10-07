import path from 'node:path';
import { createHash } from 'node:crypto';
import { compare, serialize, type Diagnostic } from '../core.js';
import type { AnalysisSpec, Classification, Completeness } from './specs.js';
import { writeVerified } from './store.js';
import { matrix, open, type Result } from './prepare.js';
import { computeScores, type RunScore } from './score.js';
import { loadAttempts, terminalRuns } from './attempts.js';
import { analysisMeasureDiagnostics } from './specs.js';
import { weightable } from './scorecard.js';
import { loadJudgements2, judgingSummary } from './judging.js';
import { identityFindings } from './report.js';
import { isPilot } from './plans.js';

/** The pre-registered final analysis (TASK-0015 item 9; clarifications 5 and 8). The harness holds
 * generic definitions only — the effect types, the five class predicates, the completeness rules
 * and the resampling procedures. Every margin, threshold, measure, rule choice, order, iteration
 * count and seed comes from the plan's frozen analysis specification (Q3).
 */

type Spec = NonNullable<AnalysisSpec['analysis']>;
type Primary = Spec['primary'][number];
type Guardrail = Spec['guardrails'][number];
const EPS = 1e-12;
const round = (value: number | null) => value === null ? null : Math.round(value * 1e9) / 1e9;
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export const required = (rule: Completeness, R: number) => rule === 'all-planned' ? R : Math.ceil(R / 2);

/** An effect estimate: a number, or the unbounded deterioration of a relative reduction (B = 0 < K). */
export type Estimate = number | 'unbounded-deterioration';
const magnitude = (e: Estimate) => e === 'unbounded-deterioration' ? Infinity : Math.abs(e);
const asNumber = (e: Estimate) => e === 'unbounded-deterioration' ? -Infinity : e;

/** The four zero-value cases of a relative reduction r = 1 − K ÷ B (TASK-0014 revision 5). */
export function relativeReduction(B: number, K: number): Estimate {
  if (B === 0 && K === 0) return 0;
  if (B === 0) return 'unbounded-deterioration';
  return 1 - K / B;
}

export function estimate(effect: Primary['effect'], cells: { treatment: number; reference: number }[]): Estimate {
  const w = 1 / cells.length;
  if (effect === 'difference') return cells.reduce((s, c) => s + w * (c.treatment - c.reference), 0);
  return relativeReduction(cells.reduce((s, c) => s + w * c.reference, 0), cells.reduce((s, c) => s + w * c.treatment, 0));
}
export const improves = (e: Estimate | null, margin: number) => e !== null && e !== 'unbounded-deterioration' && e >= margin - EPS;
export const deteriorates = (e: Estimate | null, margin: number) => e !== null && (e === 'unbounded-deterioration' || e <= -margin + EPS);

/** A deterministic stream of uniform draws: SHA-256 of seed, label and counter. */
class Draws {
  private buffer: number[] = [];
  private counter = 0;
  constructor(private readonly seed: number, private readonly label: string) {}
  next(): number {
    if (!this.buffer.length) {
      const digest = createHash('sha256').update(`${this.seed}:${this.label}:${this.counter++}`).digest();
      for (let i = 0; i < 32; i += 4) this.buffer.push(digest.readUInt32BE(i) / 4294967296);
    }
    return this.buffer.shift()!;
  }
  below(n: number): number { return Math.min(n - 1, Math.floor(this.next() * n)); }
}

interface Cell { task: string; profile: string; treatment: number[]; reference: number[] }

interface Evaluated { value: Estimate | null; defined: boolean; improvement: boolean; deterioration: boolean }
function evaluate(primary: Primary, cells: Cell[], need: number): Evaluated & { cells: Record<string, unknown>[] } {
  const described = cells.map(c => ({
    task: c.task, profile: c.profile, defined: c.treatment.length >= need && c.reference.length >= need,
    treatment: { n: c.treatment.length, mean: c.treatment.length ? round(mean(c.treatment)) : null },
    reference: { n: c.reference.length, mean: c.reference.length ? round(mean(c.reference)) : null },
  }));
  const defined = cells.length > 0 && described.every(c => c.defined);
  const value = defined ? estimate(primary.effect, cells.map(c => ({ treatment: mean(c.treatment), reference: mean(c.reference) }))) : null;
  return { value, defined, improvement: improves(value, primary.margin), deterioration: deteriorates(value, primary.margin), cells: described };
}

type Status = 'ok' | 'breached' | 'unknown';
function guardrail(g: Guardrail, cells: Cell[], need: number): { status: Status; treatment: number | null; reference: number | null; value: number | null; incomplete_cells: number } {
  const statistic = (values: number[]) => g.statistic === 'median' ? median(values) : mean(values);
  // Data failing the completeness rule makes the guardrail unknown; no value is computed from the rest (C3).
  const incomplete = cells.filter(c => c.treatment.length < need || c.reference.length < need).length;
  if (!cells.length || incomplete) return { status: 'unknown', treatment: null, reference: null, value: null, incomplete_cells: incomplete };
  const K = mean(cells.map(c => statistic(c.treatment)));
  const B = mean(cells.map(c => statistic(c.reference)));
  if (g.breach.lower_by_more_than !== undefined) {
    const value = K - B;
    return { status: value < -g.breach.lower_by_more_than - EPS ? 'breached' : 'ok', treatment: round(K), reference: round(B), value: round(value), incomplete_cells: 0 };
  }
  if (B === 0) return { status: 'unknown', treatment: round(K), reference: round(B), value: null, incomplete_cells: 0 };
  const value = K / B - 1;
  return { status: value > g.breach.relative_increase_above! + EPS ? 'breached' : 'ok', treatment: round(K), reference: round(B), value: round(value), incomplete_cells: 0 };
}

interface Evidence { primaries: { id: string; pooled: Evaluated; perTool: Map<string, Evaluated> }[]; guardrails: Status[] }

/** The five generic class predicates, evaluated in the declared order; the first true one decides. */
export function classify(order: Classification[], evidence: Evidence, tools: boolean): { result: Classification | null; triggers: string[] } {
  const { primaries, guardrails } = evidence;
  const allDefined = primaries.every(p => p.pooled.defined);
  const anyImproves = primaries.some(p => p.pooled.improvement);
  const anyDeteriorates = primaries.some(p => p.pooled.deterioration);
  const triggers: Record<Classification, string[]> = { mixed: [], unclassifiable: [], positive: [], negative: [], neutral: [] };
  // Mixed: established only from defined primary evidence; missing data never overrides it.
  if (tools) {
    for (const p of primaries) {
      const defined = [...p.perTool.entries()].filter(([, e]) => e.defined);
      if (defined.some(([, e]) => e.improvement) && defined.some(([, e]) => e.deterioration)) triggers.mixed.push(`tool-contradiction:${p.id}`);
    }
  }
  for (const p of primaries) for (const q of primaries) {
    if (p !== q && p.pooled.improvement && q.pooled.deterioration) triggers.mixed.push(`primary-contradiction:${p.id}>${q.id}`);
  }
  if (anyImproves && guardrails.includes('breached')) triggers.mixed.push('improvement-with-breached-guardrail');
  // UNCLASSIFIABLE: only when missing required evidence prevents the otherwise applicable class.
  for (const p of primaries) if (!p.pooled.defined) triggers.unclassifiable.push(`undefined-primary:${p.id}`);
  if (allDefined && anyImproves && !anyDeteriorates && guardrails.includes('unknown')) triggers.unclassifiable.push('positive-with-unknown-guardrail');
  if (allDefined && anyImproves && !anyDeteriorates && guardrails.every(g => g === 'ok')) triggers.positive.push('improvement-guardrails-known-ok');
  if (allDefined && anyDeteriorates && !anyImproves) triggers.negative.push(guardrails.includes('unknown') ? 'deterioration (guardrails unknown, reported)' : 'deterioration');
  if (allDefined && !anyImproves && !anyDeteriorates) triggers.neutral.push('no-margin-crossed');
  for (const name of order) if (triggers[name].length) return { result: name, triggers: triggers[name] };
  return { result: null, triggers: [] };
}

function display(e: Estimate | null) { return e === null ? null : e === 'unbounded-deterioration' ? e : round(e); }

export async function analyze(planFile: string, root: string, work: string | undefined, repos?: string): Promise<Result> {
  const opened = await open('analyze', planFile, root, work, { repos, gates: ['pilot'] });
  if (!opened.context) return opened.result!;
  const context = opened.context;
  const { plan, where } = context;
  const identity = { id: plan.spec.id, hash: plan.hash };
  const spec = plan.analysis?.analysis;
  if (plan.version !== 2 || !plan.analysis || !spec) return { command: 'analyze', outcome: 'blocked', plan: identity, diagnostics: [{ code: 'BENCH_ANALYSIS_UNSUPPORTED', path: plan.spec.id, message: 'analyze runs on a version 2 plan whose analysis specification declares an analysis.' }] };
  const ineligible = analysisMeasureDiagnostics(plan.analysis, plan.spec, weightable, plan.spec.analysis!);
  if (ineligible.length) return { command: 'analyze', outcome: 'blocked', plan: identity, diagnostics: ineligible };
  const groups = plan.analysis.task_groups;
  const { reference, treatment } = plan.analysis.conditions;
  const { scores, refused, records } = await computeScores(context);
  const attempts = await loadAttempts(context);
  if (refused.length || attempts.refused.length) return { command: 'analyze', outcome: 'blocked', plan: identity, diagnostics: [...refused, ...attempts.refused] };
  const R = plan.spec.repetitions;
  const profiles = plan.profiles.map(p => p.spec.id).sort(compare);
  const planned = matrix(plan);
  // An infrastructure failure that exhausted its reruns is missing, never an outcome (P10, B2).
  const terminal = terminalRuns(attempts.logs);
  const byRun = new Map(scores.filter(s => !terminal.has(s.run_id)).map(s => [s.run_id, s]));
  // Only comparative measures are read; a condition-specific diagnostic is never an observation.
  const valueOf = (s: RunScore, name: string) => { const v = s.measures[name]?.value; return typeof v === 'number' ? v : null; };
  /** Every planned run of a cell; a missing record or a null value contributes no observation. */
  const cellsFor = (tasks: string[], name: string, only?: string): Cell[] => tasks.flatMap(task => profiles.filter(p => !only || p === only).map(profile => {
    const values = (condition: string) => planned.filter(r => r.task === task && r.profile === profile && r.condition === condition)
      .map(r => byRun.get(r.run_id)).filter((s): s is RunScore => !!s).map(s => valueOf(s, name)).filter((v): v is number => v !== null);
    return { task, profile, treatment: values(treatment), reference: values(reference) };
  }));
  const needPrimary = required(spec.completeness.primary, R);
  const needGuardrail = required(spec.completeness.guardrails, R);
  const allTasks = [...groups.headline, ...groups.control].sort(compare);

  const primaries = spec.primary.map(p => {
    const pooled = evaluate(p, cellsFor(groups.headline, p.measure), needPrimary);
    const perTool = new Map(profiles.map(profile => [profile, evaluate(p, cellsFor(groups.headline, p.measure, profile), needPrimary)] as const));
    return { primary: p, pooled, perTool };
  });
  const guardrails = spec.guardrails.map(g => ({
    guardrail: g, pooled: guardrail(g, cellsFor(allTasks, g.measure), needGuardrail),
    perTool: Object.fromEntries(profiles.map(profile => [profile, guardrail(g, cellsFor(allTasks, g.measure, profile), needGuardrail)])),
  }));
  const overall = classify(spec.classification_order, { primaries: primaries.map(p => ({ id: p.primary.id, pooled: p.pooled, perTool: p.perTool })), guardrails: guardrails.map(g => g.pooled.status) }, profiles.length > 1);
  const perProfile = Object.fromEntries(profiles.map(profile => [profile, classify(spec.classification_order, {
    primaries: primaries.map(p => ({ id: p.primary.id, pooled: p.perTool.get(profile)!, perTool: new Map() })),
    guardrails: guardrails.map(g => g.perTool[profile].status),
  }, false)]));

  // Supporting statistics: whole runs as units; they never override the classification.
  const statistics = primaries.map(({ primary, pooled }) => {
    const cells = cellsFor(groups.headline, primary.measure);
    if (!pooled.defined) return { id: primary.id, permutation: null, bootstrap: null };
    const observed = pooled.value!;
    const permute = new Draws(spec.permutation.seed, `permutation:${primary.id}`);
    let extreme = 0;
    for (let i = 0; i < spec.permutation.iterations; i++) {
      const shuffled = cells.map(c => {
        const all = [...c.treatment, ...c.reference];
        for (let k = all.length - 1; k > 0; k--) { const j = permute.below(k + 1); [all[k], all[j]] = [all[j], all[k]]; }
        return { treatment: mean(all.slice(0, c.treatment.length)), reference: mean(all.slice(c.treatment.length)) };
      });
      if (magnitude(estimate(primary.effect, shuffled)) >= magnitude(observed) - EPS) extreme++;
    }
    const boot = new Draws(spec.bootstrap.seed, `bootstrap:${primary.id}`);
    const draws: number[] = [];
    const resample = (values: number[]) => mean(values.map(() => values[boot.below(values.length)]));
    for (let i = 0; i < spec.bootstrap.iterations; i++) draws.push(asNumber(estimate(primary.effect, cells.map(c => ({ treatment: resample(c.treatment), reference: resample(c.reference) })))));
    draws.sort((a, b) => a - b);
    const tail = (1 - spec.bootstrap.level) / 2;
    const at = (q: number) => { const v = draws[Math.min(draws.length - 1, Math.max(0, q))]; return v === -Infinity ? 'unbounded-deterioration' : round(v); };
    return {
      id: primary.id,
      permutation: { iterations: spec.permutation.iterations, seed: spec.permutation.seed, p_value: round((1 + extreme) / (1 + spec.permutation.iterations)), blocks: 'headline task × profile' },
      bootstrap: {
        iterations: spec.bootstrap.iterations, seed: spec.bootstrap.seed, level: spec.bootstrap.level, strata: 'headline task × profile × condition',
        lower: at(Math.floor(tail * draws.length)), upper: at(Math.ceil((1 - tail) * draws.length) - 1),
        unbounded_share: round(draws.filter(d => d === -Infinity).length / draws.length),
      },
    };
  });

  const missing = planned.filter(r => !byRun.has(r.run_id));
  const judged = plan.spec.judging?.judges ? judgingSummary(plan, scores.map(s => ({ run_id: s.run_id, condition: s.condition, status: s.status })), (await loadJudgements2(context)).judgements) : null;
  const body = {
    kind: 'keystone-bench-analysis', schema_version: 1, generated_by: 'keystone-bench', plan: identity, stage: plan.spec.stage ?? null,
    ...(isPilot(plan) ? { non_evidence: true } : {}),
    precision: spec.precision === 'lower' ? 'LOWER PRECISION' : 'normal',
    parameters: { repetitions: R, conditions: plan.analysis.conditions, task_groups: groups, ...spec },
    matrix: { planned: planned.length, recorded: scores.length, infrastructure_missing: terminal.size, missing: missing.length, missing_by_cell: Object.fromEntries([...new Set(missing.map(r => `${r.task}/${r.profile}/${r.condition}`))].sort(compare).map(k => [k, missing.filter(r => `${r.task}/${r.profile}/${r.condition}` === k).length])), imputed: 0, reweighted: false },
    primary: primaries.map(({ primary, pooled, perTool }) => ({
      ...primary, required_observations: needPrimary,
      pooled: { value: display(pooled.value), defined: pooled.defined, improvement: pooled.improvement, deterioration: pooled.deterioration },
      per_profile: Object.fromEntries([...perTool.entries()].map(([k, e]) => [k, { value: display(e.value), defined: e.defined, improvement: e.improvement, deterioration: e.deterioration }])),
      cells: pooled.cells,
    })),
    guardrails: guardrails.map(g => ({ ...g.guardrail, required_observations: needGuardrail, pooled: g.pooled, per_profile: g.perTool })),
    classification: { overall: overall.result, triggers: overall.triggers, order: spec.classification_order, per_profile: perProfile },
    statistics: { note: 'Supporting only; never overrides the classification.', primary: statistics },
    identity: identityFindings(records.map(r => r.record)),
    attempts: { archived: [...attempts.logs.values()].reduce((s, l) => s + l.attempts.filter(e => !e.terminal).length, 0), terminal_infrastructure: terminal.size },
    judged,
  };
  const label = (c: Classification | null) => c === null ? 'no rule matched' : c.toUpperCase();
  const md = [`# Pre-registered analysis — ${plan.spec.id}${isPilot(plan) ? ' (pilot, non-evidence)' : ''}`, '',
    `Classification: **${label(overall.result)}** (${overall.triggers.join('; ') || '—'}). Precision: ${body.precision}.`, '',
    `Matrix: ${scores.length} of ${planned.length} planned runs recorded; ${missing.length} missing (never imputed, never reweighted).`, '',
    '## Co-primary outcomes', '', '| Outcome | Effect | Margin | Pooled | ' + profiles.join(' | ') + ' |', `|${'---|'.repeat(4 + profiles.length)}`,
    ...body.primary.map(p => `| ${p.id} | ${p.effect} | ${p.margin} | ${p.pooled.defined ? p.pooled.value : 'undefined'} | ${profiles.map(t => p.per_profile[t].defined ? p.per_profile[t].value : 'undefined').join(' | ')} |`),
    '', '## Guardrails (always reported)', '', '| Guardrail | Statistic | Pooled status | Value | ' + profiles.join(' | ') + ' |', `|${'---|'.repeat(4 + profiles.length)}`,
    ...body.guardrails.map(g => `| ${g.id} | ${g.statistic} | ${g.pooled.status} | ${g.pooled.value ?? '—'} | ${profiles.map(t => g.per_profile[t].status).join(' | ')} |`),
    '', '## Per-profile classification', '', ...profiles.map(t => `- ${t}: ${label(perProfile[t].result)}`),
    '', '## Supporting statistics (never override the classification)', '',
    ...statistics.map(s => s.permutation ? `- ${s.id}: permutation p = ${s.permutation.p_value}; ${s.bootstrap!.level * 100}% bootstrap interval [${s.bootstrap!.lower}, ${s.bootstrap!.upper}]; unbounded share ${s.bootstrap!.unbounded_share}` : `- ${s.id}: not computed (undefined primary)`), ''];
  for (const [name, contents] of [['analysis.json', serialize(body)], ['analysis.md', md.join('\n')]] as const) {
    const failure = await writeVerified(path.join(where.analysis, name), contents, where.boundaries.analysis);
    if (failure) return { command: 'analyze', outcome: 'failed', plan: identity, diagnostics: failure.diagnostics };
  }
  const diagnostics: Diagnostic[] = overall.result === null ? [{ code: 'BENCH_CLASSIFICATION_UNMATCHED', path: plan.spec.id, message: 'No class predicate matched; check the declared classification order.' }] : [];
  return { command: 'analyze', outcome: 'analyzed', plan: identity, diagnostics, classification: overall.result, analysis: path.join(where.analysis, 'analysis.json') };
}
