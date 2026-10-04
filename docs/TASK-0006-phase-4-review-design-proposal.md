# TASK-0006 — Phase 4 Review design proposal

**PROPOSAL / NON-AUTHORITATIVE — revision 6, closure revision for TASK-0006. Not adopted;
does not authorize implementation.**

Associated task: [TASK-0006](../tasks/TASK-0006-phase-4-review-design.md). Owner decisions set
the direction of this proposal but are not adopted architecture. `SPEC.md`,
`ARCHITECTURE-DECISIONS.md`, ADR-0001 and the accepted tasks remain the only authority until the
proposal is accepted as the TASK-0006 design record and ADR-0002 and the SPEC amendment are
adopted (R13).

## Revision history

The proposal file is not yet committed, so earlier revisions are summarised here.

| Rev | Date | Change |
|---|---|---|
| 1 | 2026-10-04 | Initial analysis: R1–R13 with alternatives and recommendations. |
| 2 | 2026-10-04 | Owner decisions R1, R3–R9 and R13; base-revision mechanics; review brief. |
| 3 | 2026-10-04 | Owner decisions Q1–Q7 and the base-revision confirmation; U1 left open. |
| 4 | 2026-10-04 | Round 1 (B1–B4, N1–N10) resolved; U1 closed; alternatives restored. |
| 5 | 2026-10-04 | Round 2 (Codex: four blocking, three non-blocking findings) resolved with owner dispositions: evidence identity split from operational checks; `reviews/**` ineligible for START through every path; no lazy fetching and a stated Git version; diagnostic precedence; full root-task metadata and H1 handling; procedure identity in the evidence hash. |
| 6 | 2026-10-04 | Closure revision. Final Codex review (round 3, changes-requested, seven findings) resolved without reopening settled architecture: Git 2.45 minimum with the probe authoritative; trace and Trace2 sanitisation; replacement objects disabled; diagnostic order for review-record links; `package_hash` without self-reference; configured `.` example removed; charter START wording corrected to existing behaviour. |

Labels used below: *owner decision* (decided by the owner but not yet adopted),
*recommendation* (open to review), and *implementation contract* (details for the later
implementation task).

## 1. What the authoritative artifacts already fix

| Source | Phase 4 content |
|---|---|
| SPEC.md, CLI contracts | `keystone review <TASK-ID> [--type code\|architecture\|context\|all]` |
| SPEC.md, acceptance baseline | The first release must "prepare independent review evidence" |
| SPEC.md, layout | `src/review` module |
| D13 | Distinct, independent code, architecture and context review roles |
| D14 | Reviewers get an objective evidence package and no implementer private reasoning |
| D15 | Deterministic structural checks plus semantic agent review |
| D18, D25, PROJECT.md | Model-independent; no external services; every command testable offline |
| D20 | Tiered mutation permissions; no autonomous high-authority changes |
| D22 | Task ID in commits for context-managed work; ADR ID when relevant |
| D10 (Phase 5) | CLOSE is a quality gate that depends on review outcomes, but it is not Phase 4 |
| TARGET-REPO-TREE.md | `agents/{code,architecture,context}-reviewer.md` and `reviews/<task-id>/` |

Existing behaviour that Phase 4 must respect:
- `isGeneratedPath` covers `.context/` (except `config.yaml`) and `context/STATE.md`.
- Discovery skips a Markdown file without `context_type` outside the expected artifact paths.
- The graph turns only known fields into links.
- `compileStart` writes nothing, but fails on any discovery or graph diagnostic.
- `safePath` rejects symlinks, junctions and case-mismatched segments.
- `init` creates heading-only `agents/*.md` files and a `reviews/` directory.
- `gitRoot` strips the Git discovery variables, keeps `GIT_CONFIG_*`, and sets `LC_ALL=C`.

Repository examples:
- Commit `cb2b754` (TASK-0004) changed its own task's `files` and `status` and added
  implementer notes and a work product containing claims. Its body cites "TASK-0004; ADR-0001."
  and its subject line does not.
- Running `start TASK-0006` against the `HEAD` tree gives `START_TASK_NOT_FOUND`, because the
  task exists only in the working tree.

## 2. Design decisions

### R1 — Evidence only (owner decision)

`keystone review` prepares evidence packages. Keystone never calls a model and never decides a
verdict (D15, D18, D25).

**Alternatives:**
- Keystone performs the review: violates D18 and D25.
- Evidence plus verdict ingestion: adds a write path before CLOSE exists.

### R2 — Independence is input isolation (recommendation)

Keystone controls what each package contains and never includes a reviewer report. Reviewers
state their role and identity in their report, which Keystone does not verify.

Isolation covers the package only. Every charter forbids reading `reviews/`, other roles'
packages and transcripts. The recommended procedure is to commit a round's reports after all of
its roles have finished.

**Alternative:** enforced identity, which needs infrastructure D25 excludes.

### R3 — Review boundary: `--base`, default `HEAD` (owner decision)

The **subject** is the difference between the resolved `--base` commit and the working tree.
It includes staged and untracked files that are not ignored, and always excludes `reviews/**`.
Ignored paths are outside the boundary, and the package says so.

**Commit list:** the commits in `base..HEAD`, each listed by hash. For each commit, Keystone
computes a D22 flag deterministically from the full message: whether the exact task-ID token is
present, and which `ADR-<digits>` tokens appear. Message text is not included (R4.7). The flags
record what is present; they do not decide relevance.

**Why not find commits by task ID:**
- D22 does not fix where the ID appears;
- uncommitted work has no message to scan;
- a message can cite several tasks;
- choosing the boundary from implementer-written text puts implementer claims in charge of
  the review boundary.

**Alternatives:**
- Merge base with a default branch: needs an unconfigured branch name.
- Task-ID discovery: rejected for the reasons above.

`--base` extends the SPEC CLI contract and needs adoption (R13).

### R4 — Objective evidence and the base-revision standard (owner decisions)

**Base-revision standard (owner-confirmed).** Requirements and binding context are anchored to
`--base`. Changes to requirements or authority made during the work are evidence under review
and cannot redefine the standard they are reviewed against.

**R4.1 Root task identity and requirements.**
- The root task is identified by its `id`, at base and in the working tree, and the two
  instances are matched by ID, not by path. A changed path is reported as a fact.
- If the root task exists at base, its requirements come from base.
- If it was introduced in the subject, the working-tree task supplies the requirements and is
  flagged `REVIEW_TASK_INTRODUCED_IN_SUBJECT`. It is the review target's requirements only. It
  never becomes project authority and is never added to the base inventory.
- Any of these root-identity conditions is `failed` (R9):
  - the ID is duplicated;
  - the root's front matter is malformed;
  - its identity fields are missing or invalid;
  - the base and working-tree instances cannot be matched unambiguously.

**R4.2 Root task metadata (round 2 non-blocking finding 1).** Every front-matter field of the
root task falls into exactly one class:

| Class | Fields | Handling |
|---|---|---|
| Identity | `context_type`, `schema_version`, `id` | Required. Used for identification (R4.1). In the evidence hash. |
| Requirement | `title`, `priority`, `tags`, plus every relationship field the graph links and START follows from a task: `feature`, `features`, `depends_on`, `adrs`, `key_adrs`, `rules`, `key_rules`, `skills`, `files`, `tasks` | Requirements, taken from base (R4.1). Changes in the subject are shown (R4.4). Given to every role. In the evidence hash. |
| Lifecycle | `status`, `created`, `completed` | Reported as facts to every role. **Excluded from the evidence hash.** |
| Unrecognised | Every other field, including extensions and common-schema fields with no task meaning (`confidence`, `severity`, `evidence`, `project_id`, and `supersedes`/`superseded_by`, which the graph ignores on tasks) | Withheld from code and architecture (name and hash only). Given to the context role in the "unverified / under review" block. Reported as `REVIEW_TASK_FIELD_UNRECOGNISED`. Makes the package `incomplete`. In the evidence hash. |

No field is silently dropped or reinterpreted. Extensions are treated conservatively because
they may carry claims.

**R4.3 Body partition (round 2 non-blocking finding 2).** This is an ADR-0002 contract.
- Sections are ATX headings outside fenced code.
- **Level-1 headings:**
  - Exactly one level-1 heading is exempt as the title, and only when it is on the first
    non-blank body line, before any level-2 heading.
  - Any other level-1 heading anywhere in the body makes the partition **unsafe**. This
    includes a second title, a title after prose, or a level-1 heading between or after
    sections. The result is `REVIEW_TASK_SECTIONS_UNPARSEABLE` and `failed`, because a
    level-1 heading would end the enclosing section and leave content whose classification
    cannot be established.
  - Whole-body fallback is not available, because it would leak claims.
- **Level-2 headings** are matched exactly against these names:
  - requirement sections: `Objective`, `Acceptance Criteria`, `Scope`, `Out of Scope`,
    `Dependencies`, `Relevant Files`, `Decisions / ADRs`;
  - claim sections: `Implementation Notes`, `Tests`, `Review Findings`, `Outcome`.
- Level-3 and deeper headings belong to the enclosing level-2 section.
- **Unrecognised content:** an unknown level-2 section, or prose between the title and the
  first level-2 heading.
  - Handled as an unrecognised field would be: withheld or given to the context role under
    review, `REVIEW_TASK_SECTION_UNRECOGNISED`, `incomplete`.
  - Never silently dropped (ADR-0001 §8).
- **Unsafe:** a duplicate requirement heading, a setext heading, an unclosed fence, or a
  non-exempt level-1 heading. Each is `failed`.
- A duplicate claim heading is safe: both copies are treated as claims.

**R4.4 Changes within the subject.**
- Edits to requirement fields or sections are shown side by side with base
  (`REVIEW_REQUIREMENTS_CHANGED`).
- Edits to lifecycle fields are facts.
- Edits to claim sections and unrecognised content follow R4.6.

**R4.5 Binding context (owner decisions B2 and round 2 blocker 4).**
- The ADR-0001 selection rules run in **review mode** over the base inventory. The root is the
  base task, or the working-tree task as a root that is not part of the inventory.
- Before selection, diagnostics are classified by the R9 precedence. Selection never operates
  on an ambiguous identity: artifacts with duplicate, malformed or ambiguous identity are
  **quarantined** (removed from the inventory and reported).
- A **valid, identifiable** root link (any R4.2 relationship field) whose target is
  unavailable at base becomes an **evidence gap**
  (`REVIEW_BASE_LINK_UNRESOLVED`, `incomplete`). It is never inserted or promoted.
- A link whose target is quarantined is treated as follows:
  - `failed` when the target is required binding context (the sole project, a mandatory rule,
    or a binding ADR, rule or feature);
  - an evidence gap at lower roles.
- `reviews/**` is never selectable (R6).
- The START command's own diagnostic behaviour is unchanged. Only the R6 review-record rule
  changes START.

**R4.6 Arbitrary changed files.** Non-task files in the subject are included whole as the work
under review. Statements inside them are reviewed, not trusted (Q2).

**R4.7 Per-role composition (owner decision B4).**

| Content | code | architecture | context |
|---|---|---|---|
| Root identity and requirement metadata and sections (R4.1–R4.4) | yes | yes | yes |
| Lifecycle facts | yes | yes | yes |
| Base binding context (R4.5) | yes | yes, with ADRs and Tier 3 authority evidence first | yes |
| Subject manifest and diff (R4.6; root task as fields and sections) | yes | yes | yes |
| Change classification (R5) | paths only | yes | yes |
| Base-derived checks (base START outcome and diagnostics, D22 flags) | yes | yes | yes |
| Operational checks (R6.4) | working-tree validate | working-tree validate | all |
| Root claim sections and unrecognised fields or sections | withheld (name and hash) | withheld (name and hash) | **included, marked "unverified / under review"** |
| Accepted dependency tasks | whole, as historical context | whole | whole |
| Charter (R7) | code | architecture | context |

Always excluded:
- commit message text;
- transcripts;
- `.context/current-envelope.json`;
- reviewer reports;
- anything outside the repository.

Prior same-role reports may only be supplied explicitly, alongside the package (Q4).

**R4.8 Owner-approved scope changes.** Phase 4 does not decide approval. Packages show the base
requirements and the changes made to them. Charters treat approval statements as unverified.
Recommended procedure: commit an approved requirement change on its own; a later review may
then start from it. Phase 5 defines confirmation at CLOSE.

**Alternatives for R4:**
- Labelling claims instead of withholding them: the owner rejected this.
- One package for all roles: weakens D13 and blocks the context role.
- Working-tree requirements or context: lets the work redefine its own standard.
- A mixed tree: gives `LINK_MISSING` failures.
- Treating extension fields as requirements: would admit claims.
- Whole-body fallback for an unsafe partition: would leak claims.
- Treating content after an extra level-1 heading as unrecognised: risks misclassifying
  requirement text.

### R5 — Change exposure and classification (owner decision B1)

**Detectable** means every changed path, and its content, is deterministically exposed. There
is a complete subject manifest, and all content is shown except what R4.7 withholds or R9
represents by hash.

Deterministic classifications:
- **Typed artifact**, with base and working-tree type and status.
- **Keystone-managed file**, from a constant shared with `init`'s scaffold list: `AGENTS.md`,
  `CLAUDE.md`, `GEMINI.md`, `TASKS.md`, `context/{INDEX,DECISIONS,LEARNINGS,TRAPS}.md`,
  `adr/INDEX.md`, `skills/INDEX.md`, `agents/*-reviewer.md` and `.context/config.yaml`. These
  are labelled *Keystone-managed*, not *authority*.
- **Generated path.**
- **Ordinary file.**

**Untyped authority** (SPEC-like documents) is identified **semantically** by the
architecture and context charters, using the project's own artifacts. There is no authority
field, no typed authority artifact and no hard-coded file name.

**Alternatives:**
- A `PROJECT.md` declaration: declined.
- A typed authority artifact: declined.
- `files`-link inference: references confer no authority under ADR-0001 §2.
- Name conventions: hard-coding.

### R6 — Review records, START ineligibility and evidence identity (owner decisions R6, B3 and round 2 blockers 1 and 2)

**R6.1 Records.**
- Packages (generated): `.context/review/<TASK-ID>/<role>.json`. Writes are atomic and
  identical bytes are not rewritten.
- Reports (durable): `reviews/<TASK-ID>/<role>-<round>.md`, written by the reviewer, never by
  Keystone, and committed. Rounds are added, never overwritten (D21).
- Reports are not truth merely by existing.

**R6.2 `reviews/**` is categorically ineligible for START (round 2 blocker 2).** A path whose
first segment equals `reviews`, compared case-insensitively as the existing `.context` check
does, can never enter a START envelope or a review-mode selection through any path:

| Path into START | Behaviour |
|---|---|
| Discovery walk | Never descends into `reviews/`. |
| Configured source equal to or inside `reviews` | `CONFIG_INVALID`. Validation of other configured sources is unchanged. |
| Explicit `files` link from any artifact | Ordinary path validation runs first and keeps its normal diagnostics. Only a link that is then validly identified as a review record is refused with `START_REVIEW_RECORD_INELIGIBLE` and a visible omission record (see the order below). |
| File alias to a discovered artifact | Impossible, because nothing under `reviews/` is discovered. A crafted link reaching it is handled as the row above. |
| Symlink or junction alias | Already rejected by `safePath` (`PATH_SYMLINK`). |
| Graph traversal (dependencies, reverse associations, replacement chains, review hops) | Cannot reach `reviews/`, since only discovered artifacts are traversed. Any file target under `reviews/` is handled as the `files` row. |

- **Diagnostic order (round 3 finding 4).**
  1. A `files` reference first goes through the existing graph path validation, unchanged:
     portable relative path, exact case (`PATH_CASE_MISMATCH`), no symlink or junction
     (`PATH_SYMLINK`), existence (`FILE_MISSING`), regular file (`FILE_NOT_REGULAR`),
     `IO_ERROR`. A structurally invalid reference keeps that diagnostic and its existing
     effect. In START, any structural diagnostic fails compilation as today. Review mode
     classifies it by R9.
  2. Only a reference that passes validation, and so becomes a valid file link with a
     normalised path whose first segment equals `reviews` (case-insensitive), is then refused
     with `START_REVIEW_RECORD_INELIGIBLE`.
  3. Generated paths are still skipped earlier by the existing graph rule, and `reviews/` is
     not a generated path, so the two rules never overlap.
- `START_REVIEW_RECORD_INELIGIBLE` is a recorded refusal. It does not change the outcome by
  itself, in the same way ADR-0001 treats an unknown-authority review subject, because nothing
  binding is lost.
- `validate` and the generated index are unchanged. The link stays structurally valid.
- This departs on purpose from the existing graph behaviour, which skips `files` links to
  generated paths without a diagnostic. The owner requires a defined diagnostic for review
  records.
- **This changes accepted Phase 3 START selection behaviour**, so it must be recorded in
  ADR-0002 as a supplement to ADR-0001 §5/§7, not a replacement of it. The existing
  ADR-0001 replacement mechanism is for whole-artifact successors and is not used here.

**R6.3 Round numbering.**
- Valid names match `^(code|architecture|context)-([1-9][0-9]*)\.md$`.
- Other names, and names that differ only by case, give `REVIEW_REPORT_NAME_INVALID` as a
  diagnostic only.
- The next round is the highest valid round plus one.
- Only names are read. The round number is operational state (R6.4).

**R6.4 Evidence identity versus operational state (round 2 blocker 1 and non-blocking
finding 3).** The package has two separate parts:

- **Evidence payload**, hashed as `evidence_hash`, the SHA-256 of its canonical serialisation.
  It is role-independent and fixed before review:
  - the resolved base commit;
  - the subject manifest and content hashes, with `reviews/**` excluded and the root task
    represented by per-field and per-section hashes;
  - root identity, requirement and unrecognised content (R4.2, R4.3);
  - base binding-context selection with content hashes, including quarantine records and
    evidence gaps;
  - **base-derived checks** (base START outcome and diagnostics, D22 flags), which are fixed
    functions of immutable inputs;
  - **procedure identity:**
    - Keystone package version;
    - review contract version (the ADR-0002 contract and package `schema_version`);
    - partition-contract version;
    - the provenance and hash of every charter.

    Including these means the same repository evidence prepared under a different review
    procedure gets a different identity.

  **Excluded from the payload:**
  - root lifecycle fields;
  - the `Review Findings` and `Outcome` sections;
  - the round number;
  - all operational checks.
- **Operational checks**, visible in the package but outside the hash:
  - working-tree `validate` results;
  - generated-index freshness;
  - next-round allocation.

  These can change solely because lifecycle or disposition fields changed. A disposition edit
  makes the index stale, for example. They are each recorded with the observation they were
  computed from.
- The package also has a `package_hash` for operational identity (round 3 finding 5). It is
  the SHA-256 of the package's canonical serialisation with the `package_hash` field omitted:
  recursively sorted keys, two-space indentation and a final LF, the existing `serialize`
  form. That removes any self-reference, the same way START omits its own budget field from
  budget accounting. `evidence_hash` is part of the hashed content. Reports cite
  `evidence_hash`.
- So writing a report, a disposition or a status change cannot change `evidence_hash`. Other
  later edits, such as a `TASKS.md` move, do change it. Whether that makes a report stale is a
  Phase 5 rule.

**Alternatives:**
- A per-role hash: reports become stale on write.
- Including index freshness in the hash: disposition edits invalidate the hash (round 2).
- Omitting procedure identity: different procedures would be indistinguishable.
- Only documenting the discovery behaviour for `reviews/`: leaves `files` links as a way in
  (round 2).
- Treating ineligible links as `incomplete` in START: penalises a refusal that loses nothing
  binding.

### R7 — Reviewer charters (owner decisions R7 and Q5)

- Charters are review-procedure inputs and templates. START never selects them automatically
  as reviewer charters, and they confer no START authority (round 3 finding 7, wording
  corrected; there is no new exclusion). Under existing behaviour:
  - `agents/` is not a default discovery source;
  - a charter without `context_type` is skipped by discovery even if a configured source
    covers it;
  - an explicit `files` link to a charter selects it like any ordinary file, as non-binding
    Tier 3 evidence.

  Phase 4 does not change any of this.
- Defaults ship as `templates/agents/<role>-reviewer.md`. A project charter with content
  beyond a heading replaces the default.
- The base version is always used. A charter changed in the subject is a classified change,
  not applied.
- Each charter's provenance and hash are part of the procedure identity (R6.4).

Every charter states:
- statements in changed files and claim content are under review;
- the reviewer must not read `reviews/`, other packages or transcripts;
- approval statements are unverified.

Role scope:
- **code:** correctness against base requirements; tests; no out-of-scope change.
- **architecture:** consistency with authorities and effective ADRs; identify untyped authority
  changes; raise material new decisions as proposed ADRs.
- **context:** durable knowledge correct and minimal; claim content and records accurate;
  contradictions raised; governance-record changes identified. No learning promotion.

**Alternatives:**
- Project charters only: gives empty placeholders.
- Charters in code: durable knowledge outside the repository.
- Working-tree charters: the work could rewrite its own procedure.

### R8 — Review report contract (owner decision R8)

`schemas/review-report.schema.json` and `templates/review.md`, schema_version 1, **provisional
until Phase 5 consumes it**. Phase 5 may add fields but must not change the meaning of existing
ones.

Front matter:
- `kind: keystone-review-report` (there is no `context_type`);
- `schema_version`, `task`, `role`, `round`;
- `verdict`: `approve`, `changes-requested` or `inconclusive`;
- `evidence_hash` (R6.4);
- `base`;
- `reviewer`, a free-text attestation.

Body sections:
- `## Findings`, required, and must not be blank when the verdict is `changes-requested`;
- `## Evidence Examined`;
- `## Limitations`, required when the verdict is `inconclusive`.

No Phase 4 command validates report contents (Q6). CLOSE semantics and staleness rules are
deferred.

**Alternatives:**
- Defer the format: CLOSE has no stable input.
- Validate in Phase 4: declined (Q6).

### R9 — Outcomes and diagnostic precedence (owner decisions R9, Q7 and round 2 blocker 4)

Diagnostics are classified in this order, and the first matching class applies to each
diagnostic:

1. **Identity/structure failure → `failed`.** Malformed, duplicate or ambiguous identity or
   structure that prevents reliable identification of the root task or required binding
   context:
   - root identity failures (R4.1);
   - an unsafe partition (R4.3);
   - more than one project candidate, or a malformed sole project (in review mode, an
     ambiguous project is `failed`, not START's `incomplete`);
   - a quarantined target that is required binding context (R4.5);
   - case-colliding paths within configured discovery sources affecting the root, the project
     or binding context.
2. **Boundary or input failure → `failed`:**
   - an unknown task;
   - `--base` does not resolve to a commit;
   - `--base` is not an ancestor of `HEAD`;
   - a merge, rebase, cherry-pick or revert in progress, or unmerged index entries;
   - Git missing or failing the capability probe (R11);
   - a required object is missing (no lazy fetch, R11);
   - an I/O failure.
3. **Unavailable relationship target → `incomplete` evidence gap.** A valid, identifiable
   relationship whose target is missing at base (`REVIEW_BASE_LINK_UNRESOLVED`), or whose
   quarantined target is not required binding context.
4. **Unrelated base structural diagnostics → `incomplete`.** Diagnostics that do not prevent
   deterministic construction of the package, including quarantined artifacts that nothing
   selected reaches. They are reported as base evidence gaps.
5. **Other explicitly represented gaps → `incomplete`:**
   - START at base is incomplete or conflicted (for example a valid ADR replacement conflict,
     which concerns authority rather than identity);
   - unrecognised root fields or sections;
   - an empty code subject;
   - binary, non-UTF-8, gitlink, symlink and filter-attributed files, represented with
     metadata and raw hashes and never followed (Q7).

**`complete`** (exit 0) means none of the above. Budget omissions of lower-tier context do not
affect it.

`failed` is exit 2: no package is installed and the earlier package is kept. `incomplete` is
exit 1. Working-tree structural `validate` errors are operational checks, not failures. No
outcome means approval, readiness or a verdict. Diagnostics use a `REVIEW_*` prefix and
existing codes are preserved.

**Alternatives:**
- Every base structural error as `failed`: over-strict.
- Selecting over ambiguous identities by order: nondeterministic authority (round 2).
- A project conflict as `incomplete`, as in START: the review would rest on unidentified
  binding context.

### R10 — Budget (recommendation)

D17 tiers apply, with the same 8,000-token default target. The following are required and never
left out:
- identity and requirement content;
- base binding content;
- the charter;
- base-derived and operational checks;
- the manifest;
- full textual diffs (other than R4.7 withholding and R9 hash representation);
- the context role's under-review block.

The package reports when they exceed the target. Other evidence is packed in stable order with
visible omissions.

**Alternatives:**
- No target: contradicts D17.
- Truncation: hides the subject.

### R11 — Git safety, isolation and supported versions (round 2 blocker 3; contract decision with delegated mechanics)

**Decision:** Keystone never runs a Git operation that can run filters, fsmonitor, external or
textconv drivers, or hooks, or that can fetch, use the network or change Git state.

- **No lazy fetching.** Every Git invocation passes the global option **`--no-lazy-fetch`**
  and sets **`GIT_NO_LAZY_FETCH=1`**.
  - The option fails loudly on Git versions that do not support it. That matters because older
    Git silently ignores an unknown environment variable.
  - With lazy fetching disabled, a missing object in a partial or promisor clone is reported
    as missing and gives `failed` (`REVIEW_GIT_OBJECT_MISSING`).
- **Review Git environment (round 3 finding 2).** The capability probe and every review Git
  invocation use one deterministic environment, built the same way each time:
  1. Start from the inherited process environment.
  2. Remove **every** variable whose upper-cased name starts with `GIT_`, except the
     `GIT_CONFIG_*` family, which is kept for repository trust as `gitRoot` keeps it. This
     removes the discovery overrides (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
     `GIT_OBJECT_DIRECTORY`, `GIT_CEILING_DIRECTORIES` and so on) and all inherited tracing
     (`GIT_TRACE*` including `GIT_TRACE2*`, `GIT_REDACT_*`).
  3. Set these explicit values last, so they win:
     - `GIT_TRACE=0`;
     - `GIT_TRACE2=0`, `GIT_TRACE2_EVENT=0`, `GIT_TRACE2_PERF=0`;
     - `GIT_NO_LAZY_FETCH=1`, `GIT_NO_REPLACE_OBJECTS=1`;
     - `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`;
     - `LC_ALL=C`.

  The explicit Trace2 values also disable Trace2 targets set in system or global config files,
  which `GIT_CONFIG_*` might otherwise reach, because Trace2 environment variables take
  precedence over Trace2 config.
  - Verified locally on Git 2.52.0: an inherited `GIT_TRACE2=<file>` wrote a trace file, and
    `-c trace2.normalTarget=0` **did not** prevent it. Setting `GIT_TRACE2=0` in the
    environment did. Trace suppression is therefore by environment, not by `-c`.
- **Per-invocation options**, the same for the probe and every review command:
  - `--no-lazy-fetch --no-replace-objects`;
  - `-c protocol.allow=never -c core.fsmonitor=false`;
  - `--end-of-options` before user-supplied revisions.
- **Replacement objects are disabled (round 3 finding 3)** by `--no-replace-objects` together
  with `GIT_NO_REPLACE_OBJECTS=1`. That applies to every step: base resolution (`rev-parse`),
  ancestry (`merge-base --is-ancestor`), the commit list (`rev-list`), inventory (`ls-tree`),
  object reads, and commit-message inspection for D22 flags (`cat-file --batch` on the commit
  objects). Evidence therefore corresponds to the literal Git objects named by `--base`,
  `HEAD` and their trees, not to `refs/replace` substitutes. Verified locally:
  `git --no-replace-objects --no-lazy-fetch rev-parse --verify HEAD^{commit}` succeeds on
  Git 2.52.0.
- **Allowed commands:**
  - `rev-parse`;
  - `merge-base --is-ancestor`;
  - `ls-tree -r -z`;
  - `cat-file --batch`;
  - `rev-list`;
  - `check-ignore`;
  - `check-attr`;
  - `ls-files --unmerged`;
  - an in-progress operation check (the state files inside the `rev-parse --git-dir` path,
    read only).

  Porcelain `status` and `diff` are not used.
- Subject contents are raw objects compared with raw working-tree bytes after START's
  BOM/CRLF normalisation. Diffs come from a deterministic, dependency-free line-diff
  implementation. Filter-attributed files are represented by metadata (R9).
- **Supported Git version: upstream 2.45 or later (round 3 finding 1, corrected from 2.44).**
  - The **capability probe is authoritative.** It runs
    `git --no-lazy-fetch --no-replace-objects version` with the review environment and
    per-invocation options above, and it must succeed.
  - A distribution build below 2.45 that backports the behaviour is accepted if the probe
    succeeds.
  - Version strings are never parsed.
  - A failed probe gives `failed` (`REVIEW_GIT_UNSUPPORTED`).
  - Verified locally on Git 2.52.0 (Windows): the option is accepted, and unknown global
    options are rejected with "unknown option".
  - The existing `gitRoot` used by `init` and `status` is unchanged and needs no minimum
    version.
- **Base access:** read directly from Git objects, or materialised in a disposable temporary
  directory outside the repository with the existing portable-path and case checks. Symlinks
  and gitlinks are never followed. There are no writes to Git or the working tree. Identical
  state produces identical bytes.

**Alternatives:**
- `git diff` with flags: cannot disable clean filters or fsmonitor reliably.
- A diff library: a supply-chain dependency.
- The environment variable alone: silently ineffective on older Git.
- Version parsing: brittle across distributions.

### R12 — Boundary with Phase 5 and adapters (recommendation)

Out of Phase 4:
- the CLOSE gate;
- verdict semantics and staleness rules;
- task status changes;
- approval confirmation;
- validating report contents;
- learning and trap classification;
- automatic prior-report inclusion;
- adapter guidance.

`review` writes only `.context/review/`.

### R13 — Architectural record (owner decision)

After TASK-0006 is accepted, draft **ADR-0002, "Review evidence and reviewer records"**,
covering:
- R1–R9 and the R11 contract decision;
- the R4.2 metadata classes and the R4.3 partition contract;
- review-mode selection and the diagnostic precedence (R4.5, R9);
- the R5 classifications;
- the evidence identity (R6.4);
- the supported Git version, the review Git environment and the disabling of replacement
  objects (R11);
- **the START ineligibility of `reviews/**` and the discovery and config exclusion (R6.2), as
  a supplement to ADR-0001.**

A SPEC amendment covers:
- the `--base` option;
- review outcomes;
- the classification of `reviews/` and its START ineligibility;
- the report contract.

Both go through review before adoption. TASK-0007, separately authorised, holds the R10–R11
mechanics and the section 5 scenarios.

## 3. Compatibility

| Decision | Status under this proposal |
|---|---|
| D01, D16, D20 | Preserved: packages are generated; reports are not truth; Keystone writes only `.context/review/` |
| D02 | Preserved: reports are ineligible for START |
| D07, D08 | Charters are review procedures; adapters unchanged |
| D13, D14, D15 | Made concrete by R2, R4 and R5 |
| D17 | Applied as R10 |
| D18, D25 | Preserved: no models, services, network or new runtime dependency |
| D22 | Observed by the R3 flags, not enforced |
| ADR-0001 | Selection rules reused in review mode. **START is supplemented by the R6.2 review-record ineligibility**; no other START change |
| Phase 1/2 discovery and config | **Changed** by the R6.2 exclusion |
| Phase 2 `init` | Behaviour unchanged; its scaffold list becomes a shared constant |
| SPEC.md CLI contract | **Extended** by `--base` |
| Runtime environment | **New requirement:** upstream Git 2.45 or later, or a probe-proven backport, for `review` only |

## 4. Owner decisions and open items

| # | Decision (2026-10-04) |
|---|---|
| R1 | Evidence only; no model call, no verdict. |
| R3 | `--base`, default `HEAD`; the CLI extension needs adoption. |
| R4 / Base | Exclude implementer claims; requirements and context come from base; changes during the work cannot redefine their own standard. |
| R5 / B1 | Deterministic exposure of every change; typed classification; untyped authority identified semantically; no new mechanism or names. |
| R6 / B3 | Durable `reviews/` records outside the boundary; pre-review evidence hash. |
| R7 / Q5 | Charters are procedure inputs; project charters replace defaults, using base. |
| R8 / Q6 | Stable provisional report contract with three verdicts; no Phase 4 validation. |
| R9 / Q7 | Untrustworthy boundary or missing required evidence is `failed`; represented gaps are `incomplete`. |
| B2 | A task introduced in the subject supplies its requirements; context comes from base; gaps for unresolved links. |
| B4 | Per-role filtering; the context role gets claims marked unverified. |
| Q2–Q4 | Whole changed files; filter only the root task; prior reports supplied by hand. |
| Round 2, blocker 1 | `evidence_hash` covers the immutable payload and procedure identity; operational checks are visible but unhashed. |
| Round 2, blocker 2 | `reviews/**` is ineligible for START through every path, with a defined diagnostic; recorded as an ADR-0002 selection change. |
| Round 2, blocker 3 | No lazy fetching on every object read; missing objects fail without network or mutation; a minimum Git version is stated. |
| Round 2, blocker 4 | Identity/structure failure is `failed`; an unavailable valid target is an `incomplete` gap; unrelated base diagnostics are `incomplete`; no selection over ambiguous identities. |
| Round 3, finding 1 | Minimum upstream Git is 2.45; the capability probe is authoritative, so probe-proven backports are accepted. |
| Round 3, finding 2 | One deterministic review Git environment for the probe and every invocation; inherited tracing and Trace2 cannot write files, sockets or Git state. |
| Round 3, finding 3 | Replacement objects disabled for every review Git step. |
| Round 3, finding 4 | Normal path diagnostics come first; the non-fatal review-record refusal applies only to a validly identified review record. |
| Round 3, finding 5 | `package_hash` is computed over the canonical package with the field omitted. |
| Round 3, finding 6 | The configured `.` example is removed; root-source validation is unchanged. |
| Round 3, finding 7 | Charter wording corrected to "not automatically selected as reviewer charters"; existing explicit-file behaviour described; no new exclusion. |
| R13 | ADR-0002 and the SPEC amendment after TASK-0006 is accepted. |

**Unresolved owner decisions:** none. The revision 5 choices flagged for the final review
(review-record refusal does not change the outcome on its own; a project conflict is `failed`
in review mode; a non-exempt level-1 heading is `failed`; probe-based Git support) are not
changed by the round 3 dispositions. Finding 1 corrected the version, and finding 4 clarified
the refusal's diagnostic order.

## 5. Proposed acceptance scenarios for the implementation task

1. Uncommitted change against `HEAD` produces three distinct role packages for `--type all`.
2. D22 flags are computed from full messages, including a body-only ID like `cb2b754`, with no
   message text.
3. Same repository state produces identical bytes, and a rerun changes nothing.
4. Root requirements come from base; code and architecture withhold claims by hash; context
   includes them marked unverified.
5. Requirement edits are shown side by side with base; lifecycle edits are facts.
6. A task introduced in the subject (the TASK-0006 case) supplies requirements; base context
   compiles; unresolved links are gaps; the task is absent from the base inventory.
7. Each metadata class is handled as R4.2 specifies. An extension field is withheld, given to
   context under review, diagnosed and gives `incomplete`.
8. A second level-1 heading, a level-1 heading after prose, or one between sections gives
   `failed`. A unique leading title is exempt. Unknown level-2 sections are `incomplete`.
9. A duplicate root ID, malformed root front matter, two projects, or a quarantined binding
   target gives `failed`. A missing valid target is an `incomplete` gap. An unrelated
   duplicate elsewhere is quarantined and gives `incomplete`.
10. Every changed path is in the manifest with its class; nothing is labelled authority by
    name.
11. Writing a report, a disposition or a status change leaves `evidence_hash` unchanged, even
    though index freshness changes. A different charter or Keystone version changes
    `evidence_hash` for identical repository evidence.
12. A valid task `files` link to an existing `reviews/...` report is not selected by START or
    review mode and emits `START_REVIEW_RECORD_INELIGIBLE` with an omission. A missing,
    case-mismatched, symlinked or non-regular `reviews/...` reference keeps its normal path
    diagnostic instead. A `reviews` source gives `CONFIG_INVALID`. A malformed report never
    affects `validate` or START. An explicit `files` link to a charter is ordinary Tier 3
    evidence, unchanged.
13. The charter is read from base; a project charter replaces the default; a placeholder uses
    the default; a changed charter is not applied.
14. An unknown task, a bad or non-ancestor `--base`, an operation in progress, or unmerged
    entries give `failed`.
15. In a partial clone missing a required object, the review gives `failed` with no network
    access and no new objects or refs in Git. A Git that fails the probe gives
    `REVIEW_GIT_UNSUPPORTED`; a backport that passes the probe is accepted.
15a. With inherited `GIT_TRACE*` and `GIT_TRACE2*` variables and Trace2 targets in config, the
    probe and review invocations write no trace files or sockets and produce identical
    packages.
15b. With a `refs/replace` object for the base commit or a tree in range, evidence uses the
    literal objects.
15c. `package_hash` is reproducible from the package with the field omitted; `evidence_hash`
    is unaffected by `package_hash`.
16. Binary, non-UTF-8, gitlink, symlink and filter-attributed files are represented by
    metadata and gaps.
17. Configured clean, LFS, textconv and external-diff drivers and fsmonitor are never run.
18. A large diff is kept whole above the target, with visible omissions.
19. No sources, `reviews/`, task files or Git state are modified; everything runs offline.

## 6. Review record and closure

| Round | Revision | Reviewer | Verdict | Findings | Disposition |
|---|---|---|---|---|---|
| 1 | 3 | Fresh-context subagent of the same model (partly independent) | changes-requested | 4 blocking, 10 non-blocking | All resolved in revision 4 |
| 2 | 4 | Codex (separate model and host) | changes-requested (four blocking, three non-blocking, as relayed by the owner) | 7 | All resolved in revision 5 |
| 3 | 5 | Codex (final review) | changes-requested | 7 | All resolved in revision 6 (section 4, round 3 rows) |

Revision 6 is the closure revision. Its round 3 changes correct or clarify existing decisions
without introducing new architecture. No further open-ended review is planned for TASK-0006.
After the owner accepts TASK-0006, ADR-0002 and the SPEC amendment are drafted from this record
(R13). Each still requires its own review and adoption, and only then may implementation
(TASK-0007) be authorised.
