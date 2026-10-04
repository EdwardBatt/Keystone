import { readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseDocument, isSeq, type Document } from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { compare, fail, KeystoneError, serialize, sortDiagnostics, type Artifact, type Diagnostic } from '../core.js';
import { isMissing, repositoryRoot, safePath } from '../paths.js';
import { parseMarkdown } from '../parser/frontmatter.js';
import { inspect, type Inspection } from './index.js';
import { compileReview, type ReviewResult } from './review.js';
import { roles, type ReviewRole } from '../review/records.js';
import { asText } from '../review/subject.js';

const validateReport = new Ajv2020({ allErrors: true, strict: false })
  .compile(JSON.parse(readFileSync(new URL('../../schemas/review-report.schema.json', import.meta.url), 'utf8')));

export type CloseOutcome = 'closed' | 'already-closed' | 'blocked' | 'failed';
export interface ReviewState {
  role: ReviewRole; report: string | null; round: number | null; verdict: string | null;
  evidence_hash: string | null; base: string | null; state: 'missing' | 'invalid' | 'stale' | 'current';
}
export interface ClosePlan {
  task_id: string; outcome: CloseOutcome; diagnostics: Diagnostic[];
  gate: 'satisfied' | 'overridden' | 'unsatisfied' | null; reviews: ReviewState[];
  promoted: string[]; unpromoted: string[]; writes: { path: string; contents: string }[];
}
export interface CloseResult extends Omit<ClosePlan, 'writes'> { written: string[] }

const outcomeOf = (taskId: string, outcome: CloseOutcome, diagnostics: Diagnostic[], extra: Partial<ClosePlan> = {}): ClosePlan => ({
  task_id: taskId, outcome, diagnostics: sortDiagnostics([...new Map(diagnostics.map(d => [serialize(d), d])).values()]),
  gate: null, reviews: [], promoted: [], unpromoted: [], writes: [], ...extra,
});

/** Level-2 sections outside fences; enough to check the report body contract. */
function reportSections(body: string): Map<string, string> {
  const found = new Map<string, string>();
  let fence: string | undefined;
  let current: string | undefined;
  for (const line of body.split('\n')) {
    if (fence) {
      // Only a delimiter of the same character, at least as long, alone on its line closes a fence.
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) fence = undefined;
      continue;
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) { fence = opening[1]; continue; }
    const heading = line.match(/^ {0,3}(#{1,2})[ \t]+(.*?)[ \t]*#*[ \t]*$/);
    if (heading) {
      current = heading[1].length === 2 ? heading[2] : undefined;
      if (current !== undefined) found.set(current, found.get(current) ?? '');
      continue;
    }
    if (current !== undefined) found.set(current, `${found.get(current)}${line}\n`);
  }
  return new Map([...found].map(([name, text]) => [name, text.trim()]));
}

async function latestReports(root: string, taskId: string): Promise<Map<ReviewRole, { file: string; round: number }>> {
  const latest = new Map<ReviewRole, { file: string; round: number }>();
  let names: string[] = [];
  try { names = await readdir(await safePath(root, `reviews/${taskId}`)); } catch (error) {
    if (!isMissing(error)) throw error;
  }
  for (const name of names.sort(compare)) {
    const match = name.match(/^(code|architecture|context)-([1-9][0-9]*)\.md$/);
    if (!match) continue;
    const role = match[1] as ReviewRole;
    const round = Number(match[2]);
    if (round > (latest.get(role)?.round ?? 0)) latest.set(role, { file: `reviews/${taskId}/${name}`, round });
  }
  return latest;
}

/** Validates a report against the reviewer report contract; returns its metadata or the reason it is invalid. */
function readReport(bytes: Buffer, file: string, taskId: string, role: ReviewRole, round: number): { metadata: Record<string, unknown> } | { invalid: string } {
  const text = asText(bytes);
  if (text === null) return { invalid: 'not valid UTF-8 text' };
  let parsed: ReturnType<typeof parseMarkdown>;
  try { parsed = parseMarkdown(text, file); } catch { return { invalid: 'front matter cannot be parsed' }; }
  const metadata = parsed.metadata;
  if (!metadata || !validateReport(metadata)) return { invalid: 'front matter does not satisfy the reviewer report contract' };
  if (metadata.task !== taskId || metadata.role !== role || metadata.round !== round) return { invalid: 'task, role or round disagrees with the task or file name' };
  const sections = reportSections(parsed.body);
  if (!sections.has('Findings') || !sections.has('Evidence Examined')) return { invalid: 'Findings or Evidence Examined section is missing' };
  if (metadata.verdict === 'changes-requested' && !sections.get('Findings')) return { invalid: 'Findings are blank for changes-requested' };
  if (metadata.verdict === 'inconclusive' && !sections.get('Limitations')) return { invalid: 'Limitations are missing for inconclusive' };
  return { metadata };
}

/** Edits YAML front matter through the document model, preserving other fields and the body. */
function editFrontMatter(text: string, file: string, mutate: (doc: Document) => void): string {
  const lines = text.split('\n');
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---');
  if (lines[0]?.trimEnd() !== '---' || end < 0) fail('CLOSE_CONTENT_UNREADABLE', file, 'Front matter cannot be edited safely.');
  const doc = parseDocument(lines.slice(1, end).join('\n'), { version: '1.2' });
  mutate(doc);
  const front = String(doc).replace(/\n$/, '');
  return ['---', front, '---', ...lines.slice(end + 1)].join('\n');
}

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Evaluates CLOSE completely without writing anything. */
export async function prepareClose(input: string, taskId: string, options: { promote?: string[]; override?: string } = {}): Promise<ClosePlan> {
  const promote = [...new Set(options.promote ?? [])].sort(compare);
  const override = options.override;
  const diagnostics: Diagnostic[] = [];
  if (override !== undefined && !override.trim()) return outcomeOf(taskId, 'failed', [{ code: 'CLI_USAGE', path: '.', message: '--override requires a non-blank reason.' }]);
  try {
    const root = await repositoryRoot(input);
    let working: Inspection;
    try { working = await inspect(root); } catch (error) {
      return outcomeOf(taskId, 'failed', [{ code: 'CLOSE_TASK_NOT_FOUND', path: '.', message: `Working-tree inventory cannot be read (${error instanceof KeystoneError ? error.diagnostic.code : 'IO_ERROR'}).` }]);
    }
    const matches = working.index.artifacts.filter(a => a.type === 'task' && a.id === taskId);
    if (matches.length > 1) return outcomeOf(taskId, 'failed', [{ code: 'CLOSE_TASK_AMBIGUOUS', path: '.', message: `Task ${taskId} is duplicated.` }]);
    if (!matches.length) return outcomeOf(taskId, 'failed', [{ code: 'CLOSE_TASK_NOT_FOUND', path: '.', message: `No task has ID ${taskId}.` }]);
    const task = matches[0];
    if (task.metadata.closure !== undefined) {
      if (promote.length || override !== undefined) {
        return outcomeOf(taskId, 'blocked', [{ code: 'CLOSE_ALREADY_CLOSED_REQUEST_REFUSED', path: task.path, message: `${taskId} is already closed; promotion and override requests are refused.` }]);
      }
      return outcomeOf(taskId, 'already-closed', [{ code: 'CLOSE_ALREADY_CLOSED', path: task.path, message: `${taskId} already has a closure record; nothing was written.` }]);
    }
    if (working.diagnostics.length) {
      return outcomeOf(taskId, 'failed', [{ code: 'CLOSE_VALIDATION_FAILED', path: '.', message: 'The working tree fails structural validation.' }, ...working.diagnostics]);
    }
    const taskText = asText(await readFile(await safePath(root, task.path)));
    if (taskText === null) return outcomeOf(taskId, 'failed', [{ code: 'CLOSE_CONTENT_UNREADABLE', path: task.path, message: 'Task file is not valid UTF-8 text.' }]);

    // Evidence must be preparable at HEAD; report currency is recomputed per report base.
    const evidence = new Map<string, ReviewResult>();
    const head = await compileReview(root, taskId, { type: 'context' });
    if (head.outcome === 'failed') {
      return outcomeOf(taskId, 'failed', [{ code: 'CLOSE_EVIDENCE_UNAVAILABLE', path: '.', message: 'Review evidence cannot be prepared for this task.' }, ...head.diagnostics]);
    }
    const reports = await latestReports(root, taskId);
    const reviews: ReviewState[] = [];
    for (const role of roles) {
      const found = reports.get(role);
      const state: ReviewState = { role, report: found?.file ?? null, round: found?.round ?? null, verdict: null, evidence_hash: null, base: null, state: 'missing' };
      reviews.push(state);
      if (!found) { diagnostics.push({ code: 'CLOSE_GATE_UNSATISFIED', path: `reviews/${taskId}`, message: `No ${role} review report.` }); continue; }
      const read = readReport(await readFile(await safePath(root, found.file)), found.file, taskId, role, found.round);
      if ('invalid' in read) {
        state.state = 'invalid';
        diagnostics.push({ code: 'CLOSE_GATE_UNSATISFIED', path: found.file, message: `Invalid ${role} report: ${read.invalid}.` });
        continue;
      }
      Object.assign(state, { verdict: read.metadata.verdict, evidence_hash: read.metadata.evidence_hash, base: read.metadata.base });
      const base = String(read.metadata.base);
      if (!evidence.has(base)) evidence.set(base, await compileReview(root, taskId, { type: 'context', base }));
      const recomputed = evidence.get(base)!;
      state.state = recomputed.outcome !== 'failed' && recomputed.evidence_hash === read.metadata.evidence_hash ? 'current' : 'stale';
      if (state.state === 'stale') diagnostics.push({ code: 'CLOSE_GATE_UNSATISFIED', path: found.file, message: `The ${role} report does not describe the current evidence for its base.` });
      else if (state.verdict !== 'approve') diagnostics.push({ code: 'CLOSE_GATE_UNSATISFIED', path: found.file, message: `The ${role} verdict is ${state.verdict}.` });
    }
    const satisfied = reviews.every(r => r.state === 'current' && r.verdict === 'approve');
    const overriding = override !== undefined;
    let gate: ClosePlan['gate'];
    if (satisfied) {
      gate = 'satisfied';
      if (overriding) diagnostics.push({ code: 'CLOSE_OVERRIDE_NOT_REQUIRED', path: task.path, message: 'The review gate is satisfied; the override was not used.' });
    } else if (overriding) {
      gate = 'overridden';
      diagnostics.push({ code: 'CLOSE_OVERRIDE_APPLIED', path: task.path, message: 'The owner override authorises CLOSE despite the unsatisfied review gate; verdicts are preserved.' });
    } else {
      return outcomeOf(taskId, 'blocked', diagnostics, { gate: 'unsatisfied', reviews });
    }

    // Controlled promotion: only explicitly requested, checked, reviewed candidates.
    const isCandidate = (a: Artifact) => (a.type === 'learning' && a.metadata.status === 'candidate' || a.type === 'trap' && a.metadata.status === 'proposed') &&
      Array.isArray(a.metadata.tasks) && (a.metadata.tasks as unknown[]).includes(taskId);
    const candidates = working.index.artifacts.filter(isCandidate).sort((a, b) => compare(a.id, b.id));
    const blocked: Diagnostic[] = [];
    if (promote.length && gate === 'overridden') {
      blocked.push({ code: 'CLOSE_PROMOTION_REQUIRES_APPROVED_REVIEW', path: task.path, message: 'An overridden review gate never permits promotion.' });
    }
    const context = reviews.find(r => r.role === 'context')!;
    const reviewedPaths = new Set(gate === 'satisfied' ? (evidence.get(context.base!)!.packages[0].subject as { path: string }[]).map(e => e.path) : []);
    const promotedWrites: { path: string; contents: string }[] = [];
    if (!blocked.length) {
      for (const id of promote) {
        const invalid = (reason: string) => blocked.push({ code: 'CLOSE_PROMOTION_INVALID', path: id, message: `${id} cannot be promoted: ${reason}.` });
        const artifact = working.index.artifacts.find(a => a.id === id);
        if (!artifact) { invalid('no such artifact'); continue; }
        if (artifact.type !== 'learning' && artifact.type !== 'trap') { invalid(`${artifact.type} artifacts are never promoted by CLOSE`); continue; }
        if (!isCandidate(artifact)) { invalid(`it is not a ${artifact.type === 'learning' ? 'candidate learning' : 'proposed trap'} linked to ${taskId}`); continue; }
        if (!Array.isArray(artifact.metadata.evidence) || !artifact.metadata.evidence.length) { invalid('evidence is empty'); continue; }
        if (artifact.type === 'trap' && artifact.metadata.severity !== 'medium') { invalid('only medium trap severity is classified'); continue; }
        if (!reviewedPaths.has(artifact.path)) { invalid('it is not in the subject of the current approved context review'); continue; }
        const text = asText(await readFile(await safePath(root, artifact.path)));
        if (text === null) { invalid('it is not valid UTF-8 text'); continue; }
        const reference = `close:${taskId} context-review:${context.report}@${context.evidence_hash}`;
        promotedWrites.push({ path: artifact.path, contents: editFrontMatter(text, artifact.path, doc => {
          doc.set('status', artifact.type === 'learning' ? 'accepted' : 'active');
          const list = doc.get('evidence', true);
          if (isSeq(list) && !list.items.some(item => String((item as { value?: unknown }).value ?? item) === reference)) list.items.push(doc.createNode(reference));
        }) });
      }
    }
    if (blocked.length) return outcomeOf(taskId, 'blocked', [...diagnostics, ...blocked], { gate, reviews });

    const promoted = promote;
    const unpromoted = candidates.map(c => c.id).filter(id => !promoted.includes(id));
    const closure = {
      gate, ...(gate === 'overridden' ? { override_reason: override!.trim() } : {}),
      reviews: reviews.map(r => ({ role: r.role, report: r.report, round: r.round, verdict: r.verdict, evidence_hash: r.evidence_hash, base: r.base, state: r.state })),
      promoted, unpromoted,
    };
    const completed = typeof task.metadata.completed === 'string' && task.metadata.completed.trim() ? task.metadata.completed : localDate();
    const taskWrite = { path: task.path, contents: editFrontMatter(taskText, task.path, doc => {
      doc.set('status', 'accepted');
      doc.set('completed', completed);
      doc.set('closure', doc.createNode(closure));
    }) };
    diagnostics.push({ code: 'CLOSE_INDEX_UPDATE_REQUIRED', path: 'TASKS.md', message: `Move ${taskId} to Recently Completed in TASKS.md; CLOSE does not edit navigation indexes.` });
    return outcomeOf(taskId, 'closed', diagnostics, { gate, reviews, promoted, unpromoted, writes: [taskWrite, ...promotedWrites] });
  } catch (error) {
    return outcomeOf(taskId, 'failed', [...diagnostics, error instanceof KeystoneError ? error.diagnostic : { code: 'IO_ERROR', path: '.', message: 'Cannot evaluate CLOSE.' }]);
  }
}

/** Evaluates CLOSE and, only when every check passes, writes the task and promoted candidates. */
export async function close(input: string, taskId: string, options: { promote?: string[]; override?: string } = {}): Promise<CloseResult> {
  const { writes, ...plan } = await prepareClose(input, taskId, options);
  if (plan.outcome !== 'closed') return { ...plan, written: [] };
  const root = await repositoryRoot(input);
  const originals = new Map<string, Buffer>();
  const temporary = new Map<string, string>();
  const renamed: string[] = [];
  try {
    for (const write of writes) originals.set(write.path, await readFile(await safePath(root, write.path)));
    for (const write of writes) {
      const destination = await safePath(root, write.path);
      const file = path.join(path.dirname(destination), `.${path.basename(destination)}.close-${randomUUID()}.tmp`);
      // Register before writing so a partial temporary file is always cleaned up.
      temporary.set(write.path, file);
      await writeFile(file, write.contents, { encoding: 'utf8', flag: 'wx' });
    }
    for (const write of writes) {
      await rename(temporary.get(write.path)!, await safePath(root, write.path));
      temporary.delete(write.path);
      renamed.push(write.path);
    }
    const after = await inspect(root);
    const closed = after.index.artifacts.find(a => a.type === 'task' && a.id === taskId);
    if (after.diagnostics.length || closed?.metadata.closure === undefined) throw new Error('post-write validation failed');
    return { ...plan, written: writes.map(w => w.path) };
  } catch {
    for (const file of renamed) await writeFile(await safePath(root, file), originals.get(file)!).catch(() => undefined);
    return { ...plan, outcome: 'failed', written: [], diagnostics: sortDiagnostics([...plan.diagnostics,
      { code: 'CLOSE_WRITE_FAILED', path: '.', message: 'CLOSE could not write atomically; every original file was restored.' }]) };
  } finally {
    for (const file of temporary.values()) await unlink(file).catch(() => undefined);
  }
}
