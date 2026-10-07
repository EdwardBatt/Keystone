#!/usr/bin/env node
/** `keystone-bench`: the Phase 7 benchmark harness (ADR-0004). It is a separate executable from the
 * `keystone` protocol CLI, and the only Keystone entry point that launches declared programs.
 */
import { prepare, type Result } from './prepare.js';
import { run, version } from './run.js';
import { record } from './record.js';
import { score } from './score.js';
import { report } from './report.js';
import { validate } from './validate.js';
import { classify, rerun } from './attempts.js';
import { verifyExposure } from './exposure.js';
import { freeze } from './freeze.js';
import { release } from './judging.js';
import { calibrate } from './calibrate.js';
import { analyze } from './analysis.js';

const help = `keystone-bench v${version} — Phase 7 benchmark harness (separate from the keystone protocol CLI)
Usage: keystone-bench <command> [options] [--root <keystone-directory>] [--work <directory>] [--repos <locations>] [--json]

  validate [<plan>]          Check specifications under benchmark/specification/, or one plan and its references (read-only)
  prepare <plan>             Fresh local clone per run at the pinned subject commit; stage declared condition files only
  run <plan> [--run <id>]... Execute condition setup, agent sessions and oracles; install durable run records
  record <run-id> --plan <plan> --input <file>
                             Capture a manual run's sessions; the next run completes its oracle check and record
  score <plan> [--blind <dir>] [--judged <file>]
                             Deterministic measures; export a blinded judging packet, or import attested judgements
  report <plan>              Balanced scorecard per arm, sources labelled; composite only from plan weights

  Version 2 plans (TASK-0015):
  rerun <run-id> --plan <plan> --classification <file>
                             Archive an owner-classified infrastructure-failed attempt (never deleted); prepare the next attempt
  classify <run-id> --plan <plan> --classification <file>
                             Record an infrastructure failure whose reruns are exhausted as terminal (missing, never an outcome)
  verify-exposure <plan>     Record the hidden-material exposure verification (launches nothing)
  freeze <plan>              Write benchmark/plans/<plan-id>/freeze.json once the freezing preconditions hold
  release <plan> --attestation <file>
                             Record the owner's review of a judging packet's inspection log before release
  calibrate <pilot-plan>     Condition-blind calibration and resource export of a pilot
  analyze <plan>             Pre-registered analysis and classification from the plan's analysis specification

  --root   Keystone directory receiving benchmark/results/ and benchmark/analysis/ (default: working directory)
  --work   Harness work directory for workspaces and run state, outside the Keystone tree
           (default: <system temp>/keystone-bench/<plan-id>)
  --repos  Machine-local locations file mapping a version 2 plan's repository IDs to paths (never hashed or recorded)
  --json   Emit one structured JSON result

A smoke plan ("purpose": "smoke") keeps its records in the work directory; it is never benchmark evidence.`;

function usage(message: string): never {
  throw Object.assign(new Error(message), { usage: true });
}

const okOutcomes = ['valid', 'prepared', 'unchanged', 'completed', 'awaiting-record', 'recorded', 'scored', 'reported', 'verified', 'frozen', 'released', 'calibrated', 'analyzed', 'classified'];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) { console.log(help); return; }
  if (args.length === 1 && args[0] === '--version') { console.log(version); return; }
  const json = args.includes('--json');
  const flags: Record<string, string | undefined> = {};
  const runs: string[] = [];
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') continue;
    if (['--root', '--work', '--plan', '--input', '--blind', '--judged', '--run', '--repos', '--classification', '--attestation'].includes(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) usage(`${arg} requires a value.`);
      i++;
      if (arg === '--run') { runs.push(value); continue; }
      if (flags[arg] !== undefined) usage(`${arg} may be given once.`);
      flags[arg] = value;
      continue;
    }
    if (arg.startsWith('-')) usage(`Unexpected argument: ${arg}. Use --help for usage.`);
    positional.push(arg);
  }
  const [command, target, ...extra] = positional;
  const allowed: Record<string, string[]> = {
    validate: ['--root', '--repos'], prepare: ['--root', '--work', '--repos'], run: ['--root', '--work', '--run', '--repos'], record: ['--root', '--work', '--plan', '--input', '--repos'],
    score: ['--root', '--work', '--blind', '--judged', '--repos'], report: ['--root', '--work', '--repos'],
    rerun: ['--root', '--work', '--plan', '--classification', '--repos'], classify: ['--root', '--work', '--plan', '--classification', '--repos'], 'verify-exposure': ['--root', '--work', '--repos'], freeze: ['--root', '--work', '--repos'],
    release: ['--root', '--work', '--attestation', '--repos'], calibrate: ['--root', '--work', '--repos'], analyze: ['--root', '--work', '--repos'],
  };
  if (!command || !allowed[command]) usage('Expected validate, prepare, run, record, score, report, rerun, classify, verify-exposure, freeze, release, calibrate or analyze. Use --help for usage.');
  const given = [...Object.keys(flags).filter(f => flags[f] !== undefined), ...(runs.length ? ['--run'] : [])];
  const misplaced = given.filter(f => !allowed[command].includes(f));
  if (misplaced.length) usage(`${misplaced.join(', ')} not supported by ${command}.`);
  const byRun = command === 'record' || command === 'rerun' || command === 'classify';
  if (extra.length || command !== 'validate' && !target) usage(`Expected ${command} ${byRun ? '<run-id>' : '<plan>'}.`);
  const root = flags['--root'] ?? process.cwd();
  const work = flags['--work'];
  const repos = flags['--repos'];
  let result: Result;
  if (command === 'validate') result = await validate(root, target, repos);
  else if (command === 'prepare') result = await prepare(target, root, work, repos);
  else if (command === 'run') result = await run(target, root, work, runs, repos);
  else if (command === 'record') {
    if (!flags['--plan'] || !flags['--input']) usage('record requires --plan <plan> and --input <file>.');
    result = await record(target, flags['--plan'], root, work, flags['--input'], repos);
  } else if (command === 'score') {
    if (flags['--blind'] && flags['--judged']) usage('Use --blind or --judged, not both.');
    result = await score(target, root, work, { blind: flags['--blind'], judged: flags['--judged'], repos });
  } else if (command === 'report') result = await report(target, root, work, repos);
  else if (command === 'rerun') {
    if (!flags['--plan'] || !flags['--classification']) usage('rerun requires --plan <plan> and --classification <file>.');
    result = await rerun(target, flags['--plan'], root, work, flags['--classification'], repos);
  } else if (command === 'classify') {
    if (!flags['--plan'] || !flags['--classification']) usage('classify requires --plan <plan> and --classification <file>.');
    result = await classify(target, flags['--plan'], root, work, flags['--classification'], repos);
  } else if (command === 'verify-exposure') result = await verifyExposure(target, root, work, repos);
  else if (command === 'freeze') result = await freeze(target, root, work, repos);
  else if (command === 'release') {
    if (!flags['--attestation']) usage('release requires --attestation <file>.');
    result = await release(target, root, work, flags['--attestation'], repos);
  } else if (command === 'calibrate') result = await calibrate(target, root, work, repos);
  else result = await analyze(target, root, work, repos);
  const ok = okOutcomes.includes(result.outcome);
  if (json) console.log(JSON.stringify({ ok, ...result }));
  else {
    console.log(`keystone-bench ${result.command}: ${result.outcome}.${result.plan ? ` Plan ${result.plan.id} (${result.plan.hash.slice(0, 12)}).` : ''}`);
    for (const d of result.diagnostics) console.error(`${d.code} ${d.path}${d.field ? `:${d.field}` : ''}: ${d.message}`);
    if (Array.isArray(result.runs)) for (const r of result.runs as { run_id: string; outcome?: string }[]) if (r.outcome) console.log(`  ${r.run_id}: ${r.outcome}`);
    if (typeof result.work === 'string') console.log(`Work directory: ${result.work}`);
    if (typeof result.next === 'string') console.log(`Next: ${result.next}`);
  }
  process.exitCode = ok ? 0 : result.outcome === 'failed' ? 2 : 1;
}

main().catch(error => {
  const isUsage = (error as { usage?: boolean }).usage === true;
  const diagnostic = { code: isUsage ? 'BENCH_USAGE' : 'BENCH_INTERNAL_ERROR', path: '.', message: isUsage ? (error as Error).message : 'Unexpected harness failure.' };
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, command: null, outcome: 'failed', plan: null, diagnostics: [diagnostic] }));
  else console.error(`${diagnostic.code}: ${diagnostic.message}`);
  process.exitCode = 2;
});
