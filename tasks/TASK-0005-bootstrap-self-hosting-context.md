---
context_type: task
schema_version: 1
id: TASK-0005
title: Bootstrap Keystone self-hosting context
status: accepted
priority: high
files:
  - PROJECT.md
  - TASKS.md
  - AGENTS.md
  - FIRST-CODEX-TASK.md
  - adr/INDEX.md
  - .context/config.yaml
  - tasks/TASK-0001-phase-0-1-foundation.md
  - docs/PHASE-2.md
created: 2026-10-04
completed: 2026-10-04
---
# TASK-0005 — Bootstrap Keystone self-hosting context

## Objective
Establish the minimal authoritative Keystone context for this framework repository so that
START compiles its own valid tasks as `complete`, stale scope instructions are corrected, and
TASK-0001 history is recorded, before any Phase 4 work is planned.

## Acceptance Criteria
- `PROJECT.md` is the sole eligible project (`status: active`). It is concise, summarises the
  existing artifact-specific authority model without adding a precedence rule, and carries
  existing critical constraints for Tier 0.
- `TASKS.md` indexes TASK-0001 to TASK-0005 with their actual statuses as navigation only.
- A retrospective TASK-0001 record exists, is accepted, and is explicitly marked reconstructed.
- `AGENTS.md` rule 10 no longer limits current work to Phase 0/1. `FIRST-CODEX-TASK.md` is
  marked as the historical TASK-0001 contract, with its body unchanged.
- `adr/INDEX.md` lists accepted ADRs and is maintained by hand.
- `.context/config.yaml` contains only `schema_version: 1`, which keeps default discovery.
- The bootstrap section of `docs/PHASE-2.md` describes the adopted procedure.
- `validate` passes. `start` is `complete` for TASK-0001 to TASK-0005, with project
  constraints at Tier 0. `context status` reports configuration present and, after `index`,
  a fresh index. The existing test suite still passes with no code changes.

## Scope
Hand-authored repository context and documentation corrections listed in the front-matter
`files` links.

## Out of Scope
Running full `init`; scaffold placeholders (`agents/`, `reviews/`, `context/` ledgers,
empty rules and skills, extra adapters); features; ADR migration of D01–D26; generators for
TASKS.md or ADR indexes; code, schema or SPEC.md changes; optional housekeeping (SETUP.md,
missing task ID on commit `cb2b754` [factually incorrect; see Correction below]); and any
Phase 4+ design or functionality.

## Dependencies
Phase 0–3 behaviour as accepted in TASK-0001, TASK-0002 and TASK-0004; ADR-0001 governs
START selection.

## Relevant Files
See the front-matter `files` links.

## Decisions / ADRs
No new architectural decision. The approach was chosen by the project owner on 2026-10-04:
minimal hand-authored bootstrap instead of full `init`; TASK-0001 is accepted as
retrospective; SPEC.md is not given precedence over accepted ADRs or tasks. The `AGENTS.md`
rule 10 change is a protocol change under AGENTS rule 7; the owner reviewed and approved it.

## Implementation Notes
Implemented by hand as listed in the front-matter `files` links. No source code, schema,
SPEC.md or tracked generated state was changed. Generated `.context/index.json` and
`.context/current-envelope.json` remain gitignored; only `.context/config.yaml` is tracked.

## Tests
Acceptance verification on 2026-10-04:

- `npm run check` passed. `npm test` passed all 152 tests with no failures, skips or
  cancellations.
- `validate` passed with 7 artifacts (1 project, 5 tasks, 1 ADR) and no diagnostics.
- After `index`, `context status` reported configuration present and index current.
- START compiled TASK-0001 to TASK-0005 as `complete` with no diagnostics. Each envelope
  selects `PROJECT.md` at Tier 0 as binding. TASK-0004 also selects ADR-0001 at Tier 1 and
  reports budget omissions of Tier 3 file evidence, including `SPEC.md` and
  `ARCHITECTURE-DECISIONS.md`, as ADR-0001 specifies.

## Review Findings
The project owner approved `PROJECT.md`, the AGENTS.md rule 10 wording and the
retrospective TASK-0001 record as written on 2026-10-04.

## Outcome
Accepted on 2026-10-04 with owner authorization. Keystone now holds the minimal context it
needs to manage itself. Optional housekeeping, scaffold placeholders and Phase 4+ work remain
out of scope and unimplemented.

## Correction
Recorded on 2026-10-04 under TASK-0006, with owner authorization, after independent review of
the TASK-0006 proposal (finding N1). The Out of Scope statement that commit `cb2b754` has a
missing task ID is false. The commit body reads "TASK-0004; ADR-0001."; only the subject line
omits the ID. The statement came from inspecting only the one-line log. No housekeeping action
was needed, and Git history is unchanged. Acceptance and scope of this task are unaffected.
