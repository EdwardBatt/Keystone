import { compare, type Artifact, type Link } from '../core.js';
import { relativePath } from '../paths.js';

const list = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const portable = (file: string): string => { try { return relativePath(file); } catch { return file; } };

/**
 * Provenance a successor must contain (ADR-0003 guarantee 5); returns the missing entries.
 * Tasks compare by resolved identity, so an ID and a path to the same task match. Evidence compares
 * as exact strings. Trap `files` compare as declared (normalized) paths, not graph edges, because
 * the graph deliberately creates no edge for generated paths and those must be preserved too.
 */
export function missingProvenance(predecessor: Artifact, successor: Artifact, links: Link[]): string[] {
  const tasks = (id: string) => new Set(links.filter(l => l.source === id && l.field === 'tasks').map(l => l.target));
  const missing: string[] = [];
  const heldTasks = tasks(successor.id);
  for (const task of [...tasks(predecessor.id)].sort(compare)) if (!heldTasks.has(task)) missing.push(`tasks: ${task}`);
  if (predecessor.type === 'trap') {
    const heldFiles = new Set(list(successor.metadata.files).map(portable));
    for (const file of list(predecessor.metadata.files).map(portable)) if (!heldFiles.has(file)) missing.push(`files: ${file}`);
  }
  const heldEvidence = new Set(list(successor.metadata.evidence));
  for (const entry of list(predecessor.metadata.evidence)) if (!heldEvidence.has(entry)) missing.push(`evidence: ${entry}`);
  return missing;
}
