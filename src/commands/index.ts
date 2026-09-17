import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { compare, fail, isKeystoneIndex, KeystoneError, serialize, sortDiagnostics, type Diagnostic, type Index } from '../core.js';
import { loadConfig } from '../context/config.js';
import { discover } from '../parser/discovery.js';
import { buildGraph } from '../graph/index.js';
import { isMissing, repositoryRoot, safePath } from '../paths.js';

export interface Inspection {
  root: string;
  index: Index;
  diagnostics: Diagnostic[];
}

export async function inspect(input: string): Promise<Inspection> {
  const root = await repositoryRoot(input);
  const config = await loadConfig(root);
  const discovered = await discover(root, config);
  const graph = await buildGraph(root, discovered.artifacts);
  return {
    root,
    index: {
      generated_by: 'keystone', schema_version: 1,
      artifacts: discovered.artifacts.sort((a, b) => compare(a.id, b.id) || compare(a.path, b.path)),
      links: graph.links,
    },
    diagnostics: sortDiagnostics([...discovered.diagnostics, ...graph.diagnostics]),
  };
}

/** Phase 1 writer: writes only the disposable generated index. */
export async function writeIndex(inspection: Inspection): Promise<boolean> {
  if (inspection.diagnostics.length) fail('INDEX_INVALID', '.context/index.json', 'Cannot write an index with validation errors.');
  const file = '.context/index.json';
  const absolute = await safePath(inspection.root, file);
  const contents = serialize(inspection.index);
  try {
    const existing = await readFile(absolute, 'utf8');
    let previous: unknown;
    try { previous = JSON.parse(existing); } catch { /* Treat unrecognized contents as project-owned. */ }
    if (!isKeystoneIndex(previous)) {
      fail('INDEX_OVERWRITE_REFUSED', file, 'Existing file is not a recognized Keystone generated index. Move it explicitly before indexing.');
    }
    if (existing === contents) return false;
  } catch (error) {
    if (!isMissing(error)) {
      if (error instanceof KeystoneError) throw error;
      fail('IO_ERROR', file, 'Cannot read existing index.');
    }
  }
  const directory = await safePath(inspection.root, '.context');
  const temporary = await safePath(inspection.root, `.context/.index-${randomUUID()}.tmp`);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, absolute);
  } catch {
    fail('IO_ERROR', file, 'Cannot write generated index atomically.');
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return true;
}
