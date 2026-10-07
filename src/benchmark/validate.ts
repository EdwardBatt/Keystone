import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { compare, sortDiagnostics, type Diagnostic } from '../core.js';
import { kinds, loadPlan, readJson, specDiagnostics } from './specs.js';
import { weightable } from './scorecard.js';
import type { Result } from './prepare.js';

async function jsonFiles(directory: string, relative = ''): Promise<string[]> {
  let entries;
  try { entries = await readdir(path.join(directory, relative), { withFileTypes: true }); } catch { return []; }
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory() && child !== 'schemas') files.push(...await jsonFiles(directory, child));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(child);
  }
  return files;
}

/** `keystone-bench validate [<plan>]`: read-only. Without a plan, checks every specification under
 * `benchmark/specification/`; with one, checks the plan and every specification it references.
 */
export async function validate(root: string, planFile?: string, repos?: string): Promise<Result> {
  if (planFile) {
    const { plan, diagnostics, unresolved } = await loadPlan(planFile, weightable, { repos, root });
    // A version 2 plan whose repositories are not on this machine is structurally valid but
    // unresolved: its bundles, and so its hash, cannot be computed here (TASK-0015 Q2).
    if (unresolved) return { command: 'validate', outcome: 'valid', plan: null, diagnostics: sortDiagnostics(diagnostics), resolved: false, id: unresolved.id };
    return { command: 'validate', outcome: plan ? 'valid' : 'invalid', plan: plan ? { id: plan.spec.id, hash: plan.hash } : null, diagnostics: sortDiagnostics(diagnostics), ...(plan?.version === 2 ? { resolved: true } : {}) };
  }
  const directory = path.join(path.resolve(root), 'benchmark', 'specification');
  const files = await jsonFiles(directory);
  const diagnostics: Diagnostic[] = [];
  for (const file of files) {
    const label = `benchmark/specification/${file}`;
    const absolute = path.join(directory, ...file.split('/'));
    const { data, diagnostics: read } = await readJson(absolute, label);
    if (read.length) { diagnostics.push(...read); continue; }
    const kind = (data as { kind?: unknown })?.kind;
    const name = typeof kind === 'string' ? kinds[kind] : undefined;
    if (!name || ['run-record', 'judgements', 'manual-record', 'locations', 'attempt-classification', 'packet-release', 'analysis-spec'].includes(name)) {
      diagnostics.push({ code: 'BENCH_SPEC_KIND_UNKNOWN', path: label, message: 'Not a task, condition, agent profile, plan, scorecard or inspection-terms specification.' });
    } else if (name === 'plan') {
      diagnostics.push(...(await loadPlan(absolute, weightable)).diagnostics.map(d => ({ ...d, path: `${label}: ${d.path}` })));
    } else {
      diagnostics.push(...await specDiagnostics(name, data, absolute, label));
    }
  }
  return { command: 'validate', outcome: diagnostics.length ? 'invalid' : 'valid', plan: null, diagnostics: sortDiagnostics(diagnostics), specifications: files.length };
}
