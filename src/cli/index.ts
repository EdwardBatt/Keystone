#!/usr/bin/env node
import { inspect, writeIndex } from '../commands/index.js';
import { fail, KeystoneError, type Diagnostic } from '../core.js';
import { adapters, initialize, type Adapter } from '../commands/init.js';
import { contextStatus } from '../commands/status.js';
import { start } from '../commands/start.js';
import { review, type ReviewType } from '../commands/review.js';
import { close } from '../commands/close.js';
import { compact, type RetireRequest } from '../commands/compact.js';

const help = `Keystone v0.1 — through Phase 6
Usage: keystone <index|validate|init|context status|start TASK-ID|review TASK-ID|close TASK-ID|compact> [--root <directory>] [--json]

  index       Validate artifacts and rebuild .context/index.json
  validate    Check artifact schemas, IDs, links, and supersession (read-only)
  init        Create missing scaffold at the Git root, validate, and build the index
  context status  Report configuration, artifact counts, validation, and index freshness (read-only)
  start TASK-ID   Compile deterministic task context; does not authorize implementation
  review TASK-ID  Prepare isolated review evidence packages; never determines a verdict
              --type code|architecture|context|all (default all), --base <rev> (default HEAD)
  close TASK-ID   Close after a current three-role approve review gate; never promotes implicitly
              --promote <ID> (repeatable), --override <reason> (records reason; never alters verdicts)
  compact     Report compaction signals (read-only); with operations, retire learnings or traps
              --task <TASK-ID> (an active task) with one or more groups of
              --retire <ID> --reason <text> [--by <successor ID>]; all-or-nothing, never deletes
  --root      Target directory (defaults to the working directory)
              init/status detect its containing Git root; index/validate/start/compact use it directly;
              review/close require the Git top-level
  --adapter   init only: offer codex, claude, or gemini (repeat to select several)
              AGENTS.md is always created if missing; Claude/Gemini adapters are opt-in
  --force     init only: reset config.yaml; existing project knowledge is preserved
  --json      Emit one structured JSON result
  --help      Show this help
  --version   Show the package version

context explain is not implemented.`;

const args = process.argv.slice(2);
const json = args.includes('--json');
let command: string | undefined;

function report(diagnostics: Diagnostic[], count = 0, changed?: boolean): void {
  if (json) {
    console.log(JSON.stringify({ command: command ?? null, ok: diagnostics.length === 0,
      artifact_count: count, diagnostics, ...(changed === undefined ? {} : { changed, index: '.context/index.json' }) }));
  } else if (diagnostics.length) {
    for (const diagnostic of diagnostics) console.error(`${diagnostic.code} ${diagnostic.path}${diagnostic.field ? `:${diagnostic.field}` : ''}: ${diagnostic.message}`);
  } else {
    console.log(`${command === 'index' ? changed ? 'Index written' : 'Index unchanged' : 'Validation passed'}: ${count} artifact(s).`);
  }
}

async function main(): Promise<void> {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h') || args.length === 2 && args[0] === 'init' && args[1] === '--help') { console.log(help); return; }
  if (args.length === 1 && args[0] === '--version') { console.log('0.1.0'); return; }
  let root = process.cwd();
  let rootSpecified = false;
  let force = false;
  let reviewType: ReviewType | undefined;
  let base: string | undefined;
  const promote: string[] = [];
  let override: string | undefined;
  let compactTask: string | undefined;
  const retire: RetireRequest[] = [];
  const takes = (i: number) => args[i + 1] !== undefined && !args[i + 1].startsWith('--');
  const selected: Adapter[] = [];
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') continue;
    if (arg === '--root' && !rootSpecified && args[i + 1] && !args[i + 1].startsWith('--')) {
      root = args[++i]; rootSpecified = true; continue;
    }
    if (arg === '--force') { force = true; continue; }
    if (arg === '--type' && reviewType === undefined && ['code', 'architecture', 'context', 'all'].includes(args[i + 1])) {
      reviewType = args[++i] as ReviewType; continue;
    }
    if (arg === '--base' && base === undefined && args[i + 1] && !args[i + 1].startsWith('-')) { base = args[++i]; continue; }
    if (arg === '--promote' && args[i + 1] && !args[i + 1].startsWith('-')) { promote.push(args[++i]); continue; }
    if (arg === '--override' && override === undefined && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) {
      override = args[++i];
      if (!override.trim()) fail('CLI_USAGE', '.', '--override requires a non-blank reason.');
      continue;
    }
    if (arg === '--task' && compactTask === undefined && takes(i) && args[i + 1].trim()) { compactTask = args[++i]; continue; }
    if (arg === '--retire' && takes(i)) { retire.push({ id: args[++i], reason: '' }); continue; }
    if (arg === '--reason' && takes(i)) {
      const current = retire.at(-1);
      if (!current || current.reason) fail('CLI_USAGE', '.', '--reason must follow its --retire, once.');
      current.reason = args[++i];
      if (!current.reason.trim()) fail('CLI_USAGE', '.', '--reason requires a non-blank reason.');
      continue;
    }
    if (arg === '--by' && takes(i)) {
      const current = retire.at(-1);
      if (!current || current.by !== undefined) fail('CLI_USAGE', '.', '--by must follow its --retire, once.');
      current.by = args[++i];
      continue;
    }
    if (arg === '--adapter' && args[i + 1] && adapters.includes(args[i + 1] as Adapter)) {
      selected.push(args[++i] as Adapter); continue;
    }
    if (!arg.startsWith('-')) { positional.push(arg); continue; }
    fail('CLI_USAGE', '.', `Unexpected argument: ${arg}. Use --help for usage.`);
  }
  command = positional[0];
  // Flag scope is a usage error even on commands that are not implemented.
  if (command !== 'compact' && (compactTask !== undefined || retire.length)) fail('CLI_USAGE', '.', '--task, --retire, --reason and --by are only supported by compact.');
  if (command === 'context' && positional[1] === 'explain') {
    fail('COMMAND_NOT_IMPLEMENTED', '.', `${positional.join(' ')} is outside Phase 6.`);
  }
  if (command !== 'close' && (promote.length || override !== undefined)) fail('CLI_USAGE', '.', '--promote and --override are only supported by close.');
  if (command !== 'review' && (reviewType !== undefined || base !== undefined)) fail('CLI_USAGE', '.', '--type and --base are only supported by review.');
  if (command !== 'init' && (force || selected.length)) fail('CLI_USAGE', '.', '--force and --adapter are only supported by init.');
  if (command === 'start') {
    if (positional.length !== 2) fail('CLI_USAGE', '.', 'Expected start TASK-ID.');
    const result = await start(root, positional[1]);
    if (json) console.log(JSON.stringify({ command, ok: result.outcome === 'complete', ...result }));
    else {
      console.log(`START ${result.task_id}: ${result.outcome}. Implementation authorization is not established.`);
      for (const d of result.diagnostics) console.error(`${d.code} ${d.path}: ${d.message}`);
      if (result.installed) console.log(`Context ${result.changed ? 'written' : 'unchanged'}: .context/current-envelope.json`);
      if (result.envelope?.budget.exceeded) console.log('Target budget exceeded; mandatory content retained.');
      if (result.envelope?.omissions.length) console.log(`${result.envelope.omissions.length} body omission(s); inspect envelope for reasons.`);
    }
    process.exitCode = result.outcome === 'complete' ? 0 : result.outcome === 'failed' ? 2 : 1;
    return;
  }
  if (command === 'close') {
    if (positional.length !== 2) fail('CLI_USAGE', '.', 'Expected close TASK-ID.');
    const result = await close(root, positional[1], { promote, override });
    if (json) console.log(JSON.stringify({ command, ok: result.outcome === 'closed' || result.outcome === 'already-closed', ...result }));
    else {
      console.log(`CLOSE ${result.task_id}: ${result.outcome}${result.gate ? ` (review gate ${result.gate})` : ''}.`);
      for (const d of result.diagnostics) console.error(`${d.code} ${d.path}: ${d.message}`);
      if (result.promoted.length) console.log(`Promoted: ${result.promoted.join(', ')}`);
      if (result.unpromoted.length) console.log(`Remaining candidates: ${result.unpromoted.join(', ')}`);
    }
    process.exitCode = result.outcome === 'closed' || result.outcome === 'already-closed' ? 0 : result.outcome === 'blocked' ? 1 : 2;
    return;
  }
  if (command === 'compact') {
    if (positional.length !== 1) fail('CLI_USAGE', '.', 'Expected compact with no positional arguments.');
    if (retire.some(r => !r.reason)) fail('CLI_USAGE', '.', 'Each --retire requires a non-blank --reason.');
    if (retire.length && compactTask === undefined) fail('CLI_USAGE', '.', 'Retirement operations require --task <TASK-ID>.');
    if (!retire.length && compactTask !== undefined) fail('CLI_USAGE', '.', '--task applies only to retirement operations.');
    const result = await compact(root, { task: compactTask, retire });
    const ok = ['reported', 'compacted', 'unchanged'].includes(result.outcome);
    if (json) console.log(JSON.stringify({ command, ok, ...result }));
    else {
      console.log(`COMPACT: ${result.outcome}.`);
      for (const d of result.diagnostics) console.error(`${d.code} ${d.path}: ${d.message}`);
      if (result.retired.length) console.log(`Retired: ${result.retired.join(', ')}`);
      if (result.unchanged.length) console.log(`Already retired identically: ${result.unchanged.join(', ')}`);
      if (result.report) {
        const r = result.report;
        console.log(`Stale candidates: ${r.stale_candidates.map(c => c.id).join(', ') || 'none'}`);
        console.log(`Retired: ${r.retired.length}. Binding removals: ${r.binding_removals.join(', ') || 'none'}`);
        console.log(`Binding knowledge by task: ${Object.entries(r.binding.by_task).map(([task, ids]) => `${task} (${ids.length})`).join(', ') || 'none'}`);
      }
    }
    process.exitCode = ok ? 0 : result.outcome === 'blocked' ? 1 : 2;
    return;
  }
  if (command === 'review') {
    if (positional.length !== 2) fail('CLI_USAGE', '.', 'Expected review TASK-ID.');
    const result = await review(root, positional[1], { type: reviewType, base });
    if (json) console.log(JSON.stringify({ command, ok: result.outcome === 'complete', task_id: result.task_id, outcome: result.outcome,
      evidence_hash: result.evidence_hash, installed: result.installed, written: result.written, diagnostics: result.diagnostics }));
    else {
      console.log(`REVIEW ${result.task_id}: ${result.outcome}. Evidence only; no verdict or implementation readiness is determined.`);
      for (const d of result.diagnostics) console.error(`${d.code} ${d.path}: ${d.message}`);
      for (const w of result.written) console.log(`Package ${w.changed ? 'written' : 'unchanged'}: ${w.path}`);
    }
    process.exitCode = result.outcome === 'complete' ? 0 : result.outcome === 'failed' ? 2 : 1;
    return;
  }
  if (command === 'context' && positional[1] === 'status' && positional.length === 2) {
    command = 'context status';
    const result = await contextStatus(root);
    if (json) console.log(JSON.stringify({ command, ok: result.diagnostics.length === 0, ...result }));
    else {
      console.log(`Configuration: ${result.configuration}. Index: ${result.index}. Artifacts: ${result.artifact_count}.`);
      if (result.diagnostics.length) report(result.diagnostics);
    }
    if (result.diagnostics.length) process.exitCode = 1;
    return;
  }
  if (positional.length !== 1) fail('CLI_USAGE', '.', 'Expected one command or context status. Use --help for usage.');
  if (command === 'init') {
    const result = await initialize(root, { force, adapters: selected });
    if (json) console.log(JSON.stringify({ command, ok: result.diagnostics.length === 0, ...result }));
    else {
      console.log(`${result.diagnostics.length ? 'Initialization incomplete for' : 'Initialized'} ${result.root}: ${result.created.length} created, ${result.preserved.length} preserved, ${result.replaced.length} replaced.`);
      console.log('Adapters available: --adapter codex, --adapter claude, --adapter gemini.');
      if (result.diagnostics.length) report(result.diagnostics);
      else console.log(`Validation passed: ${result.artifact_count} artifact(s).`);
    }
    if (result.diagnostics.length) process.exitCode = 1;
    return;
  }
  if (command !== 'index' && command !== 'validate') fail('CLI_USAGE', '.', 'Expected init, index, validate, or context status. Use --help for usage.');
  const result = await inspect(root);
  let changed: boolean | undefined;
  if (!result.diagnostics.length && command === 'index') changed = await writeIndex(result);
  report(result.diagnostics, result.index.artifacts.length, changed);
  if (result.diagnostics.length) process.exitCode = 1;
}

main().catch(error => {
  const diagnostic = error instanceof KeystoneError ? error.diagnostic : {
    code: 'IO_ERROR', path: '.', message: 'Unexpected failure while reading or writing repository state.',
  };
  report([diagnostic]);
  process.exitCode = diagnostic.code === 'CLI_USAGE' || diagnostic.code === 'COMMAND_NOT_IMPLEMENTED' ? 2 : 1;
});
