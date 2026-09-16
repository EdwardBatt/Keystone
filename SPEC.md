# Keystone v0.1 Development Specification — Implementation Contract

Status: **APPROVED FOR IMPLEMENTATION**  
Baseline date: **13 September 2026**

## Purpose

Keystone is a repo-native context and continuity system for long-running AI-assisted software
development. It keeps durable project knowledge beside the code, compiles task-specific context,
supports independent review, and controls promotion/compaction of learned knowledge.

## Core principles

1. Conversation is temporary; the repository is memory.
2. Artifact types own different truths; contradictions are findings, not invitations to guess.
3. Persist the minimum durable knowledge needed to prevent wrong implementation, repeated
   investigation, architectural inconsistency, or repeated mistakes.
4. Context is compiled from explicit task/feature/dependency/ADR/rule/skill/learning/trap/file links.
5. Verified learning is promoted and compacted; noise is not accumulated.
6. Deterministic software handles IDs, links, schemas and structural validation before LLM judgement.
7. Model adapters are thin and do not duplicate project facts.
8. Feature boundaries are optional and must not distort good software architecture.
9. Compaction preserves evidence and traceability.
10. Markdown/YAML is authoritative; generated indexes are disposable.

## v0.1 non-goals

- External SaaS memory
- Obsidian or Notion dependency
- Vector DB / embeddings
- GUI
- Autonomous high-authority ADR/rule/skill changes
- Replacing Git, tests, or normal engineering tools

## Framework layout

The scaffold repository layout is the implementation baseline:
`src/{cli,commands,context,parser,graph,validation,review,compaction,telemetry,adapters}`,
`schemas`, `templates`, `adapters/{claude,codex,gemini}`, `benchmark`, and `tests`.

## CLI contracts

The package exposes `keystone`.

- `keystone init`
- `keystone start <TASK-ID>`
- `keystone close <TASK-ID>`
- `keystone validate`
- `keystone review <TASK-ID> [--type code|architecture|context|all]`
- `keystone compact`
- `keystone index`
- `keystone context status`
- `keystone context explain <ID>`

`init` must detect the Git root, create `.context/config.yaml`, avoid overwrite without explicit
`--force`, offer thin adapters, and validate at the end.

`index` must be deterministic and idempotent.

`validate` must produce stable structured error codes and exit non-zero on errors.

## START context priority

- Tier 0 Mandatory: task, critical project constraints, always-load rules.
- Tier 1 Direct: feature boundary, linked ADR constraints/decision, linked rules, severe traps.
- Tier 2 Supporting: dependency summaries, skills, accepted learnings, related ADR sections.
- Tier 3 Discovery: suggested files, historical evidence, related completed tasks.

Default target envelope: 8,000 estimated tokens. Tier 0/1 may exceed the target but must never be
silently omitted.

## Target repo created by `keystone init`

See `templates/TARGET-REPO-TREE.md`.

## Acceptance baseline

The first working release must initialize an ordinary Git repo, parse/validate authoritative artifacts,
build deterministic indexes, compile traceable task context, prepare independent review evidence,
close tasks with controlled learning proposals, compact safely, and support benchmark fixtures —
without any external context store.

## Implementation phases

- Phase 0 — Foundation: package/CLI scaffold, config, Markdown/YAML parser, JSON schemas, fixtures,
  Windows-safe paths.
- Phase 1 — Index + Validate: artifact discovery, ID/link graph, generated index, deterministic
  validation and tests.
- Phase 2 — Init + Status.
- Phase 3 — Start.
- Phase 4 — Review.
- Phase 5 — Close + Learning.
- Phase 6 — Compact.
- Phase 7 — Benchmark Harness.
- Phase 8 — Cross-model Trial.

**First Codex implementation is Phase 0 + Phase 1 only.**
