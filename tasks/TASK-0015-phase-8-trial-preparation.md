---
context_type: task
schema_version: 1
id: TASK-0015
title: Prepare the harness for the Phase 8 Cross-model Trial
status: accepted
priority: high
depends_on: [TASK-0014, TASK-0013]
adrs: [ADR-0001, ADR-0002, ADR-0003, ADR-0004]
files:
  - docs/TASK-0015-phase-8-preparation-contract.md
  - docs/TASK-0014-phase-8-cross-model-trial-design.md
  - tasks/TASK-0014-phase-8-cross-model-trial-design.md
  - adr/ADR-0004-benchmark-harness-boundaries.md
  - SPEC.md
  - docs/PHASE-7.md
  - docs/REPO-SEPARATION.md
  - benchmark/specification/README.md
  - benchmark/specification/scorecard.json
  - benchmark/specification/schemas/plan.schema.json
  - benchmark/specification/schemas/run-record.schema.json
  - benchmark/specification/schemas/judgements.schema.json
  - benchmark/specification/schemas/agent-profile.schema.json
  - benchmark/results/README.md
  - benchmark/analysis/README.md
  - src/benchmark/cli.ts
  - src/benchmark/specs.ts
  - src/benchmark/validate.ts
  - src/benchmark/prepare.ts
  - src/benchmark/run.ts
  - src/benchmark/record.ts
  - src/benchmark/score.ts
  - src/benchmark/report.ts
  - src/benchmark/store.ts
  - src/context/benchmark-records.ts
  - src/benchmark/repos.ts
  - src/benchmark/plans.ts
  - src/benchmark/attempts.ts
  - src/benchmark/judging.ts
  - src/benchmark/exposure.ts
  - src/benchmark/freeze.ts
  - src/benchmark/calibrate.ts
  - src/benchmark/analysis.ts
  - benchmark/specification/schemas/plan-v2.schema.json
  - benchmark/specification/schemas/analysis-spec.schema.json
  - benchmark/specification/inspection/keystone-terms.json
  - tests/phase8-prep.test.mjs
  - tests/bench2-helpers.mjs
  - docs/PHASE-0-1.md
  - docs/PHASE-3.md
  - tests/README.md
created: 2026-10-07
completed: 2026-10-07
---
# TASK-0015 — Prepare the harness for the Phase 8 Cross-model Trial

## Objective
Implement Phase 8 preparation items 1–10, as defined by the accepted TASK-0014 design (design notes
revision 6, "Preparation work after design acceptance"). This is step 1 of the TASK-0014 proposed
task sequence: harness preparation, with tests.

The work extends the reusable Phase 7 harness (`keystone-bench`) and its implementation contract
(`docs/PHASE-7.md`, ADR-0004 guarantee 9). It contains no application-specific knowledge, and it
produces no benchmark evidence. Correctness is proven offline on synthetic fixtures with the
deterministic fake agent (ADR-0004 guarantee 8).

This task does not redesign Phase 8. The TASK-0014 decisions (P1–P13, B1, B2, clarifications 1–8,
the revision 5 rule inputs and the revision 6 classification precedence) are inputs, not open
questions.

## Acceptance Criteria
The criteria implement the approved implementation contract
(`docs/TASK-0015-phase-8-preparation-contract.md`, revision 2). Every criterion is covered by
automated, offline tests, except the real Codex verification (criterion 33). Each mechanism is
recorded in `docs/PHASE-7.md` (in a Phase 8 preparation part), with stable diagnostic codes for
each refusal. No TASK-0014 value is hard-coded in the harness: every margin, threshold, bound,
fraction, seed, term list, completeness rule and classification order is supplied by the
experiment's plan directory and enters the plan hash (Q3).

**Item 1 — Version provenance**
1. A version 2 profile declares its tool version, which must be trusted. Before each run's
   condition setup, `run` probes the tool version. A mismatch refuses the run before setup
   (`BENCH_TOOL_VERSION_MISMATCH`, outcome `blocked`), consumes no attempt, and never persists an
   untrusted string.
2. Version 2 run records carry the observed tool version and the trusted reported models, each
   with its source label. A session reporting a trusted model other than the declared one is
   flagged `model_mismatch`. `report` and `analyze` list identity mismatches, and never exclude
   those runs.

**Item 2 — Codex usage parser**
3. The `codex-jsonl` parser maps the Codex JSON Lines stream to the reported measures, labelled
   `reported`. It is tested against a fixture that is clearly identified as synthetic and
   unverified, and built from the documented format.
4. Missing or malformed usage yields `null` with `BENCH_USAGE_UNREPORTED`, never a fabricated
   zero.

**Item 3 — Judgements (clarifications 3 and 7)**
5. Judgements version 2: judges are declared in the plan. Imports are keyed by run and judge, and
   stored separately; none merges into or replaces another. A second judgement by the same judge
   for a run is refused (`BENCH_JUDGEMENT_DUPLICATE`), and so is an undeclared judge.
6. The audit sample is computed by `score --blind` from blinded IDs only, using the plan's
   declared judge, fraction, seed and stratification. It is reproducible, rounded up per stratum,
   and its hash is recorded in the packet. An audit-role judgement outside the sample is refused
   (`BENCH_JUDGEMENT_NOT_SAMPLED`).
7. Each attestation records the judge, the rubric commit and hash, the prompt hash and the date.
   A mismatch with the plan is refused (`BENCH_JUDGEMENT_PROVENANCE_INVALID`).
8. The optional `condition_guess` is accepted. Guess participation and accuracy are reported per
   judge as blinding measures only, and never enter any outcome or classification.
9. (C2) Quantitative finding counts are averaged over vendor judges. `review_verdict` is never
   averaged, and never combined into a run-level value. Each judge's verdict is preserved and
   reported separately, with judge agreement and disagreement (inter-vendor, and vendor to
   audit).

**Item 4 — Plan location and freezing (Q2, C1)**
10. Experiment plans live at `benchmark/plans/<plan-id>/` (plan, analysis specification, any
    inspection terms, pre-registration, freeze record). `freeze`, `prepare` and `run` refuse a
    version 2 experiment plan anywhere else (`BENCH_PLAN_LOCATION_INVALID`).
11. Plans name repositories by ID and pinned commit, never by machine path. Paths come from an
    unhashed, unrecorded `--repos` locations file. `validate` always performs the structural
    check. Without the repositories it reports `BENCH_REPOSITORY_UNAVAILABLE` and
    `resolved: false`, and exits `valid`. Every other plan command is `blocked` until the
    repositories resolve.
12. `freeze` checks resolution, clean pinned repositories, a clean Keystone checkout, the analysis
    specification, the pre-registration, a passing exposure verification for the current hash and,
    for a main plan, the named pilot's calibration export. It then writes `freeze.json`. `prepare`
    and `run` refuse an experiment plan with no matching freeze record (`BENCH_PLAN_NOT_FROZEN`).
13. (C1) `benchmark/plans/` receives exactly guarantee 7's exclusion, compared
    case-insensitively:
    - never discovered;
    - invalid as a configured discovery source (`CONFIG_INVALID`);
    - ineligible for START and review-context selection (`START_BENCHMARK_RECORD_INELIGIBLE`).

    The existing results and analysis exclusions and their notices are unchanged.

**Item 5 — Benchmark-repository provenance (P1, ADR-0004 clarification)**
14. The version 2 plan pins the subject and, optionally, the benchmark repository, each by ID and
    40-hex commit. Bundles are referenced by repository and path. The plan hash covers the plan
    bytes, every bundle hash and every plan-directory file. Version 2 run records carry
    `provenance.repositories` with both identities and commits.
15. `prepare`, `run`, `freeze` and `verify-exposure` verify that each repository is at its pinned
    commit and clean under the referenced bundle paths. The workspace is cloned from the subject
    only, and no benchmark-repository path reaches the workspace, the session `PATH` or a staged
    file.

**Item 6 — Condition-blind calibration export (clarification 2, P6)**
16. `calibrate` runs on a `stage: pilot` plan only. Its dataset uses fresh random IDs, whose secret
    is discarded, and keeps only the task, profile, outcomes, resource use and attempt counts. A
    test shows that no retained field joins back to condition identity.
17. It computes discrimination flags, the infrastructure-failure rate, per-cell σ and R_cell, the
    substituted σ for unpiloted target tasks (with source), R and any LOWER PRECISION designation,
    and resource projections over the declared R range. Every parameter comes from the plan's
    analysis specification. It never reports effect direction.
18. `score`, `report` and `analyze` refuse a pilot plan (`BENCH_PILOT_CONDITION_BLIND`) until a
    main plan whose `calibrated_from` names it has been frozen. After that, their output is
    labelled non-evidence.

**Item 7 — Preserved attempts and reruns (clarification 4, P10)**
19. `rerun` accepts only an owner `infrastructure` classification. It moves the whole run
    directory, and any installed record, to `<work>/attempts/<run-id>/<attempt-n>/`; nothing is
    deleted. It then re-prepares the same planned run as attempt n+1.
20. The content-free attempts log in `benchmark/results/<plan-id>/attempts/` records the attempt
    numbers, timestamps, classification, evidence hashes and archive hash. `rerun` is refused
    once any score or analysis exists (`BENCH_RERUN_AFTER_SCORING`), and beyond the plan's
    declared rerun limit (`BENCH_RERUN_EXHAUSTED`).
21. Only the current attempt supplies evidence. Archived attempts are never scored, and run
    records carry `provenance.attempt`.

**Item 8 — Packet inspection (clarification 7; C5)**
22. Before any packet file is written, `score --blind` scans every patch and statement with the
    combined term list. It then applies the single condition-symmetric replacement, and writes
    the inspection log to the work directory. `packet.json` records the terms hash, the
    replacement, the log hash and the hit counts. There is no per-item edit path.
23. The harness's default term list holds generic Keystone identifiers only. Baseline-notes and
    any application-specific terms come from the plan, never from Keystone.
24. (C5) The owner's review before release is a manual gate recorded in trial provenance: `release`
    stores a content-free release attestation, and judgement import refuses a packet with no
    matching release record (`BENCH_PACKET_NOT_RELEASED`).

**Item 9 — Pre-registered final analysis procedure (clarifications 5 and 8, P11)**
25. `analyze` deterministically computes, from records, judgements and the attempts log:
    - the complete planned matrix, with no imputation or reweighting;
    - fixed equal headline weights;
    - the declared effects (`difference`, and `relative-reduction` with its four zero-value
      cases), pooled and per profile;
    - every guardrail, always reported;
    - the classification, by the generic class predicates in the declared order;
    - the per-profile classification;
    - the precision designation.

    It never imputes, reweights or averages verdicts.
26. (C3) Each guardrail's cell statistic per arm is the declared mean or median, and the pooled
    value is the equal-weight mean of the cell statistics over every task × profile cell.
    Required data that fails the declared completeness rule makes the guardrail UNKNOWN. No
    known value is computed from an insufficient remaining subset. Unknown is never "not
    breached".
27. Supporting statistics: whole runs as units, permutation within headline cells, a stratified
    percentile bootstrap, and the declared iterations and seeds, with the share of unbounded
    resamples reported. They never override the classification.
28. Tests with synthetic records cover:
    - each class, each Mixed trigger and each UNCLASSIFIABLE trigger;
    - the four zero-value cases;
    - an undefined cell;
    - an unknown guardrail under Positive and under Negative;
    - a LOWER PRECISION plan;
    - a parameter changed in the specification, detected as a plan change;
    - byte-identical re-runs.

**Item 10 — Hidden-material exposure verification (clarification 6)**
29. `verify-exposure` launches nothing. It performs checks E1–E6 and writes a content-free
    verification record, keyed by plan hash, that lists the owner attestations it cannot
    automate and states the residual risk. A failed check is `invalid`
    (`BENCH_EXPOSURE_CHECK_FAILED`). Running it for the real pilot or main plan is not part of
    this task.

**General**
30. Ordinary protocol command behaviour is unchanged (ADR-0004 guarantee 1), **except for the
    explicitly authorized `benchmark/plans/` exclusion** (criterion 13; ADR-0004 clarification of
    2026-10-07). `keystone validate` and `keystone context status` remain read-only, the `keystone`
    CLI gains no benchmark command or flag, and no protocol module imports `src/benchmark/`.
31. Compatibility: version 2 formats extend Phase 7 only where TASK-0015 requires it.
    - Version 1 plans and profiles remain valid for their existing supported purpose, behave as
      in Phase 7, and produce unchanged version 1 records.
    - The existing smoke material and fixtures are not rewritten, and their Phase 7 tests pass
      unchanged.
    - Any replaced mechanism (for example manual deletion of interrupted runs, which is replaced
      for version 2 experiment plans) is recorded in `docs/PHASE-7.md`.
32. Keystone gains no model-provider SDK, credentials, network code or application-specific
    (personal-trainer) content.
33. (Q4, C4) Before acceptance, one real Codex CLI parser integration verification passes,
    outside the automated suite:
    - it is a version 2 smoke plan over the synthetic Phase 7 smoke subject, with a Codex
      profile;
    - it shows non-null parsed usage and a matching version probe;
    - it is explicitly non-evidence, not a Phase 8 pilot and not a Phase 8 benchmark task, and
      uses neither `trainer-app` nor `trainer-bench`;
    - its records stay in the work directory;
    - its configuration and outcome are recorded in Tests.
34. `docs/PHASE-0-1.md`, `docs/PHASE-3.md`, `docs/PHASE-7.md` and `tests/README.md` are aligned
    with the implemented `benchmark/plans/` exclusion and the new mechanisms.
35. `npm run build`, `npm run check` and `npm test` pass offline on Windows. `validate` passes, and
    `keystone-bench validate` accepts the reference specifications.
36. `benchmark/results/` and `benchmark/analysis/` still contain only their README files, and no
    `benchmark/plans/<plan-id>/` for a real trial is created.

## Scope
- Harness code under `src/benchmark/`, benchmark schemas and reference specifications under
  `benchmark/specification/`, tests and synthetic fixtures under `tests/`.
- The `benchmark/plans/` exclusion in `src/context/benchmark-records.ts` (C1), and its tests.
- The implementation contract note, then `docs/PHASE-7.md` and the directly affected phase
  documents.
- The narrow ADR-0004 clarification and matching SPEC.md sentences for C1 (applied 2026-10-07).
- One real Codex CLI parser integration verification (criterion 33).

## Out of Scope
- Redesigning Phase 8 or reopening any accepted TASK-0014 decision.
- Creating `trainer-app` or `trainer-bench`, or authoring any task, oracle, trap, rubric,
  condition or parity-fact content for them.
- Any real-agent run other than the criterion 33 verification: no Phase 8 smoke run, pilot, main
  trial or judging, and no result or analysis record.
- Writing or freezing a pilot or main-trial plan; choosing the piloted arcs, the final R, the
  budget, the judge models, the trial's tested Codex model or the pinned tool versions (each at
  its TASK-0014 gate). The model used for the criterion 33 verification fixes none of these.
- Any further ADR or SPEC change, unless a genuine architectural decision is found and the owner
  approves it.
- The later steps of the TASK-0014 task sequence (steps 2–5). This task does not create them.

## Dependencies
- TASK-0014 (Phase 8 Cross-model Trial design, accepted 2026-10-07): design notes revision 6.
- TASK-0013 (Phase 7 Benchmark Harness, accepted): the harness being extended.
- ADR-0004, including:
  - its 2026-10-06 isolation clarification;
  - its 2026-10-06 (TASK-0014) clarification on evaluation material outside the measured subject;
  - its 2026-10-07 (TASK-0015) clarification on `benchmark/plans/`.
- No dependency on `trainer-app` or `trainer-bench`. Network access and a real agent are needed
  only for criterion 33.

Internal ordering follows the contract's implementation dependency order:
1. version 2 formats and resolution (items 5 and 4);
2. item 1;
3. item 2;
4. item 7;
5. item 3;
6. item 8;
7. item 10;
8. freezing and the C1 exclusion;
9. the analysis specification and item 6;
10. item 9;
11. documentation and the criterion 33 verification.

## Relevant Files
See the front-matter `files` links.

## Decisions / ADRs
Created on 2026-10-07 at the owner's instruction to begin Phase 8 preparation, as `proposed`.
Creating this task does not authorize implementation (AGENTS.md rule 10). Implementation begins
only after the owner reviews this task and moves it to `active`.

**Inputs fixed by TASK-0014 (not reopened here):** the P1–P13 resolutions; B1 and B2;
clarifications 1–8; the revision 5 rule inputs; the revision 6 classification precedence; and the
deferral of the budget, final R, judge models, Codex model, tool versions and piloted arcs to their
gates.

**Owner decisions of 2026-10-07** (on the questions raised at creation):
- **Q1 — approved.** One task. First a concise implementation-contract note defining the formats,
  commands and mappings for items 1–10, then a stop for owner review before implementation.
- **Q2 — approved.** `benchmark/plans/<plan-id>/` is the canonical plan location. Plans stay
  outside Keystone artifact discovery and START. Structural validation always applies;
  unavailable trial-machine paths produce explicit diagnostics, and plans are not
  machine-specific.
- **Q3 — approved.** A generic harness analysis engine. Experiment-specific margins, guardrails,
  repetitions, seeds and other parameters belong in the frozen plan or specification, and are
  never hard-coded from TASK-0014 into the harness.
- **Q4 — decided.** Offline unit tests use a clearly identified synthetic, unverified Codex output
  fixture based on the documented format. Before TASK-0015 acceptance, one real Codex CLI parser
  integration verification is required. It is not benchmark evidence and must not run a
  benchmark task.
- **Q5 — decided.** No ADR or SPEC change is expected. Implementation stops and raises an
  architectural proposal only if it exposes a genuine architectural decision.
- The existing `START_BENCHMARK_RECORD_INELIGIBLE` notices for `benchmark/results/README.md` and
  `benchmark/analysis/README.md` are acceptable and are not suppressed for this task.
- TASK-0015 moved from `proposed` to `active`. Implementation remains gated on the owner's review
  of the contract note.

**Owner decisions on contract revision 1, 2026-10-07** (contract revision 2 incorporates them):
- **C1 — approved, option (a).** `benchmark/plans/` receives the existing benchmark exclusion
  (ADR-0004 guarantee 7's treatment).
  - The owner authorized a narrow ADR-0004 clarification and the alignment of directly affected
    authority.
  - Criterion 30 now states that ordinary protocol behaviour is unchanged except for this
    exclusion.
  - The ADR change is not broadened.
- **C2 — approved.** `review_verdict` is categorical and never averaged. Quantitative finding
  counts are aggregated where meaningful. Each judge's verdict is preserved and reported, with
  agreement and disagreement.
- **C3 — approved.** Generic, plan-driven median-guardrail pooling and knownness rules. Required
  data failing its pre-registered completeness rule is UNKNOWN; no known guardrail is computed from
  an insufficient remaining subset. All thresholds and experiment values stay in the frozen plan
  or specification.
- **C4 — approved.** The real Codex verification may use the synthetic Phase 7 smoke subject
  through a smoke plan. It is tooling and integration verification only: explicitly non-evidence,
  not a Phase 8 pilot and not a benchmark task. It needs neither `trainer-app` nor
  `trainer-bench`.
- **C5 — approved.** The harness enforces the gates it can observe automatically. The owner's
  inspection and approval before judge-packet release remains a manual gate, recorded in trial
  provenance.
- **Compatibility requirement.** Version 2 formats extend Phase 7 only as TASK-0015 requires, with
  no unnecessary refactoring. Version 1 smoke material stays valid for its existing purpose.
- These decisions did **not** authorize implementing items 1–10 or running the Codex
  verification. Both await the owner's explicit instruction.

**Authority change applied (C1, 2026-10-07):**
- **ADR-0004** (status `accepted`, unchanged): a new section, "Clarification (2026-10-07,
  TASK-0015): experiment plans excluded like results".
  - It gives the root-level `benchmark/plans/` exactly guarantee 7's exclusion, as
    experiment-control material.
  - It states that no other guarantee changes, and that ordinary protocol behaviour is otherwise
    unchanged.
  - TASK-0015 is added to the ADR's `tasks` links.
- **SPEC.md:** the two sentences that list the excluded benchmark directories now include
  `benchmark/plans/`.
- The documents that describe implemented behaviour (`docs/PHASE-0-1.md`, `docs/PHASE-3.md`,
  `docs/PHASE-7.md`, `tests/README.md`) are aligned when the exclusion is implemented
  (criterion 34), so they never describe unimplemented behaviour.

**Implementation authorized, 2026-10-07.** The owner approved contract revision 2 and authorized
implementing items 1–10 and their criteria, in the TASK-0015 build order, against:
- this task;
- contract revision 2;
- TASK-0014 design revision 6;
- ADR-0004 with its TASK-0015 clarification;
- SPEC.md and the Phase 7 contract.

The authorization kept the approved boundaries:
- a generic, plan-driven harness, with no hard-coded Phase 8 values;
- version 1 behaviour and smoke material preserved;
- only the authorized `benchmark/plans/` protocol exclusion;
- no `trainer-app` or `trainer-bench`, no real trial plan, no pilot or main benchmark;
- no further ADR or SPEC change without raising it first;
- no commit or push.

The real Codex check (criterion 33) is deferred until implementation and the offline suite are
complete, and then awaits the owner's go-ahead.

## Implementation Notes
Implementation-contract note (`docs/TASK-0015-phase-8-preparation-contract.md`):
- **Revision 1** defined, for items 1–10, the command and file-format changes and the
  implementation dependency order, and raised contract questions C1–C5.
- **Revision 2** incorporates the owner's C1–C5 decisions and the compatibility requirement. It
  adds:
  - the `release` command for the C5 manual gate;
  - plan-declared completeness rules and classification order;
  - the version 1 compatibility rules.

**Determination:** with revision 2, the implementation contract is fully resolved, and no
implementation-contract question remains open. These remain to be fixed later; they are
operational or experiment inputs, not contract gaps:
- the Codex model, flags and network use for the criterion 33 verification, chosen when it is
  run;
- confirmation or correction of the provisional Codex event mapping by that verification;
- every experiment value, supplied by a trial's plan directory at its TASK-0014 gates.

**Implementation (2026-10-07)**, in the contract's build order. `docs/PHASE-7.md`, "Phase 8
preparation (TASK-0015)", records every mechanism.
1. **Version 2 formats and resolution (items 5 and 4).**
   - Schemas: `plan-v2`, `agent-profile-v2`, `run-record-v2`, `judgements-v2`, `locations`,
     `analysis-spec`, `inspection-terms`, `attempt-classification` and `packet-release`. Version 1
     schemas changed only additively (the `codex-jsonl` parser value; an optional manual
     `tool_version`; new common definitions).
   - `src/benchmark/specs.ts` loads both plan versions. `src/benchmark/repos.ts` checks
     repository pins.
   - `src/benchmark/plans.ts` enforces the canonical-location, frozen-plan and pilot gates.
   - Locations and the `plans` write boundary are in `store.ts`.
2. **Item 1:** the version probe, observed identity and model-mismatch flag (`run.ts`), and
   identity findings (`report.ts`).
3. **Item 2:** the `codex-jsonl` parser (`run.ts`), with the synthetic, unverified fixture under
   `tests/fixtures/bench/usage/`.
4. **Item 7:** `rerun` and the attempts log (`attempts.ts`). Per-run preparation is factored into
   `prepareRun` (`prepare.ts`).
5. **Items 3 and 8:** version 2 judging, the audit sample, inspection and redaction, and `release`
   (`judging.ts`, wired into `score.ts`). The scorecard gains `review_verdict:*`.
6. **Item 10:** `verify-exposure` (`exposure.ts`).
7. **Item 4:** `freeze` (`freeze.ts`), and the C1 exclusion (`src/context/benchmark-records.ts`,
   plus the configuration message).
8. **Items 6 and 9:** `calibrate` (`calibrate.ts`) and `analyze` (`analysis.ts`).
9. **CLI:** the new commands and the `--repos`, `--classification` and `--attestation` flags
   (`cli.ts`).
10. **Documentation (criterion 34):** `docs/PHASE-7.md`, `docs/PHASE-0-1.md`, `docs/PHASE-3.md`,
    `tests/README.md` and `benchmark/specification/README.md`.

**Contract refinements made during implementation.** All stay within contract revision 2 and
ADR-0004 guarantee 9; none is architectural.
- **Calibration measures.** The analysis specification's calibration also declares
  `recurrence_measure` and `resources` (the token and seconds measures, and the main trial's
  control tasks), so no measure name is fixed in the harness (Q3).
- **E1** also fails when a command expands `{profile}` or `{condition}` into a
  benchmark-repository bundle. A condition tool's expanded command sits in a shim on the session
  `PATH`, so it would reveal the benchmark repository's location. The tests' `guided` condition
  (which declares a tool) is therefore placed in the Keystone tree.
- **Verdicts.** Version 2 records no run-level `review_verdict`. Each judge's verdict is
  `review_verdict:<judge>`.
- **The release record** is content-free: it stores the attestation's hash, not its statement.
- **`record`** applies the same canonical and frozen gates as `prepare` and `run`.
- **Record versions.** A run record's schema version must equal its plan's.
- **Neutrality test.** Harness code names the Keystone repository through a single constant,
  `keystoneRepository`. The Phase 7 neutrality test now allows exactly that second `'keystone'`
  literal (a repository name, not a condition).
- **Line endings.** Bundle hashes use working-file bytes, so a checkout with different line-ending
  conversion changes a plan hash. This is recorded as a version 2 limitation.

No real agent was run, no trial repository or real trial plan was created, and no pilot or
benchmark was run.

## Tests
Baseline at activation (2026-10-07, commit `b07606c` plus the uncommitted TASK-0015 task and
contract note):
- `npm test` passed 248 of 248, with no failures, skips or cancellations.
- `validate` passed with 20 artifacts. After `index`, `context status` reported the index current.
- START for TASK-0015 (`active`) was `complete`, with authorization `not-established` and only
  the two accepted `START_BENCHMARK_RECORD_INELIGIBLE` notices.
- `keystone-bench validate` was `valid`.
- `benchmark/results/` and `benchmark/analysis/` contain only their README files.

Verification after contract revision 2 and the C1 authority change (2026-10-07; no code
changed):
- `npm run check` passed. `npm test` passed 248 of 248, with no failures, skips or cancellations.
- `validate` passed with 20 artifacts, including ADR-0004's new `tasks` link to TASK-0015.
  After `index`, `context status` reported the index current.
- START for TASK-0015 was `complete`, with authorization `not-established` and only the two
  accepted `START_BENCHMARK_RECORD_INELIGIBLE` notices.
- `keystone-bench validate` was `valid`.
- `benchmark/results/` and `benchmark/analysis/` contain only their README files, and
  `benchmark/plans/` does not exist.
- Until criterion 13 is implemented, the `benchmark/plans/` exclusion is stated by ADR-0004 and
  SPEC.md but not yet enforced in code. No plans directory exists, so nothing is affected.

Verification after implementing items 1–10 (2026-10-07, offline):
- `npm run build` and `npm run check` passed.
- `npm test` passed 262 of 262, with no failures, skips or cancellations: the 248 earlier tests
  plus 14 in `tests/phase8-prep.test.mjs`.
  - All Phase 7 tests pass. One assertion was updated: the neutrality literal count now allows the
    `keystoneRepository` constant.
- `validate` passed with 20 artifacts. After `index`, `context status` reported the index current.
- START for TASK-0015 was `complete`, with authorization `not-established` and only the two
  accepted `START_BENCHMARK_RECORD_INELIGIBLE` notices.
- `keystone-bench validate` was `valid`.
- `benchmark/results/` and `benchmark/analysis/` contain only their README files, and no
  `benchmark/plans/` directory exists.
- No real agent was run. Criterion 33, the real Codex CLI check, is pending the owner's
  go-ahead.

Verification after adding the dedicated E4 test (2026-10-07, offline, owner instruction):
- The new test, "exposure check E4 fails when the benchmark repository is on the base PATH every
  session inherits", passes. It runs `verify-exposure` with a benchmark-repository directory
  prepended to the inherited PATH, and checks that:
  - only E4 fails, with one finding;
  - the record names no path;
  - `freeze` is refused until the verification passes without that PATH entry.

  This adds test coverage only; no harness code or contract changed.
- `npm run build` and `npm run check` passed. `npm test` passed 263 of 263, with no failures,
  skips or cancellations.
- `validate` passed with 20 artifacts. `index` was unchanged, and `context status` reported the
  index current.
- START for TASK-0015 was `complete`, with authorization `not-established` and only the two
  accepted notices.
- `keystone-bench validate` was `valid`.
- `benchmark/results/` and `benchmark/analysis/` contain only their README files, and no
  `benchmark/plans/` directory exists.
- **Criterion 33 remains pending.** The owner will perform the real Codex CLI check and the
  independent implementation review separately. No agent was launched.

**Criterion 33 — PASSED (real Codex CLI parser integration verification).** Performed by the owner
in a separate Codex CLI session against Codex CLI 0.160.0, and relayed to this session (the full
session output was not provided here). It was integration verification only: never benchmark
evidence, not a Phase 8 pilot or benchmark task, and no `trainer-app` or `trainer-bench`. The
actual JSONL mapping matched the implemented `codex-jsonl` parser:
- input tokens 52,309, output tokens 152, completed turns 1;
- cached-input and reasoning counts were not double-counted;
- the model was correctly kept as null, because the stream reported no model identity.

The provisional mapping is therefore confirmed, and the parser needed no correction.

Verification after remediating review findings 1–9 (2026-10-07, offline; no agent launched):
- `npm run build` and `npm run check` passed.
- `npm test` passed 268 of 268, with no failures, skips or cancellations, including 20 in
  `tests/phase8-prep.test.mjs`.
- Version 1 compatibility: every Phase 7 test passes unchanged, and so does the version 1 test in
  `phase8-prep.test.mjs` (version 1 records, provenance and refusals).
- `validate` passed with 20 artifacts. After `index`, `context status` reported the index current.
- START for TASK-0015 was `complete`, with authorization `not-established` and only the two
  accepted notices.
- `keystone-bench validate` was `valid`.
- `benchmark/results/` and `benchmark/analysis/` contain only their README files. No
  `benchmark/plans/` directory exists, so no real Phase 8 plan or evidence exists.

Verification after remediating re-review blockers R1 and R2 (2026-10-07, offline; no agent
launched, criterion 33 not rerun):
- `npm run build` and `npm run check` passed.
- `npm test` passed 270 of 270, with no failures, skips or cancellations, including 22 in
  `tests/phase8-prep.test.mjs`.
- Version 1 compatibility: every Phase 7 test passes unchanged, and so does the version 1 test.
  Bundle hashes for ordinary filenames are unchanged.
- `validate` passed with 20 artifacts. After `index`, `context status` reported the index current.
- START for TASK-0015 was `complete`, with authorization `not-established` and only the two
  accepted notices.
- `keystone-bench validate` was `valid`.
- `benchmark/results/` and `benchmark/analysis/` contain only their README files. No
  `benchmark/plans/` directory exists, so no real Phase 8 plan or evidence exists. `codex --version` was read once to propose its configuration (`codex-cli 0.160.0`);
  no agent session was started.

## Review Findings
**Independent implementation review (Codex CLI, owner-run, 2026-10-07)**, recorded as relayed by
the owner; the full review text was not provided to this session. It found criterion 33 PASSED
(see Tests), seven blocking findings and two non-blocking findings. All nine were remediated on
2026-10-07 against the accepted contract, with no change to Phase 8 semantics. Each has a
regression test in `tests/phase8-prep.test.mjs`, written alongside its fix.

| # | Finding | Remediation | Regression test |
|---|---|---|---|
| 1 (B) | Diagnostic-only measures could be promoted into comparison | The analysis specification's compared measures (primary, guardrail, calibration, recurrence, resources) must pass the scorecard's comparative-eligibility rule, the same rule as composite weights. It is checked at load (`BENCH_ANALYSIS_MEASURE_INVALID`) and again in `analyze` and `calibrate`. Both stopped reading diagnostic values. | "review finding 1: …" |
| 2 (B) | The plan hash did not cover every plan-directory file | The hash covers every plan-directory file, recursively. The only exclusion is the generated top-level `freeze.json`, which is sealed and verified wherever read; a forged one is never trusted. The freeze record lists every hashed file. | "review finding 2: …" |
| 3 (B) | Main plans could freeze without pilot-calibration provenance | Every main-stage plan needs a `calibrated_from` naming a pilot frozen at that hash, whose calibration export exists for that hash with a determined R (`BENCH_CALIBRATION_MISSING`). | "review finding 3: …" |
| 4 (B) | Exposure verification could pass falsely | E1 checks every actually inherited variable value (allow-listed and passed through), counting matches without recording values. E3 has no length exemption: any non-empty hidden text fails. | "review finding 4: …" |
| 5 (B) | A mutable manifest could override the sealed audit sample | `release` verifies the packet text against the attested hash, and the audit text against the packet's hash and the plan's sampling rule. It seals the items and audit sample in the release record. Import uses only sealed release records and recomputes the sample. | judging test, tamper assertions |
| 6 (B) | A partial rerun could reset attempt numbering | Archived attempts and log entries must agree before any fresh `prepare`, which uses attempt k+1 or refuses (`BENCH_ATTEMPT_HISTORY_INCOMPLETE`). An interrupted `rerun` resumes from the archive when run again. | rerun test: simulated interrupted transition and lost preparation |
| 7 (B) | Exhausted infrastructure failures stayed outcome evidence | New `classify` command records a terminal infrastructure classification once reruns are exhausted (`BENCH_RERUN_AVAILABLE` before then). `analyze` treats terminal runs as missing (`infrastructure_missing`). `calibrate` excludes them from the dataset and counts them as infrastructure failures. | rerun test (analysis); calibrate test (counts) |
| 8 (NB) | Inspection hit counts failed for IDs such as `constructor` | Counts use a `Map`. | judging test (term ID `constructor`) |
| 9 (NB) | `BENCH_USAGE_UNREPORTED` was missing for partial usage | Raised whenever input tokens, output tokens or turns are unknown. | "review finding 9: …" (version 2 smoke plan, synthetic agent) |

**Remediation notes:**
- **`classify` is a new command.** It is the narrowest mechanism that persists a terminal
  classification without changing `rerun`'s accepted refusal (`BENCH_RERUN_EXHAUSTED`).
- **E3 now fails conservatively.** Short hidden material can match staged files by coincidence;
  such a failure is resolved by restructuring the material, never by exemption.
- **Release records now carry blinded IDs and task IDs.** They remain content-free.
- **Tests now calibrate a real pilot.** Because every main plan needs a calibrated pilot, the test
  helpers freeze, run and calibrate a synthetic pilot before freezing a main plan.

**Targeted Codex re-review (owner-run, 2026-10-07)**, recorded as relayed by the owner. It verified
findings 1, 3–5 and 7–9, and raised two remaining blockers, both remediated on 2026-10-07 within the
accepted contract:

| # | Blocker | Remediation | Regression test |
|---|---|---|---|
| R1 | A plan file named `__proto__` was dropped from the filename→hash mapping (plain-object accumulation in the plan-directory hash; same pattern in archive hashing) | Every filename-keyed hash table is now prototype-free (`fileTable()`): plan directory, bundle `directoryHash` and attempt `archiveHash`. Serialization and order are unchanged, so ordinary names hash exactly as before, and version 1 bundle hashes are unchanged. The generated top-level `freeze.json` stays excluded. | "review blocker 1": adding and changing `__proto__` (and a nested `constructor`) changes the plan hash; the freeze record keeps it through the JSON round trip; removing it unfreezes the plan; bundle and archive hashes cover it |
| R2 | `rerun` treated an existing `archive/record.json` as proof of preservation, so it could delete the installed record and report `record_archived: true` | `preserveRecord` removes the installed record only after its exact bytes are verified at the destination. An existing destination is trusted only if it is a regular file with identical bytes. Directories, links and different content fail with `BENCH_ATTEMPT_ARCHIVE_CONFLICT`, keeping the original, logging nothing, and leaving the history incomplete so no attempt number can be bypassed. Recovery after the original's removal accepts only an intact sealed record of this run, plan and attempt. | "review blocker 2": a directory, then different content, at the destination fails safely with the original intact and `prepare` refusing; removing the conflict lets the same command resume and preserve the exact bytes; a tampered copy is refused on recovery |

**Non-blocking future-hardening observation (re-review, not changed):** `analyze` can write an
UNCLASSIFIABLE result while a run's attempt history is incomplete. Because `rerun` and `classify`
refuse once any analysis exists (`BENCH_RERUN_AFTER_SCORING`), that analysis can then block
recovery of the interrupted transition. A future hardening could have `analyze` (and `score`)
refuse while any attempt history is incomplete. This is left unchanged here, as instructed.

**Final: targeted Codex closure review, 2026-10-07. Verdict: VERIFIED — TASK-0015 ready for owner
acceptance.** Recorded as relayed by the owner; the full review text was not provided to this
session.
- Blocker R1: VERIFIED. Blocker R2: VERIFIED.
- Directly related regressions: none.
- Criterion 33: previously PASSED, and remains sufficient.
- No blocking findings remain.
- The analyze/rerun observation above remains open as non-blocking future hardening.

## Outcome
**Accepted on 2026-10-07 by the owner**, after the final targeted Codex closure review (VERIFIED).
Phase 8 preparation (step 1 of the TASK-0014 task sequence) is complete.

**Delivered:**
- Preparation items 1–10: version provenance; the `codex-jsonl` parser; version 2 judging;
  `benchmark/plans/`, repository resolution and `freeze`; benchmark-repository provenance; the
  condition-blind `calibrate` export; preserved attempts (`rerun`, `classify`); packet inspection
  and `release`; the pre-registered `analyze` engine; `verify-exposure`.
- The C1 `benchmark/plans/` protocol exclusion (ADR-0004 clarification of 2026-10-07).
- All acceptance criteria, including criterion 33 (the real Codex CLI parser check, owner-run).
- Independent review: the initial review's nine findings and the re-review's two blockers are
  remediated and verified.

**Final checks:** `npm test` passed 270 of 270 (see Tests).

**Authority:** `docs/PHASE-7.md`, "Phase 8 preparation (TASK-0015)", records the mechanisms. The
contract note (`docs/TASK-0015-phase-8-preparation-contract.md`) is history.

**Open, non-blocking:** an `analyze` result written while an attempt history is incomplete can
block `rerun` recovery (see Review Findings).

**Not started, and not authorized by this task:**
- the later TASK-0014 sequence steps (authoring `trainer-app` and `trainer-bench`, smoke runs,
  the pilot plan and pilot, calibration, the main plan, the trial, judging and analysis);
- no Phase 8 trial plan was created or frozen;
- `benchmark/results/` and `benchmark/analysis/` contain only their README files, and no
  `benchmark/plans/` directory exists.
