import { lstat, mkdir, readdir, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { compare, type Diagnostic } from '../core.js';
import { relativePath } from '../paths.js';
import { fileTable, hashValue, readJson, schemaDiagnostics, sha256 } from './specs.js';
import { evidenceHash, guard, readJsonFile, sealRecord, writeVerified } from './store.js';
import { open, planChanges, prepareRun, runPaths, type Context, type Result, type RunState } from './prepare.js';
import { loadManifest } from './run.js';

/** One attempt in the content-free attempts log (TASK-0015 item 7). An archived attempt was moved to
 * `<work>/attempts/<run-id>/<n>/` and rerun. A terminal attempt is an infrastructure failure the
 * owner classified after its reruns were exhausted: it stays in place and is missing, never an
 * outcome (P10; TASK-0014 B2).
 */
export interface AttemptEntry {
  attempt: number; terminal: boolean; started_at: string | null; archived_at: string;
  classification: { class: 'infrastructure'; cause: string; classified_by: 'owner'; date: string };
  evidence_hashes: string[]; archive_hash: string | null; record_archived: boolean;
}
export interface AttemptsLog { kind: 'keystone-bench-attempts'; schema_version: 1; plan: { id: string; hash: string }; run_id: string; attempts: AttemptEntry[] }

export const attemptsFile = (context: Context, runId: string) => path.join(context.where.results, 'attempts', `${runId}.json`);
const archiveRoot = (context: Context, runId: string) => path.join(context.where.work, 'attempts', runId);

/** Reads every intact attempts log of the plan. A log that does not match its evidence hash is refused. */
export async function loadAttempts(context: Context): Promise<{ logs: Map<string, AttemptsLog>; refused: Diagnostic[] }> {
  const directory = path.join(context.where.results, 'attempts');
  const logs = new Map<string, AttemptsLog>();
  const refused: Diagnostic[] = [];
  let names: string[] = [];
  try { names = (await readdir(directory)).filter(n => n.endsWith('.json')).sort(compare); } catch { /* No attempts recorded. */ }
  for (const name of names) {
    const log = await readJsonFile<AttemptsLog & { evidence_hash?: string }>(path.join(directory, name));
    if (!log || log.kind !== 'keystone-bench-attempts' || log.evidence_hash !== evidenceHash(log as unknown as Record<string, unknown>)) {
      refused.push({ code: 'BENCH_RESULT_EVIDENCE_MISMATCH', path: `attempts/${name}`, message: 'Attempts log is unreadable or does not match its evidence hash.' });
      continue;
    }
    if (log.plan.hash !== context.plan.hash) { refused.push({ code: 'BENCH_PLAN_MISMATCH', path: `attempts/${name}`, message: 'Attempts log was made under different plan content.' }); continue; }
    logs.set(log.run_id, log);
  }
  return { logs, refused };
}

/** Runs whose last recorded attempt is a terminal infrastructure failure: missing, never outcomes. */
export function terminalRuns(logs: Map<string, AttemptsLog>): Set<string> {
  return new Set([...logs.values()].filter(log => log.attempts.at(-1)?.terminal === true).map(log => log.run_id));
}

/** Attempt numbers archived in the work directory for a run. */
async function archivedAttempts(context: Context, runId: string): Promise<number[]> {
  let names: string[] = [];
  try { names = await readdir(archiveRoot(context, runId)); } catch { return []; }
  return names.filter(n => /^[1-9][0-9]*$/.test(n)).map(Number).sort((a, b) => a - b);
}

/** The durable attempt history of one run must be consistent before anything prepares it again:
 * archived attempts 1…k, each logged as archived, and no terminal classification. Returns the
 * attempt number the next fresh preparation must use, or a refusal. A fresh `prepare` therefore
 * never reuses an attempt number or ignores archived history.
 */
export async function nextAttempt(context: Context, runId: string): Promise<{ attempt: number } | { diagnostics: Diagnostic[] }> {
  const { logs, refused } = await loadAttempts(context);
  if (refused.length) return { diagnostics: refused };
  const archived = await archivedAttempts(context, runId);
  const logged = logs.get(runId)?.attempts ?? [];
  const incomplete = (why: string): { diagnostics: Diagnostic[] } => ({ diagnostics: [{ code: 'BENCH_ATTEMPT_HISTORY_INCOMPLETE', path: runId, message: `${why} Complete the interrupted transition with keystone-bench rerun before preparing this run again.` }] });
  if (logged.some(e => e.terminal)) return { diagnostics: [{ code: 'BENCH_ATTEMPT_TERMINAL', path: runId, message: 'The run was classified as a terminal infrastructure failure; it stays missing and is never prepared again.' }] };
  if (archived.some((n, i) => n !== i + 1)) return incomplete('Archived attempts are not numbered 1…k.');
  if (logged.length !== archived.length || logged.some((e, i) => e.attempt !== i + 1)) return incomplete(`${archived.length} attempt(s) are archived but ${logged.length} are logged.`);
  return { attempt: archived.length + 1 };
}

/** Content hash of an archived attempt: every file by portable relative path (collision-safe). */
export async function archiveHash(directory: string): Promise<string> {
  const files = fileTable();
  const walk = async (relative: string): Promise<void> => {
    const absolute = relative ? path.join(directory, ...relative.split('/')) : directory;
    for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((a, b) => compare(a.name, b.name))) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files[child] = sha256(await readFile(path.join(absolute, entry.name)));
      else files[child] = 'non-file';
    }
  };
  await walk('');
  return hashValue(files);
}

const exists = async (file: string) => { try { await lstat(file); return true; } catch { return false; } };
type Classification = { run_id: string; attempt: number; class: 'infrastructure'; cause: string; evidence: string[]; classified_by: 'owner'; date: string };

interface Opened { context: Context; identity: { id: string; hash: string }; blocked: (d: Diagnostic[]) => Result; classification: Classification; source: Buffer }

/** Shared preconditions of `rerun` and `classify`: a version 2 plan, unchanged, not yet scored,
 * and a valid owner classification of an infrastructure failure.
 */
async function openAttempt(command: string, runIdArg: string, planFile: string, root: string, work: string | undefined, classificationFile: string, repos?: string): Promise<{ opened?: Opened; result?: Result }> {
  const o = await open(command, planFile, root, work, { repos, gates: ['canonical', 'frozen'] });
  if (!o.context) return { result: o.result! };
  const context = o.context;
  const { plan, where } = context;
  const identity = { id: plan.spec.id, hash: plan.hash };
  const blocked = (diagnostics: Diagnostic[]): Result => ({ command, outcome: 'blocked', plan: identity, diagnostics, run_id: runIdArg });
  if (plan.version !== 2) return { result: blocked([{ code: 'BENCH_RERUN_UNSUPPORTED', path: runIdArg, message: 'Preserved attempts and reruns apply to version 2 plans; a version 1 run is removed and prepared again.' }]) };
  const changed = await planChanges(context);
  if (changed.length) return { result: blocked(changed) };
  let analysed: string[] = [];
  try { analysed = await readdir(where.analysis); } catch { /* Nothing scored. */ }
  if (analysed.length) return { result: blocked([{ code: 'BENCH_RERUN_AFTER_SCORING', path: path.relative(where.root, where.analysis).replace(/\\/g, '/'), message: 'Scores or analysis already exist for this plan; attempts are classified before any score is seen.' }]) };
  const manifest = await loadManifest(context);
  if (!manifest?.runs.some(r => r.run_id === runIdArg)) return { result: blocked([{ code: 'BENCH_RUN_UNKNOWN', path: runIdArg, message: `${runIdArg} is not a prepared run of this plan.` }]) };
  const label = path.basename(classificationFile);
  const { data, diagnostics } = await readJson(path.resolve(classificationFile), label);
  if (diagnostics.length) return { result: blocked(diagnostics.map(d => ({ ...d, code: 'BENCH_ATTEMPT_CLASSIFICATION_INVALID' }))) };
  const schema = schemaDiagnostics('attempt-classification', data, label, 'BENCH_ATTEMPT_CLASSIFICATION_INVALID');
  if (schema.length) return { result: blocked(schema) };
  const classification = data as Classification;
  if (classification.run_id !== runIdArg) return { result: blocked([{ code: 'BENCH_ATTEMPT_CLASSIFICATION_INVALID', path: label, message: `The classification must name ${runIdArg}.` }]) };
  return { opened: { context, identity, blocked, classification, source: await readFile(path.resolve(classificationFile)) } };
}

async function evidenceHashes(base: string, classification: Classification, label: string): Promise<{ hashes?: string[]; diagnostics?: Diagnostic[] }> {
  const hashes: string[] = [];
  for (const reference of classification.evidence) {
    let relative: string;
    try { relative = relativePath(reference); } catch { return { diagnostics: [{ code: 'BENCH_ATTEMPT_CLASSIFICATION_INVALID', path: label, field: '/evidence', message: `${reference} must be a portable path inside the run directory.` }] }; }
    try { hashes.push(sha256(await readFile(path.join(base, ...relative.split('/'))))); } catch {
      return { diagnostics: [{ code: 'BENCH_ATTEMPT_CLASSIFICATION_INVALID', path: label, field: '/evidence', message: `${reference} is not a file in the run directory.` }] };
    }
  }
  return { hashes: hashes.sort(compare) };
}

async function appendLog(context: Context, runId: string, entry: AttemptEntry): Promise<Diagnostic[]> {
  const { logs, refused } = await loadAttempts(context);
  if (refused.length) return refused;
  const log: AttemptsLog = { kind: 'keystone-bench-attempts', schema_version: 1, plan: { id: context.plan.spec.id, hash: context.plan.hash }, run_id: runId, attempts: [...(logs.get(runId)?.attempts ?? []), entry] };
  const failure = await writeVerified(attemptsFile(context, runId), sealRecord(log as unknown as Record<string, unknown>), context.where.boundaries.results);
  return failure?.diagnostics ?? [];
}

/** `keystone-bench rerun <run-id> --plan <plan> --classification <file>`: archives an
 * infrastructure-failed attempt (moved, never deleted) and re-prepares the same planned run as the
 * next attempt. Version 2 plans only; refused once any score or analysis exists. An interrupted
 * transition (the run directory already archived, the log not yet written) is resumed by running
 * the same command again; it never restarts the numbering.
 */
export async function rerun(runIdArg: string, planFile: string, root: string, work: string | undefined, classificationFile: string, repos?: string): Promise<Result> {
  const { opened, result } = await openAttempt('rerun', runIdArg, planFile, root, work, classificationFile, repos);
  if (!opened) return result!;
  const { context, identity, blocked, classification, source } = opened;
  const { plan, where } = context;
  const label = path.basename(classificationFile);
  const paths = runPaths(where, runIdArg);
  const { logs, refused } = await loadAttempts(context);
  if (refused.length) return blocked(refused);
  const logged = logs.get(runIdArg)?.attempts ?? [];
  if (logged.some(e => e.terminal)) return blocked([{ code: 'BENCH_ATTEMPT_TERMINAL', path: runIdArg, message: 'The run was classified as a terminal infrastructure failure.' }]);
  const archived = await archivedAttempts(context, runIdArg);
  const state = await readJsonFile<RunState & { started_at?: string }>(paths.state);
  // Resume: the run directory was archived but the transition did not complete.
  const resuming = !state && archived.length === logged.length + 1 && archived.at(-1) === archived.length;
  if (!resuming) {
    if (!state) return blocked([{ code: 'BENCH_RUN_NOT_PREPARED', path: runIdArg, message: 'The run has no prepared workspace.' }]);
    if (state.status === 'prepared') return blocked([{ code: 'BENCH_RERUN_NOT_STARTED', path: runIdArg, message: 'The run has not started; there is no attempt to archive.' }]);
    if (archived.length !== logged.length || (state.attempt ?? 1) !== archived.length + 1) {
      return blocked([{ code: 'BENCH_ATTEMPT_HISTORY_INCOMPLETE', path: runIdArg, message: `The run's state names attempt ${state.attempt ?? 1}, but ${archived.length} attempt(s) are archived and ${logged.length} logged.` }]);
    }
  }
  const attempt = resuming ? archived.length : state!.attempt ?? 1;
  if (classification.attempt !== attempt) return blocked([{ code: 'BENCH_ATTEMPT_CLASSIFICATION_INVALID', path: label, message: `The classification must name ${runIdArg}, attempt ${attempt}.` }]);
  const allowed = plan.spec.limits.max_infrastructure_reruns ?? 0;
  if (attempt - 1 >= allowed) return blocked([{ code: 'BENCH_RERUN_EXHAUSTED', path: runIdArg, message: `The plan allows ${allowed} infrastructure rerun(s) per run; attempt ${attempt} was the last allowed. Record it with keystone-bench classify; it stays missing.` }]);
  const archive = path.join(archiveRoot(context, runIdArg), String(attempt));
  const evidence = await evidenceHashes(resuming ? archive : paths.base, classification, label);
  if (!evidence.hashes) return blocked(evidence.diagnostics!);
  const started = resuming ? (await readJsonFile<{ started_at?: string }>(path.join(archive, 'harness', 'state.json')))?.started_at : state!.started_at;

  // Move, never delete: the whole run directory, then any installed record, into the archive.
  if (!resuming) {
    try {
      await guard(where.boundaries.work, archive);
      if (await exists(archive)) return blocked([{ code: 'BENCH_ATTEMPT_HISTORY_INCOMPLETE', path: runIdArg, message: `Attempt ${attempt} already has an archive.` }]);
      await mkdir(path.dirname(archive), { recursive: true });
      await guard(where.boundaries.work, paths.base);
      await guard(where.boundaries.work, archive);
      await rename(paths.base, archive);
    } catch (error) {
      return { command: 'rerun', outcome: 'failed', plan: identity, diagnostics: [{ code: 'BENCH_ATTEMPT_ARCHIVE_FAILED', path: runIdArg, message: `The attempt could not be moved to its archive (${(error as Error).message}); nothing was removed.` }], run_id: runIdArg };
    }
  }
  const failed = (diagnostics: Diagnostic[]): Result => ({ command: 'rerun', outcome: 'failed', plan: identity, diagnostics: [...diagnostics, { code: 'BENCH_ATTEMPT_HISTORY_INCOMPLETE', path: runIdArg, message: 'The attempt is archived but the transition is incomplete; run the same rerun command again to complete it.' }], run_id: runIdArg });
  const preserved = await preserveRecord(context, archive, runIdArg, attempt);
  if ('diagnostics' in preserved) return failed(preserved.diagnostics);
  const recordArchived = preserved.archived;
  const kept = await writeVerified(path.join(archive, 'classification.json'), source, where.boundaries.work);
  if (kept) return failed(kept.diagnostics);
  const logged2 = await appendLog(context, runIdArg, {
    attempt, terminal: false, started_at: started ?? null, archived_at: new Date().toISOString(),
    classification: { class: classification.class, cause: classification.cause, classified_by: classification.classified_by, date: classification.date },
    evidence_hashes: evidence.hashes, archive_hash: await archiveHash(archive), record_archived: recordArchived,
  });
  if (logged2.length) return failed(logged2);
  // From here the history is consistent: a failed preparation is retried by prepare, as attempt n+1.
  const prepared = await prepareRun(context, { ...(await loadManifest(context))!.runs.find(r => r.run_id === runIdArg)! }, attempt + 1);
  if (prepared) return { command: 'rerun', outcome: 'failed', plan: identity, diagnostics: prepared, run_id: runIdArg };
  return { command: 'rerun', outcome: 'prepared', plan: identity, diagnostics: [], run_id: runIdArg, attempt: attempt + 1, archive, resumed: resuming, work: where.work };
}

/** Reads a path's bytes only when it is a regular file (not a directory, link or other entry). */
async function regularFileBytes(file: string): Promise<Buffer | 'absent' | 'conflict'> {
  let stat;
  try { stat = await lstat(file); } catch { return 'absent'; }
  if (!stat.isFile()) return 'conflict';
  try { return await readFile(file); } catch { return 'conflict'; }
}

/** Preserves an installed run record in the attempt archive, truthfully (review blocker 2):
 * - the installed record is removed only after its exact bytes are verified at the archive
 *   destination;
 * - an existing destination is trusted only when it is a regular file with exactly those bytes;
 *   any other entry, or different content, fails safely and leaves the original in place;
 * - when recovering a transition whose original was already removed, the archived copy must be an
 *   intact sealed run record of this run, plan and attempt;
 * - `archived` is true only when preservation is established; false only when no record was ever
 *   installed for the attempt.
 */
async function preserveRecord(context: Context, archive: string, runId: string, attempt: number): Promise<{ archived: boolean } | { diagnostics: Diagnostic[] }> {
  const { where, plan } = context;
  const recordFile = path.join(where.results, 'runs', `${runId}.json`);
  const destination = path.join(archive, 'record.json');
  const conflict = (message: string): { diagnostics: Diagnostic[] } => ({ diagnostics: [{ code: 'BENCH_ATTEMPT_ARCHIVE_CONFLICT', path: destination, message }] });
  const installed = await regularFileBytes(recordFile);
  if (installed === 'conflict') return conflict('The installed run record is not a regular file; nothing was removed.');
  let archived = await regularFileBytes(destination);
  if (installed === 'absent') {
    if (archived === 'absent') return { archived: false };
    if (archived === 'conflict') return conflict('The archive destination for the run record is not a regular file.');
    // Recovery: the original is gone; the archived copy must be this attempt's intact record.
    let record: Record<string, any> | undefined;
    try { record = JSON.parse(archived.toString('utf8')); } catch { /* Reported below. */ }
    const valid = !!record && record.kind === 'keystone-bench-run-record' && record.evidence_hash === evidenceHash(record) &&
      record.run_id === runId && record.plan?.hash === plan.hash && (record.provenance?.attempt ?? 1) === attempt;
    return valid ? { archived: true } : conflict('The archived run record is not an intact record of this run, plan and attempt.');
  }
  if (archived === 'conflict') return conflict('The archive destination for the run record is not a regular file; the installed record was left in place.');
  if (archived !== 'absent' && !archived.equals(installed)) return conflict('The archive destination holds different content; the installed record was left in place.');
  if (archived === 'absent') {
    const copied = await writeVerified(destination, installed, where.boundaries.work);
    if (copied) return { diagnostics: copied.diagnostics };
    archived = await regularFileBytes(destination);
    if (archived === 'absent' || archived === 'conflict' || !archived.equals(installed)) return conflict('The archived copy could not be verified; the installed record was left in place.');
  }
  // Preservation is established: only now is the installed original removed.
  await guard(where.boundaries.results, recordFile);
  await unlink(recordFile);
  return { archived: true };
}

/** `keystone-bench classify <run-id> --plan <plan> --classification <file>`: records an
 * infrastructure failure whose reruns are exhausted as terminal. The attempt stays in place; the run
 * is missing for analysis and counts as an infrastructure failure for calibration. Refused while a
 * rerun is still allowed, and once any score or analysis exists.
 */
export async function classify(runIdArg: string, planFile: string, root: string, work: string | undefined, classificationFile: string, repos?: string): Promise<Result> {
  const { opened, result } = await openAttempt('classify', runIdArg, planFile, root, work, classificationFile, repos);
  if (!opened) return result!;
  const { context, identity, blocked, classification } = opened;
  const label = path.basename(classificationFile);
  const paths = runPaths(context.where, runIdArg);
  const state = await readJsonFile<RunState & { started_at?: string }>(paths.state);
  const history = await nextAttempt(context, runIdArg);
  if ('diagnostics' in history) return blocked(history.diagnostics);
  if (!state) return blocked([{ code: 'BENCH_RUN_NOT_PREPARED', path: runIdArg, message: 'The run has no prepared workspace.' }]);
  if (state.status === 'prepared') return blocked([{ code: 'BENCH_RERUN_NOT_STARTED', path: runIdArg, message: 'The run has not started; there is no attempt to classify.' }]);
  const attempt = state.attempt ?? 1;
  if (attempt !== history.attempt) return blocked([{ code: 'BENCH_ATTEMPT_HISTORY_INCOMPLETE', path: runIdArg, message: `The run's state names attempt ${attempt}, but its history implies attempt ${history.attempt}.` }]);
  if (classification.attempt !== attempt) return blocked([{ code: 'BENCH_ATTEMPT_CLASSIFICATION_INVALID', path: label, message: `The classification must name ${runIdArg}, attempt ${attempt}.` }]);
  const allowed = context.plan.spec.limits.max_infrastructure_reruns ?? 0;
  if (attempt - 1 < allowed) return blocked([{ code: 'BENCH_RERUN_AVAILABLE', path: runIdArg, message: `A rerun is still allowed (${attempt - 1} of ${allowed} used); use keystone-bench rerun.` }]);
  const evidence = await evidenceHashes(paths.base, classification, label);
  if (!evidence.hashes) return blocked(evidence.diagnostics!);
  const kept = await writeVerified(path.join(context.where.work, 'attempts', runIdArg, `terminal-${attempt}.classification.json`), opened.source, context.where.boundaries.work);
  if (kept) return { command: 'classify', outcome: 'failed', plan: identity, diagnostics: kept.diagnostics, run_id: runIdArg };
  const logged = await appendLog(context, runIdArg, {
    attempt, terminal: true, started_at: state.started_at ?? null, archived_at: new Date().toISOString(),
    classification: { class: classification.class, cause: classification.cause, classified_by: classification.classified_by, date: classification.date },
    evidence_hashes: evidence.hashes, archive_hash: null, record_archived: false,
  });
  if (logged.length) return { command: 'classify', outcome: 'failed', plan: identity, diagnostics: logged, run_id: runIdArg };
  return { command: 'classify', outcome: 'classified', plan: identity, diagnostics: [], run_id: runIdArg, attempt };
}
