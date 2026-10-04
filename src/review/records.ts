import { readdir, readFile } from 'node:fs/promises';
import { compare, type Diagnostic } from '../core.js';
import { isMissing, safePath } from '../paths.js';

export const roles = ['architecture', 'code', 'context'] as const;
export type ReviewRole = typeof roles[number];

/** Root-level `reviews/` is never START or review-context input (ADR-0002 guarantee 8). */
export function isReviewRecordPath(relative: string): boolean {
  return relative.replace(/\\/g, '/').split('/')[0].toLowerCase() === 'reviews';
}

/** Reads report names only, never report contents, to propose each role's next round. */
export async function nextRounds(root: string, taskId: string): Promise<{ rounds: Record<ReviewRole, number>; diagnostics: Diagnostic[] }> {
  const rounds = Object.fromEntries(roles.map(role => [role, 1])) as Record<ReviewRole, number>;
  const diagnostics: Diagnostic[] = [];
  let names: string[] = [];
  try {
    names = (await readdir(await safePath(root, `reviews/${taskId}`))).sort(compare);
  } catch (error) {
    if (!isMissing(error)) diagnostics.push({ code: 'REVIEW_REPORT_NAME_INVALID', path: `reviews/${taskId}`, message: 'Review record directory cannot be listed safely; rounds start at 1.' });
    return { rounds, diagnostics };
  }
  const lower = new Map<string, number>();
  for (const name of names) lower.set(name.toLowerCase(), (lower.get(name.toLowerCase()) ?? 0) + 1);
  for (const name of names) {
    const match = name.match(/^(code|architecture|context)-([1-9][0-9]*)\.md$/);
    if (!match || lower.get(name.toLowerCase())! > 1) {
      diagnostics.push({ code: 'REVIEW_REPORT_NAME_INVALID', path: `reviews/${taskId}/${name}`, message: 'Not a valid <role>-<round>.md report name; ignored for round allocation.' });
      continue;
    }
    const role = match[1] as ReviewRole;
    rounds[role] = Math.max(rounds[role], Number(match[2]) + 1);
  }
  return { rounds, diagnostics };
}

/** A placeholder charter has nothing beyond headings and blank lines. */
export function hasCharterContent(text: string): boolean {
  return text.replace(/^﻿/, '').split(/\r?\n/).some(line => line.trim() && !/^ {0,3}#{1,6}(\s|$)/.test(line));
}

export async function defaultCharter(role: ReviewRole): Promise<string> {
  return (await readFile(new URL(`../../templates/agents/${role}-reviewer.md`, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
}
