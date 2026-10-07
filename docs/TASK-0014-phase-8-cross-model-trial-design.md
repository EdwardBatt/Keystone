# TASK-0014 — Phase 8 Cross-model Trial design notes

**NON-AUTHORITATIVE DESIGN RECORD — revision 6, accepted with TASK-0014 on 2026-10-07.**
It authorizes
nothing: not creating `trainer-app` or `trainer-bench`, not running a pilot or benchmarks, and not
implementing Phase 8. The authority is:
- SPEC.md ("Benchmark harness", Phases 7 and 8);
- D01–D26, particularly D15, D23, D24 and D25;
- PROJECT.md and `docs/REPO-SEPARATION.md`;
- ADR-0001 to ADR-0003;
- ADR-0004, with its 2026-10-06 isolation clarification;
- the accepted TASK-0012 design (revision 3) and TASK-0013 implementation;
- `docs/PHASE-7.md`.

Revision 3 records the owner's final decisions of 2026-10-06:
- **P1:** the clarification drafts were adopted and applied to ADR-0004, SPEC.md and
  `docs/REPO-SEPARATION.md` (with SETUP.md aligned).
- **P11:** the guardrail thresholds and aggregation were set, and a rule added so that pooling
  never hides a contradiction between tools.
- **P6:** the calibration parameters were set. The main-trial budget is deferred until the pilot's
  condition-blind resource-consumption summary.

Revision 4 resolves the independent review's two blockers (B1 precision and calibration; B2
incomplete data) with the owner's decisions, and incorporates the review's eight procedural
clarifications. Revision 5 (2026-10-07) fixes the four rule inputs that revision 4 exposed. No
design input remains unresolved, apart from items deliberately deferred to their predefined later
gates (see "Design-review readiness").

## Owner resolution (2026-10-06)

| Decision | Resolution |
|---|---|
| P1 Task-content location | **Approved with clarification; drafts A–C adopted and applied (revision 3).** Two separately pinned repositories: the subject repository `trainer-app` and the benchmark (control) repository `trainer-bench`. They are separate reproducible inputs and are **not** collectively "Repo B". Both repository identities and pinned commits form part of run provenance. The workspace is cloned from the subject only, and benchmark material reaches it only through the harness. |
| P2 Knowledge parity | **Approved:** information parity. |
| P3 Conditions | **Approved:** an active, matched baseline and Keystone; two conditions; ablation deferred. |
| P4 Tools and models | **Approved:** Claude Code with Sonnet, and the Codex CLI, with **exact tool and model versions pinned**. Gemini deferred. |
| P5 Tasks | **Approved:** 4 multi-session arcs and 2 single-session controls. |
| P6 Repetitions | **Modified; parameters set (revision 3).** A 16-run **non-evidence pilot** is approved in the design. A fixed 120-run main trial is **not** yet authorized; 5 repetitions (120 runs) remain the planning assumption. The pre-registered calibration rule uses pilot variance, cost, task discrimination and infrastructure reliability, and never effect direction or favourability. Its parameters: floor 0.10; ceiling 0.90; infrastructure threshold >10%; SE ≤ 0.075; repetitions 5–10; at most one re-pilot. The **main-trial budget is not set**: the pilot produces a condition-blind resource-consumption summary, and the owner approves the budget from it before the main plan is frozen. |
| P7 Budget parity | **Approved** as recommended. |
| P8 Measures | **Approved.** Final test pass rate and planted-mistake recurrence are **co-primary**. Existing-test regression, tokens and time are guardrails. No composite score. |
| P9 Judging | **Approved with tightening.** Blinded judges from both tested model vendors, plus an owner blind audit of 20%. Judge and model identity and provenance are recorded. Every judge receives equivalent condition-stripped evidence. Condition guessing measures blinding effectiveness only, and is never an outcome measure. No ADR change. |
| P10 Failures | **Approved,** with an addition: infrastructure-failed attempts are preserved in provenance even when they are eligible for rerun. |
| P11 Result criteria | **Modified; finalized (revision 3).** Pre-registered practical-effect margins: +0.15 absolute final test pass rate; 30% relative reduction in planted-mistake recurrence. Guardrails: regression pass rate no more than 0.05 lower, tokens at most +100%, time at most +50%; every guardrail is always reported. The headlines are the mean task-and-tool Δpass and the pooled relative recurrence change. Claude Code and Codex results are always reported alongside. A meaningful contradiction between tools on a primary outcome makes the overall result **mixed**, whatever the pooled headline. The classification is positive, negative, neutral or mixed. Statistics support interpretation and never replace the rules. |
| P12 Freezing | **Approved.** The pilot is explicitly non-evidence. After the pilot, any permitted adjustment produces a new frozen plan and hash before the first main-trial run. No main-trial plan change once evidence collection begins. |
| P13 Claims | **Approved** as recommended. |
| Later harness additions | **Retained** as preparation work after design acceptance, not TASK-0014 implementation: exact agent and tool version provenance; a Codex CLI usage parser; an optional condition-guess judgement field; a canonical experiment-plan location. P1 adds benchmark-repository provenance, and P6 adds the condition-blind calibration and resource summary (see "Preparation work"). |
| Review B1 (revision 4) | **Owner decision:** SE ≤ 0.075 is a target. R is the maximum required R across arc × tool cells, within 5–10. If any cell needs R > 10, then R = 10 and the trial is designated LOWER PRECISION before unblinding. The budget never silently reduces R; if it is insufficient, the plan is not frozen until the owner approves the budget or a lower-R, lower-precision plan. R ≥ 5. |
| Review B2 (revision 4) | **Owner decision:** the complete planned matrix is the estimand. No imputation, no reweighting, fixed task × tool weights. UNCLASSIFIABLE when a required primary cell statistic is undefined, or when a claimed Positive cannot establish its guardrail condition. Unknown guardrails are never "not breached". Available results are always reported. |
| Review clarifications 1–8 (revision 4) | Incorporated: recurrence opportunities and oracle-command weighting; a non-joinable condition-blind calibration export; preserved dual-vendor judgements and the seeded owner audit; preserved attempts; a pre-registered analysis procedure; hidden-material exposure verification; packet inspection, with participation and accuracy reporting; the resampling structure. |
| Deferred to plan freezing | The exact judge models, the tested Codex model, and the pinned tool versions (owner, 2026-10-06). |

## Objective

Determine whether Keystone materially improves AI-assisted software development compared with a
neutral baseline, measured with the Phase 7 harness under conditions that do not structurally
privilege Keystone (ADR-0004 guarantee 4).

## What is already decided

| Topic | Decided | Source |
|---|---|---|
| Harness vs experiment | Phase 7 is reusable infrastructure. Phase 8 supplies the subject, task content, conditions, profiles and parameters through a plan fixed before its runs begin. | ADR-0004 g8; TASK-0012 B7 |
| Subject | A separate personal-trainer application. Keystone holds none of its implementation knowledge. | `docs/REPO-SEPARATION.md`; PROJECT.md |
| Isolation | A fresh local clone per run. Harness operations never knowingly write into protected repositories. Agent sessions are not sandboxed. | D23; ADR-0004 g3 and its clarification |
| Neutrality | Identical tasks, oracles, profiles, session structure, limits, instrumentation and scoring for every condition. Condition-specific measures are diagnostics only. Judging is blind and condition-neutral. | ADR-0004 g4 |
| Measures | Labelled `deterministic`, `reported` or `judged`, in a balanced scorecard. A composite comes only from plan-declared weights (none, per P8). | D24; ADR-0004 g6 |
| Trial mechanics | Repetitions, seeded ordering, multi-session tasks, fix sessions and blinded judged import. | TASK-0012 B6; `docs/PHASE-7.md` |
| Results | Durable, content-free, non-authoritative records in `benchmark/results/`. | ADR-0004 g7 |
| Smoke runs and pilots | Smoke runs are integration verification only. The pilot is non-evidence (P12). | ADR-0004 g8; P12 |

Facts established by inspection (2026-10-06):
- Neither repository exists yet. No Phase 8 plan, result or analysis exists.
- Installed tools: Claude Code (2.1.291, authenticated and smoke-tested through the harness), the
  Codex CLI and the Gemini CLI. Their presence was checked only.
- The TASK-0013 smoke run (one trivial edit, one session) used about 71k input tokens, mostly cache.

## Resulting Phase 8 design

### Inputs: two separately pinned repositories (P1)

- **`trainer-app` — the subject.** The personal-trainer application at a pinned baseline commit.
  It is the only repository a run's workspace is cloned from. Its baseline contains plain project
  documentation carrying the parity facts (P2). It contains no task statement, oracle, trap
  definition, rubric or condition.
- **`trainer-bench` — the benchmark (control) repository.** It holds the hidden task and
  evaluation material, all application-specific and none of it in Keystone:
  - task bundles: statements, session prompts, fix prompts, oracles and seeded-trap
    definitions;
  - the experiment conditions (`baseline-active` and `keystone`, including the Keystone
    artifacts encoding the parity facts);
  - the agent profiles;
  - the judging rubric.

  It is pinned by its own commit.
- **Provenance.** Both pinned commits are part of the plan and of every run's provenance. Bundle
  content hashes already make the plan hash immutable. Under the adopted ADR-0004 clarification,
  both repository identities and commits are recorded (preparation item 5).
- **Keystone** holds only application-free material: the plan file (paths and parameters), the
  pre-registration record, results (content-free) and generated analysis.

### Conditions (P2, P3)

| | `baseline-active` | `keystone` |
|---|---|---|
| Starting knowledge | Plain project documentation in the `trainer-app` baseline | The same documentation, plus Keystone artifacts encoding the same facts (verified by the owner for parity) |
| Setup | None | `keystone init`, staged Keystone artifacts, the `keystone` tool on `PATH` |
| Instructions | Matched length and intent: read the project documentation, follow its constraints, and record durable decisions and pitfalls in Markdown for future sessions | Matched: the same intent, using Keystone (`keystone start`, CLOSE, learnings and traps) |
| Everything else | Identical, enforced and recorded by the harness | Identical |

### Agents (P4, P7)

- **Profiles:**
  - Claude Code with Sonnet;
  - the Codex CLI with its selected model.

  Exact tool versions and model identifiers are pinned and declared as trusted identities, and
  auto-update is disabled for the trial window.
- **Limits:** non-interactive, file-edit permission, identical tool permissions, identical
  profile-level caps and identical timeouts. Tokens are not equalized.
- Each profile passes a smoke run before the pilot. Smoke runs are never evidence.

### Tasks (P5)

- **4 multi-session arcs** of 3–4 sessions. Later sessions depend on earlier decisions,
  constraints or documented pitfalls, and each arc carries at least one seeded trap and one
  constraint-respecting requirement.
- **2 single-session controls**, which measure overhead.
- At most 2 fix sessions per task.
- Task content is authored generically in kind, and lives only in `trainer-bench`.

### Measures (P8)

- **Co-primary:**
  - final test pass rate (`task_oracle_pass_rate` at the final check, weighted by oracle
    command; see P11);
  - planted-mistake recurrence (`trap_recurrences` per run; descriptive rate = failed
    opportunities ÷ opportunities; see P6 and P11).
- **Guardrails:**
  - existing-test regression (`regression_oracle_pass_rate`);
  - tokens (`total_tokens`, reported);
  - time (`session_seconds`).
- **Secondary:**
  - rework and failed sessions;
  - judged review outcomes;
  - turns and tool calls (reported).
- **Condition-specific diagnostics:** Keystone envelope tokens and omissions, Keystone
  validation diagnostics, and setup time. These are explanatory only: never compared, never
  weighted.
- No composite score.

### Judging (P9)

- **Judges:**
  - a blinded judge model from each tested vendor (Anthropic and OpenAI), with exact model
    identity and version recorded;
  - the owner, blind-auditing a 20% sample.
- **Separately preserved judgements** (clarification 3). Every run receives **one judgement per
  vendor judge**. They are stored and imported separately, keyed by blinded run and judge
  identity, never merged into or replaced by one another.
  - The owner audit adds a third, separate judgement for each sampled run.
  - The current harness import, which accepts one judgement per run and refuses a second, is
    **not** sufficient. Preparation item 3 extends it.
- **Owner audit sample.** Drawn by a seeded rule fixed in the pre-registration, over blinded IDs:
  for example, the 20% of runs with the lowest SHA-256 of the pre-registered seed and the blinded
  ID, rounded up and stratified by task. The sample is drawn before any judgement is seen.
- **Analysis of judged measures** (secondary). The run-level judged value is the mean of the two
  vendor judgements. Reported:
  - inter-vendor agreement;
  - agreement between the vendor judgements and the owner audit;
  - each vendor's judgements separately, to expose same-vendor bias.
- **Equivalent evidence.** Every judge receives the same condition-stripped packet: the task
  statement and the application-code and test patch, with `judging.exclude` removing every
  knowledge-artifact path symmetrically (Keystone artifacts and the baseline's notes alike).
- **Packet inspection** (clarification 7). Path exclusion is not enough. Before any judge sees a
  packet, every patch is inspected for **residual condition identifiers**: Keystone names,
  commands, artifact IDs (for example `TASK-`, `ADR-`, `LRN-`, `TRAP-`), `.context`, `AGENTS.md`
  references, and baseline-notes references, in application code, comments, tests and other
  evidence.
  - The inspection is an automated scan with a pre-registered term list, followed by owner review
    of the hits.
  - A hit is handled by a pre-registered, condition-symmetric redaction (the same rule for both
    conditions), and is logged. It is never hand-edited case by case.
  - The inspection log is part of trial provenance.
- **Rubric and prompt:** a fixed rubric (in `trainer-bench`, pinned) and a fixed judge prompt.
- **Provenance:** each judgement's attestation records the judge identity (model and version, or
  "owner"), the rubric commit, the prompt hash and the date.
- **Blinding check:** each judgement may record the judge's condition guess. **Both** guess
  participation (the share of judgements with a guess) and guess accuracy are reported, per judge.
  They measure blinding effectiveness only, and are never an outcome or decision input.
- **Status:** judged measures are secondary.

### Failure handling (P10)

- Agent outcomes count in every condition (intention-to-treat).
- **Infrastructure failures** (harness error, provider outage or rate limit, machine fault) may be
  rerun at most twice per run. Each is classified by the owner from the tool's error output
  **before any scores are seen**.
- **Preserved attempts and reruns** (clarification 4). No rerun may replace or erase a prior
  attempt.
  1. The failed attempt's whole run directory (workspace, harness state, snapshot repository,
     prompts, logs) is **moved**, not deleted, to an attempts archive outside the measured
     workspace: `<work>/attempts/<run-id>/<attempt-n>/`.
  2. Any partial record is preserved with it.
  3. The trial's provenance log records the attempt number, timestamps, the owner's classification
     and its evidence, and the archive location's content hash.
  4. The rerun is a fresh preparation of the same planned run, recorded as attempt n+1.
  5. Exactly one attempt per planned run, the final allowed one, supplies the evidence record.
     Earlier attempts are never evidence, but remain auditable.

  Today the harness requires deleting an interrupted run directory before re-preparing. That
  procedure is **not** acceptable for the trial; preparation item 7 replaces it.
- A condition setup failure stops the trial for a fix under a new plan ID.
- Runs still missing after their allowed reruns stay missing (P11 estimand rules).

### Hidden-material exposure check (clarification 6)

Within the accepted boundary (agent sessions are not sandboxed, ADR-0004 clarification), the
preparation must **verify** before the pilot and again at main-plan freezing that nothing the
harness or profiles give the agent exposes `trainer-bench` hidden material or future-session
prompts:
- **Profile commands, arguments and passed-through environment variables:** no `trainer-bench`
  path, oracle, rubric or later prompt is named.
- **Session prompts:** only the current session's prompt is written before its launch. The harness
  writes each automated session's prompt just before that session. The manual-profile mode, which
  writes every prompt in advance, is not used in the trial.
- **Condition-staged files:** contain parity facts only, never task statements of later sessions,
  oracles or rubrics.
- **Accessible paths:**
  - `trainer-bench` is checked out outside the measured workspace and outside the work
    directory;
  - it is never placed on the session `PATH`, and is never referenced by instructions or prompts;
  - the workspace is cloned from `trainer-app` only.
- **The verification is recorded.** Filesystem-permission isolation is **not** claimed; an agent
  that searches the disk is outside the boundary, and this residual risk is stated in the
  results.

## P6 calibration rule (fixed for pre-registration)

The pilot (16 runs: 2 arcs × 2 conditions × 2 profiles × 2 repetitions) exists to calibrate the
main trial. It is never evidence.

**Condition-blind calibration inputs** (review clarification 2). Calibration reads only a
**calibration dataset** derived from the pilot records. A preparation-work export (item 6) builds
it, and the dataset is **not joinable back to condition identity** before the main plan is
frozen. The export:
- **Remaps run IDs** to fresh random calibration IDs. Harness run IDs are derived from the
  condition and are therefore joinable to the manifest.
- **Removes condition-identifying fields:**
  - condition labels and condition bundle hashes;
  - instruction and setup input hashes;
  - setup records and `setup_seconds`;
  - Keystone-specific diagnostics (envelope and validation);
  - tool-resolution and tool-telemetry entries that differ by condition;
  - workspace and harness paths;
  - failure text that names condition commands or files.
- **Keeps only:** task, profile, per-run primary and guardrail outcomes, resource consumption, and
  the owner's infrastructure-failure classification.

The raw pilot records and any per-condition pilot report are not opened or generated until the
main plan's hash is recorded. They are then labelled non-evidence.

**Inputs and rules:**

1. **Task discrimination (per task, pooled over conditions and profiles).**
   - *Final test pass rate*: the pooled mean of per-run `task_oracle_pass_rate`.
   - *Planted-mistake recurrence rate*, descriptively (clarification 1): failed planted-mistake
     opportunities ÷ total planted-mistake opportunities, pooled. An opportunity is one trap
     oracle in one run. The share of "runs with any recurrence" is **not** used as the rate.
   - A task is non-discriminating if its pooled pass rate is ≥ 0.90 (ceiling) or ≤ 0.10 (floor),
     or if an arc's pooled recurrence rate is 0 or 1. It is then revised or replaced before the
     main trial, with at most one condition-blind re-pilot at the same scale.
2. **Infrastructure reliability.** If more than 10% of pilot attempts are infrastructure failures,
   the cause is fixed and reliability re-checked before freezing. The main trial's resource plan
   includes a rerun allowance equal to the observed infrastructure failure rate.
3. **Precision → repetitions** (review B1; owner decision of 2026-10-06).
   - *Target, not validity threshold:* the standard error of an arm-mean difference in final test
     pass rate is at most 0.075, half the 0.15 margin.
   - For **every arc × tool cell**, estimate σ, the condition-blind pooled within-cell standard
     deviation of per-run final test pass rate. The required repetitions are
     R_cell = ⌈2σ² ÷ 0.075²⌉, so that σ·√(2/R) ≤ 0.075, with R_cell = 5 when σ = 0.
   - The **main-trial R** is the maximum R_cell over all cells, bounded to the approved range 5–10.
   - If every cell meets the target with R ≤ 10, the plan freezes normally at that R.
   - If any cell requires R_cell > 10, then R = 10, and the proposed main trial is designated
     **LOWER PRECISION** *before any condition effect is unblinded*. The frozen plan's
     pre-registration record lists each cell that misses the target and its expected standard
     error, σ·√(2/10).
   - Lower precision does not invalidate the trial. It is stated in the frozen plan and in the
     final interpretation.
   - **R is never below 5.**
4. **Resources and budget** (review B1).
   - The pilot produces a **condition-blind resource-consumption summary** from the calibration
     dataset:
     - tokens (reported) and wall-clock time per run and per session, by task type and profile;
     - the infrastructure-failure rate;
     - projected main-trial consumption for each R from 5 to 10, including the rerun allowance.
   - The owner approves the main-trial budget from that summary, before freezing.
   - **The budget never silently reduces the calibrated R.** If the approved budget cannot support
     the calibrated R, the main trial is **not frozen**. Before evidence collection, the owner
     explicitly approves either the required budget, or a lower-R plan (R ≥ 5) designated
     **LOWER PRECISION**, with its cell-level expected standard errors recorded as above.

**Fixed parameters** (owner, 2026-10-06):

| Parameter | Value |
|---|---|
| Floor | 0.10 |
| Ceiling | 0.90 |
| Infrastructure-failure threshold | >10% |
| Precision target | SE ≤ 0.075 (target; misses produce a LOWER PRECISION designation) |
| Repetitions | 5–10; R = maximum required R across cells |
| Re-pilots | at most one |

None of these rules reads, compares or depends on the direction or favourability of
Keystone-versus-baseline results.

**Cells without pilot data** (owner decision of 2026-10-07). The pilot covers 2 of the 4 arcs, so
σ is observed for only 4 of the 8 arc × tool cells.
- For each **unpiloted** arc × tool cell, σ is the **largest σ observed among the piloted arcs for
  the same tool**.
- The calibration record lists every cell that uses a substituted σ, and its source: the tool and
  the piloted arc that supplied the maximum.
- The pilot is not expanded, and worst-case variance is not assumed.
- The single main-trial R is then selected by the accepted rule above, the maximum R_cell across
  all 8 cells (observed and substituted σ alike), within 5–10, including any LOWER PRECISION
  designation.

## P11 decision rule (fixed for pre-registration)

**Estimand and missing data** (review B2; owner decision of 2026-10-06):
- The estimand is the **complete planned matrix**: arc × tool × condition × repetition. Every
  planned run belongs to it.
- Agent failures are outcomes (P10).
- An infrastructure failure that exhausts its allowed reruns stays **missing**. It is never
  imputed.
- Missing cells are **never removed with the remaining cells reweighted**. The headline
  calculations keep the pre-registered fixed task × tool weighting: every arc cell has equal
  weight.
- **Minimum observations** (owner decision of 2026-10-07):
  - An arc × tool cell's primary statistic is **defined** only when **each** condition arm has at
    least **⌈R/2⌉ valid observed runs** after permitted infrastructure reruns are exhausted (3 of
    5; 5 of 10).
  - If either arm falls below that, the cell's required primary statistic is **undefined**, and
    the overall headline is **UNCLASSIFIABLE**.
  - When both arms meet the threshold, each arm's statistic is the mean over its available valid
    outcomes, and its observed n is always reported.
  - Unequal observation counts **never** change the pre-registered weighting: every defined
    arc × tool cell keeps its fixed equal headline weight.

**Per-run outcome definitions:**
- *Final test pass rate* is `task_oracle_pass_rate`: passing task oracles ÷ task oracles, at the
  final check. **The harness weights by oracle command**, so each task oracle counts equally.
  `trainer-bench` authoring must make the oracle commands reflect the intended weighting, for
  example by splitting or combining checks (clarification 1).
- *Recurrence count* is `trap_recurrences`: the planted-mistake oracles failing at the final check
  in that run.
- *Recurrence rate*, descriptive: failed opportunities ÷ opportunities, as in P6.

**Headline estimates** (arc cells only, fixed equal weights w = 1/8 over the 8 arc × tool cells):
- **Final test pass rate:** Δpass = Σ w·(K̄_cell − B̄_cell), where K̄ and B̄ are the Keystone and
  baseline arm means of per-run pass rate. Positive favours Keystone.
- **Planted-mistake recurrence:** r = 1 − (Σ w·K̄ᵣ_cell) ÷ (Σ w·B̄ᵣ_cell), where K̄ᵣ and B̄ᵣ are the
  arm means of per-run recurrence counts. Positive favours Keystone.
- **Zero-value recurrence rules** (owner confirmation of 2026-10-07). These apply wherever r is
  computed: pooled, per tool, and in every resample. With B the weighted baseline recurrence mean
  and K the weighted Keystone mean:

  | Case | Result |
  |---|---|
  | B = 0 and K = 0 | r = 0 (no change) |
  | B = 0 and K > 0 | meaningful deterioration: the negative recurrence margin is met |
  | B > 0 and K = 0 | r = 1 (100% reduction): the positive recurrence margin is met |
  | B > 0 and K > 0 | the pre-registered relative change, r = 1 − K ÷ B |

  Every case is a *defined* value, so analysis has no undefined zero-denominator interpretation.
- **Per-tool estimates** use the same formulas over each tool's 4 arc cells, with equal weights.
  Claude Code and Codex results are always reported alongside the pooled headline.

**Margins.**
- Meaningful improvement: Δpass ≥ +0.15, or r ≥ 0.30.
- Meaningful deterioration: Δpass ≤ −0.15, or r ≤ −0.30.

**Guardrails** (Keystone versus baseline, pooled with fixed weights over every cell, controls
included):

| Guardrail | Breached when |
|---|---|
| Existing-test regression pass rate | more than 0.05 absolute lower |
| Token consumption (median `total_tokens`, reported) | more than 100% higher |
| Execution time (median `session_seconds`) | more than 50% higher |

Every guardrail value is always reported, pooled and per tool, even when within its threshold. A
guardrail's status is *known* only when its required data is defined. **An unknown guardrail
status is never treated as "not breached".**

**Guardrail asymmetry** (owner confirmation of 2026-10-07; intentional):
- **Positive** requires every guardrail to be known and acceptable, because an apparent benefit
  must not conceal an unacceptable regression, token cost or execution-time cost. Unknown
  guardrails prevent a Positive classification.
- **Negative** is established by meaningful deterioration in a co-primary outcome. Missing guardrail
  information cannot erase observed primary-outcome harm. Unknown guardrails in a Negative result
  are explicitly reported as unknown.

**Tool contradiction.** On a co-primary outcome, a tool contradiction exists when one tool's
estimate meets the improvement margin while the other's meets the deterioration margin. Pooling
never hides it.

**Classification**, applied in the order Mixed → UNCLASSIFIABLE → Positive → Negative → Neutral
(the first matching row decides; owner decision of 2026-10-07):

| Result | Rule |
|---|---|
| **Mixed** | Established when sufficient defined primary evidence independently shows a material contradiction. Every statistic it relies on must be defined. Any of: (1) a tool contradiction on either co-primary, whatever the pooled headline; (2) one pooled co-primary meets its improvement margin while the other meets its deterioration margin; (3) a pooled co-primary meets its improvement margin while a guardrail is **known** to be breached. Missing guardrail data, or missing evidence elsewhere, never overrides an already-established Mixed. |
| **UNCLASSIFIABLE** | Applies only when missing required evidence prevents determining the otherwise applicable classification. Any of: (1) a required cell statistic of either co-primary outcome is undefined because of missing data; (2) the pooled co-primaries satisfy the Positive rule's margin conditions, but a guardrail's status is unknown, so Positive cannot be established. |
| **Positive** | At least one pooled co-primary meets its improvement margin, the other shows no meaningful deterioration, and every guardrail is **known** and not breached. |
| **Negative** | At least one pooled co-primary meets its deterioration margin, and the other shows no meaningful improvement. Negative does **not** require guardrail availability; any unknown guardrail is still **explicitly reported as unknown**. |
| **Neutral** | Neither pooled co-primary crosses either margin, with every required statistic defined. Breached or unknown guardrails are reported alongside, as cost findings. |

**UNCLASSIFIABLE is distinct from NEUTRAL.** Neutral is a measured finding of no practical effect.
UNCLASSIFIABLE means the pre-registered estimand could not be evaluated. Even when the headline is
UNCLASSIFIABLE, every available descriptive result, per-tool estimate and guardrail value is
reported, with observed n.

**Per profile.** Each tool's own classification under the same rules, including UNCLASSIFIABLE, is
reported as a secondary result. The overall result is the classification above.

## Pre-registered analysis and resampling structure (clarifications 5 and 8)

The final analysis is a **pre-registered procedure**, frozen with the main plan (preparation item
9). Applied to the main trial's records and imported judgements, it produces the P11 estimates and
classification deterministically. Its supporting statistics never override the classification.

- **Independent units.** Whole runs. Sessions, oracle assertions and planted-mistake opportunities
  within a run are **not** independent replicates.
- **Repetition pairing.** None is assumed for inference: Keystone and baseline runs in a cell are
  independent samples. For descriptive displays only, runs are paired by the harness's repetition
  index (Keystone repetition k with baseline repetition k).
- **Permutation test** (per co-primary).
  - *Exchangeability blocks:* each arc × tool cell. Condition labels are permuted among the
    observed runs within each cell, never across cells.
  - The test statistic is the headline estimator (Δpass, r) with the fixed weights.
  - 10,000 permutations from a seed fixed in the pre-registration, giving two-sided p-values.
- **Bootstrap confidence intervals** (95%, percentile).
  - *Strata:* arc × tool × condition. Observed runs are resampled with replacement within each
    stratum.
  - The fixed weights are preserved in every resample.
  - 10,000 resamples from a pre-registered seed.
- **Recurrence ratios in resampling.**
  - Every resample applies the P11 zero-value recurrence rules, so r is always defined.
  - Strata are never empty: a cell enters the analysis only when each arm has at least ⌈R/2⌉
    observed runs, and resampling draws within those observed runs.
  - A resample whose r is unbounded (B = 0, K > 0) is counted at the deterioration margin. The
    share of such resamples is reported.
- **Judged measures, blinding and attempts** follow the judging and failure procedures below, and
  the analysis consumes them as specified there.

## Plan freezing and provenance (P12)

1. **Pilot.** Its own plan ID (purpose `experiment`, labelled non-evidence in the
   pre-registration), frozen and hash-recorded before its first run. Its runs are never pooled with
   the main trial.
2. **Calibration** follows the P6 rule. Every permitted adjustment (repetitions, revised or
   replaced tasks, caps or timeouts, rerun allowance) produces a **new main-trial plan** and a new
   hash.
3. **Freezing the main plan.** Before its first run:
   - `trainer-app` and `trainer-bench` commits are pinned;
   - the plan and pre-registration record are committed to Keystone;
   - the Keystone checkout is clean;
   - the tool and model versions are pinned and recorded;
   - the pre-registration states the calibrated R and the precision designation (normal or
     **LOWER PRECISION**, with each cell missing the target and its expected standard error),
     and the owner's budget approval;
   - the pre-registered analysis procedure, packet-inspection term list and redaction rule, and
     owner-audit sampling rule are frozen and hashed with the plan;
   - the hidden-material exposure verification is re-run and recorded;
   - the plan hash is recorded in the trial task.
4. **Once the first main-trial run starts, no plan change is permitted.** The harness enforces
   this (`BENCH_PLAN_CHANGED` and `BENCH_PLAN_MISMATCH`). A defect discovered later ends the trial
   as recorded, and any corrected trial is a new plan with its own evidence.

## Claims (P13)

**Supported:** for `trainer-app` at its pinned baseline, the pinned `trainer-bench` tasks, these
tools and models at their recorded versions, and this harness configuration, the observed
difference between an information-parity, active baseline and Keystone on the pre-registered
co-primary outcomes, classified by the P11 rule with stated uncertainty.

**Not supported:**
- generalization to other projects, languages or teams;
- attribution to specific Keystone mechanisms;
- horizons beyond 3–4 sessions;
- untested tools, models or versions;
- claims from smoke runs, the pilot or post-hoc subgroups;
- claims about the value of information as such (held equal by P2).

## Adopted ADR-0004 clarification and related amendments (applied 2026-10-06)

P1 placed hidden evaluation material in a repository separate from the subject. The authorities
did not plainly permit that, so revision 2 drafted an explicit clarification. On 2026-10-06 the
owner **adopted drafts A–C**, and they were applied:
- **A — ADR-0004** (status `accepted`, unchanged): a new section, "Clarification (2026-10-06,
  TASK-0014): evaluation material outside the measured subject", with TASK-0014 added to its
  `tasks` links. It states:
  - hidden evaluation material may reside in a separately pinned benchmark repository when
    including it in the subject would expose evaluation evidence;
  - both repository identities and pinned commits form part of every run's immutable provenance;
  - workspaces are cloned from the subject only, and benchmark material reaches a run only
    through the harness;
  - no other guarantee changes.

  A terminology note maps the ADR's earlier "Repo B" wording to `trainer-app` and `trainer-bench`;
  the historical text is not rewritten.
- **B — SPEC.md "Benchmark harness":** "Application-specific task content stays out of Keystone:
  with its subject repository or, where including it in the measured subject would expose
  evaluation evidence, in a separately pinned benchmark repository (ADR-0004). Both pinned commits
  are part of every run's provenance."
- **C — `docs/REPO-SEPARATION.md`:** Repo A (Keystone), the benchmark subject `trainer-app`, and
  the benchmark repository `trainer-bench`. Keystone holds no personal-trainer implementation or
  evaluation knowledge.
- **Consistency:** SETUP.md's "Second repository comes later" section was aligned to the same
  three-part separation, so no authority or setup guide still describes a single "Repo B".

**Harness consequence:** plan schema and run provenance must record the benchmark repository's
identity and commit, alongside the subject's (preparation item 5). This is an implementation-
contract change (ADR-0004 guarantee 9), not a further ADR.

## Preparation work after design acceptance (not TASK-0014)

1. **Version provenance:** exact agent tool and model versions in run records.
2. **Codex usage parser:** a Codex CLI usage parser.
3. **Judgements** (clarifications 3 and 7):
   - multiple preserved judgements per run, keyed by blinded run and judge identity;
   - the seeded 20% owner-audit sample;
   - judge, prompt and rubric provenance in each attestation;
   - an optional `condition_guess` field, with participation and accuracy reporting.
4. **Plan location:** a canonical experiment-plan and pre-registration location in Keystone, and
   how `keystone-bench validate` treats plans whose external paths exist only on the trial
   machine.
5. **Benchmark-repository provenance:** benchmark-repository identity and pinned commit in the
   plan schema and in run provenance (P1, ADR-0004 clarification).
6. **Condition-blind calibration export** (clarification 2): a pilot calibration and
   resource-consumption export that remaps run IDs and strips condition labels, condition-derived
   hashes, setup data, Keystone diagnostics, paths, condition-specific telemetry and failure text,
   so the calibration dataset cannot be joined back to condition identity. It also computes
   per-cell σ and R_cell (P6).
7. **Preserved-attempt and rerun procedure** (clarification 4): archive, not delete, failed
   attempts; record attempt numbering and provenance; re-prepare the same planned run as a new
   attempt.
8. **Packet inspection** (clarification 7): the pre-registered term list, the automated scan, the
   condition-symmetric redaction rule, and the inspection log.
9. **Pre-registered final analysis procedure** (clarification 5): a deterministic analysis that
   implements the P11 estimand, missing-data rules, fixed weighting and classification (including
   UNCLASSIFIABLE and LOWER PRECISION reporting), together with the resampling structure. It is
   frozen and hashed with the main plan.
10. **Hidden-material exposure verification** (clarification 6): a checklist and recorded
    verification for profiles, prompts, staged files, configuration and paths, run before the
    pilot and at main-plan freezing.

## Proposed task sequence after design acceptance (not created)

1. **Harness preparation:** items 1–10 above, with tests.
2. **Author `trainer-app` and `trainer-bench`,** in their own repositories, outside Keystone. This
   includes:
   - the parity-fact encodings, verified by the owner;
   - oracle commands that reflect the intended weighting.
3. **Smoke runs per profile** (never evidence), then the hidden-material verification, then the
   frozen pilot plan.
4. **Pilot,** then:
   - the condition-blind calibration and resource summary;
   - the R decision (including any LOWER PRECISION designation);
   - the owner's main-trial budget approval.
5. **Freeze the main plan:**
   - pin the tool and model versions and the judge models;
   - re-verify hidden-material exposure;
   - freeze and hash the analysis procedure;
   - record the plan hash.

   Then the main trial, judging (with packet inspection), the pre-registered analysis and the
   result report.

## Design-review readiness

**Resolved in revision 4** (independent review, round 1):

| Item | Resolution |
|---|---|
| B1 Precision and calibration | SE ≤ 0.075 is a target. R is the maximum per-cell required R, within 5–10. Cells needing R > 10 make the trial LOWER PRECISION, declared before unblinding, with the misses recorded. The budget never silently lowers R; if it is insufficient, the plan is not frozen until the owner explicitly approves the budget or a lower-R, lower-precision plan. R ≥ 5. |
| B2 Incomplete data | The complete planned matrix is the estimand. Agent failures are outcomes. Exhausted infrastructure failures stay missing, with no imputation and no reweighting; fixed task × tool weights are kept. An undefined required primary cell statistic, or a guardrail status that a claimed Positive cannot establish, makes the result UNCLASSIFIABLE. Unknown guardrails are never "not breached". Available results are always reported. UNCLASSIFIABLE is distinct from NEUTRAL. |
| Clarifications 1–8 | Opportunity-based recurrence rate and oracle-command weighting (1); a non-joinable condition-blind calibration export (2); separately preserved dual-vendor judgements and the seeded owner audit (3); preserved attempts (4); a pre-registered analysis procedure (5); the hidden-material exposure check (6); packet inspection, plus participation and accuracy reporting (7); the resampling structure (8). |

**Resolved in revision 5** (owner decisions of 2026-10-07):

| Input | Resolution |
|---|---|
| σ for unpiloted cells | The largest observed pilot σ among the piloted arcs for the same tool. Every substitution and its source is recorded. No 32-run pilot and no worst-case assumption. R is selected by the accepted rule across observed and substituted σ. |
| Minimum observations | Each condition arm of a cell needs at least ⌈R/2⌉ valid observed runs after exhausted reruns. Otherwise the cell is undefined and the headline is UNCLASSIFIABLE. Defined cells use their available valid outcomes, and keep their fixed equal weight regardless of n. |
| Negative and guardrails | Negative does not require guardrail availability; unknown guardrails are reported as unknown. Positive requires every guardrail to be known and acceptable. The asymmetry is intentional. |
| Zero-value recurrence | B = 0 and K = 0 gives r = 0. B = 0 and K > 0 meets the deterioration margin. B > 0 and K = 0 gives r = 1, meeting the improvement margin. Otherwise r = 1 − K ÷ B. No undefined zero-denominator case remains. |

The selected baseline, tools, task structure, practical-effect margins and P13 claim scope are
unchanged throughout.

**Genuinely unresolved design issues: none.**

**Deliberately deferred to predefined later gates** (not design gaps):

| Item | Gate |
|---|---|
| Main-trial budget | After the pilot's condition-blind resource summary, before freezing the main plan |
| Final R, and any LOWER PRECISION designation | Calibration (P6), before unblinding |
| Exact judge models and versions; the tested Codex model; pinned tool versions | Experiment-plan freezing |
| The 2 piloted arcs | Pilot plan freezing |

**Readiness:** TASK-0014 is at the owner's design-review gate, with a complete design record.
Acceptance belongs to the owner. As with TASK-0008, TASK-0010 and TASK-0012, design tasks may be
accepted on owner review, or after a further independent review if the owner prefers.

## Revision history

| Revision | Date | Change |
|---|---|---|
| 1 | 2026-10-06 | Initial proposal: decided constraints, P1–P13 with options, trade-offs and recommendations, prerequisites and task sequence. |
| 2 | 2026-10-06 | Owner resolutions of P1–P13 recorded (P1 approved with clarification, P6 and P11 modified, P9 tightened, P10 amended). The resulting design is restated around two separately pinned repositories (`trainer-app`, `trainer-bench`). The P6 calibration rule and the P11 decision rule are specified. ADR-0004, SPEC.md and REPO-SEPARATION clarification drafts are added, unapplied. Preparation item 6 (condition-blind calibration summary) is added. The remaining owner decisions are listed. |
| 3 | 2026-10-06 | Owner final decisions: drafts A–C adopted and applied (with SETUP.md aligned). P11 guardrails set (0.05 regression, +100% tokens, +50% time, always reported), headline aggregation approved, per-tool results always reported, and the tool-contradiction rule (mixed) added. P6 parameters set, with the budget deferred to the pilot's condition-blind resource summary. Freeze-time parameters recorded as deferred. Design marked ready for the owner's design review. |
| 4 | 2026-10-06 | Independent review, round 1. B1 resolved: per-cell R, maximum across cells, LOWER PRECISION designation, and the budget never silently reducing R. B2 resolved: complete-matrix estimand, no imputation or reweighting, UNCLASSIFIABLE class, unknown guardrails never "not breached". Clarifications 1–8 incorporated: recurrence opportunities and oracle weighting; a non-joinable calibration export; dual judgements and the owner audit; preserved attempts; the analysis procedure; the hidden-material check; packet inspection; the resampling structure. Preparation items expanded to 10. Four remaining owner decisions identified. |
| 5 | 2026-10-07 | The four rule inputs exposed by revision 4 are fixed. (1) Unpiloted cells use the largest piloted σ of the same tool, with each substitution and its source recorded; R is selected across observed and substituted σ. (2) A cell is defined only when each arm has at least ⌈R/2⌉ valid runs; otherwise the result is UNCLASSIFIABLE; fixed equal weights are kept regardless of n. (3) Negative does not require guardrails, an intentional asymmetry with Positive; unknown guardrails are reported as unknown. (4) Zero-value recurrence rules for all four cases. No design input remains unresolved beyond the deferred gates. |
| 6 | 2026-10-07 | Classification precedence changed to Mixed → UNCLASSIFIABLE → Positive → Negative → Neutral. Mixed is established only from defined primary evidence, and missing guardrail data never overrides it. UNCLASSIFIABLE applies only when missing required evidence prevents determining the otherwise applicable classification. No other design change. |
