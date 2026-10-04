# TASK-0008 — Phase 5 CLOSE + Learning design notes

**NON-AUTHORITATIVE DESIGN RECORD — Phase 5 contract approved by the owner and accepted with TASK-0008 on 2026-10-04.** It does not authorize implementation, which belongs to a separately authorized Phase 5 implementation task. SPEC.md, D01–D26,
PROJECT.md, ADR-0001 and ADR-0002 are the authority. These notes derive what they already decide
and isolate the few decisions that genuinely need the owner.

## Objective

CLOSE completes the task lifecycle after independent review and performs controlled promotion of
genuinely reusable knowledge produced by the work into durable Keystone context.

CLI (SPEC.md): `keystone close <TASK-ID>`. SPEC's acceptance baseline: "close tasks with controlled
learning proposals".

## Already decided by the authoritative artifacts

| Topic | Derived requirement | Source |
|---|---|---|
| Gate | CLOSE is a quality gate: a task that fails it is not closed. | D10 |
| Structural checks | Deterministic checks (`validate`, schemas, links, the review records' structure and evidence currency) run before any semantic judgement. A working tree that fails structural validation cannot close. | D15, SPEC principle 6 |
| Semantic judgement | Keystone calls no model. Deciding whether knowledge is genuinely reusable is a human or agent judgement, expressed through reviewer reports and explicit owner choices. Keystone only checks structure. | D15, D18, D25, ADR-0002 guarantee 1 |
| Review participation | Reviewer reports are the review input to CLOSE. Their verdicts are `approve`, `changes-requested` or `inconclusive`; reports cite `evidence_hash` and `base`. Phase 5 defines what verdicts and staleness mean. | ADR-0002 guarantees 7, 11; D13 |
| Currency | A report whose `evidence_hash` no longer matches freshly prepared evidence for its `base` describes different work. Phase 4 already keeps that hash stable against reports, dispositions, lifecycle fields and commits, so CLOSE can recompute it deterministically. | ADR-0002 guarantee 7, `docs/PHASE-4.md` |
| Classification | CLOSE classifies durable knowledge the work produced. | D10 |
| Promotion is controlled | Nothing becomes authoritative automatically. Candidate learnings are `candidate` and candidate traps are `proposed`; START treats both as non-binding review material. Only `accepted` learnings and `active` traps bind START. | D11, ADR-0001 §2, §7 |
| Learnings and traps | Separate artifact types, linked to their source task (`tasks`), features and evidence (`evidence`), plus `files` and `adrs` for traps. Existing schemas and templates already carry these fields. | D12, schemas, templates |
| High authority | CLOSE never changes ADRs, rules or skills. Knowledge that belongs there leaves CLOSE only as a proposal through the existing proposal and review process. | SPEC non-goals, D20, AGENTS rule 7 |
| Minimal durable knowledge | Persist only knowledge that prevents wrong implementation, repeated investigation, architectural inconsistency or repeated mistakes. Noise is not accumulated. | D02, SPEC principles 3, 5 |
| Verified learning | Only verified learning is promoted. A candidate created after review, or outside the reviewed subject, is not verified by that review. | SPEC principle 5 |
| Trap severity | Only `medium` severity is classified. Promoting a trap with any other severity would make START `incomplete` for associated tasks, and a richer severity vocabulary would need an ADR. | ADR-0001 §7 |
| Traceability | Promoted knowledge keeps `tasks` and `evidence` links to its source task and review evidence. History and evidence are preserved; consolidation belongs to Phase 6. | D12, D21 |
| Task identity | Commits for the work carry the task ID. | D22 |
| Offline and deterministic | Re-running CLOSE on the same state produces the same result and rewrites nothing; an already-closed task is reported, not re-closed. | PROJECT.md, D09/D16 practice |

## Implementation discretion (not owner decisions)

The implementation contract can settle these:
- candidate discovery: learning and trap artifacts under the configured sources whose `tasks`
  include the root task;
- structural promotion checks: schema validity, links resolve, evidence present, trap severity is
  `medium`, and the candidate is in the subject of the review evidence;
- evidence reference format;
- the generated, disposable CLOSE report under `.context/`;
- diagnostics and exit codes;
- leaving `TASKS.md` and context indexes as hand-maintained navigation, as TASK-0005 established;
- how an already-closed task is detected on re-run;
- linking a learning to a trap through their shared task and evidence links, with no new
  relationship field (D12).

## Owner decisions (resolved 2026-10-04)

1. **Review gate, option 1(b).**
   - Normal CLOSE requires the latest current report from each D13 role (code, architecture,
     context), and all three verdicts must be `approve`.
   - A missing report, stale evidence, `changes-requested` or `inconclusive` blocks normal
     CLOSE.
   - An explicit owner override with a required reason authorises CLOSE despite an unsatisfied
     gate. It never alters, replaces or reinterprets reviewer verdicts; the actual review state is
     preserved in the closure record.
2. **Promotion, option 2(a).**
   - CLOSE promotes only candidate learning or trap IDs the owner explicitly requests.
   - Each must pass the structural and evidence checks and must have been covered by the current
     approved context review.
   - Reviewer approval alone never authorises promotion.
3. **Unpromoted candidates, option 3(a) only for v0.1.**
   - Unpromoted candidates remain `candidate` (learning) or `proposed` (trap). A reason may be
     recorded.
   - There is no `rejected` state. Evidence-preserving disposition belongs to Phase 6.

## Phase 5 observable contract

### Command

```text
keystone close <TASK-ID> [--promote <ID>]... [--override <reason>] [--root <directory>] [--json]
```

- `--promote <ID>` may be repeated. It names a candidate learning or trap to promote. Nothing is
  promoted unless named.
- `--override <reason>` requires a non-blank reason. It applies only to the review gate.

### Eligibility (deterministic, D15)

A task can close only when all of these hold:
1. The task exists in the working tree. If it is already closed, CLOSE returns
   `already-closed` without mutation, and the remaining conditions are not evaluated.
2. The working tree passes structural validation.
3. Review evidence for the task can be prepared. A review structural failure blocks CLOSE.
4. The review gate below is satisfied, or overridden.

The override never bypasses structural validation, evidence preparation or the promotion checks.

### Review gate (D10, D13; ADR-0002 guarantees 7 and 11)

- **Reports used:** for each role, the latest valid-round report in `reviews/<TASK-ID>/`.
- **Report validity:** it must satisfy the report contract, name this task and its role, and
  match its file name.
- **Current:** its `evidence_hash` equals the evidence identity Keystone recomputes for that
  report's `base`.
- **Satisfied:** all three roles have a current, valid report with verdict `approve`.
- **Unsatisfied:** any of the following:
  - a missing report;
  - an invalid report;
  - a stale report;
  - a `changes-requested` verdict;
  - an `inconclusive` verdict.

  Without an override, CLOSE is **blocked** and writes nothing.

### Promotion (D11, D12, SPEC principle 5; ADR-0001)

**Candidates** are learning or trap artifacts whose `tasks` include the task and whose status is
`candidate` (learning) or `proposed` (trap).

**Checks for each requested ID.** The candidate must:
- be a candidate linked to this task;
- be schema-valid with its links resolving;
- have non-empty evidence;
- for a trap, have severity `medium` (the only classified severity);
- appear in the reviewed subject of the current, approved context review report.

**Effect:**
- The learning becomes `accepted`, or the trap becomes `active`.
- An evidence reference to the closing task and its context review is added.
- Its existing links are preserved.

**Outcome rules:**
- Under an override, the context review is not current and approved, so no promotion is
  possible.
- A requested ID that fails any check blocks CLOSE entirely, so a promotion request never
  partially applies.
- CLOSE never changes ADRs, rules or skills.

### Unpromoted candidates

- They remain `candidate` or `proposed`, are listed in the closure record, and stay non-binding
  for START.
- A deferment reason may be recorded in the candidate's own body (the learning template's
  `## Proposed Promotion` section).
- A candidate can be promoted later at the CLOSE of another task whose reviewed work covers it
  and whose `tasks` link it.

### Completion record (D10, ADR-0001 §1: task files own task facts)

On success, CLOSE writes to the task artifact:
- `status: accepted`;
- `completed: <date>`;
- a structured closure record. The record contains:
  - whether the gate was satisfied or overridden;
  - each role's report path, round, verdict, `evidence_hash` and currency, or that the report is
    missing or invalid;
  - the override reason, if any;
  - the promoted IDs;
  - the unpromoted candidate IDs.

Rules for the record:
- **It is a lifecycle record.** Review treats it like other lifecycle fields: reported as a fact
  and excluded from the evidence identity, so closing cannot change the evidence it records.
  This is a `docs/PHASE-4.md` mechanism update, not an architectural change.
- **It preserves reviewer reports.** Reports are never modified, and override never rewrites
  verdicts.
- **CLOSE writes no prose** into the task's claim sections.
- **CLOSE does not edit `TASKS.md`**, which remains hand-maintained navigation. It reports that
  the index needs updating.

### Outcomes, safety and re-runs

| Outcome | Exit | Meaning |
|---|---|---|
| `closed` | 0 | Gate satisfied or overridden, promotions applied, completion recorded. |
| `already-closed` | 0 | The task already has a closure record; nothing is written. |
| `blocked` | 1 | The gate is unsatisfied without an override, or a requested promotion fails its checks. Nothing is written. |
| `failed` | 2 | Structural, input or evidence-preparation failure. Nothing is written. Usage errors also exit 2. |

- Every check runs before any write. The task and promoted candidates are then written together,
  with no partial close on refusal.
- Re-running CLOSE on a closed task writes nothing. A new promotion or override request against a
  closed task is refused.
- CLOSE works offline and calls no model.
- CLOSE writes only the task artifact, the promoted candidate artifacts, and disposable generated
  state under `.context/`.

## Deterministic versus semantic

- **Keystone checks:** structure, report validity and currency, verdict values, candidate
  linkage and status, evidence presence, trap severity, subject coverage, and idempotence.
- **People and agents judge:**
  - whether knowledge is genuinely reusable, through reviewer reports and the owner's explicit
    `--promote` choices;
  - whether an override is justified, through the owner's recorded reason.

## Architectural impact

No ADR is required. These decisions implement semantics that D10–D12 and ADR-0002 (guarantees
7 and 11) explicitly defer to Phase 5, and they change no existing guarantee:
- statuses remain within ADR-0001's recognised vocabulary;
- reports remain non-authoritative inputs (ADR-0002 guarantee 8);
- review stays evidence-only;
- high-authority artifacts are untouched.

The SPEC.md CLI line `keystone close <TASK-ID>` should gain the `--promote` and `--override`
options, as `review` gained `--base`. That is a contract-text update for the Phase 5
implementation task, not an architectural change.
