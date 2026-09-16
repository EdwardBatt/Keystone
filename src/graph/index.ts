import { lstat } from 'node:fs/promises';
import { compare, KeystoneError, serialize, type Artifact, type ArtifactType, type Diagnostic, type Link } from '../core.js';
import { isMissing, relativePath, safePath } from '../paths.js';
import { isGeneratedPath } from '../context/generated.js';

const identityPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const targetTypes: Record<string, ArtifactType[]> = {
  feature: ['feature'], features: ['feature'], tasks: ['task'], adrs: ['adr'], key_adrs: ['adr'],
  rules: ['rule'], key_rules: ['rule'], skills: ['skill'],
};

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
      const supersession = artifact.type === 'adr' && (field === 'supersedes' || field === 'superseded_by');
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
  const uniqueLinks = [...new Map(links.map(link => [serialize(link), link])).values()];
  uniqueLinks.sort((a, b) => compare(serialize(a), serialize(b)));
  return { links: uniqueLinks, diagnostics };
}
