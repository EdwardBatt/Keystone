import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseMarkdown, parseYaml } from '../dist/parser/frontmatter.js';
import { caseCollisions, relativePath } from '../dist/paths.js';
import { validateSchema } from '../dist/validation/schemas.js';
import { serialize } from '../dist/core.js';
import { project } from './helpers.mjs';

test('front matter handles BOM, CRLF, nested YAML, and preserves the Markdown body', () => {
  const parsed = parseMarkdown('\uFEFF---\r\ncontext_type: task\r\nnotes:\r\n  detail: |\r\n    one\r\n    two\r\n---\r\n# Title\r\n---\r\n', 'task.md');
  assert.deepEqual(parsed.metadata, { context_type: 'task', notes: { detail: 'one\ntwo\n' } });
  assert.equal(parsed.body, '# Title\n---\n');
  assert.deepEqual(parseMarkdown('# Plain\n', 'plain.md'), { metadata: null, body: '# Plain\n' });
});

for (const [name, text, code] of [
  ['unclosed front matter', '---\nid: TASK-0001', 'FRONTMATTER_UNCLOSED'],
  ['duplicate YAML keys', '---\nid: A\nid: B\n---', 'YAML_INVALID'],
  ['invalid YAML syntax', '---\nid: [\n---', 'YAML_INVALID'],
  ['non-mapping YAML', '---\n- A\n---', 'YAML_INVALID'],
  ['empty YAML', '---\n---', 'YAML_INVALID'],
  ['aliases', '---\na: &value hello\nb: *value\n---', 'YAML_INVALID'],
  ['unsupported tags', '---\na: !custom value\n---', 'YAML_INVALID'],
  ['non-finite number', '---\na: .inf\n---', 'YAML_INVALID'],
  ['set', '---\nextension: !!set\n  first: null\n  second: null\n---', 'YAML_INVALID'],
  ['nested binary', '---\nextension: [!!binary SGVsbG8=]\n---', 'YAML_INVALID'],
  ['timestamp object', '---\nextension: !!timestamp 2026-09-13\n---', 'YAML_INVALID'],
  ['ordered map', '---\nextension: !!omap\n  - first: 1\n---', 'YAML_INVALID'],
  ['sequence mapping key', '---\n? [a, b]\n: value\n---', 'YAML_INVALID'],
  ['numeric mapping key', '---\nextension:\n  1: value\n---', 'YAML_INVALID'],
  ['unsafe integer', '---\nextension: 9007199254740993\n---', 'YAML_INVALID'],
  ['negative zero', '---\nextension: -0.0\n---', 'YAML_INVALID'],
]) test(`parser rejects ${name}`, () => {
  assert.throws(() => parseMarkdown(text, 'bad.md'), error => error.diagnostic.code === code);
});

test('YAML 1.2 preserves dates as strings and does not coerce yes/no', () => {
  assert.deepEqual(parseYaml('created: 2026-09-13\nanswer: yes', 'test'), { created: '2026-09-13', answer: 'yes' });
});

test('accepted nested metadata round-trips through generated JSON without semantic loss', () => {
  const metadata = parseYaml('text: hello\ninteger: 42\nfraction: 0.125\nflag: true\nempty: null\ndate: 2026-09-13\nitems: [1, two, null, false]\nnested:\n  "1": quoted key\n  __proto__: retained\n', 'valid.md');
  assert.deepEqual(JSON.parse(serialize(metadata)), metadata);
});

test('all existing typed templates conform to their artifact schemas', async () => {
  for (const entry of await readdir(path.join(project, 'templates'), { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = entry.name;
    const parsed = parseMarkdown(await readFile(path.join(project, 'templates', file), 'utf8'), file);
    // Reviewer reports (templates/review.md) are deliberately untyped; see phase4.test.mjs.
    if (parsed.metadata && 'context_type' in parsed.metadata) assert.deepEqual(validateSchema(parsed.metadata.context_type, parsed.metadata, file), [], file);
  }
});

test('metadata requires version and discriminant; keeps future status values and extension fields', () => {
  const data = { context_type: 'task', schema_version: 1, id: 'TASK-0001', title: 'Test', status: 'custom-status', extension: { answer: 42 } };
  assert.deepEqual(validateSchema('task', data, 'task.md'), []);
  for (const changed of [{ ...data, schema_version: 2 }, { ...data, rules: 'RULE-1' }, { ...data, files: ['a', 'a'] }, { ...data, title: ' ' }]) {
    assert.ok(validateSchema('task', changed, 'task.md').every(error => error.code === 'SCHEMA_INVALID'));
    assert.ok(validateSchema('task', changed, 'task.md').length);
  }
});

test('portable paths accept Windows separators and names with spaces', () => {
  assert.equal(relativePath('tasks\\My task.md'), 'tasks/My task.md');
  assert.equal(relativePath('./tasks//one.md'), 'tasks/one.md');
});

test('case collisions are diagnosed deterministically without needing a case-sensitive filesystem', () => {
  const files = ['tasks/task.md', 'tasks/TASK.md', 'tasks/TASK.md', 'rules/GLOBAL.md'];
  const result = caseCollisions(files);
  assert.deepEqual(result, caseCollisions([...files].reverse()));
  assert.equal(result.length, 1);
  assert.equal(result[0].code, 'PATH_CASE_COLLISION');
  assert.equal(result[0].path, 'tasks/task.md');
});

test('case collisions include directory components with different leaf filenames and empty directories', () => {
  for (const files of [
    ['rules/Foo/a.md', 'rules/foo/b.md'],
    ['rules/Foo', 'rules/foo'],
    ['rules/Foo/deep/a.md', 'rules/foo/other/b.md'],
  ]) {
    const result = caseCollisions(files);
    assert.deepEqual(result, caseCollisions([...files].reverse()));
    assert.ok(result.some(diagnostic => diagnostic.code === 'PATH_CASE_COLLISION' && diagnostic.path === 'rules/foo'));
  }
  assert.deepEqual(caseCollisions(['rules/Foo/a.md', 'rules/Foo/b.md', 'rules/Foo']), []);
});

for (const value of ['../escape', 'a/../escape', '/etc/passwd', 'C:\\outside', 'C:relative', '\\\\server\\share', 'a\u0000b', 'a:b', 'a?b', 'NUL', 'dir/CON.md', 'file.', 'file ', '.', '.git/config']) {
  test(`reject unsafe path ${JSON.stringify(value)}`, () => {
    assert.throws(() => relativePath(value), error => error.diagnostic.code === 'PATH_INVALID');
  });
}
