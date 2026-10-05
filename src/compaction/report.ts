import { compare, type Artifact, type Link } from '../core.js';
import { eligible, retired } from '../context/selection.js';

export interface RetiredEntry {
  id: string; type: string; path: string;
  task: string | null; reason: string | null; previous_status: string | null;
  superseded_by: string[];
  /** Binding under START semantics before retirement (status and, for traps, medium severity). */
  was_binding: boolean;
  /** Where the successor chain ends: non-retired artifacts, or retired artifacts with no successor. */
  endpoints: string[];
  /** The artifact was (or may have been) binding under START semantics and no binding knowledge remains at the end of its chain. */
  binding_removal: boolean;
}

export interface CompactionReport {
  /** Candidate learnings and proposed traps whose linked tasks are all accepted. */
  stale_candidates: { id: string; type: string; path: string; tasks: string[] }[];
  /** Binding learnings and traps per linked task and feature; `unlinked` has neither. */
  binding: { by_task: Record<string, string[]>; by_feature: Record<string, string[]>; unlinked: string[] };
  retired: RetiredEntry[];
  binding_removals: string[];
}

/** Knowledge that START binds: an accepted learning, or an active trap with classified (medium) severity. */
export const binding = (a: Artifact) => (a.type === 'learning' || a.type === 'trap') && eligible(a) &&
  (a.type === 'learning' || a.metadata.severity === 'medium');

/**
 * Whether a retired artifact was binding before retirement, under START semantics: an accepted
 * learning, or an active trap with classified (medium) severity. Severity is unchanged by retirement,
 * so it is read from the artifact. A hand-authored record without `previous_status` is treated as
 * possibly binding unless severity rules it out.
 */
const wasBinding = (a: Artifact, status: string | null) => (a.type === 'learning' || a.metadata.severity === 'medium') &&
  (status === null || (a.type === 'learning' ? status === 'accepted' : status === 'active'));

/** Deterministic, read-only compaction signals over a structurally valid inventory. */
export function compactionReport(artifacts: Artifact[], links: Link[]): CompactionReport {
  const byId = new Map(artifacts.map(a => [a.id, a]));
  const targets = (id: string, field: string) => links.filter(l => l.source === id && l.field === field).map(l => l.target).sort(compare);
  const knowledge = artifacts.filter(a => a.type === 'learning' || a.type === 'trap').sort((a, b) => compare(a.id, b.id));

  const stale_candidates = knowledge
    .filter(a => a.type === 'learning' ? a.metadata.status === 'candidate' : a.metadata.status === 'proposed')
    .map(a => ({ id: a.id, type: a.type, path: a.path, tasks: targets(a.id, 'tasks') }))
    .filter(c => c.tasks.length && c.tasks.every(id => byId.get(id)?.metadata.status === 'accepted'));

  // Grouping uses Maps: artifact IDs such as `constructor` or `toString` must never meet inherited
  // object properties. The output objects are built from own data properties only.
  const by_task = new Map<string, string[]>();
  const by_feature = new Map<string, string[]>();
  const group = (groups: Map<string, string[]>, key: string, id: string) => {
    const members = groups.get(key);
    if (members) members.push(id); else groups.set(key, [id]);
  };
  const unlinked: string[] = [];
  for (const a of knowledge.filter(binding)) {
    const tasks = targets(a.id, 'tasks');
    const features = targets(a.id, 'features');
    for (const id of tasks) group(by_task, id, a.id);
    for (const id of features) group(by_feature, id, a.id);
    if (!tasks.length && !features.length) unlinked.push(a.id);
  }
  const sorted = (groups: Map<string, string[]>): Record<string, string[]> =>
    Object.fromEntries([...groups].sort(([a], [b]) => compare(a, b)));

  const retiredEntries = knowledge.filter(retired).map((a): RetiredEntry => {
    const record = (a.metadata.retirement ?? {}) as { task?: string; reason?: string; previous_status?: string };
    const endpoints = new Set<string>();
    const visited = new Set<string>();
    const pending = [a.id];
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const node = byId.get(id);
      const next = node && retired(node) ? targets(id, 'superseded_by') : [];
      if (next.length) pending.push(...next);
      else endpoints.add(id);
    }
    const ends = [...endpoints].sort(compare);
    const previous = record.previous_status ?? null;
    return {
      id: a.id, type: a.type, path: a.path, task: record.task ?? null, reason: record.reason ?? null, previous_status: previous,
      superseded_by: targets(a.id, 'superseded_by'), endpoints: ends,
      was_binding: wasBinding(a, previous),
      binding_removal: wasBinding(a, previous) && !ends.some(id => { const end = byId.get(id); return end !== undefined && binding(end); }),
    };
  });

  return {
    stale_candidates,
    binding: { by_task: sorted(by_task), by_feature: sorted(by_feature), unlinked },
    retired: retiredEntries,
    binding_removals: retiredEntries.filter(r => r.binding_removal).map(r => r.id),
  };
}
