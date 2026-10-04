---
context_type: adr
schema_version: 1
id: ADR-0002
title: Review evidence and reviewer records
status: accepted
created: 2026-10-04
features: []
tasks: [TASK-0006]
supersedes: []
superseded_by: []
tags: [review, evidence, authority, start]
---
# ADR-0002 — Review evidence and reviewer records

## Index
Establishes the architectural guarantees for Phase 4 Review (`keystone review`). Supplements
ADR-0001 with one START eligibility rule (guarantee 8). TASK-0006 is the historical design and
review record.

## Context
SPEC.md defines `keystone review` and requires the first release to "prepare independent review
evidence".
- D13 requires distinct, independent code, architecture and context review roles.
- D14 requires an objective evidence package with no implementer private reasoning.
- D15 separates deterministic checks from semantic agent review.

TASK-0006 explored these through owner decisions and three independent review rounds and
produced detailed mechanisms. This ADR keeps only the durable guarantees.

## Decision

1. **Evidence only.** `keystone review` prepares review evidence. It does not call a model,
   determine a verdict, approve work, or determine implementation readiness.

2. **Independent roles through input isolation.** Independent code, architecture and context
   review is achieved through role-appropriate isolation of each role's inputs.

3. **Defined baseline.** Review is anchored to a defined Git baseline.
   - Work under review cannot silently redefine the requirements or binding context against
     which it is reviewed.
   - A task introduced by the work may define that work's requirements without becoming
     general project authority.

4. **Represented work.** Material work under review is represented in the evidence. Withheld
   or unrepresentable content and evidence gaps are explicit, never silently omitted.

5. **Claims are not evidence.** Implementer assertions and private reasoning are not objective
   evidence. Context review may receive relevant implementer-authored material when it is
   clearly identified as unverified.

6. **Distinct role purposes.** Code, architecture and context roles retain their distinct D13
   purposes. Exact package composition is implementation-level.

7. **Deterministic, uncontaminated evidence identity.**
   - Materially identical review evidence under the same review contract has a deterministic
     evidence identity.
   - Generated review state and reviewer reports cannot contaminate the evidence they
     describe.
   - Exact hashing, serialisation, metadata and generated-path mechanisms are
     implementation-level.

8. **Review records and START ineligibility (supplements ADR-0001).**
   - Generated review packages are disposable `.context/` state.
   - Reviewer reports are durable but non-authoritative records under the root-level
     `reviews/` directory.
   - Root-level `reviews/`, compared case-insensitively, is ineligible for START and for
     review-context selection.
   - ADR-0001 is otherwise unchanged.

9. **Represented gaps versus structural failure.** Review distinguishes explicitly represented
   or incomplete evidence from structural failure, where the subject, the boundary or the
   required governing context cannot be established reliably. Exact diagnostics and precedence
   are implementation-level.

10. **Offline and non-mutating.**
    - Evidence preparation works offline.
    - It does not modify project source, Git history or Git repository state.
    - It may write disposable generated review state under `.context/`.
    - Git commands, environment isolation, capability checks, temporary materialisation and
      compatibility mechanisms are implementation-level.

11. **Stable reviewer report contract.**
    - Reports carry task, role, round, verdict, evidence identity, baseline and reviewer
      attestation.
    - Verdicts are `approve`, `changes-requested` and `inconclusive`.
    - Reports contain findings, evidence examined, and limitations where applicable.
    - Phase 5 defines CLOSE and staleness semantics.

12. **Implementation contract.** `docs/PHASE-4.md` owns the implementation contract.
    Implementation mechanisms may change without an ADR, provided ADR-0002, SPEC.md and
    D13–D15 remain satisfied.

## Clarification (2026-10-04)
This ADR was revised in place on 2026-10-04, before any Phase 4 implementation, to correct an
authority-layer mistake. The first adopted text turned detailed mechanisms into architecture.
Examples include:
- section-heading partitions and metadata field classes;
- diagnostic precedence classes;
- hash payload composition;
- Git flags, environment variables and minimum versions;
- per-role package tables;
- round-name grammar.

The mechanisms developed during TASK-0006 (design record:
`docs/TASK-0006-phase-4-review-design-proposal.md`, revision 6) remain **implementation
guidance**. They are not architectural requirements unless this ADR explicitly retains them.
TASK-0006 itself is unchanged and remains the accepted historical design and review record.

## Alternatives Considered
TASK-0006 recorded the alternatives and trade-offs, among them:
- model-performed review and verdict ingestion;
- enforced reviewer identity;
- working-tree requirement standards;
- labelling rather than withholding claims;
- discovered or committed review artifacts;
- authority-registration mechanisms.

They remain rejected at the level of the guarantees above.

## Rationale
Keeping architecture at the level of guarantees makes D13–D15 concrete and keeps START
semantics stable, apart from one eligibility rule. It also lets implementation mechanisms be
corrected without architectural churn.

## Consequences
- Phase 4 implementation and its mechanisms are specified in `docs/PHASE-4.md` under TASK-0007.
- START gains the root-level `reviews/` ineligibility rule.
- Phase 5 must define what verdicts and staleness mean for CLOSE.

## Constraints
- Do not add model-provider dependencies, network access, verdict determination, or an
  authority-registration mechanism.
- Do not change ADR-0001 beyond guarantee 8.
- Phase 5 semantics are out of scope.

## Implementation Impact
`docs/PHASE-4.md` records the mechanisms and acceptance behaviour, for example:
- package composition and serialisation;
- evidence-identity composition;
- requirement and claim identification;
- diagnostics and outcome mapping;
- Git invocation and isolation;
- base materialisation;
- budget packing;
- charters;
- report schema and naming.

These records create no architectural requirements.

## Validation
This ADR must remain schema-valid and its links must resolve. Adopting it does not implement
Phase 4.

## Related Decisions
- Supplements ADR-0001 through guarantee 8.
- Makes D13, D14 and D15 concrete.
- Preserves D01, D02, D07, D08, D16, D17, D18, D20, D22 and D25.
