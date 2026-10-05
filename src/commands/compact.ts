import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { compare, KeystoneError, serialize, sortDiagnostics, type Diagnostic } from '../core.js';
import { repositoryRoot, safePath } from '../paths.js';
import { retireText } from '../compaction/edit.js';
import { retired } from '../context/selection.js';
import { binding, compactionReport, type CompactionReport } from '../compaction/report.js';
import { missingProvenance } from '../compaction/provenance.js';
import { inspect, type Inspection } from './index.js';

export type CompactOutcome = 'reported' | 'compacted' | 'unchanged' | 'blocked' | 'failed';
export interface RetireRequest { id: string; reason: string; by?: string }
export interface CompactOptions { task?: string; retire?: RetireRequest[] }
export interface CompactPlan {
  outcome: CompactOutcome; task_id: string | null; diagnostics: Diagnostic[];
  retired: string[]; unchanged: string[]; report: CompactionReport | null;
  writes: { path: string; contents: string }[];
}
export interface CompactResult extends Omit<CompactPlan, 'writes'> {
  written: string[];
  /** Files left changed because restoration failed or could not be verified. */
  unrestored: string[];
  /** Temporary files that could not be removed. */
  temporary_files: string[];
}

const outcomeOf = (outcome: CompactOutcome, taskId: string | null, diagnostics: Diagnostic[], extra: Partial<CompactPlan> = {}): CompactPlan => ({
  outcome, task_id: taskId, diagnostics: sortDiagnostics([...new Map(diagnostics.map(d => [serialize(d), d])).values()]),
  retired: [], unchanged: [], report: null, writes: [], ...extra,
});
/** Exact UTF-8 text, keeping any BOM so unrelated bytes are written back unchanged. */
function decode(bytes: Buffer): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return text.includes('\0') ? null : text;
  } catch { return null; }
}
const usage = (message: string) => outcomeOf('failed', null, [{ code: 'CLI_USAGE', path: '.', message }]);
const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, i) => value === b[i]);

/** Evaluates COMPACT completely without writing anything. */
export async function prepareCompact(input: string, options: CompactOptions = {}): Promise<CompactPlan> {
  const requests = [...(options.retire ?? [])].sort((a, b) => compare(a.id, b.id));
  const taskId = options.task;
  if (requests.length && (taskId === undefined || !taskId.trim())) return usage('Retirement operations require --task <TASK-ID>.');
  if (!requests.length && taskId !== undefined) return usage('--task applies only to retirement operations.');
  if (requests.some(r => !r.reason?.trim())) return usage('Each --retire requires a non-blank --reason.');
  if (new Set(requests.map(r => r.id)).size !== requests.length) return usage('Each ID may be retired once per run.');
  const diagnostics: Diagnostic[] = [];
  try {
    const root = await repositoryRoot(input);
    let working: Inspection;
    try { working = await inspect(root); } catch (error) {
      return outcomeOf('failed', taskId ?? null, [{ code: 'COMPACT_INVENTORY_UNREADABLE', path: '.', message: `Working-tree inventory cannot be read (${error instanceof KeystoneError ? error.diagnostic.code : 'IO_ERROR'}).` }]);
    }
    if (working.diagnostics.length) {
      return outcomeOf('failed', taskId ?? null, [{ code: 'COMPACT_VALIDATION_FAILED', path: '.', message: 'The working tree fails structural validation.' }, ...working.diagnostics]);
    }
    const { artifacts, links } = working.index;
    const report = compactionReport(artifacts, links);
    if (!requests.length) return outcomeOf('reported', null, [], { report });

    const byId = new Map(artifacts.map(a => [a.id, a]));
    const task = artifacts.find(a => a.type === 'task' && a.id === taskId);
    if (!task) return outcomeOf('blocked', taskId!, [{ code: 'COMPACT_TASK_INVALID', path: '.', message: `No task has ID ${taskId}.` }], { report });
    if (task.metadata.status !== 'active') {
      return outcomeOf('blocked', task.id, [{ code: 'COMPACT_TASK_INVALID', path: task.path, message: `${task.id} has status ${String(task.metadata.status)}; retirement requires an active task.` }], { report });
    }

    const retiring = new Set(requests.map(r => r.id));
    const successorsOf = (id: string) => links.filter(l => l.source === id && l.field === 'superseded_by').map(l => l.target);
    const blocked: Diagnostic[] = [];
    const writes: CompactPlan['writes'] = [];
    const unchanged: string[] = [];
    const retiredIds: string[] = [];
    for (const request of requests) {
      const reason = request.reason.trim();
      const invalid = (why: string) => blocked.push({ code: 'COMPACT_RETIREMENT_INVALID', path: request.id, message: `${request.id} cannot be retired: ${why}.` });
      const artifact = byId.get(request.id);
      if (!artifact) { invalid('no such artifact'); continue; }
      if (artifact.type !== 'learning' && artifact.type !== 'trap') { invalid(`${artifact.type} artifacts are never retired by COMPACT`); continue; }
      const successors = request.by === undefined ? [] : [request.by];
      if (retired(artifact)) {
        const record = artifact.metadata.retirement as { task?: string; reason?: string };
        const declared = Array.isArray(artifact.metadata.superseded_by) ? artifact.metadata.superseded_by as string[] : [];
        if (record.task === task.id && record.reason === reason && same(declared, successors)) unchanged.push(artifact.id);
        else blocked.push({ code: 'COMPACT_ALREADY_RETIRED', path: artifact.path, message: `${artifact.id} is already retired with a different record; retirement is terminal.` });
        continue;
      }
      if (request.by !== undefined) {
        const successor = byId.get(request.by);
        if (!successor) { invalid(`successor ${request.by} does not exist`); continue; }
        if (successor.id === artifact.id) { invalid('an artifact cannot succeed itself'); continue; }
        if (successor.type !== artifact.type) { invalid(`successor ${successor.id} is a ${successor.type}, not a ${artifact.type}`); continue; }
        if (retiring.has(successor.id)) { invalid(`successor ${successor.id} is itself being retired in this run`); continue; }
        if (!binding(successor)) {
          invalid(`successor ${successor.id} is not eligible (${artifact.type === 'learning' ? 'an accepted learning' : 'an active trap with severity medium'} is required)`);
          continue;
        }
        const chain = new Set<string>();
        const pending = [successor.id];
        while (pending.length) { const id = pending.pop()!; if (!chain.has(id)) { chain.add(id); pending.push(...successorsOf(id)); } }
        if (chain.has(artifact.id)) { invalid(`successor ${successor.id} would form a supersession cycle`); continue; }
        const missing = missingProvenance(artifact, successor, links);
        if (missing.length) { invalid(`successor ${successor.id} does not contain its provenance (${missing.join('; ')})`); continue; }
      }
      const text = decode(await readFile(await safePath(root, artifact.path)));
      if (text === null) { invalid('it is not valid UTF-8 text'); continue; }
      retiredIds.push(artifact.id);
      writes.push({ path: artifact.path, contents: retireText(text, artifact.path, {
        retirement: { task: task.id, reason, previous_status: String(artifact.metadata.status) },
        ...(successors.length ? { superseded_by: successors } : {}),
      }) });
      if (!successors.length) {
        // Binding knowledge removed without a successor stays visible (owner decision I1).
        const predecessors = artifacts.filter(a => retired(a) && successorsOf(a.id).includes(artifact.id)).map(a => a.id).sort(compare);
        if (binding(artifact) || predecessors.length) {
          diagnostics.push({ code: 'COMPACT_BINDING_REMOVAL', path: artifact.path, message: `${artifact.id} is retired without a successor${binding(artifact) ? '; its binding knowledge is removed' : ''}${predecessors.length ? `; it ends the successor chain of ${predecessors.join(', ')}` : ''}.` });
        }
      }
    }
    if (blocked.length) return outcomeOf('blocked', task.id, blocked, { report });
    if (!writes.length) return outcomeOf('unchanged', task.id, [], { unchanged, report });
    diagnostics.push({ code: 'COMPACT_INDEX_UPDATE_REQUIRED', path: 'context', message: 'COMPACT does not edit navigation; update hand-maintained indexes if they list the retired knowledge.' });
    return outcomeOf('compacted', task.id, diagnostics, { retired: retiredIds, unchanged, report, writes });
  } catch (error) {
    return outcomeOf('failed', taskId ?? null, [...diagnostics, error instanceof KeystoneError ? error.diagnostic : { code: 'IO_ERROR', path: '.', message: 'Cannot evaluate COMPACT.' }]);
  }
}

/**
 * Evaluates COMPACT and, only when every check passes, writes the retired artifacts all-or-nothing.
 * On failure every renamed file is restored from its original bytes and verified, and every temporary
 * file is removed. Anything that cannot be recovered is reported explicitly, never claimed restored.
 */
export async function compact(input: string, options: CompactOptions = {}): Promise<CompactResult> {
  const { writes, ...plan } = await prepareCompact(input, options);
  const none = { written: [], unrestored: [], temporary_files: [] };
  if (plan.outcome !== 'compacted') return { ...plan, ...none };
  const root = await repositoryRoot(input);
  const originals = new Map<string, Buffer>();
  // Repository-relative temporary path -> absolute path, registered before each write.
  const temporary = new Map<string, string>();
  const renamed: string[] = [];
  const stage = async (file: string, contents: string | Buffer): Promise<string> => {
    const destination = await safePath(root, file);
    const name = `.${path.posix.basename(file)}.compact-${randomUUID()}.tmp`;
    const absolute = path.join(path.dirname(destination), name);
    temporary.set(path.posix.join(path.posix.dirname(file), name), absolute);
    await writeFile(absolute, contents, typeof contents === 'string' ? { encoding: 'utf8', flag: 'wx' } : { flag: 'wx' });
    return absolute;
  };
  const settle = (absolute: string) => { for (const [key, value] of temporary) if (value === absolute) temporary.delete(key); };
  try {
    for (const write of writes) originals.set(write.path, await readFile(await safePath(root, write.path)));
    const staged = new Map<string, string>();
    for (const write of writes) staged.set(write.path, await stage(write.path, write.contents));
    for (const write of writes) {
      await rename(staged.get(write.path)!, await safePath(root, write.path));
      settle(staged.get(write.path)!);
      renamed.push(write.path);
    }
    const after = await inspect(root);
    const written = new Set(writes.map(w => w.path));
    if (after.diagnostics.length || !after.index.artifacts.filter(a => written.has(a.path)).every(retired)) throw new Error('post-write validation failed');
    return { ...plan, ...none, report: compactionReport(after.index.artifacts, after.index.links), written: writes.map(w => w.path) };
  } catch { /* Recover below. */ }

  const unrestored: string[] = [];
  for (const file of [...renamed].reverse()) {
    try {
      const original = originals.get(file)!;
      const restoring = await stage(file, original);
      await rename(restoring, await safePath(root, file));
      settle(restoring);
      if (!(await readFile(await safePath(root, file))).equals(original)) throw new Error('restoration not verified');
    } catch { unrestored.push(file); }
  }
  const remaining: string[] = [];
  for (const [file, absolute] of [...temporary].sort(([a], [b]) => compare(a, b))) {
    try { await unlink(absolute); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') remaining.push(file); }
  }
  const recovered = !unrestored.length && !remaining.length;
  const diagnostics: Diagnostic[] = [...plan.diagnostics, {
    code: 'COMPACT_WRITE_FAILED', path: '.',
    message: recovered
      ? 'COMPACT could not complete; every original file was restored and verified, and no temporary file remains.'
      : 'COMPACT could not complete and recovery is incomplete; the state listed in the other diagnostics needs manual repair.',
  }];
  for (const file of unrestored) diagnostics.push({ code: 'COMPACT_ROLLBACK_INCOMPLETE', path: file, message: 'This file could not be restored to its original bytes and may contain the retirement edit.' });
  for (const file of remaining) diagnostics.push({ code: 'COMPACT_TEMPORARY_FILE_REMAINS', path: file, message: 'This temporary file could not be removed.' });
  return { ...plan, outcome: 'failed', written: [], unrestored: unrestored.sort(compare), temporary_files: remaining, diagnostics: sortDiagnostics(diagnostics) };
}
