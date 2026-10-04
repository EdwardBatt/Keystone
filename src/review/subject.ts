import { lstat, mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { caseCollisions, relativePath } from '../paths.js';
import { compare, fail } from '../core.js';
import { isGeneratedPath } from '../context/generated.js';
import { git, nulFields, readObjects } from './git.js';
import { isReviewRecordPath } from './records.js';
import { unifiedDiff } from './diff.js';

export interface TreeEntry { path: string; mode: string; type: string; oid: string }
export type ContentKind = 'text' | 'non-text' | 'symlink' | 'gitlink' | 'filtered' | 'root-task';
export interface SubjectEntry {
  path: string;
  change: 'added' | 'deleted' | 'modified';
  kind: ContentKind;
  base: { mode: string; oid: string; size?: number } | null;
  working: { mode: 'file' | 'symlink' | 'gitlink' | 'directory'; hash: string; size?: number; target?: string } | null;
  diff?: string;
  classes?: string[];
  artifact?: { base: { type: string; status: unknown } | null; working: { type: string; status: unknown } | null };
}

/** Excluded from every review subject: review records and generated Keystone state. */
export const outsideSubject = (file: string): boolean => isReviewRecordPath(file) || isGeneratedPath(file);

export async function lsTree(root: string, commit: string): Promise<TreeEntry[]> {
  return nulFields(await git(root, ['ls-tree', '-r', '-z', '--full-tree', commit])).map(record => {
    const tab = record.indexOf('\t');
    const [mode, type, oid] = record.slice(0, tab).split(' ');
    return { path: record.slice(tab + 1), mode, type, oid };
  });
}

export interface IndexState { entries: Map<string, { mode: string; oid: string }>; unmerged: boolean }

export async function readIndex(root: string): Promise<IndexState> {
  const entries = new Map<string, { mode: string; oid: string }>();
  let unmerged = false;
  for (const record of nulFields(await git(root, ['ls-files', '--stage', '-z']))) {
    const tab = record.indexOf('\t');
    const [mode, oid, stage] = record.slice(0, tab).split(' ');
    if (stage !== '0') unmerged = true;
    entries.set(record.slice(tab + 1), { mode, oid });
  }
  return { entries, unmerged };
}

export async function untracked(root: string): Promise<string[]> {
  return nulFields(await git(root, ['ls-files', '--others', '--exclude-standard', '-z']));
}

export function blobId(bytes: Buffer, format: string): string {
  return createHash(format === 'sha256' ? 'sha256' : 'sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** START normalization: valid UTF-8 without NUL, BOM removed, CRLF/CR to LF. */
export function asText(bytes: Buffer): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes('\0') ? null : text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  } catch { return null; }
}

const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');

/** Materializes representable base blobs; unrepresentable paths are reported, never guessed. */
export async function materialize(directory: string, tree: TreeEntry[], blobs: Map<string, { content: Buffer }>): Promise<string[]> {
  const unrepresentable = new Set<string>();
  const portable = tree.filter(entry => {
    try {
      if (relativePath(entry.path) !== entry.path) throw new Error('non-canonical');
      return true;
    } catch { unrepresentable.add(entry.path); return false; }
  });
  for (const collision of caseCollisions(portable.map(entry => entry.path))) {
    for (const entry of portable) if (entry.path.toLowerCase() === collision.path.toLowerCase() ||
      entry.path.toLowerCase().startsWith(`${collision.path.toLowerCase()}/`)) unrepresentable.add(entry.path);
  }
  for (const entry of portable) {
    if (unrepresentable.has(entry.path)) continue;
    if (entry.type !== 'blob' || entry.mode === '120000') { unrepresentable.add(entry.path); continue; }
    const destination = path.join(directory, ...entry.path.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, blobs.get(entry.oid)!.content, { flag: 'wx' });
  }
  return [...unrepresentable].sort(compare);
}

export interface SubjectInput {
  root: string;
  format: string;
  base: TreeEntry[];
  blobs: Map<string, { content: Buffer }>;
  index: IndexState;
  others: string[];
  rootTaskPaths: Set<string>;
  filtered: Set<string>;
}

/** Base tree versus working tree, excluding review records and generated state. */
export async function computeSubject(input: SubjectInput): Promise<SubjectEntry[]> {
  const baseMap = new Map(input.base.filter(e => !outsideSubject(e.path)).map(e => [e.path, e]));
  const nested = new Set(input.others.filter(file => file.endsWith('/')).map(file => file.slice(0, -1)));
  const working = new Set<string>([
    ...[...input.index.entries.keys()],
    ...input.others.filter(file => !file.endsWith('/')),
    ...nested,
  ].filter(file => !outsideSubject(file)));
  const subject: SubjectEntry[] = [];
  for (const file of [...new Set([...baseMap.keys(), ...working])].sort(compare)) {
    const base = baseMap.get(file);
    const indexed = input.index.entries.get(file);
    let current: SubjectEntry['working'] = null;
    let bytes: Buffer | undefined;
    if (working.has(file)) {
      const absolute = path.join(input.root, ...file.split('/'));
      if (indexed?.mode === '160000' || nested.has(file)) {
        current = { mode: 'gitlink', hash: indexed?.oid ?? 'untracked-repository' };
      } else {
        try {
          const stat = await lstat(absolute);
          if (stat.isSymbolicLink()) current = { mode: 'symlink', hash: sha256(await readlink(absolute)), target: await readlink(absolute) };
          else if (stat.isFile()) { bytes = await readFile(absolute); current = { mode: 'file', hash: '', size: bytes.length }; }
          else current = { mode: 'directory', hash: 'directory' };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('IO_ERROR', file, 'Cannot read working-tree file for review.');
        }
      }
    }
    if (!base && !current) continue;
    const baseRecord = base ? { mode: base.mode, oid: base.oid, ...(base.type === 'blob' ? { size: input.blobs.get(base.oid)!.content.length } : {}) } : null;
    const change: SubjectEntry['change'] = !base ? 'added' : !current ? 'deleted' : 'modified';
    const baseBlob = base?.type === 'blob' && base.mode !== '120000' ? input.blobs.get(base.oid)!.content : undefined;
    let kind: ContentKind;
    let diff: string | undefined;
    if (current?.mode === 'gitlink' || base?.mode === '160000') {
      if (base?.mode === '160000' && current?.mode === 'gitlink' && current.hash === base.oid) continue;
      kind = 'gitlink';
    } else if (current?.mode === 'symlink' || base?.mode === '120000') {
      const baseTarget = base?.mode === '120000' ? input.blobs.get(base.oid)!.content.toString('utf8') : undefined;
      if (current?.mode === 'symlink' && baseTarget === current.target) continue;
      kind = 'symlink';
    } else if (current?.mode === 'directory') {
      kind = 'gitlink';
    } else {
      if (bytes && baseBlob && blobId(bytes, input.format) === base!.oid) continue;
      const before = baseBlob ? asText(baseBlob) : '';
      const after = bytes ? asText(bytes) : '';
      if (before !== null && after !== null) {
        if (base && current && before === after) continue;
        if (current) current.hash = sha256(after);
        kind = input.rootTaskPaths.has(file) ? 'root-task' : input.filtered.has(file) ? 'filtered' : 'text';
        if (kind === 'text') diff = unifiedDiff(before, after);
      } else {
        if (base && current && baseBlob!.equals(bytes!)) continue;
        if (current && bytes) current.hash = sha256(bytes);
        kind = input.rootTaskPaths.has(file) ? 'root-task' : 'non-text';
      }
    }
    subject.push({ path: file, change, kind, base: baseRecord, working: current, ...(diff !== undefined ? { diff } : {}) });
  }
  return subject;
}

export async function filteredPaths(root: string, base: string, files: string[]): Promise<Set<string>> {
  const filtered = new Set<string>();
  if (!files.length) return filtered;
  const input = files.join('\0') + '\0';
  for (const args of [['check-attr', '-z', '--stdin', 'filter'], ['check-attr', `--source=${base}`, '-z', '--stdin', 'filter']]) {
    const fields = (await git(root, args, input)).toString('utf8').split('\0');
    for (let i = 0; i + 2 < fields.length; i += 3) {
      if (fields[i + 2] !== 'unspecified' && fields[i + 2] !== 'unset') filtered.add(fields[i]);
    }
  }
  return filtered;
}
