---
context_type: task
schema_version: 1
id: TASK-0014
title: Design Phase 8 Cross-model Trial
status: accepted
priority: high
depends_on: [TASK-0013]
adrs: [ADR-0001, ADR-0002, ADR-0003, ADR-0004]
files:
  - docs/TASK-0014-phase-8-cross-model-trial-design.md
  - adr/ADR-0004-benchmark-harness-boundaries.md
  - SPEC.md
  - ARCHITECTURE-DECISIONS.md
  - PROJECT.md
  - docs/REPO-SEPARATION.md
  - SETUP.md
  - docs/TASK-0012-phase-7-benchmark-harness-design.md
  - docs/PHASE-7.md
  - benchmark/specification/scorecard.json
  - benchmark/specification/conditions/baseline/condition.json
  - benchmark/specification/conditions/keystone/condition.json
created: 2026-10-06
completed: 2026-10-07
---
# TASK-0014 — Design Phase 8 Cross-model Trial

## Objective
Design the Phase 8 Cross-model Trial: a pre-registered experiment, run with the accepted Phase 7
harness, that determines whether Keystone materially improves AI-assisted software development
compared with a neutral baseline, without structurally privileging Keystone (ADR-0004 guarantee
4). Design only.

## Acceptance Criteria
- The design records what is already decided for Phase 8, separately from owner decisions. The
  sources are SPEC.md, D01–D26, PROJECT.md, `docs/REPO-SEPARATION.md`, ADR-0001 to ADR-0004,
  TASK-0012, TASK-0013 and `docs/PHASE-7.md`.
- Before any benchmark run, the design resolves:
  - Repo B's purpose, structure and pinned baseline;
  - task selection and difficulty;
  - the baseline and Keystone conditions;
  - the models and tools to test;
  - repetitions and seeded ordering;
  - single-session versus multi-session tasks;
  - context and budget parity;
  - allowed condition-specific setup;
  - deterministic, reported and judged measures;
  - the blind judging procedure;
  - scorecard interpretation;
  - treatment of Keystone-specific diagnostics;
  - failure and incomplete-run handling;
  - experiment-plan freezing and provenance;
  - criteria for a meaningful positive, neutral or negative result;
  - the claims the experiment can and cannot support.
- Each owner decision is recorded with the question, realistic options, trade-offs, a
  recommendation and the owner's resolution.
- ADR-0004 neutrality is preserved. No option that privileges Keystone is recommended as the
  primary comparison.
- No ADR or SPEC change is made unless the design identifies a genuine architectural decision
  and the owner approves it.
- Implementation prerequisites and a task sequence for preparing and running the trial are
  proposed, but not created.

## Scope
Phase 8 experiment design. Output: non-authoritative design notes at
`docs/TASK-0014-phase-8-cross-model-trial-design.md`.

## Out of Scope
- Creating Repo B (or its companion repositories), or authoring any of its task content.
- Writing or freezing an experiment plan, running pilots, smoke runs or benchmarks, and producing
  results.
- Implementing harness extensions or any Phase 8 code.
- Any application-specific (personal-trainer) knowledge in Keystone.
- ADR or SPEC changes, unless owner-approved under the conditions above.

## Dependencies
TASK-0013 (Phase 7 Benchmark Harness, accepted), ADR-0004 (with its 2026-10-06 clarification),
and the TASK-0012 design.

## Relevant Files
See the front-matter `files` links.

## Decisions / ADRs
Created on 2026-10-06 at the owner's instruction to begin Phase 8 design only, as `proposed`. On
2026-10-06 the owner authorized the design work, and moved TASK-0014 from `proposed` to `active`.
Neither this task nor its design notes authorizes creating `trainer-app` or `trainer-bench`,
running a pilot or benchmarks, implementing Phase 8 or its preparation work, or creating the
preparation task (AGENTS.md rule 10).

**Final P1–P13 state** (owner decisions of 2026-10-06; design notes revisions 2 and 3):

| Decision | Final resolution |
|---|---|
| P1 Task-content location | Two separately pinned repositories: the subject `trainer-app` and the benchmark (control) repository `trainer-bench`. They are separate reproducible inputs, not collectively "Repo B". **ADR-0004 clarification adopted and applied** (see below). |
| P2 Knowledge parity | Information parity. |
| P3 Conditions | An active, matched baseline and Keystone. Ablation deferred. |
| P4 Tools and models | Claude Code with Sonnet, and the Codex CLI. Exact tool and model versions are pinned at plan freezing. Gemini deferred. |
| P5 Tasks | 4 multi-session arcs and 2 single-session controls. |
| P6 Repetitions | A 16-run non-evidence pilot. The 120-run main trial is not authorized; 5 repetitions (120 runs) is the planning assumption. The condition-blind, effect-direction-free calibration rule has floor 0.10, ceiling 0.90, an infrastructure threshold above 10%, SE ≤ 0.075, R from 5 to 10, and at most one re-pilot. The **main-trial budget is deferred**: the owner approves it from the pilot's condition-blind resource-consumption summary, before the main plan is frozen. |
| P7 Budget parity | Identical timeouts and profile-level caps. No token equalization. |
| P8 Measures | Co-primary: final test pass rate and planted-mistake recurrence. Guardrails: existing-test regression, tokens and time. No composite score. |
| P9 Judging | Blinded judges from both tested vendors, plus an owner blind audit of 20%. Judge and model identity and provenance are recorded. Equivalent condition-stripped evidence for every judge. Condition guesses measure blinding only. Judge models are named at plan freezing. |
| P10 Failures | Intention-to-treat for agent failures. At most two logged infrastructure reruns, classified before scores are seen. Infrastructure-failed attempts are preserved in provenance. No imputation. |
| P11 Result criteria | Margins of +0.15 absolute Δpass and 30% relative recurrence reduction. Guardrails: regression no more than 0.05 lower, tokens at most +100%, time at most +50%, all always reported. Headlines are the mean task-and-tool Δpass and the pooled relative recurrence change, with Claude Code and Codex results always reported alongside. A tool contradiction on a primary outcome classifies the result as **mixed**, whatever the pooled headline. The result is classified in the order Mixed → UNCLASSIFIABLE → Positive → Negative → Neutral (precedence set by the owner on 2026-10-07): Mixed only from defined primary evidence and never overridden by missing guardrail data; UNCLASSIFIABLE only when missing evidence prevents the otherwise applicable classification. Statistics are supporting only. |
| P12 Freezing | The pilot is non-evidence. Post-pilot adjustments produce a new frozen plan and hash before the first main-trial run. No main-trial change once evidence collection begins. |
| P13 Claims | Scoped to this subject, these tasks, tools and versions. |

**Architectural change adopted and applied (P1, 2026-10-06).** The owner adopted the revision 2
drafts:
- **ADR-0004** (status `accepted`, unchanged): a new section, "Clarification (2026-10-06,
  TASK-0014): evaluation material outside the measured subject":
  - hidden evaluation material may reside in a separately pinned benchmark repository when
    including it in the subject would expose evaluation evidence;
  - both repository identities and pinned commits form part of run provenance;
  - workspaces are cloned from the subject only, and benchmark material reaches them only through
    the harness;
  - no other guarantee changes;
  - a terminology note maps the earlier "Repo B" wording.

  TASK-0014 is added to the ADR's `tasks` links.
- **SPEC.md:** the matching "Benchmark harness" sentence.
- **`docs/REPO-SEPARATION.md`:** Repo A (Keystone), `trainer-app` and `trainer-bench`.
- **SETUP.md:** its repository-separation section is aligned to the same three-part wording, so no
  authority or setup guide still describes a single "Repo B".

**Independent review round 1: owner decisions of 2026-10-06** (design notes revision 4):
- **B1 — precision and calibration.**
  - SE ≤ 0.075 is a target, not a validity threshold.
  - The required R is computed for every arc × tool cell from condition-blind pooled pilot
    variance. The main-trial R is the maximum across cells, within 5–10.
  - If any cell needs R > 10, then R = 10 and the main trial is designated **LOWER PRECISION**
    before any condition effect is unblinded, with the missing cells and their expected precision
    recorded. Lower precision is explicit in the frozen plan and in the interpretation, and does
    not invalidate the trial.
  - The budget never silently reduces the calibrated R. If it cannot support R, the plan is not
    frozen until the owner explicitly approves the required budget, or a lower-R, lower-precision
    plan.
  - R is never below 5.
- **B2 — incomplete data.**
  - The complete planned arc × tool × condition × repetition matrix is the estimand. Agent
    failures are outcomes.
  - Infrastructure failures that exhaust their reruns stay missing, with no imputation, no
    removal of missing cells and no reweighting. The fixed task × tool weighting is kept.
  - An undefined required primary cell statistic, or a claimed Positive or Negative that cannot
    establish its guardrail condition, makes the result **UNCLASSIFIABLE**. Unknown guardrail
    status is never "not breached".
  - Available descriptive and per-tool results are always reported. UNCLASSIFIABLE is distinct
    from NEUTRAL.
- **Clarifications 1–8, incorporated:**
  1. Recurrence rate = failed opportunities ÷ opportunities; whole runs are the units; oracle
     weighting is by command.
  2. A non-joinable condition-blind calibration export.
  3. Separately preserved dual-vendor judgements and the seeded 20% owner audit.
  4. A preserved-attempt and rerun procedure.
  5. A pre-registered final analysis procedure.
  6. Hidden-material exposure verification.
  7. Packet inspection for residual identifiers, with guess participation and accuracy reported.
  8. The pre-registered resampling structure.

  The baseline, tools, task structure, margins and P13 claim scope are unchanged.

**Rule inputs exposed by B1 and B2: owner decisions of 2026-10-07** (design notes revision 5):
1. **σ for unpiloted cells.** Each unpiloted arc × tool cell uses the largest observed pilot σ
   among the piloted arcs for the same tool, with every substitution and its source recorded. The
   pilot is not expanded, and worst-case variance is not assumed. The single main-trial R is
   selected by the accepted rule, across observed and substituted σ.
2. **Minimum observations.** Each condition arm of an arc × tool cell needs at least ⌈R/2⌉ valid
   observed runs after permitted reruns are exhausted.
   - If either arm falls short, the cell's required primary statistic is undefined, and the
     headline is UNCLASSIFIABLE.
   - Otherwise each arm uses its available valid outcomes.
   - Every defined cell keeps its fixed equal weight, whatever its observation counts.
3. **Negative and guardrails (confirmed).** Negative does not require guardrail availability;
   unknown guardrails in a Negative result are reported explicitly as unknown. Unknown required
   guardrails prevent Positive. The asymmetry is intentional: an apparent benefit must not
   conceal unacceptable costs, while missing guardrail data cannot erase observed primary harm.
4. **Zero-value recurrence (confirmed).**

   | Case | Result |
   |---|---|
   | B = 0 and K = 0 | change 0 |
   | B = 0 and K > 0 | deterioration margin met |
   | B > 0 and K = 0 | 100% reduction; improvement margin met |
   | otherwise | the pre-registered relative change |

   No undefined zero-denominator interpretation remains.

**Deferred by the owner to defined decision points** (not design gaps):
- the main-trial budget (after the pilot's resource summary);
- the final repetitions (calibration);
- the exact judge models, the tested Codex model, and the pinned tool versions (plan freezing);
- the 2 piloted arcs (pilot plan freezing).

## Implementation Notes
Design notes revision 6 (`docs/TASK-0014-phase-8-cross-model-trial-design.md`) is the design
record. Revision 6 changes only the classification precedence (owner, 2026-10-07). Revision 3 established the base design. Revision 5 fixes the four rule inputs (unpiloted
σ, minimum observations, Negative guardrail asymmetry, zero-value recurrence). Revision 4 added the
independent-review resolutions:
- the per-cell R rule with the LOWER PRECISION designation;
- the complete-matrix estimand with the UNCLASSIFIABLE class;
- the non-joinable calibration export;
- dual judgements and the owner audit, with packet inspection;
- preserved attempts;
- the hidden-material check;
- the pre-registered analysis and resampling structure;
- preparation items expanded to 10.

The design record contains:
- the owner resolutions;
- the resulting design around `trainer-app` and `trainer-bench`;
- the fixed P6 calibration rule, with the condition-blind resource-consumption summary and the
  owner's budget approval step;
- the fixed P11 decision rule: guardrails, per-tool reporting, the tool-contradiction rule, and the
  ordered classification;
- the freezing procedure;
- the applied clarification;
- preparation items 1–10 (later work, not TASK-0014);
- the proposed task sequence (not created);
- design-review readiness.

**Determination (revision 5):** no genuine design issue remains. Apart from items deliberately
deferred to their predefined gates, every Phase 8 design input is resolved:
- the main-trial budget (after the pilot summary);
- the final R and any LOWER PRECISION designation (calibration);
- the judge models, the Codex model and the tool versions (plan freezing);
- the piloted arcs (pilot plan freezing).

TASK-0014 passed its design-review gate, and was accepted by the owner on 2026-10-07 (see
Outcome).

Changes made by this task: the design notes; ADR-0004 (clarification section and `tasks` link);
the SPEC.md sentence; `docs/REPO-SEPARATION.md`; and SETUP.md (alignment). No source code, test,
schema or template was changed. Neither repository was created, and no smoke run, pilot or
benchmark was run.

## Tests
Design task: no implementation tests apply. Baseline at task creation (2026-10-06, commit
`ddf8b43`, Phase 7 accepted):
- `npm test` passed 248 of 248.
- `validate` passed with 19 artifacts. After `index`, `context status` reported the index
  current.
- START for TASK-0014 was `complete` with no diagnostics:
  - ADR-0001 to ADR-0004 bind at Tier 1;
  - TASK-0013 and the earlier tasks are supporting material;
  - authorization is `not-established`.
- `keystone-bench validate` was `valid`.
- `benchmark/results/` and `benchmark/analysis/` contain only their README files.

Verification after revision 3 and the P1 authority changes, on 2026-10-06:
- `npm run build` and `npm run check` passed. `npm test` passed 248 of 248, with no failures,
  skips or cancellations; no code changed.
- `validate` passed with 19 artifacts, including ADR-0004's new `tasks` link to TASK-0014. After
  `index`, `context status` reported the index current.
- START, compiled for inspection only:
  - TASK-0014 (`active`) was `complete` with no diagnostics, ADR-0004 binding at Tier 1, and
    authorization `not-established`;
  - TASK-0013 was `complete` with no diagnostics;
  - TASK-0012 was `complete` with its two expected `START_BENCHMARK_RECORD_INELIGIBLE` notices.
- `keystone-bench validate` was `valid`.
- No "Repo B" wording remains in SPEC.md, PROJECT.md, `docs/REPO-SEPARATION.md`, SETUP.md or
  README.md. ADR-0004's historical mentions are mapped by its terminology note.
- `benchmark/results/` and `benchmark/analysis/` contain only their README files.

## Review Findings
**Independent review round 1, 2026-10-06** (of design notes revision 3). Recorded as relayed by
the owner; the full review text was not provided to this session. Two blocking findings and eight
procedural clarifications were raised:
- **B1 — precision and calibration:** the SE target versus R bounds and the budget. **Resolved in
  revision 4** by the owner decision above.
- **B2 — incomplete data:** the estimand, missing data and classification. **Resolved in revision
  4** by the owner decision above, including the UNCLASSIFIABLE class.
- **Clarifications 1–8:** incorporated in revision 4 (design sections and preparation items 3 and
  6–10).

The resolutions exposed four rule inputs. The owner fixed them on 2026-10-07 (revision 5; see
Decisions / ADRs).

**Classification precedence, 2026-10-07.** The sole remaining review blocker was resolved in
revision 6. The owner set the precedence to Mixed → UNCLASSIFIABLE → Positive → Negative →
Neutral:
- Mixed is established only from defined primary evidence, and is never overridden by missing
  guardrail data;
- UNCLASSIFIABLE applies only when missing required evidence prevents the otherwise applicable
  classification.

A stale "preparation items 1–6" reference was corrected to 1–10.

**Final: independent review, 2026-10-07. Verdict: VERIFIED — TASK-0014 design ready for owner
acceptance.** Recorded as relayed by the owner; the full review text was not provided to this
session. No blocking findings remain.

## Outcome
Accepted on 2026-10-07 by the owner, after final independent verification (VERIFIED). The Phase 8
Cross-model Trial design is complete.

**The authoritative Phase 8 design basis:**
- design notes revision 6 (`docs/TASK-0014-phase-8-cross-model-trial-design.md`), the accepted
  design record;
- ADR-0004, including its 2026-10-06 isolation clarification and its 2026-10-06 (TASK-0014)
  clarification on evaluation material outside the measured subject;
- the matching SPEC.md "Benchmark harness" sentence and `docs/REPO-SEPARATION.md`;
- SPEC.md, D01–D26 and the accepted ADRs, which remain the higher authority.

**Deferred to predefined later gates** (not design gaps):
- the main-trial budget (after the pilot's condition-blind resource summary);
- the final R and any LOWER PRECISION designation (calibration);
- the judge models, the tested Codex model and the pinned tool versions (plan freezing);
- the 2 piloted arcs (pilot plan freezing).

**Not started, and not authorized by this task:**
- Phase 8 preparation work (items 1–10), and no preparation task has been created;
- `trainer-app` and `trainer-bench`;
- any smoke run, pilot or benchmark, experiment plan or result. `benchmark/results/` and
  `benchmark/analysis/` contain only their README files.
