import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ArtifactType, Diagnostic } from '../core.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(JSON.parse(readFileSync(new URL('../../schemas/common.schema.json', import.meta.url), 'utf8')));
const names = ['config', 'project', 'task', 'feature', 'adr', 'learning', 'trap', 'rule', 'skill'] as const;
const validators = Object.fromEntries(names.map(name => [name, ajv.compile(JSON.parse(
  readFileSync(new URL(`../../schemas/${name}.schema.json`, import.meta.url), 'utf8'),
))]));

export function validateSchema(type: ArtifactType | 'config', data: unknown, file: string): Diagnostic[] {
  const validate = validators[type];
  if (validate(data)) return [];
  return (validate.errors ?? []).map(error => ({
    code: type === 'config' ? 'CONFIG_INVALID' : 'SCHEMA_INVALID',
    path: file,
    field: error.instancePath || '/',
    message: `${error.keyword}: ${error.message ?? 'invalid value'}${error.keyword === 'required' ? ` (${String(error.params.missingProperty)})` : ''}`,
  }));
}
