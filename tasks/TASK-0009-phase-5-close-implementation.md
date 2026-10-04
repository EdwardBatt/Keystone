---
context_type: task
schema_version: 1
id: TASK-0009
title: Implement Phase 5 CLOSE + Learning
status: accepted
priority: high
depends_on: [TASK-0008]
adrs: [ADR-0001, ADR-0002]
files:
  - docs/TASK-0008-phase-5-close-design.md
  - SPEC.md
  - docs/PHASE-4.md
  - docs/PHASE-5.md
created: 2026-10-04
completed: 2026-10-04
---
# TASK-0009 — Implement Phase 5 CLOSE + Learning

## Objective
Implement `keystone close <TASK-ID> [--promote <ID>]... [--override <reason>]` as defined by the
accepted TASK-0008 contract, D10–D12, ADR-0001, ADR-0002 and SPEC.md.

## Acceptance Criteria
- The implementation satisfies the accepted TASK-0008 contract, D10–D12, ADR-0001, ADR-0002 and
  SPEC.md. That covers:
  - the three-role current `approve` gate;
  - evidence-hash currency;
  - an override with a required reason that never alters verdicts or enables promotion;
  - explicit, checked, all-or-nothing promotion (`candidate` to `accepted`, `proposed` to
    `active`);
  - unpromoted candidates left unchanged;
  - a durable closure record in the task;
  - the `closed`, `already-closed`, `blocked` and `failed` outcomes with their exit semantics;
  - every check before any write, with no partial mutation;
  - offline, no-model, idempotent operation.
- `docs/PHASE-5.md` records the mechanisms without adding architectural requirements.
- The SPEC.md `close` CLI line lists `--promote` and `--override`.
- `docs/PHASE-4.md` and the review mechanism treat the closure record as lifecycle information,
  so it cannot invalidate the evidence hash it records.
- Automated tests cover the contract and its important failure and atomicity cases. Build,
  type check and the full suite pass offline.

## Scope
Phase 5 CLOSE implementation, tests and documentation.

## Out of Scope
Phase 6 compaction, REVIEW package token optimisation, REVIEW redesign, new lifecycle states and
automatic semantic judgement.

## Dependencies
TASK-0008 (accepted design), TASK-0007 (REVIEW), ADR-0001, ADR-0002.

## Relevant Files
See the front-matter `files` links and `docs/PHASE-5.md`.

## Decisions / ADRs
Implements the accepted TASK-0008 contract. No new architectural decision.

## Implementation Notes
Implemented `keystone close` (`src/commands/close.ts`) with mechanisms recorded in
`docs/PHASE-5.md`:
- The review gate reads the latest `<role>-<n>.md` report per role. It validates each report
  against `schemas/review-report.schema.json`, the task, role and round, and the body contract.
  It checks currency by recomputing `evidence_hash` through `compileReview` for each report's
  `base`.
- The override needs a non-blank reason. It is recorded in the closure record with the actual
  per-role state and verdict, and any `--promote` under an override is blocked.
- Promotion checks, for requested IDs only: linked candidate status, non-empty evidence, trap
  severity `medium`, and presence in the current approved context review's subject. It is
  all-or-nothing. On success it sets `accepted` or `active` and appends a `close:` evidence
  reference.
- The task gains `status: accepted`, `completed` (an existing value is preserved) and a
  structured `closure` record, edited through the YAML document model. `TASKS.md` is never
  edited.
- Every check runs before writes. Writes go to temporary siblings and are renamed in order, then
  the inventory is re-validated; any failure restores every original file.
- Supporting changes:
  - CLI wiring and help;
  - the SPEC.md `close` CLI line now lists `--promote` and `--override`;
  - `docs/PHASE-4.md` and `src/review/task.ts` treat `closure` as a lifecycle field
    excluded from `evidence_hash`;
  - README and tests README.

## Tests
Final verification on 2026-10-04, independently verified:
- `npm run check` passed.
- `npm test` passed 181 tests (10 in `tests/phase5.test.mjs`) with no failures, skips or
  cancellations.
- `keystone close` was exercised through the CLI on temporary repositories:
  - blocked with no reports;
  - closed with explicit promotion;
  - `already-closed` on re-run;
  - a `changes-requested` verdict blocked;
  - override with promotion blocked;
  - override closed;
  - an invalid trap promotion blocked the whole CLOSE.

## Review Findings
Codex's independent review found two blocking, reproducible contract violations. Both are fixed,
with regression tests confirmed to fail on the pre-fix code and pass after the fix:
1. **Fenced headings satisfied the report contract.** A three-backtick line closed a
   four-backtick fence, so headings inside it counted. Report parsing now closes a fence only on
   a delimiter of the same character, at least as long as the opening one, alone on its line.
   Headings inside fences never satisfy required sections, and such a report is invalid, so
   CLOSE is blocked without mutation.
2. **A partial temporary file survived a failed write.** Each `.close-*.tmp` path is now
   registered for cleanup before its write is attempted. A partial write followed by an error
   leaves no temporary file, the originals are unchanged, and CLOSE returns `failed`
   (`CLOSE_WRITE_FAILED`).

Codex re-checked both fixes and recorded the outcome as **VERIFIED**: both blocking findings
are resolved. The final test result is 181/181 passing.

## Outcome
Accepted on 2026-10-04 with owner authorization, after independent verification (VERIFIED).
Phase 5 CLOSE + Learning is complete: `keystone close` satisfies the accepted TASK-0008
contract, D10–D12, ADR-0001, ADR-0002 and SPEC.md, with mechanisms recorded in
`docs/PHASE-5.md`. Phase 6 (compaction) is not started.
