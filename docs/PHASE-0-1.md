# Phase 0/1 implementation

This document describes the foundation implemented by TASK-0001. For the subsequent
`init` and `context status` additions, see [Phase 2 implementation](PHASE-2.md).

Task: **TASK-0001**. Implements the foundation, index, and structural validation portions
of `FIRST-CODEX-TASK.md`. This file is implementation documentation only. `SPEC.md` and
`ARCHITECTURE-DECISIONS.md` remain authoritative; `FIRST-CODEX-TASK.md` is the implementation
task contract. This document neither approves architecture nor overrides those artifacts.

## Scope and implementation choices

This document describes parser/validator libraries, configuration, discovery, portable
paths, index encoding, and diagnostics. Supersession is limited to ADRs, where the baseline
template establishes it. The earlier universal interpretation has been removed rather
than retained through a new architectural decision. Material architecture questions remain
subject to the proposal/review requirements in the authoritative documents.

- TypeScript with separate parser, graph, validation, configuration, command, and CLI modules.
- `yaml` parses YAML 1.2; Ajv validates local JSON Schema draft 2020-12 documents.
  No schema is downloaded at runtime.
- `.context/index.json` is the single generated output. JSON is sufficient for this phase;
  no database, external service, embedding, or model call is used.
- Phase 0/1 implements `index`, `validate`, help, and version. Initialization and status
  are described in the Phase 2 document; context envelopes, review, task closure,
  promotion, compaction, telemetry, and benchmark execution remain later-phase work.
- Full lifecycle enums, semantic contradiction resolution, promotion policy, and authority
  changes are not inferred. Changes to those contracts would require architectural review.

## Install and run

From the framework directory with Node.js 20 or newer:

```powershell
npm ci
npm run build
npm run check
npm test

node dist/cli/index.js validate --root "C:\path\to\target" --json
node dist/cli/index.js index --root "C:\path\to\target" --json
```

`npm test` builds first. Dependencies must already be installed to build or test offline.
All runtime operations and tests use local files. No Git initialization is required for
these two commands. `--root` defaults to the current directory; Git-root detection is used
by Phase 2 `init` and `context status`. Relative root paths and paths containing spaces work.

The package's `bin` exposes `keystone` when installed or linked through npm. Calling the
compiled entry point directly requires no global installation. This framework repository
contains templates and test fixtures, rather than a populated target project's artifacts;
validating it with default discovery can therefore succeed with zero artifacts.

Exit codes: `0` for success, `1` for validation/I/O failure, `2` for invalid usage or a
later-phase command. JSON mode emits one object containing `command`, `ok`, `artifact_count`,
and `diagnostics`; successful indexing also includes `index` and `changed`. Errors have a
stable `code`, repository-relative `path`, readable `message`, and optional `field`.
Clients should match codes, not human-readable messages. Schema fields use JSON pointers;
graph fields use metadata field names.

## Configuration and discovery

Configuration is optional and read from `.context/config.yaml`. Commands never create or
rewrite it. The defaults are:

```yaml
schema_version: 1
sources:
  - PROJECT.md
  - features
  - tasks
  - adr
  - rules
  - skills
  - context
```

Both configuration fields are optional. `sources` replaces the default list, contains
literal repository-relative file/directory paths, and is not a glob list. When `sources`
is omitted, missing conventional locations are allowed. When explicitly provided, every
source must exist; otherwise `CONFIG_INVALID` prevents indexing. The first missing source
is reported in sorted path order. Unknown configuration keys and unsupported
versions are errors. Directories are visited recursively; overlapping sources are
deduplicated. `.git`, `.context`, `node_modules`, and `dist` directories are excluded.
Generated `context/STATE.md` is also excluded regardless of its content. Explicit generated
sources are rejected. These exclusions do not classify the other Markdown aggregates as
generated or alter their authority.

Markdown front matter must begin at the first line (an optional BOM is accepted), use
`---` delimiters, and contain a YAML mapping with string keys. Duplicate keys, aliases,
unsupported tags (including sets, binary values, ordered maps, and explicit timestamps),
complex/non-string keys, non-finite numbers, unsafe integers, and negative zero produce
`YAML_INVALID`. Accepted values are JSON-compatible primitives, arrays, and plain objects;
unsupported values are not silently coerced. Newline styles normalize to LF. Untagged dates
remain strings. Readable body text stays in its source file.

Discovery recognizes typed documents by `context_type`. Supported types are `project`,
`task`, `feature`, `adr`, `learning`, `trap`, `rule`, and `skill`. All typed documents require
`schema_version: 1`. The supplied templates conform to the schemas.

The conventional `PROJECT.md`, `features/*/FEATURE.md`, task documents under `tasks`, and
decision documents under `adr` require front matter of the corresponding type. `INDEX.md`
and `README.md` under artifact directories are ordinary documents unless explicitly typed.
Other untyped Markdown is outside typed artifact discovery; this does not declare it disposable.
Typed learnings and traps can live anywhere under the configured sources; this phase does
not impose an undocumented storage layout for individual learning/trap files.

Rules and skills under `rules` and `skills` can remain plain Markdown, with their paths as
identities. Optional typed front matter can provide an `id`; it does not require an invented
status lifecycle. Untyped rules/skills in custom layouts are not inferred from prose and
should use typed front matter. No existing rule, skill, or ADR is rewritten.

## Identity and explicit links

Projects use `project_id`, features use `feature`, and tasks, ADRs, learnings, and traps use
`id`. Explicit IDs are case-sensitive portable tokens matching
`[A-Za-z0-9][A-Za-z0-9._-]*` and must be globally unique within discovered artifacts. The
template prefixes remain conventions; the implementation does not invent ID allocation.
An optional feature association may be omitted or null. Status strings are nonblank and
extensible. Extra metadata is retained, with known fields checked for type correctness.
Schemas share structural definitions in `schemas/common.schema.json`; artifact schemas
specify their discriminants, required fields, and ADR-only supersession properties. All
schema references are registered locally; schema validation does not fetch resources.

Relationship arrays contain unique, nonempty strings. Artifact references resolve by
exact ID or repository-relative artifact path. All paths, including file references, are
relative to the target root, not the declaring document. Normalized links use target IDs.

| Metadata field | Target |
|---|---|
| `feature` (outside feature metadata), `features` | Feature |
| `tasks` | Task |
| `adrs`, `key_adrs` | ADR |
| `rules`, `key_rules` | Rule |
| `skills` | Skill |
| `depends_on` | Same artifact type as the source |
| `supersedes`, `superseded_by` (ADRs only) | ADR |
| `files` | Existing regular file inside the target root, except generated mentions below |

Missing and ambiguous targets, wrong target types, and invalid paths are errors. Rules and
skills without explicit IDs are linked by path. Multiple declarations of the same resolved
link are deduplicated. Evidence strings, tags, extension metadata, and prose Markdown links
are preserved as source content, but are not interpreted as typed graph references.

Generated-file mentions in `files` remain in source metadata but do not produce prerequisite
edges or require files to exist. The generated locations are `.context` contents other than
the authoritative `.context/config.yaml`, plus `context/STATE.md` (marked generated by its
baseline template). This includes the index, envelope, and telemetry locations without
implementing those later-phase outputs. Missing authoritative file references still fail.

ADR supersession forms an older-to-newer graph. Either direction can declare an edge; reciprocal
declarations describe the same edge. Self-supersession and cycles are errors. There is no
undocumented requirement to change status, provide reciprocal fields, or have only one
successor. Dependency-cycle or semantic-authority policies are not added in this phase.
On non-ADR artifacts, `supersedes` and `superseded_by` remain uninterpreted extension metadata:
they create no links, impose no schema constraints, and trigger no supersession validation.

## Determinism and write protection

The generated index includes its ownership marker (`generated_by: keystone`), format version,
artifact identities/types/paths/metadata, SHA-256 hashes of normalized source Markdown,
and resolved links. Object keys, artifact order, links, and diagnostics have deterministic,
locale-independent ordering. No wall-clock timestamps or absolute repository paths are
serialized. Repeated declarations resolve consistently; metadata array order is preserved.

Deleting generated Keystone files and rebuilding from unchanged authoritative files,
including configuration, produces identical index bytes. An identical existing index is
not rewritten, preserving its modification time.
Changed indexes are written through a temporary sibling file and renamed into place.

The following write/path guarantees assume a stable working tree for the command's duration.
`validate` is read-only. `index` writes only when validation succeeds. An existing index
must have the recognized ownership marker, supported version, and artifact/link arrays to
be replaced. Unrecognized or malformed content is preserved with an explicit error; there
is no Phase 0/1 `--force` option. Validation failure leaves any previous index untouched;
that previous index may therefore be stale and should not be treated as a successful rebuild.
No authoritative source file is changed by either command.

Backslashes normalize to forward slashes. Absolute/drive/UNC paths, parent traversal,
Windows reserved names, invalid Windows filename characters, trailing dots/spaces, and
Git-internal paths are rejected. Path casing must match the filesystem even on Windows;
case collisions in filenames or directory components, including empty directories, are errors.
Pre-existing symlinks and junctions are rejected on inspected context input/output paths and
authoritative file references. Generated mentions are not opened. The checks use pathnames;
a concurrent junction replacement can redirect later operations, and a concurrently created
destination can bypass an earlier overwrite check. Containment and overwrite protection are
not race-safe guarantees. v0.1 provides neither a transactional filesystem snapshot nor locks
or adversarial filesystem security infrastructure.

## Structured errors

| Code | Condition |
|---|---|
| `CLI_USAGE` | Missing/unknown command or invalid arguments |
| `COMMAND_NOT_IMPLEMENTED` | A later-phase command was requested |
| `ROOT_INVALID` | Target root is missing, unreadable, or not a directory |
| `CONFIG_INVALID` | Config schema/version/key/source errors, including missing explicit sources |
| `PATH_INVALID` | Unsafe or nonportable repository-relative path |
| `PATH_SYMLINK` | Context/file path crosses a symlink or junction |
| `PATH_CASE_MISMATCH` | Reference/source casing differs from disk |
| `PATH_CASE_COLLISION` | Discovered filenames or directory components differ only in case |
| `IO_ERROR` | A repository path cannot be read or an index cannot be written |
| `FRONTMATTER_MISSING` | A conventional typed artifact has no front matter |
| `FRONTMATTER_UNCLOSED` | Missing closing front-matter delimiter |
| `YAML_INVALID` | Malformed or unsupported YAML |
| `ARTIFACT_TYPE_INVALID` | Missing/unknown artifact discriminator |
| `ARTIFACT_TYPE_MISMATCH` | Declared type conflicts with conventional location |
| `SCHEMA_INVALID` | Artifact metadata violates its JSON schema |
| `ID_INVALID` | Explicit ID is not a portable token |
| `ID_DUPLICATE` | More than one artifact declares the same identity |
| `LINK_INVALID` | Reference is neither a known ID nor a valid relative path |
| `LINK_MISSING` | Artifact target cannot be found |
| `LINK_AMBIGUOUS` | Target ID belongs to multiple artifacts |
| `LINK_TYPE_MISMATCH` | Target is the wrong artifact type |
| `FILE_MISSING` | Referenced file does not exist |
| `FILE_NOT_REGULAR` | File reference points at a directory or special file |
| `SUPERSESSION_SELF` | An artifact supersedes itself |
| `SUPERSESSION_CYCLE` | Supersession declarations form a cycle |
| `INDEX_INVALID` | Core API refuses to write a failed inspection |
| `INDEX_OVERWRITE_REFUSED` | Existing output is not a recognized generated index |

All codes have automated coverage. Case-collision detection is exercised with a portable
path-set test because a normal Windows filesystem cannot create such fixtures. Tests cover
read failures; not every OS-specific permission or disk-failure condition is simulated.
