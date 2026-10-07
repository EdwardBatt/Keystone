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
- `phase6.test.mjs`: COMPACT and ADR-0003 retirement, covering:
  - the read-only, reproducible report and its deterministic signals;
  - retirement with and without successors, and START treating retired knowledge as history;
  - every blocking check (successor provenance, type, eligibility, cycles, artifact types,
    task status) and all-or-nothing behaviour;
  - CLI usage, idempotent re-runs and terminal retirement;
  - injected write failures with full restoration;
  - visible binding removals when a successor is retired (owner decision I1);
  - the standing validation invariants, including `superseded_by` on live knowledge (I2);
  - CLOSE refusing to promote retired knowledge, and paths with spaces without Git.
  - review remediation: generated trap `files` in containment, truthful rollback and leftover
    temporary-file reporting, byte-for-byte preservation (BOM, CRLF, lone CR, flow style),
    severity-aware binding reporting and flag precedence on `context explain`;
  - multi-successor branching and every retirement-specific START history path;
  - report grouping with hostile-but-valid task and feature IDs (`constructor`, `toString`,
    `hasOwnProperty` and other inherited member names), read-only and with retirement.
- `phase7.test.mjs`: the `keystone-bench` harness and the ADR-0004 exclusions, covering:
  - specification validation with stable codes, and the peer reference conditions;
  - one fresh, isolated clone per run at the pinned commit, with the subject and Keystone tree
    unchanged, and `prepare` staging files without running setup (owner decision I2);
  - multi-session runs as separate processes, with known-answer scoring of oracles, a seeded-trap
    recurrence, rework, reported usage and instrumentation;
  - truthful timeout, agent-failure and setup-failure records;
  - manual mode equivalence with an automated run;
  - seeded, reproducible ordering;
  - protocol read-only behaviour under each telemetry setting, and the static process,
    import, network and dependency boundary (I1);
  - content-free, opt-in telemetry stored outside the workspace;
  - neutrality: no Keystone or operator variables reach a control condition, identical inputs
    across conditions, and diagnostics kept out of comparisons and composites;
  - blinded judging packets and attested judgement import;
  - balanced, byte-identical scores and reports, with composites only from declared weights;
  - provenance, evidence hashes and tamper refusal;
  - plan-change detection, for the plan file and referenced bundles;
  - `benchmark/results/` and `benchmark/analysis/` exclusion from discovery, configuration,
    START and review context (`benchmark/plans/` is covered by `phase8-prep.test.mjs`);
  - smoke plans kept out of benchmark results, and truthful write failures.

  Every run uses the deterministic fake agent (`fixtures/bench/profiles/fake/fake-agent.mjs`),
  which executes `FAKE` directives from its prompt and calls no model. The fixture subject is
  materialized as a temporary Git repository under a path with spaces; no network is used.
- `phase7-review.test.mjs`: regression tests for the TASK-0013 independent-review blockers B1–B8, each
  reproducing the reported attack: operator- and agent-defined Git filter, textconv and fsmonitor
  programs; junction aliases into the subject or Keystone tree; staged inputs adopted by a changed
  plan; partial temporary writes and unpersisted run state (injected `node:fs` failures);
  evidence-tree substitution; tool universality over every planned run; recorded source labels;
  and content-bearing tool or model identifiers. `bench-helpers.mjs` holds the shared harness test
  helpers.
- `phase7-review2.test.mjs`: regression tests for the TASK-0013 round 2 re-review: junction
  substitution of workspaces, harness, results `runs/`, `judgements/` and analysis directories after
  validation (including during a session), blinded-export destinations inside the subject, and
  durable identity limited to the profile's trusted identifiers.
- `phase7-review3.test.mjs`: round 3, under the owner-clarified threat boundary (deterministic
  aliases present when the harness acts): `snapshots.git` aliases before and during a session,
  hard-linked prompt and output destinations, and trusted model lists that would exceed the durable
  model field.
- `phase8-prep.test.mjs`: TASK-0015 Phase 8 preparation, offline and synthetic:
  - version 1 compatibility, and version 2 plans that name repositories by ID, with structural
    validation, `--repos` resolution and pinned-commit checks;
  - the canonical `benchmark/plans/<plan-id>/` location, `freeze`, and the frozen-plan gates;
  - the tool-version probe, observed identity and model-mismatch flags;
  - the synthetic, unverified `codex-jsonl` fixture;
  - preserved attempts and `rerun`;
  - version 2 judging: inspection and symmetric redaction, the audit sample, the release gate,
    per-judge judgements, and verdicts never averaged;
  - exposure verification (including E4, the benchmark repository on the inherited PATH), the
    condition-blind `calibrate` export and pilot gating;
  - the classification predicates and zero-value rules, and the `analyze` end-to-end procedure;
  - the `benchmark/plans/` protocol exclusion (C1).

  `bench2-helpers.mjs` builds a subject, a separately pinned benchmark repository and a Keystone
  tree (all temporary Git repositories) for each test.
- `fixtures/bench`: the synthetic benchmark subject, task (task, regression and trap oracles),
  fixture conditions and agent profiles. It is never benchmark evidence.
  `fixtures/bench/smoke` holds the clean task and Claude Code profile used once for the TASK-0013
  real-agent smoke run; no automated test invokes a real agent. `fixtures/bench/v2` holds the
  version 2 fake-agent profile (with its version probe) and a synthetic judging rubric and prompt.
  `fixtures/bench/usage` holds the synthetic, unverified Codex event stream.
- `fixtures/valid`: a generic target repository covering every supported artifact type.
  Invalid cases are created as explicit mutations of these fixtures in temporary roots.

Tests verify their temporary directory boundary before recursive cleanup. On Windows,
directory-junction tests do not require the elevated privilege needed for file symlinks.
See `docs/PHASE-0-1.md` for the error-code inventory and validation boundaries.
