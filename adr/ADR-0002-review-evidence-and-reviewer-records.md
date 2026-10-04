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
Adopts the Phase 4 Review architecture accepted in TASK-0006 (design record:
`docs/TASK-0006-phase-4-review-design-proposal.md`, revision 6). Supplements ADR-0001 with one
START eligibility rule (decision 8).

## Context
SPEC.md defines `keystone review <TASK-ID> [--type code|architecture|context|all]` and requires
the first release to "prepare independent review evidence".
- D13 requires distinct, independent code, architecture and context review roles.
- D14 requires an objective evidence package with no implementer private reasoning.
- D15 separates deterministic checks from semantic agent review.

None of these define what `review` produces, what counts as evidence, which revision is the
review standard, where review records live, or how a verdict is recorded. TASK-0006 resolved
these questions through owner decisions and three independent architecture review rounds.

## Decision

1. **Evidence only.** `keystone review` prepares deterministic evidence packages. Keystone
   never calls a model and never decides a verdict. Semantic review is done outside Keystone.
   No outcome means approval, readiness or a verdict.

2. **Independence is input isolation.** Keystone controls what each role's package contains,
   and a package never contains a reviewer report. Reviewer identity is attested in the report
   and not verified. Reviewer charters forbid reading `reviews/`, other packages and
   transcripts.

3. **Review boundary.**
   - The subject is the difference between a resolved base commit (`--base <rev>`, default
     `HEAD`) and the working tree. It includes staged and untracked files that are not
     ignored, and always excludes `reviews/**`. Ignored paths are outside the boundary.
   - The commits in `base..HEAD` are listed by hash, each with deterministic flags recording
     whether the full message contains the task ID and which ADR IDs it contains. Message text
     is not evidence.
   - `--base` must resolve to a commit that is an ancestor of `HEAD`.

4. **Base-revision standard.** Requirements and binding context are anchored to the base
   revision. Changes to requirements or authority made during the work are evidence under
   review and cannot redefine the standard they are reviewed against.
   - The root task is identified by ID at base and in the working tree, and the two instances
     are matched by ID.
   - A task introduced within the subject supplies the requirements under review. It is never
     added to the base inventory and never becomes general project authority.
   - Binding context is selected by the ADR-0001 rules in a **review mode** over the base
     inventory. A valid, identifiable relationship whose target is unavailable at base is an
     evidence gap and is never inserted or promoted.
   - Selection never operates on an ambiguous identity. Artifacts with duplicate, malformed or
     ambiguous identity are quarantined.

5. **Objective evidence and claims.** Implementer-authored claims are excluded from objective
   evidence. Requirements remain valid input.

   **Root task metadata classes:**
   - identity: `context_type`, `schema_version`, `id`;
   - requirement: `title`, `priority`, `tags`, and the relationship fields `feature`,
     `features`, `depends_on`, `adrs`, `key_adrs`, `rules`, `key_rules`, `skills`, `files`,
     `tasks`;
   - lifecycle: `status`, `created`, `completed`;
   - unrecognised: every other field, including extensions.

   **Root task body partition**, on level-2 ATX headings outside fenced code:
   - requirement sections: `Objective`, `Acceptance Criteria`, `Scope`, `Out of Scope`,
     `Dependencies`, `Relevant Files`, `Decisions / ADRs`;
   - claim sections: `Implementation Notes`, `Tests`, `Review Findings`, `Outcome`;
   - level-3 and deeper headings belong to their enclosing level-2 section;
   - exactly one level-1 heading, on the first non-blank body line and before any level-2
     heading, is exempt as the title;
   - an unknown level-2 section, or prose between the title and the first level-2 heading, is
     unrecognised;
   - a duplicate claim heading is safe: both copies are claims.

   **Handling:**
   - Lifecycle fields are reported as facts to every reviewer role.
   - Edits to requirement fields or sections within the subject are shown side by side with
     the base requirements.
   - Unrecognised fields and sections are never silently dropped. They are reported and make
     the package incomplete.
   - The partition is unsafe, and the result is failed, when any of these occurs:
     - a duplicate requirement heading;
     - a setext heading;
     - an unclosed fence;
     - any level-1 heading other than the exempt title.

     Whole-body fallback is not used for review.
   - Claim filtering applies only to the task under review. Accepted dependency tasks remain
     whole, as historical context.
   - Non-task changed files are included whole as the work under review. Statements inside
     them are reviewed, not trusted.
   - Commit message text, transcripts, `.context/current-envelope.json`, reviewer reports and
     anything outside the repository are always excluded. A prior report by the same role may
     be supplied to that role only explicitly, alongside the package.

6. **Per-role packages.** Each role receives only what its charter requires.

   | Content | code | architecture | context |
   |---|---|---|---|
   | Root identity and requirement content, and lifecycle facts | yes | yes | yes |
   | Base binding context | yes | yes, with ADRs and Tier 3 authority evidence first | yes |
   | Subject manifest and diff | yes | yes | yes |
   | Change classification | paths only | yes | yes |
   | Base-derived checks (base START outcome and diagnostics, commit flags) | yes | yes | yes |
   | Operational checks | working-tree validation | working-tree validation | all |
   | Root claim and unrecognised content | names and hashes only | names and hashes only | included, marked unverified material under review, never objective evidence |
   | Accepted dependency tasks | whole | whole | whole |
   | Charter | code | architecture | context |

7. **Change exposure.** Every changed path and its content is deterministically exposed,
   except content withheld by decision 6 or represented by metadata and hash under decision 11.
   - Typed artifacts are classified with their base and working-tree type and status.
   - Keystone-managed files are classified from the same scaffold definition `init` uses, and
     are not labelled authority.
   - Generated paths and ordinary files are classified as such.
   - Untyped authoritative or governance documents are identified semantically by the
     architecture and context reviewer charters.
   - There is no authority-registration field, no typed authority artifact, and no hard-coded
     project file name.

8. **Review records and START ineligibility (supplements ADR-0001 §5 and §7).**
   - Packages are generated, disposable state under `.context/review/<TASK-ID>/`.
   - Reviewer reports are durable records under `reviews/<TASK-ID>/<role>-<round>.md`. They
     are written by reviewers, never by Keystone, and are added and never overwritten.
   - Reports are not project truth merely by existing.
   - `review` reads only file names under `reviews/<TASK-ID>/`, to state the next round.
   - **A path whose first segment equals `reviews`, compared case-insensitively, is
     categorically ineligible for START and for review-mode selection through every path:**
     - discovery never descends into the root-level `reviews/` directory;
     - a configured source equal to or inside `reviews` is invalid configuration;
     - a `files` reference first receives ordinary path validation, and its diagnostics are
       unchanged. Only a reference then validly identified as a review record is refused, with
       a defined, non-fatal diagnostic and a visible omission record.

     The refusal alone does not change the START outcome.
   - ADR-0001 is otherwise unchanged.

9. **Evidence identity.**
   - `evidence_hash` identifies a role-independent pre-review evidence payload:
     - the base commit;
     - the subject, excluding `reviews/**`;
     - root identity, requirement and unrecognised content;
     - base binding-context selection, with quarantine records and evidence gaps;
     - base-derived checks;
     - review-procedure identity: Keystone version, review contract version,
       partition-contract version, and every charter's provenance and hash.
   - The payload excludes root lifecycle fields, the `Review Findings` and `Outcome` sections,
     round numbers, and **all operational checks** (working-tree validation, generated-index
     freshness and next-round allocation). Those checks stay visible outside the hash.
   - `package_hash` identifies the whole canonical package with its own field omitted.
   - Writing a report, a disposition or a status change cannot change `evidence_hash`.

10. **Reviewer report contract.**
    - Front matter has no `context_type`: `kind: keystone-review-report`, `schema_version`,
      `task`, `role`, `round`, `verdict`, `evidence_hash`, `base`, and a free-text `reviewer`
      attestation.
    - Verdicts are `approve`, `changes-requested` and `inconclusive`.
    - Body sections:
      - `## Findings`, required, and must not be blank when the verdict is
        `changes-requested`;
      - `## Evidence Examined`;
      - `## Limitations`, required when the verdict is `inconclusive`.
    - Round names are `<role>-<positive integer without leading zeros>.md`.
    - The contract is provisional until Phase 5 consumes it: Phase 5 may add fields but must
      not change existing meanings.
    - No Phase 4 command validates report contents, and the general `validate` command does not
      check reports. CLOSE semantics and staleness rules are deferred.

11. **Outcomes and precedence.** Review has three outcomes: `complete`, `incomplete/conflicted`
    and `failed`. Conditions are classified in this order:
    1. **Failed:** malformed, duplicate or ambiguous identity or structure that prevents
       reliable identification of the root task or required binding context. This includes:
       - root identity failures;
       - an unsafe partition;
       - more than one project candidate, or a malformed sole project;
       - a quarantined target that is required binding context;
       - case-colliding paths within configured discovery sources affecting the root, the
         project or binding context.
    2. **Failed:** inability to establish a trustworthy boundary or required input:
       - an unknown task;
       - an unresolvable or non-ancestor base;
       - an operation in progress or unmerged entries;
       - Git missing or failing the capability probe;
       - a missing required object;
       - I/O failure.
    3. **Incomplete:** a valid, identifiable relationship whose target is unavailable at base,
       or whose quarantined target is not required binding context. It is represented as an
       evidence gap.
    4. **Incomplete:** unrelated base structural diagnostics that do not prevent deterministic
       package construction.
    5. **Incomplete:** other explicitly represented gaps:
       - incomplete or conflicted START at base;
       - unrecognised root content;
       - an empty code subject;
       - binary, non-UTF-8, submodule, symlink and filter-attributed content, represented
         with metadata and hashes and never silently omitted.

    Working-tree structural validation errors are operational checks, not failures. Budget
    omissions of lower-tier context do not by themselves make a package incomplete.

    D17 applies. The following are never omitted:
    - identity and requirement content;
    - base binding content;
    - the charter;
    - the checks;
    - the subject manifest;
    - the subject diff, apart from content withheld by decision 6 or represented by metadata
      and hash;
    - the context role's under-review content.

12. **Git isolation.** Review never runs a Git operation that can:
    - execute filters, fsmonitor, external or textconv drivers, or hooks;
    - fetch, lazily fetch or use the network;
    - follow replacement objects;
    - write trace output;
    - change Git state.

    Every review Git invocation, and the capability probe, uses one deterministic sanitised
    environment in which inherited tracing is disabled. Evidence corresponds to the literal
    objects named by the base and `HEAD`.

    Review requires upstream Git 2.45 or later. **A distribution build below 2.45 that
    backports the required behaviour is accepted when the capability probe for
    `--no-lazy-fetch` succeeds.** The probe is authoritative, and version strings are not
    parsed. Other commands keep their existing Git requirements.

13. **Reviewer charters.**
    - Charters are review-procedure inputs. Keystone ships model-neutral defaults.
    - A project's `agents/<role>-reviewer.md` with content beyond a heading replaces the
      default. The base-revision version is always used, and a charter changed in the subject
      is a classified change, not applied.
    - START does not automatically select charters as reviewer charters, and charters confer
      no START authority. Existing explicit-file behaviour is unchanged.

14. **Mutation.** `review` writes only `.context/review/`. It never modifies sources, task
    files, `reviews/` or Git state.

## Alternatives Considered
TASK-0006 evaluated these, among others, and rejected each with recorded trade-offs:
- model-performed review;
- verdict ingestion;
- enforced reviewer identity;
- task-ID commit discovery;
- merge-base boundaries;
- labelling claims instead of withholding them;
- one package for all roles;
- working-tree standards;
- mixed base and working trees;
- authority registration fields, typed authority artifacts and name conventions;
- discovered or committed review artifacts;
- per-role hashes;
- hashing operational checks;
- porcelain Git diffs;
- environment-only lazy-fetch control;
- version parsing.

## Rationale
The decisions make D13–D15 concrete without changing accepted START semantics, other than the
one ineligibility rule.
- Deterministic software exposes and identifies evidence, and semantic judgement stays with
  reviewers.
- Anchoring the standard to the base revision prevents work from redefining its own
  requirements.
- Separating evidence identity from operational state keeps review records stable as the task
  lifecycle completes.

## Consequences
- Implementing Phase 4 requires review-mode selection, package construction, Git isolation,
  default charters and a report schema and template.
- START gains the review-record ineligibility rule.
- Discovery and configuration reject `reviews/` sources.
- Review requires Git 2.45 or a probe-proven backport.
- Phase 5 must define what verdicts and staleness mean for CLOSE.

## Constraints
- Do not add model-provider dependencies, network access, verdict ingestion, report validation
  in `validate`, automatic prior-report inclusion, or authority registration.
- Do not change ADR-0001 beyond decision 8.
- Phase 5 semantics are out of scope.

## Implementation Impact
The following belong to the Phase 4 implementation contract, following the ADR-0001 /
TASK-0004 precedent:
- exact diagnostic identifiers;
- package serialisation and field layout;
- the sanitised environment variable list and per-invocation options;
- the allowed Git command set;
- the line-diff algorithm;
- base materialisation;
- budget packing order;
- charter text;
- schema and template file layout.

TASK-0006 revision 6 records the proposed mechanics and acceptance scenarios.

## Validation
This ADR must remain schema-valid and its links must resolve. Adopting it does not implement
Phase 4.

## Related Decisions
- Supplements ADR-0001 (§5, §7) through decision 8.
- Makes D13, D14 and D15 concrete.
- Applies D17.
- Preserves D01, D02, D07, D08, D16, D18, D20, D22 and D25.
- Extends the SPEC.md CLI contract with `--base`.
