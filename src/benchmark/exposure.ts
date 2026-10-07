import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { compare, type Diagnostic } from '../core.js';
import { type LoadedPlan } from './specs.js';
import { baseEnvironment } from './process.js';
import { evidenceHash, physical, readJsonFile, sealRecord, within, writeVerified } from './store.js';
import { open, type Context, type Result } from './prepare.js';

/** Hidden-material exposure verification (TASK-0015 item 10, clarification 6). Launches nothing. It
 * checks, within the accepted boundary (agent sessions are not sandboxed), that nothing the harness or
 * the profiles give an agent exposes benchmark-repository material or later session prompts.
 */

export const residualRisk = 'Filesystem-permission isolation is not claimed. Agent sessions are not sandboxed (ADR-0004 guarantee 2); an agent that searches the disk is outside this boundary.';
const ownerAttestations = [
  'No condition instruction or session prompt references the benchmark repository or its location.',
  'The benchmark repository is not discoverable through agent-tool configuration on the trial machine.',
];

interface Check { id: string; description: string; passed: boolean; findings: number }

async function filesUnder(directory: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => compare(a.name, b.name))) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(child); else if (entry.isFile()) out.push(child);
    }
  };
  try { await walk(directory); } catch { /* Absent. */ }
  return out;
}

const normal = (text: string) => text.replace(/^﻿/, '').replace(/\s+/g, ' ').trim().toLowerCase();

async function checks(plan: LoadedPlan, work: string): Promise<Check[]> {
  const bench = plan.benchmark;
  const benchPath = bench ? await physical(bench.path) : null;
  const inBench = (directory: string) => !!benchPath && within(bench!.path, directory);
  const needles = bench ? [bench.path, benchPath!, bench.id].map(s => s.toLowerCase()) : [];
  const names = (argv: string[]) => argv.filter(arg => needles.some(n => arg.toLowerCase().includes(n))).length;

  // E1: profile commands, version commands and passed-through variables name no benchmark-repository
  // location, and no declared command expands a placeholder into a benchmark-repository bundle.
  let e1 = 0;
  for (const profile of plan.profiles) {
    const argv = [...(profile.spec.command ?? []), ...(profile.spec.version?.command ?? []), ...(profile.spec.env?.pass ?? [])];
    e1 += names(argv);
    if (inBench(profile.directory) && [...(profile.spec.command ?? [])].some(a => a.includes('{profile}'))) e1++;
    // The values every session actually inherits (allow-listed and passed-through variables) are
    // inspected too. They are only counted: no value enters a diagnostic or the record.
    const inherited = await baseEnvironment(profile.spec.env?.pass ?? []);
    e1 += Object.values(inherited.variables).filter(value => needles.some(n => value.toLowerCase().includes(n))).length;
  }
  for (const condition of plan.conditions) {
    for (const tool of condition.spec.tools) {
      e1 += names(tool.command);
      // Tool shims sit on the session PATH, so their expanded arguments are visible to the agent.
      if (inBench(condition.directory) && tool.command.some(a => a.includes('{condition}'))) e1++;
    }
  }
  // E2: manual mode writes every prompt in advance, so no profile may be manual.
  const e2 = plan.profiles.filter(p => p.spec.mode === 'manual').length;
  // E3: condition-staged files carry no hidden task material: statements, later session prompts,
  // fix prompts, oracle files, rubric or judge-prompt files.
  const hidden: string[] = [];
  for (const task of plan.tasks) {
    const first = task.spec.sessions[0]?.prompt;
    for (const file of await filesUnder(task.directory)) {
      if (path.basename(file) === 'task.json' || first && path.resolve(file) === path.resolve(task.directory, ...first.split('/'))) continue;
      hidden.push(normal(await readFile(file, 'utf8')));
    }
    for (const oracle of task.spec.oracles) hidden.push(normal(oracle.command.join(' ')));
  }
  if (plan.judging) for (const directory of [plan.judging.rubric.directory, plan.judging.prompt.directory]) for (const file of await filesUnder(directory)) hidden.push(normal(await readFile(file, 'utf8')));
  // No length exemption: any non-empty hidden text found in a staged file fails the check. Short
  // material may match by coincidence; such a failure is resolved by restructuring the staged file
  // or the hidden material, never by exempting it from certification.
  const secrets = [...new Set(hidden.filter(h => h.length > 0))];
  let e3 = 0;
  for (const condition of plan.conditions) {
    for (const entry of condition.spec.setup.files) {
      const staged = normal(await readFile(path.join(condition.directory, ...entry.from.split('/')), 'utf8'));
      e3 += secrets.filter(s => staged.includes(s)).length;
    }
  }
  // E4: the benchmark repository lies outside the work directory, the subject and every workspace,
  // and on no entry of the base PATH every session inherits.
  let e4 = 0;
  if (benchPath) {
    const [workPath, subjectPath] = await Promise.all([physical(work), physical(plan.subjectPath)]);
    if (within(benchPath, workPath) || within(workPath, benchPath)) e4++;
    if (within(benchPath, subjectPath) || within(subjectPath, benchPath)) e4++;
    for (const entry of (await baseEnvironment([])).path) if (within(benchPath, await physical(entry))) e4++;
  }
  // E5: workspaces are cloned from the subject only; the subject is not the benchmark repository.
  const e5 = bench && bench.id === plan.subject.id ? 1 : 0;
  // E6: a harness invariant, asserted by test: each automated session's prompt is written just before
  // that session launches. It holds whenever no profile is manual (E2).
  return [
    { id: 'E1', description: 'Profile and tool commands, version commands, passed-through variable names and every inherited variable value expose no benchmark-repository location or bundle.', passed: e1 === 0, findings: e1 },
    { id: 'E2', description: 'No manual profile (manual mode writes every prompt in advance).', passed: e2 === 0, findings: e2 },
    { id: 'E3', description: 'Condition-staged files contain no statement, later session prompt, fix prompt, oracle, rubric or judge-prompt text, of any length.', passed: e3 === 0, findings: e3 },
    { id: 'E4', description: 'The benchmark repository lies outside the work directory, the subject and every workspace, and on no base PATH entry.', passed: e4 === 0, findings: e4 },
    { id: 'E5', description: 'Workspaces are cloned from the subject only; the subject is not the benchmark repository.', passed: e5 === 0, findings: e5 },
    { id: 'E6', description: 'Only the current session prompt is written before each launch (harness invariant; holds when E2 passes).', passed: e2 === 0, findings: e2 },
  ];
}

export const exposureFile = (context: Context) => path.join(context.where.results, 'verification', `exposure-${context.plan.hash.slice(0, 16)}.json`);

/** A passing, intact exposure verification for the plan's current hash. */
export async function exposureVerified(context: Context): Promise<{ hash: string } | null> {
  const record = await readJsonFile<Record<string, any>>(exposureFile(context));
  if (!record || record.kind !== 'keystone-bench-exposure-verification' || record.evidence_hash !== evidenceHash(record)) return null;
  return record.plan?.hash === context.plan.hash && record.passed === true ? { hash: record.evidence_hash } : null;
}

/** `keystone-bench verify-exposure <plan>`: records the hidden-material exposure verification. */
export async function verifyExposure(planFile: string, root: string, work: string | undefined, repos?: string): Promise<Result> {
  const opened = await open('verify-exposure', planFile, root, work, { repos });
  if (!opened.context) return opened.result!;
  const context = opened.context;
  const { plan } = context;
  const identity = { id: plan.spec.id, hash: plan.hash };
  if (plan.version !== 2) return { command: 'verify-exposure', outcome: 'blocked', plan: identity, diagnostics: [{ code: 'BENCH_EXPOSURE_UNSUPPORTED', path: plan.spec.id, message: 'Exposure verification applies to version 2 plans.' }] };
  const results = await checks(plan, context.where.work);
  const passed = results.every(c => c.passed);
  const record = {
    kind: 'keystone-bench-exposure-verification', schema_version: 1, plan: identity, date: new Date().toISOString().slice(0, 10),
    checks: results, passed,
    owner_attestations: ownerAttestations.map(statement => ({ statement, attested: false })),
    residual_risk: residualRisk,
  };
  const failure = await writeVerified(exposureFile(context), sealRecord(record), context.where.boundaries.results);
  if (failure) return { command: 'verify-exposure', outcome: 'failed', plan: identity, diagnostics: failure.diagnostics };
  const diagnostics: Diagnostic[] = results.filter(c => !c.passed).map(c => ({ code: 'BENCH_EXPOSURE_CHECK_FAILED', path: c.id, message: `${c.description} (${c.findings} finding(s)).` }));
  return { command: 'verify-exposure', outcome: passed ? 'verified' : 'invalid', plan: identity, diagnostics, checks: results, record: exposureFile(context) };
}
