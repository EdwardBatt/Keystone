import { isScalar, parseDocument, visit } from 'yaml';
import { fail } from '../core.js';

function assertJson(value: unknown): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0) || Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Error('Number cannot be preserved safely in JSON');
    }
    return;
  }
  if (Array.isArray(value)) { value.forEach(assertJson); return; }
  if (typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    Object.values(value).forEach(assertJson);
    return;
  }
  throw new Error('Only JSON-compatible values are supported');
}

const jsonTags = new Set(['str', 'int', 'float', 'bool', 'null', 'map', 'seq'].map(tag => `tag:yaml.org,2002:${tag}`));

export function parseYaml(text: string, file: string): Record<string, unknown> {
  try {
    const document = parseDocument(text, { uniqueKeys: true, version: '1.2', strict: true });
    if (document.errors.length || document.warnings.length) {
      fail('YAML_INVALID', file, 'Invalid YAML, duplicate keys, or unsupported tags.');
    }
    // Inspect keys/tags before toJS can coerce keys or convert specialized YAML types.
    visit(document, {
      Node(_key, node) {
        if (node.tag && !jsonTags.has(node.tag)) throw new Error('Unsupported YAML tag');
      },
      Pair(_key, pair) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new Error('Mapping keys must be strings');
      },
    });
    // Keystone metadata is JSON-compatible; aliases are deliberately unsupported.
    const value: unknown = document.toJS({ maxAliasCount: 0 });
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail('YAML_INVALID', file, 'YAML must contain a mapping.');
    }
    assertJson(value);
    return value as Record<string, unknown>;
  } catch {
    fail('YAML_INVALID', file, 'YAML must be a JSON-compatible mapping with string keys, supported values, and no aliases or duplicate keys.');
  }
}

export function parseMarkdown(text: string, file: string): {
  metadata: Record<string, unknown> | null;
  body: string;
} {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0]?.trimEnd() !== '---') return { metadata: null, body: normalized };
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---');
  if (end < 0) fail('FRONTMATTER_UNCLOSED', file, 'Front matter has no closing --- delimiter.');
  return { metadata: parseYaml(lines.slice(1, end).join('\n'), file), body: lines.slice(end + 1).join('\n') };
}
