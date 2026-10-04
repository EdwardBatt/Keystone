---
context_type: task
schema_version: 1
id: TASK-0007
title: Implement Phase 4 Review
status: accepted
priority: high
depends_on: [TASK-0006]
adrs: [ADR-0001, ADR-0002]
files:
  - SPEC.md
  - docs/TASK-0006-phase-4-review-design-proposal.md
  - docs/PHASE-4.md
created: 2026-10-04
completed: 2026-10-04
---
# TASK-0007 — Implement Phase 4 Review

## Objective
Implement `keystone review <TASK-ID> [--type code|architecture|context|all] [--base <rev>]` as
specified by ADR-0002 and the SPEC.md Review evidence section, including the ADR-0002 START
supplement.

## Acceptance Criteria
- The implementation satisfies ADR-0002, SPEC.md and D13–D15. These are the only
  architectural acceptance criteria.
- `docs/PHASE-4.md` records the implementation mechanisms and the acceptance behaviour. It
  creates no new architectural requirements; mechanisms in it may change without an ADR while
  ADR-0002, SPEC.md and D13–D15 remain satisfied. TASK-0006 revision 6 is implementation
  guidance, not a requirement.
- Automated tests demonstrate the acceptance behaviour recorded in `docs/PHASE-4.md`. Build,
  type check and the full suite pass offline.
- Existing Phase 0–3 behaviour is preserved, apart from the ADR-0002 START supplement.

## Scope
Phase 4 Review implementation and its tests and documentation.

## Out of Scope
Phase 5 CLOSE semantics, verdict ingestion, report validation in `validate`, automatic
prior-report inclusion, adapters, and any change to accepted architecture.

## Dependencies
TASK-0006 (accepted design), ADR-0002 (accepted), ADR-0001.

## Relevant Files
See the front-matter `files` links, ADR-0002 and TASK-0006.

## Decisions / ADRs
Implements ADR-0002, including its supplement to ADR-0001. ADR-0002 was revised in place on
2026-10-04 (see its Clarification) to keep only durable guarantees. No new architectural
decision is made by this task.

## Implementation Notes
Deriving the contract on 2026-10-04, against the first adopted ADR-0002 text, raised three
questions. After ADR-0002 was revised into guarantees, the owner decided on 2026-10-04 that all
three are **implementation-contract questions, not architectural blockers**:

- **G1:** generated `.context/` state can enter the review subject in repositories that do not
  ignore it, so review output could feed back into later subjects. Disposition: generated
  review state must not contaminate evidence (ADR-0002 guarantee 7). Choose the simplest
  deterministic implementation and record it in `docs/PHASE-4.md`.
- **C1:** where the next round number appears. Disposition: procedural and package design,
  decided in `docs/PHASE-4.md`.
- **C2:** commit flags and `HEAD` movement versus evidence-hash stability. Disposition:
  evidence-hash composition is implementation-level, provided review output cannot invalidate
  the evidence it describes (guarantee 7).

The other implementation choices already identified are made normally and documented in
`docs/PHASE-4.md`:
- `--type` defaults to `all`;
- `--root` must be the Git top-level;
- malformed or case-colliding base files are treated as quarantined;
- the base tree is materialised under `.context/review/`;
- non-root task files are included whole;
- the managed-file list comes from `init`.

**Implementation (2026-10-04).** `keystone review` is implemented as specified in
`docs/PHASE-4.md`, which records the mechanisms chosen:
- **Subject:** compared from raw Git objects against the working tree. Root-level `reviews/**`
  and all generated paths are excluded even when `.context/` is not ignored (G1).
- **Base context:** the base tree is materialised under `.context/review/` and run through the
  existing discovery, graph and ADR-0001 selection, with quarantine.
- **Root task:** requirements come from base; claims are withheld from code and architecture
  and given to context marked unverified.
- **Packages:** one per role. Each states its own report round (C1).
- **Evidence hash:** excludes commit flags, lifecycle fields, disposition sections, the root
  task's file entry and all operational checks (C2). Review output, reports, dispositions,
  status changes and commits therefore cannot change it.
- **Git:** isolated by the sanitised environment and options, with a capability probe.
- **START supplement:** discovery skips `reviews/`, config rejects `reviews` sources, and
  validly identified review-record links are refused with `START_REVIEW_RECORD_INELIGIBLE`.
- **Reports:** the report schema and template, and default charters.

Behaviour of existing `init`, `index`, `validate`, `status` and START is otherwise unchanged.

**Defect fixes (2026-10-04, from Codex review):**
1. Invalid UTF-8 governing context was decoded with replacement characters, and review could
   still be `complete`. Governing artifacts and the root task are now decoded strictly. Invalid
   Tier 0 or binding context, or an invalid root task, fails with `REVIEW_CONTEXT_UNREADABLE`;
   invalid lower-tier context is an explicit gap.
2. A malformed competing task candidate was ignored when a valid root existed. Any malformed or
   unreadable task candidate now fails with `REVIEW_ROOT_AMBIGUOUS` unless a readable,
   different `id` rules it out.

**Non-blocking product observation, for follow-up after Phase 4 acceptance:** review packages
for real work are large (about 40–50k estimated tokens for TASK-0007) because full subject
diffs are never trimmed. This is reported in each package's budget and is not addressed in
this task.

## Tests
Implementer verification on 2026-10-04, to be confirmed by independent review:
- `npm run check` passed.
- `npm test` passed 171 tests (19 in `tests/phase4.test.mjs`, including regressions for both
  defect fixes) with no failures, skips or cancellations.
- `keystone review` was exercised on this repository: current work, a pre-implementation
  baseline for TASK-0004, a task introduced by commits (TASK-0006), and an invalid baseline.
- Both defect reproductions were run through the CLI on fresh repositories and now fail
  safely: exit 2, nothing installed.

## Review Findings
Codex's independent review reported two blocking implementation defects: invalid UTF-8
governing context, and an ignored malformed competing task candidate. Both were fixed (see
Implementation Notes).

The independent reviewer re-checked the fixes and recorded the outcome as **VERIFIED**. Both
findings are resolved. Final test result: 171/171 passing.

## Outcome
Accepted on 2026-10-04 with owner authorization, after independent verification. Phase 4
Review is complete: `keystone review` satisfies ADR-0002, SPEC.md and D13–D15, with mechanisms
recorded in `docs/PHASE-4.md`.

The large review-package size (about 50,000 estimated tokens for real work) remains a
non-blocking product observation for future work and is not addressed in this task. Phase 5
(CLOSE) defines the verdict and staleness semantics.
