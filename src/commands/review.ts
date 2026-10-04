import { access, mkdir, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { compare, fail, isValidKeystoneIndex, KeystoneError, serialize, sortDiagnostics, type Artifact, type Diagnostic } from '../core.js';
import { isMissing, repositoryRoot, safePath } from '../paths.js';
import { parseMarkdown } from '../parser/frontmatter.js';
import { expectedType } from '../parser/discovery.js';
import { estimate, type Entry } from '../context/envelope.js';
import { inspect, type Inspection } from './index.js';
import { scaffoldFiles } from './init.js';
import { git, probeGit, readObjects, runGit } from '../review/git.js';
import { asText, computeSubject, filteredPaths, lsTree, materialize, outsideSubject, readIndex, untracked, type SubjectEntry } from '../review/subject.js';
import { baseInventory, reviewContext, type ReviewContext, type Unidentified } from '../review/context.js';
import { classifyMetadata, dispositionSections, hash, partitionTask, type MetadataClasses, type Partition } from '../review/task.js';
import { defaultCharter, hasCharterContent, nextRounds, roles, type ReviewRole } from '../review/records.js';

export type ReviewType = ReviewRole | 'all';
export type ReviewOutcome = 'complete' | 'incomplete/conflicted' | 'failed';
export const reviewContractVersion = 1;

interface ClaimItem { side: 'base' | 'working'; kind: 'section' | 'field'; name: string; class: 'claim' | 'unrecognised'; hash: string; content?: unknown }

export interface ReviewPackage {
  generated_by: 'keystone'; schema_version: 1; kind: 'review-package';
  role: ReviewRole; task_id: string; outcome: Exclude<ReviewOutcome, 'failed'>;
  authorization: 'not-established'; verdict: 'not-determined';
  evidence_hash: string; package_hash: string;
  [key: string]: unknown;
}

export interface ReviewResult {
  task_id: string; outcome: ReviewOutcome; diagnostics: Diagnostic[];
  evidence_hash: string | null; packages: ReviewPackage[];
  installed: boolean; written: { role: ReviewRole; path: string; changed: boolean }[];
}

const failed = (taskId: string, diagnostics: Diagnostic[]): ReviewResult =>
  ({ task_id: taskId, outcome: 'failed', diagnostics: sortDiagnostics(diagnostics), evidence_hash: null, packages: [], installed: false, written: [] });

const asDiagnostic = (error: unknown): Diagnostic => error instanceof KeystoneError ? error.diagnostic :
  { code: 'IO_ERROR', path: '.', message: 'Cannot prepare review evidence.' };

async function keystoneVersion(): Promise<string> {
  return JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version;
}

async function gitText(root: string, args: string[], code: string, message: string): Promise<string> {
  const result = await runGit(root, args).catch(() => fail('REVIEW_GIT_UNSUPPORTED', '.', 'Git is not available for review.'));
  if (result.code !== 0) fail(code, '.', message);
  return result.stdout.toString('utf8').trim();
}

/** Boundary preconditions: a trustworthy baseline, no in-progress or unmerged state. */
async function baseline(root: string, requested: string) {
  const top = await gitText(root, ['rev-parse', '--show-toplevel'], 'REVIEW_ROOT_INVALID', 'Review root must be the top-level of a Git working tree.');
  if (await realpath(top).catch(() => '') !== root) fail('REVIEW_ROOT_INVALID', '.', 'Review root must be the top-level of a Git working tree.');
  const format = await gitText(root, ['rev-parse', '--show-object-format'], 'REVIEW_GIT_FAILED', 'Cannot read the repository object format.');
  const head = await gitText(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], 'REVIEW_BASE_INVALID', 'HEAD does not name a commit.');
  const base = await gitText(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${requested}^{commit}`], 'REVIEW_BASE_INVALID', `Base ${requested} does not resolve to a commit.`);
  const ancestry = await runGit(root, ['merge-base', '--is-ancestor', base, head]);
  if (ancestry.code === 1) fail('REVIEW_BASE_NOT_ANCESTOR', '.', `Base ${requested} is not an ancestor of HEAD.`);
  if (ancestry.code !== 0) fail('REVIEW_GIT_FAILED', '.', 'Cannot verify base ancestry.');
  const gitDir = await gitText(root, ['rev-parse', '--absolute-git-dir'], 'REVIEW_GIT_FAILED', 'Cannot locate the Git directory.');
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
    if (await access(path.join(gitDir, marker)).then(() => true, () => false)) {
      fail('REVIEW_OPERATION_IN_PROGRESS', '.', `A Git operation is in progress (${marker}); the review boundary is not stable.`);
    }
  }
  return { format, head, base };
}

function claimItems(side: 'base' | 'working', classes: MetadataClasses, partition: Partition): ClaimItem[] {
  return [
    ...partition.claims.map((s): ClaimItem => ({ side, kind: 'section', name: s.name, class: 'claim', hash: hash(s.content), content: s.content })),
    ...partition.unrecognised.map((s): ClaimItem => ({ side, kind: 'section', name: s.name, class: 'unrecognised', hash: hash(s.content), content: s.content })),
    ...Object.entries(classes.unrecognised).sort(([a], [b]) => compare(a, b))
      .map(([name, value]): ClaimItem => ({ side, kind: 'field', name, class: 'unrecognised', hash: hash(value), content: value })),
  ];
}

interface RootSide { artifact: Artifact; classes: MetadataClasses; partition: Partition }

/** True only when a malformed candidate's front matter is readable and names a different ID. */
function ruledOut(bytes: Buffer | null, file: string, taskId: string): boolean {
  const text = bytes ? asText(bytes) : null;
  if (text === null) return false;
  try {
    const id = parseMarkdown(text, file).metadata?.id;
    return typeof id === 'string' && id !== taskId;
  } catch { return false; }
}

function parseRoot(artifact: Artifact, bytes: Buffer): RootSide {
  const text = asText(bytes);
  if (text === null) fail('REVIEW_CONTEXT_UNREADABLE', artifact.path, 'Root task is not valid UTF-8 text; its requirements cannot be established reliably.');
  const parsed = parseMarkdown(text, artifact.path);
  const partition = partitionTask(parsed.body);
  if (partition.unsafe) fail('REVIEW_TASK_SECTIONS_UNPARSEABLE', artifact.path, `Task body cannot be partitioned reliably: ${partition.unsafe}.`);
  return { artifact, classes: classifyMetadata(parsed.metadata ?? {}), partition };
}

function requirementChanges(base: RootSide, working: RootSide | null) {
  if (!working) return [{ kind: 'task', name: 'removed-in-working-tree', base: base.artifact.path, working: null }];
  const changes: { kind: string; name: string; base: unknown; working: unknown }[] = [];
  for (const name of [...new Set([...Object.keys(base.classes.requirement), ...Object.keys(working.classes.requirement)])].sort(compare)) {
    const before = base.classes.requirement[name] ?? null;
    const after = working.classes.requirement[name] ?? null;
    if (serialize(before) !== serialize(after)) changes.push({ kind: 'field', name, base: before, working: after });
  }
  const names = [...new Set([...base.partition.requirements, ...working.partition.requirements].map(s => s.name))];
  for (const name of names) {
    const before = base.partition.requirements.find(s => s.name === name)?.content ?? null;
    const after = working.partition.requirements.find(s => s.name === name)?.content ?? null;
    if (before !== after) changes.push({ kind: 'section', name, base: before, working: after });
  }
  if (base.artifact.path !== working.artifact.path) changes.push({ kind: 'path', name: 'path', base: base.artifact.path, working: working.artifact.path });
  return changes;
}

function indexFreshness(root: string, inspection: Inspection | null) {
  return readFile(path.join(root, '.context', 'index.json'), 'utf8').then(contents => {
    let parsed: unknown;
    try { parsed = JSON.parse(contents); } catch { return 'invalid'; }
    if (!isValidKeystoneIndex(parsed)) return 'invalid';
    if (!inspection || inspection.diagnostics.length) return 'unverified';
    return contents === serialize(inspection.index) ? 'current' : 'stale';
  }, error => isMissing(error) ? 'missing' : 'unverified');
}

function pack(pkg: Record<string, unknown>, context: { entries: Entry[] }, omissions: { id: string; path: string; reason: string }[]) {
  const target = 8000;
  const bodies = new Map(context.entries.map(e => [e.id, e.content]));
  const packable = context.entries.filter(e => e.tier >= 2 && e.content !== undefined);
  for (const entry of packable) delete entry.content;
  const cost = () => { const { budget: _b, package_hash: _p, ...rest } = pkg; return estimate(serialize(rest)); };
  for (const entry of packable) {
    entry.content = bodies.get(entry.id);
    if (cost() > target) { delete entry.content; omissions.push({ id: entry.id, path: entry.path, reason: 'budget' }); }
  }
  omissions.sort((a, b) => compare(a.id, b.id));
  const estimated = cost();
  pkg.budget = { target, estimated_tokens: estimated, exceeded: estimated > target, estimator: 'ceil(utf8-bytes/4), excluding budget and package_hash' };
}

/** Prepares review evidence without writing packages. Temporary base state lives under .context/review/. */
export async function compileReview(input: string, taskId: string, options: { type?: ReviewType; base?: string } = {}): Promise<ReviewResult> {
  const requested: ReviewRole[] = !options.type || options.type === 'all' ? [...roles] : [options.type];
  let temporary: string | undefined;
  let root = '';
  try {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(taskId)) fail('REVIEW_TASK_NOT_FOUND', '.', `Invalid task ID: ${taskId}.`);
    root = await repositoryRoot(input);
    await probeGit();
    const { format, head, base } = await baseline(root, options.base ?? 'HEAD');
    const index = await readIndex(root);
    if (index.unmerged) fail('REVIEW_UNMERGED_ENTRIES', '.', 'The index has unmerged entries; the review boundary is not stable.');
    const others = await untracked(root);
    const tree = await lsTree(root, base);
    const blobs = await readObjects(root, tree.filter(e => e.type === 'blob').map(e => e.oid));
    let working: Inspection | null = null;
    let workingError: Diagnostic | null = null;
    try { working = await inspect(root); } catch (error) { workingError = asDiagnostic(error); }

    const reviewDirectory = await safePath(root, '.context/review');
    await mkdir(reviewDirectory, { recursive: true });
    temporary = path.join(reviewDirectory, `.base-${randomUUID()}`);
    await mkdir(temporary);
    const unrepresentable = await materialize(temporary, tree, blobs);
    const inventory = await baseInventory(temporary, unrepresentable);

    // Root identity: duplicates or unidentifiable candidates prevent reliable identification.
    const isRoot = (a: { type?: string; id?: string }) => a.type === 'task' && a.id === taskId;
    if (inventory.quarantined.some(isRoot)) fail('REVIEW_ROOT_AMBIGUOUS', '.', `Task ${taskId} has an ambiguous identity at the base revision.`);
    const baseRoot = inventory.artifacts.find(isRoot);
    if (!working) fail('REVIEW_ROOT_AMBIGUOUS', workingError?.path ?? '.', `Working-tree inventory cannot be read (${workingError?.code}); ${taskId} cannot be matched.`);
    const workingRoots = working.index.artifacts.filter(isRoot);
    if (workingRoots.length > 1) fail('REVIEW_ROOT_AMBIGUOUS', '.', `Task ${taskId} is duplicated in the working tree.`);
    const workingFound = new Set(working.index.artifacts.map(a => a.path));
    const unknownTask = (u: Unidentified) => u.type === 'task' || u.type === 'unknown';
    const workingCandidates = working.diagnostics.filter(d => !workingFound.has(d.path) && /\.md$/i.test(d.path) && ['task', undefined].includes(expectedType(d.path)))
      .map(d => d.path);
    // A malformed candidate blocks root identity unless it is positively ruled out by a readable,
    // different ID, even when one valid root candidate exists.
    const baseDirectory = temporary;
    for (const candidate of inventory.unidentified.filter(unknownTask)) {
      const bytes = candidate.reason === 'unrepresentable' ? null : await readFile(path.join(baseDirectory, ...candidate.path.split('/'))).catch(() => null);
      if (!ruledOut(bytes, candidate.path, taskId)) fail('REVIEW_ROOT_AMBIGUOUS', candidate.path, `${candidate.path} cannot be ruled out as another instance of ${taskId} at the base revision.`);
    }
    for (const candidate of [...new Set(workingCandidates)]) {
      const bytes = await readFile(await safePath(root, candidate)).catch(() => null);
      if (!ruledOut(bytes, candidate, taskId)) fail('REVIEW_ROOT_AMBIGUOUS', candidate, `${candidate} cannot be ruled out as another instance of ${taskId} in the working tree.`);
    }
    if (!baseRoot && !workingRoots.length) fail('REVIEW_TASK_NOT_FOUND', '.', `No task has ID ${taskId} at the base revision or in the working tree.`);
    const introduced = !baseRoot;
    const baseSide = baseRoot ? parseRoot(baseRoot, await readFile(path.join(temporary, ...baseRoot.path.split('/')))) : null;
    const workingSide = workingRoots[0] ? parseRoot(workingRoots[0], await readFile(await safePath(root, workingRoots[0].path))) : null;
    const source = (baseSide ?? workingSide)!;
    const context: ReviewContext = await reviewContext(temporary, inventory, source.artifact, introduced);

    const charters = {} as Record<ReviewRole, { provenance: string; hash: string; content: string }>;
    for (const role of roles) {
      const file = `agents/${role}-reviewer.md`;
      const projectText = await readFile(path.join(temporary, ...file.split('/')), 'utf8').catch(() => null);
      const content = projectText && hasCharterContent(projectText) ? projectText.replace(/^﻿/, '').replace(/\r\n?/g, '\n') : await defaultCharter(role);
      charters[role] = { provenance: projectText && hasCharterContent(projectText) ? `base:${file}` : `default:templates/agents/${role}-reviewer.md`, hash: hash(content), content };
    }
    await rm(temporary, { recursive: true, force: true });
    temporary = undefined;

    const candidatePaths = [...new Set([...tree.map(e => e.path), ...index.entries.keys(), ...others.filter(f => !f.endsWith('/'))])]
      .filter(f => !outsideSubject(f)).sort(compare);
    const subject: SubjectEntry[] = await computeSubject({
      root, format, base: tree, blobs, index, others,
      rootTaskPaths: new Set([baseSide?.artifact.path, workingSide?.artifact.path].filter((p): p is string => !!p)),
      filtered: await filteredPaths(root, base, candidatePaths),
    });
    const typedBase = new Map([...inventory.artifacts, ...inventory.quarantined.map(q => ({ path: q.path, type: q.type, metadata: {} }))].map(a => [a.path, a]));
    const typedWorking = new Map(working.index.artifacts.map(a => [a.path, a]));
    const managed = new Set(scaffoldFiles);
    for (const entry of subject) {
      const classes: string[] = [];
      const before = typedBase.get(entry.path) as { type: string; metadata: Record<string, unknown> } | undefined;
      const after = typedWorking.get(entry.path);
      if (before || after) {
        classes.push('typed');
        entry.artifact = {
          base: before ? { type: before.type, status: before.metadata.status ?? null } : null,
          working: after ? { type: after.type, status: after.metadata.status ?? null } : null,
        };
      }
      if (managed.has(entry.path)) classes.push('keystone-managed');
      if (!classes.length) classes.push('ordinary');
      entry.classes = classes;
    }

    const commits: { commit: string; task_id_present: boolean; adr_ids: string[] }[] = [];
    const listed = (await git(root, ['rev-list', '--topo-order', `${base}..${head}`])).toString('utf8').split('\n').filter(Boolean);
    const objects = await readObjects(root, listed);
    const token = new RegExp(`(^|[^A-Za-z0-9_-])${taskId.replace(/[.]/g, '\\.')}(?![A-Za-z0-9_-])`);
    for (const commit of listed) {
      const text = objects.get(commit)!.content.toString('utf8');
      const message = text.slice(text.indexOf('\n\n') + 2);
      commits.push({ commit, task_id_present: token.test(message),
        adr_ids: [...new Set([...message.matchAll(/(?<![A-Za-z0-9_-])ADR-[0-9]+(?![0-9])/g)].map(m => m[0]))].sort(compare) });
    }

    const diagnostics: Diagnostic[] = [];
    if (introduced) diagnostics.push({ code: 'REVIEW_TASK_INTRODUCED_IN_SUBJECT', path: source.artifact.path, message: `${taskId} is introduced by the work; it defines this work's requirements only.` });
    const changes = baseSide ? requirementChanges(baseSide, workingSide) : [];
    if (changes.length) diagnostics.push({ code: 'REVIEW_REQUIREMENTS_CHANGED', path: baseSide!.artifact.path, message: 'Requirements changed during the work; base requirements remain the review standard.' });
    const claims = [...(baseSide ? claimItems('base', baseSide.classes, baseSide.partition) : []), ...(workingSide ? claimItems('working', workingSide.classes, workingSide.partition) : [])];
    const unrecognised = claims.some(c => c.class === 'unrecognised');
    if (unrecognised) diagnostics.push({ code: 'REVIEW_TASK_CONTENT_UNRECOGNISED', path: source.artifact.path, message: 'Task content outside the requirement/claim contract is withheld and reported.' });
    const gapKinds = new Set(['non-text', 'symlink', 'gitlink', 'filtered']);
    for (const entry of subject.filter(e => gapKinds.has(e.kind))) {
      diagnostics.push({ code: 'REVIEW_CONTENT_UNREPRESENTED', path: entry.path, message: `${entry.kind} content is represented by metadata and hash only.` });
    }
    if (context.base_diagnostics.length) diagnostics.push({ code: 'REVIEW_BASE_STRUCTURE_GAPS', path: '.', message: `${context.base_diagnostics.length} base structural diagnostic(s) are reported as evidence gaps.` });
    diagnostics.push(...context.gaps, ...context.diagnostics);

    const version = await keystoneVersion();
    const requirements = {
      source: introduced ? 'working' : 'base', path: source.artifact.path,
      identity: source.classes.identity, metadata: source.classes.requirement,
      sections: source.partition.requirements, changes,
    };
    const payload = {
      review_contract_version: reviewContractVersion, keystone_version: version, base,
      // The root task file is identified through `root` (requirements, paths and non-disposition
      // claim hashes), so lifecycle or disposition edits cannot change the evidence identity.
      subject: subject.filter(e => e.kind !== 'root-task')
        .map(e => ({ path: e.path, change: e.change, kind: e.kind, base: e.base?.oid ?? null, working: e.working ? `${e.working.mode}:${e.working.hash}` : null })),
      root: {
        id: taskId, introduced, base_path: baseSide?.artifact.path ?? null, working_path: workingSide?.artifact.path ?? null,
        working_identity: workingSide?.classes.identity ?? null, requirements,
        claims: claims.filter(c => c.class === 'unrecognised' || !dispositionSections.includes(c.name)).map(({ content: _c, ...rest }) => rest),
      },
      context: {
        outcome: context.outcome, replacements: context.replacements, diagnostics: context.diagnostics, gaps: context.gaps,
        base_diagnostics: context.base_diagnostics, quarantined: inventory.quarantined, unidentified: inventory.unidentified,
        entries: context.entries.map(e => ({ id: e.id, type: e.type, path: e.path, role: e.role, tier: e.tier, hash: e.hash, reasons: e.reasons })),
      },
      charters: Object.fromEntries(roles.map(role => [role, { provenance: charters[role].provenance, hash: charters[role].hash }])),
    };
    const evidenceHash = hash(payload);
    const validation = { ok: working.diagnostics.length === 0, diagnostics: working.diagnostics };
    const freshness = await indexFreshness(root, working);
    const rounds = await nextRounds(root, taskId);
    const packages: ReviewPackage[] = [];
    for (const role of requested) {
      const roleDiagnostics = [...diagnostics];
      if (role === 'code' && !subject.length) roleDiagnostics.push({ code: 'REVIEW_SUBJECT_EMPTY', path: '.', message: 'The review subject is empty; there is no work for code review.' });
      const incomplete = context.outcome !== 'complete' || context.gaps.length > 0 || context.base_diagnostics.length > 0 || unrecognised ||
        subject.some(e => gapKinds.has(e.kind)) || role === 'code' && !subject.length;
      const entries = context.entries.map(e => ({ ...e, reasons: [...e.reasons] }));
      const omissions = [...context.omissions];
      const pkg: Record<string, unknown> = {
        generated_by: 'keystone', schema_version: 1, kind: 'review-package', role, task_id: taskId,
        outcome: incomplete ? 'incomplete/conflicted' : 'complete', authorization: 'not-established', verdict: 'not-determined',
        evidence_hash: evidenceHash,
        report: { path: `reviews/${taskId}/${role}-${rounds.rounds[role]}.md`, round: rounds.rounds[role], contract: 'schemas/review-report.schema.json', template: 'templates/review.md', diagnostics: rounds.diagnostics },
        baseline: { base, head, commits },
        requirements,
        lifecycle: { base: baseSide?.classes.lifecycle ?? null, working: workingSide?.classes.lifecycle ?? null },
        ...(role === 'context'
          ? { under_review: { label: 'unverified implementer-authored material; not objective evidence', items: claims } }
          : { withheld: claims.map(({ content: _c, ...rest }) => rest) }),
        context: { ...payload.context, entries },
        subject,
        checks: {
          base_start: { outcome: context.outcome, diagnostics: context.diagnostics },
          working_validation: workingError ? { ok: false, diagnostics: [workingError] } : validation,
          ...(role === 'context' ? { index_freshness: freshness } : {}),
        },
        charter: { role, ...charters[role] },
        diagnostics: sortDiagnostics([...new Map(roleDiagnostics.map(d => [serialize(d), d])).values()]),
        omissions,
      };
      pack(pkg, { entries }, omissions);
      const { package_hash: _p, ...rest } = pkg;
      pkg.package_hash = createHash('sha256').update(serialize(rest)).digest('hex');
      packages.push(pkg as ReviewPackage);
    }
    const outcome: ReviewOutcome = packages.some(p => p.outcome !== 'complete') ? 'incomplete/conflicted' : 'complete';
    return { task_id: taskId, outcome, diagnostics: sortDiagnostics([...new Map(packages.flatMap(p => p.diagnostics as Diagnostic[]).map(d => [serialize(d), d])).values()]),
      evidence_hash: evidenceHash, packages, installed: false, written: [] };
  } catch (error) {
    return failed(taskId, [asDiagnostic(error)]);
  } finally {
    if (temporary && root && path.dirname(path.dirname(temporary)) === path.join(root, '.context') && path.basename(temporary).startsWith('.base-')) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

const recognized = (value: unknown) => value !== null && typeof value === 'object' &&
  (value as ReviewPackage).generated_by === 'keystone' && (value as ReviewPackage).schema_version === 1 && (value as ReviewPackage).kind === 'review-package';

/** Prepares evidence and installs one package per requested role under .context/review/. */
export async function review(input: string, taskId: string, options: { type?: ReviewType; base?: string } = {}): Promise<ReviewResult> {
  const result = await compileReview(input, taskId, options);
  if (result.outcome === 'failed') return result;
  try {
    const root = await repositoryRoot(input);
    const targets = result.packages.map(p => ({ pkg: p, file: `.context/review/${taskId}/${p.role}.json` }));
    const existing = new Map<string, string>();
    for (const { file } of targets) {
      try {
        const contents = await readFile(await safePath(root, file), 'utf8');
        let parsed: unknown;
        try { parsed = JSON.parse(contents); } catch { /* Refuse unrecognized contents. */ }
        if (!recognized(parsed)) fail('REVIEW_PACKAGE_OVERWRITE_REFUSED', file, 'Existing file is not a recognized Keystone review package.');
        existing.set(file, contents);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    await mkdir(await safePath(root, `.context/review/${taskId}`), { recursive: true });
    for (const { pkg, file } of targets) {
      const contents = serialize(pkg);
      if (existing.get(file) === contents) { result.written.push({ role: pkg.role, path: file, changed: false }); continue; }
      const temporaryFile = await safePath(root, `.context/review/${taskId}/.${pkg.role}-${randomUUID()}.tmp`);
      try {
        await writeFile(temporaryFile, contents, { encoding: 'utf8', flag: 'wx' });
        await rename(temporaryFile, await safePath(root, file));
      } finally {
        await unlink(temporaryFile).catch(() => undefined);
      }
      result.written.push({ role: pkg.role, path: file, changed: true });
    }
    result.installed = true;
    return result;
  } catch (error) {
    return { ...failed(taskId, [...result.diagnostics, asDiagnostic(error)]), written: result.written };
  }
}
