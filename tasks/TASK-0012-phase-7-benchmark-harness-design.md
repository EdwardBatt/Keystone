---
context_type: task
schema_version: 1
id: TASK-0012
title: Design Phase 7 Benchmark Harness
status: accepted
priority: high
depends_on: [TASK-0011]
adrs: [ADR-0001, ADR-0002, ADR-0003, ADR-0004]
files:
  - docs/TASK-0012-phase-7-benchmark-harness-design.md
  - adr/ADR-0004-benchmark-harness-boundaries.md
  - SPEC.md
  - ARCHITECTURE-DECISIONS.md
  - PROJECT.md
  - docs/REPO-SEPARATION.md
  - SETUP.md
  - benchmark/specification/README.md
  - benchmark/tasks/README.md
  - benchmark/scoring/README.md
  - benchmark/results/README.md
  - benchmark/analysis/README.md
  - templates/TARGET-REPO-TREE.md
  - src/commands/init.ts
  - src/context/generated.ts
created: 2026-10-05
completed: 2026-10-05
---
# TASK-0012 — Design Phase 7 Benchmark Harness

## Objective
Design the Phase 7 Benchmark Harness: a controlled, reproducible way to measure whether Keystone
improves long-running AI-assisted development, under isolated conditions (D23) and with a
balanced quality and efficiency scorecard (D24). This supports the SPEC acceptance baseline
"support benchmark fixtures". Design only.

## Acceptance Criteria
- The design records what is already decided for Phase 7, separately from implementation
  discretion. The sources are SPEC.md, D01–D26, PROJECT.md, `docs/REPO-SEPARATION.md`, `SETUP.md`
  and the accepted ADRs.
- Each genuinely necessary owner decision is recorded with its constraints, options, trade-offs,
  a recommendation and the owner's resolution.
- The resulting design covers:
  - the harness's responsibilities, and the boundary with Phase 8 (Cross-model Trial);
  - what Keystone's benchmark area holds versus the separate benchmark application (Repo B),
    without putting application-specific knowledge in Keystone;
  - the benchmark conditions and how each condition is isolated in a clean clone or worktree
    (D23);
  - how agents or models are run, and how that coexists with offline, model-free Keystone
    commands;
  - the benchmark task specification format and fixtures;
  - the scorecard: quality and efficiency measures, how each is measured, and how they are
    combined or reported (D24);
  - telemetry: what Keystone records, where (`.context/telemetry/` is a generated location),
    and that it never becomes authoritative context;
  - result records, their authority, reproducibility and provenance;
  - the split between deterministic measurement and semantic or human judgement (D15);
  - the CLI or command surface, if any, and the outcomes and safety guarantees;
  - offline testability with fixtures.
- No new architectural decision is made beyond what the owner resolves. An ADR is drafted only
  if a resolved decision requires one, and stays proposed until adopted.
- Acceptance scenarios for the implementation task are proposed.

## Scope
Phase 7 Benchmark Harness design within the v0.1 requirements. Output: non-authoritative design
notes at `docs/TASK-0012-phase-7-benchmark-harness-design.md` and, only if required, a proposed
ADR and SPEC amendment.

## Out of Scope
- Implementing the harness, or changing any source code, schema, template, SPEC.md or ADR before
  the owner decides.
- Building, scaffolding or modifying the benchmark application (Repo B), or adding any of its
  domain knowledge to Keystone.
- Running benchmark trials or producing results.
- Phase 8 (Cross-model Trial) and `context explain`.
- Changes to START, REVIEW, CLOSE or COMPACT semantics.
- External memory services, vector search, embeddings, GUIs (SPEC non-goals, D25).
- Licensing and Git history rewriting.

## Dependencies
TASK-0011 (Phase 6, the last pre-benchmark phase). The harness measures the whole Keystone
workflow: `init`, START (ADR-0001), REVIEW (ADR-0002), CLOSE and COMPACT (ADR-0003). D23 and D24
define the baseline benchmark constraints.

## Relevant Files
See the front-matter `files` links. The `benchmark/` subdirectories are reserved placeholders,
and `src/telemetry/` is empty.

## Decisions / ADRs
The owner authorized moving TASK-0012 from `proposed` to `active` on 2026-10-05, asked for
options, trade-offs and a recommendation for decisions 1–8 (design notes revision 1), and set a
boundary: **Phase 7 builds the reusable measurement infrastructure; Phase 8 performs the
cross-model experiment.**

Owner decisions made on 2026-10-05:
1. **B1(b), agent execution.** A generic external-command runner configured by agent profiles,
   with a manual mode. Protocol commands stay offline and model-free.
2. **B2(b), conditions.** Declarative, versioned conditions, separate from agent profiles; a
   fresh local clone per run (D23).
3. **B3(b), content location.** Generic specifications, reference conditions and synthetic
   fixtures in Keystone; application task content in Repo B, pinned by commit. Repo B is not
   created in Phase 7.
4. **B4(c), scorecard.** A balanced, source-labelled scorecard; a composite only from weights
   declared in an experiment plan.
5. **B5, modified, telemetry.** Opt-in, local and content-free, but it belongs to `keystone-bench`
   or an explicitly invoked instrumentation mechanism. Ordinary `keystone` commands keep their
   existing read-only semantics; enabling telemetry must not make `keystone validate` or
   `keystone context status` write files.
6. **B6(b), trial design.** Repetitions, seeded ordering, multi-session tasks and blinded judged
   scoring are supported; Phase 8 chooses the values.
7. **B7(b), Phase 7 / Phase 8 boundary.** An offline fixture suite with a fake agent, plus one
   real-agent smoke run. The smoke run is integration verification only and never benchmark
   evidence.
8. **B8(b), results.** Durable, non-authoritative records in `benchmark/results/`; never
   discovered, START-ineligible and refused as sources.
9. **Command surface (b).** A separate `keystone-bench` executable.
10. **Added invariant: neutrality.** The harness must be neutral between Keystone and control
    conditions, and must not require or structurally privilege Keystone in the environment being
    measured.

ADR-0004, "Benchmark harness boundaries", was drafted as `proposed`. On 2026-10-05 the owner
adopted it as drafted, with two changes:
- **Guarantee 8 clarification.** Every recorded run and result must identify the exact experiment
  plan it used through immutable provenance, sufficient to detect any later change to that plan.
  The plan is fixed before its runs begin.
- **Location.** `src/telemetry/` stays reserved and unused in Phase 7; harness instrumentation
  belongs under `src/benchmark/`.

ADR-0004 is `accepted`, and the SPEC.md amendment is applied.

## Implementation Notes
Design only. Design notes revision 3 (`docs/TASK-0012-phase-7-benchmark-harness-design.md`) is
the complete design record:
- the derived requirements and the harness/experiment boundary;
- B1–B8 and the command surface, with options, trade-offs and the owner's resolutions (B5
  modified);
- the neutrality invariant;
- the resulting Phase 7 design, including fixed experiment plans with plan provenance;
- the applied SPEC amendment;
- 22 proposed acceptance scenarios.

ADR-0004 keeps only durable guarantees, following the lesson recorded in ADR-0002's clarification:
1. separate executable; protocol commands unchanged;
2. controlled agent execution;
3. run isolation;
4. neutrality;
5. harness-owned telemetry;
6. measure provenance;
7. results excluded from discovery and START (supplementing ADR-0001);
8. the harness/experiment boundary with fixed, provenance-tracked plans;
9. the implementation contract.

The SPEC.md amendment, made with adoption:
- adds `benchmark` to the `src/{…}` layout;
- adds the `keystone-bench` CLI contract (`validate`, `prepare`, `run`, `record`, `score`,
  `report`) after the `keystone` commands;
- adds a "Benchmark harness" section summarising ADR-0004, including plan provenance and the
  reserved `src/telemetry`;
- extends the START paragraph: `benchmark/results/` and `benchmark/analysis/` join `reviews/` as
  never discovered, invalid as configured sources, and ineligible for START and review-context
  selection.

Known gaps, left for the Phase 7 implementation task:
- **Exclusions not enforced yet.** Discovery, configuration validation and START do not yet
  enforce the `benchmark/results/` and `benchmark/analysis/` exclusions, and `keystone-bench`
  does not exist. The adopted contract is ahead of the code, as ADR-0002 and ADR-0003 were before
  their implementation tasks.
- **Documentation.** `docs/PHASE-0-1.md` and `docs/PHASE-3.md` describe only the `reviews/`
  exclusion; the implementation task updates them with the code, and creates `docs/PHASE-7.md`.

No source code, test, schema or template was changed. This task does not authorize implementing
Phase 7, creating Repo B or running trials.

## Tests
Design task: no implementation tests apply. Baseline at task creation (2026-10-05, commit
`d80c3c8`): `npm run build` and `npm run check` passed; `npm test` passed 209 of 209 with no
failures, skips or cancellations.

Verification of design notes revision 1 on 2026-10-05: `validate` passed with 16 artifacts and no
diagnostics; after `index`, `context status` reported configuration present and index current;
START for TASK-0012 was `complete` with no diagnostics.

Verification of design notes revision 2 and proposed ADR-0004 on 2026-10-05: `validate` passed
with 17 artifacts and no diagnostics; after `index`, `context status` reported configuration
present and index current; START for TASK-0012 was `complete` with no diagnostics, with ADR-0001,
ADR-0002 and ADR-0003 binding and ADR-0004 selected as non-binding Tier 1 review material.

Closure verification on 2026-10-05, after ADR-0004 adoption and the SPEC.md amendment:
- `npm run build` and `npm run check` passed.
- `npm test` passed 209 of 209 with no failures, skips or cancellations. No source code changed.
- `validate` passed with 17 artifacts and no diagnostics.
- After `index`, `context status` reported configuration present and index current.
- START for TASK-0012 was `complete` with no diagnostics, with ADR-0001, ADR-0002, ADR-0003 and
  ADR-0004 binding at Tier 1.

## Review Findings
Owner review on 2026-10-05, in three steps:
1. Revision 1 recommendations reviewed. B1(b), B2(b), B3(b), B4(c), B6(b), B7(b), B8(b) and the
   separate `keystone-bench` were approved, B5 was modified, and the neutrality invariant was
   added.
2. The ADR-0004 draft and SPEC amendment were reviewed, and adoption approved with the guarantee 8
   plan-provenance clarification and `src/telemetry/` kept reserved.
3. ADR-0004 adopted and the SPEC.md amendment applied.

No independent (separate model or host) review of this design was performed; TASK-0008 and
TASK-0010 were likewise accepted on owner review.

## Outcome
Accepted on 2026-10-05 with owner authorization. The Phase 7 Benchmark Harness design is complete:
- decisions B1–B8 and the command surface are resolved (B5 modified), with the neutrality
  invariant;
- ADR-0004 is accepted, with the guarantee 8 plan-provenance clarification;
- SPEC.md is amended;
- design notes revision 3 (`docs/TASK-0012-phase-7-benchmark-harness-design.md`) is the design
  record.

The 22 proposed acceptance scenarios in design notes revision 3 form the accepted design baseline
for the Phase 7 implementation task.

Phase 7 is not implemented. Implementation requires a separately authorized task, which also
closes the known gaps recorded under Implementation Notes.
