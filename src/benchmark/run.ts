import { mkdir, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compare, KeystoneError, serialize, type Diagnostic } from '../core.js';
import { inspect } from '../commands/index.js';
import { expand, hashValue, sha256, type Bundle, type ConditionSpec, type ProfileSpec, type TaskSpec, type Usage } from './specs.js';
import { baseEnvironment, environmentFor, pathHash, resolveExecutable, runCommand, writeShim, type ProcessStatus } from './process.js';
import { changeStats, checkout, initSnapshots, snapshots, snapshotTree } from './git.js';
import { BoundaryError, guard, guardTree, readJsonFile, sealRecord, writeVerified, type Boundary } from './store.js';
import { open, planChanges, runPaths, type Context, type Manifest, type Result, type RunEntry, type RunState } from './prepare.js';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
export const version: string = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;

interface SessionRecord {
  id: string; kind: 'planned' | 'fix'; status: ProcessStatus; exit_code: number | null; duration_ms: number | null;
  duration_source: 'deterministic' | 'reported'; usage: Usage | null; changes: { files: number; insertions: number; deletions: number } | null;
}
interface OracleResult { id: string; role: 'task' | 'regression' | 'trap'; passed: boolean; status: ProcessStatus; exit_code: number | null; duration_ms: number }
interface Check { after: string; results: OracleResult[] }
interface SetupRecord { duration_ms: number | null; files_staged: number; commands: { id: string; status: ProcessStatus; exit_code: number | null; duration_ms: number }[] }
interface ExecutionState extends RunState {
  started_at?: string; setup_tree?: string; final_tree?: string; setup_record?: SetupRecord; failure?: { code: string; message: string } | null;
}

const count = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 ? value as number : null;
export interface Trusted { tools?: string[]; models?: string[] }

/** Durable identity comes from trusted declared configuration (review round 2, B8). A reported tool
 * or model is persisted only when it exactly matches an identifier the profile declares as trusted;
 * anything else is dropped and flagged `unrecognized_identity`, so no agent-supplied text can enter a
 * content-free record through an identifier. A comma-separated model list keeps its trusted
 * members. A parser's own constant tool name (`claude-code`) is the harness's, not the agent's.
 */
function trust(reported: { tool: unknown; models: unknown[]; parserTool?: string }, trusted: Trusted = {}): Pick<Usage, 'tool' | 'model'> & { unrecognized_identity?: true } {
  const tools = new Set(trusted.tools ?? []);
  const models = new Set(trusted.models ?? []);
  let dropped = false;
  let tool: string | null = reported.parserTool ?? null;
  if (!reported.parserTool && reported.tool !== undefined && reported.tool !== null) {
    if (typeof reported.tool === 'string' && tools.has(reported.tool)) tool = reported.tool; else dropped = true;
  }
  const kept: string[] = [];
  for (const model of reported.models) {
    if (model === undefined || model === null) continue;
    if (typeof model === 'string' && models.has(model)) { if (!kept.includes(model)) kept.push(model); } else dropped = true;
  }
  kept.sort(compare);
  return { tool, model: kept.length ? kept.join(',') : null, ...(dropped ? { unrecognized_identity: true as const } : {}) };
}

/** Usage parsers read numbers, and identity only through `trust`; agent output is discarded, never stored. */
export function parseUsage(parser: ProfileSpec['usage'], stdout: Buffer, usageFile: unknown, trusted: Trusted = {}): Usage | null {
  if (parser === 'keystone-bench-json') {
    const u = usageFile as Record<string, unknown> | undefined;
    if (!u || typeof u !== 'object') return null;
    const models = typeof u.model === 'string' ? u.model.split(',') : [u.model];
    return { input_tokens: count(u.input_tokens), output_tokens: count(u.output_tokens), turns: count(u.turns), tool_calls: count(u.tool_calls), ...trust({ tool: u.tool, models }, trusted) };
  }
  if (parser === 'claude-code-json') {
    let data: Record<string, any> | undefined;
    const output = stdout.toString('utf8').trim();
    for (const candidate of [output, ...output.split(/\r?\n/).reverse()]) {
      try { const parsed = JSON.parse(candidate); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { data = parsed; break; } } catch { /* Next candidate. */ }
    }
    if (!data) return null;
    const usage = data.usage ?? {};
    const parts = [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens].map(count);
    const models = data.modelUsage && typeof data.modelUsage === 'object' ? Object.keys(data.modelUsage) : [];
    return {
      input_tokens: parts[0] === null ? null : parts.reduce<number>((sum, v) => sum + (v ?? 0), 0),
      output_tokens: count(usage.output_tokens), turns: count(data.num_turns), tool_calls: null,
      ...trust({ tool: null, models, parserTool: 'claude-code' }, trusted),
    };
  }
  if (parser === 'codex-jsonl') return parseCodex(stdout, trusted);
  return null;
}

/** Event item types the Codex stream reports for tool use (provisional mapping, TASK-0015 item 2). */
const codexToolItems = new Set(['command_execution', 'mcp_tool_call', 'web_search', 'file_change']);

/** `codex exec --json` writes a JSON Lines event stream. Usage comes from `turn.completed` events;
 * cached input is already part of `input_tokens`, so it is not added again. The stream names no
 * model: the declared model stands. Unparseable lines are skipped; a stream with no completed turn
 * reports no usage (`null`), never zero. The mapping is provisional until the real-CLI check.
 */
function parseCodex(stdout: Buffer, trusted: Trusted): Usage | null {
  let input = 0, output = 0, turns = 0, tools = 0, incomplete = false;
  for (const line of stdout.toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: Record<string, any>;
    try { event = JSON.parse(line); } catch { continue; }
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'turn.completed') {
      turns++;
      const i = count(event.usage?.input_tokens);
      const o = count(event.usage?.output_tokens);
      if (i === null || o === null) incomplete = true; else { input += i; output += o; }
    } else if (event.type === 'item.completed' && codexToolItems.has(event.item?.type)) tools++;
  }
  if (!turns) return null;
  return { input_tokens: incomplete ? null : input, output_tokens: incomplete ? null : output, turns, tool_calls: tools, ...trust({ tool: null, models: [], parserTool: 'codex' }, trusted) };
}

/** Version 2: a session reporting a trusted model other than the declared one is flagged, never dropped (item 1). */
function flagModel(usage: Usage | null, declared: string): Usage | null {
  if (!usage?.model || usage.model.split(',').every(m => m === declared)) return usage;
  return { ...usage, model_mismatch: true };
}

const allTasksPass = (check: Check | undefined) => !!check && check.results.filter(r => r.role === 'task').every(r => r.passed);

async function readText(directory: string, relative: string): Promise<{ text: string; hash: string }> {
  const bytes = await readFile(path.join(directory, ...relative.split('/')));
  return { text: bytes.toString('utf8').replace(/^﻿/, ''), hash: sha256(bytes) };
}

/** Condition-specific diagnostics from read-only inspection after the final session (telemetry only). */
async function inspectWorkspace(workspace: string): Promise<{ keystone_envelope: { estimated_tokens: number; omissions: number } | null; keystone_validation: { diagnostics: number; codes: string[] } | null }> {
  let keystone_envelope = null;
  const envelope = await readJsonFile<Record<string, any>>(path.join(workspace, '.context', 'current-envelope.json'));
  if (envelope && Number.isInteger(envelope.budget?.estimated_tokens)) {
    keystone_envelope = { estimated_tokens: envelope.budget.estimated_tokens, omissions: Array.isArray(envelope.omissions) ? envelope.omissions.length : 0 };
  }
  let keystone_validation = null;
  try {
    await readFile(path.join(workspace, '.context', 'config.yaml'));
    try {
      const result = await inspect(workspace);
      keystone_validation = { diagnostics: result.diagnostics.length, codes: [...new Set(result.diagnostics.map(d => d.code))].sort(compare) };
    } catch (error) {
      keystone_validation = { diagnostics: 1, codes: [error instanceof KeystoneError ? error.diagnostic.code : 'IO_ERROR'] };
    }
  } catch { /* No Keystone configuration in this workspace. */ }
  return { keystone_envelope, keystone_validation };
}

async function toolTelemetry(log: string, tools: { name: string; resolved: boolean }[]) {
  let lines: string[] = [];
  try { lines = (await readFile(log, 'utf8')).split('\n').filter(Boolean); } catch { /* No invocations. */ }
  const events = lines.map(line => { try { return JSON.parse(line) as { tool: string; exit_code: number | null; duration_ms: number }; } catch { return undefined; } }).filter(Boolean) as { tool: string; exit_code: number | null; duration_ms: number }[];
  return tools.map(t => {
    const mine = events.filter(e => e.tool === t.name);
    return { name: t.name, resolved: t.resolved, invocations: mine.length, failures: mine.filter(e => e.exit_code !== 0).length, duration_ms: mine.reduce((s, e) => s + e.duration_ms, 0) };
  });
}

interface Prepared {
  run: RunEntry; task: Bundle<TaskSpec>; condition: Bundle<ConditionSpec>; profile: Bundle<ProfileSpec>;
  paths: ReturnType<typeof runPaths>; state: ExecutionState;
}

class Execution {
  constructor(private readonly context: Context, private readonly p: Prepared) {}
  private get h() { return this.p.paths.harness; }
  private get ws() { return this.p.paths.workspace; }
  private base!: Awaited<ReturnType<typeof baseEnvironment>>;
  private setupPath!: string[];
  private sessionEnv!: { env: NodeJS.ProcessEnv; path: string[] };
  private wrapped: { name: string; resolved: boolean }[] = [];
  private instructions: { text: string; hash: string } | null = null;
  private statement!: { text: string; hash: string };
  /** Version 2: the observed tool version and its source (item 1). */
  observed: { tool_version: string | null; tool_version_source: 'deterministic' | 'reported' | null } = { tool_version: null, tool_version_source: null };
  /** Content-free notices raised while executing, such as unreported usage. */
  notices: Diagnostic[] = [];

  /** Version 2: launches the profile's version command before setup and compares its first output
   * line with the declared, trusted tool version. An untrusted string is never persisted.
   */
  async probe(): Promise<Diagnostic | null> {
    const { spec, directory } = this.p.profile;
    if (this.context.plan.version !== 2 || spec.mode !== 'command' || !spec.version) return null;
    const env = environmentFor(this.base, []);
    await this.secure();
    const result = await runCommand(expand(spec.version.command, { node: process.execPath, profile: directory }), {
      cwd: this.ws, env: env.env, pathEntries: env.path, timeoutMs: this.context.plan.spec.limits.setup_timeout_seconds * 1000, captureStdout: true,
    });
    const line = result.stdout.toString('utf8').split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? '';
    const trusted = (spec.trusted?.tool_versions ?? []).includes(line) ? line : null;
    if (result.status === 'ok' && trusted === spec.declared.tool_version) {
      this.observed = { tool_version: trusted, tool_version_source: 'deterministic' };
      return null;
    }
    return { code: 'BENCH_TOOL_VERSION_MISMATCH', path: this.p.run.run_id, message: `The agent tool did not report the declared version ${spec.declared.tool_version}${trusted ? ` (it reported ${trusted})` : result.status === 'ok' ? ' (it reported an untrusted version)' : ` (the version command ended ${result.status})`}; the run was not started.` };
  }

  /** Refuses to continue unless the workspace and harness directory are still physically inside the work boundary. */
  async secure(): Promise<void> {
    const work = this.context.where.boundaries.work;
    await guard(work, this.ws);
    await guard(work, this.h);
    // Snapshot Git operations act on the harness repository and its index (review round 3).
    const store = snapshots(this.h);
    await guardTree(work, store.gitDir);
    await guard(work, store.indexFile);
  }

  /** Replaces a harness output file rather than writing through any existing entry. */
  async output(file: string, data: string): Promise<void> {
    const failure = await writeVerified(file, data, this.context.where.boundaries.work);
    if (failure) throw new BoundaryError(failure.diagnostics[0]);
  }

  private values(extra: Record<string, string> = {}) {
    return { node: process.execPath, workspace: this.ws, condition: this.p.condition.directory, task: this.p.task.directory, profile: this.p.profile.directory, ...extra };
  }

  /** The controlled environment, identical for every condition except the condition's own tools. */
  async environment(): Promise<void> {
    const { plan } = this.context;
    this.base = await baseEnvironment(this.p.profile.spec.env?.pass ?? []);
    const toolsDir = path.join(this.h, 'tools');
    const wrapDir = path.join(this.h, 'telemetry-bin');
    await this.secure();
    await guard(this.context.where.boundaries.work, toolsDir);
    await rm(toolsDir, { recursive: true, force: true });
    await guard(this.context.where.boundaries.work, wrapDir);
    await rm(wrapDir, { recursive: true, force: true });
    // The tool log is appended to by shims; it is created fresh, never appended through an old entry.
    await guard(this.context.where.boundaries.work, path.join(this.h, 'tool-log.jsonl'));
    if (!(this.p.state.status === 'recorded')) await rm(path.join(this.h, 'tool-log.jsonl'), { force: true });
    for (const tool of this.p.condition.spec.tools) {
      await writeShim(toolsDir, tool.name, { argv: expand(tool.command, this.values()), tool: tool.name, path: this.base.path }, (file, data) => this.output(file, data));
    }
    this.setupPath = [...(this.p.condition.spec.tools.length ? [toolsDir] : []), ...this.base.path];
    const prepend = [...(this.p.condition.spec.tools.length ? [toolsDir] : [])];
    this.wrapped = [];
    if (plan.spec.telemetry.enabled) {
      for (const name of [...(plan.spec.telemetry.wrap ?? [])].sort(compare)) {
        const real = await resolveExecutable(name, this.setupPath, this.base.variables);
        this.wrapped.push({ name, resolved: !!real });
        if (real) await writeShim(wrapDir, name, { argv: [real], tool: name, log: path.join(this.h, 'tool-log.jsonl'), path: this.setupPath }, (file, data) => this.output(file, data));
      }
      if (this.wrapped.some(w => w.resolved)) prepend.unshift(wrapDir);
    }
    this.sessionEnv = environmentFor(this.base, prepend);
    this.statement = await readText(this.p.task.directory, this.p.task.spec.statement);
    this.instructions = this.p.condition.spec.instructions === null ? null : await readText(this.p.condition.directory, this.p.condition.spec.instructions);
  }

  async compose(prompt: string): Promise<{ text: string; hash: string }> {
    const session = await readText(this.p.task.directory, prompt);
    return { text: [this.instructions?.text, this.statement.text, session.text].filter(Boolean).map(s => s!.trimEnd()).join('\n\n') + '\n', hash: session.hash };
  }

  async setup(): Promise<SetupRecord> {
    const { limits } = this.context.plan.spec;
    const env = environmentFor(this.base, this.setupPath.slice(0, this.setupPath.length - this.base.path.length));
    const commands: SetupRecord['commands'] = [];
    let total = 0;
    for (const command of this.p.condition.spec.setup.commands) {
      await this.secure();
      const result = await runCommand(expand(command.command, this.values()), { cwd: this.ws, env: env.env, pathEntries: env.path, timeoutMs: limits.setup_timeout_seconds * 1000 });
      commands.push({ id: command.id, status: result.status, exit_code: result.exit_code, duration_ms: result.duration_ms });
      total += result.duration_ms;
      if (result.status !== 'ok') break;
    }
    return { duration_ms: total, files_staged: this.p.state.files_staged, commands };
  }

  async check(after: string): Promise<Check> {
    const { limits } = this.context.plan.spec;
    const env = environmentFor(this.base, []);
    const results: OracleResult[] = [];
    for (const oracle of this.p.task.spec.oracles) {
      await this.secure();
      const result = await runCommand(expand(oracle.command, this.values()), { cwd: this.ws, env: env.env, pathEntries: env.path, timeoutMs: limits.oracle_timeout_seconds * 1000 });
      results.push({ id: oracle.id, role: oracle.role, passed: result.status === 'ok', status: result.status, exit_code: result.exit_code, duration_ms: result.duration_ms });
    }
    return { after, results };
  }

  async session(id: string, kind: 'planned' | 'fix', prompt: string, previous: string): Promise<{ record: SessionRecord; tree: string }> {
    const { spec } = this.p.profile;
    const composed = await this.compose(prompt);
    const promptFile = path.join(this.h, 'prompts', `${id}.md`);
    const usageFile = path.join(this.h, 'usage', `${id}.json`);
    await this.secure();
    await guard(this.context.where.boundaries.work, promptFile);
    await guard(this.context.where.boundaries.work, usageFile);
    await mkdir(path.dirname(promptFile), { recursive: true });
    await mkdir(path.dirname(usageFile), { recursive: true });
    await this.output(promptFile, composed.text);
    await rm(usageFile, { force: true });
    await this.secure();
    const argv = expand(spec.command!, this.values({ prompt_file: promptFile, usage_file: usageFile, session: id }));
    const result = await runCommand(argv, {
      cwd: this.ws, env: this.sessionEnv.env, pathEntries: this.sessionEnv.path, timeoutMs: this.context.plan.spec.limits.session_timeout_seconds * 1000,
      stdin: spec.stdin === 'prompt' ? composed.text : '', captureStdout: spec.usage === 'claude-code-json' || spec.usage === 'codex-jsonl',
    });
    await this.secure();
    let usage = parseUsage(spec.usage, result.stdout, await readJsonFile(usageFile), spec.trusted);
    // The notice is raised whenever required usage is incomplete, not only when it is wholly absent.
    if (spec.usage === 'codex-jsonl' && (!usage || usage.input_tokens == null || usage.output_tokens == null || usage.turns == null)) {
      this.notices.push({ code: 'BENCH_USAGE_UNREPORTED', path: `${this.p.run.run_id}/${id}`, message: usage ? 'The agent reported incomplete usage for this session; the missing values are recorded as not reported (null), never zero.' : 'The agent reported no usage for this session; usage is recorded as not reported (null), never zero.' });
    }
    if (this.context.plan.version === 2) usage = flagModel(usage, spec.declared.model);
    const store = snapshots(this.h);
    const tree = await snapshotTree(this.ws, store);
    return { record: { id, kind, status: result.status, exit_code: result.exit_code, duration_ms: result.duration_ms, duration_source: 'deterministic', usage, changes: await changeStats(store, previous, tree) }, tree };
  }

  inputs() {
    const { task, condition, profile } = this.p;
    const { plan } = this.context;
    const promptHash = (file: string) => sha256(readFileSync(path.join(task.directory, ...file.split('/'))));
    return {
      statement: this.statement.hash,
      prompts: Object.fromEntries(task.spec.sessions.map(s => [s.id, promptHash(s.prompt)])),
      fix_prompt: task.spec.fix ? promptHash(task.spec.fix.prompt) : null,
      oracles: hashValue({ oracles: task.spec.oracles, bundle: task.hash }),
      profile: profile.hash,
      limits: hashValue(plan.spec.limits),
      instrumentation: hashValue(plan.spec.telemetry),
      instructions: this.instructions?.hash ?? null,
      setup: hashValue({ setup: condition.spec.setup, tools: condition.spec.tools, bundle: condition.hash }),
    };
  }

  async record(fields: { status: 'completed' | 'failed'; failure: { code: string; message: string } | null; setup: SetupRecord; sessions: SessionRecord[]; checks: Check[]; started_at: string; evidence: { setup_tree: string | null; final_tree: string | null } }) {
    const { plan } = this.context;
    const { run, task, condition, profile } = this.p;
    const keystone = await checkout(packageRoot);
    const telemetry = plan.spec.telemetry.enabled
      ? { enabled: true, tools: await toolTelemetry(path.join(this.h, 'tool-log.jsonl'), this.wrapped), ...(fields.status === 'completed' ? await inspectWorkspace(this.ws) : { keystone_envelope: null, keystone_validation: null }) }
      : { enabled: false, tools: [], keystone_envelope: null, keystone_validation: null };
    // Version 2 (TASK-0015 items 1, 5 and 7): both pinned repositories, the observed tool version and
    // reported trusted models, and the attempt number. Version 1 records are unchanged.
    const v2 = plan.version === 2;
    const models = [...new Set(fields.sessions.flatMap(s => s.usage?.model ? s.usage.model.split(',') : []))].sort(compare);
    return {
      kind: 'keystone-bench-run-record', schema_version: plan.version, run_id: run.run_id, purpose: plan.spec.purpose,
      status: fields.status, failure: fields.failure, plan: { id: plan.spec.id, hash: plan.hash },
      provenance: {
        keystone: { version, commit: keystone.commit, dirty: keystone.dirty }, harness: { version },
        ...(v2
          ? { repositories: { subject: { ...plan.subject }, benchmark: plan.benchmark ? { id: plan.benchmark.id, commit: plan.benchmark.commit } : null }, attempt: this.p.state.attempt ?? 1 }
          : { subject: { id: plan.subject.id, commit: plan.subject.commit } }),
        task: { id: task.spec.id, hash: task.hash }, condition: { id: condition.spec.id, hash: condition.hash },
        profile: { id: profile.spec.id, hash: profile.hash, mode: profile.spec.mode, declared: profile.spec.declared, ...(v2 ? { observed: { ...this.observed, models } } : {}) },
        seed: plan.spec.seed, repetition: run.repetition, order_index: run.order_index,
        started_at: fields.started_at, finished_at: new Date().toISOString(), platform: `${process.platform}-${process.arch}`,
      },
      inputs: this.inputs(),
      environment: { pass: this.base.pass, removed_path_entries: this.base.removed, base_path_hash: pathHash(this.base.path) },
      setup: fields.setup, sessions: fields.sessions, checks: fields.checks, telemetry,
      // The judged change is bound to the sealed record: these tree IDs are covered by its evidence hash.
      evidence: fields.evidence,
    };
  }
}

/** Persists run state. A failure is always reported: run state decides what may run next. */
async function saveState(paths: ReturnType<typeof runPaths>, state: ExecutionState, boundary: Boundary): Promise<Diagnostic[]> {
  const failure = await writeVerified(paths.state, serialize(state), boundary);
  if (!failure) return [];
  return [{ code: 'BENCH_STATE_WRITE_FAILED', path: paths.state, message: `Run state "${state.status}" could not be persisted.` }, ...failure.diagnostics];
}

/** Installs the sealed record, then the final state. Either failure is a harness failure (review B4). */
async function install(context: Context, p: Prepared, record: Record<string, unknown>): Promise<Diagnostic[]> {
  const failure = await writeVerified(path.join(context.where.results, 'runs', `${p.run.run_id}.json`), sealRecord(record), context.where.boundaries.results);
  const state = await saveState(p.paths, { ...p.state, status: failure ? 'unrecorded' : 'done' }, context.where.boundaries.work);
  return [...(failure?.diagnostics ?? []), ...state];
}

type RunOutcome = 'completed' | 'failed-run' | 'awaiting-record' | 'unchanged' | 'blocked' | 'error';

async function execute(context: Context, p: Prepared): Promise<{ outcome: RunOutcome; diagnostics: Diagnostic[] }> {
  const execution = new Execution(context, p);
  const started_at = p.state.started_at ?? new Date().toISOString();
  await execution.environment();
  const task = p.task.spec;
  if (p.state.status === 'recorded') return finalizeManual(context, p, execution);
  // Version 2: the tool version is observed before anything else runs; a mismatch starts nothing
  // and consumes no attempt (TASK-0015 item 1).
  const mismatch = await execution.probe();
  if (mismatch) return { outcome: 'blocked', diagnostics: [mismatch] };
  const running = await saveState(p.paths, { ...p.state, status: 'running', started_at }, context.where.boundaries.work);
  if (running.length) return { outcome: 'error', diagnostics: running };
  const setup = await execution.setup();
  if (setup.commands.some(c => c.status !== 'ok')) {
    const failed = setup.commands.find(c => c.status !== 'ok')!;
    const record = await execution.record({ status: 'failed', failure: { code: 'BENCH_SETUP_FAILED', message: `Condition setup command ${failed.id} ended ${failed.status}.` }, setup, sessions: [], checks: [], started_at, evidence: { setup_tree: null, final_tree: null } });
    const written = await install(context, p, record);
    return { outcome: written.length ? 'error' : 'failed-run', diagnostics: written };
  }
  const store = snapshots(p.paths.harness);
  await execution.secure();
  await initSnapshots(store);
  let tree = await snapshotTree(p.paths.workspace, store);
  const setupTree = tree;
  if (p.profile.spec.mode === 'manual') {
    for (const session of task.sessions) await execution.output(await promptPath(context, p, session.id), (await execution.compose(session.prompt)).text);
    if (task.fix) await execution.output(await promptPath(context, p, 'fix'), (await execution.compose(task.fix.prompt)).text);
    const saved = await saveState(p.paths, { ...p.state, status: 'awaiting-record', started_at, setup_tree: tree, setup_record: setup }, context.where.boundaries.work);
    return { outcome: saved.length ? 'error' : 'awaiting-record', diagnostics: saved };
  }
  const sessions: SessionRecord[] = [];
  const checks: Check[] = [];
  for (const session of task.sessions) {
    const result = await execution.session(session.id, 'planned', session.prompt, tree);
    sessions.push(result.record);
    tree = result.tree;
  }
  checks.push(await execution.check(task.sessions.at(-1)!.id));
  for (let fix = 1; task.fix && fix <= task.fix.max && !allTasksPass(checks.at(-1)); fix++) {
    const result = await execution.session(`fix${fix}`, 'fix', task.fix.prompt, tree);
    sessions.push(result.record);
    tree = result.tree;
    checks.push(await execution.check(`fix${fix}`));
  }
  const written = await install(context, p, await execution.record({ status: 'completed', failure: null, setup, sessions, checks, started_at, evidence: { setup_tree: setupTree, final_tree: tree } }));
  return { outcome: written.length ? 'error' : 'completed', diagnostics: [...execution.notices, ...written] };
}

async function promptPath(context: Context, p: Prepared, id: string): Promise<string> {
  const file = path.join(p.paths.harness, 'prompts', `${id}.md`);
  await guard(context.where.boundaries.work, file);
  await mkdir(path.dirname(file), { recursive: true });
  return file;
}

interface ManualInput { sessions: { id: string; status: 'ok' | 'failed'; duration_seconds: number | null; usage: Usage | null }[]; fix_sessions: number; tool_version?: string }

/** Completes a manual run after `record`: the final check and record, launched only by `run` (I2). */
async function finalizeManual(context: Context, p: Prepared, execution: Execution): Promise<{ outcome: RunOutcome; diagnostics: Diagnostic[] }> {
  const manual = p.state.manual as ManualInput;
  const setupTree = p.state.setup_tree!;
  const store = snapshots(p.paths.harness);
  await execution.secure();
  const tree = await snapshotTree(p.paths.workspace, store);
  const changes = await changeStats(store, setupTree, tree);
  const sessions: SessionRecord[] = manual.sessions.map((s, i) => ({
    id: s.id, kind: /^fix[0-9]+$/.test(s.id) ? 'fix' : 'planned', status: s.status, exit_code: null,
    duration_ms: s.duration_seconds === null ? null : Math.round(s.duration_seconds * 1000), duration_source: 'reported',
    usage: context.plan.version === 2 ? flagModel(s.usage, p.profile.spec.declared.model) : s.usage, changes: i === manual.sessions.length - 1 ? changes : null,
  }));
  // A manual record's tool version is reported by the operator, restricted to trusted values by `record`.
  if (context.plan.version === 2) execution.observed = { tool_version: manual.tool_version ?? null, tool_version_source: manual.tool_version ? 'reported' : null };
  const checks = [await execution.check(manual.sessions.at(-1)!.id)];
  const record = await execution.record({ status: 'completed', failure: null, setup: p.state.setup_record!, sessions, checks, started_at: p.state.started_at!, evidence: { setup_tree: setupTree, final_tree: tree } });
  const written = await install(context, p, record);
  return { outcome: written.length ? 'error' : 'completed', diagnostics: written };
}

export async function loadManifest(context: Context): Promise<Manifest | undefined> {
  const manifest = await readJsonFile<Manifest>(path.join(context.where.work, 'manifest.json'));
  return manifest?.kind === 'keystone-bench-work-manifest' ? manifest : undefined;
}

export async function prepared(context: Context, run: RunEntry): Promise<Prepared> {
  const { plan, where } = context;
  const paths = runPaths(where, run.run_id);
  return {
    run, paths, state: (await readJsonFile<ExecutionState>(paths.state))!,
    task: plan.tasks.find(t => t.spec.id === run.task)!, condition: plan.conditions.find(c => c.spec.id === run.condition)!,
    profile: plan.profiles.find(pr => pr.spec.id === run.profile)!,
  };
}

/** `keystone-bench run <plan> [--run <run-id>]...`: the only operation that launches declared programs. */
export async function run(planFile: string, root: string, work: string | undefined, requested: string[], repos?: string): Promise<Result> {
  const opened = await open('run', planFile, root, work, { repos, gates: ['canonical', 'frozen'] });
  if (!opened.context) return opened.result!;
  const context = opened.context;
  const identity = { id: context.plan.spec.id, hash: context.plan.hash };
  const changed = await planChanges(context);
  if (changed.length) return { command: 'run', outcome: 'blocked', plan: identity, diagnostics: changed };
  const manifest = await loadManifest(context);
  if (!manifest) return { command: 'run', outcome: 'blocked', plan: identity, diagnostics: [{ code: 'BENCH_RUN_NOT_PREPARED', path: context.where.work, message: 'No prepared work directory for this plan; run prepare first.' }] };
  const unknown = requested.filter(id => !manifest.runs.some(r => r.run_id === id));
  if (unknown.length) return { command: 'run', outcome: 'blocked', plan: identity, diagnostics: unknown.map(id => ({ code: 'BENCH_RUN_UNKNOWN', path: id, message: `${id} is not a run of this plan.` })) };
  const selected = manifest.runs.filter(r => !requested.length || requested.includes(r.run_id)).sort((a, b) => a.order_index - b.order_index);
  const diagnostics: Diagnostic[] = [];
  const runs: { run_id: string; outcome: RunOutcome }[] = [];
  for (const entry of selected) {
    const p = await prepared(context, entry);
    if (!p.state) { diagnostics.push({ code: 'BENCH_RUN_NOT_PREPARED', path: entry.run_id, message: 'The run has no prepared workspace.' }); runs.push({ run_id: entry.run_id, outcome: 'blocked' }); continue; }
    if (p.state.plan !== context.plan.hash) {
      diagnostics.push({ code: 'BENCH_PLAN_CHANGED', path: entry.run_id, message: 'The run was prepared under different plan content; its staged inputs belong to another plan.' });
      runs.push({ run_id: entry.run_id, outcome: 'blocked' });
      continue;
    }
    if (p.state.status === 'done') { runs.push({ run_id: entry.run_id, outcome: 'unchanged' }); continue; }
    if (p.state.status === 'awaiting-record') { runs.push({ run_id: entry.run_id, outcome: 'awaiting-record' }); continue; }
    if (p.state.status === 'running' || p.state.status === 'unrecorded') {
      diagnostics.push({ code: 'BENCH_RUN_INTERRUPTED', path: entry.run_id, message: context.plan.version === 2
        ? 'The run was interrupted or its record was not installed; its workspace is no longer clean. Archive the attempt with keystone-bench rerun after classifying it.'
        : 'The run was interrupted or its record was not installed; its workspace is no longer clean. Remove the run directory and prepare again.' });
      runs.push({ run_id: entry.run_id, outcome: 'blocked' });
      continue;
    }
    try {
      const result = await execute(context, p);
      diagnostics.push(...result.diagnostics);
      runs.push({ run_id: entry.run_id, outcome: result.outcome });
    } catch (error) {
      diagnostics.push(error instanceof BoundaryError ? error.diagnostic
        : { code: 'BENCH_RUN_ERROR', path: entry.run_id, message: `The harness could not complete the run (${(error as Error).message}); no record was installed.` });
      diagnostics.push(...await saveState(p.paths, { ...p.state, status: 'unrecorded' }, context.where.boundaries.work));
      runs.push({ run_id: entry.run_id, outcome: 'error' });
    }
  }
  const outcome = runs.some(r => r.outcome === 'error') ? 'failed' : runs.some(r => r.outcome === 'blocked') ? 'blocked' : runs.some(r => r.outcome === 'awaiting-record') ? 'awaiting-record'
    : runs.some(r => r.outcome === 'completed' || r.outcome === 'failed-run') ? 'completed' : 'unchanged';
  return { command: 'run', outcome, plan: identity, diagnostics, runs, work: context.where.work, results: context.where.results };
}
