import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { compare, fail, KeystoneError, serialize, sortDiagnostics, type Diagnostic } from '../core.js';
import { loadConfig } from '../context/config.js';
import { discover } from '../parser/discovery.js';
import { buildGraph } from '../graph/index.js';
import { parseMarkdown } from '../parser/frontmatter.js';
import { isMissing, repositoryRoot, safePath } from '../paths.js';
import { excerpt, pack, type Envelope, type Outcome } from '../context/envelope.js';
import { select } from '../context/selection.js';

export interface StartResult {
  task_id: string; outcome: Outcome; diagnostics: Diagnostic[];
  envelope: Envelope | null; installed: boolean; changed: boolean;
}
function diagnostic(error: unknown): Diagnostic {
  return error instanceof KeystoneError ? error.diagnostic : { code: 'IO_ERROR', path: '.', message: 'Cannot read or write START context.' };
}
export async function compileStart(input: string, taskId: string): Promise<StartResult> {
  try {
    const root = await repositoryRoot(input);
    const config = await loadConfig(root);
    const discovered = await discover(root, config);
    const graph = await buildGraph(root, discovered.artifacts);
    const diagnostics = sortDiagnostics([...discovered.diagnostics, ...graph.diagnostics]);
    if (diagnostics.length) return { task_id: taskId, outcome: 'failed', diagnostics, envelope: null, installed: false, changed: false };
    const task = discovered.artifacts.find(a => a.type === 'task' && a.id === taskId);
    if (!task) fail('START_TASK_NOT_FOUND', '.', `No discovered task has ID ${taskId}.`);
    const selection = select(task, discovered.artifacts, graph.links, config.explicitSources === true);
    const unavailable = new Set<string>();
    for (const entry of selection.entries) {
      const bytes = await readFile(await safePath(root, entry.path));
      if (entry.type === 'file') {
        entry.hash = createHash('sha256').update(bytes).digest('hex');
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          if (text.includes('\0')) unavailable.add(entry.id);
          else entry.content = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
        } catch { unavailable.add(entry.id); }
      } else {
        const body = parseMarkdown(bytes.toString('utf8'), entry.path).body;
        if (entry.type === 'adr' && entry.role === 'binding') Object.assign(entry, excerpt(body));
        else entry.content = body;
      }
    }
    const envelope: Envelope = pack({
      generated_by: 'keystone', schema_version: 1, kind: 'start-envelope',
      task: { id: task.id, status: task.metadata.status },
      outcome: selection.incomplete ? 'incomplete/conflicted' : 'complete', authorization: 'not-established',
      inventory: discovered.artifacts.map(a => ({ id: a.id, type: a.type, path: a.path, status: a.metadata.status ?? null })).sort((a, b) => compare(a.id, b.id)),
      entries: selection.entries, replacements: selection.replacements, diagnostics: selection.diagnostics, omissions: [],
      budget: { target: 8000, estimated_tokens: 0, exceeded: false, estimator: 'ceil(utf8-bytes/4), excluding budget field' },
    }, unavailable);
    return { task_id: taskId, outcome: envelope.outcome, diagnostics: envelope.diagnostics, envelope, installed: false, changed: false };
  } catch (error) {
    return { task_id: taskId, outcome: 'failed', diagnostics: [diagnostic(error)], envelope: null, installed: false, changed: false };
  }
}

/** Only replaces a recognizable disposable START envelope, never authoritative inputs. */
export async function writeEnvelope(root: string, envelope: Envelope): Promise<boolean> {
  const file = '.context/current-envelope.json';
  const destination = await safePath(root, file);
  const contents = serialize(envelope);
  try {
    const previous = await readFile(destination, 'utf8');
    let parsed: Partial<Envelope> | null = null;
    try { parsed = JSON.parse(previous); } catch { /* Preserve unknown destination contents. */ }
    if (!parsed || parsed.generated_by !== 'keystone' || parsed.schema_version !== 1 || parsed.kind !== 'start-envelope') {
      fail('START_ENVELOPE_OVERWRITE_REFUSED', file, 'Existing file is not a recognized Keystone START envelope.');
    }
    if (previous === contents) return false;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const temporary = await safePath(root, `.context/.envelope-${randomUUID()}.tmp`);
  try {
    await mkdir(await safePath(root, '.context'), { recursive: true });
    await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return true;
}

export async function start(input: string, taskId: string): Promise<StartResult> {
  const result = await compileStart(input, taskId);
  if (!result.envelope) return result;
  try {
    result.changed = await writeEnvelope(await repositoryRoot(input), result.envelope);
    result.installed = true;
    return result;
  } catch (error) {
    return { task_id: taskId, outcome: 'failed', diagnostics: sortDiagnostics([...result.diagnostics, diagnostic(error)]), envelope: null, installed: false, changed: false };
  }
}
