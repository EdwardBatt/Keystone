# Phase 2 implementation — TASK-0002

This is implementation documentation. `SPEC.md` and `ARCHITECTURE-DECISIONS.md` remain
authoritative; `AGENTS.md` governs agent behavior. The task is
`tasks/TASK-0002-phase-2-init-status.md`. No architectural authority is introduced here.

## Scope and choices

Phase 2 adds `keystone init` and `keystone context status`. Task context was resolved from
the task's textual references to the specification, architecture decisions, agent protocol,
and `templates/TARGET-REPO-TREE.md`; the bootstrap artifact had no typed metadata links.
The initial Phase 0/1 restriction applied to the first implementation, not this separately
authorized Phase 2 task.

Status uses a structural inventory rather than interpreting future context envelopes.
Initialization uses existing templates and empty headings for missing layout documents;
it creates no new architectural decisions, project rules, or procedural content. Git's
local `rev-parse --show-toplevel` resolves the root, including `.git` file layouts. Git
root/location overrides (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`,
`GIT_CEILING_DIRECTORIES`, `GIT_DISCOVERY_ACROSS_FILESYSTEM`) are removed so `--root`
determines discovery. Git configuration/trust environment, including `GIT_CONFIG_*`, is preserved.
Git must be installed; no network, commit, push, or Git initialization is performed by Keystone.

These are implementation choices within Phase 2. No proposed ADR was created for this task.
Future material architecture questions still require proposal/review under the protocol.

## Initialization

```powershell
node dist/cli/index.js init --root "C:\path\to\repo" --json
node dist/cli/index.js init --root "C:\path\to\repo" --adapter claude --adapter gemini
node dist/cli/index.js init --root "C:\path\to\repo" --force
```

`--root` defaults to the working directory. Initialization operates at its containing Git
root, even when invoked from a subdirectory. It does not initialize Git or modify `.git`.

The scaffold contains the root project/task/protocol documents, conventional artifact
directories, context/ADR/skill index headings, empty rule and agent-role headings, and
`.context/config.yaml`. The project ID is a portable slug derived from the root folder name, quoted as a YAML string
so names such as `123`, `true`, `false`, and `null` remain strings.
Configuration contains only `schema_version: 1`, preserving optional default discovery.
No sample task or feature is invented. `context/STATE.md` uses the existing generated
placeholder template. No envelope, telemetry records, or review workflow is generated.

`AGENTS.md` is always offered through the base scaffold and also serves as the thin Codex
entry point. `--adapter codex`, `--adapter claude`, and `--adapter gemini` are repeatable,
noninteractive choices. Claude/Gemini files are opt-in and point to repository documents;
they contain no copied project facts. Help and JSON output list the available adapters.

All known destinations are preflighted before scaffold creation. Existing regular files
are preserved, including project documents, rules, skills, ADRs, agents, and adapters.
`--force` permits replacing **only `.context/config.yaml`** with defaults. Replacement uses
a temporary sibling and rename, preserving other paths hard-linked to the original config.
Resetting configuration removes custom `sources` and restores default discovery; source
files themselves are preserved. This config-only force policy is an implementation choice
within the specification's overwrite constraint, not a specification requirement.
Identical configuration is not rewritten. Directory/file collisions, path casing errors,
pre-existing symlinks/junctions, and unrecognized index contents are refused.

New scaffold files are fully written to temporary siblings before rename to their final paths.
A failed write/rename leaves the final path absent; completed files remain available for retry.
Temporary siblings are cleaned up on handled errors. Abrupt termination can leave `.tmp`
files, which are not authoritative artifacts and do not prevent retry. Rename atomicity
depends on filesystem support; this is not a power-loss durability guarantee.

After scaffolding, the existing Phase 1 inspection validates all discovered artifacts.
Only a successful inspection permits the existing index writer to rebuild `.context/index.json`.
Repeated initialization preserves existing source contents and unchanged index bytes/mtime.
Invalid existing artifacts/configuration are reported and not repaired implicitly. Files
already created can remain after validation or I/O failure; there is no multi-file transaction
or rollback. A rerun fills missing files without replacing project knowledge.

The v0.1 stable-working-tree assumption applies throughout: path checks and overwrite checks
are not race-safe under concurrent filesystem replacements. No locking or adversarial
filesystem security infrastructure is introduced.

JSON results include `root`, `created`, `preserved`, `replaced`, selected `adapters`,
`available_adapters`, `artifact_count`, `index_changed`, and `diagnostics`, alongside the
usual `command` and `ok`. After scaffold work begins, failures retain the completed file
lists; directories are not listed. Human output says `Initialization incomplete` on failure.
Preflight failures occur before writes and return diagnostics without progress lists. The file lists describe scaffold files; index generation is
reported separately by `index_changed`. Exit status is nonzero on validation or I/O errors.

## Context status

```powershell
node dist/cli/index.js context status --root "C:\path\to\repo" --json
```

Status detects the Git root and reads configuration, authoritative artifacts, and the
existing generated index. It never creates, repairs, or writes files. Its JSON result includes
configuration presence, artifact counts by type, deterministic validation diagnostics,
and an index state:

| State | Meaning |
|---|---|
| `missing` | No index exists |
| `current` | Fresh: stored bytes match the index rebuilt in memory from valid authoritative inputs |
| `stale` | Structurally valid stored index differs from that in-memory index |
| `invalid` | Invalid JSON, ownership marker, or artifact/link record structure |
| `unverified` | Read/configuration/artifact errors prevent confirming freshness |

Missing configuration uses Phase 1 defaults. Missing/stale indexes alone are informational
and do not cause failure; malformed indexes, invalid sources/configuration, and I/O errors
do. Counts cover successfully parsed/validated artifacts, so consult diagnostics before
using counts from an invalid repository. Root paths appear only in command results, not
in the generated index. No task selection, context compilation, token budgeting, review,
learning promotion, closure, compaction, or benchmark execution is implemented.

## Validation and errors

Phase 0/1 error codes remain in use. Phase 2 adds:

- `GIT_ROOT_NOT_FOUND`: Git reports no repository, or its root does not contain the requested directory.
- `GIT_DISCOVERY_FAILED`: other Git failures, including installation, trust, configuration,
  permissions, or execution failure. Git diagnostics use a stable locale for classification.
- `INIT_CONFLICT`: a scaffold destination has an incompatible filesystem shape.

`context status` also uses `INDEX_INVALID` for a structurally invalid generated index. Usage
errors exit `2`; validation/I/O failures exit `1`; successful commands exit `0`.
At Phase 2 completion, Phase 3+ commands were unavailable with `COMMAND_NOT_IMPLEMENTED`.
START is now implemented separately; see [Phase 3](PHASE-3.md). Other deferred commands remain unavailable.

`tests/phase2.test.mjs` exercises initialization, preservation with/without force, adapters,
nested roots, `.git` files, collisions, junctions, malformed configuration, hard-linked
config replacement, read-only status/freshness, deterministic rebuilds, and scope limits.
Fixtures use temporary local Git repositories; the linked-worktree fixture creates an
empty local commit using test-only identity and signing disabled. No network is used. Existing Phase 0/1 tests
continue to run alongside these tests, with command-availability expectations updated.

## Bootstrapping this framework repository

This repository is bootstrapped by hand under TASK-0005, not by running `init`. Full `init`
would add empty scaffold files (agent roles, context ledgers, rules and skills) that hold no
project knowledge and belong to later phases. The hand-authored set is `PROJECT.md`,
`TASKS.md`, `adr/INDEX.md` and a `.context/config.yaml` that contains only `schema_version: 1`,
so default discovery still applies. Do not infer project facts or task history; the
retrospective TASK-0001 record cites only repository evidence. After editing context
artifacts, run `validate`, then `index`, then `context status`. `start <TASK-ID>` should
compile this repository's tasks as `complete`, which does not authorize implementation.
Add further scaffold files only when a task needs them.
