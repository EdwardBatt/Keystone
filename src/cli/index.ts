#!/usr/bin/env node
import { inspect, writeIndex } from '../commands/index.js';
import { fail, KeystoneError, type Diagnostic } from '../core.js';

const help = `Keystone v0.1 — Phase 0/1
Usage: keystone <index|validate> [--root <directory>] [--json]

  index       Validate artifacts and rebuild .context/index.json
  validate    Check artifact schemas, IDs, links, and supersession (read-only)
  --root      Target directory (defaults to the working directory)
  --json      Emit one structured JSON result
  --help      Show this help
  --version   Show the package version

Later-phase commands are not implemented.`;

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
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) { console.log(help); return; }
  if (args.length === 1 && args[0] === '--version') { console.log('0.1.0'); return; }
  let root = process.cwd();
  let rootSpecified = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') continue;
    if (arg === '--root' && !rootSpecified && args[i + 1] && !args[i + 1].startsWith('--')) {
      root = args[++i]; rootSpecified = true; continue;
    }
    if (!command && !arg.startsWith('-')) { command = arg; continue; }
    fail('CLI_USAGE', '.', `Unexpected argument: ${arg}. Use --help for usage.`);
  }
  if (['init', 'start', 'close', 'review', 'compact', 'context'].includes(command ?? '')) {
    fail('COMMAND_NOT_IMPLEMENTED', '.', `${command} is outside Phase 0/1.`);
  }
  if (command !== 'index' && command !== 'validate') fail('CLI_USAGE', '.', 'Expected index or validate. Use --help for usage.');
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
