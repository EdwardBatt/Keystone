import { isMap, isScalar, parseDocument, type Pair, type Scalar } from 'yaml';
import { fail, serialize } from '../core.js';
import { parseYaml } from '../parser/frontmatter.js';

export interface RetirementFields {
  retirement: { task: string; reason: string; previous_status: string };
  superseded_by?: string[];
}

const UNSAFE = 'COMPACT_CONTENT_UNREADABLE';
const BOM = String.fromCharCode(0xfeff);

/** Locates front matter in raw text without normalizing a BOM or line endings. */
function frontMatter(raw: string, file: string): { start: number; end: number; eol: string } {
  const lines: { text: string; start: number; eol: string }[] = [];
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/gy;
  pattern.lastIndex = raw.startsWith(BOM) ? 1 : 0;
  while (pattern.lastIndex < raw.length) {
    const start = pattern.lastIndex;
    const match = pattern.exec(raw)!;
    lines.push({ text: match[1], start, eol: match[2] });
    if (!match[2]) break;
  }
  if (lines[0]?.text.trimEnd() !== '---' || !lines[0].eol) fail(UNSAFE, file, 'Front matter cannot be located safely.');
  const closing = lines.findIndex((line, i) => i > 0 && line.text.trimEnd() === '---');
  if (closing < 0) fail(UNSAFE, file, 'Front matter cannot be located safely.');
  return { start: lines[1].start, end: lines[closing].start, eol: lines[0].eol };
}

const json = (value: unknown) => JSON.stringify(value);
/** The YAML parser does not accept a lone CR as a line break; LF is a same-length stand-in, so offsets hold. */
const view = (text: string) => text.replace(/\r(?!\n)/g, '\n');

/**
 * Applies a retirement by minimal textual edits inside the front matter: the `status` value is
 * replaced in its original quoting style, an existing (empty) `superseded_by` value is replaced, and
 * new keys are appended in the mapping's own style. Every other byte, including any BOM, line
 * endings, comments, unrelated formatting and the Markdown body, is preserved. The result is
 * re-parsed and must equal the original metadata plus exactly the retirement fields.
 */
export function retireText(raw: string, file: string, fields: RetirementFields): string {
  const { start, end, eol } = frontMatter(raw, file);
  const yaml = raw.slice(start, end);
  const parsed = view(yaml);
  const original = parseYaml(parsed, file);
  const doc = parseDocument(parsed, { version: '1.2', uniqueKeys: true });
  const root = doc.contents;
  if (!isMap(root) || !root.range) fail(UNSAFE, file, 'Front matter is not an editable mapping.');
  const pair = (key: string) => (root.items as Pair[]).find(p => isScalar(p.key) && p.key.value === key);
  const edits: { at: number; remove: number; text: string }[] = [];
  const replaceValue = (key: string, text: (node: Scalar | undefined) => string) => {
    const value = pair(key)?.value as Scalar | undefined;
    if (!value?.range) fail(UNSAFE, file, `The ${key} value cannot be edited safely.`);
    edits.push({ at: value.range[0], remove: value.range[1] - value.range[0], text: text(isScalar(value) ? value : undefined) });
  };

  if (pair('retirement')) fail(UNSAFE, file, 'A retirement record already exists.');
  replaceValue('status', node => node?.type === 'QUOTE_DOUBLE' ? '"retired"' : node?.type === 'QUOTE_SINGLE' ? "'retired'" : 'retired');
  const additions: [string, unknown][] = [['retirement', fields.retirement]];
  if (fields.superseded_by) {
    if (pair('superseded_by')) replaceValue('superseded_by', () => json(fields.superseded_by));
    else additions.push(['superseded_by', fields.superseded_by]);
  }

  if (root.flow) {
    // The closing brace is the last character of the flow mapping's value range.
    const close = root.range[1] - 1;
    if (parsed[close] !== '}') fail(UNSAFE, file, 'Flow front matter cannot be edited safely.');
    let at = close;
    while (at > root.range[0] && /\s/.test(parsed[at - 1])) at--;
    const separator = /[{,]/.test(parsed[at - 1]) ? '' : ', ';
    edits.push({ at, remove: 0, text: separator + additions.map(([key, value]) => `${json(key)}: ${json(value)}`).join(', ') });
  } else {
    const first = (root.items as Pair[])[0]?.key as Scalar | undefined;
    if (!first?.range) fail(UNSAFE, file, 'Front matter cannot be edited safely.');
    const indent = ' '.repeat(first.range[0] - (parsed.lastIndexOf('\n', first.range[0] - 1) + 1));
    if (!parsed.endsWith('\n')) fail(UNSAFE, file, 'Front matter cannot be edited safely.');
    const lines: string[] = [];
    for (const [key, value] of additions) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        lines.push(`${indent}${key}:`);
        for (const [k, v] of Object.entries(value)) lines.push(`${indent}  ${k}: ${json(v)}`);
      } else lines.push(`${indent}${key}: ${json(value)}`);
    }
    edits.push({ at: yaml.length, remove: 0, text: lines.map(line => line + eol).join('') });
  }

  let edited = yaml;
  for (const edit of edits.sort((a, b) => b.at - a.at)) edited = edited.slice(0, edit.at) + edit.text + edited.slice(edit.at + edit.remove);
  const expected = { ...original, status: 'retired', retirement: fields.retirement, ...(fields.superseded_by ? { superseded_by: fields.superseded_by } : {}) };
  let actual: unknown;
  try { actual = parseYaml(view(edited), file); } catch { fail(UNSAFE, file, 'The retirement edit would not parse; nothing was written.'); }
  if (serialize(actual) !== serialize(expected)) fail(UNSAFE, file, 'The retirement edit would change other metadata; nothing was written.');
  return raw.slice(0, start) + edited + raw.slice(end);
}
