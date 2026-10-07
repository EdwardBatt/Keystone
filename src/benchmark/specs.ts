import { readFileSync } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { compare, serialize, type Diagnostic } from '../core.js';
import { relativePath } from '../paths.js';
import { isDirectory, pinDiagnostics, type PinnedRepository } from './repos.js';

/** Harness specification formats live with Keystone's generic benchmark specification. */
export const specificationDirectory = new URL('../../benchmark/specification/', import.meta.url);
const schemaNames = ['task', 'condition', 'agent-profile', 'plan', 'scorecard', 'judgements', 'manual-record', 'run-record',
  'locations', 'analysis-spec', 'inspection-terms', 'attempt-classification', 'packet-release'] as const;
/** Formats with a version 2 schema (TASK-0015). Version 1 stays valid with its Phase 7 semantics. */
const versioned = ['plan', 'agent-profile', 'run-record', 'judgements'] as const;
export type SchemaName = typeof schemaNames[number];
export const kinds: Record<string, SchemaName> = {
  'keystone-bench-task': 'task',
  'keystone-bench-condition': 'condition',
  'keystone-bench-agent-profile': 'agent-profile',
  'keystone-bench-plan': 'plan',
  'keystone-bench-scorecard': 'scorecard',
  'keystone-bench-judgements': 'judgements',
  'keystone-bench-manual-record': 'manual-record',
  'keystone-bench-run-record': 'run-record',
  'keystone-bench-locations': 'locations',
  'keystone-bench-analysis-spec': 'analysis-spec',
  'keystone-bench-inspection-terms': 'inspection-terms',
  'keystone-bench-attempt-classification': 'attempt-classification',
  'keystone-bench-packet-release': 'packet-release',
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
const load = (name: string) => JSON.parse(readFileSync(new URL(`schemas/${name}.schema.json`, specificationDirectory), 'utf8'));
ajv.addSchema(load('common'));
const validators = new Map<string, ValidateFunction>([
  ...schemaNames.map(name => [name, ajv.compile(load(name))] as const),
  ...versioned.map(name => [`${name}@2`, ajv.compile(load(`${name}-v2`))] as const),
]);

/** The schema version a document declares; version 2 selects the version 2 schema where one exists. */
export const versionOf = (data: unknown): 1 | 2 => (data as { schema_version?: unknown })?.schema_version === 2 ? 2 : 1;

export function schemaDiagnostics(name: SchemaName, data: unknown, file: string, code = 'BENCH_SPEC_INVALID'): Diagnostic[] {
  const validate = (versionOf(data) === 2 && validators.get(`${name}@2`)) || validators.get(name)!;
  if (validate(data)) return [];
  return (validate.errors ?? []).map(error => ({
    code, path: file, field: error.instancePath || '/',
    message: `${error.keyword}: ${error.message ?? 'invalid value'}${error.keyword === 'required' ? ` (${String(error.params.missingProperty)})` : ''}`,
  }));
}

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const hashValue = (value: unknown) => sha256(serialize(value));

/** A filename-keyed table with no prototype, so every valid filename (including `__proto__` or
 * `constructor`) is an ordinary own key. Serialization is unchanged: keys are sorted and every own
 * key is kept, so hashes of ordinary names are identical to a plain object's.
 */
export const fileTable = (): Record<string, string> => Object.create(null) as Record<string, string>;

export interface Usage { input_tokens?: number | null; output_tokens?: number | null; turns?: number | null; tool_calls?: number | null; tool?: string | null; model?: string | null; unrecognized_identity?: true; model_mismatch?: true }
export interface TaskSpec {
  kind: 'keystone-bench-task'; schema_version: 1; id: string; description?: string; statement: string;
  sessions: { id: string; prompt: string }[]; fix?: { prompt: string; max: number };
  oracles: { id: string; role: 'task' | 'regression' | 'trap'; description?: string; command: string[] }[];
}
export interface ConditionSpec {
  kind: 'keystone-bench-condition'; schema_version: 1; id: string; description?: string; instructions: string | null;
  setup: { files: { from: string; to: string }[]; commands: { id: string; command: string[] }[] };
  tools: { name: string; command: string[] }[];
}
export interface ProfileSpec {
  kind: 'keystone-bench-agent-profile'; schema_version: 1 | 2; id: string; description?: string; mode: 'command' | 'manual';
  /** Version 2 declares the pinned tool version, which must also be trusted (TASK-0015 item 1). */
  declared: { tool: string; model: string; tool_version?: string }; command?: string[]; stdin?: 'none' | 'prompt';
  usage?: 'none' | 'keystone-bench-json' | 'claude-code-json' | 'codex-jsonl'; env?: { pass?: string[] };
  /** Identifiers a reported tool or model must match exactly to be persisted (review round 2, B8). */
  trusted?: { tools?: string[]; models?: string[]; tool_versions?: string[] };
  /** Version 2: the command `run` launches before each run's setup to observe the tool version. */
  version?: { command: string[] };
}
/** The repository name a version 2 bundle reference uses for this Keystone checkout (`--root`). It
 * names a repository, never a condition: no condition is special-cased in harness code.
 */
export const keystoneRepository = 'keystone' as const;
export type RepositoryName = 'subject' | 'benchmark' | typeof keystoneRepository;
export interface BundleRef { repository: RepositoryName; path: string }
export interface Judge { id: string; role: 'vendor' | 'audit'; kind: 'model' | 'owner'; model?: string; version?: string }
export interface PlanSpec {
  kind: 'keystone-bench-plan'; schema_version: 1 | 2; id: string; description?: string; purpose: 'experiment' | 'smoke';
  /** Version 1 only: the subject by local path. */
  subject?: { id: string; repository: string; commit: string };
  /** Version 2 only: repositories by ID and pinned commit; paths come from the locations file. */
  repositories?: { subject: { id: string; commit: string }; benchmark?: { id: string; commit: string } };
  stage?: 'pilot' | 'main'; analysis?: string; preregistration?: string; calibrated_from?: { id: string; hash: string };
  tasks: (string | BundleRef)[]; conditions: (string | BundleRef)[]; profiles: (string | BundleRef)[]; repetitions: number; seed: number;
  limits: { session_timeout_seconds: number; setup_timeout_seconds: number; oracle_timeout_seconds: number; max_infrastructure_reruns?: number };
  telemetry: { enabled: boolean; wrap?: string[] };
  judging?: {
    procedure: string; exclude?: string[];
    judges?: Judge[]; audit?: { judge: string; fraction: number; seed: number; stratify: 'task' };
    rubric?: BundleRef; prompt?: BundleRef; inspection?: { terms?: string[]; replacement: string };
  };
  composite?: { weights: Record<string, number> };
}
export type Completeness = 'ceil-half-R' | 'all-planned';
export type Classification = 'mixed' | 'unclassifiable' | 'positive' | 'negative' | 'neutral';
export interface AnalysisSpec {
  kind: 'keystone-bench-analysis-spec'; schema_version: 1;
  conditions: { reference: string; treatment: string };
  task_groups: { headline: string[]; control: string[] };
  calibration?: {
    measure: string; recurrence_measure: string; floor: number; ceiling: number; se_target: number;
    repetitions: { min: number; max: number }; infrastructure_threshold: number; target_tasks: string[];
    unpiloted_sigma: 'max-observed-same-profile'; resources: { tokens: string; seconds: string; control_tasks: string[] };
  };
  analysis?: {
    primary: { id: string; measure: string; effect: 'difference' | 'relative-reduction'; margin: number }[];
    guardrails: { id: string; measure: string; statistic: 'mean' | 'median'; breach: { lower_by_more_than?: number; relative_increase_above?: number } }[];
    completeness: { primary: Completeness; guardrails: Completeness };
    classification_order: Classification[];
    precision: 'normal' | 'lower';
    permutation: { iterations: number; seed: number };
    bootstrap: { iterations: number; seed: number; level: number };
  };
}
export interface InspectionTerms { kind: 'keystone-bench-inspection-terms'; schema_version: 1; id: string; terms: { id: string; literal?: string; pattern?: string }[] }

/** A loaded specification together with its bundle: the directory holding the specification file. */
export interface Bundle<T> { spec: T; file: string; directory: string; hash: string }

/** Placeholders each command context may use. Anything else in braces is rejected. */
export const placeholders = {
  oracle: ['node', 'workspace', 'task'],
  setup: ['node', 'workspace', 'condition'],
  tool: ['node', 'workspace', 'condition'],
  agent: ['node', 'workspace', 'profile', 'prompt_file', 'usage_file', 'session'],
  version: ['node', 'profile'],
} as const;

export function placeholderDiagnostics(argv: string[], allowed: readonly string[], file: string, field: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const arg of argv) {
    for (const match of arg.matchAll(/\{([^{}]*)\}/g)) {
      if (!allowed.includes(match[1])) diagnostics.push({ code: 'BENCH_PLACEHOLDER_INVALID', path: file, field, message: `Placeholder {${match[1]}} is not available here; allowed: ${allowed.map(p => `{${p}}`).join(', ')}.` });
    }
  }
  return diagnostics;
}

export function expand(argv: string[], values: Record<string, string>): string[] {
  return argv.map(arg => arg.replace(/\{([^{}]*)\}/g, (whole, name: string) => values[name] ?? whole));
}

/** Content hash of every file under a bundle directory, by portable relative path. */
export async function directoryHash(directory: string): Promise<string> {
  const files = fileTable();
  async function walk(relative: string): Promise<void> {
    const absolute = relative ? path.join(directory, ...relative.split('/')) : directory;
    for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((a, b) => compare(a.name, b.name))) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw Object.assign(new Error('symlink'), { code: 'BENCH_SYMLINK', file: child });
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files[child] = sha256(await readFile(path.join(absolute, entry.name)));
    }
  }
  await walk('');
  return hashValue(files);
}

export async function readJson(file: string, label: string): Promise<{ data?: unknown; diagnostics: Diagnostic[] }> {
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch {
    return { diagnostics: [{ code: 'BENCH_SPEC_UNREADABLE', path: label, message: 'Specification file cannot be read.' }] };
  }
  try { return { data: JSON.parse(text.replace(/^﻿/, '')), diagnostics: [] }; } catch {
    return { diagnostics: [{ code: 'BENCH_SPEC_INVALID', path: label, message: 'Specification file is not valid JSON.' }] };
  }
}

/** A file named by a specification, inside its own bundle (no parent traversal). */
async function bundleFile(directory: string, reference: string, label: string, field: string): Promise<Diagnostic[]> {
  let relative: string;
  try { relative = relativePath(reference); } catch {
    return [{ code: 'BENCH_REFERENCE_INVALID', path: label, field, message: `${reference} must be a portable path inside the specification's directory.` }];
  }
  try {
    const stat = await lstat(path.join(directory, ...relative.split('/')));
    if (stat.isFile()) return [];
  } catch { /* Reported below. */ }
  return [{ code: 'BENCH_REFERENCE_MISSING', path: label, field, message: `${reference} is not a file in the specification's directory.` }];
}

/** Semantic checks beyond the schema for one specification of a known kind. */
export async function specDiagnostics(name: SchemaName, data: unknown, file: string, label: string): Promise<Diagnostic[]> {
  const schema = schemaDiagnostics(name, data, label);
  if (schema.length) return schema;
  const directory = path.dirname(file);
  const diagnostics: Diagnostic[] = [];
  const unique = (ids: string[], field: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) diagnostics.push({ code: 'BENCH_ID_DUPLICATE', path: label, field, message: `${id} is declared more than once.` });
      seen.add(id);
    }
  };
  if (name === 'task') {
    const task = data as TaskSpec;
    diagnostics.push(...await bundleFile(directory, task.statement, label, '/statement'));
    for (const [i, session] of task.sessions.entries()) diagnostics.push(...await bundleFile(directory, session.prompt, label, `/sessions/${i}/prompt`));
    if (task.fix) diagnostics.push(...await bundleFile(directory, task.fix.prompt, label, '/fix/prompt'));
    unique(task.sessions.map(s => s.id), '/sessions');
    unique(task.oracles.map(o => o.id), '/oracles');
    if (!task.oracles.some(o => o.role === 'task')) diagnostics.push({ code: 'BENCH_SPEC_INVALID', path: label, field: '/oracles', message: 'A task needs at least one task oracle.' });
    for (const [i, oracle] of task.oracles.entries()) diagnostics.push(...placeholderDiagnostics(oracle.command, placeholders.oracle, label, `/oracles/${i}/command`));
  } else if (name === 'condition') {
    const condition = data as ConditionSpec;
    if (condition.instructions !== null) diagnostics.push(...await bundleFile(directory, condition.instructions, label, '/instructions'));
    for (const [i, entry] of condition.setup.files.entries()) {
      diagnostics.push(...await bundleFile(directory, entry.from, label, `/setup/files/${i}/from`));
      try { relativePath(entry.to); } catch {
        diagnostics.push({ code: 'BENCH_REFERENCE_INVALID', path: label, field: `/setup/files/${i}/to`, message: `${entry.to} must be a portable workspace path outside .git.` });
      }
    }
    unique(condition.setup.commands.map(c => c.id), '/setup/commands');
    unique(condition.tools.map(t => t.name.toLowerCase()), '/tools');
    for (const [i, command] of condition.setup.commands.entries()) diagnostics.push(...placeholderDiagnostics(command.command, placeholders.setup, label, `/setup/commands/${i}/command`));
    for (const [i, tool] of condition.tools.entries()) diagnostics.push(...placeholderDiagnostics(tool.command, placeholders.tool, label, `/tools/${i}/command`));
  } else if (name === 'agent-profile') {
    const profile = data as ProfileSpec;
    if (profile.command) diagnostics.push(...placeholderDiagnostics(profile.command, placeholders.agent, label, '/command'));
    // The longest reportable model value is every trusted model, comma-joined; it must fit the
    // durable model field (256 characters), so no trusted report yields an invalid record.
    const models = profile.trusted?.models ?? [];
    if (models.join(',').length > 256) {
      diagnostics.push({ code: 'BENCH_TRUSTED_IDENTITY_INVALID', path: label, field: '/trusted/models', message: `Trusted models serialize to ${models.join(',').length} characters; the durable model field holds at most 256.` });
    }
    if (profile.schema_version === 2) {
      if (!(profile.trusted?.tool_versions ?? []).includes(profile.declared.tool_version!)) {
        diagnostics.push({ code: 'BENCH_TRUSTED_IDENTITY_INVALID', path: label, field: '/declared/tool_version', message: 'The declared tool version must be one of the trusted tool versions.' });
      }
      if (profile.version) diagnostics.push(...placeholderDiagnostics(profile.version.command, placeholders.version, label, '/version/command'));
    }
  } else if (name === 'scorecard') {
    unique((data as { measures: { name: string }[] }).measures.map(m => m.name), '/measures');
  } else if (name === 'inspection-terms') {
    const terms = data as InspectionTerms;
    unique(terms.terms.map(t => t.id), '/terms');
    for (const [i, term] of terms.terms.entries()) {
      if ((term.literal === undefined) === (term.pattern === undefined)) {
        diagnostics.push({ code: 'BENCH_SPEC_INVALID', path: label, field: `/terms/${i}`, message: 'A term has exactly one of literal or pattern.' });
        continue;
      }
      if (term.pattern === undefined) continue;
      try { new RegExp(term.pattern, 'gi'); } catch {
        diagnostics.push({ code: 'BENCH_SPEC_INVALID', path: label, field: `/terms/${i}/pattern`, message: 'The pattern is not a valid regular expression.' });
      }
    }
  } else if (name === 'analysis-spec') {
    const spec = data as AnalysisSpec;
    if (spec.conditions.reference === spec.conditions.treatment) diagnostics.push({ code: 'BENCH_SPEC_INVALID', path: label, field: '/conditions', message: 'The reference and treatment conditions must differ.' });
    if (spec.task_groups.headline.some(t => spec.task_groups.control.includes(t))) diagnostics.push({ code: 'BENCH_SPEC_INVALID', path: label, field: '/task_groups', message: 'A task belongs to one group only.' });
    const c = spec.calibration;
    if (c && (c.repetitions.min > c.repetitions.max || c.floor >= c.ceiling)) diagnostics.push({ code: 'BENCH_SPEC_INVALID', path: label, field: '/calibration', message: 'Calibration needs repetitions.min ≤ repetitions.max and floor < ceiling.' });
    if (spec.analysis) {
      unique(spec.analysis.primary.map(p => p.id), '/analysis/primary');
      unique(spec.analysis.guardrails.map(g => g.id), '/analysis/guardrails');
    }
  }
  return diagnostics;
}

/** A pinned repository of a version 2 plan, resolved to this machine's path. */
export interface ResolvedRepository { id: string; commit: string | null; path: string }
export interface PlanFile { file: string; relative: string; hash: string }

export interface LoadedPlan {
  spec: PlanSpec; file: string; directory: string;
  /** Immutable plan provenance: plan bytes and every referenced bundle (ADR-0004 guarantee 8). */
  hash: string; planFileHash: string;
  tasks: Bundle<TaskSpec>[]; conditions: Bundle<ConditionSpec>[]; profiles: Bundle<ProfileSpec>[];
  subjectPath: string;
  version: 1 | 2;
  /** The subject's identity and pinned commit, for either plan version. */
  subject: { id: string; commit: string };
  /** Version 2: the separately pinned benchmark repository, when the plan declares one. */
  benchmark: ResolvedRepository | null;
  /** Version 2: plan-directory files (analysis specification, pre-registration, inspection terms). */
  planFiles: Record<string, PlanFile>;
  /** Version 2: the hash of every plan-directory file except the generated freeze record. */
  planDirectoryFiles: Record<string, string>;
  analysis: AnalysisSpec | null;
  terms: InspectionTerms[];
  /** Version 2 judging: the pinned rubric and judge-prompt bundles. */
  judging: { rubric: Bundle<null> & { commit: string }; prompt: Bundle<null> } | null;
}

async function loadBundle<T>(file: string, label: string, name: SchemaName, field: string, diagnostics: Diagnostic[]): Promise<Bundle<T> | undefined> {
  const { data, diagnostics: read } = await readJson(file, label);
  if (read.length) { diagnostics.push(...read.map(d => ({ ...d, code: d.code === 'BENCH_SPEC_UNREADABLE' ? 'BENCH_REFERENCE_MISSING' : d.code, field }))); return undefined; }
  const expected = Object.entries(kinds).find(([, schema]) => schema === name)![0];
  if ((data as { kind?: unknown })?.kind !== expected) {
    diagnostics.push({ code: 'BENCH_SPEC_KIND_MISMATCH', path: label, field, message: `Expected a ${expected} specification.` });
    return undefined;
  }
  const own = await specDiagnostics(name, data, file, label);
  if (own.length) { diagnostics.push(...own); return undefined; }
  try {
    return { spec: data as T, file, directory: path.dirname(file), hash: await directoryHash(path.dirname(file)) };
  } catch {
    diagnostics.push({ code: 'BENCH_REFERENCE_INVALID', path: label, field, message: 'Specification bundle cannot be hashed (unreadable entry or symbolic link).' });
    return undefined;
  }
}

export interface LoadOptions { repos?: string; root?: string }
export interface LoadResult { plan?: LoadedPlan; diagnostics: Diagnostic[]; unresolved?: { id: string } }

/** Loads and validates a plan with every referenced specification. Read-only. A version 2 plan whose
 * repositories are not available on this machine is structurally checked and reported unresolved.
 */
export async function loadPlan(planFile: string, weightable?: (measure: string, plan: PlanSpec) => boolean, options: LoadOptions = {}): Promise<LoadResult> {
  const file = path.resolve(planFile);
  const label = path.basename(file);
  let bytes: Buffer;
  try { bytes = await readFile(file); } catch {
    return { diagnostics: [{ code: 'BENCH_SPEC_UNREADABLE', path: label, message: 'Plan file cannot be read.' }] };
  }
  let data: unknown;
  try { data = JSON.parse(bytes.toString('utf8').replace(/^﻿/, '')); } catch {
    return { diagnostics: [{ code: 'BENCH_SPEC_INVALID', path: label, message: 'Plan file is not valid JSON.' }] };
  }
  if ((data as { kind?: unknown })?.kind !== 'keystone-bench-plan') return { diagnostics: [{ code: 'BENCH_SPEC_KIND_MISMATCH', path: label, message: 'Expected a keystone-bench-plan specification.' }] };
  const schema = schemaDiagnostics('plan', data, label);
  if (schema.length) return { diagnostics: schema };
  const spec = data as PlanSpec;
  if (spec.schema_version === 2) return loadPlan2(file, bytes, spec, weightable, options);
  const diagnostics: Diagnostic[] = [];
  const tasks: Bundle<TaskSpec>[] = [];
  const conditions: Bundle<ConditionSpec>[] = [];
  const profiles: Bundle<ProfileSpec>[] = [];
  const v1 = (reference: string) => path.resolve(path.dirname(file), reference);
  for (const [i, reference] of (spec.tasks as string[]).entries()) { const b = await loadBundle<TaskSpec>(v1(reference), reference, 'task', `/tasks/${i}`, diagnostics); if (b) tasks.push(b); }
  for (const [i, reference] of (spec.conditions as string[]).entries()) { const b = await loadBundle<ConditionSpec>(v1(reference), reference, 'condition', `/conditions/${i}`, diagnostics); if (b) conditions.push(b); }
  for (const [i, reference] of (spec.profiles as string[]).entries()) { const b = await loadBundle<ProfileSpec>(v1(reference), reference, 'agent-profile', `/profiles/${i}`, diagnostics); if (b) profiles.push(b); }
  diagnostics.push(...commonPlanDiagnostics(spec, label, tasks, conditions, profiles, weightable));
  for (const profile of profiles) {
    if (profile.spec.schema_version === 2) diagnostics.push({ code: 'BENCH_SPEC_INVALID', path: label, field: '/profiles', message: `${profile.spec.id} is a version 2 profile; version 1 plans use version 1 profiles.` });
  }
  if (diagnostics.length) return { diagnostics };
  const planFileHash = sha256(bytes);
  const hash = hashValue({
    plan: planFileHash,
    tasks: Object.fromEntries(tasks.map(b => [b.spec.id, b.hash])),
    conditions: Object.fromEntries(conditions.map(b => [b.spec.id, b.hash])),
    profiles: Object.fromEntries(profiles.map(b => [b.spec.id, b.hash])),
  });
  const subject = spec.subject!;
  return {
    plan: {
      spec, file, directory: path.dirname(file), hash, planFileHash, tasks, conditions, profiles,
      subjectPath: path.resolve(path.dirname(file), subject.repository), version: 1, subject: { id: subject.id, commit: subject.commit },
      benchmark: null, planFiles: {}, planDirectoryFiles: {}, analysis: null, terms: [], judging: null,
    },
    diagnostics: [],
  };
}

/** Checks shared by both plan versions: unique IDs, one bundle per specification, portable judging
 * exclusions and weightable composite measures.
 */
function commonPlanDiagnostics(spec: PlanSpec, label: string, tasks: Bundle<TaskSpec>[], conditions: Bundle<ConditionSpec>[], profiles: Bundle<ProfileSpec>[], weightable?: (measure: string, plan: PlanSpec) => boolean): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [group, list] of [['tasks', tasks], ['conditions', conditions], ['profiles', profiles]] as const) {
    const seen = new Set<string>();
    for (const bundle of list) {
      if (seen.has(bundle.spec.id)) diagnostics.push({ code: 'BENCH_ID_DUPLICATE', path: label, field: `/${group}`, message: `${bundle.spec.id} is referenced more than once.` });
      seen.add(bundle.spec.id);
    }
    const directories = new Set<string>();
    for (const bundle of list) {
      if (directories.has(bundle.directory)) diagnostics.push({ code: 'BENCH_REFERENCE_INVALID', path: label, field: `/${group}`, message: 'Each specification needs its own directory (its bundle).' });
      directories.add(bundle.directory);
    }
  }
  for (const pathspec of spec.judging?.exclude ?? []) {
    try { relativePath(pathspec); } catch { diagnostics.push({ code: 'BENCH_REFERENCE_INVALID', path: label, field: '/judging/exclude', message: `${pathspec} must be a portable workspace path.` }); }
  }
  if (spec.composite && weightable) {
    for (const measure of Object.keys(spec.composite.weights).sort(compare)) {
      if (!weightable(measure, spec)) diagnostics.push({ code: 'BENCH_PLAN_WEIGHT_INVALID', path: label, field: '/composite/weights', message: `${measure} is not a numeric primary measure; condition-specific diagnostics and judged verdicts cannot be weighted.` });
    }
  }
  return diagnostics;
}

const bundleFiles = { task: 'task.json', condition: 'condition.json', 'agent-profile': 'profile.json' } as const;

/** Structural checks of a version 2 plan that need no repository: location, references, judging
 * declarations and plan-directory files (TASK-0015 items 4 and 5).
 */
async function structure2(file: string, spec: PlanSpec, label: string): Promise<{ diagnostics: Diagnostic[]; planFiles: Record<string, PlanFile>; analysis: AnalysisSpec | null; terms: InspectionTerms[]; directoryFiles: Record<string, string> }> {
  const diagnostics: Diagnostic[] = [];
  const directory = path.dirname(file);
  const err = (code: string, field: string, message: string) => diagnostics.push({ code, path: label, field, message });
  if (path.basename(file) !== 'plan.json' || path.basename(directory) !== spec.id) {
    err('BENCH_PLAN_LOCATION_INVALID', '/id', `A version 2 plan is <plan-id>/plan.json; expected the directory ${spec.id}.`);
  }
  const repos = spec.repositories!;
  if (repos.benchmark && repos.benchmark.id === repos.subject.id) err('BENCH_SPEC_INVALID', '/repositories', 'The subject and benchmark repositories need distinct IDs.');
  const refs: [string, BundleRef][] = [
    ...(['tasks', 'conditions', 'profiles'] as const).flatMap(group => (spec[group] as BundleRef[]).map((r, i) => [`/${group}/${i}`, r] as [string, BundleRef])),
    ...(spec.judging?.rubric ? [['/judging/rubric', spec.judging.rubric] as [string, BundleRef]] : []),
    ...(spec.judging?.prompt ? [['/judging/prompt', spec.judging.prompt] as [string, BundleRef]] : []),
  ];
  for (const [field, ref] of refs) {
    if (ref.repository === 'benchmark' && !repos.benchmark) err('BENCH_REFERENCE_INVALID', field, 'The plan declares no benchmark repository.');
    try { relativePath(ref.path); } catch { err('BENCH_REFERENCE_INVALID', field, `${ref.path} must be a portable path inside its repository.`); }
  }
  if (spec.calibrated_from && spec.stage !== 'main') err('BENCH_SPEC_INVALID', '/calibrated_from', 'Only a main-stage plan names the pilot it was calibrated from.');
  if (spec.stage && spec.purpose !== 'experiment') err('BENCH_SPEC_INVALID', '/stage', 'Only experiment plans have a stage.');
  const judging = spec.judging;
  if (judging) {
    const ids = new Set<string>();
    for (const [i, judge] of (judging.judges ?? []).entries()) {
      if (ids.has(judge.id)) err('BENCH_ID_DUPLICATE', `/judging/judges/${i}`, `${judge.id} is declared more than once.`);
      ids.add(judge.id);
      if (judge.kind === 'model' && (!judge.model || !judge.version)) err('BENCH_SPEC_INVALID', `/judging/judges/${i}`, 'A model judge declares its model and version.');
      if (judge.kind === 'owner' && (judge.model || judge.version)) err('BENCH_SPEC_INVALID', `/judging/judges/${i}`, 'The owner judge has no model.');
    }
    if (!(judging.judges ?? []).some(j => j.role === 'vendor')) err('BENCH_SPEC_INVALID', '/judging/judges', 'At least one vendor judge is required.');
    if (judging.audit) {
      const auditor = judging.judges?.find(j => j.id === judging.audit!.judge);
      if (!auditor || auditor.role !== 'audit') err('BENCH_SPEC_INVALID', '/judging/audit/judge', 'The audit judge must be a declared judge with the audit role.');
    }
    if ((judging.judges ?? []).some(j => j.role === 'audit') && !judging.audit) err('BENCH_SPEC_INVALID', '/judging/audit', 'An audit judge needs an audit sample declaration.');
    if (judging.rubric?.repository === keystoneRepository) err('BENCH_REFERENCE_INVALID', '/judging/rubric', 'The rubric must come from a pinned repository (subject or benchmark).');
  }
  // Plan-directory files are part of the frozen plan: read, validated and hashed here.
  const planFiles: Record<string, PlanFile> = {};
  let analysis: AnalysisSpec | null = null;
  const terms: InspectionTerms[] = [];
  const named: [string, string, string][] = [
    ...(spec.analysis ? [['analysis', spec.analysis, '/analysis'] as [string, string, string]] : []),
    ...(spec.preregistration ? [['preregistration', spec.preregistration, '/preregistration'] as [string, string, string]] : []),
    ...(judging?.inspection?.terms ?? []).map((t, i) => [`terms:${t}`, t, `/judging/inspection/terms/${i}`] as [string, string, string]),
  ];
  for (const [key, reference, field] of named) {
    const missing = await bundleFile(directory, reference, label, field);
    if (missing.length) { diagnostics.push(...missing); continue; }
    const absolute = path.join(directory, ...relativePath(reference).split('/'));
    const bytesOf = await readFile(absolute);
    planFiles[key] = { file: absolute, relative: relativePath(reference), hash: sha256(bytesOf) };
    if (key === 'preregistration') continue;
    const kind = key === 'analysis' ? 'analysis-spec' : 'inspection-terms';
    const { data, diagnostics: read } = await readJson(absolute, reference);
    if (read.length) { diagnostics.push(...read); continue; }
    if ((data as { kind?: unknown })?.kind !== `keystone-bench-${kind}`) { err('BENCH_SPEC_KIND_MISMATCH', field, `Expected a keystone-bench-${kind} specification.`); continue; }
    const own = await specDiagnostics(kind, data, absolute, reference);
    if (own.length) { diagnostics.push(...own); continue; }
    if (key === 'analysis') analysis = data as AnalysisSpec; else terms.push(data as InspectionTerms);
  }
  // Every file of the plan directory is frozen content (criterion 14), referenced or not. The only
  // exclusion is the generated top-level freeze record, which is sealed and verified wherever read.
  let directoryFiles = fileTable();
  try { directoryFiles = await planDirectoryHashes(directory); } catch (error) {
    err('BENCH_REFERENCE_INVALID', '/', `The plan directory cannot be hashed (${(error as { file?: string }).file ?? 'unreadable entry'} is a symbolic link or unreadable).`);
  }
  return { diagnostics, planFiles, analysis, terms, directoryFiles };
}

/** The name of the generated freeze record, the one plan-directory file outside the plan hash. */
export const freezeRecordName = 'freeze.json';

/** SHA-256 of every file under a plan directory, by portable relative path, excluding only the
 * top-level generated freeze record. Symbolic links are refused.
 */
export async function planDirectoryHashes(directory: string): Promise<Record<string, string>> {
  const files = fileTable();
  const walk = async (relative: string): Promise<void> => {
    const absolute = relative ? path.join(directory, ...relative.split('/')) : directory;
    for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((a, b) => compare(a.name, b.name))) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw Object.assign(new Error('symlink'), { file: child });
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) { if (child !== freezeRecordName) files[child] = sha256(await readFile(path.join(absolute, entry.name))); }
      else throw Object.assign(new Error('special'), { file: child });
    }
  };
  await walk('');
  return files;
}

/** Machine paths for a version 2 plan's repositories, from the locations file (never hashed). */
async function locate(spec: PlanSpec, label: string, options: LoadOptions): Promise<{ paths?: Record<RepositoryName, string>; diagnostics: Diagnostic[]; notices: Diagnostic[] }> {
  const repos = spec.repositories!;
  const root = path.resolve(options.root ?? process.cwd());
  let map: Record<string, string> = {};
  if (options.repos) {
    const locationsFile = path.resolve(options.repos);
    const { data, diagnostics } = await readJson(locationsFile, path.basename(locationsFile));
    if (diagnostics.length) return { diagnostics: diagnostics.map(d => ({ ...d, code: 'BENCH_LOCATIONS_INVALID' })), notices: [] };
    const schema = schemaDiagnostics('locations', data, path.basename(locationsFile), 'BENCH_LOCATIONS_INVALID');
    if (schema.length) return { diagnostics: schema, notices: [] };
    const { physical, within } = await import('./store.js');
    if (within(await physical(root), await physical(locationsFile))) {
      return { diagnostics: [{ code: 'BENCH_LOCATIONS_INVALID', path: path.basename(locationsFile), message: 'The locations file is machine-local and must lie outside the Keystone tree.' }], notices: [] };
    }
    map = Object.fromEntries(Object.entries((data as { repositories: Record<string, string> }).repositories).map(([id, p]) => [id, path.resolve(path.dirname(locationsFile), p)]));
  }
  const notices: Diagnostic[] = [];
  const paths = { keystone: root } as Record<RepositoryName, string>;
  for (const name of ['subject', 'benchmark'] as const) {
    const declared = repos[name];
    if (!declared) continue;
    const where = map[declared.id];
    if (!where || !(await isDirectory(where))) {
      notices.push({ code: 'BENCH_REPOSITORY_UNAVAILABLE', path: label, field: `/repositories/${name}`, message: `Repository ${declared.id} is not available on this machine${options.repos ? '' : ' (no --repos locations file)'}; the plan is checked structurally only.` });
      continue;
    }
    paths[name] = where;
  }
  return notices.length ? { diagnostics: [], notices } : { paths, diagnostics: [], notices };
}

async function loadPlan2(file: string, bytes: Buffer, spec: PlanSpec, weightable: ((measure: string, plan: PlanSpec) => boolean) | undefined, options: LoadOptions): Promise<LoadResult> {
  const label = path.basename(file);
  const structural = await structure2(file, spec, label);
  if (structural.diagnostics.length) return { diagnostics: structural.diagnostics };
  const located = await locate(spec, label, options);
  if (located.diagnostics.length) return { diagnostics: located.diagnostics };
  if (!located.paths) return { diagnostics: located.notices, unresolved: { id: spec.id } };
  const paths = located.paths;
  const repos = spec.repositories!;
  const refs = [...(spec.tasks as BundleRef[]), ...(spec.conditions as BundleRef[]), ...(spec.profiles as BundleRef[]),
    ...(spec.judging?.rubric ? [spec.judging.rubric] : []), ...(spec.judging?.prompt ? [spec.judging.prompt] : [])];
  const pinned: PinnedRepository[] = (['subject', 'benchmark'] as const).filter(name => repos[name]).map(name => ({
    name, id: repos[name]!.id, commit: repos[name]!.commit, path: paths[name],
    bundles: refs.filter(r => r.repository === name).map(r => relativePath(r.path)),
  }));
  const pins = await pinDiagnostics(pinned, label);
  if (pins.length) return { diagnostics: pins };
  const diagnostics: Diagnostic[] = [];
  const where = (ref: BundleRef) => path.join(paths[ref.repository], ...relativePath(ref.path).split('/'));
  const name = (ref: BundleRef) => `${ref.repository}:${relativePath(ref.path)}`;
  const tasks: Bundle<TaskSpec>[] = [];
  const conditions: Bundle<ConditionSpec>[] = [];
  const profiles: Bundle<ProfileSpec>[] = [];
  for (const [i, ref] of (spec.tasks as BundleRef[]).entries()) { const b = await loadBundle<TaskSpec>(path.join(where(ref), bundleFiles.task), name(ref), 'task', `/tasks/${i}`, diagnostics); if (b) tasks.push(b); }
  for (const [i, ref] of (spec.conditions as BundleRef[]).entries()) { const b = await loadBundle<ConditionSpec>(path.join(where(ref), bundleFiles.condition), name(ref), 'condition', `/conditions/${i}`, diagnostics); if (b) conditions.push(b); }
  for (const [i, ref] of (spec.profiles as BundleRef[]).entries()) { const b = await loadBundle<ProfileSpec>(path.join(where(ref), bundleFiles['agent-profile']), name(ref), 'agent-profile', `/profiles/${i}`, diagnostics); if (b) profiles.push(b); }
  for (const profile of profiles) {
    if (profile.spec.schema_version !== 2) diagnostics.push({ code: 'BENCH_SPEC_INVALID', path: label, field: '/profiles', message: `${profile.spec.id} is a version 1 profile; version 2 plans use version 2 profiles.` });
  }
  diagnostics.push(...commonPlanDiagnostics(spec, label, tasks, conditions, profiles, weightable));
  let judging: LoadedPlan['judging'] = null;
  if (spec.judging?.rubric && spec.judging.prompt) {
    const bundleOf = async (ref: BundleRef, field: string): Promise<Bundle<null> | undefined> => {
      if (!(await isDirectory(where(ref)))) { diagnostics.push({ code: 'BENCH_REFERENCE_MISSING', path: name(ref), field, message: 'The bundle directory does not exist.' }); return undefined; }
      try { return { spec: null, file: where(ref), directory: where(ref), hash: await directoryHash(where(ref)) }; } catch {
        diagnostics.push({ code: 'BENCH_REFERENCE_INVALID', path: name(ref), field, message: 'The bundle cannot be hashed (unreadable entry or symbolic link).' });
        return undefined;
      }
    };
    const rubric = await bundleOf(spec.judging.rubric, '/judging/rubric');
    const prompt = await bundleOf(spec.judging.prompt, '/judging/prompt');
    if (rubric && prompt) judging = { rubric: { ...rubric, commit: repos[spec.judging.rubric.repository as 'subject' | 'benchmark']!.commit }, prompt };
  }
  const analysis = structural.analysis;
  if (analysis && !diagnostics.length) {
    const taskIds = tasks.map(t => t.spec.id);
    const conditionIds = conditions.map(c => c.spec.id);
    for (const id of [analysis.conditions.reference, analysis.conditions.treatment]) {
      if (!conditionIds.includes(id)) diagnostics.push({ code: 'BENCH_SPEC_INVALID', path: spec.analysis!, field: '/conditions', message: `${id} is not a condition of the plan.` });
    }
    const grouped = [...analysis.task_groups.headline, ...analysis.task_groups.control];
    if (grouped.length !== taskIds.length || taskIds.some(id => !grouped.includes(id))) {
      diagnostics.push({ code: 'BENCH_SPEC_INVALID', path: spec.analysis!, field: '/task_groups', message: 'Every plan task belongs to exactly one task group, and every grouped task is a plan task.' });
    }
    if (weightable) diagnostics.push(...analysisMeasureDiagnostics(analysis, spec, weightable, spec.analysis!));
  }
  if (diagnostics.length) return { diagnostics };
  const planFileHash = sha256(bytes);
  const hash = hashValue({
    plan: planFileHash,
    tasks: Object.fromEntries(tasks.map(b => [b.spec.id, b.hash])),
    conditions: Object.fromEntries(conditions.map(b => [b.spec.id, b.hash])),
    profiles: Object.fromEntries(profiles.map(b => [b.spec.id, b.hash])),
    judging: judging ? { rubric: judging.rubric.hash, prompt: judging.prompt.hash } : null,
    files: Object.fromEntries(Object.entries(structural.planFiles).map(([k, f]) => [k, f.hash])),
    directory: structural.directoryFiles,
  });
  return {
    plan: {
      spec, file, directory: path.dirname(file), hash, planFileHash, tasks, conditions, profiles,
      subjectPath: paths.subject, version: 2, subject: { ...repos.subject },
      benchmark: repos.benchmark ? { ...repos.benchmark, path: paths.benchmark } : null,
      planFiles: structural.planFiles, planDirectoryFiles: structural.directoryFiles, analysis, terms: structural.terms, judging,
    },
    diagnostics: [],
  };
}

/** Every measure an analysis specification compares (primary, guardrail, calibration and resource
 * measures) must be comparatively eligible under the scorecard rule that already governs composite
 * weights: a numeric measure that is not condition-specific (D24; ADR-0004 guarantee 4). A
 * diagnostic such as `setup_seconds` can never become comparative evidence.
 */
export function analysisMeasureDiagnostics(analysis: AnalysisSpec, spec: PlanSpec, eligible: (measure: string, plan: PlanSpec) => boolean, label: string): Diagnostic[] {
  const named: [string, string][] = [
    ...(analysis.analysis?.primary ?? []).map((p, i) => [`/analysis/primary/${i}/measure`, p.measure] as [string, string]),
    ...(analysis.analysis?.guardrails ?? []).map((g, i) => [`/analysis/guardrails/${i}/measure`, g.measure] as [string, string]),
    ...(analysis.calibration ? [
      ['/calibration/measure', analysis.calibration.measure], ['/calibration/recurrence_measure', analysis.calibration.recurrence_measure],
      ['/calibration/resources/tokens', analysis.calibration.resources.tokens], ['/calibration/resources/seconds', analysis.calibration.resources.seconds],
    ] as [string, string][] : []),
  ];
  return named.filter(([, measure]) => !eligible(measure, spec)).map(([field, measure]) => ({
    code: 'BENCH_ANALYSIS_MEASURE_INVALID', path: label, field,
    message: `${measure} is not a comparatively eligible numeric measure; condition-specific diagnostics and judged verdicts are never compared.`,
  }));
}
