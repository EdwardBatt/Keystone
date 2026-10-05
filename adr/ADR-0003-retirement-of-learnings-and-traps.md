---
context_type: adr
schema_version: 1
id: ADR-0003
title: Retirement of learnings and traps
status: accepted
created: 2026-10-05
features: []
tasks: [TASK-0010]
supersedes: []
superseded_by: []
tags: [compaction, learning, trap, start, provenance]
---
# ADR-0003 — Retirement of learnings and traps

## Index
Architectural guarantees for Phase 6 COMPACT (`keystone compact`): a terminal `retired`
state for learnings and traps, typed successor links, and preservation of the evidence and
provenance chain. Supplements ADR-0001 (guarantees 2 and 3) and clarifies TASK-0008 decision 3(a)
(guarantee 7). TASK-0010 is the design record.

## Context
D21 requires evidence-preserving consolidation. SPEC principle 5 requires that noise is not
accumulated, and principle 9 that compaction preserves evidence and traceability.

ADR-0001 binds only `accepted` learnings and `active` traps. It treats `candidate` and `proposed`
as known non-binding review material, and any other status as unknown authority, which START
diagnoses. Supersession is a typed relationship only between ADRs. No existing state can
therefore record that a learning or trap was consolidated or withdrawn without either leaving it
binding, making it look like a fresh candidate, or making START report unknown authority.

TASK-0008 decision 3(a) left CLOSE's unpromoted candidates unchanged, with no `rejected` state in
v0.1, and deferred their disposition to Phase 6.

On 2026-10-05 the owner resolved TASK-0010 decisions C1(b), C2(a), C3(a), C4(a), C5(b) and C6(b),
and approved the successor safety requirements. This ADR records the durable guarantees that C1(b)
and C2(a) require. The other decisions are Phase 6 contract choices within existing architecture
and are recorded in TASK-0010.

## Decision

1. **Scope.** Retirement applies only to learnings and traps. It never applies to ADRs, which
   keep ADR-0001 §4 supersession, or to rules, skills, projects, features, tasks or reviewer
   records.

2. **A terminal `retired` state (supplements ADR-0001 §2).**
   - `retired` is a recognised status for learnings and traps.
   - A retired artifact is never binding through any selection path.
   - It is known historical material, not unknown authority. START may present it as
     non-binding history at the lowest priority tier and does not diagnose it as unknown
     authority.
   - Retirement is terminal in v0.1: a retired artifact cannot be promoted, reinstated or
     retired again with a different record.

3. **Typed successor links (supplements ADR-0001 §3 and the Phase 0/1 link semantics).**
   - A retired learning or trap may declare `superseded_by` naming one or more successors. On
     learnings and traps this is a typed link: it must resolve to an artifact of the same type
     and must not form a cycle.
   - The link is declared one-sidedly on the retired artifact. Successors are not edited by
     retirement.
   - `supersedes` on learnings and traps remains uninterpreted extension metadata.
   - A successor link never makes a retired artifact binding, and never makes a successor
     binding: a successor binds only through its own eligibility.

4. **Retirement record.** Every retired learning or trap carries a structured retirement record
   naming the task under which it was retired and a non-blank reason. A retired artifact without
   a valid record is a structural validation error.

5. **Evidence and provenance chain.** Retirement preserves evidence and traceability (D21):
   - The retired artifact stays in place with its body, evidence and links. Retirement never
     deletes, moves or rewrites knowledge; location confers no authority (ADR-0001 §5).
   - Every successor named by a retired artifact contains all of the retired artifact's
     `tasks` and `evidence` entries and, for traps, all of its `files` entries.
   - These containment requirements are structural invariants, checked by validation for as
     long as the link exists, not only when retirement is applied. Following successor links
     therefore always reaches artifacts that carry the full provenance of their predecessors.
   - Because a successor carries every task link of its predecessor, task-relevant START
     selection continues to reach the successor where it reached the predecessor.

6. **Successor safety at retirement.** When a retirement with a successor is applied, each
   successor must be eligible at that time: an `accepted` learning, or an `active` trap with a
   classified severity (ADR-0001 §7). A successor may later be retired itself only under these
   same guarantees, so the chain continues. Retirement without a successor is permitted only
   with the recorded reason, and removal of binding knowledge is reported.

7. **Disposition of candidates (clarifies TASK-0008 decision 3(a)).** Decision 3(a) governs
   CLOSE: CLOSE never rejects or retires a candidate, and leaves unpromoted candidates unchanged.
   Phase 6 disposes of candidates only through this retirement state, applied explicitly. No
   separate `rejected` state exists.

8. **Controlled, authorized application.**
   - Keystone never decides what to retire. Retirement is applied only to artifacts the owner
     explicitly names, each with a reason (D11, D15).
   - Every retirement is performed under an existing task with status `active`, which the
     retirement record names. The edits are ordinary working-tree changes, covered by that
     task's review and CLOSE (D13, D20, D22).
   - All checks complete before any write, and a set of requested retirements applies
     all-or-nothing.
   - COMPACT works offline and calls no model.

9. **Implementation contract.** Exact field names inside the retirement record, CLI flags,
   report contents, diagnostics, exit codes and write mechanics belong to the Phase 6
   implementation contract (`docs/PHASE-6.md`). They may change without an ADR while this ADR,
   SPEC.md, ADR-0001, ADR-0002 and D21 remain satisfied.

## Alternatives Considered
TASK-0010 decision C2 evaluated:
- **Demotion to `candidate` or `proposed`.** No ADR needed, but retired knowledge would look
  promotable, remain START review material and not reduce noise.
- **Moving retired files to `context/archive/` excluded from discovery.** References would stop
  resolving, traceability would break, and location would confer authority, contrary to
  ADR-0001 §5.
- **Deletion, relying on Git history.** Evidence would leave the repository, contrary to SPEC
  principle 9 and D21.

Decision C1 also rejected a candidate-only `rejected` state alongside a separate consolidation
state, as two new states where one suffices.

## Rationale
One terminal state with typed, containment-checked successor links follows the pattern ADRs
already use (status plus older-to-newer links). It removes retired knowledge from binding
context, which reduces START noise, while keeping every piece of evidence in the repository.
Making containment a standing structural invariant means the provenance chain cannot be
broken later by hand edits. Keeping the decision of what to retire with the owner, under an
active task, preserves D11, D15 and the existing review and CLOSE gates without new machinery.

## Consequences
- START recognises `retired` learnings and traps as non-binding history, with no unknown-authority
  diagnostic.
- Validation gains `superseded_by` link checks and containment invariants for learnings and traps,
  and requires a retirement record on retired artifacts.
- CLOSE continues to promote only `candidate` learnings and `proposed` traps, so it never promotes
  a retired artifact.
- Editing a successor so that it no longer contains its predecessor's provenance fails validation.
- Retirement edits after a task closes change evidence recomputed for that task, as promotion
  already does (`docs/PHASE-5.md`); recorded evidence hashes still identify what was reviewed.
- SPEC.md describes retirement and the `compact` CLI operations, as it does for `review` and
  `close`.

## Constraints
- Do not change ADR-0001 beyond guarantees 2 and 3, or ADR-0002.
- Do not change CLOSE semantics beyond the clarification in guarantee 7.
- Do not introduce automatic or model-based retirement, deletion, relocation, archive discovery
  exclusion, or a richer trap severity vocabulary.
- `context/archive/` and the `context/` placeholder files are not given semantics by this ADR.

## Implementation Impact
The Phase 6 implementation task records in `docs/PHASE-6.md`:
- retirement record field names and the CLI operations;
- the read-only compaction report and its deterministic signals;
- validation and START changes for `retired` and typed `superseded_by`;
- diagnostics, outcomes and exit codes;
- all-or-nothing writes with restoration on failure.

`docs/TASK-0010-phase-6-compact-design.md` is implementation guidance, not architecture, except
where this ADR retains it.

## Validation
This ADR must remain schema-valid and its links must resolve. Adopting it does not implement
Phase 6.

## Related Decisions
- Supplements ADR-0001 through guarantees 2 and 3.
- Clarifies TASK-0008 decision 3(a) through guarantee 7.
- Makes D21 concrete for learnings and traps.
- Preserves D01, D02, D07, D11, D12, D15, D16, D20, D22, D25 and ADR-0002.
