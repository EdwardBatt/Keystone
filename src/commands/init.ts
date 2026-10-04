import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { compare, fail, isKeystoneIndex, KeystoneError, type Diagnostic } from '../core.js';
import { gitRoot } from '../context/git.js';
import { isMissing, safePath } from '../paths.js';
import { inspect, writeIndex } from './index.js';

export const adapters = ['codex', 'claude', 'gemini'] as const;
export type Adapter = typeof adapters[number];

const directories = ['context/archive', 'features', 'tasks', 'adr', 'rules', 'skills', 'agents', 'reviews', '.context/telemetry'];

async function template(name: string): Promise<string> {
  return (await readFile(new URL(`../../templates/${name}`, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}

/** Heading-only placeholder files created by init. */
const placeholders: [string, string][] = [
  ['context/INDEX.md', 'Context index'], ['context/DECISIONS.md', 'Decisions'],
  ['context/LEARNINGS.md', 'Learnings'], ['context/TRAPS.md', 'Traps'],
  ['adr/INDEX.md', 'Architecture decisions'], ['skills/INDEX.md', 'Skills'],
  ...['GLOBAL', 'ARCHITECTURE', 'CODING', 'SECURITY', 'TESTING', 'DOCUMENTATION'].map((name): [string, string] => [`rules/${name}.md`, name]),
  ...['implementer', 'code-reviewer', 'architecture-reviewer', 'context-reviewer'].map((name): [string, string] => [`agents/${name}.md`, name]),
];

/** Every file init can create; the single scaffold definition shared with review classification. */
export const scaffoldFiles: readonly string[] = [
  '.context/config.yaml', 'PROJECT.md', 'TASKS.md', 'AGENTS.md', 'context/STATE.md',
  ...placeholders.map(([file]) => file), 'CLAUDE.md', 'GEMINI.md',
].sort(compare);

async function scaffold(root: string, selected: readonly Adapter[]): Promise<Map<string, string>> {
  const projectId = path.basename(root).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '') || 'project';
  const files = new Map<string, string>([
    ['.context/config.yaml', 'schema_version: 1\n'],
    ['PROJECT.md', (await template('PROJECT.md')).replace('project_id: project-slug', `project_id: ${JSON.stringify(projectId)}`)],
    ['TASKS.md', await template('TASKS.md')],
    ['AGENTS.md', await template('AGENTS.md')],
    ['context/STATE.md', await template('STATE.md')],
  ]);
  for (const [file, title] of placeholders) files.set(file, `# ${title}\n`);
  for (const adapter of selected) {
    // AGENTS.md is also the thin Codex entry point; it is always part of the target layout.
    if (adapter !== 'codex') files.set(adapter === 'claude' ? 'CLAUDE.md' : 'GEMINI.md',
      `# ${adapter === 'claude' ? 'Claude' : 'Gemini'} adapter\n\nRead AGENTS.md and PROJECT.md. Use repository artifacts as durable project context.\n`);
  }
  return new Map([...files].sort(([a], [b]) => compare(a, b)));
}

export async function initialize(input: string, options: { force?: boolean; adapters?: readonly Adapter[] } = {}) {
  const root = await gitRoot(input);
  const selected = [...new Set(options.adapters ?? [])].sort(compare);
  if (selected.some(adapter => !adapters.includes(adapter))) fail('CLI_USAGE', '.', 'Unknown adapter. Choose codex, claude, or gemini.');
  const files = await scaffold(root, selected);
  const existing = new Set<string>();
  const allDirectories = new Set(directories);
  for (const file of files.keys()) {
    const directory = path.posix.dirname(file);
    if (directory !== '.') allDirectories.add(directory);
  }
  // Preflight every destination before creating anything. Existing knowledge is never replaced.
  for (const [file, directory] of [
    ...[...allDirectories].map(file => [file, true] as const),
    ...[...files.keys(), '.context/index.json'].map(file => [file, false] as const),
  ]) {
    try {
      const stat = await lstat(await safePath(root, file));
      if (directory ? !stat.isDirectory() : !stat.isFile()) fail('INIT_CONFLICT', file, `Expected a ${directory ? 'directory' : 'regular file'} at this location.`);
      if (!directory) existing.add(file);
    } catch (error) {
      if (isMissing(error)) continue;
      if (error instanceof KeystoneError) throw error;
      fail('INIT_CONFLICT', file, 'Cannot safely use the scaffold destination.');
    }
  }
  if (existing.has('.context/index.json')) {
    let previous: unknown;
    try { previous = JSON.parse(await readFile(await safePath(root, '.context/index.json'), 'utf8')); } catch { /* Refuse unrecognized state. */ }
    if (!isKeystoneIndex(previous)) fail('INDEX_OVERWRITE_REFUSED', '.context/index.json', 'Existing file is not a recognized generated index. Initialization did not modify the repository.');
  }
  const created: string[] = [];
  const preserved: string[] = [];
  const replaced: string[] = [];
  let diagnostics: Diagnostic[] = [];
  try {
    for (const directory of [...allDirectories].sort(compare)) await mkdir(await safePath(root, directory), { recursive: true });
    for (const [file, contents] of files) {
      if (existing.has(file)) {
        if (options.force && file === '.context/config.yaml') {
          if (await readFile(await safePath(root, file), 'utf8') !== contents) {
            // Replace the config entry, not the contents of any hard-linked source file.
            const temporary = await safePath(root, `.context/.config-${randomUUID()}.tmp`);
            try {
              await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
              await rename(temporary, await safePath(root, file));
            } finally {
              await unlink(temporary).catch(() => undefined);
            }
            replaced.push(file);
          } else preserved.push(file);
        } else preserved.push(file);
      } else {
        // A failed write can leave only a disposable sibling, never a partial final file.
        const temporary = await safePath(root, `${path.posix.dirname(file)}/.keystone-${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
          await rename(temporary, await safePath(root, file));
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
        created.push(file);
      }
    }
  } catch (error) {
    diagnostics = [error instanceof KeystoneError ? error.diagnostic : { code: 'IO_ERROR', path: '.', message: 'Initialization incomplete. Completed scaffold files remain; resolve the filesystem error and rerun init.' }];
  }
  let artifactCount = 0;
  let indexChanged = false;
  try {
    if (diagnostics.length) return { root, created, preserved, replaced, adapters: selected, available_adapters: [...adapters], artifact_count: artifactCount, index_changed: indexChanged, diagnostics };
    const inspection = await inspect(root);
    diagnostics = inspection.diagnostics;
    artifactCount = inspection.index.artifacts.length;
    if (!diagnostics.length) indexChanged = await writeIndex(inspection);
  } catch (error) {
    diagnostics = [error instanceof KeystoneError ? error.diagnostic : { code: 'IO_ERROR', path: '.', message: 'Cannot validate initialized repository.' }];
  }
  return { root, created, preserved, replaced, adapters: selected, available_adapters: [...adapters], artifact_count: artifactCount,
    index_changed: indexChanged, diagnostics };
}
