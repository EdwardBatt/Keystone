---
context_type: adr
schema_version: 1
id: ADR-0001
title: START context eligibility and effective-context selection
status: accepted
created: 2026-09-17
features: []
tasks: [TASK-0003, TASK-0004]
supersedes: []
superseded_by: []
tags: [start, context, authority]
---
# ADR-0001 — START context eligibility and effective-context selection

## Index
Adopts the reviewed design in TASK-0003 for the Phase 3 START compiler.

## Context
Keystone must compile deterministic task context without treating discovery, validation,
indexing, links, generated state or model output as approval. D01, D09, D16, D17 and D20
establish authority, deterministic START, disposable indexes, priority tiers and controlled
mutation. TASK-0003's independent reviews identified the minimum additional selection rules.

## Decision

1. Structural inventory, binding context and explicitly requested non-binding review material
   are distinct. Individual task files own task facts; TASKS.md is navigation/projection and
   never determines START task facts.
2. Artifact eligibility is type-specific. Discovery, structural validity, index membership and
   references establish neither authority nor approval. Unknown or unsupported authority states
   remain inventory entries and never silently bind. Non-active task roots may be compiled for
   inspection with their status preserved; compilation does not reopen or authorize work.
3. A non-binding or unknown-eligibility artifact cannot establish binding applicability through
   outgoing relationships. An independently eligible binding path may establish applicability
   to the same descendant. Deduplication preserves the strongest independently established role,
   all selection reasons and the most protective applicable tier.
4. Normalize ADR `supersedes` and `superseded_by` into older-to-newer edges. One-sided declarations
   are sufficient. Traverse accepted/superseded historical intermediates to a unique accepted
   endpoint. Replacement is whole-artifact; predecessors remain provenance/history and do not
   impose obsolete decisions. Proposed or unknown successors cannot retire accepted ADRs.
   Competing successors, missing/non-unique accepted endpoints, incompatible branches or other
   unresolved replacement authority produce conflicted non-binding inspection material and an
   incomplete/conflicted outcome; no filename, ID, timestamp, order or majority winner is chosen.
5. Configured/discovered inventory controls authoritative selection. Conventional paths are
   defaults only when configuration has not overridden discovery; they cannot resurrect excluded
   artifacts. Missing mandatory context is reported as incomplete/conflicted unless an existing
   structural/input failure makes the result failed.
6. Selection is bounded and explicit, not whole-graph traversal. Tier 0 contains the root task
   and the sole eligible discovered project. The eligible project's `key_rules` select mandatory
   rules; discovered `rules/GLOBAL.md` is also selected only under default discovery. Direct
   eligible features and bounded task dependencies supply their specified tiers while features
   remain optional. Task-relevant reverse learning/trap associations are limited to explicit root
   task/direct-feature references and exact root-file overlap for traps; reverse relevance never
   confers authority.
7. Directly relevant typed proposals, including proposed ADRs, remain non-binding Tier 1 review
   material. Ordinary/untyped file evidence is Tier 3 with visible omission reporting. An unknown
   severity is unclassified, diagnosed and non-binding; the current repository only evidences
   `medium`, which is retained at Tier 2 when relevant. No richer severity vocabulary is inferred.
8. Managed Markdown sections may be preferred, but absent/ambiguous headings require whole-body
   fallback. Tier 0/1 content cannot silently disappear under extraction or token pressure.
9. START has three semantic outcomes: `complete` (representable selected context with no unresolved
   condition), `incomplete/conflicted` (inspectable context with unresolved authority, missing
   mandatory context or comparable uncertainty), and `failed` (structural/input failure prevents
   a valid usable envelope). None means implementation-ready or authorized. Sources remain unchanged;
   generated context is disposable/rebuildable; Tier 0/1 content is retained even above the target.

## Alternatives Considered
TASK-0003 evaluated mandatory feature hierarchies, flat task context, universal proposal exclusion,
all-indexed-content binding, unrestricted graph traversal, task/inventory dual authority and
authoring engines coupled to START. They were rejected as incompatible with D03, D01/D20, D09,
minimal documentation and model independence.

## Rationale
The decision preserves existing artifact and graph semantics while making the authority of each
selection path explicit. It supports design review of proposed ADRs without allowing them to bind
implementation, and it keeps Phase 3 small enough to implement and test deterministically.

## Consequences
Phase 3 must implement and test role-aware traversal, effective ADR replacement, configured-source
precedence, bounded selection, lossless fallback, outcome reporting and budget guarantees. Existing
Phase 0/1 schemas and validation remain structurally authoritative. Onboarding and authoring UX are
not prerequisites for START.

## Constraints
Do not amend D03 or D09. Do not add proposal registries, task-index migration, model-provider
dependencies or generic application infrastructure to START.

## Implementation Impact
Exact excerpt boundaries, duplicate-heading handling, normalization, ID/path deduplication,
serialization, estimator, diagnostic identifiers, exit codes, oversized Tier 2/3 packing and
atomic generated-envelope replacement belong to TASK-0004's implementation contract.

## Validation
This ADR must remain schema-valid and its links must resolve. Its adoption does not itself
implement START or mutate generated state.

## Related Decisions
Supplements D01, D06, D09, D17 and D20. Preserves D03, D05, D08, D15, D16, D18 and D25.
