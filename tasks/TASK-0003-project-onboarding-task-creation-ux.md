---
context_type: task
schema_version: 1
id: TASK-0003
title: Define Project Onboarding and Task-Creation UX
status: accepted
files:
  - SPEC.md
  - ARCHITECTURE-DECISIONS.md
  - AGENTS.md
  - templates/PROJECT.md
  - templates/feature.md
  - templates/task.md
  - templates/TASKS.md
  - schemas/task.schema.json
  - src/commands/init.ts
  - docs/PHASE-2.md
---
# TASK-0003 — Define Project Onboarding and Task-Creation UX

## Objective
Produce a reviewed design proposal for project onboarding and natural-language task
creation before Phase 3 implementation. Ordinary users should establish project context
and request development work without manually authoring Keystone artifacts or learning
internal schemas and Markdown structure. The design work was completed, independently reviewed, and adopted through ADR-0001.

## Design Principles
1. Begin with the user describing what they are building in normal language.
2. Transform the approved project description into durable project context, including
   PROJECT.md and an initial feature map.
3. Explore the conceptual hierarchy PROJECT → FEATURES → TASKS → relevant ADRs, rules,
   skills, learnings, traps, and files. Features provide a stable middle layer between
   overall project context and potentially large numbers of tasks.
4. Do not invent requirements because a feature is mentioned. Unknowns must remain
   unknown or be clarified when they materially affect implementation.
5. Task artifacts are required for meaningful context-managed development work, but
   users should not normally author task documents manually.
6. A request such as "Add trainer invitations" should eventually be transformable into
   an appropriate task artifact using existing project and feature context.
7. Require user confirmation only when ambiguity materially affects requirements,
   architecture, scope, constraints, or acceptance criteria. Avoid unnecessary clarification.
   Define how this interacts with required knowledge approval and high-authority review.
8. Artifacts are the system's interface to durable knowledge, not documentation overhead
   imposed on users.
9. Address both greenfield projects and existing repositories with substantial code,
   architecture, and documentation.

These are design inputs for investigation, not amendments to the approved architecture.

## Acceptance Criteria
- Deliver a reviewed design proposal covering all investigation topics below, with
  concrete greenfield and existing-repository walkthroughs and the trainer-invitations example.
- Specify how initial project context and the feature map are proposed, confirmed, and
  persisted, and how features evolve after onboarding without inventing requirements.
- Define how natural-language requests become task artifacts, including their relationship
  to TASKS.md, existing feature context, and explicit supporting links.
- Define material-ambiguity confirmation criteria and evaluate whether trivial work needs
  a full task artifact; do not silently exempt meaningful context-managed work.
- Explain evidence/provenance, unknowns, conflicting sources, and approval boundaries when
  onboarding existing repositories, preventing inferred project facts from silently
  becoming authoritative.
- Separate deterministic Keystone responsibilities from LLM-assisted interpretation and
  drafting; explain how proposed/generated knowledge becomes authoritative.
- Evaluate interaction with `keystone init`, whether new CLI commands or changes to
  existing commands are justified, and implications for `keystone start <TASK-ID>`.
- Assess compatibility with SPEC.md and ARCHITECTURE-DECISIONS.md. Identify any necessary
  ADRs or specification amendments as proposals for review, with alternatives and rationale.
- Record review findings and their disposition. The output is a reviewed design proposal
  and any required proposed ADR/specification amendments, not implemented behavior or
  automatically approved architecture.

## Scope
Investigate onboarding, initial feature-map creation and confirmation, feature evolution,
task creation, material ambiguity, trivial-work policy, evidence-based repository onboarding,
deterministic versus LLM-assisted responsibilities, knowledge authority, CLI UX, and Phase 3
implications. Keep the design compatible with Windows-safe paths, offline-testability,
thin adapters, disposable generated indexes, and tiered mutation permissions, or explicitly
identify any proposed deviation for review.

## Out of Scope
- Implementing this design, Phase 3, or any later-phase functionality.
- Modifying approved SPEC.md, ARCHITECTURE-DECISIONS.md, schemas, rules, or skills.
- Initializing or automatically reconciling the Keystone framework repository.
- Creating proposed ADRs during task creation; analysis may propose them when justified,
  including when needed to document alternatives for review.

## Dependencies
Use TASK-0002's Phase 2 implementation as existing behavior to evaluate, not as architectural
authority. Resolve the design before beginning Phase 3 implementation.

## Relevant Files
The front-matter `files` links identify the approved contracts, current templates, task
schema, and Phase 2 initialization implementation/documentation to inspect during analysis.

## Decisions / ADRs
Immediate tension to resolve explicitly: D03 establishes features as first-class but
optional, and SPEC.md core principle 8 says feature boundaries must not distort architecture.
A universally mandatory PROJECT → FEATURES → TASKS hierarchy would conflict with that
baseline. Investigate a feature-oriented default that preserves optionality, or propose
an amendment for review; do not silently decide this in the task artifact.

Also assess D01/D20 authority and mutation controls, D02 minimal documentation, D04 feature
boundaries, D05 task indexing, D09 deterministic START, D15 validation, D19 initialization,
and D22 task identification. Architectural changes remain proposals until approved.

## Implementation Notes
Design only. No solution, new command, approval mechanism, or architectural amendment has
been selected by creating this task.

## Tests
During design, propose acceptance scenarios for the workflows and failure/ambiguity cases.
Validate and index this task with the existing Keystone CLI; implementation tests belong
to a separately authorized implementation task.

## Review Findings
Independent architecture review completed. Design adopted by ADR-0001; onboarding and
authoring machinery remain deferred.

## Outcome
Design adopted by ADR-0001 for the Phase 3 START contract. This task remains design-only;
no implementation was performed. Phase 3 implementation is tracked separately by TASK-0004.
