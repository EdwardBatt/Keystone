import { readFileSync } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { compare, serialize, type Diagnostic } from '../core.js';
import { relativePath } from '../paths.js';

/** Harness specification formats live with Keystone's generic benchmark specification. */
export const specificationDirectory = new URL('../../benchmark/specification/', import.meta.url);
const schemaNames = ['task', 'condition', 'agent-profile', 'plan', 'scorecard', 'judgements', 'manual-record', 'run-record'] as const;
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
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
const load = (name: string) => JSON.parse(readFileSync(new URL(`schemas/${name}.schema.json`, specificationDirectory), 'utf8'));
ajv.addSchema(load('common'));
const validators = new Map<SchemaName, ValidateFunction>(schemaNames.map(name => [name, ajv.compile(load(name))]));

export function schemaDiagnostics(name: SchemaName, data: unknown, file: string, code = 'BENCH_SPEC_INVALID'): Diagnostic[] {
  const validate = validators.get(name)!;
  if (validate(data)) return [];
  return (validate.errors ?? []).map(error => ({
    code, path: file, field: error.instancePath || '/',
    message: `${error.keyword}: ${error.message ?? 'invalid value'}${error.keyword === 'required' ? ` (${String(error.params.missingProperty)})` : ''}`,
  }));
}

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const hashValue = (value: unknown) => sha256(serialize(value));

export interface Usage { input_tokens?: number | null; output_tokens?: number | null; turns?: number | null; tool_calls?: number | null; tool?: string | null; model?: string | null; unrecognized_identity?: true }
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
  kind: 'keystone-bench-agent-profile'; schema_version: 1; id: string; description?: string; mode: 'command' | 'manual';
  declared: { tool: string; model: string }; command?: string[]; stdin?: 'none' | 'prompt';
  usage?: 'none' | 'keystone-bench-json' | 'claude-code-json'; env?: { pass?: string[] };
  /** Identifiers a reported tool or model must match exactly to be persisted (review round 2, B8). */
  trusted?: { tools?: string[]; models?: string[] };
}
export interface PlanSpec {
  kind: 'keystone-bench-plan'; schema_version: 1; id: string; description?: string; purpose: 'experiment' | 'smoke';
  subject: { id: string; repository: string; commit: string };
  tasks: string[]; conditions: string[]; profiles: string[]; repetitions: number; seed: number;
  limits: { session_timeout_seconds: number; setup_timeout_seconds: number; oracle_timeout_seconds: number };
  telemetry: { enabled: boolean; wrap?: string[] };
  judging?: { procedure: string; exclude?: string[] };
  composite?: { weights: Record<string, number> };
}

/** A loaded specification together with its bundle: the directory holding the specification file. */
export interface Bundle<T> { spec: T; file: string; directory: string; hash: string }

/** Placeholders each command context may use. Anything else in braces is rejected. */
export const placeholders = {
  oracle: ['node', 'workspace', 'task'],
  setup: ['node', 'workspace', 'condition'],
  tool: ['node', 'workspace', 'condition'],
  agent: ['node', 'workspace', 'profile', 'prompt_file', 'usage_file', 'session'],
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
  const files: Record<string, string> = {};
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
  } else if (name === 'scorecard') {
    unique((data as { measures: { name: string }[] }).measures.map(m => m.name), '/measures');
  }
  return diagnostics;
}

export interface LoadedPlan {
  spec: PlanSpec; file: string; directory: string;
  /** Immutable plan provenance: plan bytes and every referenced bundle (ADR-0004 guarantee 8). */
  hash: string; planFileHash: string;
  tasks: Bundle<TaskSpec>[]; conditions: Bundle<ConditionSpec>[]; profiles: Bundle<ProfileSpec>[];
  subjectPath: string;
}

async function loadBundle<T>(plan: string, reference: string, name: SchemaName, field: string, diagnostics: Diagnostic[]): Promise<Bundle<T> | undefined> {
  const file = path.resolve(path.dirname(plan), reference);
  const { data, diagnostics: read } = await readJson(file, reference);
  if (read.length) { diagnostics.push(...read.map(d => ({ ...d, code: d.code === 'BENCH_SPEC_UNREADABLE' ? 'BENCH_REFERENCE_MISSING' : d.code, field }))); return undefined; }
  const expected = Object.entries(kinds).find(([, schema]) => schema === name)![0];
  if ((data as { kind?: unknown })?.kind !== expected) {
    diagnostics.push({ code: 'BENCH_SPEC_KIND_MISMATCH', path: reference, field, message: `Expected a ${expected} specification.` });
    return undefined;
  }
  const own = await specDiagnostics(name, data, file, reference);
  if (own.length) { diagnostics.push(...own); return undefined; }
  try {
    return { spec: data as T, file, directory: path.dirname(file), hash: await directoryHash(path.dirname(file)) };
  } catch {
    diagnostics.push({ code: 'BENCH_REFERENCE_INVALID', path: reference, field, message: 'Specification bundle cannot be hashed (unreadable entry or symbolic link).' });
    return undefined;
  }
}

/** Loads and validates a plan with every referenced specification. Read-only. */
export async function loadPlan(planFile: string, weightable?: (measure: string, plan: PlanSpec) => boolean): Promise<{ plan?: LoadedPlan; diagnostics: Diagnostic[] }> {
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
  const diagnostics: Diagnostic[] = [];
  const tasks: Bundle<TaskSpec>[] = [];
  const conditions: Bundle<ConditionSpec>[] = [];
  const profiles: Bundle<ProfileSpec>[] = [];
  for (const [i, reference] of spec.tasks.entries()) { const b = await loadBundle<TaskSpec>(file, reference, 'task', `/tasks/${i}`, diagnostics); if (b) tasks.push(b); }
  for (const [i, reference] of spec.conditions.entries()) { const b = await loadBundle<ConditionSpec>(file, reference, 'condition', `/conditions/${i}`, diagnostics); if (b) conditions.push(b); }
  for (const [i, reference] of spec.profiles.entries()) { const b = await loadBundle<ProfileSpec>(file, reference, 'agent-profile', `/profiles/${i}`, diagnostics); if (b) profiles.push(b); }
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
  if (diagnostics.length) return { diagnostics };
  const planFileHash = sha256(bytes);
  const hash = hashValue({
    plan: planFileHash,
    tasks: Object.fromEntries(tasks.map(b => [b.spec.id, b.hash])),
    conditions: Object.fromEntries(conditions.map(b => [b.spec.id, b.hash])),
    profiles: Object.fromEntries(profiles.map(b => [b.spec.id, b.hash])),
  });
  return { plan: { spec, file, directory: path.dirname(file), hash, planFileHash, tasks, conditions, profiles, subjectPath: path.resolve(path.dirname(file), spec.subject.repository) }, diagnostics: [] };
}
