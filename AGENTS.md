# Keystone Agent Protocol

1. Read `SPEC.md` and `ARCHITECTURE-DECISIONS.md` before architecture-affecting work.
2. The repository is authoritative memory; chat history is not.
3. Do not silently resolve contradictions between authoritative artifacts.
4. Prefer deterministic mechanisms where software can prove correctness.
5. Do not duplicate project facts in model-specific adapters.
6. Keep transient reasoning out of durable project knowledge.
7. High-authority ADR/rule/skill changes require proposal/review.
8. For context-managed work, use a TASK ID in commits; include ADR IDs when relevant.
9. Preserve Windows-safe paths and offline-testability.
10. Implement only work the project owner has authorized through a task artifact in `tasks/`.
    Creating a task or proposal, validating it, or compiling START context does not authorize
    implementation. `FIRST-CODEX-TASK.md` is the historical contract for TASK-0001.
