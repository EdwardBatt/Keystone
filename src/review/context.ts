import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { compare, fail, KeystoneError, serialize, sortDiagnostics, type Artifact, type Diagnostic, type Link } from '../core.js';
import { loadConfig, type Config } from '../context/config.js';
import { discover, expectedType } from '../parser/discovery.js';
import { buildGraph } from '../graph/index.js';
import { select } from '../context/selection.js';
import { excerpt, type Entry, type Replacement } from '../context/envelope.js';
import { parseMarkdown } from '../parser/frontmatter.js';
import { asText } from './subject.js';

export interface Unidentified { path: string; type: string; reason: string; id?: string }
export interface BaseInventory {
  config: Config;
  artifacts: Artifact[];
  quarantined: Unidentified[];
  unidentified: Unidentified[];
  diagnostics: Diagnostic[];
}

const identityCodes = new Set(['ID_DUPLICATE', 'ID_INVALID']);
const linkFailures = new Set(['LINK_AMBIGUOUS', 'LINK_INVALID', 'LINK_TYPE_MISMATCH']);
const bindingTargets: Record<string, string> = { adrs: 'adr', key_adrs: 'adr', rules: 'rule', key_rules: 'rule', feature: 'feature', features: 'feature' };
const projectBinding = new Set(['adrs', 'key_adrs', 'rules', 'key_rules']);

const dedupe = (diagnostics: Diagnostic[]) => sortDiagnostics([...new Map(diagnostics.map(d => [serialize(d), d])).values()]);

function within(file: string, sources: string[]): boolean {
  return sources.some(source => file === source || file.startsWith(`${source}/`));
}

/** Base inventory with ambiguous identities quarantined; selection never sees them. */
export async function baseInventory(directory: string, unrepresentable: string[]): Promise<BaseInventory> {
  let config: Config;
  try {
    config = await loadConfig(directory);
  } catch (error) {
    fail('REVIEW_BASE_CONFIG_INVALID', '.context/config.yaml',
      `Base configuration cannot be loaded (${error instanceof KeystoneError ? error.diagnostic.code : 'IO_ERROR'}); governing context cannot be established.`);
  }
  const discovered = await discover(directory, config);
  const graph = await buildGraph(directory, discovered.artifacts);
  const found = new Set(discovered.artifacts.map(a => a.path));
  const quarantinePaths = new Set(graph.diagnostics.filter(d => identityCodes.has(d.code)).map(d => d.path));
  const quarantined = discovered.artifacts.filter(a => quarantinePaths.has(a.path))
    .map(a => ({ path: a.path, type: a.type, id: a.id, reason: 'ambiguous-identity' }));
  const unidentified = [
    ...discovered.diagnostics.filter(d => !found.has(d.path) && /\.md$/i.test(d.path))
      .map(d => ({ path: d.path, type: expectedType(d.path) ?? 'unknown', reason: d.code })),
    ...unrepresentable.filter(file => /\.md$/i.test(file) && within(file, config.sources))
      .map(file => ({ path: file, type: expectedType(file) ?? 'unknown', reason: 'unrepresentable' })),
  ];
  return {
    config,
    artifacts: discovered.artifacts.filter(a => !quarantinePaths.has(a.path)),
    quarantined: quarantined.sort((a, b) => compare(a.path, b.path)),
    unidentified: [...new Map(unidentified.map(u => [u.path, u])).values()].sort((a, b) => compare(a.path, b.path)),
    diagnostics: dedupe([...discovered.diagnostics, ...graph.diagnostics]),
  };
}

export interface ReviewContext {
  outcome: 'complete' | 'incomplete/conflicted';
  entries: Entry[];
  replacements: Replacement[];
  diagnostics: Diagnostic[];
  gaps: Diagnostic[];
  base_diagnostics: Diagnostic[];
  omissions: { id: string; path: string; reason: string }[];
}

/** ADR-0001 selection in review mode over the base inventory, anchored to the review root. */
export async function reviewContext(directory: string, inventory: BaseInventory, root: Artifact, introduced: boolean): Promise<ReviewContext> {
  const candidates = [...inventory.quarantined, ...inventory.unidentified];
  const projects = inventory.artifacts.filter(a => a.type === 'project');
  if (projects.length + candidates.filter(c => c.type === 'project').length > 1 ||
      !projects.length && candidates.some(c => c.type === 'project')) {
    fail('REVIEW_PROJECT_AMBIGUOUS', 'PROJECT.md', 'The governing project cannot be identified reliably at the base revision.');
  }
  if (!inventory.config.explicitSources && candidates.some(c => c.path === 'rules/GLOBAL.md')) {
    fail('REVIEW_BINDING_UNIDENTIFIABLE', 'rules/GLOBAL.md', 'Mandatory rules/GLOBAL.md cannot be identified at the base revision.');
  }
  const graph = await buildGraph(directory, inventory.artifacts);
  let links: Link[] = graph.links;
  let rootDiagnostics = graph.diagnostics.filter(d => d.path === root.path);
  if (introduced) {
    // The introduced root is evaluated against base, but never added to the base inventory.
    const anchored = await buildGraph(directory, [...inventory.artifacts, root]);
    links = [...graph.links, ...anchored.links.filter(l => l.source === root.id)];
    rootDiagnostics = anchored.diagnostics.filter(d => d.path === root.path);
  }
  const project = projects[0];
  const projectDiagnostics = project ? graph.diagnostics.filter(d => d.path === project.path) : [];
  const candidateTypes = new Set(candidates.map(c => c.type));
  const gaps: Diagnostic[] = [];
  for (const [owner, diagnostics] of [[root, rootDiagnostics], [project, projectDiagnostics]] as const) {
    if (!owner) continue;
    for (const d of diagnostics) {
      if (!d.field) continue;
      const target = bindingTargets[d.field];
      const binding = target && (owner === root || projectBinding.has(d.field));
      if (binding && (linkFailures.has(d.code) || d.code === 'LINK_MISSING' && (candidateTypes.has(target) || candidateTypes.has('unknown')))) {
        fail('REVIEW_BINDING_UNIDENTIFIABLE', owner.path, `Binding ${d.field} context of ${owner.id} cannot be identified reliably at the base revision (${d.code}).`);
      }
      gaps.push({ code: 'REVIEW_BASE_LINK_UNRESOLVED', path: owner.path, field: d.field, message: `${d.code}: ${d.message}` });
    }
  }
  const owners = new Set([root.path, project?.path]);
  const baseDiagnostics = dedupe([...inventory.diagnostics, ...graph.diagnostics]
    .filter(d => !(owners.has(d.path) && d.field)));
  const selection = select(root, inventory.artifacts, links, inventory.config.explicitSources === true);
  const entries: Entry[] = [];
  const omissions = [...selection.refused];
  for (const entry of selection.entries) {
    // The root is represented by requirements and claims, never repeated as context.
    if (entry.id === root.id && entry.type === 'task') continue;
    const bytes = await readFile(path.join(directory, ...entry.path.split('/')));
    if (entry.type === 'file') {
      entry.hash = createHash('sha256').update(bytes).digest('hex');
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (text.includes('\0')) throw new Error('binary');
        entry.content = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
      } catch {
        omissions.push({ id: entry.id, path: entry.path, reason: 'non-text-file' });
      }
    } else {
      // Governing artifacts are never interpreted through replacement characters.
      const text = asText(bytes);
      if (text === null) {
        if (entry.tier === 0 || entry.role === 'binding') {
          fail('REVIEW_CONTEXT_UNREADABLE', entry.path, 'Required governing context is not valid UTF-8 text and cannot be presented reliably.');
        }
        omissions.push({ id: entry.id, path: entry.path, reason: 'invalid-utf8' });
        gaps.push({ code: 'REVIEW_CONTEXT_UNREADABLE', path: entry.path, message: 'Context artifact is not valid UTF-8 text; it is represented by hash only.' });
        entries.push(entry);
        continue;
      }
      const body = parseMarkdown(text, entry.path).body;
      if (entry.type === 'adr' && entry.role === 'binding') Object.assign(entry, excerpt(body));
      else entry.content = body;
    }
    entries.push(entry);
  }
  return {
    outcome: selection.incomplete ? 'incomplete/conflicted' : 'complete',
    entries, replacements: selection.replacements, diagnostics: selection.diagnostics,
    gaps: dedupe(gaps), base_diagnostics: baseDiagnostics,
    omissions: omissions.sort((a, b) => compare(a.id, b.id)),
  };
}
