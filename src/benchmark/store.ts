import { lstat, mkdir, readdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compare, serialize, type Diagnostic } from '../core.js';
import { hashValue, schemaDiagnostics, type LoadedPlan } from './specs.js';

/** The physical location of a path: the real path of its nearest existing ancestor, so junctions,
 * symbolic links and other filesystem aliases cannot disguise where it is (review B2).
 */
export async function physical(input: string): Promise<string> {
  const absolute = path.resolve(input);
  const rest: string[] = [];
  let current = absolute;
  for (;;) {
    try { return path.join(await realpath(current), ...rest.reverse()); } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

/** True when `child` is `parent` or inside it, compared lexically (case-insensitively on Windows).
 * Callers compare physical paths.
 */
export function within(parent: string, child: string): boolean {
  const norm = (p: string) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
  const relative = path.relative(norm(parent), norm(child));
  return relative === '' || !relative.startsWith('..') && !path.isAbsolute(relative);
}

export interface Locations { root: string; work: string; results: string; analysis: string; runs: string; subject: string; plans: string; boundaries: Boundaries }

/** A write boundary: every destination the harness writes, removes, or launches a process in must
 * physically lie inside `base`, be reached from `base` through no symbolic link or junction, and
 * neither lie in nor contain a forbidden location (TASK-0013 review round 2). Checked at the point
 * of use, not once per command, so a substitution after earlier validation is refused.
 */
export interface Boundary { base: string; forbidden: string[]; code: string; what: string }
export interface Boundaries { work: Boundary; results: Boundary; analysis: Boundary; plans: Boundary }

export class BoundaryError extends Error {
  constructor(public readonly diagnostic: Diagnostic) { super(diagnostic.message); this.name = 'BoundaryError'; }
}

/** Guards a directory the harness operates on as a whole (the snapshot repository): the directory
 * itself, and no symbolic link or junction anywhere inside it.
 */
export async function guardTree(boundary: Boundary, directory: string): Promise<void> {
  await guard(boundary, directory);
  const walk = async (current: string): Promise<void> => {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new BoundaryError({ code: boundary.code, path: child, message: `${boundary.what} destination refused: a symbolic link or junction lies inside ${directory}.` });
      if (entry.isDirectory()) await walk(child);
    }
  };
  await walk(directory);
}

export async function guard(boundary: Boundary, target: string): Promise<void> {
  const refuse = (why: string) => { throw new BoundaryError({ code: boundary.code, path: target, message: `${boundary.what} destination refused: ${why}.` }); };
  if (!within(boundary.base, target)) refuse('it is outside its boundary');
  if ((await aliases(boundary.base, target)).length) refuse('a symbolic link or junction lies on its path');
  const [base, destination] = await Promise.all([physical(boundary.base), physical(target)]);
  if (!within(base, destination)) refuse('it lies physically outside its boundary');
  for (const forbidden of boundary.forbidden) {
    const location = await physical(forbidden);
    if (within(location, destination) || within(destination, location)) refuse('it lies physically in, or contains, the subject, the Keystone tree or the work directory');
  }
}

/** Workspaces and harness state live outside both the Keystone working tree and the subject. Smoke
 * plans keep their records in the work directory: a smoke run is never benchmark evidence.
 */
export function locations(plan: LoadedPlan, root: string, work?: string): Locations {
  const where = baseLocations(plan, root, work);
  const subject = plan.subjectPath;
  const smoke = plan.spec.purpose === 'smoke';
  // A version 2 benchmark repository is only ever read: no harness write may reach it.
  const bench = plan.benchmark ? [plan.benchmark.path] : [];
  const work_: Boundary = { base: where.work, forbidden: [subject, where.root, ...bench], code: 'BENCH_WORK_INVALID', what: 'Work' };
  const durable = (what: string): Boundary => smoke ? { ...work_, what } : { base: where.root, forbidden: [subject, where.work, ...bench], code: 'BENCH_RESULTS_INVALID', what };
  const plans = path.join(where.root, 'benchmark', 'plans', plan.spec.id);
  return {
    ...where, subject, plans,
    boundaries: { work: work_, results: durable('Result'), analysis: durable('Analysis'), plans: { base: where.root, forbidden: [subject, where.work, ...bench], code: 'BENCH_RESULTS_INVALID', what: 'Plan freeze record' } },
  };
}

function baseLocations(plan: LoadedPlan, root: string, work?: string) {
  const workDir = path.resolve(work ?? path.join(tmpdir(), 'keystone-bench', plan.spec.id));
  const smoke = plan.spec.purpose === 'smoke';
  return {
    root: path.resolve(root), work: workDir, runs: path.join(workDir, 'runs'),
    results: smoke ? path.join(workDir, 'smoke', 'results') : path.join(path.resolve(root), 'benchmark', 'results', plan.spec.id),
    analysis: smoke ? path.join(workDir, 'smoke', 'analysis') : path.join(path.resolve(root), 'benchmark', 'analysis', plan.spec.id),
  };
}

/** Existing path components from `base` down to `target` that are symbolic links or junctions. */
async function aliases(base: string, target: string): Promise<string[]> {
  const found: string[] = [];
  let current = base;
  for (const segment of path.relative(base, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try { if ((await lstat(current)).isSymbolicLink()) found.push(current); } catch { break; }
  }
  return found;
}

/** Physical containment checks for work, results and analysis (review B2). Pathname checks are not
 * race-safe, as for every Keystone command (docs/PHASE-0-1.md).
 */
export async function locationDiagnostics(plan: LoadedPlan, where: Locations): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const [root, work, subject] = await Promise.all([physical(where.root), physical(where.work), physical(plan.subjectPath)]);
  if (within(root, work)) diagnostics.push({ code: 'BENCH_WORK_INVALID', path: where.work, message: 'The work directory must be physically outside the Keystone working tree.' });
  if (within(subject, work) || within(work, subject)) diagnostics.push({ code: 'BENCH_WORK_INVALID', path: where.work, message: 'The work directory and the subject repository must not physically contain each other.' });
  if (plan.benchmark) {
    const bench = await physical(plan.benchmark.path);
    if (within(bench, work) || within(work, bench)) diagnostics.push({ code: 'BENCH_WORK_INVALID', path: where.work, message: 'The work directory and the benchmark repository must not physically contain each other.' });
    if (within(bench, subject) || within(subject, bench)) diagnostics.push({ code: 'BENCH_WORK_INVALID', path: plan.benchmark.id, message: 'The subject and benchmark repositories must not physically contain each other.' });
  }
  // Run directories are created and, after a failed preparation, removed: never through an alias.
  if ((await aliases(where.work, path.join(where.runs, 'x'))).length) diagnostics.push({ code: 'BENCH_WORK_INVALID', path: where.runs, message: 'The runs directory inside the work directory must not be a symbolic link or junction.' });
  if (plan.spec.purpose !== 'smoke') {
    for (const directory of [where.results, where.analysis]) {
      const linked = await aliases(where.root, directory);
      const target = await physical(directory);
      if (linked.length || !within(root, target) || within(subject, target) || within(target, subject) || within(work, target)) {
        diagnostics.push({ code: 'BENCH_RESULTS_INVALID', path: directory, message: `${path.relative(where.root, directory).replace(/\\/g, '/')} must be a real directory inside the Keystone tree, reached through no symbolic link or junction, and outside the subject and work directory.` });
      }
    }
  }
  return diagnostics;
}

export interface WriteFailure { diagnostics: Diagnostic[]; temporary_files: string[] }

/** Writes a fresh temporary file, verifies its bytes, and only then renames it over the target, so
 * nothing unverified is ever installed under the target name. Renaming replaces the directory entry,
 * so a pre-existing target that is a hard link into a protected repository is never written
 * through (review round 3). A temporary file that may exist
 * after a failure (including a partial write) is removed, or reported when it cannot be (review B4).
 */
export async function writeVerified(file: string, contents: string | Buffer, boundary: Boundary): Promise<WriteFailure | null> {
  const expected = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8');
  const same = async (target: string) => expected.equals(Buffer.from(await readFile(target)));
  const temporary = `${file}.tmp-${randomUUID()}`;
  let mayExist = false;
  let installed = false;
  try {
    await guard(boundary, file);
    await mkdir(path.dirname(file), { recursive: true });
    await guard(boundary, file);
    mayExist = true;
    await writeFile(temporary, contents, { flag: 'wx' });
    if (!(await same(temporary))) throw new Error('verification');
    await guard(boundary, file);
    await rename(temporary, file);
    mayExist = false;
    installed = true;
    if (!(await same(file))) throw new Error('verification');
    return null;
  } catch (error) {
    const left: string[] = [];
    if (mayExist) {
      try { await unlink(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') left.push(temporary); }
    }
    return {
      diagnostics: [
        error instanceof BoundaryError ? error.diagnostic : installed
          ? { code: 'BENCH_WRITE_UNVERIFIED', path: file, message: 'The file was installed but its contents could not be verified afterwards; treat it as unverified.' }
          : { code: 'BENCH_WRITE_FAILED', path: file, message: 'The file could not be written and verified; nothing was installed under its name.' },
        ...left.map(t => ({ code: 'BENCH_TEMPORARY_FILE_REMAINS', path: t, message: 'A temporary file could not be removed.' })),
      ],
      temporary_files: left,
    };
  }
}

export async function readJsonFile<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return undefined; }
}

export const evidenceHash = (record: Record<string, unknown>) => {
  const { evidence_hash: _ignored, ...rest } = record;
  return hashValue(rest);
};

export function sealRecord<T extends Record<string, unknown>>(record: T): string {
  return serialize({ ...record, evidence_hash: evidenceHash(record) });
}

export interface StoredRecord { file: string; record: Record<string, any> }

/** Loads run records for a plan, refusing invalid, tampered, mismatched or smoke records. */
export async function loadRecords(plan: LoadedPlan, where: Locations): Promise<{ records: StoredRecord[]; refused: Diagnostic[] }> {
  const directory = path.join(where.results, 'runs');
  let names: string[] = [];
  try { names = (await readdir(directory)).filter(n => n.endsWith('.json')).sort(compare); } catch { /* No runs yet. */ }
  const records: StoredRecord[] = [];
  const refused: Diagnostic[] = [];
  for (const name of names) {
    const file = path.join(directory, name);
    const record = await readJsonFile<Record<string, any>>(file);
    const label = path.relative(where.root, file).replace(/\\/g, '/');
    const reject = (code: string, message: string) => refused.push({ code, path: label, message });
    if (!record) { reject('BENCH_RESULT_INVALID', 'Run record is not readable JSON.'); continue; }
    if (schemaDiagnostics('run-record', record, label, 'BENCH_RESULT_INVALID').length) { reject('BENCH_RESULT_INVALID', 'Run record does not match the run record schema.'); continue; }
    if (record.schema_version !== plan.version) { reject('BENCH_RESULT_INVALID', `A version ${plan.version} plan reads only version ${plan.version} run records.`); continue; }
    if (record.evidence_hash !== evidenceHash(record)) { reject('BENCH_RESULT_EVIDENCE_MISMATCH', 'Run record content does not match its evidence hash.'); continue; }
    if (record.purpose === 'smoke' && plan.spec.purpose !== 'smoke') { reject('BENCH_SMOKE_NOT_EVIDENCE', 'A smoke run record is never benchmark evidence.'); continue; }
    if (record.plan.id !== plan.spec.id || record.plan.hash !== plan.hash) { reject('BENCH_PLAN_MISMATCH', `Run record was made under plan hash ${record.plan.hash}; the plan now hashes to ${plan.hash}.`); continue; }
    if (name !== `${record.run_id}.json`) { reject('BENCH_RESULT_INVALID', 'Run record file name does not match its run ID.'); continue; }
    records.push({ file, record });
  }
  return { records, refused };
}
