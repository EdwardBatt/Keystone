---
context_type: task
schema_version: 1
id: TASK-0013
title: Implement Phase 7 Benchmark Harness
status: accepted
priority: high
depends_on: [TASK-0012]
adrs: [ADR-0001, ADR-0002, ADR-0003, ADR-0004]
files:
  - docs/TASK-0012-phase-7-benchmark-harness-design.md
  - adr/ADR-0004-benchmark-harness-boundaries.md
  - SPEC.md
  - docs/PHASE-0-1.md
  - docs/PHASE-3.md
  - docs/REPO-SEPARATION.md
  - package.json
  - src/context/config.ts
  - src/parser/discovery.ts
  - src/context/selection.ts
  - src/review/records.ts
  - src/context/git.ts
  - src/review/git.ts
  - benchmark/specification/README.md
  - benchmark/specification/scorecard.json
  - benchmark/tasks/README.md
  - benchmark/scoring/README.md
  - docs/PHASE-7.md
  - src/benchmark/cli.ts
  - src/context/benchmark-records.ts
  - tests/phase7.test.mjs
  - tests/phase7-review.test.mjs
  - tests/phase7-review2.test.mjs
  - tests/phase7-review3.test.mjs
  - tests/fixtures/bench/smoke/tasks/smoke-change-app/task.json
  - tests/fixtures/bench/smoke/profiles/claude-code/profile.json
  - tests/README.md
  - README.md
created: 2026-10-05
completed: 2026-10-06
---
# TASK-0013 — Implement Phase 7 Benchmark Harness

## Objective
Implement the Phase 7 Benchmark Harness as the separate `keystone-bench` executable, and enforce
the `benchmark/results/` and `benchmark/analysis/` exclusions in the protocol. The authority is
ADR-0004, SPEC.md ("Benchmark harness", the `keystone-bench` CLI contract and the START
exclusions) and the accepted TASK-0012 contract
(`docs/TASK-0012-phase-7-benchmark-harness-design.md`, revision 3).

The harness is reusable measurement infrastructure. It makes no claim about Keystone's value, and
TASK-0013 produces no benchmark evidence.

## Acceptance Criteria
The implementation satisfies ADR-0004, SPEC.md, ADR-0001 as supplemented, ADR-0002, ADR-0003 and
the accepted TASK-0012 contract. Automated tests cover each criterion below except the smoke run
(criterion 25). The criteria restate the 22 accepted design scenarios (S1–S22), subject to the
owner's resolution of I1–I3 under Decisions / ADRs.

**Specifications**
1. (S1) Versioned, schema-validated formats exist for:
   - benchmark tasks: statement reference, sessions, oracle commands and seeded traps;
   - conditions: setup recipe and session instructions;
   - agent profiles: command template, timeout and usage parser, or `manual`;
   - experiment plans, including declared composite weights;
   - run and result records;
   - the scorecard definition.

   `keystone-bench validate` accepts the reference specifications. It rejects a malformed task,
   condition, profile or plan, each with a stable diagnostic code.
2. The reference conditions `baseline` and `keystone` are peer declarative definitions under
   `benchmark/specification/`. Neither is built into harness code (neutrality).

**Preparation and isolation (D23; ADR-0004 guarantee 3)**
3. (S2) `prepare` creates one fresh local clone per run, offline, at the subject commit pinned by
   the plan, and verifies that commit. The source subject repository stays byte-identical,
   including its refs, configuration and hooks.
4. (S3) No two runs, including repetitions of the same arm, share a working tree, refs,
   configuration or hooks.
5. No harness operation modifies the Keystone working tree, except to write result records under
   `benchmark/results/` and generated summaries under `benchmark/analysis/`.

**Execution (ADR-0004 guarantee 2)**
6. (S4) `run` with the deterministic fake agent completes a multi-session task. Each session is a
   separate process sharing only the workspace. The run records per-session timings, reported
   usage and oracle results.
7. (S5) A session timeout or agent failure is recorded truthfully as a failed session, and the run
   record stays schema-valid.
8. (S6) A `manual` profile waits for `record`. A recorded manual run scores identically to an
   equivalent automated run.
9. (S14) Repetitions and run ordering are seeded. The seed is recorded, and ordering is
   reproducible from it.

**Protocol boundary (ADR-0004 guarantee 1)**
10. (S7) Protocol commands are unchanged by Phase 7, except for the exclusions in criterion 23.
    `keystone validate` and `keystone context status` write no file under every harness telemetry
    setting. The existing read-only tests pass, plus one that runs both commands under each
    setting.
11. (S16) Protocol commands never execute a program declared in a benchmark specification (as
    interpreted under I1). Further requirements:
    - the `keystone` CLI gains no benchmark command or flag;
    - no protocol module imports `src/benchmark/`;
    - `keystone-bench` is a separate `bin` entry in `package.json`;
    - within the harness, only the operations allowed under I2 launch declared programs.
12. Keystone gains no model-provider SDK, credentials or network code. The harness adds no runtime
    dependency for model or network access.

**Telemetry (ADR-0004 guarantee 5)**
13. (S8) Harness telemetry has these properties:
    - opt-in: off unless the plan or run declares it;
    - content-free: no file contents, prompts or project text;
    - stored with the run's harness record, outside the measured workspace.

    Nothing is written to the workspace's `.context/telemetry/`. Declared instrumentation is applied
    identically to every condition. Instrumentation code lives under `src/benchmark/`, and
    `src/telemetry/` stays empty.

**Neutrality (ADR-0004 guarantee 4)**
14. (S17) A `baseline` run's workspace contains no Keystone files, configuration or executable on
    the session `PATH`, unless that condition's own setup declares them. The harness runs sessions
    with a controlled, recorded environment, so a developer's globally installed `keystone` cannot
    leak into a control condition.
15. (S18) Two conditions in one plan receive byte-identical:
    - task statements and oracles;
    - agent profile;
    - session structure, limits and budgets;
    - instrumentation.

    Only the declared condition setup and instructions differ, and their hashes are recorded.
16. (S19) Condition-specific diagnostics (for example the Keystone envelope size, or Keystone
    validation diagnostics computed outside the measured workspace after the final session) are
    reported separately. They never enter a cross-condition summary or a composite. The judged-
    measure input contains no condition identity.

**Scoring and reporting (D24; ADR-0004 guarantee 6)**
17. (S9) `score` computes every deterministic measure correctly on fixture runs with known
    answers, including a seeded-trap recurrence and a rework count.
18. (S10) Judged measures are imported, with attestation, against anonymised run IDs.
19. (S11) `report` produces a balanced scorecard per arm. Every measure carries its source label
    (`deterministic`, `reported` or `judged`), and `reported` values are never presented as
    verified. A composite is computed only when the plan declares weights.
20. (S13) Re-running `score` and `report` on the same results produces byte-identical output.

**Results and provenance (ADR-0004 guarantees 7 and 8)**
21. (S12) Result records are schema-valid and carry an evidence hash and full provenance:
    - Keystone version and commit, and the harness version;
    - subject repository identity and commit;
    - task, condition and agent-profile IDs with content hashes;
    - agent tool and model as declared by the profile and as reported by the tool;
    - seed, repetition number and timestamps.

    No transcripts or application content are stored.
22. (S22) Every run and result records the experiment plan's identity and content hash. After a
    plan changes:
    - `score` and `report` refuse records whose plan hash no longer matches, with a stable
      diagnostic;
    - `run` refuses to add runs to a plan whose content no longer matches its existing runs.
23. (S21) The root-level `benchmark/results/` and `benchmark/analysis/`, compared
    case-insensitively, are handled as `reviews/` is today:
    - never discovered, including under a configured parent source such as `benchmark` or `.`;
    - invalid as a configured source equal to or inside either directory (`CONFIG_INVALID`);
    - ineligible for START and review-context selection through every path, with a stable
      refusal reason and diagnostic.

    Other `benchmark/` subdirectories are unaffected.
24. (S20) A smoke run cannot be recorded as a benchmark result.

**Integration, safety and platform**
25. (B7) After the automated suite passes, one real-agent smoke run on the synthetic fixture
    subject shows that a real agent profile can be prepared, run, recorded and scored. It runs
    outside the automated suite, and its output is never stored under `benchmark/results/` (see
    I3).
26. (S15) The automated suite runs offline and uses only the fake agent. It passes on Windows
    paths with spaces. Failures are reported truthfully, in the Phase 6 style: no partial result
    record is left behind, and nothing claims a recovery that was not verified.

**Documentation and suite**
27. Documentation:
    - `docs/PHASE-7.md` (new) records the formats, file names, CLI operations, flags, outcomes,
      diagnostics, instrumentation, usage parsers, hashing and record formats. It adds no
      architectural requirement (ADR-0004 guarantee 9).
    - `docs/PHASE-0-1.md` and `docs/PHASE-3.md` describe the new exclusions.
    - `README.md`, `tests/README.md`, `keystone-bench` help and the `benchmark/*/README.md`
      placeholders describe Phase 7.
28. `npm run build`, `npm run check` and the full suite pass offline. The 209 pre-existing tests
    still pass. Any existing test that Phase 7 legitimately changes is disclosed with its reason.

## Scope
- The `keystone-bench` executable and its `validate`, `prepare`, `run`, `record`, `score` and
  `report` operations, under `src/benchmark/`.
- Specification formats and schemas, the reference conditions, the synthetic fixture subject and
  the deterministic fake agent.
- Harness telemetry and instrumentation, scoring, blinded judged import and reporting.
- The `benchmark/results/` and `benchmark/analysis/` exclusions in configuration validation,
  discovery and START.
- Tests, documentation and one real-agent smoke run.

## Out of Scope
- Phase 8 (Cross-model Trial): experiment plans with real content, real runs, results or analysis.
- Creating Repo B or adding any of its domain knowledge to Keystone.
- Any change to ADRs or SPEC.md. A resolution of I1–I3 that requires one goes through proposal
  and review first (D20).
- Changing protocol command behaviour beyond criterion 23, including adding telemetry to them, or
  using `src/telemetry/` or `.context/telemetry/`.
- The REVIEW subject boundary (`src/review/subject.ts`). ADR-0004 guarantee 7 names START and
  review-context selection only.
- Model-provider code, network code, credentials, transcript storage, GUIs, vector search and
  embeddings (D25).
- `context explain`, the CLOSE restoration limitation recorded in `docs/PHASE-6.md`, licensing and
  Git history rewriting.

## Dependencies
- TASK-0012 (accepted design, revision 3) and ADR-0004.
- ADR-0001, as supplemented by ADR-0002 and ADR-0004 guarantee 7.
- ADR-0002 (the `reviews/` exclusion pattern this task extends).
- ADR-0003 (unchanged; COMPACT's truthful-failure pattern is the model for criterion 26).
- D15, D23, D24 and D25.
- A local `git` executable, already required by START and REVIEW.

## Relevant Files
See the front-matter `files` links. New files expected:
- `src/benchmark/` modules and a `keystone-bench` CLI entry;
- specification schemas and the reference conditions under `benchmark/specification/`;
- the fixture subject and fake agent under `tests/fixtures/`, materialized as a Git repository at
  test time;
- `tests/phase7.test.mjs`;
- `docs/PHASE-7.md`.

## Decisions / ADRs
Implements ADR-0004 and the accepted TASK-0012 contract. Created as `proposed`; neither creating
nor validating it authorized implementation (AGENTS.md rule 10).

Three implementation-level questions are interpretations of ADR-0004 or SPEC.md that need owner
approval before coding. Each records a recommendation.

**I1 — "External programs" and the existing `git` invocations.**

ADR-0004 guarantee 1 says the protocol commands "never launch external programs". However:
- `init`, `context status` and `start` already run `git` through `src/context/git.ts`, and `review`
  runs it through `src/review/git.ts`. That behaviour comes from ADR-0001, ADR-0002 and SPEC.md.
- The harness itself needs `git` to clone the subject and verify the pinned commit.
- The TASK-0012 design describes the new capability as "executes arbitrary configured programs".

The options:
- (a) *Recommended.* "External programs" in ADR-0004 guarantees 1 and 2 means programs declared in
  benchmark specifications: agent commands, condition setup and task oracles. Keystone's fixed,
  offline invocations of the local `git` executable are outside that category. That covers the
  existing protocol uses, and the harness's clone and commit verification.

  Criteria 11 and 16 are tested on that basis: protocol commands never execute a declared program,
  never import `src/benchmark/`, and spawn nothing except through the existing Git wrappers.
  `docs/PHASE-7.md` records the interpretation; no ADR change.
- (b) As (a), but the owner also proposes an ADR-0004 clarification so the ADR text states it
  (D20 proposal and review).
- (c) Literal reading. It would require removing `git` from START, REVIEW and status, contrary to
  ADR-0001, ADR-0002 and SPEC.md, so it is not viable without reopening those decisions.

**I2 — Where condition setup commands execute.**

The two authorities point in different directions:
- ADR-0004 guarantee 2 and SPEC.md say only the harness's run operation may launch external
  programs, including condition setup.
- The TASK-0012 design describes `prepare` as "fresh clone per run and apply the condition".

The options:
- (a) *Recommended.* `prepare` performs only the clone, commit verification, declarative file
  overlays and the run manifest; it launches no declared program. `run` executes the condition's
  setup commands in the workspace before the first session. Setup is timed and recorded separately
  from sessions, so it never counts as agent effort. For a `manual` profile, `run` performs the
  setup and then waits for `record`.
- (b) `prepare` also executes setup commands, and `prepare` and `run` together are treated as "the
  run operation". The workflow is simpler, but it departs from the literal guarantee.

**I3 — The real-agent smoke run (criterion 25).**

The smoke run needs an owner-chosen agent tool, with that tool's own network access and
credentials. Neither may enter Keystone. The recommendation:
- the owner chooses the agent CLI and model, and authorizes this single use of the network;
- the run uses a non-interactive agent profile against the synthetic fixture subject;
- the output goes to a scratch location outside the repository and is never stored under
  `benchmark/results/`;
- a summary is recorded in this task's Tests section and in `docs/PHASE-7.md`: date, profile ID,
  declared tool and model, and the outcome of each operation. It contains no transcript,
  credentials or prompts.

The owner may instead perform the smoke run themselves and relay the summary. This choice does
not block starting implementation; it is needed before acceptance.

**Owner decisions made on 2026-10-06:** I1 and I2 approved as recommended, I3 deferred, and
TASK-0013 authorized to move from `proposed` to `active`, with Phase 7 implementation to begin.
- **I1 (a).** ADR-0004's prohibition on launching external programs applies to the agent, setup
  and test (oracle) commands declared by benchmark specifications. Keystone's existing fixed,
  offline Git invocations are not included. No ADR amendment is required.
- **I2 (a).** `prepare` creates the isolated workspace and stages or copies declared inputs only.
  `run` executes condition setup commands, and setup timing is recorded separately from agent
  execution.
- **I3 deferred.** The exact smoke-run configuration is settled when implementation reaches that
  acceptance step. The plan is to use Claude Code as the real-agent tool unless an implementation
  constraint gives reason to reconsider. The smoke run is integration verification only and never
  benchmark evidence.

**I3 resolved by the owner on 2026-10-06.** Claude Code, model Sonnet, permission mode
`acceptEdits`, condition `baseline`, 1 repetition, a 600-second session timeout, and a smoke
purpose only. A clean smoke-specific task is used instead of the fake agent's prompts. The owner
authorized the single Claude Code invocation, using the existing authenticated installation and
account.

Informational (no approval needed, follows from ADR-0004 or the accepted design):
- The synthetic fixture subject cannot be committed as a nested Git repository. Tests materialize
  it into a temporary directory and commit it there.
- Keystone validation diagnostics for a Keystone condition (criterion 16) are computed in process,
  after the final session, against a copy or read-only, never in the measured workspace while
  sessions run.
- An independent review before acceptance is expected, as for TASK-0007, TASK-0009 and TASK-0011.

## Implementation Notes
Authorized on 2026-10-06. Implemented, and the real-agent smoke-run gate (criterion 25) passed on
2026-10-06 (see Tests). Independent review round 1 (NOT VERIFIED, eight blockers) was remediated on
2026-10-06, and the round 2 re-review's three remaining blockers were remediated the same day (see
Review Findings). `docs/PHASE-7.md` records the mechanisms. Final independent review: VERIFIED.
Accepted by the owner on 2026-10-06.

What changed:
- **`keystone-bench`** (`src/benchmark/`), a separate `bin` in `package.json`:
  - `specs.ts`: formats, bundles and plan provenance hashing;
  - `process.ts` and `shim-runtime.ts`: the controlled environment, tool and instrumentation
    shims, and timeouts with process-tree kill;
  - `git.ts`: fixed offline Git operations (I1);
  - `prepare.ts`: the matrix, seeded order, and clone and stage only (I2);
  - `run.ts`, `record.ts`, `score.ts`, `report.ts`, `validate.ts`, `store.ts` and `cli.ts`.
- **Specification formats**: JSON Schemas in `benchmark/specification/schemas/`, the scorecard
  definition `benchmark/specification/scorecard.json`, and the peer reference conditions
  `benchmark/specification/conditions/{baseline,keystone}`.
- **Protocol exclusions** (criterion 23): `src/context/benchmark-records.ts`, applied in
  `src/context/config.ts`, `src/parser/discovery.ts` and `src/context/selection.ts`. These are the
  only protocol source changes. The REVIEW subject boundary is unchanged.
- **Fixtures**: `tests/fixtures/bench/`, holding the synthetic subject, a task with task,
  regression and trap oracles and a fix loop, the fixture conditions, the deterministic fake agent
  and a manual profile.
- **Documentation**:
  - `docs/PHASE-7.md` (new);
  - `docs/PHASE-0-1.md` and `docs/PHASE-3.md`: the exclusions;
  - `README.md`, `tests/README.md`, the `benchmark/*/README.md` placeholders and
    `keystone-bench --help`.

Reconciliations within the accepted contract, applied without architectural change:
- **`record` launches nothing.** ADR-0004 guarantee 2 lets only the run operation launch
  programs. A manual run is therefore `run` (setup and prompts) → `record` (the person's session
  data) → `run` (the final oracle check and the record).
- **Telemetry scope.** The basic run record (session timings and exit codes, oracle results and
  reported usage) is always kept, because it is the run's outcome. Opt-in telemetry adds
  declared-tool instrumentation and the post-session workspace inspection that gives the Keystone
  diagnostics.
- **Limits belong to the plan.** Session, setup and oracle timeouts cannot be declared by a
  condition, so every condition has identical limits (neutrality).
- **Measure definitions:**
  - `trap_recurrences` counts trap oracles failing at the final check;
  - `rework_sessions` counts the fix sessions run under the task's declared fix loop;
  - `tool_*` measures are primary only when the tool resolves in every run of the plan, and
    otherwise are condition-specific diagnostics.
- **`PATH` guard.** The base environment, identical for every condition, removes operator `PATH`
  directories that provide `keystone` or `keystone-bench`. That keeps a globally installed
  Keystone out of a control condition (criterion 14).
- **CLI details.** `validate` takes an optional `<plan>`. `record <run-id>` also takes
  `--plan` and `--input`. `score` takes `--blind <dir>` or `--judged <file>`. SPEC.md leaves exact
  flags to the implementation contract.
- **Self-hosting consequence.** The accepted TASK-0012 links `benchmark/results/README.md` and
  `benchmark/analysis/README.md` in its `files`. START for TASK-0012 now reports
  `START_BENCHMARK_RECORD_INELIGIBLE` twice; the outcome stays `complete`. That is the intended
  ADR-0004 behaviour, and the accepted task is not edited. TASK-0013 no longer links those files.

Existing tests: none were amended.

The known gaps recorded by TASK-0012 are inside this task's scope:
- the exclusion enforcement (criterion 23);
- the documentation updates and `docs/PHASE-7.md` (criterion 27).

## Tests
Baseline at task creation (2026-10-05, commit `44548dd`):
- `npm run build` and `npm run check` passed.
- `npm test` passed 209 of 209, with no failures, skips or cancellations.
- `validate` passed with 18 artifacts and no diagnostics.
- After `index`, `context status` reported configuration present and the index current.
- START for TASK-0013 was `complete` with no diagnostics:
  - ADR-0001, ADR-0002, ADR-0003 and ADR-0004 bind at Tier 1;
  - TASK-0010, TASK-0011 and TASK-0012 are supporting material;
  - the TASK-0012 design notes are evidence.

No source code, test, schema or template had changed at that point.

Verification after implementation, on 2026-10-06:
- `npm run build` and `npm run check` passed.
- `npm test` passed 228 of 228, with no failures, skips or cancellations:
  - the 209 pre-existing tests, unmodified;
  - 19 new tests in `tests/phase7.test.mjs`.
- Acceptance-criteria coverage in `tests/phase7.test.mjs`:
  - criteria 1–2: validation, stable codes and peer reference conditions;
  - 3–5: per-run clones, isolation (no remote, alternates or hooks; independent configuration),
    and an unchanged subject and Keystone tree;
  - 6 and 17: multi-session processes and known-answer scoring, including a trap recurrence and
    two rework sessions;
  - 7: a failed session, a timed-out session and a failed setup;
  - 8: manual-mode equivalence;
  - 9: seeded order;
  - 10: `validate` and `context status` through the harness shims, with telemetry on and off;
  - 11–12: the static process, import, network and dependency boundary, and `keystone bench`
    refused;
  - 13: content-free, opt-in telemetry;
  - 14: no operator `keystone` or variables in a baseline;
  - 15: identical inputs across conditions;
  - 16 and 18: diagnostics kept apart, the blinded packet and judgement import;
  - 19–20: the balanced report, composites, and byte-identical re-runs;
  - 21: provenance and tamper refusal;
  - 22: plan and bundle change detection;
  - 23: the exclusions in discovery, configuration, START and review context;
  - 24: smoke plans;
  - 26: truthful write failure and no temporary files.
- Mutation checks: the suite fails when any of these is reintroduced:
  - the `PATH` guard is removed, or the environment allow-list is bypassed;
  - the START, discovery or configuration exclusion is removed;
  - the plan-hash, smoke or evidence-hash refusal is removed;
  - the judging packet carries the condition;
  - a diagnostic is scored as a primary measure;
  - `prepare` runs setup;
  - a staged temporary file is left after a failed rename.
- Self-hosting:
  - `validate` passed with 18 artifacts and no diagnostics;
  - after `index`, `context status` reported the index current;
  - START for TASK-0013 was `complete` with ADR-0001–ADR-0004 binding at Tier 1;
  - `keystone-bench validate --root .` was `valid`.
- Exploratory end-to-end run on Windows, in a path with spaces, with the reference `baseline` and
  `keystone` conditions and a fake operator-installed `keystone` on `PATH`:
  - baseline: the operator `keystone` was removed and the workspace held no Keystone files;
  - keystone: Keystone was installed only by the condition's own `keystone init`, with 0
    validation diagnostics.
Real-agent smoke run (criterion 25), 2026-10-06, under the owner-approved configuration (I3):
- **Configuration:**
  - agent: Claude Code (`claude.exe`, the existing authenticated installation);
  - profile `tests/fixtures/bench/smoke/profiles/claude-code`: `claude -p --output-format json
    --model sonnet --permission-mode acceptEdits`, prompt on stdin, `claude-code-json` usage
    parser, `CLAUDE_CODE_GIT_BASH_PATH` passed by name;
  - task: the clean smoke task `tests/fixtures/bench/smoke/tasks/smoke-change-app`, with one
    session, a task oracle, a regression oracle and no `FAKE` directives;
  - plan: condition `baseline`, 1 repetition, a 600-second session timeout, telemetry wrapping
    `git`, and `"purpose": "smoke"`;
  - subject: the fixture subject materialized at commit `35adf6d8`, in a scratch path with spaces;
  - plan hash: `497ccc62324d…`.
- **Invocation:** a single Claude Code session (`R-4608ee0c1ac2`), from 03:02:24Z to 03:02:35Z.
  `prepare`, `run`, `score` and `report` reported `prepared`, `completed`, `scored` and
  `reported`.
- **Captured truthfully:**
  - the session was `ok` (exit 0), lasting 10,412 ms;
  - reported usage: 70,720 input tokens (including cache), 305 output tokens and 2 turns;
  - reported model `claude-sonnet-5-5`, alongside the declared alias `sonnet`;
  - change statistics: 1 file, +1/−1;
  - both oracles passed, and the workspace's `src/app.txt` is exactly `two\n`.

  The record is schema-valid, its evidence hash verifies, and it holds no prompt, statement or
  agent output text. The provenance is truthful: Keystone commit `44548dd` with `dirty: true`,
  since TASK-0013 is uncommitted.
- **Required state:**
  - the subject repository was byte-identical afterwards, including `.git`;
  - the measured workspace was at the pinned commit, with no remote, and its only change was the
    intended edit, with no stray or ignored files;
  - the Keystone working tree was unchanged by the run.
- **Not evidence:**
  - the record, scores and report exist only under `<work>/smoke/`;
  - Keystone's `benchmark/results/` and `benchmark/analysis/` still contain only their
    `README.md` files;
  - the same record, placed among an experiment plan's results under a scratch root, was refused
    with `BENCH_SMOKE_NOT_EVIDENCE` (exit 1).
- **Unexpected behaviour (informational, not a defect):**
  - the `git` instrumentation recorded 5 invocations, one exiting 2. These were Claude Code's own
    internal Git calls: the agent's instructions asked for no commands. `tool_*:git` measures
    therefore include an agent tool's internal use of a wrapped tool, identically under every
    condition. Phase 8 should take this into account when choosing what to wrap.
  - the run took 11 seconds against the 600-second limit.
- **Cosmetic fix found:** `prepare`'s human-readable output printed `R-…: undefined` for runs
  without a per-run outcome. Fixed in `src/benchmark/cli.ts`; JSON output was unaffected.
- **After the gate:**
  - `npm run check` passed;
  - `npm test` passed 228 of 228;
  - `validate` passed with 18 artifacts;
  - after `index`, `context status` reported the index current;
  - START for TASK-0013 was `complete` with no diagnostics;
  - `keystone-bench validate --root .` was `valid`.

Verification after the round 1 remediation, on 2026-10-06:
- After a clean rebuild, `npm run build` and `npm run check` passed.
- `npm test` passed 237 of 237, with no failures, skips or cancellations:
  - the 209 pre-existing tests, unmodified;
  - 19 tests in `tests/phase7.test.mjs`;
  - 9 in `tests/phase7-review.test.mjs`.
- All 11 reintroduced root causes were caught (see Review Findings).
- Self-hosting: `validate` passed with 18 artifacts; after `index`, `context status` reported the
  index current; START for TASK-0013 was `complete` with no diagnostics; `keystone-bench validate`
  was `valid`.
- The smoke run was not repeated; it predates the remediation. Every remediated path is covered by
  offline tests, and the B1 adversarial re-run used this machine's real Git configuration.

Verification after the round 2 remediation, on 2026-10-06:
- After a clean rebuild, `npm run build` and `npm run check` passed.
- `npm test` passed 243 of 243, with no failures, skips or cancellations:
  - the 209 pre-existing tests, unmodified;
  - 19 in `phase7.test.mjs`;
  - 9 in `phase7-review.test.mjs`;
  - 6 in `phase7-review2.test.mjs`.
- 7 round 2 re-breaks were caught:
  - `guard()` made a no-op;
  - workspace and harness checks removed;
  - the post-session check removed;
  - durable-write guards removed;
  - packet guards removed;
  - identity trusted unconditionally;
  - the manual identity check removed.

  The post-session re-break was first missed, because a later state-write refusal masked it. The
  test was tightened to require the point-of-use refusal, and now catches it.
- Self-hosting:
  - `validate` passed with 18 artifacts;
  - after `index`, `context status` reported the index current;
  - START for TASK-0013 was `complete` with no diagnostics;
  - `keystone-bench validate` was `valid`;
  - `benchmark/results/` and `benchmark/analysis/` still contain only their `README.md` files.

Closeout verification on 2026-10-06, after acceptance (no implementation changes):
- After a clean rebuild, `npm run build` and `npm run check` passed.
- `npm test` passed 248 of 248, with no failures, skips, cancellations or todos.
- `validate` passed with 18 artifacts. After `index`, `context status` reported configuration
  present and the index current.
- START, compiled for inspection only:
  - TASK-0013 (now `accepted`) was `complete` with no diagnostics, with authorization
    `not-established`;
  - TASK-0012 was `complete` with its two expected `START_BENCHMARK_RECORD_INELIGIBLE` notices.
- `keystone-bench validate` was `valid`.
- `benchmark/results/` and `benchmark/analysis/` contain only their `README.md` files.
- All 13 tasks are `accepted`, and TASKS.md lists none as active.
- No Phase 8 task exists, and no Repo B exists.

## Review Findings
**Round 1: Codex independent review, 2026-10-06. Verdict: NOT VERIFIED, with eight blocking
findings.** Recorded as relayed by the owner; the full review text was not provided to this
session. TASK-0013 remained `active`.

Each blocker was reproduced before it was fixed. `tests/phase7-review.test.mjs` contains one
regression test per blocker (B4 has two), and all 9 failed against the unremediated code for the
reported reason. Each root cause below was then reintroduced in the built output, and the matching
test failed every time (11 reintroductions).

1. **B1 — indirect program execution through Git configuration.**
   - **Reproduced:** with an operator global config defining a filter driver selected by the
     subject's `.gitattributes`, `prepare` ran the configured smudge program 3 times. This
     machine's real system and global config define `filter.lfs` (git-lfs) in the same way.
   - **Root causes:**
     - harness Git read system and global configuration;
     - snapshots and diffs ran against the workspace's own `.git/config`, which the agent
       controls, so agent-defined clean and textconv drivers would run under `run` and `score`.
   - **Fixed** (`src/benchmark/git.ts`):
     - `GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_ATTR_NOSYSTEM` on every
       harness Git call;
     - snapshots, statistics and patches use a harness-owned bare repository
       (`harness/snapshots.git`) with `GIT_WORK_TREE`;
     - diffs pass `--no-textconv`;
     - Keystone's `dirty` provenance is computed in Node from `ls-tree` blob hashes instead of
       `git status`.
   - **Test:** global smudge, clean, textconv and fsmonitor programs, and agent-defined workspace
     drivers, ran during none of prepare, run, score `--blind` or report. The test first proves the
     configuration is live with an ordinary clone. It also checks that snapshots and patches still
     capture the change.
   - **Adversarial re-run:** a harness clone and checkout under this machine's real `filter.lfs`
     configuration started no filter process. The only child process was Git's own `upload-pack`.
2. **B2 — lexical containment checks bypassed by junctions.**
   - **Reproduced:** `prepare` accepted a work directory reached through a junction into the
     subject, and would have created workspaces inside it.
   - **Root cause:** `within()` compared lexical paths, and nothing inspected aliases on the
     results path.
   - **Fixed** (`src/benchmark/store.ts`):
     - `physical()` resolves the real path of the nearest existing ancestor;
     - work, subject and root containment are compared physically, and the `runs/` directory may
       not be an alias;
     - for experiments, results and analysis must be reached through no link or junction and lie
       physically inside the Keystone tree, outside the subject and work directory
       (`BENCH_RESULTS_INVALID`).
   - **Test:** junctions from the work directory into the subject and into the Keystone tree are
     refused, as is a `benchmark/results` junction into the subject for prepare, run, score and
     report. The subject stays byte-identical.
3. **B3 — stale staged inputs adopted by a new plan hash.**
   - **Reproduced:** a preparation failed after staging a run. The plan was then changed, and the
     next `prepare` reported the stale run `unchanged` under the new hash.
   - **Root cause:** the manifest was written only after every run was prepared, and run state was
     not bound to a plan hash.
   - **Fixed:** the manifest is written before any run is prepared. Each run's state records its
     plan hash, and `prepare` and `run` refuse a mismatch (`BENCH_PLAN_CHANGED`).
   - **Test:** after the failure and the plan change, `prepare` and `run` are blocked and no result
     record is written.
4. **B4 — untruthful write and state failures.**
   - **Reproduced:**
     - a partial temporary write was left behind and not reported;
     - a run whose final state write failed returned `completed`.
   - **Root causes:**
     - the temporary file was tracked only after a successful write, and content was verified
       only after the rename;
     - `install()` ignored the state write result.
   - **Fixed:**
     - `writeVerified` tracks the temporary file from before the write and verifies it before the
       rename, so nothing unverified is installed. An unremovable temporary file is reported, and a
       failed post-rename read-back is `BENCH_WRITE_UNVERIFIED`;
     - every state write failure is reported (`BENCH_STATE_WRITE_FAILED`), and the run outcome is
       `failed`.
   - **Tests** (injected `node:fs` failures, as in Phases 5 and 6): partial write with and without
     unlink failure; corrupted verification; and final state write failure. In the last case the
     outcome is `failed`, the record stands, and the run is not executed again.
5. **B5 — blinded evidence taken from mutable state.**
   - **Reproduced:** the packet's trees came from `state.json`, which the sealed record did not
     cover.
   - **Fixed:** run records carry `evidence: { setup_tree, final_tree }`, covered by the evidence
     hash (schema updated), and the packet uses only those.
   - **Test:** substituting the trees in the run state does not change the packet. Substituting
     them in the record is refused (`BENCH_RESULT_EVIDENCE_MISMATCH`).
6. **B6 — tool universality decided from completed records only.**
   - **Reproduced:** `tool_seconds:helper` became a primary, comparable measure when the only
     condition without the tool failed in setup.
   - **Fixed:** a tool is universal only when every planned run in the plan's matrix is recorded,
     whatever its status, and resolved the tool.
   - **Test:**
     - failed-setup arm: the tool stays a diagnostic and the composite is `null`;
     - subset run: the tool is a diagnostic until every planned run is recorded, then primary.
7. **B7 — Markdown labels used scorecard defaults.**
   - **Reproduced:** a reported manual `session_seconds` was labelled `[deterministic]`.
   - **Fixed:** headers list the sources actually recorded, and cells in mixed-source columns
     name their own.
   - **Test:** a mixed fake and manual plan. The header reads
     `session_seconds [deterministic, reported]`, the manual cells end `[reported]`, and the fake
     cells end `[deterministic]`.
8. **B8 — free-text tool and model identifiers.**
   - **Reproduced:** agent-reported text reached the record through `usage.model`.
   - **Fixed:** an identifier rule (`^[A-Za-z0-9][A-Za-z0-9._:/@+,-]{0,255}$`) applies in the
     parsers (at most 4 Claude model names), and in the usage, manual-record, profile and run-record
     schemas.
   - **Test:** marker-bearing agent identifiers become `null`, valid ones are kept, a free-text
     Claude model key is dropped, and schemas reject free-text manual and profile identifiers. A
     first version of the fix also rejected legitimate comma-joined model lists; the existing
     parser test caught it, and the rule was corrected.

**Non-blocking (preserved, not fixed):** a `score --blind` export that fails part way leaves the
files already written in the packet directory. The outcome is `failed`, and the next export
refuses the non-empty directory. This is recorded in `docs/PHASE-7.md` known limitations, and no
change was made to it.

Supporting changes:
- `tests/bench-helpers.mjs` (shared helpers, extracted from `tests/phase7.test.mjs` without
  changing them);
- a fake-agent `identity` directive;
- `docs/PHASE-7.md` updated for every remediated mechanism and the new codes.

No accepted design decision or ADR-0004 guarantee was changed.

**Round 2: Codex independent re-review, 2026-10-06. Verdict: NOT VERIFIED.** Recorded as relayed
by the owner. Codex verified B1 and B3–B7. B2 and B8 remained open, and a new blocker was found.
TASK-0013 remained `active`.

Each finding was reproduced first. `tests/phase7-review2.test.mjs` has 6 tests covering Codex's
exact bypasses and adjacent variants, and all 6 failed against the round 1 code. Afterwards, 7
re-breaks of the protections were each caught.

1. **B2 — descendant alias substitution after validation.**
   - **Reproduced:**
     - Codex's two cases: a `runs/<id>/workspace` replaced by a junction to the subject after
       `prepare`, after which `run` completed and modified the subject; and a
       `benchmark/results/<plan>/runs` junction to the subject, after which a durable record was
       installed inside it;
     - variants: the harness directory swapped after `prepare`, or by the agent during a session;
       and the `judgements/` and analysis directories swapped.
   - **Root cause:** physical containment was checked once per command, on top-level paths, and
     never at the destination actually written, removed, or launched in.
   - **Fixed:** a shared write boundary (`Boundary` and `guard()` in `src/benchmark/store.ts`)
     covers the work, results and analysis boundaries, and is enforced at every point of use:
     - `writeVerified` now requires a boundary and checks it before creating the directory, after
       creating it and before the rename;
     - `prepare` checks before removal, mkdir, clone and staging, and failure cleanup removes only
       a run directory still inside its boundary;
     - `run` checks the workspace and harness before setup, every setup command, every session
       (before and after), every oracle and every snapshot, and checks shim, prompt and usage
       destinations;
     - `record`, judgement import, scores, reports and the blinding key write through their
       boundaries.

     A refusal surfaces as `BENCH_WORK_INVALID` or `BENCH_RESULTS_INVALID`, never as an incidental
     error.
   - **Tests:** Codex's two cases; harness substitution before the run and during a session (the
     refusal must come from the point-of-use check, not a failing Git operation); and judgements
     and analysis substitution. The subject stays byte-identical in each case.
2. **New blocker — blinded export into the subject.**
   - **Reproduced:** an empty `--blind` destination reached through a junction into the subject
     was accepted, and the statement, patch and `packet.json` were written into the subject.
   - **Root cause:** the destination was checked lexically, against the Keystone tree and the work
     directory only.
   - **Fixed:** the packet has its own boundary. Its base is the destination's parent, and the
     subject, Keystone tree and work directory are forbidden physically. Every packet file is
     guarded at its write (`BENCH_BLIND_OUTPUT_INVALID`, outcome `blocked`).
   - **Tests:** Codex's case; a destination that is itself a junction to an empty subject
     directory; destinations through junctions into the work directory and the Keystone tree; and
     a legitimate external destination, which still works.
3. **B8 — free-text identifiers.**
   - **Reproduced:** Codex's `SECRET_TASK_CHANGE_SRC_APP_TXT_TO_TWO`, and a URL, entered the record
     as agent-reported identifiers.
   - **Root cause:** a character and length rule cannot establish that agent-supplied text names a
     tool or model.
   - **Fixed:** durable identity comes from trusted, declared configuration. A profile declares
     `trusted: { tools, models }`, part of its hashed, operator-authored bundle. A reported tool, or
     each member of a comma-separated model list, is persisted only on an exact match. Anything
     else is dropped and flagged with the content-free `unrecognized_identity: true`. Manual
     records may name only trusted identities. The fake, manual and smoke profiles now declare
     theirs; the smoke profile trusts `claude-sonnet-5-5`, the model the smoke run reported.
   - **Tests:**
     - Codex's string and a URL are kept out of the record, and are flagged;
     - Claude Code reporting two trusted models stays comma-joined;
     - an untrusted member is dropped and flagged, and an empty trust list keeps nothing;
     - a manual record naming an untrusted model is refused.

Existing tests adjusted, each because round 2 tightened a rule that a test of mine had encoded:
- three parser assertions now pass a trusted set, or expect `null` for untrusted values
  (`tests/phase7.test.mjs`, round 1 B8);
- two direct `writeVerified` tests now pass a boundary. Without one, the call failed for an
  unrelated reason that happened to match the expected code.

Audit of Phase 7 write sites: every `writeFile`, `copyFile`, `mkdir`, `rm`, `rename`, clone, shim,
snapshot and process launch in `src/benchmark/` was classified into one of the four boundaries
above and guarded.
- The shim runtime's tool-log append runs inside an agent session. Like any other agent-time
  write, it falls under the documented agent sandboxing limitation.
- The remaining window between a check and its write is the same pathname-race limitation as
  every Keystone command; `docs/PHASE-7.md` records it.

**Smoke run:** not repeated. Agent invocation and session behaviour are unchanged: the added
checks run only between harness steps, and identity filtering is post-processing.

**Non-blocking (unchanged):** partial judging packets, as recorded above.

**Round 3: Codex findings and owner clarification of the threat boundary, 2026-10-06.** The owner
stopped the iterative alias-patching cycle and set the isolation boundary. It is recorded in
ADR-0004 "Clarification (2026-10-06)", with a one-sentence pointer in SPEC.md "Benchmark harness".
- The harness defends against deterministic aliases present when it acts: paths, symbolic links,
  junctions and other reparse points, and pre-existing hard-linked output destinations.
- It is not an OS-level sandbox against concurrent hostile mutation; the check-to-write race is an
  accepted limitation.
- Agent sessions remain non-sandboxed.
- No guarantee is weakened, and known deterministic bypasses are still not permitted.

The SPEC sentence was added so that "the source subject is never modified" is not read as a
sandbox claim, rather than leaving that contradiction silent (AGENTS.md rule 3).

The findings were resolved under that boundary. `tests/phase7-review3.test.mjs` has 5 tests.
Against the round 2 code, 4 failed and reproduced the findings; the fifth, explained below, already
passed.
1. **Snapshot repository alias.**
   - **Reproduced:** a pre-existing `harness/snapshots.git` junction to the subject's `.git` let
     `run` complete. So did an `objects/` junction created during a session.
   - **Root cause:** the harness repository and its contents were not covered by the
     point-of-use checks.
   - **Fixed:** `guardTree()` checks the repository and every directory inside it for aliases,
     together with the index file. It runs in the workspace and harness check before every
     snapshot, and before `score --blind` patches.
2. **Hard-linked outputs.**
   - **Reproduced:** a pre-existing `harness/prompts/s1.md` hard-linked to the subject's
     `README.md` was written through, and the subject changed.
   - **Root cause:** prompt, shim, staging and packet files were written in place with
     `writeFile` or `copyFile`.
   - **Fixed:** every harness output file goes through `writeVerified`. It writes a fresh temporary
     file and renames it over the target, which replaces the entry rather than writing through it,
     and it now handles bytes. Prompts, shims, staged condition files and packet files now use it,
     and the shims' tool log is removed before each run.
   - **Blinded-export case:** it was not reproducible as a bypass. A destination holding a
     hard-linked file is non-empty, and was already refused. The test covers that refusal, and a
     direct replace-not-write-through check of the packet writer.
3. **Trusted multi-model serialization.**
   - **Reproduced:** trusted models, each schema-valid, whose comma-joined form exceeds the
     256-character durable model field passed `validate`.
   - **Fixed (early validation):** trusted model entries may not contain `,`, and their full
     serialization must fit the field (`BENCH_TRUSTED_IDENTITY_INVALID`). Every recorded value is
     a subset of it.
   - **Test:** over-bound and separator-bearing configurations are rejected. An at-bound
     configuration (exactly 256 characters) validates, and yields a schema-valid usage value.

Four re-breaks were each caught:
- the snapshot repository not guarded;
- prompts written in place;
- `writeVerified` writing through the target instead of renaming;
- the trusted-model bound not validated.

**Final: Codex independent review, 2026-10-06. Verdict: VERIFIED — ready for owner acceptance.**
Recorded as relayed by the owner; the full review text was not provided to this session. No
blocking findings remain. One non-blocking finding is deferred (below).

## Outcome
Accepted on 2026-10-06 with owner authorization, after final independent verification
(VERIFIED). Phase 7 (Benchmark Harness) is complete:
- `keystone-bench`, the separate harness executable, satisfies ADR-0004 (including its
  2026-10-06 isolation clarification), SPEC.md ("Benchmark harness" and the START exclusions) and
  the accepted TASK-0012 contract. It covers `validate`, `prepare`, `run`, `record`, `score` and
  `report`.
- The `benchmark/results/` and `benchmark/analysis/` exclusions are enforced in configuration,
  discovery, START and review context.
- Owner decisions I1, I2 and I3 are applied. The real-agent smoke run passed as integration
  verification only, and produced no benchmark evidence.
- Independent review rounds 1–3 were remediated, with a regression test and a re-break check for
  every finding.
- `docs/PHASE-7.md` records the mechanisms.
- Final verification: 248 of 248 tests passing.

**Deferred non-blocking finding:** a `score --blind` export that fails part way may leave a
partial packet directory. The outcome is `failed`, and because the next export refuses a non-empty
destination, that directory must be cleaned up before a retry. This is recorded in
`docs/PHASE-7.md` known limitations.

Not started, and not authorized by this task:
- Phase 8 (Cross-model Trial): no Phase 8 task has been created;
- the benchmark application (Repo B);
- any experiment plan, real benchmark run or benchmark result. `benchmark/results/` and
  `benchmark/analysis/` contain only their README files.
