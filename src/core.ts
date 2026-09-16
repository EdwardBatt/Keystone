export type ArtifactType = 'project' | 'task' | 'feature' | 'adr' | 'learning' | 'trap' | 'rule' | 'skill';

export interface Diagnostic {
  code: string;
  path: string;
  message: string;
  field?: string;
}

export class KeystoneError extends Error {
  constructor(public readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.name = 'KeystoneError';
  }
}

export function fail(code: string, path: string, message: string, field?: string): never {
  throw new KeystoneError({ code, path, message, ...(field ? { field } : {}) });
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Locale-independent ordering, including recursively sorted metadata keys. */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compare(a, b))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

export function serialize(value: unknown): string {
  return JSON.stringify(canonical(value), null, 2) + '\n';
}

export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.sort((a, b) => compare(serialize(a), serialize(b)));
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  path: string;
  hash: string;
  metadata: Record<string, unknown>;
}

export interface Link {
  source: string;
  field: string;
  target: string;
  kind: 'artifact' | 'file';
}

export interface Index {
  generated_by: 'keystone';
  schema_version: 1;
  artifacts: Artifact[];
  links: Link[];
}
