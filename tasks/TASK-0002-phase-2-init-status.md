---
context_type: task
schema_version: 1
id: TASK-0002
title: Implement Phase 2 init and context status
status: review
---
# TASK-0002 — Implement Phase 2 init and context status

## Objective
Implement `keystone init` and `keystone context status` within Phase 2 of `SPEC.md`.

## Acceptance Criteria
- `init` detects the Git root, creates `.context/config.yaml`, avoids overwriting without
  explicit `--force`, offers thin adapters, and validates at the end, as required by `SPEC.md`.
- Initialization follows `templates/TARGET-REPO-TREE.md` within Phase 2 scope.
- `keystone context status` is available; behavior not specified by the authoritative
  documents is identified before implementation, with material architecture questions
  handled through the existing ADR proposal/review process.
- Automated tests cover Phase 2 behavior, offline operation, Windows-safe paths, and
  preservation of existing Phase 0/1 behavior; build, check, and tests pass.

## Scope
Phase 2 — Init + Status. Follow `SPEC.md`, `ARCHITECTURE-DECISIONS.md`, and `AGENTS.md`.

## Out of Scope
Phases 3–8 and changes to the approved architecture.

## Implementation Notes
Implemented Phase 2 using the existing Phase 1 inspection/index writer. Initialization
detects the Git root, fills missing scaffold files, offers thin adapters, and preserves
existing project knowledge. `--force` resets only configuration. Status reports structural
inventory and index freshness without generating context envelopes.

## Relevant Files
- `src/commands/init.ts`
- `src/commands/status.ts`
- `src/context/git.ts`
- `src/cli/index.ts`
- `tests/phase2.test.mjs`
- `docs/PHASE-2.md`

## Tests
Build, type check, and the Phase 0/1 plus Phase 2 automated suites are required before acceptance.

## Outcome
Implementation ready for review. No Phase 3+ functionality or new architectural decision
was introduced. Specification, architecture decisions, and agent protocol remain unchanged.
