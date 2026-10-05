---
context_type: task
schema_version: 1
id: TASK-0010
title: Design Phase 6 COMPACT
status: active
priority: high
depends_on: [TASK-0009]
adrs: [ADR-0001, ADR-0002]
files:
  - docs/TASK-0010-phase-6-compact-design.md
  - SPEC.md
  - ARCHITECTURE-DECISIONS.md
  - docs/TASK-0008-phase-5-close-design.md
  - docs/PHASE-5.md
  - docs/PHASE-0-1.md
  - templates/TARGET-REPO-TREE.md
  - templates/learning.md
  - templates/trap.md
  - templates/STATE.md
  - src/commands/init.ts
  - src/context/config.ts
  - src/context/selection.ts
created: 2026-10-05
completed:
---
# TASK-0010 — Design Phase 6 COMPACT

## Objective
Design `keystone compact` so that verified durable knowledge is consolidated and noise is not
accumulated, while evidence and traceability are preserved (D21; SPEC principles 5 and 9; SPEC
acceptance baseline "compact safely"). Design only.

## Acceptance Criteria
- What SPEC.md, D01–D26, ADR-0001, ADR-0002 and the accepted TASK-0008 contract already decide
  for compaction is recorded, separately from implementation discretion.
- Each genuinely necessary owner decision is recorded with its constraints, options and
  resolution.
- The resulting design covers:
  - which artifacts compaction may act on, and which it must never change;
  - what "consolidation" means and how it preserves evidence and traceability;
  - the disposition of candidates left unpromoted by CLOSE;
  - how consolidated or retired knowledge is represented, and its effect on START eligibility
    and existing review evidence identity;
  - the role of `context/archive/` and the `context/` placeholder files;
  - who decides what is compacted, and the split between deterministic checks and semantic
    judgement;
  - outcomes, exit semantics, atomicity and safe re-runs.
- No new architectural decision is made beyond what the owner resolves. An ADR is drafted only
  if a resolved decision actually requires one, and stays proposed until adopted.
- Acceptance scenarios for the implementation task are proposed.

## Scope
Phase 6 COMPACT design within the v0.1 requirements. Output: non-authoritative design notes at
`docs/TASK-0010-phase-6-compact-design.md` and, only if required, a proposed ADR.

## Out of Scope
- Implementing COMPACT or changing any source code, schema or template.
- Amending SPEC.md, accepted ADRs or D01–D26 before the owner decides.
- Redesigning START, REVIEW or CLOSE.
- Benchmark harness (Phase 7), cross-model trial (Phase 8), `context explain`.
- Semantic or vector search, embeddings, automatic model execution.
- Licensing, Git history rewriting.

## Dependencies
TASK-0009 (CLOSE, which leaves unpromoted candidates and records closure), TASK-0008 (defers
disposition and consolidation to Phase 6), ADR-0001 (status-based START eligibility),
ADR-0002 (reviewer reports are durable, rounds are added and never overwritten).

## Relevant Files
See the front-matter `files` links.

## Decisions / ADRs
The owner approved moving TASK-0010 from `proposed` to `active` on 2026-10-05 and asked for
options, trade-offs and a recommendation for each open question, with no ADR created until the
recommendations are reviewed.

Open decisions, analysed as C1–C6 in the design notes (recommendation in brackets):
1. **C1, v0.1 disposition conflict.** TASK-0008 decision 3(a) says there is no `rejected` state
   "for v0.1" and defers disposition to Phase 6, which is itself v0.1. [(b): read 3(a) as
   governing CLOSE; Phase 6 adds one general retirement state, applied to a candidate only on
   explicit owner request with a reason.]
2. **C2, retired-knowledge representation.** ADR-0001 binds only `accepted` learnings and
   `active` traps; other statuses are unknown and diagnosed. [(a): one new `retired` status with a
   `retirement` record and optional typed same-type `superseded_by`; requires an ADR.]
3. **C3, archive and discovery.** `context/archive/` lies inside the default `context` discovery
   source. [(a): retire in place; COMPACT never moves files.]
4. **C4, placeholder files.** `context/STATE.md` is generated; the other `context/*.md` files are
   heading-only. [(a): COMPACT writes none of them.]
5. **C5, mutation model.** [(b): read-only report by default; writes only for owner-named IDs,
   checked and applied all-or-nothing.]
6. **C6, gate.** [(b): every write names an existing `active` task; its review and CLOSE cover
   the edits.]

None of these is resolved. No ADR has been drafted.

## Implementation Notes
Design only. Design notes revision 1 (`docs/TASK-0010-phase-6-compact-design.md`) records the
requirements derived from SPEC.md, D01–D26, ADR-0001, ADR-0002 and TASK-0008, decisions C1–C6
with options, trade-offs and recommendations, the contract that follows if the recommendations
are accepted, and 16 proposed acceptance scenarios. No source code, schema, template, SPEC.md or
ADR was changed. This task does not authorize implementing Phase 6.

## Tests
Design task: no implementation tests apply. Baseline at task creation (2026-10-05, commit
`6db7e93`): `npm run build` and `npm run check` passed; `npm test` passed 181 of 181 with no
failures, skips or cancellations.

Verification of design notes revision 1 on 2026-10-05: `validate` passed with 13 artifacts and no
diagnostics; after `index`, `context status` reported configuration present and index current;
START for TASK-0010 was `complete` with no diagnostics.

## Review Findings

## Outcome
