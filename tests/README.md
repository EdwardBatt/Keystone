# Tests

Run `npm test` after installing dependencies. It builds the TypeScript source, then runs
Node's built-in test runner. Tests use temporary repositories and local fixtures; they
require no network access, model credentials, or external service. Phase 2 tests require
the local Git executable for temporary repository discovery fixtures.

- `parser.test.mjs`: YAML/front-matter parsing, schema/template compatibility, portable
  paths, JSON-compatible metadata round trips, rejection of unsupported YAML values,
  and deterministic detection of filename and directory-component case collisions.
- `core.test.mjs`: configuration, artifact discovery, ID/link validation, supersession,
  deterministic rebuilds, idempotence, source preservation, overwrite refusal, casing,
  pre-existing directory-junction checks, and read/root errors. Regression cases cover
  deletion of all generated files, missing explicit sources, and ADR-only supersession.
- `cli.test.mjs`: end-to-end exit codes, JSON and human-readable diagnostics, read-only
  validation, repeated indexing, paths with spaces, and rejection of later-phase commands.
- `phase2.test.mjs`: local Git-root discovery, safe initialization and force behavior,
  adapter selection, destination conflicts, and read-only status/index freshness.
  Temporary Git fixtures use no network. The linked-worktree test creates an empty local
  fixture commit with test-only identity; it does not commit to the framework repository.
- `phase3.test.mjs`: START authority paths, ADR replacement/conflicts, configured discovery,
  bounded selection, excerpts, budget/omission accounting, all three outcomes, source preservation,
  reproducibility and atomic envelope replacement. Phase 3 fixtures require no Git initialization.
- `phase4.test.mjs`: review evidence packages, covering:
  - role isolation and claim withholding;
  - baseline requirements and introduced tasks;
  - deterministic, uncontaminated evidence identity across packages, reports, dispositions and
    commits;
  - review-record START ineligibility;
  - failure versus incomplete outcomes;
  - non-mutation of project and Git state, and trace isolation;
  - unrepresentable content, charters and commit flags;
  - partition and diff mechanics, and the report contract.

  Fixtures are local temporary Git repositories with test-only identity; no network is used.
- `phase5.test.mjs`: CLOSE, covering:
  - the three-role current `approve` gate, using real recomputed evidence hashes;
  - every unsatisfied-gate case (missing, stale, verdicts, invalid reports, invalid latest
    round);
  - the owner override (recorded reason, preserved verdicts, never promoting);
  - explicit, checked, all-or-nothing promotion and unchanged unpromoted candidates;
  - the closure record and evidence-hash stability;
  - `already-closed` idempotence;
  - structural, input and evidence failures;
  - injected write failure with full restoration;
  - CLI usage.
- `fixtures/valid`: a generic target repository covering every supported artifact type.
  Invalid cases are created as explicit mutations of these fixtures in temporary roots.

Tests verify their temporary directory boundary before recursive cleanup. On Windows,
directory-junction tests do not require the elevated privilege needed for file symlinks.
See `docs/PHASE-0-1.md` for the error-code inventory and validation boundaries.
