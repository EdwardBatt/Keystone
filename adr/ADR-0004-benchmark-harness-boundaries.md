---
context_type: adr
schema_version: 1
id: ADR-0004
title: Benchmark harness boundaries
status: accepted
created: 2026-10-05
features: []
tasks: [TASK-0012]
supersedes: []
superseded_by: []
tags: [benchmark, harness, telemetry, neutrality, start, authority]
---
# ADR-0004 — Benchmark harness boundaries

## Index
Architectural guarantees for the Phase 7 Benchmark Harness (`keystone-bench`):
- separation from the protocol CLI;
- controlled execution of external agents;
- run isolation;
- neutrality between conditions;
- telemetry outside the measured environment;
- measure provenance;
- durable, non-authoritative results that are ineligible for START (supplementing ADR-0001);
- the boundary between harness and experiment.

TASK-0012 is the design record.

## Context
SPEC.md defines Phase 7 (Benchmark Harness) and Phase 8 (Cross-model Trial), and requires the first
release to "support benchmark fixtures". D23 requires a clean clone or worktree per condition. D24
requires a balanced quality and efficiency scorecard. D15 separates deterministic checks from
semantic judgement.

Until now every Keystone command has been offline and model-free:
- PROJECT.md;
- ADR-0002 guarantee 1;
- D25.

`validate` and `context status` are read-only. A benchmark, however, must run real agents, which
need network access and credentials, and must keep evidence of those runs.

`docs/REPO-SEPARATION.md` keeps the benchmark application (Repo B) and its knowledge out of
Keystone.

On 2026-10-05 the owner resolved TASK-0012 decisions:
- B1(b), B2(b), B3(b), B4(c), B6(b), B7(b) and B8(b);
- the separate `keystone-bench` command surface;
- B5, modified: telemetry belongs to the harness, and ordinary `keystone` commands keep their
  read-only semantics.

The owner also added an invariant: the harness must be neutral between Keystone and control
conditions. This ADR records the durable guarantees those decisions require.

## Decision

1. **Separate harness executable.**
   - The benchmark harness is a separate executable, `keystone-bench`. The protocol CLI
     `keystone` gains no benchmark commands.
   - The protocol commands (`init`, `index`, `validate`, `start`, `review`, `close`, `compact`,
     `context status`) are unchanged by this ADR. They stay offline and model-free, and they never
     launch external programs.
   - Their read-only semantics are unchanged: no harness setting, environment variable or
     instrumentation makes `validate` or `context status` write files.

2. **Controlled agent execution.**
   - Only the harness's explicit run operation may launch external programs. Those are the agent
     commands declared by an *agent profile*, plus commands declared by conditions and tasks
     (setup recipes and oracles), all inside the run's isolated workspace.
   - Keystone contains no model-provider SDK, credentials or network code. Any network use belongs
     to the declared external programs.
   - A manual profile, in which a person performs the run and records it, is equally supported.

3. **Run isolation (makes D23 concrete).**
   - Every run executes in its own fresh local clone of the subject at a pinned commit. Runs never
     share a working tree, refs, configuration or hooks.
   - Preparing, running and scoring never modify the source subject repository.

4. **Neutrality between conditions.**
   - The harness does not require, install or structurally privilege Keystone in the environment
     being measured.
   - Keystone and control conditions are peer declarative definitions. Whatever a condition puts
     into its workspace comes only from that condition's own versioned setup.
   - For every condition in an experiment, the following are identical:
     - task statements;
     - oracles;
     - agent profiles;
     - session structure, limits and budgets;
     - instrumentation;
     - scoring procedures.
   - Measures that exist only under some conditions (for example Keystone context size) are
     condition-specific diagnostics. They are reported separately and never enter
     cross-condition comparison or a composite.
   - Judged measures use one condition-neutral procedure that is blind to condition. Keystone's
     own REVIEW is part of a condition's workflow, not the benchmark's judging procedure.

5. **Telemetry belongs to the harness.**
   - Telemetry is opt-in, local and content-free: no file contents, prompts or project text.
   - It is captured by `keystone-bench` through:
     - external observation of runs;
     - read-only inspection of the workspace after each session;
     - instrumentation explicitly declared in the run's definition and applied identically to
       every condition.
   - It is stored with the run's harness record, outside the measured workspace. It never becomes
     authoritative context.

6. **Measure provenance.**
   - Every measure is labelled by source:
     - `deterministic`: computed by the harness;
     - `reported`: by the agent tool;
     - `judged`: by a person or reviewer, with attestation.
   - Reported values are never treated as verified.
   - The harness reports a balanced scorecard, and computes a composite only from weights declared
     in an experiment's plan.

7. **Durable, non-authoritative results (supplements ADR-0001).**
   - Run results are durable records under the root-level `benchmark/results/` directory, carrying
     provenance and an evidence identity.
   - Summaries under `benchmark/analysis/` are generated and rebuildable from results.
   - Neither location is discovered as artifact inventory. A configured discovery source equal to
     or inside either one is invalid.
   - Both are ineligible for START and review-context selection through every path, compared
     case-insensitively, as ADR-0002 does for `reviews/`. ADR-0001 is otherwise unchanged.

8. **Harness versus experiment.**
   - The harness provides reusable measurement infrastructure and makes no claim about Keystone's
     value. Its correctness is proven on synthetic fixtures with a deterministic fake agent,
     offline.
   - A real-agent smoke run is integration verification only. It is never benchmark evidence, and
     its output is never stored as a benchmark result.
   - Experiments, starting with Phase 8, supply the subject, task content, conditions, profiles and
     parameters through an experiment plan. The plan is fixed before its runs begin.
   - Every recorded run and result identifies the exact experiment plan it used through immutable
     provenance, sufficient to detect any later change to that plan.
   - Application-specific task content lives with its subject repository, not in Keystone (B3).

9. **Implementation contract.** `docs/PHASE-7.md` owns these mechanisms, which may change without
   an ADR while this ADR, SPEC.md, D23 and D24 remain satisfied:
   - specification formats and file names;
   - CLI operations, flags and diagnostics;
   - instrumentation techniques and the usage parsers;
   - the hashing and record formats.

## Alternatives Considered
TASK-0012 evaluated:
- **Agent execution:** manual-only runs (kept as a mode) and direct model API calls (rejected under
  D25 and D08).
- **Conditions:** fixed conditions, and model-as-condition.
- **Content location:** all benchmark content in Keystone (contrary to repository separation), or
  all of it in Repo B.
- **Scoring:** a single composite score.
- **Telemetry:** always-on, or opt-in telemetry inside protocol commands. The owner rejected the
  latter because it would change read-only semantics.
- **Results:** generated-only results, and external stores.
- **Command surface:** benchmark subcommands in the protocol CLI.

## Rationale
- Putting all execution and telemetry in a separate executable keeps the protocol's guarantees
  (offline, model-free, read-only where stated) exactly as they are.
- Neutrality makes results interpretable: any difference between conditions comes from the
  conditions, not from the measuring instrument.
- Treating results like reviewer records reuses a proven boundary: durable evidence that can never
  become project authority.

## Consequences
- SPEC.md has a "Benchmark harness" section, the `keystone-bench` entry in its CLI contracts, and
  `src/benchmark` in its layout.
- Discovery, configuration validation and START gain the `benchmark/results/` and
  `benchmark/analysis/` exclusions and ineligibility.
- `.context/telemetry/` (created by `init`) is not used by Phase 7 and remains a reserved generated
  location.
- `src/telemetry/` remains reserved and unused in Phase 7. Harness instrumentation belongs under
  `src/benchmark/`.
- Repo B is not created by Phase 7; Phase 8 prepares it.

## Constraints
- Do not add benchmark behaviour, telemetry or external-program execution to protocol commands.
- Do not add model-provider dependencies, credentials or network code to Keystone.
- Do not change ADR-0001 beyond guarantee 7, or ADR-0002 and ADR-0003.
- Do not store application-specific benchmark content or transcripts in Keystone.

## Implementation Impact
`docs/PHASE-7.md` records the mechanisms and acceptance behaviour, for example:
- task, condition, agent-profile, plan and result formats;
- clone preparation;
- session execution, timeouts and usage parsing;
- instrumentation;
- scoring and blinding;
- report generation;
- diagnostics and outcomes.

These records create no architectural requirements.

## Validation
This ADR must remain schema-valid and its links must resolve. Adopting it does not implement
Phase 7.

## Adoption (2026-10-05)
The owner adopted this ADR as drafted, with two changes:
- **Guarantee 8 clarification.** Every recorded run and result must identify the exact experiment
  plan it used through immutable provenance, sufficient to detect any later change to that plan.
  The plan is fixed before its runs begin.
- **Location.** `src/telemetry/` stays reserved and unused in Phase 7; harness instrumentation
  belongs under `src/benchmark/`.

## Related Decisions
- Supplements ADR-0001 through guarantee 7, as ADR-0002 did.
- Makes D23 and D24 concrete.
- Preserves D01, D08, D15, D16, D18, D20, D25, ADR-0002 and ADR-0003.
