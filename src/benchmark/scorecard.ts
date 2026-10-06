import { readFileSync } from 'node:fs';
import { schemaDiagnostics, specificationDirectory, type PlanSpec } from './specs.js';

export type Source = 'deterministic' | 'reported' | 'judged';
export interface MeasureDefinition {
  name: string; category: 'quality' | 'continuity' | 'efficiency' | 'diagnostic'; source: Source;
  scope: 'primary' | 'diagnostic' | 'primary-if-universal'; unit: string; description: string;
}

/** The scorecard definition (`benchmark/specification/scorecard.json`) classifies every measure. */
export const scorecard: { measures: MeasureDefinition[] } = (() => {
  const data = JSON.parse(readFileSync(new URL('scorecard.json', specificationDirectory), 'utf8'));
  const errors = schemaDiagnostics('scorecard', data, 'benchmark/specification/scorecard.json');
  if (errors.length) throw new Error(`Invalid scorecard definition: ${errors[0].message}`);
  return data;
})();

export function definition(name: string): MeasureDefinition | undefined {
  return scorecard.measures.find(m => m.name === name) ??
    scorecard.measures.find(m => m.name.endsWith(':*') && name.startsWith(m.name.slice(0, -1)));
}

/** Only numeric measures that can be primary may carry composite weights. */
export function weightable(measure: string, plan: PlanSpec): boolean {
  const found = definition(measure);
  if (!found || found.scope === 'diagnostic' || found.unit === 'verdict') return false;
  if (found.scope === 'primary-if-universal') return (plan.telemetry.wrap ?? []).includes(measure.slice(measure.indexOf(':') + 1)) && plan.telemetry.enabled;
  return true;
}
