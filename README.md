# Keystone

**v0.1 through Phase 3 — approved architecture baseline, 13 September 2026**

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
Phase 3 adds deterministic START context compilation under ADR-0001. Phase 4 and later,
and `context explain`, remain unimplemented.

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
```

Read [Phase 0/1 usage and error codes](docs/PHASE-0-1.md) for discovery, metadata, link,
and write-protection behavior. See `SPEC.md` and `ARCHITECTURE-DECISIONS.md` for the
approved contract, `FIRST-CODEX-TASK.md` for initial scope, and `SETUP.md` for local setup.
See [Phase 2 usage](docs/PHASE-2.md) for Git-root discovery, initialization preservation,
the config-only `--force` option (which removes custom discovery sources), adapters, and status reporting.
See [Phase 3 implementation contract](docs/PHASE-3.md) for selection, outcomes, budget behavior,
and generated-envelope replacement. START compilation never authorizes implementation.
