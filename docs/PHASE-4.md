# Phase 4 implementation contract — TASK-0007

D13–D15, ADR-0001, ADR-0002 and SPEC.md own the architecture. This document records the
mechanisms TASK-0007 chose to satisfy them. It creates no architectural requirement: any mechanism
here may change without an ADR while ADR-0002, SPEC.md and D13–D15 remain satisfied. TASK-0006
revision 6 was used as guidance only.

## Command

```powershell
node dist/cli/index.js review TASK-0001 [--type code|architecture|context|all] [--base <rev>] --root "C:\path\to\repo" --json
```

- `--type` defaults to `all`. `--base` defaults to `HEAD`.
- `--root` must be the Git top-level of a non-bare repository, so artifact paths and Git paths
  coincide. Otherwise the result is `REVIEW_ROOT_INVALID`.
- Exit codes are the same as START: `complete` 0, `incomplete/conflicted` 1, `failed` 2. Usage
  errors are also 2.
- The library function `compileReview` prepares evidence without writing anything. `review`
  also installs the packages.

## Baseline and subject (ADR-0002 guarantees 3, 4 and 7)

- **Baseline:** `--base` must resolve to a commit that is an ancestor of `HEAD`. An unborn
  `HEAD`, an unresolvable or non-ancestor base, a merge, rebase, cherry-pick or revert in
  progress, or unmerged index entries are `failed`, because the boundary cannot be established
  reliably.
- **Subject:** the difference between the base tree and the working tree. Working paths are
  the index entries (`ls-files --stage`) plus untracked, non-ignored files
  (`ls-files --others --exclude-standard`).
- **Always excluded:**
  - root-level `reviews/**`, compared case-insensitively;
  - generated paths (`isGeneratedPath`: `.context/**` except `.context/config.yaml`, and
    `context/STATE.md`), including review packages and the temporary base tree.

  This holds whether or not the repository ignores `.context/`, so review output and reports
  cannot contaminate the evidence (G1).
- **Comparison:**
  - Content is compared after START's BOM and CRLF normalisation, so a change in line endings
    alone is not a change.
  - Executable-bit changes are not tracked, because Windows working trees do not represent
    them.
- **Text entries** carry a deterministic unified diff with three lines of context, produced by
  an internal Myers implementation. Common prefixes and suffixes are trimmed first. Very large
  edit distances fall back to a whole-file replacement hunk rather than truncating.
- **Gaps:** binary or non-UTF-8 content, symlinks, gitlinks and nested repositories, and files
  with a Git `filter` attribute are represented by metadata (mode, size, hashes, link target,
  object ID). No content or diff is given for them, they are never followed, and the package is
  `incomplete`.
- **The root task file** appears in the manifest without a diff. Its content is represented
  through requirements and claims (below).

## Requirements, claims and base context (guarantees 3 and 5)

- **Root task identity.** The root task is found by ID in the base inventory and the
  working-tree inventory.
  - If it exists at base, requirements come from base.
  - Otherwise the working-tree task supplies them (`REVIEW_TASK_INTRODUCED_IN_SUBJECT`). It is
    never added to the base inventory.
  - Duplicate or unidentifiable root candidates are `failed` (`REVIEW_ROOT_AMBIGUOUS`). That
    covers a duplicate ID, a malformed or unrepresentable task file where the root's identity
    cannot be ruled out, or a working inventory that cannot be read.
  - A malformed or unreadable task candidate, at base or in the working tree, blocks root
    identity (`REVIEW_ROOT_AMBIGUOUS`) unless its front matter is readable UTF-8 naming a
    different `id`. That applies even when one valid root candidate exists.
  - An unknown task is `REVIEW_TASK_NOT_FOUND`.
- **Metadata classes:**
  - identity: `context_type`, `schema_version`, `id`;
  - requirement: `title`, `priority`, `tags`, `feature`, `features`, `depends_on`, `adrs`,
    `key_adrs`, `rules`, `key_rules`, `skills`, `files`, `tasks`;
  - lifecycle: `status`, `created`, `completed`, reported as facts;
  - unrecognised: everything else.
- **Body partition**, on level-2 ATX headings outside fences:
  - requirement sections: `Objective`, `Acceptance Criteria`, `Scope`, `Out of Scope`,
    `Dependencies`, `Relevant Files`, `Decisions / ADRs`;
  - claim sections: `Implementation Notes`, `Tests`, `Review Findings`, `Outcome`;
  - deeper headings belong to their enclosing section;
  - one level-1 title is allowed on the first non-blank line;
  - unknown sections and pre-section prose are unrecognised, reported, and make the package
    `incomplete`;
  - any other level-1 heading, a setext heading (a `=`/`-` underline directly after text), an
    unclosed fence or a duplicate requirement heading makes the task unparseable
    (`REVIEW_TASK_SECTIONS_UNPARSEABLE`, `failed`).
- **Requirement changes.** When the task exists at base, edits made in the working tree to
  requirement fields or sections are listed beside the base values.
- **Claims.** Claim and unrecognised content from both sides is given to code and architecture
  as name and hash only. The context role receives it in an `under_review` block labelled
  `unverified`. Commit messages are never included; commits appear only as hashes with flags.
- **Base context, in review mode:**
  1. The base tree is materialised under `.context/review/.base-<random>/` and removed
     afterwards.
  2. The base configuration, discovery, graph and ADR-0001 selection run over that tree.
  3. Artifacts with duplicate or invalid IDs are quarantined. Malformed files and paths that
     cannot be materialised (case collisions, non-portable names, symlinks, gitlinks) are
     recorded as unidentified, with their expected type taken from their path.
- **Failure versus gaps in the base context:**
  - `failed`:
    - an invalid base configuration;
    - more than one project candidate, or an unidentifiable `PROJECT.md`;
    - an unidentifiable default `rules/GLOBAL.md`;
    - a binding relationship of the root or project (`adrs`, `key_adrs`, `rules`, `key_rules`,
      `feature`, `features`) that is ambiguous or invalid, or that is missing while an
      unidentified candidate of the expected type exists.
  - Evidence gaps (`REVIEW_BASE_LINK_UNRESOLVED`, `incomplete`): other unresolved root or
    project relationships.
  - Other base structural diagnostics are reported as base evidence and make the package
    `incomplete`.
  - The root task's body is never repeated in the base context; only requirements and claims
    represent it.
  - Governing artifact content and the root task are decoded as strict UTF-8, never through
    replacement characters. An invalid Tier 0 or binding artifact, or an invalid root task, is
    `failed` (`REVIEW_CONTEXT_UNREADABLE`). An invalid lower-tier artifact is an explicit
    evidence gap (`incomplete`), represented by hash only.
  - Accepted dependency tasks keep their whole bodies.

## Packages and roles (guarantees 1, 2 and 6)

- One package per requested role is written to `.context/review/<TASK-ID>/<role>.json` with
  `kind: review-package`, `authorization: not-established` and `verdict: not-determined`.
- Writes are atomic. Identical bytes are not rewritten. Unrecognised destination contents are
  refused (`REVIEW_PACKAGE_OVERWRITE_REFUSED`) before anything is written. A failed review
  installs nothing and leaves earlier packages in place.
- **Every package contains:**
  - the baseline (base, HEAD, and commits with D22 flags);
  - requirements and requirement changes;
  - lifecycle facts;
  - the base context;
  - the subject manifest and diffs;
  - base START outcome and diagnostics;
  - working-tree validation;
  - its role charter;
  - its role's report path and next round number (C1);
  - diagnostics, omissions and budget.
- **Roles differ in:**
  - their charters;
  - claim exposure (context only);
  - generated-index freshness (context only).
- No package ever contains a reviewer report.
- **Charters:**
  - Defaults are in `templates/agents/<role>-reviewer.md`.
  - A base-revision `agents/<role>-reviewer.md` with content beyond headings replaces the
    default.
  - The working-tree version is never used.

## Evidence identity (guarantee 7)

- `evidence_hash` is the SHA-256 of the canonical serialisation of a role-independent payload:
  - the review contract version and Keystone version;
  - the base commit;
  - the subject manifest, with normalised content hashes and the root task file listed only by
    path and change;
  - the root task's identity, requirement content, and claim and unrecognised hashes, excluding
    `Review Findings` and `Outcome`;
  - the base context selection, quarantine, gaps, outcome and diagnostics;
  - every charter's provenance and hash.
- **Excluded from the hash:**
  - lifecycle fields;
  - commit flags (so committing work or reports does not change the hash, C2);
  - working-tree validation, index freshness and round numbers;
  - all package content bodies.
- `package_hash` is the SHA-256 of the canonical package with `package_hash` omitted.

## Outcomes (guarantee 9)

- `failed` for the boundary, identity and governing-context conditions above, Git failure,
  unsupported Git, a missing object or an I/O error.
- `incomplete/conflicted` for:
  - represented gaps;
  - START at base being incomplete or conflicted;
  - unrecognised task content;
  - base structural diagnostics;
  - an empty subject (code role only).
- `complete` otherwise.
- The command outcome is the worst outcome across the requested roles.

**Budget:** each package targets 8,000 estimated tokens using START's estimator.
- Required content is never omitted: requirements, claims, the charter, checks, the manifest,
  diffs, and base context at Tier 0 and Tier 1.
- Tier 2 and Tier 3 base context bodies are packed in stable order, with visible omissions.

## Git isolation (guarantee 10)

- **Environment:** every review Git invocation removes inherited `GIT_*` variables except
  `GIT_CONFIG_*`, then sets:
  - `GIT_TRACE=0`;
  - `GIT_TRACE2`, `GIT_TRACE2_EVENT` and `GIT_TRACE2_PERF` to `0`;
  - `GIT_NO_LAZY_FETCH=1` and `GIT_NO_REPLACE_OBJECTS=1`;
  - `GIT_OPTIONAL_LOCKS=0` and `GIT_TERMINAL_PROMPT=0`;
  - `LC_ALL=C`.
- **Global options** on every invocation: `--no-lazy-fetch --no-replace-objects -c
  protocol.allow=never -c core.fsmonitor=false`.
- **Capability probe:** `git ... version` with those options must succeed. Otherwise the result
  is `REVIEW_GIT_UNSUPPORTED`. Upstream Git 2.45 or later, or a backport that passes the probe,
  is required.
- **Commands used:** `rev-parse`, `merge-base --is-ancestor`, `ls-tree`, `ls-files`,
  `cat-file --batch`, `rev-list` and `check-attr`. None of them writes to Git, runs filters or
  hooks, or fetches. A missing object gives `REVIEW_GIT_OBJECT_MISSING`.
- **Writes:** the only filesystem writes are under `.context/review/`.

## START supplement (ADR-0002 guarantee 8)

- Discovery never walks root-level `reviews/`.
- A configured source equal to or inside `reviews` is `CONFIG_INVALID`.
- A `files` reference first receives the existing path validation. If it then resolves to a
  review record, START refuses it with `START_REVIEW_RECORD_INELIGIBLE` and an omission record
  (`review-record-ineligible`). The refusal alone does not change the outcome.
- Review-mode selection uses the same rule.

## Reviewer reports (guarantee 11)

`schemas/review-report.schema.json` and `templates/review.md` define reports at
`reviews/<TASK-ID>/<role>-<round>.md`.
- Front matter: `kind: keystone-review-report`, `schema_version: 1`, `task`, `role`, `round`,
  `verdict` (`approve`, `changes-requested` or `inconclusive`), `evidence_hash`, `base` and
  `reviewer`.
- Body sections: `Findings`, `Evidence Examined` and `Limitations`.
- There is no `context_type`, so discovery ignores reports.
- No Phase 4 command validates report contents. Report names that do not match
  `<role>-<positive integer>.md` produce `REVIEW_REPORT_NAME_INVALID` and are ignored when
  allocating rounds.

## Known limitations

- The base tree and its blobs are read fully into memory and materialised. That suits v0.1
  repository sizes.
- Submodule working state is not inspected. Gitlinks are represented by object ID as gaps.
- Mechanisms here assume the v0.1 stable-working-tree conditions already used by START.
