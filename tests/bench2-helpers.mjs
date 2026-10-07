import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixtures, git, bench, area } from './bench-helpers.mjs';

/** Shared helpers for TASK-0015 (Phase 8 preparation) tests: version 2 plans with a subject, a
 * separately pinned benchmark repository, and a Keystone tree holding the plan directory. All
 * material is synthetic; nothing here is application-specific.
 */
export const v2fixtures = path.join(fixtures, 'v2');

export const defaultAnalysis = (fields = {}) => ({
  kind: 'keystone-bench-analysis-spec', schema_version: 1,
  conditions: { reference: 'plain', treatment: 'guided' },
  task_groups: { headline: ['change-app'], control: [] },
  analysis: {
    primary: [
      { id: 'pass', measure: 'task_oracle_pass_rate', effect: 'difference', margin: 0.15 },
      { id: 'recurrence', measure: 'trap_recurrences', effect: 'relative-reduction', margin: 0.3 },
    ],
    guardrails: [
      { id: 'regression', measure: 'regression_oracle_pass_rate', statistic: 'mean', breach: { lower_by_more_than: 0.05 } },
      { id: 'tokens', measure: 'total_tokens', statistic: 'median', breach: { relative_increase_above: 1 } },
      { id: 'time', measure: 'session_seconds', statistic: 'median', breach: { relative_increase_above: 0.5 } },
    ],
    completeness: { primary: 'ceil-half-R', guardrails: 'ceil-half-R' },
    classification_order: ['mixed', 'unclassifiable', 'positive', 'negative', 'neutral'],
    precision: 'normal',
    permutation: { iterations: 200, seed: 11 },
    bootstrap: { iterations: 200, seed: 12, level: 0.95 },
  },
  ...fields,
});

const json = value => JSON.stringify(value, null, 2) + '\n';

/** A subject, a benchmark repository and a Keystone tree (all Git repositories), plus a locations file. */
export async function area2(t) {
  const a = await area(t);
  const benchRepo = path.join(a.base, 'bench repo');
  await cp(path.join(fixtures, 'tasks', 'change-app'), path.join(benchRepo, 'tasks', 'change-app'), { recursive: true });
  for (const id of ['plain', 'guided']) await cp(path.join(fixtures, 'conditions', id), path.join(benchRepo, 'conditions', id), { recursive: true });
  await cp(path.join(v2fixtures, 'judging'), path.join(benchRepo, 'judging'), { recursive: true });
  // A condition whose instructions make the fake agent report another trusted model (item 1).
  await mkdir(path.join(benchRepo, 'conditions', 'other-model'), { recursive: true });
  await writeFile(path.join(benchRepo, 'conditions', 'other-model', 'instructions.md'), 'FAKE * identity fake-agent fake-model-other\n');
  await writeFile(path.join(benchRepo, 'conditions', 'other-model', 'condition.json'), json({ kind: 'keystone-bench-condition', schema_version: 1, id: 'other-model', instructions: 'instructions.md', setup: { files: [], commands: [] }, tools: [] }));
  // Exposure fixtures (item 10): a profile stored in the benchmark repository, a manual profile,
  // and a condition that stages the task statement.
  const benchProfile = path.join(benchRepo, 'profiles', 'fake');
  await cp(path.join(v2fixtures, 'profiles', 'fake'), benchProfile, { recursive: true });
  await cp(path.join(fixtures, 'profiles', 'fake', 'fake-agent.mjs'), path.join(benchProfile, 'fake-agent.mjs'));
  await mkdir(path.join(benchRepo, 'profiles', 'manual'), { recursive: true });
  await writeFile(path.join(benchRepo, 'profiles', 'manual', 'profile.json'), json({ kind: 'keystone-bench-agent-profile', schema_version: 2, id: 'manual-v2', mode: 'manual', declared: { tool: 'person', tool_version: 'person 1', model: 'none' }, trusted: { tools: ['person'], models: [], tool_versions: ['person 1'] } }));
  await mkdir(path.join(benchRepo, 'conditions', 'leaky', 'seed'), { recursive: true });
  await cp(path.join(fixtures, 'tasks', 'change-app', 'statement.md'), path.join(benchRepo, 'conditions', 'leaky', 'seed', 'TASK.md'));
  await writeFile(path.join(benchRepo, 'conditions', 'leaky', 'condition.json'), json({ kind: 'keystone-bench-condition', schema_version: 1, id: 'leaky', instructions: null, setup: { files: [{ from: 'seed/TASK.md', to: 'TASK.md' }], commands: [] }, tools: [] }));
  // Short hidden material (finding 4): a task file under 24 characters, and a condition staging it.
  await writeFile(path.join(benchRepo, 'tasks', 'change-app', 'hint.txt'), 'trap: debug\n');
  await mkdir(path.join(benchRepo, 'conditions', 'short-leak', 'seed'), { recursive: true });
  await writeFile(path.join(benchRepo, 'conditions', 'short-leak', 'seed', 'TIP.md'), '# Tip\nRemember the trap: debug of last time.\n');
  await writeFile(path.join(benchRepo, 'conditions', 'short-leak', 'condition.json'), json({ kind: 'keystone-bench-condition', schema_version: 1, id: 'short-leak', instructions: null, setup: { files: [{ from: 'seed/TIP.md', to: 'TIP.md' }], commands: [] }, tools: [] }));
  git(benchRepo, 'init', '--quiet');
  git(benchRepo, 'add', '-A');
  git(benchRepo, 'commit', '--quiet', '-m', 'benchmark fixture');
  // The Keystone tree: a Git repository holding the version 2 profile bundle used by most plans, and
  // the guided condition. Its declared tool expands {condition} into a shim on the session PATH, so
  // it must not live in the benchmark repository (exposure check E1).
  await cp(path.join(fixtures, 'conditions', 'guided'), path.join(a.root, 'fixtures', 'conditions', 'guided'), { recursive: true });
  const profile = path.join(a.root, 'fixtures', 'profiles', 'fake');
  await cp(path.join(v2fixtures, 'profiles', 'fake'), profile, { recursive: true });
  await cp(path.join(fixtures, 'profiles', 'fake', 'fake-agent.mjs'), path.join(profile, 'fake-agent.mjs'));
  // A synthetic Codex-like agent that reports incomplete usage (finding 9).
  const codex = path.join(a.root, 'fixtures', 'profiles', 'codex-partial');
  await mkdir(codex, { recursive: true });
  await cp(path.join(v2fixtures, 'profiles', 'fake', 'version.mjs'), path.join(codex, 'version.mjs'));
  await writeFile(path.join(codex, 'agent.mjs'), "console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10 } }));\n");
  await writeFile(path.join(codex, 'profile.json'), json({ kind: 'keystone-bench-agent-profile', schema_version: 2, id: 'codex-partial', mode: 'command',
    declared: { tool: 'codex', tool_version: 'fake-agent 1.0.0', model: 'synthetic' }, command: ['{node}', '{profile}/agent.mjs'], stdin: 'prompt', usage: 'codex-jsonl',
    trusted: { tools: [], models: [], tool_versions: ['fake-agent 1.0.0'] }, version: { command: ['{node}', '{profile}/version.mjs'] } }));
  git(a.root, 'init', '--quiet');
  commitRoot({ root: a.root });
  const repos = path.join(a.base, 'locations.json');
  await writeFile(repos, json({ kind: 'keystone-bench-locations', schema_version: 1, repositories: { 'fixture-app': a.subject, 'fixture-bench': benchRepo } }));
  return { ...a, benchRepo, benchCommit: git(benchRepo, 'rev-parse', 'HEAD'), repos };
}

export function commitRoot(a, message = 'keystone tree') {
  git(a.root, 'add', '-A');
  git(a.root, 'commit', '--quiet', '--allow-empty', '-m', message);
}

/** Writes benchmark/plans/<id>/ with plan.json, analysis.json and preregistration.md. */
export async function writePlan2(a, id, fields = {}, { analysis = defaultAnalysis(), terms } = {}) {
  const directory = path.join(a.root, 'benchmark', 'plans', id);
  await mkdir(directory, { recursive: true });
  const plan = {
    kind: 'keystone-bench-plan', schema_version: 2, id, purpose: 'experiment', stage: 'main',
    repositories: { subject: { id: 'fixture-app', commit: a.commit }, benchmark: { id: 'fixture-bench', commit: a.benchCommit } },
    tasks: [{ repository: 'benchmark', path: 'tasks/change-app' }],
    conditions: [{ repository: 'benchmark', path: 'conditions/plain' }, { repository: 'keystone', path: 'fixtures/conditions/guided' }],
    profiles: [{ repository: 'keystone', path: 'fixtures/profiles/fake' }],
    analysis: 'analysis.json', preregistration: 'preregistration.md',
    repetitions: 2, seed: 7,
    limits: { session_timeout_seconds: 60, setup_timeout_seconds: 120, oracle_timeout_seconds: 60, max_infrastructure_reruns: 2 },
    telemetry: { enabled: false },
    ...fields,
  };
  await writeFile(path.join(directory, 'plan.json'), json(plan));
  if (analysis) await writeFile(path.join(directory, 'analysis.json'), json(analysis));
  await writeFile(path.join(directory, 'preregistration.md'), `# Pre-registration — ${id}\n\nSynthetic test pre-registration.\n`);
  if (terms) await writeFile(path.join(directory, 'terms.json'), json(terms));
  return path.join(directory, 'plan.json');
}

export const opts = a => ['--root', a.root, '--work', a.work, '--repos', a.repos];

/** Verifies exposure, commits the plan directory and freezes the plan. */
export async function freezePlan(a, plan, work = a.work) {
  const verified = bench(['verify-exposure', plan, '--root', a.root, '--work', work, '--repos', a.repos]);
  assert.equal(verified.result.outcome, 'verified', JSON.stringify(verified.result));
  commitRoot(a, `plan ${path.basename(path.dirname(plan))}`);
  const frozen = bench(['freeze', plan, '--root', a.root, '--work', work, '--repos', a.repos]);
  assert.equal(frozen.result.outcome, 'frozen', JSON.stringify(frozen.result));
  return frozen.result;
}

export const defaultCalibration = (fields = {}) => ({
  measure: 'task_oracle_pass_rate', recurrence_measure: 'trap_recurrences', floor: 0.1, ceiling: 0.9, se_target: 0.075,
  repetitions: { min: 5, max: 10 }, infrastructure_threshold: 0.1, target_tasks: ['change-app'],
  unpiloted_sigma: 'max-observed-same-profile', resources: { tokens: 'total_tokens', seconds: 'session_seconds', control_tasks: [] },
  ...fields,
});

/** A frozen, run and calibrated pilot, once per area: every main plan is calibrated from one (P6, P12). */
export async function calibratedPilot(a) {
  if (a.pilot) return a.pilot;
  const work = path.join(a.base, 'pilot work');
  const plan = await writePlan2(a, 'pilot-base', { stage: 'pilot', repetitions: 1 }, { analysis: defaultAnalysis({ calibration: defaultCalibration() }) });
  await freezePlan(a, plan, work);
  const args = ['--root', a.root, '--work', work, '--repos', a.repos];
  assert.equal(bench(['prepare', plan, ...args]).result.outcome, 'prepared');
  assert.equal(bench(['run', plan, ...args]).result.outcome, 'completed');
  const calibrated = bench(['calibrate', plan, ...args]);
  assert.equal(calibrated.result.outcome, 'calibrated', JSON.stringify(calibrated.result));
  a.pilot = { id: 'pilot-base', hash: calibrated.result.plan.hash };
  return a.pilot;
}

/** A frozen, prepared and run version 2 experiment plan; a main plan is calibrated from a pilot. */
export async function ran2(a, id, fields = {}, options = {}) {
  if (fields.stage !== 'pilot' && !fields.calibrated_from) fields = { ...fields, calibrated_from: await calibratedPilot(a) };
  const plan = await writePlan2(a, id, fields, options);
  await freezePlan(a, plan);
  const prepared = bench(['prepare', plan, ...opts(a)]);
  assert.equal(prepared.result.outcome, 'prepared', JSON.stringify(prepared.result));
  const ran = bench(['run', plan, ...opts(a)]);
  assert.equal(ran.result.outcome, 'completed', JSON.stringify(ran.result));
  return { plan, prepared: prepared.result, ran: ran.result };
}

export async function readJsonFile(file) { return JSON.parse(await readFile(file, 'utf8')); }
export const results = (a, id, ...rest) => path.join(a.root, 'benchmark', 'results', id, ...rest);
export const analysisDir = (a, id, ...rest) => path.join(a.root, 'benchmark', 'analysis', id, ...rest);
