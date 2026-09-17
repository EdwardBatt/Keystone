#!/usr/bin/env node
import { inspect, writeIndex } from '../commands/index.js';
import { fail, KeystoneError, type Diagnostic } from '../core.js';
import { adapters, initialize, type Adapter } from '../commands/init.js';
import { contextStatus } from '../commands/status.js';

const help = `Keystone v0.1 — Phase 0/1 and Phase 2
Usage: keystone <index|validate|init|context status> [--root <directory>] [--json]

  index       Validate artifacts and rebuild .context/index.json
  validate    Check artifact schemas, IDs, links, and supersession (read-only)
  init        Create missing scaffold at the Git root, validate, and build the index
  context status  Report configuration, artifact counts, validation, and index freshness (read-only)
  --root      Target directory (defaults to the working directory)
              init/status detect its containing Git root; index/validate use it directly
  --adapter   init only: offer codex, claude, or gemini (repeat to select several)
              AGENTS.md is always created if missing; Claude/Gemini adapters are opt-in
  --force     init only: reset config.yaml; existing project knowledge is preserved
  --json      Emit one structured JSON result
  --help      Show this help
  --version   Show the package version

Phase 3+ commands are not implemented.`;

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
  const selected: Adapter[] = [];
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') continue;
    if (arg === '--root' && !rootSpecified && args[i + 1] && !args[i + 1].startsWith('--')) {
      root = args[++i]; rootSpecified = true; continue;
    }
    if (arg === '--force') { force = true; continue; }
    if (arg === '--adapter' && args[i + 1] && adapters.includes(args[i + 1] as Adapter)) {
      selected.push(args[++i] as Adapter); continue;
    }
    if (!arg.startsWith('-')) { positional.push(arg); continue; }
    fail('CLI_USAGE', '.', `Unexpected argument: ${arg}. Use --help for usage.`);
  }
  command = positional[0];
  if (['start', 'close', 'review', 'compact'].includes(command ?? '') || command === 'context' && positional[1] === 'explain') {
    fail('COMMAND_NOT_IMPLEMENTED', '.', `${positional.join(' ')} is outside Phase 2.`);
  }
  if (command !== 'init' && (force || selected.length)) fail('CLI_USAGE', '.', '--force and --adapter are only supported by init.');
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
