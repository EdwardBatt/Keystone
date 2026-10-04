# Phase 5 implementation contract — TASK-0009

The architecture is owned by:
- D10–D12, D15, D20;
- ADR-0001 and ADR-0002;
- SPEC.md;
- the accepted TASK-0008 contract (`docs/TASK-0008-phase-5-close-design.md`).

This document records the mechanisms TASK-0009 chose. It creates no architectural requirement.

## Command

```powershell
node dist/cli/index.js close TASK-0001 [--promote LRN-0002]... [--override "reason"] --root "C:\path\to\repo" --json
```

- `--promote <ID>` may be repeated. `--override <reason>` requires a non-blank reason.
- `--root` follows `review`: it must be the Git top-level.
- **Exit codes:**
  - `closed` and `already-closed`: 0;
  - `blocked`: 1;
  - `failed` and usage errors: 2.
- The library function `prepareClose` evaluates everything without writing. `close` also
  applies the result.

## Order of evaluation

1. **Task.** The task is found by ID in the working-tree inventory.
   - An unreadable inventory, an unknown task or a duplicate ID is `failed`
     (`CLOSE_TASK_NOT_FOUND` or `CLOSE_TASK_AMBIGUOUS`).
2. **Already closed.** A task whose front matter has a `closure` record is `already-closed`:
   nothing is evaluated or written. A `--promote` or `--override` request against it is
   `blocked` (`CLOSE_ALREADY_CLOSED_REQUEST_REFUSED`). Tasks accepted before Phase 5 have no
   closure record and are not already closed.
3. **Structural validation.** Working-tree validation must pass. Otherwise the result is
   `failed` (`CLOSE_VALIDATION_FAILED`, with the diagnostics). The task file must be valid UTF-8
   (`CLOSE_CONTENT_UNREADABLE`).
4. **Evidence preparation.** Review evidence must be preparable at `HEAD`. If the review
   compilation fails, so does CLOSE (`CLOSE_EVIDENCE_UNAVAILABLE`, wrapping the review
   diagnostic).
5. **Review gate.**
6. **Override.**
7. **Promotion checks.**
8. **Writes.** All checks complete before any write.

## Review gate

- **Report selection.** For each role (`architecture`, `code`, `context`), the report is the
  highest-round file in `reviews/<TASK-ID>/` named `<role>-<n>.md`, with no zero padding. An
  invalid latest report is not replaced by an earlier round.
- **Invalid report.** A report is invalid when:
  - it is not valid UTF-8;
  - its front matter fails `schemas/review-report.schema.json`;
  - `task`, `role` or `round` disagree with the task or the file name;
  - `## Findings` or `## Evidence Examined` is missing;
  - `## Findings` is blank under `changes-requested`;
  - `## Limitations` is missing or blank under `inconclusive`.
- **Current report.** The report's `evidence_hash` equals the `evidence_hash` from
  `compileReview(root, task, { base: report.base })`, computed once per distinct base. A base
  that no longer resolves, or whose evidence cannot be prepared, makes the report not current.
- **Report states:** `missing`, `invalid`, `stale` or `current`. The verdict is recorded as
  written.
- **Satisfied:** all three roles are `current` with verdict `approve`.
- **Unsatisfied without `--override`:** `blocked` (`CLOSE_GATE_UNSATISFIED`), with one
  diagnostic per failing role.

## Override

- With a non-blank reason and an unsatisfied gate, the gate is `overridden`
  (`CLOSE_OVERRIDE_APPLIED`).
- Reports are never modified, and the closure record keeps each report's actual state and
  verdict.
- If the gate is already satisfied, the override is unused (`CLOSE_OVERRIDE_NOT_REQUIRED`) and
  is not recorded.
- An overridden gate never permits promotion: any `--promote` gives `blocked`
  (`CLOSE_PROMOTION_REQUIRES_APPROVED_REVIEW`).

## Promotion

**Candidates** are working-tree learning artifacts with status `candidate`, and trap artifacts
with status `proposed`, whose `tasks` include the task.

**Checks for each requested ID.** A failure is `CLOSE_PROMOTION_INVALID`, naming the ID and the
reason. The candidate must:
- exist as an artifact;
- be a learning or trap (never an ADR, rule, skill, task, feature or project);
- be a candidate in the sense above, linked to the task;
- have a non-empty `evidence` list;
- if it is a trap, have `severity: medium`;
- be valid UTF-8;
- appear in the subject of the current, approved context review, meaning its path is in that
  review's evidence subject.

Schema and link validity are already guaranteed by step 3.

**Behaviour:**
- Any failing ID blocks the whole CLOSE; nothing is promoted.
- **Effect:**
  - learning `candidate` becomes `accepted`;
  - trap `proposed` becomes `active`;
  - `close:<TASK-ID> context-review:<report path>@<evidence_hash>` is appended to `evidence`;
  - all other front matter and the body are preserved.
- **Unpromoted candidates** are listed in the closure record and their files are unchanged.

## Closure record and writes

The task front matter gains:
- `status: accepted`;
- `completed`: the local date `YYYY-MM-DD`, preserving an existing non-empty value;
- `closure`, which contains:

  ```yaml
  closure:
    gate: satisfied | overridden
    override_reason: <text>        # only when overridden
    reviews:
      - { role, report, round, verdict, evidence_hash, base, state }   # one per role
    promoted: [IDs]
    unpromoted: [IDs]
  ```

Write mechanics:
- Front matter is edited through the YAML document model, so other fields and the body are
  preserved. Output is LF-normalised.
- Every changed file (the task and promoted candidates) is first written to a temporary sibling.
  Files are then renamed in a fixed order, and the inventory is re-validated.
- Any write or validation failure restores every original file and is `failed`
  (`CLOSE_WRITE_FAILED`).
- `TASKS.md` is not edited. `CLOSE_INDEX_UPDATE_REQUIRED` reminds the owner.
- No other files are written. Review evidence computation may create disposable state under
  `.context/review/`.

## Review interaction (Phase 4 mechanism update)

- `closure` is a lifecycle field in `docs/PHASE-4.md`'s metadata classes: reported as a fact and
  excluded from `evidence_hash`, like `status` and `completed`. Writing the closure record
  therefore cannot invalidate the evidence hashes it records.
- Promoted candidates do change, because their status and evidence change. Evidence recomputed
  after a promoting CLOSE therefore differs from the recorded hashes, which still identify what
  was reviewed.

## Known limitations

- Atomic replacement covers each file. Multi-file consistency relies on restoring originals on
  failure; concurrent edits during CLOSE are outside the v0.1 stable-working-tree assumption.
- CLOSE depends on Git and on REVIEW's evidence preparation, so its environment requirements
  match `review`.
