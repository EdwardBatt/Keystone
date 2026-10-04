---
context_type: task
schema_version: 1
id: TASK-0008
title: Design Phase 5 CLOSE + Learning
status: accepted
priority: high
depends_on: [TASK-0007]
adrs: [ADR-0001, ADR-0002]
files:
  - docs/TASK-0008-phase-5-close-design.md
  - SPEC.md
  - ARCHITECTURE-DECISIONS.md
  - templates/learning.md
  - templates/trap.md
  - docs/PHASE-4.md
created: 2026-10-04
completed: 2026-10-04
---
# TASK-0008 — Design Phase 5 CLOSE + Learning

## Objective
Design `keystone close <TASK-ID>` so that CLOSE completes the task lifecycle after independent
review and performs controlled promotion of genuinely reusable knowledge produced by the work
into durable Keystone context. Design only.

## Acceptance Criteria
- What SPEC.md, D10–D12, D15, D20, ADR-0001 and ADR-0002 already decide for CLOSE is recorded,
  separately from implementation discretion.
- Each genuinely necessary owner decision is recorded with its constraints, options and
  resolution.
- The resulting design covers:
  - close eligibility;
  - how review results participate;
  - what completion records;
  - how candidate learnings and traps are identified;
  - how controlled promotion works and links promoted knowledge to its source task and
    evidence;
  - what happens to unpromotable knowledge;
  - the split between deterministic checks and semantic judgement;
  - safe re-runs.
- No new architectural decision is made beyond what the owner resolves. An ADR is created only
  if a resolved decision actually requires one.

## Scope
Phase 5 CLOSE + Learning design within the v0.1 requirements.

## Out of Scope
- Implementing CLOSE.
- Compaction (Phase 6), benchmarking or token optimisation.
- Automatic model execution.
- Redesigning REVIEW.
- TASK→ADR→SPEC traceability.
- Semantic or vector search.
- Exhaustive Git hardening.
- Post-v0.1 features.

## Dependencies
TASK-0007 (REVIEW, which supplies reviewer reports and deterministic evidence identity),
ADR-0001 (learning and trap eligibility), ADR-0002 (Phase 5 defines verdict and staleness
semantics).

## Relevant Files
See the front-matter `files` links. The design notes are non-authoritative.

## Decisions / ADRs
Owner decisions made on 2026-10-04:
1. **Review gate, 1(b).** All three D13 roles must have a latest, current `approve` report.
   An explicit owner override with a recorded reason may authorise CLOSE despite an unsatisfied
   gate, without altering verdicts; the actual review state is preserved in the closure record.
2. **Promotion, 2(a).** Only owner-requested candidate IDs are promoted, and only when they pass
   the structural and evidence checks and were covered by the current approved context review.
   Reviewer approval alone never authorises promotion.
3. **Unpromoted candidates, 3(a), v0.1 only.** They remain `candidate` or `proposed`; a reason
   may be recorded; there is no `rejected` state. Disposition belongs to Phase 6.

No ADR is required: these implement semantics that D10–D12 and ADR-0002 defer to Phase 5, and
they change no existing guarantee. The SPEC.md CLI line for `close` should gain `--promote` and
`--override` in the implementation task.

## Implementation Notes
Design only. No source code changes. The completed observable contract for
`keystone close` is in the design notes. Mechanisms belong to the Phase 5 implementation task,
including treating the closure record as a lifecycle field in `docs/PHASE-4.md`.

## Tests
This is a design task, so no implementation tests apply. Verification on 2026-10-04: `validate`
passed with 11 artifacts and no diagnostics; after `index`, `context status` reported the index
current; START for TASK-0008 was `complete`, with ADR-0001 and ADR-0002 binding.

## Review Findings
The owner reviewed and approved the Phase 5 design on 2026-10-04, with one wording clarification:
the task must exist, and an already-closed task returns `already-closed` without mutation. That
is a clarification, not a design change.

## Outcome
Accepted on 2026-10-04 with owner authorization. The approved Phase 5 contract is recorded in
`docs/TASK-0008-phase-5-close-design.md`:
- `keystone close <TASK-ID> [--promote <ID>]... [--override <reason>]`;
- the deterministic eligibility conditions;
- the three-role `approve` review gate, with currency checked by recomputed evidence identity;
- an owner override with a recorded reason that never alters verdicts or enables promotion;
- explicit, checked promotion of `candidate` learnings and `proposed` traps;
- unpromoted candidates left unchanged (no `rejected` state);
- a closure record in the task artifact, treated as a lifecycle field by review;
- the outcomes `closed`, `already-closed`, `blocked` and `failed`, with no partial writes.

No ADR was required; no existing architectural guarantee changes. The Phase 5 implementation task
will update the SPEC.md `close` CLI line and the `docs/PHASE-4.md` lifecycle-field mechanism.
CLOSE remains unimplemented.
