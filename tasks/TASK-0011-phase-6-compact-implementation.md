---
context_type: task
schema_version: 1
id: TASK-0011
title: Implement Phase 6 COMPACT
status: accepted
priority: high
depends_on: [TASK-0010]
adrs: [ADR-0001, ADR-0002, ADR-0003]
files:
  - docs/TASK-0010-phase-6-compact-design.md
  - adr/ADR-0003-retirement-of-learnings-and-traps.md
  - SPEC.md
  - docs/PHASE-0-1.md
  - docs/PHASE-3.md
  - docs/PHASE-5.md
  - src/cli/index.ts
  - src/graph/index.ts
  - src/validation/schemas.ts
  - src/context/selection.ts
  - src/commands/close.ts
  - tests/core.test.mjs
  - tests/cli.test.mjs
  - tests/README.md
  - README.md
created: 2026-10-05
completed: 2026-10-05
---
# TASK-0011 — Implement Phase 6 COMPACT

## Objective
Implement `keystone compact [--task <TASK-ID> (--retire <ID> --reason <text> [--by <ID>])...]`
and the retirement semantics of ADR-0003, as defined by SPEC.md ("Compaction and retirement")
and the accepted TASK-0010 contract (`docs/TASK-0010-phase-6-compact-design.md`, revision 3).

## Acceptance Criteria
The implementation satisfies ADR-0003, SPEC.md, ADR-0001 as supplemented, ADR-0002 and the
accepted TASK-0010 contract. Automated tests cover each criterion below, which restate the 17
accepted design scenarios (S1–S17) with the reconciliations listed under Implementation Notes.

**Report mode**
1. (S1) `compact` with no operation is `reported`, exits 0, writes no source file, and produces
   byte-identical output on re-run.
2. (S2) The report lists, from deterministic signals only:
   - candidate learnings and proposed traps whose linked tasks are all closed;
   - binding learnings and traps per task and per feature;
   - retired artifacts with their successors;
   - binding removals (retirements without a successor).

**Retirement**

3. (S3) Retiring a candidate learning with `--task` and `--reason` sets `status: retired` and the
   retirement record; nothing else in the file changes.
4. (S4) Retiring an accepted learning with an eligible successor whose `tasks` and `evidence`
   contain the retired learning's succeeds and records `superseded_by`. The successor is not
   edited. START for a linked task then:
   - does not bind the retired learning;
   - shows it as non-binding history;
   - emits no `START_AUTHORITY_UNKNOWN` for it.

**Blocking checks** (in each case the run is `blocked`, exit 1, and no file changes)

5. (S5) A successor missing one `evidence` entry or one `tasks` entry.
6. (S6) A trap successor missing a `files` entry, or with a severity other than `medium`.
7. (S7) A successor that:
   - has a different type;
   - is not eligible (not an `accepted` learning or an `active` trap);
   - would form a cycle;
   - is itself being retired in the same run.
8. (S8) Naming an ADR, rule, skill, project, feature or task for retirement. None is ever written.
9. (S9) A `--task` ID that is unknown or whose status is not `active`.
10. (S11) Several retirements where any one fails write nothing.
11. (S12) An already-retired artifact requested with a different record (task, reason or
    successors).

**Usage, idempotence and safety**

12. (S10) Operations without `--task`, `--retire` without a non-blank `--reason`, `--reason` or
    `--by` without a preceding `--retire`, and compaction flags on other commands are usage errors
    (exit 2).
13. (S12) Re-running an identical retirement is `unchanged` (exit 0) and writes nothing.
14. (S13) A write failure is `failed` (exit 2). It restores every original and leaves no
    temporary files.
15. (S14) CLOSE refuses to promote a retired artifact.
16. (S15) In every scenario these stay untouched:
    - `reviews/`, `TASKS.md` and the `context/*.md` placeholder files;
    - ADRs, rules, skills, projects, features and tasks;
    - Git history and repository state.

    COMPACT writes only the retired artifacts and disposable generated state under `.context/`.
17. (S16) Paths are Windows-safe, including paths with spaces. COMPACT needs no network, model or
    Git access.

**Standing validation** (S17; ADR-0003 guarantees 3–5)

18. `validate`, `index` and every command that validates report an error when:
    - a retired learning or trap lacks a valid retirement record (existing task ID, non-blank
      reason);
    - `superseded_by` on a learning or trap is malformed, does not resolve, names a different
      type, or forms a cycle;
    - a successor does not contain its predecessor's `tasks`, `evidence` or (for traps) `files`
      entries.

    Diagnostics use stable codes.

**Documentation and suite**

19. Documentation:
    - `docs/PHASE-6.md` records the mechanisms without adding architectural requirements;
    - `docs/PHASE-0-1.md` and `docs/PHASE-3.md` describe the ADR-0003 link and START changes;
    - CLI help, `README.md` and `tests/README.md` describe Phase 6.
20. `npm run build`, `npm run check` and the full suite pass offline. The pre-existing 181 tests
    still pass, except the one regression test ADR-0003 requires amending (see Implementation
    Notes).

## Scope
Phase 6 COMPACT implementation, the ADR-0003 validation, graph and START changes, tests and
documentation.

## Out of Scope
- Any change to ADRs, SPEC.md architecture, REVIEW or CLOSE semantics beyond what ADR-0003
  requires.
- Moving, deleting or archiving files. `context/archive/` and `context/*.md` generation.
- Automatic or model-based retirement. A richer trap severity vocabulary.
- Retiring ADRs, rules, skills, tasks or reviewer records.
- Phase 7 (benchmark), Phase 8 (cross-model trial), `context explain`.
- Licensing, Git history rewriting.

## Dependencies
TASK-0010 (accepted design), ADR-0003 (retirement guarantees), ADR-0001 (START eligibility, as
supplemented), ADR-0002 (review evidence), TASK-0009 (CLOSE, whose write mechanism COMPACT reuses).

## Relevant Files
See the front-matter `files` links. New files expected: a `compact` command module under
`src/commands/`, `docs/PHASE-6.md` and `tests/phase6.test.mjs`.

## Decisions / ADRs
Implements ADR-0003 and the accepted TASK-0010 contract. Two implementation-level questions
are interpretations of ADR-0003 that need owner approval before coding:

**I1 — Retiring an artifact that is itself a successor.** ADR-0003 guarantee 6: "A successor may
later be retired itself only under these same guarantees, so the chain continues."
- (a) *Recommended.* The same rules apply as for any retirement: a successor is required only if
  the owner names one. Without one, the chain ends at a retired artifact. No evidence is lost,
  since every retired file is kept, and the report lists the binding removal.
- (b) Retiring an artifact that some retired artifact names as successor requires a new successor.
  By containment, the new successor carries the full chain's provenance, so the chain always ends
  in binding knowledge.
- Trade-off: (b) guarantees a binding endpoint but makes it impossible to retire a line of
  knowledge that is simply obsolete. (a) follows guarantee 6's general permission to retire
  without a successor, with a reason.

**I2 — `superseded_by` on a learning or trap that is not retired.** ADR-0003 says a *retired*
learning or trap may declare `superseded_by`; it does not say what happens on a non-retired one.
- (a) *Recommended.* Validation error. A binding learning that claims to be superseded is
  ambiguous, and the link would otherwise be a typed relationship with no defined meaning.
- (b) Typed and checked (resolution, type, cycle, containment), but allowed on any status.
- (c) Interpreted only on retired artifacts; ignored otherwise.
- Trade-off: (a) is strictest and could fail existing repositories that used the field as
  free-form extension metadata. ADR-0003 already makes such values on learnings and traps typed,
  so the compatibility cost exists under every option.

**Owner decisions made on 2026-10-05:** I1(a) and I2(a) approved, and TASK-0011 authorized to move
from `proposed` to `active`.
- **I1(a).** An artifact that is itself a successor may later be retired without naming another
  successor. The resulting removal of binding knowledge must remain visible in COMPACT reporting.
- **I2(a).** `superseded_by` on a non-retired learning or trap is a validation error.

Informational (no approval needed, follows from ADR-0003):
- The existing regression test `tests/core.test.mjs` ("only ADRs interpret supersession; other
  types retain the fields as uninterpreted extensions") asserts that `superseded_by` on learnings
  and traps is uninterpreted. ADR-0003 reverses that for those two types, so the test is amended
  for learnings and traps only. It continues to assert that `supersedes` is uninterpreted on them,
  and that both fields are uninterpreted on projects, tasks, features, rules and skills.

## Implementation Notes
Authorized on 2026-10-05. Implemented. The mechanisms are recorded in `docs/PHASE-6.md`.

Reconciliations within the accepted contract, applied without architectural change:
- **Missing versus unknown task (S9, S10).** An omitted `--task` is a usage error (exit 2). A
  `--task` ID that does not resolve, or a task that is not `active`, is `blocked` (exit 1).
- **Already retired (contract check 3, S12).** An identical existing record is `unchanged`. A
  different one is `blocked`. In a run mixing new and identical retirements, the identical ones
  are no-ops and the outcome is `compacted`.
- **One successor per CLI retirement.** SPEC.md's CLI takes at most one `--by` per `--retire`.
  ADR-0003 allows several successors, so hand-authored retirements with several successors are
  validated under the same invariants.

What changed:
- **`keystone compact`** (`src/commands/compact.ts`, `src/compaction/report.ts`, CLI wiring and
  help):
  - with no operation, a read-only report that writes nothing;
  - otherwise task-bound retirement: every check runs before any write, and writes are
    all-or-nothing, with verified restoration and truthful reporting of anything unrecovered;
  - outcomes `reported`, `compacted`, `unchanged`, `blocked` and `failed`.
- **Retirement record:** `retirement: { task, reason, previous_status }`, with no timestamp.
  `previous_status` was added beyond the planned `{ task, reason }` so that the I1 binding-removal
  signal stays visible in every later report (`binding_removal`, `binding_removals`), not only in
  the run's `COMPACT_BINDING_REMOVAL` notice. It is optional in the schema; a hand-authored record
  without it is treated conservatively as possibly binding.
- **Validation** (`src/graph/index.ts`, learning and trap schemas):
  - typed same-type `superseded_by` on learnings and traps, with self and cycle checks;
  - I2: `SUPERSESSION_NOT_RETIRED` for a non-empty list on a non-retired artifact;
  - `RETIREMENT_RECORD_MISSING` and `RETIREMENT_RECORD_UNEXPECTED` (retirement is terminal);
  - `retirement.task` resolution;
  - standing containment, `SUCCESSION_CONTAINMENT_BROKEN`.
- **START** (`src/context/selection.ts`): retired learnings and traps are known, never-binding
  history at Tier 3, with no `START_AUTHORITY_UNKNOWN`. This applies through every selection
  path, including a review-material hop through a `files` path (found during implementation and
  covered by a test).
- **Byte-preserving retirement editor** (`src/compaction/edit.ts`): minimal textual edits inside
  the front matter, re-parsed and checked against the expected metadata. It replaced the
  YAML-document re-serialization (review finding B3). CLOSE is not modified by TASK-0011.
- **Shared provenance check** (`src/compaction/provenance.ts`): used by both COMPACT and
  validation (review finding B1).
- **Documentation:**
  - `docs/PHASE-6.md` (new);
  - `docs/PHASE-0-1.md`: link table, the ADR-0003 invariants (including generated trap
    `files` in containment) and four new error codes;
  - `docs/PHASE-3.md`: the retired-history role;
  - `README.md` and `tests/README.md`.
- **Existing tests amended**, each because Phase 6 changes the behaviour they asserted:
  - `tests/core.test.mjs`: the uninterpreted-supersession test now excludes `superseded_by` on
    learnings and traps (as disclosed above). Every other assertion is unchanged.
  - `tests/cli.test.mjs`: `compact` is no longer `COMMAND_NOT_IMPLEMENTED`; `compact extra` is now
    the usage case, and help reads "Phase 6".
  - `tests/phase2.test.mjs`: `compact` is removed from the deferred-commands list;
    `context explain` stays.
- **CLI flag scope:** compaction flags are rejected before `COMMAND_NOT_IMPLEMENTED` is checked
  (review finding N2).

## Tests
Baseline at task creation (2026-10-05): `npm test` passed 181 of 181.

Verification after review round 2 remediation, on 2026-10-05:
- `npm run build` and `npm run check` passed.
- `npm test` passed 209 of 209 (28 in `tests/phase6.test.mjs`) with no failures, skips or
  cancellations.
- Acceptance-criteria coverage in `tests/phase6.test.mjs`:
  - S1–S2: the report;
  - S3–S4 and S15: retirement, START history and untouched files;
  - S5–S7: successor checks;
  - S8, S9 and S11: types, task status and all-or-nothing;
  - S10: usage;
  - S12: idempotence;
  - S13: rename and partial-write failures;
  - S14: CLOSE;
  - S16: paths with spaces, no Git, offline proxy;
  - S17 and I2: validation;
  - I1: a chain ended by retiring its successor.
- Remediation tests, one or more per finding:
  - B1: a generated-path drop is blocked by COMPACT and reported by validation; backslash
    normalization.
  - B2: restoration failure reported as unrestored, with the file shown still edited; a leftover
    temporary file reported and shown to exist; the recovered case claims restoration only after
    verification.
  - B3: exact-byte preservation of BOM, CRLF, comments, quoting, spacing and a body without a final
    newline; flow front matter; lone-CR line endings; an existing empty `superseded_by` replaced in
    place.
  - N1: an active high-severity trap is `was_binding: false` with no binding-removal notice.
  - N2: `context explain` with `--retire` or `--task` is `CLI_USAGE`.
  - Multi-successor branching: both branches validated, per-branch containment errors, endpoints,
    and a removal when the last branch is retired.
  - Retirement-specific START history: reverse feature, reverse trap file overlap, direct task
    `files` link, and the review-material hop.
  - R2 (round 2): seven inherited-member names as task IDs and, separately, as feature IDs (IDs
    are global, so one artifact type per run). Both read-only reporting (reproducible, read-only,
    exact groups, own properties, no extra keys) and retirement (an accepted `constructor` task
    cannot authorize, an active `toString` task can, groups update, `unchanged` on re-run).
- Mutation checks: the suite fails when any of these is reintroduced:
  - the original three guarantees: successor provenance in COMPACT, the standing containment
    invariant, and the retired-history START hop;
  - B1: trap file containment removed, or generated paths ignored;
  - B2: unconditional recovery claim;
  - B3: line endings normalized in inserted lines;
  - N1: severity ignored;
  - R2: plain-object grouping restored (all four R2 tests fail).
- Self-hosting: `validate` passed with 15 artifacts and no diagnostics; after `index`,
  `context status` reported the index current; START for TASK-0011 was `complete`;
  `compact --root .` was `reported` with an empty report.

## Review Findings
**Round 1: Codex independent review, 2026-10-05. Verdict: CHANGES REQUIRED.** Recorded as
relayed by the owner; the full review text was not provided to this session. TASK-0011 remained
`active`. Dispositions, all applied:

Blocking:
1. **B1 — trap successor containment ignored generated `files`.** Containment used graph edges,
   and the graph deliberately creates none for generated paths (`context/STATE.md`,
   `.context/...`), so a successor could drop them. **Fixed:** containment compares declared
   `files` paths, normalized but including generated paths, in one function shared by COMPACT and
   validation (`src/compaction/provenance.ts`). Tasks still compare by resolved identity, and
   evidence as exact strings.
2. **B2 — failure handling could claim restoration that did not happen.** Restoration errors and
   temporary-file cleanup errors were swallowed, and the message always said every original was
   restored. **Fixed:**
   - each restoration is staged and renamed, then verified by reading the bytes back;
   - unverified files are listed in `unrestored` (`COMPACT_ROLLBACK_INCOMPLETE`);
   - temporary files that cannot be removed are listed in `temporary_files`
     (`COMPACT_TEMPORARY_FILE_REMAINS`);
   - `COMPACT_WRITE_FAILED` claims full recovery only when both lists are empty.
3. **B3 — retirement re-serialized front matter.** Normalizing BOMs and line endings and
   reformatting YAML changed unrelated bytes. **Fixed:** `src/compaction/edit.ts` edits the raw
   text minimally:
   - `status` is replaced in its original quoting style;
   - an existing empty `superseded_by` is replaced in place;
   - new keys are appended in the mapping's own style and line ending;
   - the result is re-parsed and must equal the original metadata plus exactly the retirement
     fields, or nothing is written.

   Every other byte, including the BOM, the body and comments, is preserved.

Non-blocking:
4. **N1 — `previous_status` reporting ignored START binding semantics for traps.** **Fixed:**
   - `was_binding` (new in each retired report entry) and `binding_removal` require severity
     `medium` for traps;
   - an active trap of another severity was never binding;
   - the run-time `COMPACT_BINDING_REMOVAL` notice already used START semantics.
5. **N2 — compaction flags on `context explain` were masked by `COMMAND_NOT_IMPLEMENTED`.**
   **Fixed:** flag scope is checked first, giving `CLI_USAGE`.

Also requested and added: coverage for multi-successor branching and for retirement-specific
START history paths (see Tests).

Related change: with COMPACT no longer using a YAML-document editor, the front-matter helper that
had been extracted from CLOSE was removed and `src/commands/close.ts` restored. TASK-0011 now
leaves CLOSE byte-identical. CLOSE's own restoration has the same unverified pattern as B2. It was
outside this review's findings and is unchanged; this is recorded in `docs/PHASE-6.md` under
known limitations for the owner's consideration.

**Round 2: Codex independent review, 2026-10-05.** Recorded as relayed by the owner; the full
review text was not provided to this session. Codex confirmed every round 1 finding (B1–B3, N1,
N2) fixed, and found one new blocking issue and one documentation typo. TASK-0011 remained
`active`. Dispositions, both applied:

1. **R2 (blocking) — report grouping collided with inherited object properties.** `by_task` and
   `by_feature` were plain objects filled with `??=`, so a valid portable ID such as
   `constructor`, `toString` or `hasOwnProperty` read the inherited member instead of a group.
   The report then failed or was wrong. **Fixed:** grouping uses Maps, and the output objects are
   built from sorted entries as own data properties only. Every other ID-keyed lookup in COMPACT
   already used Maps; none remain on plain objects.
2. **Documentation typo.** The `docs/PHASE-6.md` path-equivalence example had lost its backslash
   (`srcapp.txt`). **Fixed:** it reads `src\app.txt` equals `src/app.txt`.

**Final: Codex independent review, 2026-10-05. Verdict: VERIFIED.** Recorded as relayed by the
owner. Codex independently re-tested every round 1 blocking finding (B1–B3) and the round 2
blocking finding (R2), and confirmed each is resolved. No blocking findings remain.

## Outcome
Accepted on 2026-10-05 with owner authorization, after independent verification (VERIFIED). Final
verification: 209 of 209 tests passing.

Phase 6 COMPACT is complete:
- `keystone compact` satisfies ADR-0003, SPEC.md ("Compaction and retirement") and the accepted
  TASK-0010 contract;
- owner decisions I1(a) and I2(a) are applied;
- the mechanisms are recorded in `docs/PHASE-6.md`.

Known limitation recorded for the owner's consideration: CLOSE's restoration is not verified in the
way COMPACT's now is (`docs/PHASE-6.md`). Phase 7 is not started.
