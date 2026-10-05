import { compare, serialize, sortDiagnostics, type Artifact, type Diagnostic, type Link } from '../core.js';
import { entryOrder, type Entry, type Reason, type Replacement, type Role } from './envelope.js';
import { isReviewRecordPath } from '../review/records.js';

const historical = (a: Artifact) => a.type === 'adr' && ['accepted', 'superseded'].includes(String(a.metadata.status));
export function eligible(a: Artifact): boolean {
  const status = a.metadata.status;
  switch (a.type) {
    case 'task': return true;
    case 'adr': return status === 'accepted';
    case 'learning': return status === 'accepted';
    case 'rule': case 'skill': return status === undefined || status === 'active';
    default: return status === 'active';
  }
}
/** Retired learnings and traps are known, never-binding history (ADR-0003). */
export const retired = (a: Artifact) => (a.type === 'learning' || a.type === 'trap') && a.metadata.status === 'retired';
const knownReview = (a: Artifact) => a.metadata.status === 'proposed' ||
  a.type === 'learning' && a.metadata.status === 'candidate' ||
  ['rule', 'skill'].includes(a.type) && a.metadata.status === 'draft';
const strengths: Record<Role, number> = { scope: 0, binding: 1, supporting: 2, conflicted: 3, review: 4, history: 5, evidence: 6 };

export function select(task: Artifact, artifacts: Artifact[], links: Link[], explicitSources: boolean) {
  const byId = new Map(artifacts.map(a => [a.id, a]));
  const byPath = new Map(artifacts.map(a => [a.path, a]));
  const projects = artifacts.filter(a => a.type === 'project');
  const selected = new Map<string, Entry>();
  const diagnostics: Diagnostic[] = [];
  const conflicts = new Set<string>();
  const refused = new Map<string, { id: string; path: string; reason: string }>();
  let incomplete = false;
  const outgoing = (a: Artifact, fields?: string[]) => links.filter(l => l.source === a.id && (!fields || fields.includes(l.field)));
  const target = (l: Link) => l.kind === 'artifact' ? byId.get(l.target) : byPath.get(l.target);
  function diagnose(code: string, a: Artifact, message: string, blocking = false) {
    diagnostics.push({ code, path: a.path, message });
    incomplete ||= blocking;
  }
  function add(a: Artifact, tier: number, role: Role, source: string, field: string) {
    // Project ambiguity restricts every path, including discovered file aliases.
    if (a.type === 'project' && projects.length > 1) role = 'review';
    const reason: Reason = { source, field, role, tier };
    let entry = selected.get(a.id);
    if (!entry) {
      entry = { id: a.id, type: a.type, path: a.path, hash: a.hash, metadata: a.metadata, role, tier, reasons: [], excerpt: 'whole-body' };
      selected.set(a.id, entry);
    }
    if (strengths[role] < strengths[entry.role]) entry.role = role;
    entry.tier = Math.min(entry.tier, tier);
    entry.reasons.push(reason);
  }
  function file(l: Link, tier: number, role: Role) {
    const id = `file:${l.target}`;
    // A validly identified review record is refused after ordinary path validation (ADR-0002).
    if (isReviewRecordPath(l.target)) {
      refused.set(id, { id, path: l.target, reason: 'review-record-ineligible' });
      diagnostics.push({ code: 'START_REVIEW_RECORD_INELIGIBLE', path: byId.get(l.source)?.path ?? l.target,
        message: `Review record ${l.target} is ineligible for START and review-context selection.` });
      return;
    }
    let entry = selected.get(id);
    if (!entry) {
      entry = { id, type: 'file', path: l.target, hash: '', metadata: {}, role, tier, reasons: [], excerpt: 'file' };
      selected.set(id, entry);
    }
    entry.tier = Math.min(entry.tier, tier);
    entry.reasons.push({ source: l.source, field: l.field, role, tier });
  }

  const edgeMap = new Map<string, Replacement>();
  for (const link of links.filter(l => ['supersedes', 'superseded_by'].includes(l.field) && byId.get(l.source)?.type === 'adr')) {
    const [older, newer] = link.field === 'supersedes' ? [link.target, link.source] : [link.source, link.target];
    const key = `${older}\0${newer}`;
    const edge = edgeMap.get(key) ?? { older, newer, declarations: [], qualified: false };
    edge.declarations.push(`${link.source}:${link.field}`);
    edge.qualified ||= historical(byId.get(link.source)!) && historical(byId.get(older)!) && historical(byId.get(newer)!);
    edgeMap.set(key, edge);
  }
  const examined = new Set<string>();
  function resolve(a: Artifact, tier: number, source: string, field: string) {
    const reached = new Set<string>();
    const pending = [a.id];
    let bad = false;
    const terminals: string[] = [];
    while (pending.length) {
      const id = pending.pop()!;
      if (reached.has(id)) continue;
      reached.add(id);
      const edges = [...edgeMap.entries()].filter(([, e]) => e.older === id);
      for (const [key, edge] of edges) {
        examined.add(key);
        const successor = byId.get(edge.newer)!;
        if (!edge.qualified && !historical(successor) && !knownReview(successor)) {
          bad = true;
          reached.add(successor.id);
          diagnose('START_AUTHORITY_UNKNOWN', successor, 'Unknown successor authority prevents effective ADR resolution.', true);
        }
      }
      const next = edges.map(([, e]) => e).filter(e => e.qualified);
      if (next.length > 1) bad = true;
      if (!next.length) terminals.push(id);
      pending.push(...next.map(e => e.newer));
    }
    if (terminals.length !== 1 || byId.get(terminals[0])?.metadata.status !== 'accepted') bad = true;
    if (bad) {
      diagnose('START_ADR_CONFLICT', a, 'ADR replacement has no unambiguous accepted chain endpoint.', true);
      for (const id of reached) { conflicts.add(id); add(byId.get(id)!, tier, 'conflicted', source, field); }
    } else {
      for (const id of reached) add(byId.get(id)!, id === terminals[0] ? tier : 3, id === terminals[0] ? 'binding' : 'history', source, field);
    }
  }
  function reviewHop(a: Artifact) {
    for (const l of outgoing(a)) {
      const t = target(l);
      if (t && retired(t)) add(t, 3, 'history', a.id, l.field);
      else if (t) add(t, 2, 'review', a.id, l.field);
      else if (l.kind === 'file') file(l, 3, 'evidence');
    }
  }
  function choose(a: Artifact, tier: number, source: string, field: string, direct = false, mandatory = false) {
    if (a.type === 'adr' && historical(a)) { resolve(a, tier, source, field); return; }
    if (retired(a)) { add(a, 3, 'history', source, field); return; }
    if (!eligible(a)) {
      add(a, mandatory ? 0 : direct ? 1 : tier, 'review', source, field);
      if (!knownReview(a)) diagnose('START_AUTHORITY_UNKNOWN', a, 'Authority state is not eligible for binding context.', mandatory);
      if (mandatory) diagnose('START_MANDATORY_UNAVAILABLE', a, 'Mandatory context is not eligible.', true);
      if (direct) reviewHop(a);
      return;
    }
    if (a.type === 'trap' && a.metadata.severity !== 'medium') {
      add(a, 1, 'review', source, field);
      diagnose('START_SEVERITY_UNKNOWN', a, 'Only medium trap severity is classified; retain unclassified inspection material.', true);
      return;
    }
    const supporting = ['task', 'skill', 'learning', 'trap'].includes(a.type);
    add(a, supporting ? Math.max(2, tier) : tier, supporting ? 'supporting' : 'binding', source, field);
  }
  function constraints(a: Artifact, tier: number, direct: boolean) {
    for (const l of outgoing(a, ['adrs', 'key_adrs', 'rules', 'key_rules', 'skills'])) {
      const t = target(l)!;
      const mandatory = a.type === 'project' && l.field === 'key_rules';
      choose(t, mandatory ? 0 : l.field === 'skills' ? 2 : tier, a.id, l.field, direct, mandatory);
    }
  }
  add(task, 0, 'scope', task.id, 'root');
  if (projects.length === 1 && eligible(projects[0])) {
    add(projects[0], 0, 'binding', task.id, 'project');
    constraints(projects[0], 1, false);
  } else {
    diagnose(projects.length > 1 ? 'START_PROJECT_CONFLICT' : 'START_PROJECT_UNAVAILABLE', task, 'Exactly one eligible discovered project is required.', true);
    for (const p of projects) { add(p, 0, 'review', task.id, 'project'); if (!eligible(p) && !knownReview(p)) diagnose('START_AUTHORITY_UNKNOWN', p, 'Project authority is unresolved.', true); }
  }
  if (!explicitSources) {
    const global = byPath.get('rules/GLOBAL.md');
    if (global) choose(global, 0, task.id, 'default-global', false, true);
  }
  constraints(task, 1, true);
  const directFeatures = new Set<string>();
  const featureQueue: Artifact[] = [];
  for (const l of outgoing(task, ['feature', 'features'])) {
    const a = target(l)!;
    choose(a, 1, task.id, l.field, true);
    if (eligible(a)) { directFeatures.add(a.id); featureQueue.push(a); }
  }
  const visitedFeatures = new Set<string>();
  while (featureQueue.length) {
    const a = featureQueue.shift()!;
    if (visitedFeatures.has(a.id)) continue;
    visitedFeatures.add(a.id);
    constraints(a, directFeatures.has(a.id) ? 1 : 2, false);
    for (const l of outgoing(a, ['depends_on'])) {
      const dependency = target(l)!;
      choose(dependency, 2, a.id, l.field);
      if (eligible(dependency)) featureQueue.push(dependency);
    }
  }
  const visitedTasks = new Set<string>();
  const taskQueue = [task];
  while (taskQueue.length) {
    const a = taskQueue.shift()!;
    if (visitedTasks.has(a.id)) continue;
    visitedTasks.add(a.id);
    for (const l of outgoing(a, ['depends_on'])) {
      const dependency = target(l)!;
      add(dependency, 2, 'supporting', a.id, l.field);
      taskQueue.push(dependency);
    }
  }
  for (const l of outgoing(task, ['tasks'])) add(target(l)!, 3, 'history', task.id, l.field);
  for (const l of outgoing(task, ['files'])) {
    const a = target(l);
    if (a) choose(a, a.type === 'feature' || a.type === 'adr' || a.type === 'rule' ? 1 : 2, task.id, l.field, true);
    else file(l, 3, 'evidence');
  }
  const rootFiles = new Set(outgoing(task, ['files']).map(l => l.target));
  for (const a of artifacts.filter(a => ['learning', 'trap'].includes(a.type) && (eligible(a) || retired(a)))) {
    for (const l of outgoing(a)) {
      if (l.field === 'tasks' && l.target === task.id || l.field === 'features' && directFeatures.has(l.target) || a.type === 'trap' && l.field === 'files' && rootFiles.has(l.target)) {
        choose(a, 2, l.target, `reverse:${l.field}`);
      }
    }
  }
  for (const entry of selected.values()) {
    if (conflicts.has(entry.id)) entry.role = 'conflicted';
    entry.reasons = [...new Map(entry.reasons.map(r => [serialize(r), r])).values()].sort((a, b) => compare(serialize(a), serialize(b)));
  }
  return {
    entries: [...selected.values()].sort(entryOrder), incomplete,
    refused: [...refused.values()].sort((a, b) => compare(a.id, b.id)),
    diagnostics: sortDiagnostics([...new Map(diagnostics.map(d => [serialize(d), d])).values()]),
    replacements: [...examined].sort(compare).map(key => { const edge = edgeMap.get(key)!; return { ...edge, declarations: edge.declarations.sort(compare) }; }),
  };
}
