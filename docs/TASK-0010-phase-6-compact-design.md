# TASK-0010 — Phase 6 COMPACT design notes

**NON-AUTHORITATIVE DESIGN RECORD — revision 1, prepared for owner review on 2026-10-05.**
It does not authorize implementation, adopt architecture or create an ADR. SPEC.md, D01–D26,
PROJECT.md, ADR-0001, ADR-0002 and the accepted TASK-0008 contract are the authority. These notes
derive what they already decide, then set out options, trade-offs and a recommendation for each
open decision (C1–C6). Nothing below the "Already decided" section is settled until the owner
resolves it.

## Objective

COMPACT consolidates verified durable knowledge so that noise is not accumulated, while evidence
and traceability are preserved.

CLI (SPEC.md): `keystone compact`. SPEC acceptance baseline: "compact safely".

## Already decided by the authoritative artifacts

| Topic | Derived requirement | Source |
|---|---|---|
| Purpose | Compaction is evidence-preserving consolidation. | D21 |
| Noise | Verified learning is promoted and compacted; noise is not accumulated. | SPEC principle 5 |
| Evidence | Compaction preserves evidence and traceability. | SPEC principle 9, D21 |
| Safety | COMPACT must be safe: no partial or silent loss of durable knowledge. | SPEC acceptance baseline |
| Minimal knowledge | Persist only knowledge that prevents wrong implementation, repeated investigation, architectural inconsistency or repeated mistakes. | D02, SPEC principle 3 |
| Semantic judgement | Keystone calls no model. Whether two learnings say the same thing, or whether a trap still applies, is human or agent judgement. Keystone checks structure. | D15, D18, D25 |
| Deterministic first | IDs, links, schemas, statuses and evidence presence are checked by software before any judgement is relied on. | D15, SPEC principle 6 |
| High authority | COMPACT never changes ADRs, rules or skills. Knowledge that belongs there leaves only as a proposal through the existing proposal and review process. | SPEC non-goals, D07, D20, AGENTS rule 7 |
| ADR replacement | ADRs already have their own supersession mechanism; COMPACT does not replace it. | ADR-0001 §4 |
| START eligibility | Only `accepted` learnings and `active` traps bind START. `candidate` learnings and `proposed` traps are known non-binding review material. Any other status is unknown: non-binding and diagnosed (`START_AUTHORITY_UNKNOWN`). Location, discovery and indexing confer no authority. | ADR-0001 §2, §5, §7; `src/context/selection.ts` |
| Trap severity | Only `medium` severity is classified. | ADR-0001 §7 |
| Review records | Reviewer reports under `reviews/` are durable, non-authoritative records. Rounds are added, never overwritten. | ADR-0002, D21 |
| Task facts | Individual task files own task facts. `TASKS.md` and context indexes are hand-maintained navigation. | ADR-0001 §1, D05, TASK-0005 |
| Unpromoted candidates | CLOSE leaves them `candidate` or `proposed`, lists them in the closure record, and records no `rejected` state. Their disposition belongs to Phase 6. | TASK-0008 decision 3(a) |
| Consolidation | Promoted knowledge keeps `tasks` and `evidence` links; consolidation belongs to Phase 6. | TASK-0008, D12 |
| Generated state | Markdown/YAML is authoritative; generated state is disposable and rebuildable. `context/STATE.md` is a generated location. | D16, `docs/PHASE-0-1.md` |
| Offline | Every command is testable offline, with Windows-safe paths. | PROJECT.md |

### Consequences of the above

- COMPACT acts on **learnings and traps only**. It never edits ADRs, rules, skills, projects,
  features, tasks, `reviews/`, `TASKS.md`, Git history or Git repository state.
- COMPACT cannot decide on its own what is redundant or obsolete. A person or agent decides; COMPACT
  checks and applies.
- "Consolidation" cannot mean deletion. Retired knowledge, its evidence and its links stay in the
  repository.

## Facts established by inspection

- The Keystone repository itself holds no learnings, traps or `context/` directory today. Phase 6
  is designed and tested against fixtures.
- `init` creates `context/archive/` and heading-only `context/INDEX.md`, `DECISIONS.md`,
  `LEARNINGS.md` and `TRAPS.md`; `context/STATE.md` is created from a "GENERATED — do not maintain
  manually" template. No command reads or writes any of them.
- `context` is a default discovery source (`src/context/config.ts`), so anything in
  `context/archive/` is discovered inventory.
- `supersedes` and `superseded_by` are typed links only on ADRs. On other artifacts they are
  uninterpreted extension metadata (`docs/PHASE-0-1.md`).
- START reaches learnings and traps through task-relevant reverse associations (ADR-0001 §6). A
  learning with an unknown status is added as review material and diagnosed
  `START_AUTHORITY_UNKNOWN`, non-blocking because learnings are never mandatory.
- Editing a learning or trap after a task closes changes evidence recomputed for that task. Phase
  5 already accepts this for promotion: the recorded hashes still identify what was reviewed, and
  a closed task is never re-gated (`docs/PHASE-5.md`).

## Open decisions

Each decision lists options, trade-offs and a recommendation. The recommendations are designed to
fit together; the combined result is in "Recommended Phase 6 contract" below.

### C1 — Disposition of unpromoted candidates versus TASK-0008 decision 3(a)

**Conflict.** TASK-0008 decision 3(a) records "no `rejected` state" as "option 3(a) only for v0.1"
and defers disposition to Phase 6, which is also v0.1. Phase 6 must dispose of candidates without
a new state, or the owner clarifies 3(a).

| Option | Description | Trade-offs |
|---|---|---|
| (a) Strict reading | No terminal state for candidates anywhere in v0.1. COMPACT may only report stale candidates. | No change to an owner decision. But candidates accumulate indefinitely as START review material, contrary to SPEC principle 5 and D21, and Phase 6 cannot do the disposition 3(a) deferred to it. |
| (b) 3(a) governs CLOSE | 3(a) means CLOSE never rejects. Phase 6 introduces one general retirement state (C2) that may also be applied to a candidate, only by explicit owner request with a reason. | Fulfils the deferral with one state shared with consolidation (C2), not a candidate-specific `rejected`. CLOSE is unchanged. Requires the owner to record this reading of 3(a). |
| (c) Separate `rejected` state | Candidates get `rejected`; consolidated accepted knowledge gets a second state. | Precise names, but two new states in the START vocabulary instead of one, and still revisits 3(a). |

**Recommendation: (b).** It completes the disposition that 3(a) explicitly deferred to Phase 6
without changing CLOSE, and keeps the vocabulary to one new state. The owner's clarification of 3(a)
would be recorded in TASK-0010 and in the ADR that C2 requires.

### C2 — Representation of retired or consolidated knowledge

| Option | Description | Trade-offs |
|---|---|---|
| (a) New terminal status | Learnings and traps gain one status, `retired`, with a structured `retirement` record (task, reason) and optional `superseded_by` successor links of the same type, interpreted as typed links. START treats `retired` as known history: never binding, no `START_AUTHORITY_UNKNOWN`. | Mirrors the established ADR pattern (status plus older-to-newer links). Status, not location, carries authority, as ADR-0001 requires. Retired items leave the binding set, so START context shrinks. **Requires an ADR**: it extends ADR-0001's recognised vocabulary and START behaviour, and adds typed links on non-ADR artifacts. |
| (b) Demote to an existing non-binding status | Retiring sets a learning back to `candidate` (a trap to `proposed`), plus extension metadata. | No ADR: both states are already known. But retired knowledge looks promotable again, stays in START as review material (noise is not reduced), and is indistinguishable from a fresh candidate. |
| (c) Move to an archive excluded from discovery | Retired files move to `context/archive/`, which discovery skips. | Removes them from START entirely. But references to them stop resolving, which breaks validation and traceability (D21), changes ADR-0001 §5 discovery semantics (**requires an ADR**), and makes location confer authority. |
| (d) Delete, relying on Git history | Retired files are removed. | Smallest repository. Violates "the repository is memory" and SPEC principle 9: evidence would live only in Git history. |

**Recommendation: (a)**, with these details for the ADR draft:
- one status, `retired`, for both learnings and traps;
- a required `retirement` record naming the authorizing task (C6) and a non-blank reason;
- optional `superseded_by: [ID]` to an eligible artifact of the same type, validated as a typed
  link, acyclic, and one-sided (successors are not edited);
- START gives retired artifacts the non-binding `history` role at Tier 3 with no diagnostic, so
  budget packing may omit them visibly; a retired artifact never binds through any path;
- CLOSE never promotes a retired artifact; retirement is terminal in v0.1.

Option (b) is the only route that avoids an ADR, at the cost of not achieving the objective.

### C3 — `context/archive/` and discovery

| Option | Description | Trade-offs |
|---|---|---|
| (a) Retire in place | COMPACT never moves files. `context/archive/` stays as an unused `init` scaffold directory in v0.1. | Paths, `files` references and evidence strings stay valid. Consistent with "location confers no authority". The directory remains unexplained. |
| (b) Move into the archive, still discovered | Retired files move to `context/archive/` and remain inventory. | Tidier tree. Path changes can break `files` references and path-bearing evidence strings for no authority benefit, and a move plus edit is harder to review. |
| (c) Move and exclude from discovery | As C2(c). | See C2(c): breaks traceability and requires an ADR. |

**Recommendation: (a).** Status alone carries the result. The purpose of `context/archive/` is left
for a later decision; Phase 6 neither uses nor removes it, so `init` is unchanged.

### C4 — `context/` placeholder files

| Option | Description | Trade-offs |
|---|---|---|
| (a) Leave as hand-maintained navigation | COMPACT writes none of them. Like CLOSE with `TASKS.md`, it reports when navigation needs updating. `context/STATE.md` stays a generated location with no generator. | No new generated artifacts in a discovery source; follows the TASK-0005 precedent. The placeholders stay empty unless people maintain them. |
| (b) COMPACT generates digests | COMPACT writes deterministic `context/LEARNINGS.md` and `TRAPS.md` (and possibly `STATE.md`). | Useful overview. But it makes files in a discovery source generated, which needs the generated-location list extended, must never make them START authority, and adds a regeneration duty to a knowledge-changing command. Scope growth beyond D21. |
| (c) Remove them from the scaffold | `init` stops creating them. | Changes accepted Phase 2 behaviour and the target-repository layout; outside Phase 6. |

**Recommendation: (a).** Generating digests is optional convenience, not consolidation; it can be a
later task if wanted.

### C5 — Mutation model

| Option | Description | Trade-offs |
|---|---|---|
| (a) Report only | `keystone compact` is read-only. It writes a deterministic report of compaction candidates; people edit files by hand. | Simplest and safest for COMPACT itself. But Keystone never checks that a hand-made consolidation preserved evidence, which is the guarantee D21 asks for. |
| (b) Report by default; explicit, checked operations | With no operation, COMPACT is read-only and reports. Writes happen only for IDs the owner names (for example `--retire <ID> --reason <text>`, optionally with a successor), each checked deterministically and applied all-or-nothing. | Mirrors CLOSE's `--promote` (D11 controlled promotion, TASK-0008 2(a)): people judge, Keystone checks and applies. More implementation than (a). |
| (c) Automatic | Keystone decides what to merge or retire. | Requires semantic judgement in software; contrary to D15 and D25. |

**Recommendation: (b).** Without an operation, the report lists only deterministic signals, never
semantic ones:
- candidates whose every linked task is closed;
- retirement chains and successor links;
- binding learnings and traps per task and feature, showing START pressure;
- retired artifacts and their successors.

The successor's content is written by a person or agent beforehand. COMPACT only checks that it
preserves the predecessor's traceability.

### C6 — Gate for compaction writes

| Option | Description | Trade-offs |
|---|---|---|
| (a) Reason only | An owner-named operation with a reason is sufficient. | Fast. But it removes binding knowledge from START outside any task, contrary to AGENTS rule 10 and D22, and with no review path. |
| (b) Task-bound | Every write needs `--task <TASK-ID>` naming an existing task with status `active`. The retirement record cites it. The edits are ordinary working-tree changes, so that task's review covers them and its CLOSE gate applies. | Uses existing authorization (task artifacts) and review (D13) with no new machinery or CLOSE redesign. Review happens after compaction, before the task closes, as for any other change. |
| (c) Pre-write review gate | COMPACT refuses until a current three-role `approve` review exists for the compaction. | Strongest, but the review would have to describe edits that do not exist yet, or CLOSE would have to apply retirements. Either is a REVIEW or CLOSE redesign, out of scope. |

**Recommendation: (b).** It is the lightest option that keeps compaction inside the task lifecycle.
The same-type eligible-successor and evidence-superset checks (below) prevent a binding guard from
being dropped silently.

## Recommended Phase 6 contract (if C1–C6 are accepted as recommended)

### Command

```text
keystone compact [--task <TASK-ID> (--retire <ID> --reason <text> [--by <ID>])...] [--root <directory>] [--json]
```

Exact flag spelling and grouping are implementation discretion; the semantics below are the design.

- With no operation: read-only report (outcome `reported`).
- `--retire <ID>` names a learning or trap to retire; `--reason` is required and non-blank;
  `--by <ID>` optionally names its successor.
- `--task` is required whenever an operation is given.

### Deterministic checks (all before any write)

1. The working tree passes structural validation.
2. `--task` names an existing task with status `active`.
3. Each retired ID exists and is a learning or trap (never an ADR, rule, skill, project, feature
   or task) and is not already `retired`.
4. A successor, if named:
   - exists, has the same type, and is eligible (an `accepted` learning, or an `active` trap with
     severity `medium`);
   - is not itself being retired in the same run, and creates no cycle;
   - includes every `tasks` entry and every `evidence` entry of the retired artifact, so
     traceability and evidence are preserved by superset;
   - for traps, includes every `files` entry, so a guard on a file is not silently dropped.
5. Retiring an eligible (binding) artifact without a successor is allowed only with the reason;
   the report lists it as a binding removal.

Any failing check blocks the whole run. Nothing is written.

### Effect

For each retired artifact, through the YAML document model:
- `status: retired`;
- `retirement: { task: <TASK-ID>, reason: <text> }`;
- `superseded_by: [<ID>]` when a successor is named.

The body, evidence and every other field are preserved. Successors and all other files are
unchanged. Writes use temporary siblings, ordered renames and re-validation, restoring every
original on failure, as in Phase 5.

### Outcomes

| Outcome | Exit | Meaning |
|---|---|---|
| `reported` | 0 | No operation; read-only report produced. |
| `compacted` | 0 | All requested retirements applied. |
| `unchanged` | 0 | Every requested retirement is already recorded identically; nothing written. |
| `blocked` | 1 | A check failed, or an artifact is already retired with a different record. Nothing written. |
| `failed` | 2 | Structural, input or write failure. Nothing left changed. Usage errors also exit 2. |

COMPACT works offline, calls no model, and writes only the retired artifacts and disposable
generated state under `.context/`. It reports when hand-maintained navigation needs updating.

## Deterministic versus semantic

- **Keystone checks:** structure, artifact type, task status, current status, successor
  eligibility, link validity, acyclicity, tasks/evidence/files supersets, idempotence.
- **People and agents judge:** whether knowledge is redundant, obsolete or worth keeping; the
  wording of a consolidated successor; whether a binding guard may be removed without one. That
  judgement is recorded in the reason and reviewed through the authorizing task.

## Architectural impact

If C2(a) is accepted, an ADR is required (provisionally ADR-0003, "Retirement of learnings and
traps"). It would:
- add `retired` to the recognised learning and trap vocabulary and define its START role
  (supplementing ADR-0001 §2 and §7);
- make `superseded_by` a typed same-type link on learnings and traps;
- record the owner's reading of TASK-0008 decision 3(a) (C1).

The SPEC.md `compact` CLI line would gain the operation flags, as `review` and `close` gained
theirs. Per the owner's instruction, no ADR is drafted until these recommendations are reviewed.

If C2(b) is chosen instead, no ADR is needed, but COMPACT would not reduce START noise.

## Proposed acceptance scenarios for the implementation task

1. `compact` with no operation writes no source file, exits 0 and is byte-identical on re-run.
2. The report lists candidates whose linked tasks are all closed, and binding knowledge per task.
3. Retiring a candidate learning with `--task` and `--reason` sets `retired` and the record;
   nothing else in the file changes.
4. Retiring an accepted learning with an eligible successor holding a tasks/evidence superset
   succeeds; START for a linked task no longer binds the retired learning, shows it as history,
   and emits no `START_AUTHORITY_UNKNOWN`.
5. A successor missing one `evidence` entry blocks the run; no file changes.
6. A trap successor missing a `files` entry, or with non-`medium` severity, blocks.
7. A successor of a different type, a non-eligible successor, or a cycle blocks.
8. Naming an ADR, rule, skill, project, feature or task blocks; none is ever written.
9. A missing, unknown or non-`active` `--task` blocks.
10. Operations without `--task`, or `--retire` without a reason, are usage errors (exit 2).
11. Several retirements where one fails write nothing.
12. Re-running an identical retirement is `unchanged`; a different reason for an already-retired
    artifact is `blocked`.
13. A write failure restores every original and leaves no temporary files.
14. CLOSE refuses to promote a retired artifact.
15. `reviews/`, `TASKS.md`, `context/*.md`, ADRs, rules, skills and Git state are untouched in
    every scenario.
16. Windows paths and offline operation, as in earlier phases.

## Revision history

| Revision | Date | Change |
|---|---|---|
| 1 | 2026-10-05 | Initial design: derived requirements, decisions C1–C6 with options and recommendations, recommended contract and acceptance scenarios, for owner review. |
