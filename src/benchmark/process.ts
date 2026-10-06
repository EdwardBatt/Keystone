import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compare } from '../core.js';
import { sha256 } from './specs.js';

const windows = process.platform === 'win32';
const delimiter = windows ? ';' : ':';

/** Variables every session, setup and oracle process receives when present, identically for every condition. */
const systemVariables = windows
  ? ['SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS']
  : ['HOME', 'TMPDIR', 'LANG', 'TERM', 'USER', 'LOGNAME', 'SHELL'];

/** Executable names the harness itself provides; they never reach a measured environment uninvited. */
const harnessNames = ['keystone', 'keystone-bench'];

function lookup(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find(k => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

function extensions(env: NodeJS.ProcessEnv): string[] {
  if (!windows) return [''];
  return ['', ...(lookup(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map(e => e.toLowerCase())];
}

async function isFile(file: string): Promise<boolean> {
  try { return (await stat(file)).isFile(); } catch { return false; }
}

/** Resolves a command name through a PATH list, with PATHEXT on Windows. Paths are used as given. */
export async function resolveExecutable(name: string, pathEntries: string[], env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (name.includes('/') || name.includes('\\') || path.isAbsolute(name)) {
    for (const ext of extensions(env)) if (await isFile(name + ext)) return path.resolve(name + ext);
    return undefined;
  }
  for (const directory of pathEntries) {
    for (const ext of extensions(env)) {
      // On Windows an extensionless file is not directly executable; require a PATHEXT match.
      if (windows && !ext && !path.extname(name)) continue;
      const candidate = path.join(directory, name + ext);
      if (await isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

async function providesHarness(directory: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  for (const name of harnessNames) if (await resolveExecutable(name, [directory], env)) return true;
  return false;
}

export interface BaseEnvironment {
  /** PATH entries identical for every condition, with harness-provided executables removed. */
  path: string[];
  removed: number;
  /** Variables (names and values) passed to every process; values are never recorded. */
  variables: Record<string, string>;
  pass: string[];
}

/** The controlled environment: an allow-list of variables plus the profile's declared pass-through names. */
export async function baseEnvironment(profilePass: string[], source: NodeJS.ProcessEnv = process.env): Promise<BaseEnvironment> {
  const variables: Record<string, string> = {};
  const pass = [...new Set([...systemVariables, ...profilePass])].sort(compare);
  for (const name of pass) {
    const value = lookup(source, name);
    if (value !== undefined) variables[name] = value;
  }
  const entries: string[] = [];
  let removed = 0;
  for (const entry of (lookup(source, 'PATH') ?? '').split(delimiter).filter(Boolean)) {
    if (await providesHarness(entry, source)) removed++;
    else if (!entries.includes(entry)) entries.push(entry);
  }
  return { path: entries, removed, variables, pass: pass.filter(name => lookup(source, name) !== undefined) };
}

export function environmentFor(base: BaseEnvironment, prepend: string[]): { env: NodeJS.ProcessEnv; path: string[] } {
  const entries = [...prepend, ...base.path];
  return { env: { ...base.variables, PATH: entries.join(delimiter) }, path: entries };
}

export const pathHash = (entries: string[]) => sha256(entries.join('\n'));

/** Quotes one argument for cmd.exe /s /c. Percent expansion cannot be escaped there; arguments are paths and flags. */
const cmdQuote = (arg: string) => `"${arg.replace(/"/g, '""')}"`;

export type ProcessStatus = 'ok' | 'failed' | 'timed-out' | 'error';
export interface ProcessResult { status: ProcessStatus; exit_code: number | null; duration_ms: number; stdout: Buffer }

/** Kills a process and its descendants. The fixed OS facility is used, never a declared program. */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (windows) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
  } catch { /* Already exited. */ }
}

export interface RunOptions {
  cwd: string; env: NodeJS.ProcessEnv; pathEntries: string[]; timeoutMs: number;
  stdin?: string; captureStdout?: boolean; inherit?: boolean;
}

/** Launches one declared command. Output is discarded unless captured for a usage parser, and never stored. */
export async function runCommand(argv: string[], options: RunOptions): Promise<ProcessResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const executable = await resolveExecutable(argv[0], options.pathEntries, options.env);
  if (!executable) return { status: 'error', exit_code: null, duration_ms: elapsed(), stdout: Buffer.alloc(0) };
  let file = executable;
  let args = argv.slice(1);
  let verbatim = false;
  if (windows && /\.(cmd|bat)$/i.test(executable)) {
    file = lookup(options.env, 'ComSpec') ?? 'cmd.exe';
    args = ['/d', '/s', '/c', `"${[executable, ...args].map(cmdQuote).join(' ')}"`];
    verbatim = true;
  }
  return new Promise(resolve => {
    let timedOut = false;
    const out: Buffer[] = [];
    let size = 0;
    const child = spawn(file, args, {
      cwd: options.cwd, env: options.env, windowsHide: true, windowsVerbatimArguments: verbatim,
      detached: !windows && !options.inherit,
      stdio: options.inherit ? 'inherit' : ['pipe', options.captureStdout ? 'pipe' : 'ignore', 'ignore'],
    });
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, options.timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => { if (size < 16 * 1024 * 1024) { out.push(chunk); size += chunk.length; } });
    child.on('error', () => { clearTimeout(timer); resolve({ status: 'error', exit_code: null, duration_ms: elapsed(), stdout: Buffer.alloc(0) }); });
    child.on('close', code => {
      clearTimeout(timer);
      const exit = typeof code === 'number' ? code : null;
      resolve({ status: timedOut ? 'timed-out' : exit === 0 ? 'ok' : 'failed', exit_code: timedOut ? null : exit, duration_ms: elapsed(), stdout: Buffer.concat(out) });
    });
    if (child.stdin) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(options.stdin ?? '');
    }
  });
}

const runtime = fileURLToPath(new URL('./shim-runtime.js', import.meta.url));

/** Writes an executable shim that runs `node shim-runtime.js <spec>` with the caller's arguments. */
export async function writeShim(directory: string, name: string, spec: { argv: string[]; tool: string; log?: string; path: string[] }, write: (file: string, data: string) => Promise<void>): Promise<void> {
  await mkdir(directory, { recursive: true });
  const specFile = path.join(directory, `${name}.shim.json`);
  await write(specFile, JSON.stringify(spec));
  if (windows) {
    await write(path.join(directory, `${name}.cmd`), `@"${process.execPath}" "${runtime}" "${specFile}" %*\r\n@exit /b %errorlevel%\r\n`);
  } else {
    const file = path.join(directory, name);
    const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    await write(file, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(runtime)} ${quote(specFile)} "$@"\n`);
    await chmod(file, 0o755);
  }
}
