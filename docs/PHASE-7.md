# Phase 7 implementation contract — TASK-0013

The architecture is owned by:
- D15, D23, D24 and D25;
- ADR-0004, with ADR-0001 (as supplemented) and ADR-0002;
- SPEC.md ("Benchmark harness", the `keystone-bench` CLI contract and the START exclusions);
- the accepted TASK-0012 contract (`docs/TASK-0012-phase-7-benchmark-harness-design.md`,
  revision 3), with the TASK-0013 owner decisions I1 and I2.

This document records the mechanisms TASK-0013 chose (ADR-0004 guarantee 9). It creates no
architectural requirement: any mechanism here may change without an ADR while ADR-0004, SPEC.md,
D23 and D24 remain satisfied.

The harness is measurement infrastructure. Nothing it produces is a claim about Keystone's value,
and TASK-0013 produced no benchmark evidence.

TASK-0015 extended the harness for the Phase 8 Cross-model Trial with version 2 formats and
commands. Those mechanisms are recorded in "Phase 8 preparation (TASK-0015)" at the end of this
document. Everything above it describes version 1 behaviour, which is unchanged.

## Commands

```powershell
node dist/benchmark/cli.js validate --root "C:\path\to\keystone"
node dist/benchmark/cli.js validate "C:\experiments\plan.json"
node dist/benchmark/cli.js prepare "C:\experiments\plan.json" --root "C:\path\to\keystone" --work "D:\bench work"
node dist/benchmark/cli.js run "C:\experiments\plan.json" --root "C:\path\to\keystone" --work "D:\bench work" [--run R-…]...
node dist/benchmark/cli.js record R-… --plan "C:\experiments\plan.json" --input manual.json --root … --work …
node dist/benchmark/cli.js score "C:\experiments\plan.json" --root … --work … [--blind "D:\judge packet" | --judged judgements.json]
node dist/benchmark/cli.js report "C:\experiments\plan.json" --root … --work …
```

The package exposes this as the separate `keystone-bench` bin. The `keystone` protocol CLI has no
benchmark command or flag (`keystone bench …` is `CLI_USAGE`).

- `--root` is the Keystone directory that receives `benchmark/results/` and `benchmark/analysis/`
  (default: the working directory).
- `--work` is the harness work directory for workspaces and run state. The default is
  `<system temp>/keystone-bench/<plan-id>`. Every command checks the following on **physical**
  paths (review B2): the real path of the nearest existing ancestor, so junctions, symbolic links
  and other aliases cannot disguise a location.
  - The work directory must be outside the Keystone tree, and the work directory and the subject
    must not contain each other. Its `runs/` directory must not be an alias (`BENCH_WORK_INVALID`).
  - For experiment plans, `benchmark/results/<plan-id>` and `benchmark/analysis/<plan-id>` must be
    reached through no symbolic link or junction, and must lie physically inside the Keystone tree
    and outside the subject and work directory (`BENCH_RESULTS_INVALID`).

  These checks are made when a command opens. That alone does not protect descendants replaced
  later, so every destination is also checked at its point of use.

**Write boundaries** (review round 2). Each destination belongs to one boundary:
- **work:** the manifest, run directories, measured workspaces, harness state, shims, prompts,
  usage files, snapshots and the blinding key;
- **results:** run and judgement records;
- **analysis:** scores and reports;
- **judging packet:** each export destination.

`guard()` (`src/benchmark/store.ts`) runs immediately before every harness write, removal and
process launch. It requires that the destination:
1. lies inside its boundary's base;
2. is reached from that base through no symbolic link or junction, the destination itself
   included;
3. lies physically inside the base;
4. neither lies in nor contains the subject, the Keystone tree or the work directory, as the
   boundary forbids.

The run checks its workspace and harness directory before condition setup, before and after
every session, before every setup command and oracle, and before every snapshot. A workspace,
harness, `runs/`, `judgements/` or analysis directory replaced by a junction after an earlier
validation is therefore refused before anything is written or run there. The refusal is
`BENCH_WORK_INVALID` or `BENCH_RESULTS_INVALID`, or `BENCH_BLIND_OUTPUT_INVALID` for a packet.
A packet's boundary is the destination's parent, so directories above it may be aliases while the
destination and everything in it may not.

Two further protections were added in review round 3:
- **Snapshot repository.** `guardTree()` checks `harness/snapshots.git` and everything inside it
  for symbolic links and junctions, together with its index file, before every snapshot,
  statistics or patch operation. A pre-existing or session-created alias to a protected
  repository (for example `snapshots.git` itself, or its `objects/`) therefore never receives Git
  writes.
- **Replace, never write through.** Every harness output file is installed by `writeVerified`:
  run records, state, the manifest, scores, reports, the blinding key, prompt files, shim files,
  staged condition files and judging-packet files. It writes a fresh temporary file and renames it
  over the target. The rename replaces the directory entry, so a pre-existing output that is a
  hard link into a protected repository is never modified. The shims' tool log is removed before
  each run, so it is always created fresh.

**Threat boundary** (owner clarification, recorded in ADR-0004 on 2026-10-06). The harness defends
against deterministic aliases present when it performs an operation: ordinary paths, symbolic
links, junctions and other reparse points, and pre-existing hard-linked output destinations. It is
not an OS-level sandbox. A concurrently hostile process that changes filesystem topology in the
instant between a check and its use is outside the boundary, and that check-to-write race is an
accepted limitation. Agent sessions are not sandboxed: what an agent writes is its own doing
(ADR-0004 guarantee 2). The guarantee covers every destination the harness itself writes, removes,
runs Git on, or launches in.
- `--json` emits one structured result: `{ ok, command, outcome, plan, diagnostics, … }`.
- **Exit codes:** `valid`, `prepared`, `unchanged`, `completed`, `awaiting-record`, `recorded`,
  `scored` and `reported` exit 0. `invalid` and `blocked` exit 1. `failed` and usage errors
  (`BENCH_USAGE`) exit 2.

### What launches programs (owner decisions I1 and I2)

Only `run` launches declared programs: condition setup commands, the agent command of a
`command` profile, declared tools invoked by those, and task oracles. `validate`, `prepare`,
`record`, `score` and `report` launch none.

The harness also makes fixed, offline Git invocations (`src/benchmark/git.ts`):
- clone and commit verification in `prepare`;
- tree snapshots, change statistics and judging patches in `run` and `score`;
- Keystone's own commit for provenance.

Under I1 these are not "external programs" in ADR-0004's sense, any more than the existing Git
calls in `init`, `context status`, `start` and `review`.

Git must not become an indirect launcher either (review B1). Every harness Git invocation
therefore:
- reads no system, global or XDG configuration (`GIT_CONFIG_NOSYSTEM=1`,
  `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_ATTR_NOSYSTEM=1`), so operator-defined `filter`, `diff`
  textconv, `core.fsmonitor` or hook programs (git-lfs, for example) never run;
- has inherited `GIT_*` variables removed, network transports refused (`protocol.allow=never`,
  with only `file` allowed), and hooks and fsmonitor disabled.

Snapshots, change statistics and judging patches use a harness-owned bare repository
(`harness/snapshots.git`), with `GIT_WORK_TREE` set to the workspace. The workspace's own
`.git/config`, which the measured agent controls, is never read. Attribute-named drivers are
therefore inert, and diffs also pass `--no-textconv --no-ext-diff`. The only child process Git
starts is its own `upload-pack` on the subject side of a local clone; with no protected
configuration, it honours no `packObjectsHook`.

Keystone's own `dirty` provenance flag compares working files with `git ls-tree` blob hashes in
Node, treating CRLF-only differences as unchanged, so no repository filter can run. On timeout the harness kills the whole process tree with `taskkill /T`
(Windows) or a process-group kill (POSIX).

## Specification formats

All formats are JSON with `kind` and `schema_version: 1`. They are validated by JSON Schemas in
`benchmark/specification/schemas/`, plus semantic checks. Every specification lives in its own
directory, its **bundle**, and its content hash covers every file in that directory.

| Kind | Holds |
|---|---|
| `keystone-bench-task` (`task.json`) | `statement`; ordered `sessions` (`id`, `prompt`); optional `fix` (`prompt`, `max`); `oracles` (`id`, `role` of `task`/`regression`/`trap`, `command`) |
| `keystone-bench-condition` (`condition.json`) | `instructions` (file or `null`); `setup.files` (`from` in the bundle, `to` in the workspace); `setup.commands`; declared `tools` (`name`, `command`) |
| `keystone-bench-agent-profile` (`profile.json`) | `mode` `command` or `manual`; `declared` tool and model; optional `trusted` reported identities (`tools`, `models`); for `command`: `command`, `stdin` (`none`/`prompt`), `usage` parser, `env.pass` |
| `keystone-bench-plan` | `purpose` (`experiment`/`smoke`); `subject` (`id`, `repository`, pinned 40-hex `commit`); `tasks`, `conditions`, `profiles` (paths to specifications); `repetitions`; `seed`; `limits`; `telemetry` (`enabled`, `wrap`); optional `judging` (`procedure`, `exclude`); optional `composite.weights` |
| `keystone-bench-scorecard` (`benchmark/specification/scorecard.json`) | The measure definitions: category, source, scope, unit |
| `keystone-bench-manual-record` | A manual run's sessions (status, reported duration and usage) and fix-session count |
| `keystone-bench-judgements` | Attested, blinded judgements for one plan hash |
| `keystone-bench-run-record` | The durable result record (below) |

**Placeholders** in command arrays:
- oracles: `{node}`, `{workspace}` and `{task}` (the task bundle);
- setup commands and tools: `{node}`, `{workspace}` and `{condition}`;
- agent commands: `{node}`, `{workspace}`, `{profile}`, `{prompt_file}`, `{usage_file}` and
  `{session}`.

Any other placeholder is `BENCH_PLACEHOLDER_INVALID`. Bundle references (statement, prompts,
instructions, staged files) must be portable paths inside the bundle; staged `to` paths may not
enter `.git`.

**Limits** (session, setup and oracle timeouts) belong to the plan, never to a condition, so every
condition in an experiment has the same limits.

**Reference conditions.** `benchmark/specification/conditions/baseline` (nothing added) and
`benchmark/specification/conditions/keystone` are peer definitions. The `keystone` condition
declares a `keystone` tool pointing at this checkout's `dist/cli/index.js`, runs `keystone init`
as its setup command, and gives brief instructions. No harness code names either condition.

## Run identity, matrix and order

A run is task × condition × agent profile × repetition. Its ID is
`R-` + the first 12 hex digits of SHA-256 of `plan id, task, condition, profile, repetition`, so
an ID reveals no condition. The run list is sorted by ID, then shuffled by a Fisher–Yates shuffle
driven by `SHA-256(seed:i)`. Each record carries `seed` and `order_index`, and the same seed always
gives the same order.

## Plan provenance (ADR-0004 guarantee 8)

The plan hash is SHA-256 of the canonical serialization of:
- the plan file's bytes;
- the bundle hash of every referenced task, condition and profile.

Every run record and judgement record carries `plan: { id, hash }`.

- `score` and `report` refuse any record whose plan hash differs from the plan's current hash
  (`BENCH_PLAN_MISMATCH`). They write nothing.
- `prepare` and `run` refuse to continue when the work manifest or any existing result was made
  under different plan content (`BENCH_PLAN_CHANGED`).

Editing a plan, or any file in a referenced bundle, after runs exist is therefore always
detected. A changed experiment needs a new plan ID.

## Preparation

`prepare` validates the plan and confirms the subject is a local directory containing the pinned
commit. A missing directory is `BENCH_SUBJECT_INVALID` and a missing commit
`BENCH_SUBJECT_COMMIT_MISSING`.

The work manifest, carrying the plan hash and run list, is written **before** any run is prepared.
Each run's state records the plan hash it was prepared under. A failed preparation therefore still
binds the work directory to that plan's content. Any later `prepare` or `run` under changed content
is refused (`BENCH_PLAN_CHANGED`), so inputs staged under one plan are never adopted by another
(review B3).

For each run not yet prepared:
1. `git clone --no-hardlinks --no-checkout --template=` into `<work>/runs/<run-id>/workspace`, so
   objects are copied (no alternates) and there are no hooks;
2. detached checkout of the commit;
3. removal of the `origin` remote;
4. verification that `HEAD` equals the commit;
5. copying of the condition's declared files.

The subject repository is only read. Re-running `prepare` is `unchanged` for prepared runs. A
failed preparation removes only that run's directory and reports `failed` (`BENCH_CLONE_FAILED`,
`BENCH_PREPARE_FAILED`).

## Execution (`run`)

**Controlled environment.** Every process receives:
- an allow-list of system variables. On Windows that is `SystemRoot`, `ComSpec`, `PATHEXT`,
  `TEMP`, `USERPROFILE`, `APPDATA` and similar; on POSIX, `HOME`, `TMPDIR`, `LANG` and similar;
- the profile's declared `env.pass` names;
- a base `PATH`: the operator's `PATH` with every directory that provides a `keystone` or
  `keystone-bench` executable removed.

The base environment is the same for every condition. Each record holds the pass-through variable
names (never values), the count of removed `PATH` entries and the base `PATH` hash. A control
condition therefore cannot receive an operator's globally installed Keystone.

**Per run:**
1. **Tools.** Each condition tool becomes a shim in `harness/tools`, prepended to `PATH` for
   setup and sessions.
2. **Instrumentation** (telemetry enabled). Each `wrap` name that resolves on the session `PATH`
   gets a wrapper shim in `harness/telemetry-bin`. The wrapper runs the real executable and
   appends `{tool, exit_code, duration_ms}` to `harness/tool-log.jsonl`; it never records
   arguments or output. Tools that do not resolve are recorded as `resolved: false`.
3. **Setup.** Condition setup commands run in the workspace with the setup timeout. Their status,
   exit code and duration are recorded in `setup`, separately from sessions. A failing command
   makes the run `failed` (`BENCH_SETUP_FAILED`) with no sessions, and the record is still
   installed.
4. **Setup tree.** The workspace is snapshotted as a Git tree in the harness-owned
   `harness/snapshots.git`, with its index file in `harness/`, outside the workspace.
5. **Sessions.** Each session is a separate process in the workspace, with the session timeout.
   Its prompt is the condition instructions, then the task statement, then the session prompt,
   written to `harness/prompts/<id>.md` and optionally piped to stdin. Each session records its
   status (`ok`, `failed`, `timed-out` or `error`), exit code, duration, parsed usage and
   content-free change statistics against the previous tree.
6. **Oracles.** After the planned sessions, every oracle runs in the workspace with the base
   environment only: no condition tools and no instrumentation.
7. **Fix sessions.** While task oracles fail and the task's `fix.max` allows, a fix session
   (`fix1`, `fix2`, …) runs with the fix prompt, followed by another oracle check.
8. **Inspection** (telemetry enabled). After the final session, read-only:
   - a `.context/current-envelope.json` in the workspace gives the estimated tokens and omission
     count;
   - when `.context/config.yaml` exists, Keystone's validation runs in process and gives the
     diagnostic count and codes.
9. **Record.** The record is installed, and the run state becomes `done`.

**Usage parsers:**
- `keystone-bench-json` reads a JSON object the agent writes to `{usage_file}`;
- `claude-code-json` reads the JSON result object on standard output (`claude -p --output-format
  json`): input plus cache tokens, output tokens, `num_turns` and the model names;
- `none`.

Parsers keep numbers and identifiers only. Agent output is held in memory, at most 16 MiB, and
discarded.

**Durable identity comes from trusted, declared configuration** (review round 2, B8). Arbitrary
agent-reported strings are never persisted as identifiers, because character rules alone cannot
show that a string names a tool or model.
- A profile declares `trusted: { tools, models }`, which is part of its hashed bundle and authored
  by the operator.
- A reported tool, or each member of a comma-separated model list, is persisted only when it
  exactly matches a trusted identifier.
- Anything else is dropped, and the session's usage records only the content-free flag
  `unrecognized_identity: true`.
- A parser's own constant tool name (`claude-code` for `claude-code-json`) belongs to the harness,
  not the agent.
- A manual record may name only the profile's trusted identities (`BENCH_MANUAL_RECORD_INVALID`).
- Every identifier, including profile `declared` values, must also match
  `^[A-Za-z0-9][A-Za-z0-9._:/@+,-]{0,255}$`.
- Trusted model entries may not contain the `,` separator. Their full comma-joined serialization
  must fit the durable 256-character model field; otherwise validation reports
  `BENCH_TRUSTED_IDENTITY_INVALID`. Every recorded model value is a subset of that serialization,
  so a schema-valid trusted profile can never produce a schema-invalid record (review round 3).

Legitimate Claude Code reporting is kept when its models are declared. For example, the smoke
profile trusts `claude-sonnet-5-5`, and several trusted models are recorded comma-joined.

**Run state** (`harness/state.json`): `prepared` → `running` → `done`. The manual path is
`awaiting-record` → `recorded` → `done`. A run left `running` or `unrecorded` is refused
(`BENCH_RUN_INTERRUPTED`, `blocked`), because its workspace is no longer clean; remove the run
directory and prepare again.

**Run outcome:**
- `failed` if any run hit a harness error;
- otherwise `blocked` if any run was refused;
- otherwise `awaiting-record` if a manual run waits;
- otherwise `completed` if any run was executed;
- otherwise `unchanged`.

Failed sessions and failed setup are recorded outcomes, not harness failures.

## Manual mode

1. For a `manual` profile, `run` performs the setup, writes the composed prompts (`s1.md`, …,
   `fix.md`) and stops at `awaiting-record`.
2. A person works in the workspace.
3. `record` validates a `keystone-bench-manual-record`: the sessions must be the planned sessions
   in order, then `fix1…fixN` within `fix.max`. `record` stores the input and launches nothing.
4. The next `run` snapshots the workspace, runs the oracles and installs the record.

Manual durations and fix counts are labelled `reported`; quality measures are computed exactly as
for automated runs.

## Result records

A result record is written to `benchmark/results/<plan-id>/runs/<run-id>.json`. Smoke plans write
to `<work>/smoke/results/` instead (below). Each record holds:
- `run_id`, `purpose`, `status` (`completed`/`failed`), `failure` and `plan`;
- `provenance`:
  - Keystone version, commit and dirty flag, and the harness version;
  - the subject's ID and commit;
  - the task, condition and profile IDs and bundle hashes;
  - the profile's mode and declared tool and model;
  - seed, repetition, order index, start and finish timestamps, and platform;
- `inputs`: the hashes of the statement, each session prompt, the fix prompt, the oracles, the
  profile, the limits, the instrumentation, the condition instructions and the condition setup.
  Comparing two conditions' records shows which inputs were identical;
- `environment`, `setup`, `sessions`, `checks` and `telemetry`;
- `evidence`: the setup and final snapshot tree IDs of the judged change, `null` for a run that
  failed in setup. Judging packets use these sealed IDs, never mutable run state (review B5);
- `evidence_hash`: SHA-256 of the canonical record without that field.

Records contain no prompt, statement, file content, agent output or transcript. Every write uses
`writeVerified`:
1. the content is written to a fresh temporary file;
2. the temporary file's bytes are verified;
3. only then is it renamed over the target;
4. the target is read back.

On failure nothing unverified is installed under the target name (`BENCH_WRITE_FAILED`). Any
temporary file that may exist, including after a partial write, is removed. One that cannot be
removed is reported (`BENCH_TEMPORARY_FILE_REMAINS`). A target whose post-rename read-back fails
is reported as `BENCH_WRITE_UNVERIFIED` (review B4).

Run state writes are reported in the same way. If the record is installed but the final state
cannot be persisted, the run is a harness failure (`BENCH_STATE_WRITE_FAILED`, outcome `failed`),
never `completed`. The record stands, and the run is not executed again (`BENCH_RUN_INTERRUPTED`).

Loading refuses, with nothing partially scored:
- unreadable or schema-invalid records (`BENCH_RESULT_INVALID`);
- records whose content does not match their evidence hash (`BENCH_RESULT_EVIDENCE_MISMATCH`);
- smoke records among an experiment's results (`BENCH_SMOKE_NOT_EVIDENCE`);
- records from different plan content (`BENCH_PLAN_MISMATCH`).

## Measures and scoring (D24)

`benchmark/specification/scorecard.json` defines every measure, with its source and scope:

| Category | Measures | Source |
|---|---|---|
| Quality | `task_oracle_pass_rate`, `regression_oracle_pass_rate` (final check), `failed_sessions` | deterministic |
| Quality | `review_verdict`, `review_blocking_findings`, `review_non_blocking_findings` | judged |
| Continuity | `trap_recurrences` (trap oracles failing at the final check), `rework_sessions` (fix sessions run) | deterministic (`rework_sessions` is reported for manual runs) |
| Efficiency | `session_seconds` (agent sessions only) | deterministic (reported for manual runs) |
| Efficiency | `input_tokens`, `output_tokens`, `total_tokens`, `turns`, `tool_calls` | reported, never verified |
| Efficiency | `tool_seconds:<tool>`, `tool_invocations:<tool>` | deterministic; primary only when **every planned run** of the plan is recorded and resolved the tool, whatever its status (review B6); otherwise a diagnostic |
| Diagnostic | `setup_seconds`, `keystone_envelope_tokens`, `keystone_envelope_omissions`, `keystone_validation_diagnostics` | deterministic; condition-specific |

Usage sums are `null` unless every session reported the field. Diagnostics are kept apart from
primary measures in every output.

`score` writes `benchmark/analysis/<plan-id>/scores.json`: per run, the measures and diagnostics
with their sources, and no timestamps. Re-running it on the same records is byte-identical.

### Blinded judging

1. **Export.** `score --blind <dir>` writes a judging packet to an empty directory outside both
   the Keystone tree and the work directory, because the packet contains the subject's change. It
   holds:
   - each task statement;
   - per completed run, a binary-safe patch from the setup tree to the final tree, minus the
     plan's `judging.exclude` pathspecs;
   - `packet.json` with the plan identity, the procedure, and items named only by blinded IDs.

   Blinded IDs are `J-` + 16 hex digits of SHA-256 of a random secret and the run ID. The secret
   is kept in `<work>/judging/`. The packet names no condition, run, profile or workspace.
2. **Import.** `score --judged <file>` accepts attested `keystone-bench-judgements` for the
   current plan hash. It maps the blinded IDs back through the secret and stores
   `benchmark/results/<plan-id>/judgements/<hash>.json`, with de-blinded run IDs, the attestation,
   the source file hash and an evidence hash. It then scores.
   - Unknown IDs are refused (`BENCH_JUDGEMENT_UNKNOWN`).
   - A second judgement for a run is refused (`BENCH_JUDGEMENT_DUPLICATE`).
   - Re-importing the same file is a no-op.

Keystone's own REVIEW, where a condition uses it, is part of that condition's workflow and is
never the judging procedure.

## Report

`report` writes `report.json` and `report.md` to `benchmark/analysis/<plan-id>/`. Both are
generated, rebuildable and byte-identical on re-run. They contain:
- one arm per task × condition × profile, with the run, completed and failed counts;
- for each primary measure, its sources, n, median, minimum and maximum, or verdict counts for
  `review_verdict`;
- a separate "condition-specific diagnostics" section, never compared across conditions;
- source labels taken from the recorded values, never the scorecard default (review B7). A column
  header lists every source recorded for that measure (for example
  `session_seconds [deterministic, reported]`). When a column mixes sources, each cell names its
  own;
- a composite, only when the plan declares `composite.weights`: Σ weight × arm median. It is
  `null`, with the missing measures listed, when any weighted median is missing.

Weights may name only numeric primary measures (`BENCH_PLAN_WEIGHT_INVALID` otherwise).

## Smoke plans

A plan with `"purpose": "smoke"` verifies integration with a real agent profile. Its records,
scores and reports go to `<work>/smoke/`, never under `benchmark/`. A smoke record found among an
experiment's results is refused (`BENCH_SMOKE_NOT_EVIDENCE`).

## Protocol exclusions (ADR-0004 guarantee 7)

`src/context/benchmark-records.ts` classifies the root-level `benchmark/results/` and
`benchmark/analysis/`, and since TASK-0015 `benchmark/plans/` (ADR-0004 clarification of
2026-10-07), case-insensitively:
- **Discovery** never walks into them, including under a configured parent such as `benchmark`.
- **Configuration:** a source equal to or inside any of them is `CONFIG_INVALID`.
- **START and review-context selection** refuse a file reference to them after ordinary path
  validation. The refusal is `START_BENCHMARK_RECORD_INELIGIBLE`, with omission reason
  `benchmark-record-ineligible`, without changing the outcome.

Other `benchmark/` subdirectories are unaffected. The REVIEW subject boundary is unchanged.

## Diagnostics

| Code | Condition |
|---|---|
| `BENCH_USAGE` | Invalid command line (exit 2) |
| `BENCH_SPEC_UNREADABLE`, `BENCH_SPEC_INVALID`, `BENCH_SPEC_KIND_MISMATCH`, `BENCH_SPEC_KIND_UNKNOWN` | Specification cannot be read, fails its schema or semantics, or has the wrong or an unknown kind |
| `BENCH_REFERENCE_MISSING`, `BENCH_REFERENCE_INVALID` | A referenced specification or bundle file is missing, unportable, shared or unhashable |
| `BENCH_PLACEHOLDER_INVALID`, `BENCH_ID_DUPLICATE`, `BENCH_PLAN_WEIGHT_INVALID`, `BENCH_TRUSTED_IDENTITY_INVALID` | Placeholder not allowed in that context; duplicate IDs; weight on a non-weightable measure; trusted models that cannot fit the durable model field |
| `BENCH_WORK_INVALID`, `BENCH_RESULTS_INVALID`, `BENCH_SUBJECT_INVALID`, `BENCH_SUBJECT_COMMIT_MISSING` | Physically unsafe work, results or analysis location; subject not a directory or missing the commit |
| `BENCH_CLONE_FAILED`, `BENCH_PREPARE_FAILED` | Workspace preparation failed |
| `BENCH_PLAN_CHANGED`, `BENCH_PLAN_MISMATCH` | Plan content differs from existing work or records |
| `BENCH_RUN_NOT_PREPARED`, `BENCH_RUN_UNKNOWN`, `BENCH_RUN_INTERRUPTED`, `BENCH_RUN_ERROR` | Run preconditions, or a harness error during a run |
| `BENCH_RUN_NOT_MANUAL`, `BENCH_RUN_NOT_STARTED`, `BENCH_RUN_ALREADY_RECORDED`, `BENCH_MANUAL_RECORD_INVALID` | Manual-mode preconditions and input |
| `BENCH_SETUP_FAILED` | Recorded failure of a condition setup command |
| `BENCH_RESULT_INVALID`, `BENCH_RESULT_EVIDENCE_MISMATCH`, `BENCH_SMOKE_NOT_EVIDENCE` | Refused records |
| `BENCH_JUDGING_NOT_DECLARED`, `BENCH_JUDGING_EVIDENCE_MISSING`, `BENCH_BLIND_OUTPUT_INVALID`, `BENCH_BLIND_KEY_MISSING`, `BENCH_JUDGEMENTS_INVALID`, `BENCH_JUDGEMENT_UNKNOWN`, `BENCH_JUDGEMENT_DUPLICATE` | Blinded judging |
| `BENCH_WRITE_FAILED`, `BENCH_WRITE_UNVERIFIED`, `BENCH_TEMPORARY_FILE_REMAINS`, `BENCH_STATE_WRITE_FAILED` | Truthful write and run-state failure reporting |
| `START_BENCHMARK_RECORD_INELIGIBLE` | START or review context refused a benchmark record or plan reference |

Version 2 diagnostics are listed in "Phase 8 preparation (TASK-0015)" below.

## Known limitations

- **`cmd.exe` quoting.** On Windows, `.cmd` and `.bat` commands run through `cmd.exe /d /s /c`,
  where `%` expansion cannot be escaped. Declared arguments should be paths and flags, not text
  containing `%`.
- **Removed `PATH` directories.** Removing directories that provide `keystone` also removes any
  other tool installed in the same directory. Keep agent tools and a global Keystone apart.
- **Oracle side effects.** Oracles are expected to leave the workspace unchanged; this is not
  enforced.
- **Partial judging packets** (independent review, non-blocking). If `score --blind` fails part
  way, the files already written to the packet directory remain, and the outcome is `failed`. The
  directory must then be emptied before another export, which refuses a non-empty directory.
- **Network access.** Sessions are not sandboxed from the network. Keystone itself contains no
  network code; an agent tool's network use is its own (ADR-0004 guarantee 2).
- **Agent-internal tool use.** Wrapped tools also record an agent tool's own internal calls. In
  the TASK-0013 smoke run, Claude Code made 5 internal `git` calls although its instructions asked
  for no commands. The measure is identical across conditions, but experiments should choose
  `wrap` with this in mind.

## Real-agent smoke run

TASK-0013 criterion 25 passed on 2026-10-06, as integration verification only. Claude Code
(Sonnet, `acceptEdits`) ran one `baseline` session on the clean smoke task
`tests/fixtures/bench/smoke/`. TASK-0013's Tests section records the configuration and
verification. The run's records stayed in its work directory and are not benchmark evidence.

## Phase 8 preparation (TASK-0015)

TASK-0015 implemented Phase 8 preparation items 1–10 under the accepted TASK-0014 design
(revision 6), and the approved implementation contract
(`docs/TASK-0015-phase-8-preparation-contract.md`, revision 2). These mechanisms are
implementation contract (ADR-0004 guarantee 9). The one protocol change is the
`benchmark/plans/` exclusion, which ADR-0004's 2026-10-07 clarification authorizes.

**Compatibility.** Version 2 extends Phase 7 only where TASK-0015 requires it:
- Version 1 plans and profiles keep every Phase 7 behaviour above, and still produce version 1 run
  records.
- A version 1 plan rejects a version 2 profile, and the reverse.
- A run record must match its plan's version (`BENCH_RESULT_INVALID`).
- The one additive change visible to version 1 is the `codex-jsonl` usage-parser value.
- The version 2 commands refuse version 1 plans.

**Generic harness, experiment-supplied parameters.** Margins, thresholds, measures, R bounds,
fractions, seeds, term lists, completeness rules and the classification order all live in the
plan directory and enter the plan hash. The harness implements only named definitions:
- the effect types;
- the five class predicates;
- the completeness rules;
- the resampling procedures.

### Plans, repositories and freezing (items 4 and 5)

- **Location.** Experiment plans live at `benchmark/plans/<plan-id>/`: `plan.json`, the analysis
  specification, any inspection terms, `preregistration.md`, and `freeze.json`. A version 2 plan
  file is always `<plan-id>/plan.json` (`BENCH_PLAN_LOCATION_INVALID`). `freeze`, `prepare`, `run`,
  `record` and `rerun` refuse a version 2 experiment plan outside its canonical location in the
  `--root` tree.
- **Plan version 2** (`plan-v2.schema.json`):
  - `repositories.subject`, and optionally `repositories.benchmark`, each with `{ id, commit }`;
  - bundles as `{ repository: subject | benchmark | keystone, path }`, where the path is the
    bundle directory, holding `task.json`, `condition.json` or `profile.json`;
  - `stage` (`pilot` or `main`), `analysis`, `preregistration` and `calibrated_from`;
  - `limits.max_infrastructure_reruns`;
  - version 2 `judging`.
- **Hash.** The plan hash covers:
  - the plan bytes;
  - every task, condition and profile bundle hash;
  - the rubric and judge-prompt bundle hashes;
  - the hash of **every** file in the plan directory, referenced or not, recursively. The only
    exclusion is the generated top-level `freeze.json`, which is sealed and verified wherever it
    is read, so a forged record is never trusted. Symbolic links are refused. Filename-keyed hash
    tables (plan directory, bundles, attempt archives) have no prototype, so every valid filename,
    including `__proto__`, is an ordinary key. Serialization is unchanged.

  Both pinned commits are in the plan bytes.
- **Comparative eligibility (review finding 1).** Every measure the analysis specification
  compares must be a numeric measure that is not condition-specific: primary, guardrail,
  calibration, recurrence and resource measures alike. The rule is the scorecard rule that already
  governs composite weights. A diagnostic (for example `setup_seconds`) or a verdict is refused at
  load (`BENCH_ANALYSIS_MEASURE_INVALID`), and again by `analyze` and `calibrate`. Neither command
  ever reads a diagnostic value.
- **Locations file** (`--repos`, `keystone-bench-locations`): maps repository IDs to machine paths,
  relative to the file's directory. It is never hashed or recorded, and must lie outside the
  Keystone tree (`BENCH_LOCATIONS_INVALID`). The `keystone` repository is the `--root` tree.
- **Resolution.**
  - `validate` always checks structure. Without the repositories it reports
    `BENCH_REPOSITORY_UNAVAILABLE` (one per repository) and `resolved: false`, and still exits
    `valid`.
  - Every other command is `blocked` until the repositories resolve.
  - When resolved, each pinned repository must contain its commit
    (`BENCH_REPOSITORY_COMMIT_MISSING`) and have `HEAD` at it (`BENCH_REPOSITORY_NOT_AT_COMMIT`).
  - It must also have no modified, missing or untracked file under any referenced bundle path
    (`BENCH_REPOSITORY_DIRTY`). File hashes are compared in Node against `git ls-tree`, so no
    repository filter runs, and CRLF-only differences are tolerated.
- **Isolation.** The benchmark repository is only read:
  - it joins every write boundary's forbidden set;
  - the work directory and subject must not contain it, or lie inside it (`BENCH_WORK_INVALID`);
  - workspaces are cloned from the subject only.
- **Records.** Version 2 run records (`run-record-v2.schema.json`) replace `provenance.subject`
  with `provenance.repositories: { subject, benchmark | null }`, and add `provenance.attempt`.
- **`freeze <plan>`** (version 2 experiment plans only) requires:
  - resolution;
  - a canonical location;
  - a clean Keystone checkout, with every file of the plan directory tracked and unchanged
    (`BENCH_KEYSTONE_DIRTY`);
  - a passing exposure verification for the current hash (`BENCH_EXPOSURE_NOT_VERIFIED`);
  - for every main-stage plan (review finding 3), all of the following, or
    `BENCH_CALIBRATION_MISSING`:
    - a `calibrated_from`;
    - a freeze record for that pilot at that hash, with stage `pilot`;
    - the pilot's calibration export at that hash, with a determined R.

  It writes `freeze.json`, a sealed record holding the plan hash, the hash of every plan-directory
  file, both
  repositories, the Keystone commit, the exposure-verification hash and the date, through the
  `plans` write boundary.
- **After freezing.** Re-freezing is `unchanged`. A changed plan is refused (`BENCH_PLAN_CHANGED`);
  a correction needs a new plan ID. `prepare`, `run` and `record` refuse an experiment plan without
  a matching freeze record (`BENCH_PLAN_NOT_FROZEN`).

### Version provenance (item 1)

- A version 2 profile (`agent-profile-v2.schema.json`) declares `declared.tool_version`, which
  must be one of `trusted.tool_versions` (`BENCH_TRUSTED_IDENTITY_INVALID`). A `command` profile
  also declares `version.command`, which may use only the placeholders `{node}` and `{profile}`.
- **The probe.** Before each run's condition setup, `run` launches the version command:
  - with the controlled base environment and the setup timeout;
  - its first non-empty output line is persisted only if it exactly matches a trusted version.
- **A mismatch** refuses the run before anything else runs: `BENCH_TOOL_VERSION_MISMATCH`, outcome
  `blocked`, the run stays `prepared`, and no attempt is consumed. An untrusted string is described
  as "untrusted", never echoed.
- **Records** carry `provenance.profile.observed: { tool_version, tool_version_source, models }`.
  The source is `deterministic` from the probe, or `reported` from a manual record's trusted
  `tool_version`.
- A session that reports a trusted model other than the declared one is flagged
  `usage.model_mismatch: true`. `report` and `analyze` list version and model mismatches and
  unrecognized identities. They never exclude those runs.

### Codex usage parser (item 2)

`codex-jsonl` reads the `codex exec --json` event stream on standard output:

| Measure | Mapping |
|---|---|
| `input_tokens` | Σ `turn.completed.usage.input_tokens` (cached input is already included, so it is not added again) |
| `output_tokens` | Σ `turn.completed.usage.output_tokens` |
| `turns` | count of `turn.completed` |
| `tool_calls` | count of `item.completed` events whose item type is `command_execution`, `mcp_tool_call`, `web_search` or `file_change` |
| model | not reported by the stream; the declared model stands |
| tool | the parser constant `codex` |

- Unparseable lines are skipped.
- A stream with no `turn.completed` gives `null` usage, never zero. A turn missing token counts
  makes the token sums `null`. The `BENCH_USAGE_UNREPORTED` notice is raised whenever input tokens,
  output tokens or turns are unknown, not only when usage is wholly absent (review finding 9).
- **The mapping is confirmed.** The offline fixture
  (`tests/fixtures/bench/usage/codex-jsonl.synthetic.jsonl`) is synthetic. TASK-0015 criterion 33
  confirmed the mapping against the real Codex CLI 0.160.0: cached input and reasoning counts are
  not double-counted, and the model stays null.

### Preserved attempts and reruns (item 7)

`rerun <run-id> --plan <plan> --classification <file>` applies to version 2 plans only
(`BENCH_RERUN_UNSUPPORTED` otherwise).

- **Input.** A `keystone-bench-attempt-classification` file:
  - the run ID and its current attempt number;
  - the class, which must be `infrastructure`;
  - the cause;
  - evidence paths inside the run directory;
  - `classified_by: owner` and a date.
- **Refusals.** `rerun` is refused:
  - once any score or analysis exists for the plan (`BENCH_RERUN_AFTER_SCORING`);
  - beyond `limits.max_infrastructure_reruns`, which defaults to 0 (`BENCH_RERUN_EXHAUSTED`);
  - for a run that never started (`BENCH_RERUN_NOT_STARTED`).
- **The move.**
  1. The whole run directory moves to `<work>/attempts/<run-id>/<attempt-n>/`.
  2. An installed record is copied there as `record.json`. It is removed from `benchmark/results/`
     only after its exact bytes are verified at that destination. An existing destination is
     trusted only if it is a regular file with exactly those bytes. Any other entry or content fails
     with `BENCH_ATTEMPT_ARCHIVE_CONFLICT`: the original stays in place, nothing is logged, and the
     history stays incomplete. When recovering a transition whose original was already removed, the
     archived copy must be an intact sealed record of this run, plan and attempt. `record_archived`
     is true only once preservation is established.
  3. The classification file is kept beside it.

  Nothing is deleted.
- **The log.** `benchmark/results/<plan-id>/attempts/<run-id>.json` is a content-free, sealed log.
  For each attempt it holds the attempt number, the timestamps, the classification without free
  text, the evidence-file hashes and the archive content hash.
- **The rerun.** The same planned run is re-prepared as attempt n+1, and only the current attempt
  supplies evidence. For version 2 plans, `BENCH_RUN_INTERRUPTED` points to `rerun`; version 1 keeps
  the manual removal procedure.
- **Durable history (review finding 6).** The archived attempts 1…k and the log entries must agree.
  - A fresh `prepare` uses attempt k+1, and refuses with `BENCH_ATTEMPT_HISTORY_INCOMPLETE` when
    they disagree. It therefore never reuses an attempt number or ignores the archive.
  - An interrupted `rerun` (the run directory archived, the log not yet written) is completed by
    running the same command again: the transition resumes from the archive. A failure after the
    log is written leaves a consistent history, which `prepare` continues.
- **Terminal infrastructure failures (review finding 7).**
  `classify <run-id> --plan <plan> --classification <file>` records an owner-classified
  infrastructure failure whose reruns are exhausted as a terminal log entry. The attempt stays in
  place, and nothing is archived.
  - It is refused while a rerun is still allowed (`BENCH_RERUN_AVAILABLE`), and once any score or
    analysis exists.
  - A terminal run is never prepared or rerun again (`BENCH_ATTEMPT_TERMINAL`).
  - `analyze` treats it as missing (`matrix.infrastructure_missing`), never as an outcome.
  - `calibrate` excludes it from the dataset and counts it as an infrastructure failure.

### Judging version 2 (items 3 and 8; C2, C5)

- **Declarations.** Version 2 `judging` declares:
  - `judges`: `vendor` or `audit` role, `model` (with model and version) or `owner` kind;
  - an optional `audit` sample: judge, fraction, seed, stratified by task;
  - pinned `rubric` and `prompt` bundles (the rubric from a pinned repository);
  - optional `inspection`: plan-directory term files and a replacement.
- **Export.** `score --blind` scans every statement and patch, before writing any packet file,
  with:
  - the default terms (`benchmark/specification/inspection/keystone-terms.json`, generic Keystone
    identifiers only);
  - the plan's terms.

  Every match is replaced by the single replacement, under the same rule for every run. The
  inspection log, which holds excerpts, stays at `<work>/judging/inspection/`. `packet.json`
  (schema version 2) records:
  - the terms hash, the replacement and the log hash;
  - the hit counts per term;
  - the hash of `audit.json`.
- **Audit sample.** Per task stratum, the blinded IDs in ascending SHA-256(`seed:blind ID`) order,
  ⌈fraction × stratum size⌉ of them. It is computed from blinded IDs only.
- **Release gate (C5).** `release <plan> --attestation <file>` takes a
  `keystone-bench-packet-release` file: packet hash, inspection-log hash, `reviewed_by: owner`, date
  and statement.
  - **Binding (review finding 5).** It reads the exported packet text and audit text from the work
    directory, and trusts neither until checked (`BENCH_RELEASE_INVALID`):
    - the packet text must hash to the attested packet hash;
    - the inspection-log hash must equal the one the packet records;
    - the audit text must hash to the one the packet records, and must equal the audit sample
      recomputed from the packet's items under the plan's declared rule.
  - It writes a sealed, content-free release record to `benchmark/results/<plan-id>/judging/`,
    holding the released items (blinded ID and task) and the audit sample.
  - Judgement import takes item and audit membership only from sealed release records. It
    recomputes the audit sample from the plan's rule, and never reads the mutable work-directory
    manifest. It refuses any blinded ID that is in no released packet
    (`BENCH_PACKET_NOT_RELEASED`).
  - Inspection hit counts are stored collision-safely, so a term ID such as `constructor` is an
    ordinary key (review finding 8).
- **Import.** Judgements version 2 (`judgements-v2.schema.json`) attest:
  - the judge (a declared judge ID);
  - the rubric commit and hash, and the prompt hash, all equal to the plan's pins
    (`BENCH_JUDGEMENT_PROVENANCE_INVALID`);
  - an optional `condition_guess` per item.

  Judgements are keyed by run and judge. A second judgement by one judge for one run is
  `BENCH_JUDGEMENT_DUPLICATE`, and an audit-role judgement outside the sample is
  `BENCH_JUDGEMENT_NOT_SAMPLED`.
- **Measures (C2).** `review_blocking_findings` and `review_non_blocking_findings` are the mean
  over vendor judges, defined only when every vendor judge has judged the run.
  `review_verdict:<judge>` keeps each judge's categorical verdict. Verdicts are never averaged,
  and version 2 has no run-level `review_verdict`.
- **Statistics.** `analyze` reports per-judge counts and verdicts, guess participation and
  accuracy, and pairwise agreement (inter-vendor, and vendor to audit). These are never outcome or
  classification inputs.

### Hidden-material exposure verification (item 10)

`verify-exposure <plan>` launches nothing. It writes a sealed, content-free record to
`benchmark/results/<plan-id>/verification/exposure-<hash prefix>.json`. A failure is `invalid`,
with `BENCH_EXPOSURE_CHECK_FAILED` for each failing check:

| Check | Automated test |
|---|---|
| E1 | Profile, version and condition-tool commands and `env.pass` name no benchmark-repository path or ID. No actually inherited variable value (allow-listed or passed through) contains one; values are only counted, never recorded (review finding 4). A command does not expand `{profile}` or `{condition}` into a benchmark-repository bundle (tool shims sit on the session `PATH`). |
| E2 | No manual profile. |
| E3 | No condition-staged file contains the full text of a task-bundle file (except `task.json` and the first session prompt), an oracle command, or a rubric or judge-prompt file. Whitespace is normalized. Any non-empty hidden text counts, with no length exemption (review finding 4), so a short coincidental match fails conservatively. |
| E4 | The benchmark repository lies outside the work directory and the subject, and on no base `PATH` entry. |
| E5 | The subject is not the benchmark repository. |
| E6 | The harness invariant that only the current prompt is written before each launch holds whenever E2 passes. |

The record also lists the owner attestations the harness cannot automate (marked unattested), and
the residual risk: no filesystem-permission isolation.

### Condition-blind calibration (item 6)

`calibrate <pilot-plan>` needs a version 2 `stage: pilot` plan whose analysis specification
declares `calibration`. It writes `calibration.json` and `.md` to the pilot's analysis directory.

- **Dataset.** One row per recorded run:
  - a fresh random `C-` ID, whose secret is never kept;
  - the task and profile, and validity;
  - the calibration measure, recurrences and trap opportunities;
  - tokens, seconds and session count, by the plan-declared measures;
  - the attempt count.

  No condition, condition-derived hash, setup data, diagnostic, path, telemetry or failure text is
  copied.
- **Outputs:**
  - discrimination flags per task (floor, ceiling, and an extreme headline recurrence rate);
  - the infrastructure-failure rate (archived attempts ÷ all attempts) against the threshold;
  - per headline cell, the pooled σ with no condition split, and R_cell = ⌈2σ² ÷ SE²⌉ (the
    minimum when σ = 0);
  - for each unpiloted target task, the largest observed σ of the same profile, with its source;
  - R = clamp(max R_cell), and LOWER PRECISION when max R_cell exceeds the maximum;
  - resource projections for every R in the declared range, including the rerun allowance.
- **Pilot gating.** `score`, `report` and `analyze` refuse a pilot plan
  (`BENCH_PILOT_CONDITION_BLIND`) until a main plan whose `calibrated_from` names it has been
  frozen. Their output for the pilot is then marked `non_evidence`.

### Pre-registered analysis (item 9)

`analyze <plan>` needs a version 2 plan whose analysis specification declares `analysis`. It
writes `analysis.json` and `analysis.md`, byte-identical on re-run.

- **Matrix.** Every planned run; a missing record or a null value contributes no observation.
  Nothing is imputed or reweighted.
- **Cells and weights.** Cells are headline task × profile, with fixed equal weights. A cell is
  defined only when each arm satisfies the declared completeness rule:
  - `ceil-half-R`: at least ⌈R/2⌉ observations;
  - `all-planned`: all R.
- **Effects:**
  - `difference`: Σ w(K̄ − B̄);
  - `relative-reduction`: r = 1 − ΣwK̄ ÷ ΣwB̄, with the four zero-value cases. B = 0 < K is
    `unbounded-deterioration`.

  Effects are computed pooled and per profile.
- **Guardrails (C3)** cover every task × profile cell:
  - the arm statistic (mean or median) per cell, and the equal-weight mean of the cell statistics;
  - an absolute guardrail compares K − B, and a relative one compares K ÷ B − 1;
  - a guardrail is `unknown` when any cell fails the guardrail completeness rule, or B = 0 for a
    relative guardrail. A known value is never computed from an insufficient subset.
- **Classification.** The five predicates are evaluated in the declared order, pooled and per
  profile; per-profile classification has no tool contradiction. The triggers are reported.
- **Statistics.** A permutation test within headline cells, and a stratified percentile bootstrap
  by task × profile × condition. Both are driven by SHA-256 of the declared seed, and the share of
  unbounded resamples is reported. They never override the classification.

### Version 2 diagnostics

| Code | Condition |
|---|---|
| `BENCH_PLAN_LOCATION_INVALID`, `BENCH_PLAN_NOT_FROZEN`, `BENCH_FREEZE_UNSUPPORTED`, `BENCH_KEYSTONE_DIRTY`, `BENCH_CALIBRATION_MISSING` | Plan location and freezing |
| `BENCH_LOCATIONS_INVALID`, `BENCH_REPOSITORY_UNAVAILABLE`, `BENCH_REPOSITORY_COMMIT_MISSING`, `BENCH_REPOSITORY_NOT_AT_COMMIT`, `BENCH_REPOSITORY_DIRTY` | Repository resolution and pins |
| `BENCH_TOOL_VERSION_MISMATCH`, `BENCH_USAGE_UNREPORTED` | Version probe; unreported Codex usage (a notice) |
| `BENCH_RERUN_UNSUPPORTED`, `BENCH_RERUN_NOT_STARTED`, `BENCH_RERUN_EXHAUSTED`, `BENCH_RERUN_AVAILABLE`, `BENCH_RERUN_AFTER_SCORING`, `BENCH_ATTEMPT_CLASSIFICATION_INVALID`, `BENCH_ATTEMPT_ARCHIVE_FAILED`, `BENCH_ATTEMPT_HISTORY_INCOMPLETE`, `BENCH_ATTEMPT_TERMINAL`, `BENCH_ATTEMPT_ARCHIVE_CONFLICT` | Preserved attempts and terminal classification |
| `BENCH_ANALYSIS_MEASURE_INVALID` | A compared measure is not comparatively eligible |
| `BENCH_JUDGEMENT_PROVENANCE_INVALID`, `BENCH_JUDGEMENT_NOT_SAMPLED`, `BENCH_PACKET_NOT_RELEASED`, `BENCH_RELEASE_INVALID` | Version 2 judging and the release gate |
| `BENCH_EXPOSURE_UNSUPPORTED`, `BENCH_EXPOSURE_CHECK_FAILED`, `BENCH_EXPOSURE_NOT_VERIFIED` | Exposure verification |
| `BENCH_CALIBRATION_UNSUPPORTED`, `BENCH_CALIBRATION_INCOMPLETE`, `BENCH_PILOT_CONDITION_BLIND` | Calibration and pilot gating |
| `BENCH_ANALYSIS_UNSUPPORTED`, `BENCH_CLASSIFICATION_UNMATCHED` | Analysis |

New outcomes `verified`, `frozen`, `released`, `calibrated`, `analyzed` and `classified` exit 0.

### Version 2 limitations

- **Plan hashes and line endings.** Bundle hashes use working-file bytes. A checkout whose line
  endings differ (for example `core.autocrlf` on Windows) changes them. Run a frozen plan on a
  checkout with the line-ending configuration used at freezing, or mark the bundles `-text` in the
  benchmark repository.
- **Release is a recorded manual gate.** The harness enforces that a release was recorded before
  import. It cannot observe the owner's review itself.
- **Exposure checks are textual.** E3 detects copies of whole hidden texts of any length, not paraphrases or
  fragments shorter than 24 characters. The owner attestations cover what automation cannot.
