# Repository Separation

**Repo A — Keystone:** reusable CLI/framework, schemas, templates, adapters, tests and benchmark specifications/results.

**Repo B — trainer benchmark:** a separate personal-trainer application used as the controlled real-world test subject.

Keystone itself must contain no personal-trainer-specific implementation knowledge.
