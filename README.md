# Keystone

**v0.1 scaffold — approved architecture baseline, 13 September 2026**

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

Read `SETUP.md` first, then give `FIRST-CODEX-TASK.md` to Codex.
