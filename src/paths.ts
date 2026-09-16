import path from 'node:path';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { compare, fail, KeystoneError, type Diagnostic } from './core.js';

export function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Portable repository-relative names; backslashes are accepted as separators. */
export function relativePath(input: string): string {
  const value = input.replace(/\\/g, '/');
  if (!value || path.posix.isAbsolute(value) || path.win32.isAbsolute(input) ||
      value.split('/').some(segment => segment === '..' || /[<>:"|?*\x00-\x1f]/.test(segment) ||
        /[. ]$/.test(segment) && segment !== '.' ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) {
    fail('PATH_INVALID', input, 'Expected a portable repository-relative path without parent traversal.');
  }
  const normalized = path.posix.normalize(value).replace(/\/$/, '');
  if (normalized === '.' || normalized.split('/').some(segment => segment.toLowerCase() === '.git')) {
    fail('PATH_INVALID', input, 'Repository root and Git internals are not artifact paths.');
  }
  return normalized;
}

export async function repositoryRoot(input: string): Promise<string> {
  try {
    const root = await realpath(input);
    if (!(await lstat(root)).isDirectory()) fail('ROOT_INVALID', '.', 'Repository root must be a directory.');
    return root;
  } catch (error) {
    if (error instanceof KeystoneError) throw error;
    fail('ROOT_INVALID', '.', 'Cannot open repository root as a directory.');
  }
}

export function caseCollisions(paths: Iterable<string>): Diagnostic[] {
  const components = new Set<string>();
  for (const file of paths) {
    const segments = file.split('/');
    for (let length = 1; length <= segments.length; length++) components.add(segments.slice(0, length).join('/'));
  }
  const seen = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];
  for (const file of [...components].sort(compare)) {
    const previous = seen.get(file.toLowerCase());
    if (previous) diagnostics.push({ code: 'PATH_CASE_COLLISION', path: file, message: `Path differs only in case from ${previous}.` });
    else seen.set(file.toLowerCase(), file);
  }
  return diagnostics;
}

/** Reject existing symlinks/junctions under the v0.1 stable-working-tree assumption.
 * These pathname checks do not protect against concurrent filesystem replacement.
 */
export async function safePath(root: string, input: string): Promise<string> {
  const relative = relativePath(input);
  let current = root;
  for (const segment of relative.split('/')) {
    const parent = current;
    current = path.join(current, segment);
    try {
      const entries = await readdir(parent);
      if (!entries.includes(segment) && entries.some(entry => entry.toLowerCase() === segment.toLowerCase())) {
        fail('PATH_CASE_MISMATCH', relative, 'Path casing must match the on-disk name exactly.');
      }
      if ((await lstat(current)).isSymbolicLink()) {
        fail('PATH_SYMLINK', relative, 'Symbolic links and junctions are not supported for context paths.');
      }
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
  }
  return current;
}
