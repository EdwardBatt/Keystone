# Keystone

**v0.1 through Phase 6 — approved architecture baseline, 13 September 2026**

Keystone is a repo-native context and continuity system for AI-assisted software development.

The repository is the durable project memory. Conversation history is transient. Markdown/YAML
artifacts are authoritative; generated JSON/SQLite state is disposable and rebuildable.

## v0.1 boundaries

- TypeScript / Node.js CLI named `keystone`
- Model-independent protocol with thin Claude, Codex and Gemini adapters
- Deterministic parsing, indexing and structural validation before LLM judgement
- Task-specific context envelopes rather than loading the whole repository
- Controlled learning and evidence-preserving compaction
- No cloud memory service, vector database, embeddings, GUI, Notion or Obsidian dependency

Phase 0/1 implements the configuration/parser/schema foundation, deterministic index,
and structural validation. Phase 2 adds safe initialization and read-only context status.
Phase 3 adds deterministic START context compilation under ADR-0001. Phase 4 adds
`review`, which prepares isolated code/architecture/context review evidence under ADR-0002.
Phase 5 adds `close`, which completes a task after a current three-role `approve` review gate
(or a recorded owner override) and promotes only explicitly requested candidate learnings and
traps. Phase 6 adds `compact`, a read-only compaction report that, given explicit task-bound
operations, retires learnings and traps in place under ADR-0003 while preserving their evidence
and provenance chain. Phase 7 and later, and `context explain`, remain unimplemented.

```powershell
npm ci
npm run build
npm run check
npm test
node dist/cli/index.js init --root "C:\path\to\target" --adapter codex --json
node dist/cli/index.js context status --root "C:\path\to\target" --json
node dist/cli/index.js validate --root "C:\path\to\target" --json
node dist/cli/index.js index --root "C:\path\to\target" --json
node dist/cli/index.js start TASK-0001 --root "C:\path\to\target" --json
node dist/cli/index.js review TASK-0001 --base HEAD --root "C:\path\to\repo" --json
node dist/cli/index.js close TASK-0001 --promote LRN-0001 --root "C:\path\to\repo" --json
node dist/cli/index.js compact --root "C:\path\to\repo" --json
node dist/cli/index.js compact --task TASK-0002 --retire LRN-0001 --reason "Consolidated." --by LRN-0002 --root "C:\path\to\repo" --json
```

Read [Phase 0/1 usage and error codes](docs/PHASE-0-1.md) for discovery, metadata, link,
and write-protection behavior. See `SPEC.md` and `ARCHITECTURE-DECISIONS.md` for the
approved contract, `FIRST-CODEX-TASK.md` for initial scope, and `SETUP.md` for local setup.
See [Phase 2 usage](docs/PHASE-2.md) for Git-root discovery, initialization preservation,
the config-only `--force` option (which removes custom discovery sources), adapters, and status reporting.
See [Phase 4 implementation contract](docs/PHASE-4.md) for review evidence packages; review never
determines a verdict or implementation readiness.
See [Phase 5 implementation contract](docs/PHASE-5.md) for the CLOSE gate, owner override,
controlled promotion and the closure record.
See [Phase 6 implementation contract](docs/PHASE-6.md) for compaction reporting, retirement
checks, binding-removal visibility and the ADR-0003 validation invariants.
See [Phase 3 implementation contract](docs/PHASE-3.md) for selection, outcomes, budget behavior,
and generated-envelope replacement. START compilation never authorizes implementation.
