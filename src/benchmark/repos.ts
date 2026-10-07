import { lstat, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { compare, type Diagnostic } from '../core.js';
import { runGit } from './git.js';

/** Version 2 plans name repositories by ID, never by machine path (TASK-0015 Q2). The machine-local
 * locations file maps IDs to paths; it is never hashed and never recorded.
 */
export interface Locations2 { file: string; repositories: Record<string, string> }

/** True when a repository contains the commit. Read-only. */
async function hasCommit(repository: string, commit: string): Promise<boolean> {
  return (await runGit(['-C', repository, 'cat-file', '-e', `${commit}^{commit}`])).code === 0;
}

async function head(repository: string): Promise<string | null> {
  const result = await runGit(['-C', repository, 'rev-parse', '--verify', '--quiet', 'HEAD']);
  return result.code === 0 ? result.stdout.toString('utf8').trim() : null;
}

const blob = (data: Buffer, oid: string) => createHash(oid.length === 64 ? 'sha256' : 'sha1').update(`blob ${data.length}\0`).update(data).digest('hex');

/** Whether every working file under `relative` equals the pinned commit's content, and no file is
 * missing or untracked. File hashes are compared in Node (as for Keystone's own dirty flag), so no
 * repository filter runs; CRLF-only differences count as unchanged.
 */
async function cleanUnder(repository: string, commit: string, relative: string): Promise<boolean> {
  const listing = await runGit(['-C', repository, 'ls-tree', '-r', '-z', commit, '--', relative]);
  if (listing.code !== 0) return false;
  const tracked = new Map<string, string>();
  for (const entry of listing.stdout.toString('utf8').split('\0').filter(Boolean)) {
    const [meta, file] = [entry.slice(0, entry.indexOf('\t')), entry.slice(entry.indexOf('\t') + 1)];
    const [, type, oid] = meta.split(' ');
    if (type === 'blob') tracked.set(file, oid);
  }
  if (!tracked.size) return false;
  const seen = new Set<string>();
  const walk = async (current: string): Promise<boolean> => {
    let entries;
    try { entries = await readdir(path.join(repository, ...current.split('/')), { withFileTypes: true }); } catch { return false; }
    for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
      const child = `${current}/${entry.name}`;
      if (entry.isDirectory()) { if (!(await walk(child))) return false; continue; }
      const oid = tracked.get(child);
      if (!oid) return false;
      const bytes = await readFile(path.join(repository, ...child.split('/')));
      if (blob(bytes, oid) !== oid && blob(Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1'), oid) !== oid) return false;
      seen.add(child);
    }
    return true;
  };
  return await walk(relative.replace(/\/+$/, '')) && seen.size === tracked.size;
}

export interface PinnedRepository { name: 'subject' | 'benchmark'; id: string; commit: string; path: string; bundles: string[] }

/** Each pinned repository must contain its commit, have HEAD at it, and be clean under every
 * referenced bundle path, so working-file bundle hashes equal the pinned content (TASK-0015 item 5).
 */
export async function pinDiagnostics(repositories: PinnedRepository[], label: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const repo of repositories) {
    const field = `/repositories/${repo.name}`;
    if (!(await hasCommit(repo.path, repo.commit))) {
      diagnostics.push({ code: 'BENCH_REPOSITORY_COMMIT_MISSING', path: label, field, message: `Repository ${repo.id} does not contain commit ${repo.commit}.` });
      continue;
    }
    if ((await head(repo.path)) !== repo.commit) {
      diagnostics.push({ code: 'BENCH_REPOSITORY_NOT_AT_COMMIT', path: label, field, message: `Repository ${repo.id} must have HEAD at its pinned commit ${repo.commit}.` });
      continue;
    }
    for (const bundle of [...new Set(repo.bundles)].sort(compare)) {
      if (!(await cleanUnder(repo.path, repo.commit, bundle))) {
        diagnostics.push({ code: 'BENCH_REPOSITORY_DIRTY', path: label, field, message: `${repo.id}:${bundle} has modified, missing or untracked files relative to the pinned commit.` });
      }
    }
  }
  return diagnostics;
}

export async function isDirectory(file: string): Promise<boolean> {
  try { return (await lstat(file)).isDirectory(); } catch { return false; }
}
