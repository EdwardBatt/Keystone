import { createHash } from 'node:crypto';
import { serialize } from '../core.js';

export const identityFields = ['context_type', 'id', 'schema_version'];
export const requirementFields = ['adrs', 'depends_on', 'feature', 'features', 'files', 'key_adrs', 'key_rules', 'priority', 'rules', 'skills', 'tags', 'tasks', 'title'];
export const lifecycleFields = ['completed', 'created', 'status'];
export const requirementSections = ['Objective', 'Acceptance Criteria', 'Scope', 'Out of Scope', 'Dependencies', 'Relevant Files', 'Decisions / ADRs'];
export const claimSections = ['Implementation Notes', 'Tests', 'Review Findings', 'Outcome'];
/** Written after review; excluded from evidence identity. */
export const dispositionSections = ['Review Findings', 'Outcome'];

export interface Section { name: string; content: string }
export interface Partition {
  requirements: Section[];
  claims: Section[];
  unrecognised: Section[];
  unsafe?: string;
}

export const hash = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : serialize(value)).digest('hex');

function trim(lines: string[]): string {
  const copy = [...lines];
  while (copy.length && !copy[0].trim()) copy.shift();
  while (copy.length && !copy[copy.length - 1].trim()) copy.pop();
  return copy.join('\n');
}

/** Partitions a task body on exact level-2 headings; any structural doubt is unsafe. */
export function partitionTask(body: string): Partition {
  const lines = body.split('\n');
  const result: Partition = { requirements: [], claims: [], unrecognised: [] };
  const unsafe = (reason: string): Partition => ({ requirements: [], claims: [], unrecognised: [], unsafe: reason });
  const firstText = lines.findIndex(line => line.trim());
  let fence: string | undefined;
  let current: { name: string; start: number } | undefined;
  const preamble: string[] = [];
  const sections: { name: string; lines: string[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) fence = undefined;
    } else if (!fence) {
      const previous = lines[i - 1] ?? '';
      if (/^ {0,3}(=+|-+)\s*$/.test(line) && previous.trim() && !/^ {0,3}#/.test(previous)) return unsafe('setext heading');
      const heading = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/);
      if (heading) {
        const level = heading[1].length;
        const name = (heading[2] ?? '').trim();
        if (level === 1) {
          if (i !== firstText || sections.length) return unsafe('level-1 heading other than the leading title');
          continue;
        }
        if (level === 2) {
          sections.push({ name, lines: [] });
          current = { name, start: i };
          continue;
        }
      }
    }
    if (current) sections[sections.length - 1].lines.push(line);
    else if (i !== firstText || !/^ {0,3}# /.test(line)) preamble.push(line);
  }
  if (fence) return unsafe('unclosed fence');
  if (trim(preamble)) result.unrecognised.push({ name: '(preamble)', content: trim(preamble) });
  const seen = new Set<string>();
  for (const section of sections) {
    const content = trim(section.lines);
    if (requirementSections.includes(section.name)) {
      if (seen.has(section.name)) return unsafe(`duplicate requirement heading: ${section.name}`);
      seen.add(section.name);
      result.requirements.push({ name: section.name, content });
    } else if (claimSections.includes(section.name)) result.claims.push({ name: section.name, content });
    else result.unrecognised.push({ name: section.name, content });
  }
  return result;
}

export interface MetadataClasses {
  identity: Record<string, unknown>;
  requirement: Record<string, unknown>;
  lifecycle: Record<string, unknown>;
  unrecognised: Record<string, unknown>;
}

export function classifyMetadata(metadata: Record<string, unknown>): MetadataClasses {
  const classes: MetadataClasses = { identity: {}, requirement: {}, lifecycle: {}, unrecognised: {} };
  for (const [key, value] of Object.entries(metadata)) {
    const target = identityFields.includes(key) ? classes.identity : requirementFields.includes(key) ? classes.requirement :
      lifecycleFields.includes(key) ? classes.lifecycle : classes.unrecognised;
    target[key] = value;
  }
  return classes;
}
