# Tests

Run `npm test` after installing dependencies. It builds the TypeScript source, then runs
Node's built-in test runner. Tests use temporary repositories and local fixtures; they
require no network access, Git executable, model credentials, or external service.

- `parser.test.mjs`: YAML/front-matter parsing, schema/template compatibility, portable
  paths, JSON-compatible metadata round trips, rejection of unsupported YAML values,
  and deterministic detection of filename and directory-component case collisions.
- `core.test.mjs`: configuration, artifact discovery, ID/link validation, supersession,
  deterministic rebuilds, idempotence, source preservation, overwrite refusal, casing,
  pre-existing directory-junction checks, and read/root errors. Regression cases cover
  deletion of all generated files, missing explicit sources, and ADR-only supersession.
- `cli.test.mjs`: end-to-end exit codes, JSON and human-readable diagnostics, read-only
  validation, repeated indexing, paths with spaces, and rejection of later-phase commands.
- `fixtures/valid`: a generic target repository covering every supported artifact type.
  Invalid cases are created as explicit mutations of these fixtures in temporary roots.

Tests verify their temporary directory boundary before recursive cleanup. On Windows,
directory-junction tests do not require the elevated privilege needed for file symlinks.
See `docs/PHASE-0-1.md` for the error-code inventory and validation boundaries.
