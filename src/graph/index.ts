import { lstat } from 'node:fs/promises';
import { compare, KeystoneError, serialize, type Artifact, type ArtifactType, type Diagnostic, type Link } from '../core.js';
import { isMissing, relativePath, safePath } from '../paths.js';
import { isGeneratedPath } from '../context/generated.js';
import { missingProvenance } from '../compaction/provenance.js';

const identityPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const targetTypes: Record<string, ArtifactType[]> = {
  feature: ['feature'], features: ['feature'], tasks: ['task'], adrs: ['adr'], key_adrs: ['adr'],
  rules: ['rule'], key_rules: ['rule'], skills: ['skill'],
};

const retirable = (artifact: Artifact) => artifact.type === 'learning' || artifact.type === 'trap';

/** ADR-0003 standing invariants: retirement records and successor containment of the provenance chain. */
function retirementDiagnostics(artifacts: Artifact[], links: Link[], byId: Map<string, Artifact[]>, byPath: Map<string, Artifact>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const ids = new Map(artifacts.map(a => [a.id, a]));
  for (const artifact of artifacts.filter(retirable)) {
    const retired = artifact.metadata.status === 'retired';
    const record = artifact.metadata.retirement as { task?: string } | undefined;
    const successors = artifact.metadata.superseded_by;
    if (retired && record === undefined) {
      diagnostics.push({ code: 'RETIREMENT_RECORD_MISSING', path: artifact.path, field: 'retirement', message: 'A retired learning or trap requires a retirement record naming its task and reason.' });
    }
    if (!retired && record !== undefined) {
      diagnostics.push({ code: 'RETIREMENT_RECORD_UNEXPECTED', path: artifact.path, field: 'retirement', message: 'Only a retired learning or trap carries a retirement record; retirement is terminal.' });
    }
    // An empty list declares no successor.
    if (!retired && Array.isArray(successors) && successors.length) {
      diagnostics.push({ code: 'SUPERSESSION_NOT_RETIRED', path: artifact.path, field: 'superseded_by', message: 'Only a retired learning or trap may declare superseded_by.' });
    }
    if (record?.task !== undefined) {
      let matches = byId.get(record.task) ?? [];
      if (!matches.length) {
        try { const target = byPath.get(relativePath(record.task)); if (target) matches = [target]; } catch { /* Reported as missing below. */ }
      }
      if (matches.length !== 1) {
        diagnostics.push({ code: matches.length ? 'LINK_AMBIGUOUS' : 'LINK_MISSING', path: artifact.path, field: 'retirement.task', message: `Cannot resolve unique artifact: ${record.task}.` });
      } else if (matches[0].type !== 'task') {
        diagnostics.push({ code: 'LINK_TYPE_MISMATCH', path: artifact.path, field: 'retirement.task', message: `Reference ${record.task} must target task.` });
      }
    }
  }
  for (const link of links.filter(l => l.field === 'superseded_by' && retirable(ids.get(l.source)!))) {
    const predecessor = ids.get(link.source)!;
    const successor = ids.get(link.target)!;
    if (predecessor.id === successor.id) continue;
    const missing = missingProvenance(predecessor, successor, links);
    if (missing.length) {
      diagnostics.push({ code: 'SUCCESSION_CONTAINMENT_BROKEN', path: successor.path, field: 'superseded_by',
        message: `Successor ${successor.id} does not contain the provenance of ${predecessor.id} (${missing.join('; ')}).` });
    }
  }
  return diagnostics;
}

export async function buildGraph(root: string, artifacts: Artifact[]): Promise<{ links: Link[]; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const byId = new Map<string, Artifact[]>();
  const byPath = new Map(artifacts.map(artifact => [artifact.path, artifact]));
  const links: Link[] = [];
  const successors = new Map<string, Set<string>>();
  for (const artifact of artifacts) {
    const pathIdentity = (artifact.type === 'rule' || artifact.type === 'skill') && artifact.id === artifact.path;
    if (!pathIdentity && !identityPattern.test(artifact.id)) {
      diagnostics.push({ code: 'ID_INVALID', path: artifact.path, message: 'IDs must be portable nonempty tokens: letters, numbers, dot, underscore, hyphen.' });
    }
    const entries = byId.get(artifact.id) ?? [];
    entries.push(artifact);
    byId.set(artifact.id, entries);
  }
  for (const [id, entries] of byId) {
    if (entries.length > 1) {
      for (const artifact of entries) diagnostics.push({ code: 'ID_DUPLICATE', path: artifact.path, message: `Duplicate artifact ID: ${id}.` });
    }
  }

  for (const artifact of artifacts) {
    for (const [field, value] of Object.entries(artifact.metadata).sort(([a], [b]) => compare(a, b))) {
      // A feature's `feature` field is its identity, not a relationship.
      if (field === 'feature' && artifact.type === 'feature') continue;
      // ADRs interpret both directions; learnings and traps interpret only `superseded_by` (ADR-0003).
      const supersession = artifact.type === 'adr' && (field === 'supersedes' || field === 'superseded_by') ||
        retirable(artifact) && field === 'superseded_by';
      const expected = field === 'depends_on' || supersession ? [artifact.type] :
        Object.hasOwn(targetTypes, field) ? targetTypes[field] : undefined;
      if (!expected && field !== 'files') continue;
      const references = typeof value === 'string' ? [value] : Array.isArray(value) ? value as string[] : [];
      for (const reference of references) {
        if (field === 'files') {
          try {
            const target = relativePath(reference);
            // Preserve the mention in metadata, but never depend on generated output.
            if (isGeneratedPath(target)) continue;
            const stat = await lstat(await safePath(root, target));
            if (!stat.isFile()) {
              diagnostics.push({ code: 'FILE_NOT_REGULAR', path: artifact.path, field, message: `Referenced path is not a file: ${target}.` });
              continue;
            }
            links.push({ source: artifact.id, field, target, kind: 'file' });
          } catch (error) {
            diagnostics.push(error instanceof KeystoneError ? { ...error.diagnostic, path: artifact.path, field } : {
              code: isMissing(error) ? 'FILE_MISSING' : 'IO_ERROR', path: artifact.path, field,
              message: `Cannot read referenced file: ${reference}.`,
            });
          }
          continue;
        }
        let matches = byId.get(reference) ?? [];
        if (!matches.length) {
          try {
            const target = byPath.get(relativePath(reference));
            if (target) matches = [target];
          } catch (error) {
            diagnostics.push({ code: 'LINK_INVALID', path: artifact.path, field, message: `Invalid reference: ${reference}.` });
            continue;
          }
        }
        if (matches.length !== 1) {
          diagnostics.push({ code: matches.length ? 'LINK_AMBIGUOUS' : 'LINK_MISSING', path: artifact.path, field, message: `Cannot resolve unique artifact: ${reference}.` });
          continue;
        }
        const target = matches[0];
        if (!expected!.includes(target.type)) {
          diagnostics.push({ code: 'LINK_TYPE_MISMATCH', path: artifact.path, field, message: `Reference ${reference} must target ${expected!.join(' or ')}.` });
          continue;
        }
        links.push({ source: artifact.id, field, target: target.id, kind: 'artifact' });
        if (supersession) {
          if (artifact.id === target.id) {
            diagnostics.push({ code: 'SUPERSESSION_SELF', path: artifact.path, field, message: 'An artifact cannot supersede itself.' });
          } else {
            const [older, newer] = field === 'supersedes' ? [target.id, artifact.id] : [artifact.id, target.id];
            const next = successors.get(older) ?? new Set<string>();
            next.add(newer);
            successors.set(older, next);
          }
        }
      }
    }
  }

  // Iterative reachability avoids recursion limits and detects every member of a cycle.
  for (const id of [...successors.keys()].sort(compare)) {
    const pending = [...successors.get(id)!];
    const visited = new Set<string>();
    while (pending.length) {
      const next = pending.pop()!;
      if (next === id) {
        diagnostics.push({ code: 'SUPERSESSION_CYCLE', path: byId.get(id)![0].path, message: `Supersession cycle includes ${id}.` });
        break;
      }
      if (visited.has(next)) continue;
      visited.add(next);
      pending.push(...successors.get(next) ?? []);
    }
  }
  diagnostics.push(...retirementDiagnostics(artifacts, links, byId, byPath));
  const uniqueLinks = [...new Map(links.map(link => [serialize(link), link])).values()];
  uniqueLinks.sort((a, b) => compare(serialize(a), serialize(b)));
  return { links: uniqueLinks, diagnostics };
}
