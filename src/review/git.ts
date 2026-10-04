import { spawn } from 'node:child_process';
import { fail, KeystoneError } from '../core.js';

/** Global options applied to the capability probe and every review Git invocation. */
export const reviewGitOptions = ['--no-lazy-fetch', '--no-replace-objects', '-c', 'protocol.allow=never', '-c', 'core.fsmonitor=false'];

/** Deterministic review environment: no inherited Git overrides or tracing, no fetching. */
export function reviewGitEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    const name = key.toUpperCase();
    if (name === 'LC_ALL' || name.startsWith('GIT_') && !name.startsWith('GIT_CONFIG_')) continue;
    env[key] = value;
  }
  return {
    ...env, GIT_TRACE: '0', GIT_TRACE2: '0', GIT_TRACE2_EVENT: '0', GIT_TRACE2_PERF: '0',
    GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C',
  };
}

export interface GitResult { code: number; stdout: Buffer; stderr: string }

export function runGit(root: string | undefined, args: string[], input?: string): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...reviewGitOptions, ...(root ? ['-C', root] : []), ...args], {
      env: reviewGitEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill(), 120000);
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => err.push(chunk));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input ?? '');
  });
}

/** Runs a review Git command that must succeed; failures are structural review failures. */
export async function git(root: string, args: string[], input?: string): Promise<Buffer> {
  let result: GitResult;
  try {
    result = await runGit(root, args, input);
  } catch {
    fail('REVIEW_GIT_UNSUPPORTED', '.', 'Git is not available for review.');
  }
  if (result.code !== 0) fail('REVIEW_GIT_FAILED', '.', `Git ${args[0]} failed during review evidence preparation.`);
  return result.stdout;
}

/** The probe is authoritative: version strings are never parsed. */
export async function probeGit(): Promise<void> {
  try {
    const result = await runGit(undefined, ['version']);
    if (result.code === 0) return;
  } catch { /* Reported below. */ }
  fail('REVIEW_GIT_UNSUPPORTED', '.', 'Review requires Git supporting --no-lazy-fetch and --no-replace-objects (upstream 2.45 or a compatible backport).');
}

export const nulFields = (buffer: Buffer): string[] => buffer.toString('utf8').split('\0').filter(Boolean);

export interface GitObject { type: string; content: Buffer }

/** Batch-reads literal objects. Missing objects fail without fetching (lazy fetch is disabled). */
export async function readObjects(root: string, oids: string[]): Promise<Map<string, GitObject>> {
  const unique = [...new Set(oids)].sort();
  const objects = new Map<string, GitObject>();
  if (!unique.length) return objects;
  const output = await git(root, ['cat-file', '--batch'], unique.join('\n') + '\n');
  let offset = 0;
  while (offset < output.length) {
    const newline = output.indexOf(0x0a, offset);
    if (newline < 0) break;
    const header = output.subarray(offset, newline).toString('utf8').split(' ');
    offset = newline + 1;
    if (header[1] === 'missing' || header.length < 3) {
      fail('REVIEW_GIT_OBJECT_MISSING', '.', `Required Git object ${header[0]} is missing; it was not fetched.`);
    }
    const size = Number(header[2]);
    objects.set(header[0], { type: header[1], content: output.subarray(offset, offset + size) });
    offset += size + 1;
  }
  for (const oid of unique) if (!objects.has(oid)) fail('REVIEW_GIT_OBJECT_MISSING', '.', `Required Git object ${oid} is missing.`);
  return objects;
}

export function isKeystoneError(error: unknown): error is KeystoneError {
  return error instanceof KeystoneError;
}
