import { readFile } from 'node:fs/promises';
import { inspect } from './index.js';
import { gitRoot } from '../context/git.js';
import { isMissing, safePath } from '../paths.js';
import { isValidKeystoneIndex, KeystoneError, serialize, sortDiagnostics, type Diagnostic } from '../core.js';

export type IndexState = 'missing' | 'current' | 'stale' | 'invalid' | 'unverified';

/** Read-only Phase 2 inventory. No envelope, token budget, or task selection is inferred. */
export async function contextStatus(input: string) {
  const root = await gitRoot(input);
  const diagnostics: Diagnostic[] = [];
  let configuration: 'missing' | 'present' = 'missing';
  try {
    await readFile(await safePath(root, '.context/config.yaml'), 'utf8');
    configuration = 'present';
  } catch (error) {
    if (!isMissing(error)) diagnostics.push(error instanceof KeystoneError ? error.diagnostic :
      { code: 'IO_ERROR', path: '.context/config.yaml', message: 'Cannot read configuration.' });
  }
  let inspection: Awaited<ReturnType<typeof inspect>> | undefined;
  try {
    inspection = await inspect(root);
    diagnostics.push(...inspection.diagnostics);
  } catch (error) {
    diagnostics.push(error instanceof KeystoneError ? error.diagnostic :
      { code: 'IO_ERROR', path: '.', message: 'Cannot inspect context artifacts.' });
  }
  let index: IndexState = 'missing';
  try {
    const contents = await readFile(await safePath(root, '.context/index.json'), 'utf8');
    let parsed: unknown;
    try { parsed = JSON.parse(contents); } catch { /* Report invalid generated state. */ }
    if (!isValidKeystoneIndex(parsed)) {
      index = 'invalid';
      diagnostics.push({ code: 'INDEX_INVALID', path: '.context/index.json', message: 'Existing index is not a structurally valid Keystone generated index.' });
    } else if (!inspection || diagnostics.length) index = 'unverified';
    else index = contents === serialize(inspection.index) ? 'current' : 'stale';
  } catch (error) {
    if (!isMissing(error)) {
      index = 'unverified';
      diagnostics.push(error instanceof KeystoneError ? error.diagnostic :
        { code: 'IO_ERROR', path: '.context/index.json', message: 'Cannot read generated index.' });
    }
  }
  const byType: Record<string, number> = {};
  for (const artifact of inspection?.index.artifacts ?? []) byType[artifact.type] = (byType[artifact.type] ?? 0) + 1;
  const uniqueDiagnostics = sortDiagnostics([...new Map(diagnostics.map(d => [serialize(d), d])).values()]);
  return { root, configuration, index, artifact_count: inspection?.index.artifacts.length ?? 0,
    by_type: Object.fromEntries(Object.entries(byType).sort()), diagnostics: uniqueDiagnostics };
}
