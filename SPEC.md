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
- `keystone review <TASK-ID> [--type code|architecture|context|all] [--base <rev>]`
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

### START eligibility and effective context

ADR-0001 records the adopted START context-selection contract. Structural inventory, binding
context and explicitly requested non-binding review material are distinct. Individual task files
own task facts; `TASKS.md` is navigation/projection and does not determine START input. Discovery,
validation, indexing and references do not confer authority. Eligibility is artifact-specific;
unknown states remain non-binding inventory. A non-binding selection path cannot make descendants
binding, while an independent eligible path may do so. Deduplication preserves the strongest
independently established role and all reasons.

START uses configured/discovered inventory; conventional paths do not override explicit discovery.
Selection is bounded and deterministic. Tier 0 includes the root task and sole eligible project;
the eligible project's `key_rules` select mandatory rules, and `rules/GLOBAL.md` is selected only
under default discovery. Features remain optional. Direct eligible feature/task dependencies and
task-relevant reverse learning/trap associations are bounded as defined by ADR-0001. Directly
relevant typed proposals are Tier 1 review material and never binding; ordinary/untyped files are
Tier 3 evidence with visible omission reporting. Unknown severity is not promoted; only repository-
evidenced severity semantics may be used.

ADR replacements normalize `supersedes` and `superseded_by` into older-to-newer edges, permit
one-sided declarations, resolve an unambiguous whole-artifact chain to one accepted endpoint, and
show competing/unresolved branches as conflicted non-binding material. Proposed successors cannot
retire accepted decisions. Missing or conflicting mandatory context is inspectable but incomplete;
structural/input failure is failed. Whole-body fallback preserves managed Markdown when semantic
headings are absent or ambiguous. START never authorizes implementation or mutates sources.

Its semantic outcomes are `complete`, `incomplete/conflicted` and `failed`; successful compilation
does not mean implementation-ready. Generated context is disposable/rebuildable and Tier 0/1
content is retained despite the 8,000-token target, with deterministic omissions reported for lower
tiers. Exact serialization, diagnostics, packing and atomic replacement are implementation-contract
details for Phase 3.

ADR-0002 supplements this contract with one rule: the root-level `reviews/` directory, compared
case-insensitively, is ineligible for START.

## Review evidence

ADR-0002 records the Phase 4 review guarantees. `review` prepares evidence packages for the
requested code, architecture and context roles. It does not call a model, determine a verdict,
approve work, or determine implementation readiness. Each role receives role-appropriate, isolated
inputs that serve its distinct purpose.

Review is anchored to a Git baseline selected by `--base` (default `HEAD`). Work under review
cannot silently redefine the requirements or binding context it is reviewed against. A task
introduced by the work may define that work's requirements without becoming project authority.

Material work under review is represented, and withheld or unrepresentable content and evidence
gaps are explicit. Implementer assertions are not objective evidence. Context review may receive
implementer-authored material, identified as unverified.

Review outcomes are:
- `complete`;
- `incomplete/conflicted`, for explicitly represented gaps;
- `failed`, when the subject, the boundary or the required governing context cannot be
  established reliably.

Materially identical evidence under the same review contract has a deterministic evidence
identity. Generated review state and reviewer reports cannot contaminate it.

Review works offline. It writes only disposable generated state under `.context/` and never
modifies project source, Git history or Git repository state.

Reviewer reports are durable, non-authoritative records under the root-level `reviews/`
directory. Each report carries task, role, round, verdict, evidence identity, baseline and
reviewer attestation, and contains findings, evidence examined and limitations where applicable.
Verdicts are `approve`, `changes-requested` and `inconclusive`. Phase 5 defines what verdicts and
staleness mean for CLOSE.

`docs/PHASE-4.md` specifies the implementation mechanisms.

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
