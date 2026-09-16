# First Codex Task — Keystone v0.1

## Contract

Read `SPEC.md`, `ARCHITECTURE-DECISIONS.md`, and `AGENTS.md` before changing code.

Treat the specification as the implementation contract. Do not invent additional architecture.
If a material design question is discovered, stop that part of implementation and record a proposed ADR.

## Task

**Scaffold Keystone v0.1 foundation and deterministic index/validation core.**

Implement **Phase 0 and Phase 1 only**.

### Phase 0 — Foundation

- TypeScript/Node package and cross-platform CLI foundation.
- Config handling.
- Markdown/YAML front-matter parser.
- JSON schemas for authoritative artifacts.
- Test fixtures.
- Windows-safe path handling.
- Core logic separated from CLI presentation.
- Stable structured error codes.

### Phase 1 — Index + Validate

- Artifact discovery.
- Stable ID/link graph.
- Deterministic, rebuildable generated index.
- Structural validation for schemas, IDs, links, missing references and supersession.
- Automated tests proving determinism/idempotence and defined validation cases.

## Constraints

- No cloud services.
- No vector database or embeddings.
- No GUI.
- No external memory/knowledge store.
- Every command must be testable without network access.
- Do not silently overwrite project-owned files.
- Do not automatically mutate high-authority ADRs, rules or skills.
- Add tests alongside implementation.
- Preserve Windows 11 compatibility and Unix-like compatibility where feasible.
- Do not implement Phases 2–8 yet.

## Completion report

At completion provide:
1. Files changed/created.
2. Commands to install/build/test.
3. Test results.
4. Validation/error-code coverage.
5. Any proposed ADRs or unresolved issues.
6. Confirmation that no Phase 2+ functionality was implemented.
