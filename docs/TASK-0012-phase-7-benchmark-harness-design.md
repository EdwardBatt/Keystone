# TASK-0012 — Phase 7 Benchmark Harness design notes

**NON-AUTHORITATIVE DESIGN RECORD — revision 3, accepted with TASK-0012 on 2026-10-05.** It does not authorize implementation, which belongs to a separately
authorized Phase 7 implementation task. The authority is:
- SPEC.md, including its "Benchmark harness" section;
- D01–D26;
- PROJECT.md;
- `docs/REPO-SEPARATION.md`;
- ADR-0001, ADR-0002 and ADR-0003;
- ADR-0004, "Benchmark harness boundaries", adopted on 2026-10-05.

Mechanisms here are implementation guidance, except where ADR-0004 or SPEC.md retains them.

## Owner resolution (2026-10-05)

| Decision | Resolution |
|---|---|
| B1 Agent execution | (b) Generic external-command runner via agent profiles, with a manual mode. |
| B2 Conditions | (b) Declarative, versioned conditions, separate from agent profiles; a fresh clone per run. |
| B3 Content location | (b) Generic specifications and fixtures in Keystone; application task content in Repo B, pinned by commit; Repo B not created in Phase 7. |
| B4 Scorecard | (c) Balanced, source-labelled scorecard; a composite only from weights declared in an experiment plan. |
| B5 Telemetry | **Modified.** Telemetry stays opt-in, local and content-free, but belongs to `keystone-bench` or an explicitly invoked instrumentation mechanism. Ordinary `keystone` commands keep their existing read-only semantics; enabling telemetry never makes `keystone validate` or `keystone context status` write files. |
| B6 Trial design | (b) Repetitions, seeded ordering, multi-session tasks and blinded judged scoring. |
| B7 Phase 7 / 8 boundary | (b) Offline fixture suite with a fake agent, plus one real-agent smoke run. The smoke run is integration verification only and never benchmark evidence. |
| B8 Results | (b) Durable, non-authoritative records in `benchmark/results/`; never discovered, START-ineligible, refused as sources. |
| Command surface | (b) A separate `keystone-bench` executable. |
| ADR-0004 | Adopted on 2026-10-05 as drafted, with a guarantee 8 clarification: every recorded run and result identifies the exact experiment plan it used through immutable provenance, sufficient to detect any later change to that plan, and the plan is fixed before its runs begin. |
| Location | `src/telemetry/` stays reserved and unused in Phase 7; harness instrumentation belongs under `src/benchmark/`. |
| SPEC.md | Amendment applied on adoption (see "SPEC.md amendment"). |
| **Added invariant** | **Neutrality.** The harness is neutral between Keystone and control conditions. It must not require or structurally privilege Keystone in the environment being measured. |

The analysis sections below are kept from revision 1. Where an owner resolution differs from the
revision 1 recommendation, the section says so.

## Neutrality invariant (owner, 2026-10-05)

The harness is a measuring instrument; it must not favour the treatment it measures:
- **No Keystone in the instrument.** The harness never installs, requires or invokes Keystone in a
  measured workspace. A Keystone condition puts Keystone there through its own versioned setup
  recipe, exactly as any condition does for its own tools.
- **Peer conditions.** `baseline` and `keystone` are both ordinary declarative condition
  definitions; neither is built in.
- **Identical treatment.** For every condition in an experiment, these are identical:
  - task statements and oracles;
  - agent profiles;
  - session structure, limits and budgets;
  - instrumentation;
  - scoring procedures.

  Condition instructions are declared, versioned and hashed in the record.
- **Condition-neutral measures.** Primary measures must exist for every condition. Measures that
  exist only under some conditions (for example Keystone context size or Keystone validation
  diagnostics) are *condition-specific diagnostics*: reported separately, and never part of a
  cross-condition comparison or composite.
- **Neutral judging.** Judged measures use one blinded procedure for every condition. That
  procedure is a harness-level independent review of the task statement and the resulting change.
  Keystone's REVIEW, where a condition uses it, is part of that condition's workflow, not the
  benchmark's judge.
- **Neutral instrumentation.** Telemetry comes from observing runs from outside and from
  instrumentation applied identically to every condition, never from Keystone-only hooks.

## Objective

Build reusable measurement infrastructure that can show, under controlled and reproducible
conditions, whether Keystone improves long-running AI-assisted development. SPEC acceptance
baseline: "support benchmark fixtures".

## Harness versus experiment

The owner has set this distinction, and every recommendation below follows it.

| | Phase 7 — Benchmark Harness | Phase 8 — Cross-model Trial |
|---|---|---|
| Nature | Reusable measurement infrastructure | A specific experiment that uses it |
| Defines | Formats and mechanisms: tasks, conditions, agent profiles, runs, telemetry, results, scorecard | Content and parameters: which tasks, conditions, models, repetitions and weights |
| Subject | Synthetic fixtures inside Keystone | The benchmark application (Repo B) |
| Agents | A deterministic fake agent for tests; real agents only through the generic interface | Real agents and models |
| Output | Working, tested tooling; no claims about Keystone's value | Results and analysis |
| Proof | Offline end-to-end tests | The experiment's own pre-registered plan |

## Already decided by the authoritative artifacts

| Topic | Derived requirement | Source |
|---|---|---|
| Phases | Phase 7 is the Benchmark Harness; Phase 8 is the Cross-model Trial. | SPEC.md |
| Fixtures | The first working release must support benchmark fixtures. | SPEC acceptance baseline |
| Isolation | Each condition runs in a clean clone or worktree. | D23 |
| Metrics | A balanced quality and efficiency scorecard. | D24 |
| Determinism | Deterministic measurement comes before semantic judgement. | D15, SPEC principle 6 |
| Language | TypeScript/Node; protocol language-neutral. | D18 |
| Scope | A small working protocol and CLI; no external memory infrastructure, vector database, embeddings or GUI. | D25, SPEC non-goals |
| Adapters | Model adapters stay thin and carry no project facts. | D08 |
| Repositories | Keystone holds benchmark specifications and results. The benchmark application is a separate repository (Repo B), and Keystone contains none of its implementation knowledge. | `docs/REPO-SEPARATION.md`, PROJECT.md |
| Layout | `benchmark/{specification,tasks,scoring,results,analysis}` and `src/telemetry/` are reserved. | SPEC layout, repository |
| Telemetry location | `.context/telemetry/` is created by `init` and is a generated location, so it is never authoritative. | `src/commands/init.ts`, `docs/PHASE-0-1.md` |
| Generated state | Markdown/YAML is authoritative; generated state is disposable and rebuildable. | D16 |
| Core commands | Keystone's protocol commands are offline and call no model. Review and CLOSE never determine semantic judgement. | PROJECT.md, ADR-0002 guarantee 1, `docs/PHASE-5.md` |
| Read-only commands | `validate` and `context status` are read-only, and tests assert this. | `docs/PHASE-0-1.md`, `docs/PHASE-2.md` |
| Record authority | Durable, non-authoritative records (reviewer reports) are kept out of START. | ADR-0002 guarantee 8 |
| Mutation | High-authority changes need proposal and review. | D20 |

### Consequences

- The harness measures; it does not change how Keystone's protocol commands behave by default.
- Nothing the harness produces becomes authoritative project context.
- Phase 7 cannot depend on Repo B, which does not exist yet.

## Facts established by inspection

- `benchmark/*/README.md` are one-line placeholders. `src/telemetry/` is empty. Nothing else
  defines the benchmark.
- The default discovery sources are `PROJECT.md`, `features`, `tasks`, `adr`, `rules`, `skills`
  and `context` (`src/context/config.ts`). `benchmark/` is not discovered by default, but a
  configuration could add it. Only `reviews/` is refused as a source today (ADR-0002).
- SPEC.md's CLI contract lists no benchmark command.

## Open decisions

The decisions depend on each other: B1 (who runs agents) shapes B2, B6 and B7; B3 (where content
lives) shapes B8; B5 (telemetry) feeds B4 (scorecard). The recommendations are designed to fit
together, and the combined result is under "Recommended Phase 7 design".

### B1 — Agent execution

How do benchmark runs execute an agent, given that Keystone's commands are offline and call no
model?

| Option | Description | Trade-offs |
|---|---|---|
| (a) Manual protocol | The harness prepares workspaces and a run sheet. A person runs the agent, then records the run (`record`) with reported usage. The harness scores it. | Keystone never launches anything. But runs are slow, operator-dependent and hard to repeat at Phase 8 scale (tasks × conditions × models × repetitions). Timing and usage capture are error-prone. |
| (b) Generic external command runner | An *agent profile* declares a command template (for example a CLI agent's non-interactive mode), a timeout, and how to read its usage report. The harness runs it as a subprocess inside the run's isolated workspace. Keystone has no provider SDK, credentials or network code. The agent tool brings its own. | Repeatable and automatable. Offline-testable with a fake agent script. The harness becomes a process orchestrator, which is new for Keystone and must be isolated from protocol commands. Agent tools need network and credentials, outside Keystone. |
| (c) Direct model API calls | The harness calls model APIs itself. | Most control over prompts and tokens. Adds provider dependencies and network code to Keystone, contrary to D25 and D08 and the model-free direction; measures a Keystone-built agent, not the real tools developers use. |

**Recommendation: (b), with (a) kept as a fallback mode** (a profile of kind `manual` that waits
for `record`).
- The protocol commands (`init`, `validate`, `index`, `start`, `review`, `close`, `compact`,
  `context status`) stay offline and model-free.
- Only explicit harness run commands may launch configured external programs.
- **This needs an ADR.** It is a new capability boundary: the first Keystone command that executes
  arbitrary configured programs, which may themselves use the network.

### B2 — Conditions

D23 requires isolation per condition but never defines a condition.

| Option | Description | Trade-offs |
|---|---|---|
| (a) Fixed pair | The harness hard-codes `baseline` (no Keystone) and `keystone` (full workflow). | Simple. But every ablation needs harness code changes. |
| (b) Declarative conditions | A condition is a versioned definition: a setup recipe applied to a clean clone at a pinned subject commit (for example run `keystone init`, overlay seed files, select an adapter or instruction template), plus the session instructions given to the agent. The harness ships `baseline` and `keystone` as reference definitions; experiments add others. | Ablations (no START, no REVIEW, no learning/COMPACT) need no harness change. The definition format must be specified and validated. |
| (c) Model as a condition | Conditions also vary the model. | Conflates two independent variables, and the model dimension belongs to Phase 8. |

**Recommendation: (b).** Keep the two dimensions separate:
- a **condition** is the repository and context treatment;
- an **agent profile** (B1) is the tool and model.

A run is task × condition × agent profile × repetition.

**Isolation (D23):** a fresh local `git clone` per *run*, not per condition, so repetitions cannot
contaminate each other. A clone is preferred to a worktree because worktrees share refs, config and
hooks with their source. Clone from a local path or bundle, so preparation is offline.

### B3 — Subject and task content location

`docs/REPO-SEPARATION.md` puts "benchmark specifications/results" in Keystone but forbids
personal-trainer-specific implementation knowledge there.

| Option | Description | Trade-offs |
|---|---|---|
| (a) Everything in Keystone | Task statements, acceptance oracles and conditions for the trainer application live in `benchmark/tasks/`. | One place. But application-specific requirements and oracles are application knowledge, contrary to the separation rule, and they leak into Keystone's repository. |
| (b) Split by genericity | Keystone holds the generic harness specification (formats and schemas for tasks, conditions, profiles, results and the scorecard), the reference conditions, and synthetic fixtures. Repo B holds its own benchmark task content (statements, oracle tests, seed traps), versioned there. Run records pin the Repo B commit and task IDs. | Satisfies the separation rule and keeps Keystone reusable for other subjects. Requires a cross-repository reference (a pinned commit). |
| (c) Everything in Repo B | Keystone holds only harness code; specifications and results live in Repo B. | Clean separation, but contradicts the rule that Keystone holds benchmark specifications and results. |

**Recommendation: (b).**
- **Results** stay in Keystone (B8), holding metrics, provenance and identifiers only, never Repo B
  content.
- **Repo B is not created in Phase 7.** It is a Phase 8 prerequisite, prepared under its own task
  in its own repository.
- **Phase 7 proves the harness on a synthetic fixture subject** inside Keystone's tests: a tiny
  repository with two or three tasks and executable oracles.

### B4 — Scorecard (D24)

| Option | Description | Trade-offs |
|---|---|---|
| (a) Single composite score | Weighted sum of measures. | Easy ranking. But it hides trade-offs, D24 asks for balance, and choosing weights is an experiment decision. |
| (b) Balanced, unaggregated scorecard | Fixed categories with named measures, each labelled by source; reported per run and summarised per arm (median and spread). No composite in the harness. | Honest and comparable. Readers must weigh trade-offs. |
| (c) Scorecard plus optional composite | (b), plus a composite whose weights are declared in an experiment's pre-registered plan. | Flexible. The composite is an experiment artefact, not harness behaviour. |

**Recommendation: (c), with the harness implementing (b)** (owner: approved) and computing a composite only from
weights declared in the experiment plan. Measures are labelled by source:
- `deterministic`: computed by the harness;
- `reported`: from the agent tool;
- `judged`: from a person or reviewer, recorded with attestation.

Proposed measure set (an experiment may use a subset):

| Category | Measure | Source |
|---|---|---|
| Quality | Task oracle tests passed / total | deterministic |
| Quality | Pre-existing (regression) tests still passing | deterministic |
| Quality | Independent review outcome by the harness's blinded, condition-neutral procedure: verdict, and blocking and non-blocking finding counts | judged |
| Continuity | Seeded-trap recurrences (task oracles that detect a known mistake being repeated) | deterministic |
| Continuity | Rework: sessions or fix iterations until the oracle passes | deterministic |
| Efficiency | Input, output and total tokens | reported |
| Efficiency | Wall-clock time per session and run | deterministic |
| Efficiency | Agent turns or tool calls, where the tool reports them | reported |
| Efficiency | Wall-clock time spent in declared tools (identical instrumentation for every condition) | deterministic |

Condition-specific diagnostics (neutrality invariant), reported separately and never compared
across conditions or included in a composite:

| Diagnostic | Applies to | Source |
|---|---|---|
| Keystone context size: envelope estimated tokens and omissions | Conditions that produce a START envelope | deterministic (post-session inspection) |
| Keystone structural validation diagnostics in the result | Conditions that include Keystone artifacts | deterministic (post-run `keystone validate` in a scoring copy, never in the measured workspace during a run) |

### B5 — Telemetry

| Option | Description | Trade-offs |
|---|---|---|
| (a) None in Keystone | The harness measures only from outside (timings, git diff, oracles). | No change to protocol commands. Loses Keystone-internal measures (envelope size, omissions, outcomes). |
| (b) Always-on local telemetry | Every Keystone command appends events under `.context/telemetry/`. | Rich data. Breaks the read-only guarantees of `validate` and `context status`, and adds writes nobody asked for. |
| (c) Opt-in local telemetry | Commands append structured, content-free events (command, outcome, duration, diagnostic codes, envelope estimate and omissions) to `.context/telemetry/` only when explicitly enabled (for example an environment variable the harness sets in run workspaces). Off by default, local only, no network, never discovered, never authoritative. | Rich data where wanted; default behaviour and read-only guarantees unchanged. With telemetry on, read-only commands write generated state, so the guarantee becomes "read-only for project files". |

**Revision 1 recommendation: (c).**

**Owner resolution: modified.** Telemetry in the protocol commands, opt-in or not, is rejected.
Ordinary `keystone` commands keep their read-only semantics. Telemetry is captured by
`keystone-bench`, through three sources:
- **External observation:** process timings, exit codes, sessions and oracle results.
- **Read-only inspection of the workspace after each session:** for example the size and
  omissions recorded in a generated `.context/current-envelope.json`, when a condition produced
  one. This is a condition-specific diagnostic.
- **Explicitly declared instrumentation**, applied identically to every condition. An example is a
  command-wrapping shim that records each invocation of a declared tool (name, exit code,
  duration).

Telemetry is stored with the run record, outside the measured workspace. Keystone's protocol
commands are not changed by Phase 7, and `.context/telemetry/` stays an unused reserved
generated location.

As in revision 1:
- Agent-side usage (tokens, turns) is captured by the agent profile's usage parser (B1) and
  labelled `reported`.
- Telemetry records contain no file contents, prompts or project text.
- The revision 1 concern about narrowing a read-only guarantee no longer arises.

### B6 — Trial design support

These are experiment parameters, but the harness must be able to express them.

| Option | Description | Trade-offs |
|---|---|---|
| (a) Single runs | One run per task × condition × profile. | Simplest. Cannot separate signal from agent variance. |
| (b) Full experimental support | The harness provides: repetitions; ordering seeded and recorded; multi-session tasks, each session a fresh agent process sharing only the repository, to simulate context loss; and blinded scoring, where judged measures see anonymised run IDs, not condition names. | What a credible Phase 8 needs. More harness work and more formats. |
| (c) Partial | Repetitions and seeds now; sessions and blinding later. | Smaller Phase 7. Phase 8 would have to extend the harness, blurring the boundary. |

**Recommendation: (b).** Long-running continuity is Keystone's whole purpose, so multi-session
tasks are essential. Blinding protects the judged measures. The harness supports these
mechanisms; Phase 8's plan chooses the values (number of repetitions, tasks, which measures are
judged).

### B7 — Phase 7 / Phase 8 boundary

| Option | Description | Trade-offs |
|---|---|---|
| (a) Harness only | Phase 7 delivers the infrastructure, tested end to end on synthetic fixtures with a deterministic fake agent. No real-model runs. | Clean boundary; fully offline-testable. Real-agent integration is first exercised in Phase 8. |
| (b) Harness plus a smoke run | (a), plus one documented manual smoke run with one real agent profile on the fixture subject, outside the automated suite, whose output is explicitly not a result. | Finds integration problems with real agent tools early, without making claims. Needs network and credentials once, outside tests. |
| (c) Harness plus pilot experiment | Phase 7 also runs a small real experiment. | Earlier evidence. Erodes the owner's harness/experiment distinction. |

**Recommendation: (b).** Phase 7 is complete when:
- the offline fixture suite passes;
- the smoke run shows that a real agent profile can be prepared, run, recorded and scored.

The smoke run's output is discarded or kept only as a test record, never as a benchmark result.

Phase 8 then owns:
- the experiment plan, pre-registered: tasks, conditions, profiles, repetitions, judged measures,
  any composite weights and analysis method;
- Repo B and its task content;
- the runs, results and analysis.

### B8 — Result authority and storage

| Option | Description | Trade-offs |
|---|---|---|
| (a) Generated only | Results live under `.context/` and are rebuildable. | Wrong fit: results are evidence of runs that cannot be regenerated. |
| (b) Durable, non-authoritative records | Each run writes a schema-validated record under `benchmark/results/<experiment>/<run-id>/`. It holds provenance, measures with their sources, scorecard inputs, and a hash of its evidence. Records are never discovered, never selected by START, and refused as configured discovery sources, as `reviews/` is. Summaries in `benchmark/analysis/` are generated from results and rebuildable. | Mirrors the proven reviewer-record model (ADR-0002). Results are kept and reproducible, and cannot contaminate project context. Refusing them as a source extends START ineligibility, so **it needs an ADR** (the same one as B1/B5). |
| (c) External store | Results go to a spreadsheet or database. | Contrary to D25 and repository-as-memory. |

**Recommendation: (b).** Run provenance includes:
- Keystone version and commit;
- subject repository identity and commit;
- task, condition and agent-profile IDs with content hashes;
- agent tool and model *as declared* by the profile and as reported by the tool;
- the experiment plan's identity and content hash, so any later change to the plan is detectable
  (ADR-0004 guarantee 8);
- seed, repetition number and harness version;
- timestamps.

Transcripts are not stored in Keystone by default. An experiment may point to externally stored
transcripts by hash.

## Command surface (follows from B1–B8)

SPEC.md's CLI contract has no benchmark command, so a command surface is itself a contract change.

| Option | Description | Trade-offs |
|---|---|---|
| (a) `keystone bench …` subcommands | `bench validate`, `prepare`, `run`, `record`, `score`, `report`. | One tool, discoverable. Grows the core CLI with a different kind of command. |
| (b) Separate executable | A second bin in the same package (for example `keystone-bench`). | Keeps the protocol CLI unchanged and makes the B1 capability boundary visible. Two entry points. |

**Recommendation: (b).** The process-launching capability then never lives in the protocol CLI,
which makes B1's boundary obvious and testable. The harness code would sit in a new
`src/benchmark/` module. That extends the SPEC layout, so it should be part of the SPEC amendment.

## Phase 7 design (B1–B8 as resolved; ADR-0004 adopted)

1. **Specifications in Keystone** (`benchmark/specification/`): versioned, schema-validated formats
   for:
   - benchmark tasks: statement reference, sessions, oracle commands and seeded traps;
   - conditions: setup recipe and session instructions;
   - agent profiles: command template, timeout, usage parser, or `manual`;
   - run records;
   - the scorecard definition;
   - experiment plans.
   Also the reference conditions `baseline` and `keystone`, as peer definitions (neutrality).
2. **Synthetic fixture subject** used only by Keystone's tests: a tiny repository with tasks,
   oracles and a seeded trap, plus a deterministic fake agent script.
3. **`keystone-bench` executable** with these commands:
   - `validate`: check specifications;
   - `prepare`: fresh clone per run and apply the condition;
   - `run`: execute the profile's sessions under a timeout, collect timings, harness telemetry and
     reported usage, then run the oracles;
   - `record`: the manual mode;
   - `score`: compute deterministic measures and import judged ones blind;
   - `report`: build the scorecard from results.
4. **Harness telemetry:** opt-in, content-free, captured by `keystone-bench` through external
   observation, post-session inspection and identically applied declared instrumentation. It is
   stored with the run record outside the measured workspace. Protocol commands are unchanged.
5. **Fixed experiment plans:** a plan is fixed before its runs begin. Every run and result records
   the plan's identity and content hash, and scoring and reporting refuse records whose plan hash
   no longer matches the plan.
6. **Durable, non-authoritative results** in `benchmark/results/`, refused as discovery sources;
   generated summaries in `benchmark/analysis/`.
7. **Safety:**
   - preparation and scoring never modify the source subject repository;
   - every run works in its own clone, and runs never touch the Keystone working tree except to
     write their result record;
   - failures are reported truthfully, in the Phase 6 style.

## Deterministic versus semantic

- **Deterministic (harness):**
  - specification validity, isolation and provenance hashes;
  - timings and oracle results;
  - trap recurrences, rework counts and telemetry figures;
  - scorecard arithmetic.
- **Reported (agent tool):** tokens, turns and tool calls. Labelled as reported and never treated
  as verified.
- **Judged (people or reviewers):** review outcomes and any qualitative assessment. Recorded with
  attestation and blinded to condition.

## Architectural impact

ADR-0004, "Benchmark harness boundaries", was adopted on 2026-10-05. It records the
durable guarantees:
1. separate executable; protocol commands unchanged, offline, model-free and read-only where
   stated;
2. controlled agent execution;
3. run isolation (D23);
4. neutrality;
5. harness-owned telemetry;
6. measure provenance (D24);
7. durable, non-authoritative, START-ineligible results (supplementing ADR-0001);
8. the harness/experiment boundary, including fixed plans with immutable plan provenance in every
   run and result;
9. the implementation contract.

It keeps mechanisms out of the architecture, following the lesson in ADR-0002's clarification.

### SPEC.md amendment (applied on ADR-0004 adoption, 2026-10-05)

The amendment below was applied as drafted, with the guarantee 8 clarification on plan
provenance and an explicit statement that `src/telemetry` stays reserved and unused. The START
sentence also states the discovery exclusion and the configured-source refusal.

1. **Framework layout:** add `src/benchmark` to the `src/{…}` list. The remaining layout is
   unchanged; `src/telemetry` stays reserved.
2. **CLI contracts:** after the `keystone` command list, add:

   > The package also exposes the benchmark harness executable `keystone-bench` (ADR-0004). It is
   > separate from the `keystone` protocol CLI, whose commands remain offline, model-free and
   > unchanged.
   >
   > - `keystone-bench validate`
   > - `keystone-bench prepare <plan>`
   > - `keystone-bench run <plan> [--run <run-id>]...`
   > - `keystone-bench record <run-id>`
   > - `keystone-bench score <plan>`
   > - `keystone-bench report <plan>`
   >
   > Exact arguments and flags are Phase 7 implementation-contract details.

3. **New section "Benchmark harness",** after "Compaction and retirement":

   > ADR-0004 records the Phase 7 harness guarantees. `keystone-bench` is reusable measurement
   > infrastructure; it makes no claim about Keystone's value. Experiments, starting with Phase 8,
   > supply the subject repository, task content, conditions, agent profiles and parameters
   > through an experiment plan fixed before its runs begin; every run and result identifies the
   > exact plan through immutable provenance. Application-specific task content stays in its
   > subject repository.
   >
   > Only `keystone-bench` runs may launch external programs: the declared agent commands,
   > condition setup and task oracles, inside the run's workspace. A manual profile is equally
   > supported. Keystone contains no model-provider code or credentials. Every run uses its own
   > fresh local clone of the subject at a pinned commit (D23). The source subject is never
   > modified.
   >
   > The harness is neutral between conditions. It never requires, installs or privileges
   > Keystone in a measured workspace. Conditions are peer declarative definitions. Every
   > condition in an experiment receives the same tasks, oracles, agent profiles, limits,
   > instrumentation and scoring. Condition-specific measures are diagnostics, outside
   > cross-condition comparison. Judged measures use one blinded, condition-neutral procedure.
   >
   > Telemetry is opt-in, local and content-free. It is captured by the harness outside the
   > measured workspace; protocol commands never record it and keep their read-only semantics.
   > Measures are labelled `deterministic`, `reported` or `judged`, and form a balanced
   > scorecard (D24), with a composite only from weights declared in an experiment plan.
   >
   > Results are durable, non-authoritative records under `benchmark/results/`; summaries under
   > `benchmark/analysis/` are generated. Both are never discovered, are invalid as configured
   > sources, and are ineligible for START and review-context selection through every path. A
   > real-agent smoke run verifies integration only and is never benchmark evidence.
   > `docs/PHASE-7.md` specifies the implementation mechanisms.

4. **START eligibility paragraph:** extend the ADR-0002 sentence to read: "ADR-0002 and ADR-0004
   supplement this contract: the root-level `reviews/`, `benchmark/results/` and
   `benchmark/analysis/` directories, compared case-insensitively, are ineligible for START."

Implementation phases, the acceptance baseline and every other SPEC section are unchanged.

## Proposed acceptance scenarios for the implementation task

Accepted by the owner with TASK-0012 on 2026-10-05 as the design baseline for the Phase 7
implementation task.

1. `keystone-bench validate` accepts the reference specifications and rejects malformed tasks,
   conditions, profiles and plans with stable diagnostic codes.
2. `prepare` creates one fresh clone per run at the pinned subject commit, applies the condition,
   and leaves the source subject repository byte-identical.
3. Two runs of the same arm never share a working tree, refs or configuration.
4. `run` with the fake agent completes a multi-session task, with each session a separate
   process, and records timings, usage and oracle results.
5. A session timeout or agent failure is recorded truthfully as a failed session; the run record
   stays valid.
6. The `manual` profile waits for `record`, and the recorded run scores identically to an
   equivalent automated run.
7. Protocol commands are unchanged by Phase 7. With harness telemetry enabled, `keystone validate`
   and `keystone context status` still write no file. The existing read-only tests pass, plus one
   that runs them under every harness telemetry setting.
8. Harness telemetry is content-free and stored with the run record outside the measured
   workspace. Nothing is written to the workspace's `.context/telemetry/`.
9. Scoring computes every deterministic measure correctly on fixture runs with known answers,
   including a seeded-trap recurrence and a rework count.
10. Judged measures are imported against anonymised run IDs; the condition is not visible to the
    judge input.
11. `report` produces a balanced scorecard per arm, with sources labelled, and a composite only
    when weights are declared in the plan.
12. Result records are schema-valid, carry full provenance and an evidence hash, are never
    discovered or selected by START, and are refused as configured sources.
13. Re-running `score` and `report` on the same results is byte-identical.
14. Repetitions and seeded ordering are reproducible from the recorded seed.
15. The automated suite runs offline, uses only the fake agent, and passes on Windows paths with
    spaces.
16. Protocol commands remain unable to launch external programs; only `keystone-bench run` does.
17. Neutrality: a `baseline` run's workspace contains no Keystone files, configuration or
    executable on its path, unless that condition's own setup declares them.
18. Neutrality: two conditions in one plan receive byte-identical task statements, oracles, agent
    profile, limits and instrumentation; only declared condition setup and instructions differ, and
    their hashes are recorded.
19. Neutrality: condition-specific diagnostics are excluded from cross-condition summaries and
    composites, and the judged-measure input contains no condition identity.
20. A smoke run cannot be recorded as a benchmark result.
21. `benchmark/results/` and `benchmark/analysis/` are never discovered, are refused as
    configured sources, and are ineligible for START through every path.
22. Every run and result records the experiment plan's identity and content hash. Changing the plan
    after runs exist is detected: `score` and `report` refuse the mismatched records with a stable
    diagnostic, and `run` refuses to add runs to a plan whose content no longer matches its
    existing runs.

## Revision history

| Revision | Date | Change |
|---|---|---|
| 1 | 2026-10-05 | Initial design: derived requirements, harness/experiment boundary, decisions B1–B8 and the command surface with options and recommendations, recommended design and acceptance scenarios, for owner review. |
| 2 | 2026-10-05 | Owner resolved B1–B8 and the command surface. B5 was modified: telemetry belongs to the harness, and protocol commands keep their read-only semantics. Neutrality invariant added. Measures reclassified for neutrality. ADR-0004 drafted as proposed and the SPEC amendment drafted. Scenarios 7–8 revised and 17–21 added. |
| 3 | 2026-10-05 | ADR-0004 adopted with the guarantee 8 plan-provenance clarification and `src/telemetry/` kept reserved; SPEC.md amended; records reconciled; scenario 22 added. Ready for final acceptance. |
