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

ADR-0002 supplements this contract with one rule. A path whose first segment
equals `reviews`, compared case-insensitively, is ineligible for START through every path.
Discovery never descends into the root-level `reviews/` directory, and a configured source equal
to or inside `reviews` is invalid. A `files` reference that passes ordinary path validation and
is then identified as a review record is refused with a defined, non-fatal diagnostic and a
visible omission. Invalid references keep their existing diagnostics.

## Review evidence

ADR-0002 records the adopted Phase 4 review contract. `review` prepares deterministic evidence
packages for the requested roles. Keystone never calls a model and never decides a verdict, and no
outcome means approval or readiness. Independence means input isolation: a package never contains
a reviewer report.

The subject is the difference between a resolved base commit (`--base`, default `HEAD`, which must
be an ancestor of `HEAD`) and the working tree, excluding ignored paths and `reviews/**`.
Requirements and binding context are anchored to the base revision. Changes made during the work
are evidence under review and cannot redefine their own standard. Requirement edits are shown
side by side with the base requirements, and lifecycle fields are reported as facts to every
reviewer role. A task introduced in the subject
supplies the requirements under review without becoming project authority. Binding context is
selected by the ADR-0001 rules in review mode over the base inventory, never over ambiguous
identities. Unavailable valid targets are evidence gaps.

Implementer claims are excluded from objective evidence, while requirements remain input.
Root-task claim sections and unrecognised content, partitioned on the task template headings, are
withheld from objective evidence, and commit message text is excluded. The context role alone
receives root claim and unrecognised content, marked as unverified material under review. Operational checks go to the code and architecture roles as
working-tree validation only, and to the context role in full. Every changed path is exposed. Typed and Keystone-managed
changes are classified deterministically, and untyped authority is identified by reviewer
charters. Charters are review-procedure inputs read from the base revision, and START does not
automatically select them as reviewer charters.

Review outcomes are `complete`, `incomplete/conflicted` and `failed`:
- `failed` covers identity or structure that prevents reliable identification of the root task or
  required binding context, and any inability to establish a trustworthy boundary or required
  input;
- `incomplete/conflicted` covers explicitly represented gaps.

`evidence_hash` identifies a stable pre-review payload, including review-procedure identity. All
operational checks are excluded from it, and it is unaffected by reports, dispositions and
lifecycle fields.

Packages are generated under `.context/review/`. Reviewer reports are durable, non-discovered
records under `reviews/<TASK-ID>/<role>-<round>.md` and are not truth merely by existing. They use
a provisional contract with verdicts `approve`, `changes-requested` and `inconclusive`, and body
sections `Findings` (nonblank for `changes-requested`), `Evidence Examined` and `Limitations`
(required for `inconclusive`). Phase 5 defines what verdicts and staleness mean for CLOSE.

Review Git access never fetches, uses the network, follows replacement objects, writes trace
output, runs filters, drivers or hooks, or changes Git state. Review requires upstream Git 2.45 or
later, or a backport that passes the authoritative capability probe. `review` writes only `.context/review/`.
Exact diagnostics, serialization, Git invocation and packing are implementation-contract details
for Phase 4.

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
