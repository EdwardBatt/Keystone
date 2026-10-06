/** Runtime for harness shims: runs a declared tool command with the caller's arguments and, when
 * instrumented, appends one content-free line (tool, exit code, duration) to the run's tool log.
 * Arguments, input and output are never recorded.
 */
import { appendFile, readFile } from 'node:fs/promises';
import { runCommand } from './process.js';

const [specFile, ...forwarded] = process.argv.slice(2);
const spec = JSON.parse(await readFile(specFile, 'utf8')) as { argv: string[]; tool: string; log?: string; path: string[] };
const result = await runCommand([...spec.argv, ...forwarded], {
  cwd: process.cwd(), env: process.env, pathEntries: spec.path, timeoutMs: 24 * 60 * 60 * 1000, inherit: true,
});
if (spec.log) {
  await appendFile(spec.log, JSON.stringify({ tool: spec.tool, exit_code: result.exit_code, duration_ms: result.duration_ms }) + '\n');
}
process.exitCode = result.exit_code ?? 1;
