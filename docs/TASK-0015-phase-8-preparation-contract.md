# TASK-0015 — Phase 8 preparation implementation contract

**NON-AUTHORITATIVE CONTRACT NOTE — revision 2, 2026-10-07, approved by the owner and
implemented.** The owner approved revision 1 on 2026-10-07 with decisions C1–C5 and a
compatibility requirement, which revision 2 incorporates. The implemented mechanisms are folded
into `docs/PHASE-7.md`, "Phase 8 preparation (TASK-0015)". That section, and TASK-0015's
Implementation Notes, record the small refinements made during implementation, such as the
plan-declared calibration measures. This note is now history. The authority is:
- SPEC.md, D23–D25 and ADR-0004 (with both 2026-10-06 clarifications);
- the accepted TASK-0014 design (design notes revision 6), whose decisions are inputs here;
- `docs/PHASE-7.md`, the implementation contract this note extends (ADR-0004 guarantee 9);
- the TASK-0015 owner decisions Q1–Q5 and C1–C5 of 2026-10-07, including ADR-0004's
  2026-10-07 (TASK-0015) clarification on `benchmark/plans/`.

After owner approval and implementation, the accepted mechanisms are folded into
`docs/PHASE-7.md` (a "Phase 8 preparation" part), and this note becomes history.

## Principles

- **Generic harness, experiment-supplied parameters (Q3).** No TASK-0014 value (margins,
  guardrail thresholds, R bounds, floor/ceiling, audit fraction, seeds, term lists) is written in
  harness code. Each is declared in a plan-referenced file and enters the plan hash.
- **Frozen means hashed.** Every new plan-level input (analysis specification, inspection terms,
  pre-registration record) is referenced from the plan and folded into the plan hash, so the
  existing `BENCH_PLAN_CHANGED` and `BENCH_PLAN_MISMATCH` enforce freezing with no new mechanism.
- **Machine-independent plans (Q2).** Plans name repositories by ID, never by machine path.
  Machine paths come from an unhashed, unrecorded locations file supplied at the command line.
- **Phase 7 invariants hold:** only `run` launches declared programs; every write goes through
  `guard()` and `writeVerified`; records stay content-free; offline tests with the fake agent.
- **Generic semantics versus parameters (Q3).** The harness implements named, generic
  definitions:
  - the effect types `difference` and `relative-reduction` (with its four zero-value cases);
  - the five class predicates (Mixed, UNCLASSIFIABLE, Positive, Negative, Neutral);
  - the completeness-rule types;
  - the resampling procedures.

  The experiment's specification declares every number, every measure choice, the
  classification order and the completeness rule chosen.
- **Compatibility (owner requirement, 2026-10-07).** Version 2 formats extend Phase 7 only where
  TASK-0015 requires it.
  - Version 1 plans and profiles keep their Phase 7 semantics for their existing supported
    purpose, and a version 1 plan still produces unchanged Phase 7 (version 1) run records.
  - Existing smoke material and fixtures are neither rewritten nor invalidated.
  - Version 2 records are written only for version 2 plans.
  - The one additive change visible to version 1 is the new `codex-jsonl` usage-parser value,
    which invalidates nothing.

## Command summary

| Command | Status | Items |
|---|---|---|
| `validate [plan] [--repos <file>]` | Extended: structural always; resolution when locations are available | 4, 5 |
| `prepare`, `run`, `record`, `score`, `report` | Extended: `--repos`; version probe; attempts; packet inspection; judged import v2 | 1, 3, 5, 7, 8 |
| `rerun <run-id> --plan <p> --classification <file>` | **New**: archive an infrastructure-failed attempt and re-prepare | 7 |
| `verify-exposure <plan>` | **New**: automated hidden-material checks, recorded | 10 |
| `freeze <plan>` | **New**: freeze record for an experiment plan at its canonical location | 4 |
| `release <plan> --attestation <file>` | **New**: records the owner's manual packet-release gate (C5) | 8 |
| `calibrate <pilot-plan>` | **New**: condition-blind calibration and resource export | 6 |
| `analyze <plan>` | **New**: pre-registered final analysis and classification | 9 |

All commands keep `--root`, `--work` and `--json`, and the Phase 7 exit-code convention. New
commands other than `rerun` launch no program; `rerun` launches only the fixed offline Git calls
of `prepare`. The version 2 features (`--repos`, the version probe, attempts, inspection, judges,
freezing) apply to version 2 plans; version 1 plans behave exactly as in Phase 7.

## Item 5 — Benchmark-repository provenance, and item 4 — plan location

These come first because every other item reads the version 2 plan.

**Plan location.** `benchmark/plans/<plan-id>/`, holding:
- `plan.json` (`keystone-bench-plan`, version 2);
- `analysis.json` (`keystone-bench-analysis-spec`, items 6 and 9);
- `inspection-terms.json` (`keystone-bench-inspection-terms`, item 8), when the plan adds terms;
- `preregistration.md` (human-authored);
- `freeze.json` (written by `freeze`).

A plan outside `benchmark/plans/` remains valid for smoke purposes and offline fixtures. An
`experiment` plan must sit at `benchmark/plans/<its id>/plan.json` for `freeze`, `prepare` and
`run` (`BENCH_PLAN_LOCATION_INVALID`).

**Plan version 2** (changes from version 1):

```json
{
  "kind": "keystone-bench-plan", "schema_version": 2, "id": "…", "purpose": "experiment",
  "stage": "pilot | main",
  "repositories": {
    "subject":   { "id": "trainer-app",   "commit": "<40 hex>" },
    "benchmark": { "id": "trainer-bench", "commit": "<40 hex>" }
  },
  "tasks":      [{ "repository": "benchmark", "path": "tasks/<bundle>" }],
  "conditions": [{ "repository": "benchmark", "path": "conditions/<bundle>" }],
  "profiles":   [{ "repository": "benchmark", "path": "profiles/<bundle>" }],
  "analysis": "analysis.json",
  "preregistration": "preregistration.md",
  "calibrated_from": { "id": "<pilot plan id>", "hash": "<hash>" },
  "repetitions": 5, "seed": 0, "limits": {}, "telemetry": {},
  "judging": { "procedure": "…", "exclude": [], "judges": [], "audit": {}, "inspection": {} }
}
```

- `repository` is `subject`, `benchmark` or `keystone` (this Keystone root). `benchmark` is
  optional in the schema, so a single-repository experiment remains possible (ADR-0004
  clarification: the separate repository is permitted, not required).
- Plan-directory files (`analysis`, `preregistration`, inspection terms) are paths relative to the
  plan directory.
- `stage` and `calibrated_from` serve item 6; `calibrated_from` is required for `stage: main` when
  the analysis specification declares a calibration.
- **Plan hash v2** = SHA-256 of the canonical serialization of the plan bytes, every referenced
  bundle hash, and the hash of each plan-directory file. Repository IDs and commits are in the
  plan bytes, so both pinned commits are in the hash.

**Locations file** (`--repos <file>`, kind `keystone-bench-locations`): `{ "repositories": { "<id>":
"<local path>" } }`. Never hashed, never recorded, never inside the Keystone tree
(`BENCH_LOCATIONS_INVALID`). It may also be omitted when every repository is `keystone`.

**Resolution.**
- `validate` always performs the structural check: schemas, semantics, placeholders, plan-file
  references, and that the plan's directory name equals its ID. With no locations file, or a
  location that is missing, it adds `BENCH_REPOSITORY_UNAVAILABLE` (one per repository), reports
  `resolved: false` in JSON, and still exits `valid`. Bundle hashes, and so the plan hash, are not
  computed.
- Every other plan command requires resolution and is `blocked` with the same diagnostic.
- When resolved, `prepare`, `run`, `freeze` and `verify-exposure` check that each repository:
  - contains its pinned commit and has `HEAD` at it (`BENCH_REPOSITORY_COMMIT_MISSING`,
    `BENCH_REPOSITORY_NOT_AT_COMMIT`);
  - has no modified or untracked file under any referenced bundle path, using the fixed offline
    Git status call (`BENCH_REPOSITORY_DIRTY`). The working-file bundle hash then equals the pinned
    content.
- The workspace is cloned from `subject` only. The benchmark repository is never cloned, staged
  wholesale, or placed on `PATH`.

**Records.** `provenance.repositories` replaces `provenance.subject`:
`{ subject: { id, commit }, benchmark: { id, commit } | null }`.

**`freeze <plan> --repos <file>`** (item 4, with P12). For an `experiment` plan at its canonical
location it checks:
- resolution, pinned and clean repositories;
- the Keystone checkout is clean apart from `freeze.json` itself (`BENCH_KEYSTONE_DIRTY`);
- the analysis specification and pre-registration are present;
- a current exposure verification exists for this plan hash (item 10;
  `BENCH_EXPOSURE_NOT_VERIFIED`);
- for `stage: main` with `calibrated_from`, the named pilot plan's calibration export exists and
  matches that hash.

It then writes `freeze.json`: plan ID and hash, the hashes of every plan-directory file, the
Keystone commit, the exposure-verification hash and the date. `prepare` and `run` for an
`experiment` plan refuse without a `freeze.json` matching the current plan hash
(`BENCH_PLAN_NOT_FROZEN`). Committing the plan directory remains the owner's step; the run's
existing Keystone `dirty` flag records whether that happened.

**Plan exclusion from protocol context (C1, approved).** ADR-0004's 2026-10-07 clarification
gives `benchmark/plans/` exactly guarantee 7's treatment.
- `isBenchmarkRecordPath` (`src/context/benchmark-records.ts`) gains `plans`. Discovery,
  configured-source validation (`CONFIG_INVALID`), START and review-context selection then treat
  it as they treat `results` and `analysis` (`START_BENCHMARK_RECORD_INELIGIBLE`, omission reason
  `benchmark-record-ineligible`). No other protocol behaviour changes.
- The harness gains a `plans` write boundary, used only for `freeze.json`, under the same
  `guard()` and `writeVerified` rules.
- `docs/PHASE-0-1.md`, `docs/PHASE-3.md`, `docs/PHASE-7.md` and `tests/README.md` describe
  implemented behaviour, so they are aligned when the change is implemented.

## Item 1 — Version provenance

**Profile version 2** adds:

```json
"declared": { "tool": "codex", "tool_version": "…", "model": "…" },
"trusted":  { "tools": [], "models": [], "tool_versions": [] },
"version":  { "command": ["codex", "--version"] }
```

- `declared.tool_version` must be a member of `trusted.tool_versions`.
- `version.command` follows the agent-command placeholder rules, minus session placeholders.

**Probe.** At the start of each run, before condition setup, `run` launches `version.command` with
the controlled base environment and the setup timeout (`run` is already the only launching
command).
- The trimmed first line of its standard output is matched against `trusted.tool_versions`
  exactly. A non-matching string is never persisted (Phase 7 rule B8).
- If it does not equal `declared.tool_version`, the run is refused before setup:
  `BENCH_TOOL_VERSION_MISMATCH`, outcome `blocked`, run state stays `prepared`, and no attempt is
  consumed. This catches auto-update during the trial window.
- A manual profile records `tool_version` in its manual record, restricted to trusted values.

**Records.** `provenance.profile.observed = { tool_version, models }`:
- `tool_version` comes from the probe (source `deterministic`), or from the manual record
  (`reported`);
- `models` is the union of the trusted models reported by the sessions (`reported`).

Each session's usage gains `model_mismatch: true` when it reported a trusted model that differs
from `declared.model`. `report` and `analyze` list every run with a model mismatch or an
unrecognized identity. Neither excludes the run: intention-to-treat holds.

## Item 2 — Codex usage parser

Parser `codex-jsonl` reads the JSON Lines event stream on standard output (`codex exec --json`).
The mapping is **provisional and unverified** until the real-CLI check (Q4):

| Measure | Mapping |
|---|---|
| `input_tokens` | Σ `usage.input_tokens` over `turn.completed` events (cached input is already included in this field, so it is not added again) |
| `output_tokens` | Σ `usage.output_tokens` |
| `total_tokens` | input + output |
| `turns` | count of `turn.completed` |
| `tool_calls` | count of `item.completed` whose item type is a tool or command execution |
| models | not reported by the stream; the declared model stands |
| tool | the parser constant `codex` |

- Unparseable lines are skipped and counted. A stream without any `turn.completed` gives `null`
  usage and `BENCH_USAGE_UNREPORTED`, never zero.
- Token totals are compared only within a tool (K versus B), never across tools. The Claude and
  Codex accounting of cached input differs, which is therefore harmless for P8 and P11.
- **Fixture:** `tests/fixtures/bench/usage/codex-jsonl.synthetic.jsonl`, with a header line in
  the fixture README stating that it is synthetic, built from the documented format, and
  unverified.
- **Real verification before acceptance (Q4; C4 approved):** one version 2 `smoke`-purpose plan
  over the synthetic Phase 7 smoke subject and task (`tests/fixtures/bench/`), with a Codex
  `command` profile, run once outside the automated suite.
  - It checks that the parser produces non-null usage and that the version probe matches.
  - It is tooling and integration verification only: explicitly non-evidence, not a Phase 8
    pilot and not a Phase 8 benchmark task. It needs neither `trainer-app` nor `trainer-bench`.
  - Its records stay in `<work>/smoke/`.
  - As for TASK-0013's smoke run, the owner chooses the Codex model, invocation flags and
    network use when it is run.
  - If the real stream differs from the provisional mapping, the parser is corrected and the
    difference is recorded. That is an implementation-contract change (ADR-0004 guarantee 9).

## Item 7 — Preserved attempts and reruns

**Classification file** (kind `keystone-bench-attempt-classification`):
`{ run_id, attempt, class: "infrastructure", cause: "harness-error | provider-outage | rate-limit |
machine-fault", evidence: ["<paths inside the run directory>"], classified_by: "owner", date }`.
Only `infrastructure` is accepted: agent failures are outcomes and cannot be rerun.

**`rerun <run-id> --plan <p> --classification <file>`:**
1. Refused if any `benchmark/analysis/<plan-id>/scores.json` or analysis output exists
   (`BENCH_RERUN_AFTER_SCORING`). This makes "classified before scores are seen" mechanical.
2. Refused when the run has already used the plan's `limits.max_infrastructure_reruns`
   (`BENCH_RERUN_EXHAUSTED`). The limit is a new plan limit, so it is plan-supplied.
3. Moves `<work>/runs/<run-id>/` to `<work>/attempts/<run-id>/<attempt-n>/` (a rename within the
   work boundary, never a delete). An installed record
   `benchmark/results/<plan-id>/runs/<run-id>.json` is moved into the same archive.
4. Computes the archive content hash: a sorted file list with per-file SHA-256.
5. Writes `benchmark/results/<plan-id>/attempts/<run-id>.json`: an ordered list of attempts, each
   with the attempt number, prepared, started and archived timestamps, the classification without
   its free text, the hashes of the evidence files and the archive. The record is content-free.
6. Re-prepares the same planned run as attempt n+1, with the same run ID.

Run records gain `provenance.attempt`. Only the run directory under `runs/` supplies evidence; an
archived attempt is never loaded by `score`, `report` or `analyze`. `BENCH_RUN_INTERRUPTED` now
points to `rerun` rather than manual deletion for experiment plans. The manual procedure remains
for smoke plans.

## Item 3 — Judgements

**Plan `judging` additions:**

```json
"judges": [
  { "id": "vendor-a", "role": "vendor", "kind": "model", "model": "…", "version": "…" },
  { "id": "vendor-b", "role": "vendor", "kind": "model", "model": "…", "version": "…" },
  { "id": "owner",    "role": "audit",  "kind": "owner" }
],
"audit": { "judge": "owner", "fraction": 0.2, "seed": 0, "stratify": "task" },
"rubric": { "repository": "benchmark", "path": "judging/rubric" },
"prompt": { "repository": "benchmark", "path": "judging/prompt" }
```

The rubric and prompt are bundles, so their hashes enter the plan hash, and the benchmark commit
pins the rubric.

**Judgements version 2.** The attestation becomes
`{ judge: <judge id>, procedure, date, statement, rubric: { commit, hash }, prompt_hash }`.
- Import refuses an undeclared judge, or a rubric or prompt hash that differs from the plan's
  (`BENCH_JUDGEMENT_PROVENANCE_INVALID`).
- Items gain an optional `condition_guess`: a plan condition ID or `null`.
- Duplicate key = (run, judge): a second judgement by the same judge for a run is
  `BENCH_JUDGEMENT_DUPLICATE`. Different judges for one run are stored separately.
- An `audit`-role judgement for a run outside the audit sample is
  `BENCH_JUDGEMENT_NOT_SAMPLED`.

**Audit sample.** `score --blind` writes `audit.json` into the packet: the blinded IDs selected
per task stratum, in ascending order of SHA-256(`seed:blind_id`), ⌈fraction × stratum size⌉ per
stratum. It is computed from blinded IDs only, before any import, and its hash is recorded in
`packet.json`.

**Measures (C2, approved).** Run-level judged values:
- `review_blocking_findings` and `review_non_blocking_findings`: the mean over vendor-role
  judges (source `judged`);
- `review_verdict` is categorical. It is **never averaged**, and never combined into a run-level
  value. Each judge's verdict is preserved and reported separately, with per-verdict counts, and
  agreement and disagreement between judges are reported.

Reported per judge: judgement counts, inter-vendor agreement (exact agreement on the verdict, and
the mean absolute difference of the counts), vendor-to-audit agreement on the audited runs, and
guess participation and accuracy. These are labelled blinding or agreement statistics, and are
never inputs to `analyze`'s classification.

Completeness: `analyze` reports a judged measure as undefined for a run lacking any vendor
judgement. Judged measures are secondary, so this never affects the classification.

## Item 8 — Packet inspection

**Terms.** A generic default list ships at
`benchmark/specification/inspection/keystone-terms.json`. It contains Keystone identifiers only:
`keystone`, `keystone-bench`, `.context`, `AGENTS.md`, the artifact-ID patterns `TASK-\d{4}`,
`ADR-\d{4}`, `LRN-`, `TRAP-`, and the Keystone command names. The plan's
`judging.inspection: { terms: [<plan-dir files>], replacement: "[REDACTED]" }` adds
experiment-specific terms, such as baseline-notes file names. Terms are literals, matched
case-insensitively, or anchored regular expressions.

**During `score --blind`,** before any packet file is written:
1. Every patch and task statement is scanned with the combined term list.
2. Every match is replaced with the fixed replacement, under the same rule for every run whatever
   its condition. There is no per-item edit path.
3. An inspection log is written to `<work>/judging/inspection.json`: per blinded ID, the term ID,
   file and line, and a context excerpt for the owner's review. It stays in `work`, because it
   contains subject content.
4. `packet.json` records the terms hash, the replacement, the log hash and the hit count per term.
   The packet is written only after redaction.

**Manual release gate (C5, approved).** The owner reviews the inspection log before the packet is
released to judges. That review is a manual gate, recorded in trial provenance:
- `release <plan> --attestation <file>` takes a `keystone-bench-packet-release` attestation:
  - the packet hash;
  - the inspection-log hash;
  - `reviewed_by: "owner"`;
  - the date and a statement.

  It writes `benchmark/results/<plan-id>/judging/release-<packet-hash-prefix>.json`, which is
  content-free.
- `score --judged` refuses judgements for a packet with no matching release record
  (`BENCH_PACKET_NOT_RELEASED`).

The harness enforces only that the gate was recorded; the review itself remains the owner's.

## Item 10 — Hidden-material exposure verification

**`verify-exposure <plan> --repos <file>`** launches nothing. It writes
`benchmark/results/<plan-id>/verification/exposure-<plan-hash-prefix>.json`, content-free: each
check with its result and counts, the plan hash and the date. Checks:

| # | Automated check |
|---|---|
| E1 | No profile `command`, `version.command` or `env.pass` entry names the benchmark repository's path, ID or any bundle path |
| E2 | No profile is `manual`, because manual mode writes every prompt in advance |
| E3 | No condition-staged file contains the text of any task statement, session prompt (beyond the first), fix prompt, oracle command, or rubric file |
| E4 | The benchmark repository lies physically outside the work directory, the subject and every workspace, is not the subject, and is on no entry of the base `PATH` |
| E5 | The workspace source is the subject repository only |
| E6 | The harness writes only the current session's prompt before each launch (a harness invariant, asserted by test and restated in the record) |

It also writes the owner attestations it cannot automate, listed as unattested:
- no instruction or prompt references the benchmark repository;
- `trainer-bench` is not discoverable through tool configuration on the trial machine;
- the residual risk statement: no filesystem-permission isolation, and a disk-searching agent is
  outside the boundary.

Any failed automated check makes the outcome `invalid` (`BENCH_EXPOSURE_CHECK_FAILED`). `freeze`
requires a passing verification for the current plan hash. Running it for the real pilot and main
plan belongs to later tasks.

## Item 6 — Condition-blind calibration export

**Analysis specification** (`keystone-bench-analysis-spec`), shared with item 9:

```json
{
  "conditions": { "reference": "<id>", "treatment": "<id>" },
  "task_groups": { "headline": ["<task ids>"], "control": ["<task ids>"] },
  "calibration": {
    "measure": "task_oracle_pass_rate",
    "floor": 0.1, "ceiling": 0.9, "se_target": 0.075,
    "repetitions": { "min": 5, "max": 10 },
    "infrastructure_threshold": 0.1,
    "target_tasks": ["<all headline task ids of the main trial>"],
    "unpiloted_sigma": "max-observed-same-profile"
  }
}
```

**`calibrate <pilot-plan> --repos <file>`** requires a `stage: pilot` plan. It writes
`benchmark/analysis/<plan-id>/calibration.json` and `.md`:
- **Dataset:** one row per run with a fresh random calibration ID (the secret is discarded, so
  even the harness cannot rejoin), the task, the profile, primary and guardrail outcomes, tokens,
  session seconds, session count and the attempt count. Nothing else from the record is copied:
  no condition, condition-derived hash, setup, diagnostics, paths, telemetry or failure text.
- **Discrimination** per task: the pooled pass rate and the recurrence rate (failed opportunities
  ÷ opportunities), with floor and ceiling flags.
- **Infrastructure rate:** classified infrastructure attempts ÷ all attempts, from the attempts
  log, compared with the threshold.
- **Precision:** per task × profile cell, the pooled within-cell σ, computed over all of the
  cell's pilot runs with no condition split. R_cell = ⌈2σ² ÷ se_target²⌉, with R_cell = r_min
  when σ = 0. Unpiloted target tasks take the largest observed σ of the same profile, and each
  substitution and its source cell are listed. R = clamp(max R_cell, min, max), with a LOWER
  PRECISION flag and the expected SE σ·√(2/R) for every cell above `max`.
- **Resource projection** for each R from min to max: projected runs, tokens and seconds, by task
  group and profile, including the rerun allowance.

Pilot gating: `score`, `report` and `analyze` refuse a `stage: pilot` plan
(`BENCH_PILOT_CONDITION_BLIND`) until a `freeze.json` exists for a main plan whose
`calibrated_from` names this pilot's hash. They then label all output non-evidence. Freezing
does not require anyone to unblind the pilot: the R decision and the budget approval are written into
`preregistration.md` by the owner.

## Item 9 — Pre-registered final analysis

The specification adds:

```json
"analysis": {
  "primary": [
    { "id": "pass", "measure": "task_oracle_pass_rate", "effect": "difference", "margin": 0.15 },
    { "id": "recurrence", "measure": "trap_recurrences", "effect": "relative-reduction", "margin": 0.30 }
  ],
  "guardrails": [
    { "measure": "regression_oracle_pass_rate", "statistic": "mean",   "breach": { "lower_by_more_than": 0.05 } },
    { "measure": "total_tokens",                "statistic": "median", "breach": { "relative_increase_above": 1.0 } },
    { "measure": "session_seconds",             "statistic": "median", "breach": { "relative_increase_above": 0.5 } }
  ],
  "completeness": { "primary": "ceil-half-R", "guardrails": "ceil-half-R" },
  "classification_order": ["mixed", "unclassifiable", "positive", "negative", "neutral"],
  "precision": "normal | lower",
  "permutation": { "iterations": 10000, "seed": 0 },
  "bootstrap":   { "iterations": 10000, "seed": 0, "level": 0.95 }
}
```

The values above illustrate the TASK-0014 parameters. They live in the trial's plan directory,
never in harness code.

**`analyze <plan> --repos <file>`** writes `benchmark/analysis/<plan-id>/analysis.json` and
`analysis.md`. The output is byte-identical on re-run, and reads only records, judgements and the
attempts log. The engine implements:
- **Matrix:** every planned run, which is either an evidence record or missing (exhausted
  infrastructure reruns, or not run). There is no imputation or reweighting.
- **Cells:** headline task × profile. A cell is defined only when each arm satisfies the declared
  primary completeness rule (`ceil-half-R`: at least ⌈R/2⌉ valid runs). Weights are equal over
  headline cells, and fixed.
- **Effects:** the weighted difference for `difference` measures. For `relative-reduction`, r =
  1 − ΣwK̄ ÷ ΣwB̄, with the four zero-value cases (B = K = 0 → 0; B = 0 < K → the deterioration
  margin met; K = 0 < B → 1).
- **Per profile** with the same formulas, and the per-profile classification.
- **Guardrails (C3, approved)** over all task × profile cells (headline and control), with the
  statuses `ok`, `breached` or `unknown`:
  - the cell statistic per arm is as declared (`mean` or `median`), over the arm's non-null
    values;
  - the pooled value is the equal-weight mean of the cell statistics over every task × profile
    cell;
  - a relative guardrail compares K ÷ B − 1, and an absolute guardrail compares K − B;
  - a guardrail is `unknown` when any cell fails the declared guardrail completeness rule in
    either arm (for `ceil-half-R`, fewer than ⌈R/2⌉ non-null values), or when B = 0 for a
    relative guardrail. A known value is never computed from an insufficient remaining subset;
  - thresholds come only from the specification.
- **Classification:** the five generic class predicates, evaluated in the declared
  `classification_order`. For Phase 8 that is Mixed → UNCLASSIFIABLE → Positive → Negative →
  Neutral, with the TASK-0014 revision 6 conditions. Every margin and threshold the predicates
  compare against comes from the specification.
- **Statistics:** a permutation test within each headline cell (whole runs as units), and a
  stratified percentile bootstrap by task × profile × condition. Both use seeded SHA-256-driven
  draws, the zero-value rules in every resample, and report the share of unbounded resamples.
  They are labelled supporting only.
- **Output:** each judge's verdicts separately (never averaged), the observed n per arm, every available descriptive result, unknown guardrails
  listed, the precision designation, the identity and attempt diagnostics from items 1 and 7,
  and judged and blinding statistics from item 3 in a separate secondary section.

**Tests:** synthetic records for each class, each Mixed trigger, each UNCLASSIFIABLE trigger, the
four zero-value cases, an undefined cell, an unknown guardrail under Positive and under Negative,
a LOWER PRECISION plan, and byte-identical re-runs.

## Implementation dependency order

1. **Version 2 formats and resolution** (items 5 and 4, structural): plan v2, the locations file,
   repository-qualified bundles, plan-directory files in the hash, `provenance.repositories`, and
   record v2. All later items read these.
2. **Item 1:** profile v2, the version probe and observed identity. The record v2 change lands
   with step 1, so records change version once.
3. **Item 2:** the Codex parser and the synthetic fixture. Independent after step 2.
4. **Item 7:** attempts and `rerun`. This is needed by item 6's infrastructure rate and item 9's
   matrix.
5. **Item 3:** judgements v2, the judges declaration and the audit sample.
6. **Item 8:** packet inspection inside `score --blind`, and `release` (after step 5's packet
   changes).
7. **Item 10:** `verify-exposure` (after steps 1–2, which define what it inspects).
8. **Item 4, remainder:** `freeze`, the location rule and `BENCH_PLAN_NOT_FROZEN` (after step 7),
   and the C1 `benchmark/plans/` exclusion with its protocol tests.
9. **Analysis-specification parser, then item 6** `calibrate` with pilot gating.
10. **Item 9** `analyze` (after steps 4, 5 and 9).
11. **`docs/PHASE-7.md` update**, the Codex real-CLI verification (Q4), and full verification.

## Owner decisions on revision 1 (2026-10-07)

| # | Decision |
|---|---|
| C1 | **Approved, option (a).** `benchmark/plans/` receives guarantee 7's exclusion through a narrow ADR-0004 clarification, applied on 2026-10-07 with the matching SPEC.md sentences. Ordinary protocol behaviour is otherwise unchanged. |
| C2 | **Approved.** `review_verdict` is never averaged. Counts are aggregated where meaningful. Each judge's verdict is preserved and reported, with agreement and disagreement. |
| C3 | **Approved.** Generic, plan-driven median-guardrail pooling and knownness. Data failing the pre-registered completeness rule makes the guardrail UNKNOWN; no known value is computed from an insufficient subset. Every threshold stays in the plan or specification. |
| C4 | **Approved.** The real Codex verification may use the synthetic Phase 7 smoke subject through a smoke plan. It is non-evidence, not a pilot and not a Phase 8 benchmark task, and needs no trial repository. |
| C5 | **Approved.** The harness enforces the gates it can observe. The owner's inspection and approval before packet release is a manual gate, recorded in trial provenance (`release`). |
| Compatibility | Version 2 extends Phase 7 only as TASK-0015 requires. Version 1 smoke material stays valid for its existing purpose. |

## Contract state

Revision 2 leaves no implementation-contract question open. These remain to be fixed later, and
are operational or experiment inputs, not contract gaps:
- the Codex model, flags and network authorization for the C4 verification, chosen when it is
  run, before acceptance;
- the provisional Codex event mapping, which that verification confirms or corrects;
- every experiment value (margins, thresholds, R, seeds, judges, terms), which the trial's plan
  directory supplies at its TASK-0014 gates.
