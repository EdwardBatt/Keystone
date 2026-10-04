import { lstat, readFile } from 'node:fs/promises';
import { compare, KeystoneError, fail } from '../core.js';
import { isMissing, relativePath, safePath } from '../paths.js';
import { parseYaml } from '../parser/frontmatter.js';
import { validateSchema } from '../validation/schemas.js';
import { isGeneratedPath } from './generated.js';
import { isReviewRecordPath } from '../review/records.js';

export interface Config {
  schema_version: 1;
  sources: string[];
  explicitSources?: boolean;
}

export const defaultConfig: Config = {
  schema_version: 1,
  sources: ['PROJECT.md', 'features', 'tasks', 'adr', 'rules', 'skills', 'context'],
};

export async function loadConfig(root: string): Promise<Config> {
  const file = '.context/config.yaml';
  let text: string;
  try {
    text = await readFile(await safePath(root, file), 'utf8');
  } catch (error) {
    if (isMissing(error)) return { ...defaultConfig, sources: [...defaultConfig.sources] };
    if (error instanceof KeystoneError) throw error;
    fail('IO_ERROR', file, 'Cannot read configuration.');
  }
  const data = parseYaml(text, file);
  const errors = validateSchema('config', data, file);
  if (errors.length) throw new KeystoneError(errors[0]);
  const sources = ((data.sources ?? defaultConfig.sources) as string[]).map(relativePath);
  if (sources.some(source => source.split('/')[0].toLowerCase() === '.context' || isGeneratedPath(source))) {
    fail('CONFIG_INVALID', file, 'Generated Keystone state cannot be an artifact source.', 'sources');
  }
  if (sources.some(isReviewRecordPath)) fail('CONFIG_INVALID', file, 'Review records under reviews/ cannot be an artifact source.', 'sources');
  // Defaults are optional; an explicit list is a user's concrete discovery request.
  if (Object.hasOwn(data, 'sources')) {
    for (const source of [...sources].sort(compare)) {
      try {
        await lstat(await safePath(root, source));
      } catch (error) {
        if (isMissing(error)) fail('CONFIG_INVALID', file, `Configured source does not exist: ${source}.`, 'sources');
        if (error instanceof KeystoneError) throw error;
        fail('IO_ERROR', source, 'Cannot inspect configured source.');
      }
    }
  }
  return { schema_version: 1, sources, explicitSources: Object.hasOwn(data, 'sources') };
}
