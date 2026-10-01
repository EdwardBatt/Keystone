import { compare, serialize, type Diagnostic, type Artifact } from '../core.js';

export type Outcome = 'complete' | 'incomplete/conflicted' | 'failed';
export type Role = 'scope' | 'binding' | 'supporting' | 'review' | 'history' | 'conflicted' | 'evidence';
export interface Reason { source: string; field: string; role: Role; tier: number }
export interface Entry {
  id: string; type: Artifact['type'] | 'file'; path: string; hash: string;
  metadata: Record<string, unknown>; role: Role; tier: number; reasons: Reason[];
  content?: string; excerpt: 'whole-body' | 'sections' | 'file';
}
export interface Replacement { older: string; newer: string; declarations: string[]; qualified: boolean }
export interface Envelope {
  generated_by: 'keystone'; schema_version: 1; kind: 'start-envelope';
  task: { id: string; status: unknown }; outcome: 'complete' | 'incomplete/conflicted';
  authorization: 'not-established'; inventory: { id: string; type: string; path: string; status: unknown }[];
  entries: Entry[]; replacements: Replacement[]; diagnostics: Diagnostic[];
  omissions: { id: string; path: string; reason: string }[];
  budget: { target: number; estimated_tokens: number; exceeded: boolean; estimator: string };
}
export const estimate = (text: string): number => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
export const entryOrder = (a: Entry, b: Entry): number => a.tier - b.tier || compare(a.role, b.role) || compare(a.type, b.type) || compare(a.id, b.id);

/** Conservative extraction: any doubt about omitted prose retains the complete body. */
export function excerpt(body: string): { content: string; excerpt: 'whole-body' | 'sections' } {
  const fallback = { content: body, excerpt: 'whole-body' as const };
  const lines = body.split('\n');
  const headings: { name: string; line: number; level: number }[] = [];
  let fence: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const marker = lines[i].match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(lines[i])) fence = undefined;
      continue;
    }
    if (fence) continue;
    if (/^ {0,3}(=+|-+)\s*$/.test(lines[i])) return fallback;
    const heading = lines[i].match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) headings.push({ name: heading[2], line: i, level: heading[1].length });
  }
  if (fence) return fallback;
  const ranges: [number, number][] = [];
  for (const name of ['Decision', 'Constraints']) {
    const found = headings.filter(h => h.name === name);
    if (found.length !== 1 || found[0].level !== 2) return fallback;
    const start = found[0].line;
    const end = headings.find(h => h.line > start && h.level <= 2)?.line ?? lines.length;
    if (!lines.slice(start + 1, end).join('\n').trim()) return fallback;
    ranges.push([start, end]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  // Only a unique leading H1 is safely identifiable as the document title.
  const titles = headings.filter(h => h.level === 1);
  const titleLine = titles.length === 1 && titles[0].line === lines.findIndex(line => line.trim()) &&
    titles[0].line < ranges[0][0] ? titles[0].line : -1;
  if (lines.some((line, i) => line.trim() && !ranges.some(([s, e]) => i >= s && i < e) && i !== titleLine)) return fallback;
  return { content: ranges.map(([s, e]) => lines.slice(s, e).join('\n')).join('\n'), excerpt: 'sections' };
}

export function pack(envelope: Envelope, unavailable: Set<string>): Envelope {
  const bodies = new Map(envelope.entries.map(e => [e.id, e.content]));
  for (const entry of envelope.entries) {
    if (entry.tier >= 2 || unavailable.has(entry.id)) {
      delete entry.content;
      envelope.omissions.push({ id: entry.id, path: entry.path, reason: unavailable.has(entry.id) ? 'non-text-file' : 'budget' });
    }
  }
  const cost = () => { const { budget: _budget, ...rest } = envelope; return estimate(serialize(rest)); };
  for (const entry of envelope.entries) {
    if (entry.tier < 2 || unavailable.has(entry.id)) continue;
    const omission = envelope.omissions.find(o => o.id === entry.id)!;
    envelope.omissions = envelope.omissions.filter(o => o !== omission);
    entry.content = bodies.get(entry.id);
    if (cost() > envelope.budget.target) {
      delete entry.content;
      envelope.omissions.push(omission);
    }
  }
  envelope.omissions.sort((a, b) => compare(a.id, b.id));
  envelope.budget.estimated_tokens = cost();
  envelope.budget.exceeded = envelope.budget.estimated_tokens > envelope.budget.target;
  return envelope;
}
