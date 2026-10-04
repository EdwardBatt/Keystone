import { lstat, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compare, KeystoneError, type Artifact, type ArtifactType, type Diagnostic } from '../core.js';
import type { Config } from '../context/config.js';
import { caseCollisions, isMissing, safePath } from '../paths.js';
import { parseMarkdown } from './frontmatter.js';
import { validateSchema } from '../validation/schemas.js';
import { isGeneratedPath } from '../context/generated.js';
import { isReviewRecordPath } from '../review/records.js';

const types = new Set<ArtifactType>(['project', 'task', 'feature', 'adr', 'learning', 'trap', 'rule', 'skill']);
const excluded = new Set(['.git', '.context', 'node_modules', 'dist']);

export function expectedType(file: string): ArtifactType | undefined {
  if (file === 'PROJECT.md') return 'project';
  const [directory] = file.split('/');
  const name = file.split('/').at(-1)!;
  if (directory === 'features' && name === 'FEATURE.md') return 'feature';
  if (directory === 'tasks' && name !== 'INDEX.md' && name !== 'README.md') return 'task';
  if (directory === 'adr' && name !== 'INDEX.md' && name !== 'README.md') return 'adr';
  if (directory === 'rules' && name !== 'INDEX.md' && name !== 'README.md') return 'rule';
  if (directory === 'skills' && name !== 'INDEX.md' && name !== 'README.md') return 'skill';
  return undefined;
}

export async function discover(root: string, config: Config): Promise<{ artifacts: Artifact[]; diagnostics: Diagnostic[] }> {
  const files = new Set<string>();
  const visited = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  const record = (error: unknown, file: string) => diagnostics.push(error instanceof KeystoneError ? error.diagnostic :
    { code: 'IO_ERROR', path: file, message: 'Cannot read artifact path.' });
  async function walk(file: string, optional: boolean): Promise<void> {
    if (visited.has(file)) return;
    // Review records are never artifact inventory (ADR-0002 guarantee 8).
    if (isGeneratedPath(file) || isReviewRecordPath(file) || file.split('/').some(segment => excluded.has(segment.toLowerCase()))) return;
    visited.add(file);
    try {
      const absolute = await safePath(root, file);
      const stat = await lstat(absolute);
      if (stat.isDirectory()) {
        for (const entry of (await readdir(absolute)).sort(compare)) await walk(`${file}/${entry}`, false);
      } else if (stat.isFile() && /\.md$/i.test(file)) files.add(file);
    } catch (error) {
      if (optional && isMissing(error)) return;
      record(error, file);
    }
  }
  for (const source of [...config.sources].sort(compare)) await walk(source, true);
  const artifacts: Artifact[] = [];
  diagnostics.push(...caseCollisions(visited));
  for (const file of [...files].sort(compare)) {
    try {
      const text = await readFile(await safePath(root, file), 'utf8');
      const parsed = parseMarkdown(text, file);
      const expected = expectedType(file);
      const metadata = parsed.metadata;
      let type: ArtifactType;
      if (metadata === null && (expected === 'rule' || expected === 'skill')) {
        type = expected;
      } else {
        if (!metadata) {
          if (expected) diagnostics.push({ code: 'FRONTMATTER_MISSING', path: file, message: 'Authoritative artifact requires typed YAML front matter.' });
          continue;
        }
        if (!('context_type' in metadata) && !expected) continue;
        if (!types.has(metadata.context_type as ArtifactType)) {
          diagnostics.push({ code: 'ARTIFACT_TYPE_INVALID', path: file, field: 'context_type', message: 'Missing or unsupported context_type.' });
          continue;
        }
        type = metadata.context_type as ArtifactType;
        if (expected && type !== expected) {
          diagnostics.push({ code: 'ARTIFACT_TYPE_MISMATCH', path: file, field: 'context_type', message: `Expected ${expected} at this path.` });
          continue;
        }
        const errors = validateSchema(type, metadata, file);
        diagnostics.push(...errors);
        if (errors.length) continue;
      }
      const identity = type === 'project' ? metadata?.project_id : type === 'feature' ? metadata?.feature : metadata?.id;
      artifacts.push({
        id: typeof identity === 'string' ? identity : file,
        type, path: file,
        hash: createHash('sha256').update(text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')).digest('hex'),
        metadata: metadata ?? {},
      });
    } catch (error) { record(error, file); }
  }
  return { artifacts, diagnostics };
}
