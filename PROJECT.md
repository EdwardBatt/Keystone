---
context_type: project
schema_version: 1
project_id: keystone
status: active
---
# Keystone

## Purpose
Repo-native context and continuity system for AI-assisted software development, delivered as
the TypeScript/Node CLI `keystone`. This repository is the reusable framework; the benchmark
application is a separate repository and its specific knowledge does not belong here.

## Authority
Authority is artifact-specific (D01). `SPEC.md` is the v0.1 implementation contract.
`ARCHITECTURE-DECISIONS.md` records the frozen D01–D26 baseline. Accepted ADRs in `adr/` record
later adopted decisions, and individual task files own task facts and scope. Contradictions
between authoritative artifacts are raised for resolution, not settled by precedence. This file
summarises those sources and does not replace them.

## Non-Negotiable Constraints
- No external memory service, vector database, embeddings, GUI, or Obsidian/Notion
  dependency (SPEC non-goals, D25).
- Every command is testable offline. Paths are Windows-safe, and Unix-compatible where
  feasible.
- Deterministic software handles IDs, links, schemas and structural validation before LLM
  judgement (D15).
- Markdown/YAML is authoritative. Generated state is disposable and rebuildable (D16).
- High-authority ADR, rule and skill changes require proposal and review. Material
  architecture changes require a proposed ADR (D20).
- Model adapters stay thin and do not duplicate project facts (D08).
- Context-managed work uses a task ID in commits, plus ADR IDs when relevant (D22).

## Feature Index
None. Features are optional (D03).

## Key ADRs
None designated project-wide. Tasks link ADRs directly; see `adr/INDEX.md`.
