// Deterministic fake agent for keystone-bench tests. It never calls a model. It executes `FAKE`
// directives found in its prompt, one per line: `FAKE <session|*> <operation> <arguments...>`.
// Arguments: <prompt file> <usage file> <session id>. Text arguments decode `\n`.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const [promptFile, usageFile, session] = process.argv.slice(2);
const prompt = readFileSync(promptFile, 'utf8');
let usage = { input_tokens: prompt.length, output_tokens: 10, turns: 1, tool_calls: 0, tool: 'fake-agent', model: 'fake-model' };
let exitCode = 0;
const decode = text => text.replace(/\\n/g, '\n');
const put = (file, text, append) => {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  (append ? appendFileSync : writeFileSync)(file, text);
};
function resolves(name) {
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD').split(';') : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      try { if (statSync(path.join(dir, name + ext)).isFile()) return true; } catch { /* Next. */ }
    }
  }
  return false;
}

for (const line of prompt.split(/\r?\n/)) {
  const match = line.match(/^FAKE (\S+) (\S+) ?(.*)$/);
  if (!match || match[1] !== '*' && match[1] !== session) continue;
  const [, , op, rest] = match;
  const [first, ...others] = rest.split(' ');
  if (op === 'write') put(first, decode(others.join(' ')), false);
  else if (op === 'append') put(first, decode(others.join(' ')), true);
  else if (op === 'delete') rmSync(first, { force: true });
  else if (op === 'sleep') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(first));
  else if (op === 'exit') exitCode = Number(first);
  else if (op === 'usage') {
    const [input, output, turns, calls] = rest.split(' ').map(Number);
    usage = { ...usage, input_tokens: input, output_tokens: output, turns, tool_calls: calls };
  } else if (op === 'identity') usage = { ...usage, tool: decode(first), model: decode(others.join(' ')) };
  else if (op === 'run') spawnSync(rest, { shell: true, stdio: 'ignore' });
  else if (op === 'probe') put(others[0], resolves(first) ? 'present\n' : 'absent\n', false);
  else if (op === 'pid') put(first, `${session}:${process.pid}\n`, true);
  else if (op === 'env') put(first, Object.keys(process.env).map(k => k.toUpperCase()).sort().join('\n') + '\n', false);
  else if (op === 'exists') put(others[0], existsSync(first) ? 'present\n' : 'absent\n', false);
}
writeFileSync(usageFile, JSON.stringify(usage));
process.exitCode = exitCode;
