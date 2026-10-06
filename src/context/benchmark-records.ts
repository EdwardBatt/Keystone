/** Root-level `benchmark/results/` and `benchmark/analysis/` hold durable, non-authoritative
 * benchmark records and generated summaries. They are never discovered, never a configured source,
 * and never START or review-context input (ADR-0004 guarantee 7). Compared case-insensitively.
 */
export function isBenchmarkRecordPath(relative: string): boolean {
  const [first, second] = relative.replace(/\\/g, '/').split('/').map(segment => segment.toLowerCase());
  return first === 'benchmark' && (second === 'results' || second === 'analysis');
}
