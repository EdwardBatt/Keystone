---
context_type: task
schema_version: 1
id: TASK-0004
title: Implement Phase 3 START context compiler
status: backlog
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

## Tests
Cover: proposed feature→accepted ADR non-promotion; independent binding path; duplicate path
roles/reasons; A→B→C replacement; proposed successor; competing replacements; both one-sided
replacement forms; ADR whole-body fallback; excluded conventional discovery; missing mandatory
context; unknown authority state; non-active root inspection; all three outcomes; featureless and
cross-cutting tasks; duplicate reachability; Tier 0/1 budget retention; visible Tier 3 omissions;
source immutability; and identical-input reproducibility.

## Review Findings
No implementation findings yet. Review must verify each adopted authority and determinism guarantee.

## Outcome
Backlog: Phase 3 implementation is authorized only after this task is separately accepted for work.
