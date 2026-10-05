# Phase 6 implementation contract — TASK-0011

The architecture is owned by:
- D21, D11, D15, D20;
- ADR-0003, with ADR-0001 and ADR-0002;
- SPEC.md ("Compaction and retirement");
- the accepted TASK-0010 contract (`docs/TASK-0010-phase-6-compact-design.md`, revision 3).

This document records the mechanisms TASK-0011 chose. It creates no architectural requirement:
any mechanism here may change without an ADR while ADR-0003 and SPEC.md remain satisfied.

## Command

```powershell
node dist/cli/index.js compact --root "C:\path\to\repo" --json
node dist/cli/index.js compact --task TASK-0002 --retire LRN-0001 --reason "Consolidated." --by LRN-0002 --retire LRN-0003 --reason "Never confirmed." --root "C:\path\to\repo" --json
```

- `--task <TASK-ID>` is given once and is required whenever `--retire` is given.
- Each `--retire <ID>` starts a group. The next `--reason <text>` (required, non-blank) and
  optional `--by <ID>` belong to that group, once each.
- `--root` is used directly, as for `index`, `validate` and `start`. COMPACT needs no Git.
- **Usage errors (exit 2, `CLI_USAGE`):**
  - operations without `--task`, or `--task` without operations;
  - `--retire` without a reason, or a blank reason;
  - `--reason` or `--by` before any `--retire`, or repeated within one group;
  - the same ID retired twice in one run;
  - positional arguments after `compact`;
  - compaction flags on any other command, including `context explain`. Flag scope is checked
    before `COMMAND_NOT_IMPLEMENTED`, so the usage error is not masked.
- **Exit codes:** `reported`, `compacted` and `unchanged` exit 0; `blocked` exits 1; `failed` and
  usage errors exit 2.
- The library function `prepareCompact` evaluates everything without writing. `compact` also
  applies the result.

## Order of evaluation

1. **Usage** as above.
2. **Inventory.** An unreadable inventory is `failed` (`COMPACT_INVENTORY_UNREADABLE`).
3. **Structural validation.** Any working-tree diagnostic is `failed`
   (`COMPACT_VALIDATION_FAILED`, followed by the diagnostics). This includes the ADR-0003
   invariants, so COMPACT never operates on a broken provenance chain.
4. **Report.** Without operations, the outcome is `reported`. Nothing is written, not even
   generated state.
5. **Task.** `--task` must name a task with status `active`. Otherwise `blocked`
   (`COMPACT_TASK_INVALID`).
6. **Retirement checks** for every request, sorted by ID.
7. **Writes.** All checks complete before any write.

## Retirement checks

A failure is `COMPACT_RETIREMENT_INVALID`, naming the ID and the reason. The artifact must:
- exist;
- be a learning or trap. ADRs, rules, skills, projects, features and tasks are never retired by
  COMPACT;
- be valid UTF-8.

An artifact that is already `retired` is not retired again:
- if its record has the same task, the same trimmed reason and the same successor list, it is
  `unchanged`;
- otherwise the run is `blocked` (`COMPACT_ALREADY_RETIRED`), because retirement is terminal.

A successor named with `--by` must:
- exist and differ from the retired artifact;
- have the same type;
- not be retired in the same run;
- be eligible: an `accepted` learning, or an `active` trap with severity `medium`;
- not lead back to the retired artifact through `superseded_by` (cycle);
- contain the retired artifact's resolved `tasks`, every `evidence` string and, for traps, every
  declared `files` entry.

Provenance containment is one function (`src/compaction/provenance.ts`) shared with validation.
Tasks compare by resolved identity. Evidence compares as exact strings. Trap `files` compare as
declared paths, normalized by the portable-path rules (so `src\app.txt` equals `src/app.txt`),
not as graph edges. The graph deliberately creates no edge for generated paths such as
`context/STATE.md` or `.context/...`, and those must be preserved too (review finding B1).

Any failing request blocks the whole run. Nothing is written.

## Effect

For each retired artifact, `src/compaction/edit.ts` applies minimal textual edits to the raw
file. Every unrelated byte is preserved: a BOM, LF, CRLF or lone-CR line endings, comments,
quoting, spacing, key order and the Markdown body (review finding B3).
- The file is decoded as exact UTF-8, keeping any BOM. Nothing is normalized.
- The `status` value is replaced in place, in its original quoting style.
- An existing empty `superseded_by` value is replaced in place.
- New keys are appended in the mapping's own style:
  - block style: before the closing delimiter, with the mapping's indentation and the file's
    line ending;
  - flow style: before the closing `}`.
- New values are written as JSON scalars, which are valid YAML, so IDs and reasons can never
  change type.
- The edited front matter is parsed again and must equal the original metadata plus exactly the
  retirement fields. Otherwise the run fails with `COMPACT_CONTENT_UNREADABLE` and nothing is
  written.

The fields written are:
- `status: retired`;
- `retirement: { task, reason, previous_status }`, where `previous_status` is the status before
  retirement. No timestamp is written, so identical requests are deterministic;
- `superseded_by: [<ID>]` when `--by` is given.

Successors and every other file are unchanged.

**Binding removals (owner decision I1).** Retiring binding knowledge (an accepted learning or an
active `medium` trap) without a successor emits `COMPACT_BINDING_REMOVAL`. So does retiring an
artifact that a retired artifact names as successor; the message names the predecessors whose
chain now ends. Such a retirement is permitted.

`COMPACT_INDEX_UPDATE_REQUIRED` reminds the owner that hand-maintained navigation is not edited.

## Report

Every successful result carries a deterministic `report`, computed from the inventory before
writing (`reported`, `unchanged`) or after writing (`compacted`). It contains:
- `stale_candidates`: candidate learnings and proposed traps with at least one linked task,
  where every linked task has status `accepted`;
- `binding`: binding learnings and traps grouped `by_task` and `by_feature`, plus `unlinked`.
  Groups are keyed by task or feature ID, sorted, and built with Maps. The output objects hold
  only own data properties, so any valid portable ID is safe, including names of inherited
  object members such as `constructor`, `toString` or `hasOwnProperty` (review round 2);
- `retired`: each retired artifact with:
  - its record;
  - `superseded_by`;
  - `endpoints`, where its successor chain ends: a non-retired artifact, or a retired one with no
    successor;
  - `was_binding`;
  - `binding_removal`.
- `binding_removals`: the IDs with `binding_removal: true`.

`was_binding` applies START semantics. It is true for an accepted learning, or for an active trap
with severity `medium`; severity is read from the artifact, since retirement does not change it.
An active trap of any other severity was never binding (review finding N1). A hand-authored record
without `previous_status` is treated as possibly binding unless severity rules it out.
`binding_removal` is true when `was_binding` holds and no endpoint of the chain is binding now. A chain ended by
retiring its successor therefore stays visible in every later report.

## Writes

- Each changed file is written to a temporary sibling `.<name>.compact-<uuid>.tmp`, registered
  for cleanup before it is written.
- Files are renamed in order, and the inventory is re-validated.

**Failure and recovery (review finding B2).** Any failure is `failed` (`COMPACT_WRITE_FAILED`),
and recovery is reported truthfully:
1. Each renamed file is restored, newest first, by writing its original bytes to a new temporary
   sibling and renaming it into place. It is then read back and compared byte for byte. A file
   that cannot be restored, or whose restoration cannot be verified, is listed in `unrestored`
   with `COMPACT_ROLLBACK_INCOMPLETE`. It may still contain the retirement edit.
2. Every temporary file is removed. One that cannot be removed (other than one already gone) is
   listed in `temporary_files` with `COMPACT_TEMPORARY_FILE_REMAINS`.
3. The `COMPACT_WRITE_FAILED` message says that every original was restored and verified only when
   both lists are empty. Otherwise it says recovery is incomplete and that the listed state needs
   manual repair.

The result always carries `unrestored` and `temporary_files`, empty on success.

COMPACT writes only the retired artifacts. It never writes `TASKS.md`, `context/*.md`,
`reviews/`, high-authority artifacts or Git state.

## Validation and START (ADR-0003 guarantees 2–5)

- Graph and validation changes are recorded in `docs/PHASE-0-1.md`, with the codes
  `SUPERSESSION_NOT_RETIRED`, `RETIREMENT_RECORD_MISSING`, `RETIREMENT_RECORD_UNEXPECTED` and
  `SUCCESSION_CONTAINMENT_BROKEN`.
- `schemas/learning.schema.json` and `schemas/trap.schema.json` define `superseded_by` (string
  list) and `retirement` (`task`, non-blank `reason`, optional `previous_status`, no other keys).
- START changes are recorded in `docs/PHASE-3.md`.
- CLOSE needs no change: it promotes only `candidate` learnings and `proposed` traps.

## Known limitations

- Atomic replacement covers each file. Multi-file consistency relies on verified restoration,
  under the v0.1 stable-working-tree assumption. When the filesystem refuses restoration, the
  all-or-nothing guarantee cannot be kept, and the unrecovered files are reported instead.
- CLOSE (`docs/PHASE-5.md`) still uses its original, unverified restoration. It was outside the
  TASK-0011 review findings and is unchanged.
- Front matter that cannot be edited textually with certainty fails safely
  (`COMPACT_CONTENT_UNREADABLE`), with nothing written. Examples are a mapping that is not the
  document root, or block front matter whose last line has no line ending.
- The CLI names at most one successor per retirement. Hand-authored retirements may name
  several; validation applies the same invariants to each.
- Report signals are structural. Whether knowledge is redundant or obsolete remains human or
  agent judgement.
