---
context_type: task
schema_version: 1
id: TASK-0006
title: Design Phase 4 Review
status: accepted
priority: high
depends_on: [TASK-0004]
adrs: [ADR-0001]
files:
  - docs/TASK-0006-phase-4-review-design-proposal.md
  - SPEC.md
  - ARCHITECTURE-DECISIONS.md
  - templates/TARGET-REPO-TREE.md
  - templates/task.md
  - src/commands/init.ts
  - src/context/generated.ts
  - src/context/git.ts
  - src/commands/start.ts
  - docs/PHASE-3.md
created: 2026-10-04
completed: 2026-10-04
---
# TASK-0006 — Design Phase 4 Review

## Objective
Produce a reviewed design for Phase 4 (`keystone review`) that resolves the architectural and
behavioural decisions the authoritative artifacts leave open, before any implementation.

## Acceptance Criteria
- A design proposal identifies everything SPEC.md, D13–D15 and the target layout already fix,
  and each decision that remains open.
- Each open decision has alternatives, trade-offs, a recommendation and its compatibility
  with SPEC.md, D01–D26 and ADR-0001.
- Decisions that create durable contracts are identified for a proposed ADR and any SPEC
  amendment. Implementation-contract details are separated for the later implementation task.
- Acceptance scenarios for the implementation task are proposed.
- Owner decisions and an independent review are recorded with their dispositions. The output
  is a reviewed proposal, and any ADR or SPEC change remains proposed until adopted.

## Scope
Design analysis for Phase 4 Review: command semantics, independence, review subject, evidence
contents and D14, deterministic checks, output locations and authority, role charters, report
format, outcomes, budget, Git safety, and the boundary with Phase 5.

## Out of Scope
Implementing Phase 4; creating ADR-0002 or amending SPEC.md before the owner decides; CLOSE,
learning, compaction, benchmark or adapter work; changes to `init`, START or accepted
architecture.

## Dependencies
TASK-0004 (START, reused read-only by the proposed evidence package). ADR-0001 governs START
semantics.

## Relevant Files
See the front-matter `files` links. The proposal is
`docs/TASK-0006-phase-4-review-design-proposal.md`; it is non-authoritative.

## Decisions / ADRs
Owner decisions made on 2026-10-04 set the proposal's direction for R1, R3–R9, Q1–Q7, the
base-revision standard, review round 1 findings B1–B4, the four round 2 blockers and the seven
round 3 findings (proposal section 4). R13: draft ADR-0002, "Review evidence and reviewer
records", and a SPEC amendment only after TASK-0006 is accepted. These decisions are not adopted architecture. The
following require adoption:
- the `--base` CLI extension;
- the `reviews/` discovery exclusion;
- the START ineligibility of `reviews/**`, which changes accepted Phase 3 START behaviour;
- the Git minimum for `review` (upstream 2.45, or a probe-proven backport).

U1 is closed by B1 option (ii).

## Implementation Notes
Design only. Proposal revision 6 is the closure revision, resolving all three review rounds
(proposal section 6). With owner authorization, a factual correction about commit `cb2b754`
was added to the accepted TASK-0005 record (finding N1). This task does not authorize
implementing Phase 4.

## Tests
This is a design task with no code changes, so no implementation tests apply. Those belong to a
separately authorized implementation task (proposal section 5 lists proposed scenarios).

Closure verification of proposal revision 6 on 2026-10-04:

- Every round 3 finding has an explicit disposition in the proposal (section 4 and the
  revision history) and in this task's Review Findings.
- Owner decision rows from R1 through round 2 are unchanged. R13's timing wording changed
  only to follow from the completed review.
- No new architectural decision was introduced. Stale Git-version references were corrected,
  and the historical round 2 record was annotated rather than rewritten.
- `validate` passed with 8 artifacts and no diagnostics. After `index`, `context status`
  reported configuration present and index current. START compiled TASK-0001 to TASK-0006 as
  `complete` with no diagnostics.
- The Git behaviour that the R11 design relies on was checked locally on Git 2.52.0:
  `--no-lazy-fetch` and `--no-replace-objects` are accepted; unknown global options are
  rejected; an inherited `GIT_TRACE2` is not suppressed by `-c trace2.*` but is by
  `GIT_TRACE2=0`.
- The upstream 2.45 minimum comes from the round 3 review and was not independently verified
  in this session; the capability probe is the authoritative check.

## Review Findings
**Round 1:** independent architecture review of revision 3 on 2026-10-04. A fresh-context
subagent of the same model reviewed it, so it was only partly independent. Verdict:
changes-requested (4 blocking, 10 non-blocking). Dispositions, all applied in revision 4:

- B1 (U1 constraints conflict): owner chose option (ii). Every change is exposed
  deterministically, typed classification is applied, and untyped authority is identified
  semantically by charters (R5).
- B2 (task introduced in subject undefined): owner adopted working-tree requirements with
  base-anchored context; unresolved base links are evidence gaps (R4.1, R4.4).
- B3 (`reviews/` inside the boundary): owner adopted excluding `reviews/**` and a pre-review
  evidence-hash basis (R3, R6).
- B4 (context role blocked by filtering): owner chose per-role filtering, with claim sections
  given to the context role marked unverified / under review (R4.6).
- N1 (false `cb2b754` claim): R3 reasoning restated; D22 flags use the full message; the
  TASK-0005 record corrected.
- N2: partition contract and parsing rules (R4.2).
- N3: scope-change procedure; approval semantics deferred to Phase 5 (R4.8).
- N4: R9 edge cases and base structural tolerance.
- N5: raw-object Git policy and environment (R11).
- N6: Keystone-managed classes derived from the `init` constant (R5).
- N7: `reviews/` discovery and config exclusion (R6).
- N8: charter isolation rules (R2, R7).
- N9: provisional schema and round-name grammar (R6, R8).
- N10: alternatives restored per decision; revision history added.

**Round 2:** independent architecture review of revision 4 by Codex, a separate model and
host, on 2026-10-04. It reported four blocking and three non-blocking findings. They are
recorded here as relayed by the owner; the full review text and its verdict wording were not
provided to this session and are not reproduced. Owner dispositions, all applied in
revision 5:

- Blocker 1 (evidence hash unstable): `evidence_hash` covers the immutable pre-review payload
  and procedure identity. Operational checks such as index freshness stay visible but
  unhashed (R6.4).
- Blocker 2 (review reports could reach START): `reviews/**` is ineligible for START through
  every path, with `START_REVIEW_RECORD_INELIGIBLE`. Recorded as an ADR-0002 selection change
  supplementing ADR-0001 (R6.2).
- Blocker 3 (Git isolation): `--no-lazy-fetch` and `GIT_NO_LAZY_FETCH=1` on every invocation;
  missing objects fail without network or mutation; Git 2.44 or later (corrected to 2.45 in round 3), enforced by a
  capability probe (R11).
- Blocker 4 (diagnostic precedence): identity/structure failure is `failed`; an unavailable
  valid target is an `incomplete` evidence gap; unrelated base diagnostics are `incomplete`;
  ambiguous identities are quarantined (R4.5, R9).
- Non-blocking 1: every root-task metadata field, including extensions, is classified
  (R4.2).
- Non-blocking 2: any non-exempt level-1 heading makes the partition unsafe and `failed`
  (R4.3).
- Non-blocking 3: procedure identity (Keystone version, contract versions, charter hashes)
  is included in `evidence_hash` (R6.4).

**Round 3:** final independent architecture review of revision 5 by Codex on 2026-10-04.
Verdict: changes-requested, with seven findings. Owner dispositions, all applied in revision 6
(the closure revision) without reopening settled architecture:

1. Git minimum corrected from 2.44 to upstream 2.45. The capability probe is authoritative,
   so probe-proven backports are accepted (R11).
2. One deterministic review Git environment for the probe and every invocation. Inherited
   `GIT_*` variables other than `GIT_CONFIG_*` are removed, and Trace and Trace2 are
   explicitly set to `0`, so inherited tracing cannot write files, sockets or Git state.
   Verified locally that `-c trace2.*` does not suppress an inherited `GIT_TRACE2`, while the
   environment value does (R11).
3. Replacement objects are disabled (`--no-replace-objects`, `GIT_NO_REPLACE_OBJECTS=1`) for
   base resolution, ancestry, the commit list, inventory, object reads and commit-message
   inspection (R11).
4. `START_REVIEW_RECORD_INELIGIBLE` applies only after ordinary path validation succeeds.
   Invalid references keep their normal diagnostics (R6.2).
5. `package_hash` is computed over the canonical package with the field omitted (R6.4).
6. The configured `.` source example is removed; root-source validation is unchanged (R6.2).
7. Charter wording is corrected to "not automatically selected as reviewer charters". The
   existing explicit-file behaviour (non-binding Tier 3 evidence) is described, and there is
   no new exclusion (R7).

## Outcome
Accepted on 2026-10-04 with owner authorization, after three independent review rounds and
closure verification. `docs/TASK-0006-phase-4-review-design-proposal.md` revision 6 is the
accepted design record for Phase 4 Review. It stays non-authoritative: it neither adopts
architecture nor authorizes implementation.

Next steps (R13): draft ADR-0002, "Review evidence and reviewer records", and the SPEC
amendment from this record. Each requires its own review and adoption before an implementation
task (TASK-0007) may be authorized. Phase 4 remains unimplemented. ADR-0001, SPEC.md and
accepted architecture are unchanged.
