---
context_type: task
schema_version: 1
id: TASK-0004
title: Implement Phase 3 START context compiler
status: accepted
priority: high
adrs: [ADR-0001]
files:
  - SPEC.md
  - ARCHITECTURE-DECISIONS.md
  - AGENTS.md
  - docs/TASK-0003-design-proposal.md
  - adr/ADR-0001-start-context-eligibility.md
  - schemas/task.schema.json
  - schemas/feature.schema.json
  - schemas/adr.schema.json
  - schemas/learning.schema.json
  - schemas/trap.schema.json
  - src/parser/discovery.ts
  - src/graph/index.ts
  - src/commands/index.ts
  - templates/task.md
  - templates/feature.md
  - templates/adr.md
  - templates/learning.md
  - templates/trap.md
  - docs/PHASE-3.md
  - src/commands/start.ts
  - src/context/envelope.ts
  - src/context/selection.ts
  - tests/phase3.test.mjs
---
# TASK-0004 — Implement Phase 3 START context compiler

## Objective
Implement `keystone start <TASK-ID>` as the deterministic, source-preserving context compiler
defined by ADR-0001 and the START section of SPEC.md.

## Acceptance Criteria
- Resolve the individual root task from current configured/discovered authoritative sources;
  TASKS.md freshness, generated indexes and references do not supply task facts or authority.
- Preserve artifact-specific eligibility and role-aware traversal: non-binding paths cannot make
  descendants binding; independently eligible paths can; deduplication preserves strongest role
  and all reasons.
- Normalize one-sided `supersedes`/`superseded_by`, resolve unique accepted whole-artifact
  endpoints, retain history, reject proposed successors as replacements, and report competing
  branches as incomplete/conflicted without choosing winners.
- Respect explicit discovery configuration over conventional paths and diagnose unavailable
  mandatory context rather than resurrecting excluded files.
- Implement bounded deterministic selection for Tier 0–3, optional/featureless/cross-cutting
  tasks, project `key_rules`, default-discovery GLOBAL.md, task dependencies and bounded reverse
  learning/trap associations exactly as ADR-0001 specifies.
- Keep directly relevant typed proposals visibly non-binding Tier 1; keep ordinary/untyped files
  at Tier 3 with visible omissions. Unknown authority/severity never silently binds.
- Prefer semantic Markdown sections but use whole-body fallback when headings are absent/ambiguous;
  preserve all required Tier 0/1 content under token pressure.
- Expose semantic outcomes `complete`, `incomplete/conflicted` and `failed`; none implies
  implementation authorization or readiness. Preserve source files and make generated context
  disposable, deterministic, idempotent and rebuildable.
- Specify and test exact excerpt boundaries, duplicate-heading behavior, normalization, ID/path
  deduplication, stable serialization, estimator, diagnostic identifiers, exit codes, oversized
  Tier 2/3 packing and atomic generated-envelope replacement for each outcome.
- Add regression tests for the 20 scenarios listed in this task's Tests section.

## Scope
Phase 3 START compiler/context selection only, including its deterministic output and tests.
No onboarding or natural-language task authoring is part of this task.

## Out of Scope
Onboarding; `task-create`; proposal lifecycle/application engines; approval registries; candidate
interchange; separate proposal storage; TASKS generation/migration; source-version/retry
infrastructure; review, close, compact, learning promotion, benchmark or cross-model features.

## Dependencies
ADR-0001; SPEC.md START eligibility and effective-context section; Phase 0/1 parser, discovery,
graph, validation, path and deterministic-index behavior.

## Relevant Files
See the front-matter `files` links and ADR-0001 for the adopted architecture. Existing Phase 0/1
behavior must remain intact.

## Decisions / ADRs
Implement ADR-0001 without modifying D03, D09 or other approved architecture. Any material
contradiction must be raised for a separately proposed ADR before implementation.

## Implementation Notes
Do not add model-provider dependencies. Core behavior must work offline and be independent of
Claude, Codex, Gemini or any hosted LLM.

Implemented the deterministic mechanics in `docs/PHASE-3.md`, with role-aware selection,
ADR replacement resolution, conservative Markdown extraction, deterministic budget packing,
and atomic generated-envelope replacement. The CLI reuses existing config, discovery,
parser, graph validation and portable-path behavior. No provider dependencies were added.

## Tests
Cover: proposed feature→accepted ADR non-promotion; independent binding path; duplicate path
roles/reasons; A→B→C replacement; proposed successor; competing replacements; both one-sided
replacement forms; ADR whole-body fallback; excluded conventional discovery; missing mandatory
context; unknown authority state; non-active root inspection; all three outcomes; featureless and
cross-cutting tasks; duplicate reachability; Tier 0/1 budget retention; visible Tier 3 omissions;
source immutability; and identical-input reproducibility.

Verification on 2026-10-01 after review fixes: build and type check passed; `npm test` passed all 152 tests
(including 32 Phase 3 cases), with no failures, skips or cancellations. Keystone validation
passed with 4 artifacts and no diagnostics. Regression coverage includes all scenarios above,
explicit discovery equivalent to defaults, atomic partial-write/rename failures, binary evidence,
cross-root reproducibility and generated-index independence.

## Review Findings
The two blocking review findings were fixed for re-review: conflicting project candidates
retain non-binding roles and reasons through file aliases and other selection paths; ADR
extraction exempts only a unique leading title and preserves any other unselected content
through whole-body fallback. Three added regression cases cover one/both project aliases,
review-path deduplication, and heading-only ADR constraints with title-boundary variants.
The generated index was unstaged; generated `.context` state is ignored while authoritative
`.context/config.yaml` remains trackable. Independent re-review returned APPROVE, confirming
both blockers were resolved. SPEC.md, approved ADRs and schemas were not changed.

## Outcome
Formally accepted on 2026-10-01 following independent re-review with APPROVE and user
authorization. Phase 3 implementation and acceptance verification are complete. Explicitly
deferred functionality remains unimplemented.
