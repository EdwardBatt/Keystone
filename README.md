# Keystone

Keystone v0.1 is currently in active development and approximately 85% complete.

Keystone is a repo-native context system for AI-assisted software engineering. It keeps durable,
structured project knowledge in the repository itself (requirements, decisions, tasks, rules,
learnings and known traps) and deterministically compiles the context relevant to the work being
performed. The aim is for an AI agent to start each task with the right constraints, not an
approximate memory of earlier conversations.

This is working software, not a concept: a TypeScript/Node CLI with eight implemented commands, a
248-test automated suite, and a project history in which Keystone has been used to manage its own
development.

## The problem

AI coding agents are capable implementers but poor custodians of project knowledge. Each session
starts without the decisions, constraints and lessons of earlier sessions, so long-running
projects drift:
- agents re-investigate settled questions;
- they repeat known mistakes;
- they silently contradict architecture;
- they treat their own plausible output as if it were the specification.

I built Keystone to make the repository, not the conversation, the durable memory, and to make
what an agent is given **deterministic, traceable and authority-aware**. An agent receives what
the project has actually decided, separated from proposals, history and evidence, with every
selection explained.

## What works today

| Command | What it does |
|---|---|
| `keystone init` | Detects the Git root and creates the Keystone scaffold and configuration without overwriting existing files (`--force` resets configuration only). Optionally adds thin agent entry files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`). |
| `keystone validate` | Read-only structural validation of every artifact: JSON-schema metadata, stable IDs, typed links, supersession chains and portable, Windows-safe paths. Stable diagnostic codes; non-zero exit on error. |
| `keystone index` | Builds a deterministic, idempotent, disposable machine index of artifacts and their link graph. Identical inputs produce byte-identical output, and the index is replaced atomically. |
| `keystone context status` | Read-only report of configuration, artifact counts, validation state and index freshness. |
| `keystone start <TASK>` | Compiles a task-specific context envelope: bounded, tiered, authority-aware selection (ADR-0001) with an 8,000-token target. Mandatory and direct context is never silently dropped, and every omission is reported. It never authorizes implementation. |
| `keystone review <TASK>` | Prepares isolated evidence packages for independent code, architecture and context reviewers, anchored to a Git baseline, with a deterministic evidence identity (ADR-0002). It never calls a model or decides a verdict. |
| `keystone close <TASK>` | Closes a task only after current `approve` verdicts from all three review roles (or a recorded owner override). Promotes only explicitly named candidate learnings and traps. Writes are all-or-nothing. |
| `keystone compact` | Read-only compaction report. With explicit, task-bound operations, retires learnings and traps in place while preserving their evidence and provenance chain (ADR-0003). Edits preserve unrelated bytes exactly, and failure recovery is verified and reported truthfully. |

Implemented characteristics, each covered by the test suite:
- **Artifact discovery and validation:** typed Markdown/YAML artifacts (project, tasks, features,
  ADRs, rules, skills, learnings, traps) with JSON schemas, stable IDs and a typed link graph.
- **Authority-aware context selection:**
  - accepted ADRs bind, while proposed ones are review material only;
  - ADR supersession resolves to a single accepted endpoint;
  - unresolved replacement chains are reported as conflicts, never guessed;
  - learnings bind only when `accepted`, and traps only when `active` with classified severity;
  - retired knowledge appears only as history.
- **Controlled knowledge lifecycle:** candidate learnings and traps are promoted only at CLOSE,
  by explicit request; retirement keeps evidence and requires successors to carry their
  predecessors' provenance.
- **Deterministic, safe outputs:** sorted, locale-independent serialization; atomic replacement of
  generated state; all-or-nothing source writes with restoration on failure.
- **Offline and model-free:** every command runs without network access or a model.
- **Automated regression testing:** 248 tests, run offline with Node's test runner and verified on
  Windows. They include adversarial cases such as hostile IDs, injected write failures and
  byte-for-byte preservation.

## Architecture in brief

- **Authoritative artifacts:** Markdown with YAML front matter, kept in the repository (`PROJECT.md`,
  `tasks/`, `adr/`, `features/`, `rules/`, `skills/`, `context/`). Authority is artifact-specific,
  and contradictions are raised for resolution, not settled by precedence.
- **Generated state:** JSON under `.context/` (index, START envelope, review packages). It is
  disposable and rebuildable, and never authoritative.
- **Pipeline:**
  1. discovery (`src/parser`);
  2. schema validation (`src/validation`, `schemas/`);
  3. link graph and invariants (`src/graph`);
  4. authority-aware selection and envelope packing (`src/context`);
  5. lifecycle commands (`src/commands`, `src/review`, `src/compaction`);
  6. CLI presentation (`src/cli`).
- **Governance:**
  - `SPEC.md` is the implementation contract;
  - `ARCHITECTURE-DECISIONS.md` records the frozen baseline decisions D01–D26;
  - later architectural changes are adopted only through ADRs in `adr/`;
  - individual task files in `tasks/` own task scope and acceptance.

## v0.1 status

| Phase | Scope | Status |
|---|---|---|
| 0–1 | Foundation, parser, schemas, index, validation | Complete |
| 2 | `init`, `context status` | Complete |
| 3 | START context compilation | Complete |
| 4 | Independent review evidence | Complete |
| 5 | CLOSE and controlled learning | Complete |
| 6 | COMPACT and knowledge retirement | Complete |
| 7 | Benchmark harness (`keystone-bench`) | Complete |
| 8 | Cross-model trial | **Design accepted (TASK-0014); harness preparation complete (TASK-0015); trial repositories, pilot and trial not started** |

Also planned for v0.1 and not yet implemented: `keystone context explain`. Known limitation:
CLOSE's failure restoration is not yet verified in the way COMPACT's is (`docs/PHASE-6.md`).
The Phase 7 harness measures Keystone against control conditions neutrally, as the separate
`keystone-bench` executable (`docs/PHASE-7.md`). TASK-0015 prepared it for the Phase 8 trial
(version 2 plans, freezing, calibration, attempts, judging and analysis). No benchmark results
exist yet.

## How it is built: AI-first, owner-controlled

I own:
- identifying the problem and setting product direction;
- the architecture, the specifications and the acceptance criteria;
- the design decisions, reviewing results and challenging incorrect assumptions;
- deciding whether work is accepted.

AI systems do much of the work:
- implementation, analysis and code review;
- test generation and documentation;
- exploring alternatives and trade-offs before I decide.

The controls exist so that AI-generated implementation can never become authoritative over
intended design:
- **Specification first.** `SPEC.md` and the D01–D26 baseline define the contract. Any material
  change needs an ADR that I adopt. Agents cannot change architecture by writing code.
- **Explicit tasks.** Work is authorized only through a task file with scope, exclusions and
  acceptance criteria (`AGENTS.md` rule 10). From Phase 3 onward, each phase has a design task,
  in which open decisions are put to me with options, trade-offs and a recommendation, followed by
  a separate implementation task.
- **Independent review.** The Phase 4–6 implementations were independently reviewed by Codex, a
  separate model and host (`tasks/TASK-0007`, `TASK-0009` and `TASK-0011`). Every finding is
  recorded with its disposition. Implementation defects get regression tests and are re-verified by
  the reviewer before acceptance.
- **Automated tests as evidence.** Acceptance criteria map to tests. For Phase 6, key guarantees
  were also mutation-checked, confirming the suite fails when each one is removed
  (`tasks/TASK-0011`).
- **The repository as record.** Decisions, rejected alternatives, review rounds and verification
  results are written into `tasks/`, `docs/` and `adr/`, not left in chat history.

## Reviewing Keystone

A short path through the strongest evidence:
1. **What and why:** this README, then `PROJECT.md` (scope, authority, non-negotiable
   constraints).
2. **The contract:** `SPEC.md` and `ARCHITECTURE-DECISIONS.md`.
3. **Representative decisions:**
   - `adr/ADR-0001-start-context-eligibility.md`: authority-aware context selection;
   - `adr/ADR-0002-review-evidence-and-reviewer-records.md`: independent review evidence, including
     an in-place correction of an over-specified first version;
   - `adr/ADR-0004-benchmark-harness-boundaries.md`: neutral benchmark design.
4. **One feature end to end (Phase 6):**
   1. `tasks/TASK-0010-phase-6-compact-design.md` and
      `docs/TASK-0010-phase-6-compact-design.md`: decisions with options and trade-offs;
   2. `adr/ADR-0003-retirement-of-learnings-and-traps.md`;
   3. `tasks/TASK-0011-phase-6-compact-implementation.md`: implementation, two independent review
      rounds with findings and fixes, final verification;
   4. `docs/PHASE-6.md`.
5. **Design under review pressure:** `docs/TASK-0006-phase-4-review-design-proposal.md` (three
   review rounds).
6. **Source:**
   - `src/cli/index.ts`: command surface;
   - `src/context/selection.ts`: START selection;
   - `src/graph/index.ts`: link graph and invariants;
   - `src/commands/compact.ts` and `src/compaction/edit.ts`: byte-preserving, verified writes.
7. **Tests:** `tests/README.md`, then `tests/phase3.test.mjs` to `tests/phase7.test.mjs`.
8. **History:** `TASKS.md` and `git log`. Commits generally reference the task they implement.

## Running it

Requires Node.js 20+ and Git (used by `init`, `context status`, `review` and `close`). Installation needs network access once;
everything after that runs offline.

```powershell
npm ci
npm run build
npm run check
npm test
```

Keystone manages its own development, so it can be inspected on this repository. `validate`,
`context status` and `compact` (without operations) are read-only. `start` writes only the
disposable `.context/current-envelope.json`.

```powershell
node dist/cli/index.js validate --root . --json
node dist/cli/index.js context status --root . --json
node dist/cli/index.js start TASK-0011 --root . --json
node dist/cli/index.js compact --root . --json
```

On a separate target repository:

```powershell
node dist/cli/index.js init --root "C:\path\to\target" --adapter codex --json
node dist/cli/index.js index --root "C:\path\to\target" --json
node dist/cli/index.js start TASK-0001 --root "C:\path\to\target" --json
node dist/cli/index.js review TASK-0001 --base HEAD --root "C:\path\to\repo" --json
node dist/cli/index.js close TASK-0001 --promote LRN-0001 --root "C:\path\to\repo" --json
node dist/cli/index.js compact --task TASK-0002 --retire LRN-0001 --reason "Consolidated." --by LRN-0002 --root "C:\path\to\repo" --json
```

## Documentation

- [Phase 0/1](docs/PHASE-0-1.md): discovery, metadata, links, error codes and write protection.
- [Phase 2](docs/PHASE-2.md): Git-root discovery, initialization preservation, the config-only
  `--force` option, adapters and status reporting.
- [Phase 3](docs/PHASE-3.md): START selection, outcomes, budget behaviour and envelope
  replacement. START compilation never authorizes implementation.
- [Phase 4](docs/PHASE-4.md): review evidence packages. Review never determines a verdict or
  implementation readiness.
- [Phase 5](docs/PHASE-5.md): the CLOSE gate, owner override, controlled promotion and the closure
  record.
- [Phase 6](docs/PHASE-6.md): compaction reporting, retirement checks, binding-removal visibility
  and the ADR-0003 validation invariants.
- [Phase 7](docs/PHASE-7.md): the `keystone-bench` formats, isolation, neutral execution, telemetry,
  scoring, blinded judging, provenance and the ADR-0004 exclusions, plus the TASK-0015 Phase 8
  preparation mechanisms.
- `SETUP.md`: local setup. `FIRST-CODEX-TASK.md`: the historical Phase 0/1 contract.

## Licence

Keystone is **source-available for inspection and evaluation only. It is not open source.** You
may view, build, run and evaluate it, for example to assess the author's work. Commercial use,
redistribution, derivative works, incorporation into other products, hosted services, and
sublicensing or sale all require prior written permission. See [`LICENSE`](LICENSE).

Copyright © 2026 Edward Batt.
