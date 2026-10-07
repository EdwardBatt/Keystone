# Phase 3 implementation contract — TASK-0004

SPEC.md and ADR-0001 own the architecture. This document specifies the deterministic
implementation mechanics delegated to TASK-0004; it introduces no approval mechanism.

## Inputs and selection

`keystone start <TASK-ID> [--root <directory>] [--json]` uses the supplied directory
as repository root, matching index/validate. It reads current configured sources and
runs the existing discovery/schema/graph validation before selection. Generated indexes
and TASKS.md do not supply task facts. Explicit source configuration is tracked separately
from its normalized paths, even when it lists exactly the default paths.

Selection follows ADR-0001 and its adopted bounded mappings: active project/features,
accepted effective ADRs, active or status-free rules/procedures, accepted learnings and
active traps. Root tasks are scope anchors at any status. Dependencies are supporting
tasks, not additional scope. Direct proposals are review material with at most one outgoing
hop, whose role stays non-binding. Only active direct features anchor reverse associations.
Unknown authority is diagnosed; mandatory uncertainty and unknown active-trap severity
make the result incomplete. Only medium severity is classified, at Tier 2.

Phase 6 (ADR-0003, TASK-0011): `retired` learnings and traps are known, never-binding history.
Any path that reaches one, including task-relevant reverse associations, gives it the `history`
role at Tier 3 with no `START_AUTHORITY_UNKNOWN` diagnostic, so budget packing may omit it
visibly. Candidates and proposed traps are still not reverse-selected.

## Content and identity

Existing portable path checks, exact case, graph ID-first/path-second resolution and
BOM/CRLF-to-LF normalization apply. Discovered artifacts deduplicate by unique ID;
file aliases use their discovered artifact identity, ordinary files use normalized path.
All independent immediate selection reasons (source, field, path role, tier) are retained
and sorted. Cyclic feature/task dependencies terminate without importing other neighborhoods.
Replacement conflicts override every binding path into the affected chain.
Conflicting project candidates remain non-binding through every selection path, including
file aliases; their selection reasons retain non-binding roles too.

Root/project and conflicted/review/history content uses the entire Markdown body.
For effective ADRs prefer the unique level-two `Decision` and `Constraints` sections,
including their heading lines and nested subsections, ending before the next level-one
or level-two heading. Both must exist once and contain nonblank content. Fenced headings
are ignored. Duplicate/absent headings, setext headings, unclosed fences or unselected
nonblank prose make partial extraction unsafe and select the entire body instead.
Only a unique level-one heading at the first nonblank line, before both selected sections,
may be exempt as the document title. Every other unselected nonblank line, including a
heading with no following paragraph, requires whole-body fallback.
Other artifact types conservatively retain their whole body. Metadata is always separate
and preserved. Ordinary files are UTF-8 text evidence; binary/invalid UTF-8 bodies are
omitted with an explicit reason and content hash. They never supply authority.

## Envelope, budget and outcomes

Output is `.context/current-envelope.json`, marked `generated_by: keystone`,
`schema_version: 1`, `kind: start-envelope`. It includes root task/status, inventory,
selected entries with role/tier/reasons/content/hash/metadata, replacement evidence,
diagnostics, omissions and budget accounting. No generated timestamps or absolute paths occur;
source metadata, including its recorded dates, is preserved.
JSON uses existing recursively sorted keys, two-space indentation and a final LF.
Arrays use locale-independent stable ordering; entries sort by tier, role, type, identity.

The estimator is `ceil(UTF-8 bytes / 4)`. Budget accounting covers the serialized envelope
with its budget field omitted (avoiding self-reference). First retain every compact entry,
reason, omission record and Tier 0/1 body. Then try whole Tier 2/3 bodies in stable order;
skip oversized bodies and continue to later smaller bodies. Every skipped body has a
visible omission record. No truncation or model summaries. The target is 8,000; required
content and bookkeeping may exceed it, explicitly reported in budget accounting.

`complete` exits 0; `incomplete/conflicted` exits 1; `failed` exits 2.
Usage errors remain exit 2. No outcome authorizes implementation or claims readiness.
Complete and incomplete envelopes atomically replace recognized generated envelopes
using a temporary sibling and rename. Identical bytes are not rewritten. Failed requests
return no envelope, report `installed: false`, and preserve the prior file; it is never
presented as the current request's result. Unrecognized destination contents are refused.
Sources and indexes are never written. Existing stable-working-tree assumptions apply.

## Diagnostics

Existing structural codes are preserved and cause failed compilation. START adds
`START_TASK_NOT_FOUND`, `START_PROJECT_UNAVAILABLE`, `START_PROJECT_CONFLICT`,
`START_AUTHORITY_UNKNOWN`, `START_MANDATORY_UNAVAILABLE`, `START_ADR_CONFLICT`,
`START_SEVERITY_UNKNOWN`, `START_ENVELOPE_OVERWRITE_REFUSED`, and, as the ADR-0002 supplement added
by TASK-0007, `START_REVIEW_RECORD_INELIGIBLE`. That code applies to a validly identified
root-level `reviews/` file reference, which is omitted (`review-record-ineligible`) without
changing the outcome. The ADR-0004 supplement added by TASK-0013 applies the same treatment to
root-level `benchmark/results/` and `benchmark/analysis/` file references, and its 2026-10-07
clarification (TASK-0015) to `benchmark/plans/` file references, compared
case-insensitively: `START_BENCHMARK_RECORD_INELIGIBLE`, omitted as `benchmark-record-ineligible`,
in START and review-context selection alike. Unknown authority on an
explicit review subject is diagnostic without implying global incompleteness; unknown
replacement authority and unavailable mandatory context are incomplete. I/O failures
retain `IO_ERROR`. Diagnostics and replacement evidence are deduplicated and sorted.

## Usage and verification

```powershell
node dist/cli/index.js start TASK-0001 --root "C:\path\to\target" --json
```

The command reports the requested task, semantic outcome, whether its envelope was installed,
whether bytes changed, diagnostics, and the envelope or null on failure. On failure a previous
file may still exist; `installed: false` means it is not the result of this request.
The library's `compileStart` performs the same compilation without writing generated output.
`start` additionally installs successful/inspectable output. There is no new CLI dry-run flag.

The implementation was verified on 2026-10-01 with the TypeScript build/check, all 152 tests,
and Keystone validation. `tests/phase3.test.mjs` covers the TASK-0004 regression scenarios
plus failure-injection, explicit-source provenance, binary evidence, cross-root determinism,
project-conflict file aliases and preservation of heading-only ADR constraints.
The historical TASK-0003 design record remains non-authoritative; no deferred authoring,
review/close/compaction workflow, approval registry, or model-provider integration was added.
