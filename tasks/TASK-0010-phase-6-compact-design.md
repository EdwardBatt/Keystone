---
context_type: task
schema_version: 1
id: TASK-0010
title: Design Phase 6 COMPACT
status: accepted
priority: high
depends_on: [TASK-0009]
adrs: [ADR-0001, ADR-0002, ADR-0003]
files:
  - docs/TASK-0010-phase-6-compact-design.md
  - adr/ADR-0003-retirement-of-learnings-and-traps.md
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
completed: 2026-10-05
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
options, trade-offs and a recommendation for each open question (design notes, revision 1).

Owner decisions made on 2026-10-05, each the recommended option in the design notes:
1. **C1(b), candidate disposition.** TASK-0008 decision 3(a) governs CLOSE: CLOSE never rejects
   or retires a candidate. Phase 6 disposes of candidates only through the general retirement
   state, applied by explicit owner request with a reason. There is no `rejected` state.
2. **C2(a), retired knowledge.** Learnings and traps gain one terminal status, `retired`, with a
   retirement record (task and reason) and optional typed same-type `superseded_by` successor
   links. Retired artifacts never bind START and are not diagnosed as unknown authority.
3. **C3(a), archive.** Retirement happens in place. COMPACT never moves or deletes files.
   `context/archive/` gains no Phase 6 meaning, and `init` is unchanged.
4. **C4(a), placeholders.** COMPACT writes none of the `context/*.md` files. It reports when
   hand-maintained navigation needs updating.
5. **C5(b), mutation model.** With no operation, COMPACT is a read-only report. Writes happen only
   for owner-named IDs, every check runs before any write, and requested retirements apply
   all-or-nothing.
6. **C6(b), gate.** Every write names an existing task with status `active`, recorded in the
   retirement record. That task's review and CLOSE cover the edits.

The owner also approved the successor safety requirements: a successor has the same type, is
eligible when the retirement is applied, creates no cycle, and contains every `tasks` and
`evidence` entry of the retired artifact (and, for a trap, every `files` entry). Retirement must
preserve the required evidence and provenance chain.

C2(a) required an ADR. ADR-0003, "Retirement of learnings and traps", was drafted as `proposed`.
On 2026-10-05 the owner approved it for adoption as written, including guarantee 5 as a standing
validation invariant. ADR-0003 is `accepted`, and SPEC.md is amended to match.

## Implementation Notes
Design only. Design notes revision 3 (`docs/TASK-0010-phase-6-compact-design.md`) contains:
- the requirements derived from SPEC.md, D01–D26, ADR-0001, ADR-0002 and TASK-0008;
- decisions C1–C6 with options, trade-offs and the owner's resolution;
- the resulting Phase 6 contract;
- 17 proposed acceptance scenarios for the implementation task.

ADR-0003 keeps only durable guarantees, following the lesson recorded in ADR-0002's clarification:
- the scope;
- the `retired` state and its START role;
- typed successor links;
- the retirement record;
- the containment invariants, as standing structural checks;
- successor safety;
- the clarification of TASK-0008 decision 3(a);
- controlled, task-bound application.

Mechanisms (field names, report contents, diagnostics, outcomes, write mechanics) are left to the
Phase 6 implementation contract, `docs/PHASE-6.md`.

The SPEC.md amendment, made with adoption:
- changes the `compact` CLI line to
  `keystone compact [--task <TASK-ID> (--retire <ID> --reason <text> [--by <ID>])...]`;
- adds a "Compaction and retirement" section summarising ADR-0003.

Known documentation gap, left for the implementation task: `docs/PHASE-0-1.md` describes
`supersedes` and `superseded_by` as uninterpreted on non-ADR artifacts. That matches the
implemented code but is out of date against ADR-0003 for `superseded_by` on learnings and traps.
The Phase 6 implementation updates it with the code. Until then, validation and START do not
enforce ADR-0003, as was the case for ADR-0002 before TASK-0007.

No source code, schema or template was changed. This task does not authorize implementing
Phase 6.

## Tests
Design task: no implementation tests apply. Baseline at task creation (2026-10-05, commit
`6db7e93`): `npm run build` and `npm run check` passed; `npm test` passed 181 of 181 with no
failures, skips or cancellations.

Verification of design notes revision 1 on 2026-10-05: `validate` passed with 13 artifacts and no
diagnostics; after `index`, `context status` reported configuration present and index current;
START for TASK-0010 was `complete` with no diagnostics.

Verification of design notes revision 2 and proposed ADR-0003 on 2026-10-05: `validate` passed
with 14 artifacts and no diagnostics; after `index`, `context status` reported configuration
present and index current; START for TASK-0010 was `complete` with no diagnostics, with ADR-0001
and ADR-0002 binding and ADR-0003 selected as non-binding Tier 1 review material.

Closure verification on 2026-10-05, after ADR-0003 adoption and the SPEC.md amendment:
- `validate` passed with 14 artifacts and no diagnostics.
- After `index`, `context status` reported configuration present and index current.
- START for TASK-0010 was `complete` with no diagnostics, with ADR-0001, ADR-0002 and ADR-0003
  binding at Tier 1.
- `npm test` passed 181 of 181 with no failures, skips or cancellations. No source code changed.

## Review Findings
Owner review on 2026-10-05, in three steps:
1. Revision 1 recommendations reviewed; C1(b), C2(a), C3(a), C4(a), C5(b) and C6(b) approved, with
   the successor safety requirements.
2. ADR-0003 draft reviewed and approved for adoption as written, including guarantee 5 as a
   standing validation invariant.
3. SPEC.md amendment made with adoption.

No independent (separate model or host) review of this design was performed. TASK-0008, the
Phase 5 design, was likewise accepted on owner review.

## Outcome
Accepted on 2026-10-05 with owner authorization. Phase 6 COMPACT design is complete:
- decisions C1–C6 are resolved;
- ADR-0003 is accepted;
- SPEC.md is amended;
- design notes revision 3 (`docs/TASK-0010-phase-6-compact-design.md`) is the design record.

Phase 6 is not implemented. Implementation requires a separately authorized task, which also
updates `docs/PHASE-0-1.md` for ADR-0003.
