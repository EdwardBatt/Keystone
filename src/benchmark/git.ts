import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Fixed, offline Git invocations by the harness (owner decision I1). They never run a configured
 * program (TASK-0013 review B1):
 * - system, global and XDG configuration are not read, so operator-defined filter, textconv,
 *   fsmonitor or hook programs (git-lfs, for example) cannot run;
 * - snapshots, statistics and patches use a harness-owned Git directory, never the workspace's own
 *   configuration, which the measured agent controls;
 * - diffs disable textconv and external diff drivers, and hooks and fsmonitor are disabled.
 * Network transports are refused; only local file clones are permitted.
 */
const options = ['-c', 'protocol.allow=never', '-c', 'protocol.file.allow=always', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'advice.detachedHead=false'];

function gitEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    const name = key.toUpperCase();
    if (name === 'LC_ALL' || name.startsWith('GIT_')) continue;
    env[key] = value;
  }
  return {
    ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_LAZY_FETCH: '1', GIT_ATTR_NOSYSTEM: '1', LC_ALL: 'C', ...extra,
  };
}

export interface GitResult { code: number; stdout: Buffer; stderr: string }

export function runGit(args: string[], extra: Record<string, string> = {}): Promise<GitResult> {
  return new Promise(resolve => {
    const child = spawn('git', [...options, ...args], { env: gitEnv(extra), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill(), 300000);
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => err.push(chunk));
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, stdout: Buffer.alloc(0), stderr: 'git unavailable' }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }); });
  });
}

export class BenchGitError extends Error {
  constructor(public readonly operation: string) { super(`Git ${operation} failed.`); }
}

async function must(args: string[], operation: string, extra: Record<string, string> = {}): Promise<Buffer> {
  const result = await runGit(args, extra);
  if (result.code !== 0) throw new BenchGitError(operation);
  return result.stdout;
}

/** Reads only: confirms that the subject contains the pinned commit. */
export async function hasCommit(repository: string, commit: string): Promise<boolean> {
  return (await runGit(['-C', repository, 'cat-file', '-e', `${commit}^{commit}`])).code === 0;
}

/** A fresh, independent local clone: copied objects (no hardlinks or alternates), no hooks, no remote. */
export async function cloneAt(subject: string, workspace: string, commit: string): Promise<void> {
  await must(['clone', '--quiet', '--no-hardlinks', '--no-checkout', '--template=', '--', subject, workspace], 'clone');
  await must(['-C', workspace, 'checkout', '--quiet', '--detach', commit], 'checkout');
  await must(['-C', workspace, 'remote', 'remove', 'origin'], 'remote remove');
  const head = (await must(['-C', workspace, 'rev-parse', 'HEAD'], 'rev-parse')).toString('utf8').trim();
  if (head !== commit) throw new BenchGitError('commit verification');
}

/** The harness-owned snapshot repository of one run, kept outside the workspace. */
export interface Snapshots { gitDir: string; indexFile: string }
export const snapshots = (harness: string): Snapshots => ({ gitDir: path.join(harness, 'snapshots.git'), indexFile: path.join(harness, 'snapshot.index') });

export async function initSnapshots(store: Snapshots): Promise<void> {
  await must(['init', '--quiet', '--bare', '--template=', store.gitDir], 'snapshot init');
}

/** Records the workspace's current content as a tree in the harness repository. Only the
 * harness repository's own (empty) configuration applies, so attribute-named drivers are inert.
 */
export async function snapshotTree(workspace: string, store: Snapshots): Promise<string> {
  const extra = { GIT_DIR: store.gitDir, GIT_WORK_TREE: workspace, GIT_INDEX_FILE: store.indexFile };
  await must(['add', '--all', '--', '.'], 'snapshot add', extra);
  return (await must(['write-tree'], 'snapshot write-tree', extra)).toString('utf8').trim();
}

/** Content-free change statistics between two snapshot trees. */
export async function changeStats(store: Snapshots, from: string, to: string): Promise<{ files: number; insertions: number; deletions: number }> {
  const output = (await must(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--numstat', '-z', from, to], 'diff', { GIT_DIR: store.gitDir })).toString('utf8');
  let files = 0, insertions = 0, deletions = 0;
  for (const record of output.split('\0').filter(Boolean)) {
    const [added, removed] = record.split('\t');
    files++;
    if (/^\d+$/.test(added)) insertions += Number(added);
    if (/^\d+$/.test(removed)) deletions += Number(removed);
  }
  return { files, insertions, deletions };
}

/** The change a judge reviews: a binary-safe patch between two snapshot trees, minus declared exclusions. */
export async function patch(store: Snapshots, from: string, to: string, exclude: string[]): Promise<Buffer> {
  return must(['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--binary', from, to, '--', ...exclude.map(p => `:(exclude)${p}`)], 'diff', { GIT_DIR: store.gitDir });
}

/** Keystone's own provenance: its checkout commit and whether tracked files differ from it. The
 * comparison hashes working files here, rather than asking Git, so no repository filter can run.
 * Files differing only by CRLF line endings count as unchanged.
 */
export async function checkout(directory: string): Promise<{ commit: string | null; dirty: boolean | null }> {
  const head = await runGit(['-C', directory, 'rev-parse', '--verify', '--quiet', 'HEAD']);
  if (head.code !== 0) return { commit: null, dirty: null };
  const listing = await runGit(['-C', directory, 'ls-tree', '-r', '-z', '--full-tree', 'HEAD']);
  if (listing.code !== 0) return { commit: head.stdout.toString('utf8').trim(), dirty: null };
  let dirty = false;
  for (const entry of listing.stdout.toString('utf8').split('\0').filter(Boolean)) {
    const [meta, file] = [entry.slice(0, entry.indexOf('\t')), entry.slice(entry.indexOf('\t') + 1)];
    const [mode, type, oid] = meta.split(' ');
    if (type !== 'blob' || mode === '120000') continue;
    let bytes: Buffer;
    try { bytes = await readFile(path.join(directory, ...file.split('/'))); } catch { dirty = true; break; }
    const blob = (data: Buffer) => createHash(oid.length === 64 ? 'sha256' : 'sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
    if (blob(bytes) === oid) continue;
    if (blob(Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1')) === oid) continue;
    dirty = true;
    break;
  }
  return { commit: head.stdout.toString('utf8').trim(), dirty };
}
