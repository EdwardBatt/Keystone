# Repository Separation

**Repo A — Keystone:** reusable CLI and framework, schemas, templates, adapters, tests,
application-free benchmark specifications, experiment plans and results.

**Benchmark subject — `trainer-app`:** a separate personal-trainer application, used as the
controlled real-world test subject.

**Benchmark repository — `trainer-bench`:** the trainer-specific hidden task and evaluation
material for experiments on `trainer-app` (ADR-0004 clarification of 2026-10-06). It is pinned
separately.

Keystone itself must contain no personal-trainer-specific implementation or evaluation knowledge.
