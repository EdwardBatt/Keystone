# Keystone v0.1 — Project Setup

These instructions assume Windows 11 and PowerShell.

## 1. Prerequisites

Install:
- Git
- Node.js LTS (Node 20+ is suitable for this scaffold)
- A GitHub account
- Codex access in your preferred environment

Confirm:

```powershell
git --version
node --version
npm --version
```

## 2. Create the local project

Extract this ZIP to a permanent development location, for example:

```text
C:\Users\<you>\Documents\Keystone
```

Open PowerShell in that folder.

## 3. Initialize Git

```powershell
git init
git branch -M main
git add .
git commit -m "chore: scaffold Keystone v0.1"
```

## 4. Create the GitHub repository

Create a new **empty** GitHub repository named `keystone`.

Do not initialize it with a README, .gitignore, or license because those files already exist locally.

Then connect the local repository:

```powershell
git remote add origin https://github.com/<YOUR-USERNAME>/keystone.git
git push -u origin main
```

## 5. Install the Node dependencies

```powershell
npm ci
```

Phase 0/1 dependencies are recorded in `package-lock.json`. Installation may require network
access; subsequent CLI commands and tests run offline.

## 6. Open Keystone in your coding environment

Open the repository root — not an individual subfolder.

Before allowing implementation, make sure Codex can see:

- `SPEC.md`
- `ARCHITECTURE-DECISIONS.md`
- `FIRST-CODEX-TASK.md`
- `AGENTS.md`
- the full repository tree

## 7. First Codex run

Give Codex the contents of `FIRST-CODEX-TASK.md`.

Codex is deliberately restricted to **Phase 0 and Phase 1**. Do not ask it to implement the whole
system in one pass.

## 8. Review before accepting changes

For the first implementation pass, verify that Codex:

1. Did not invent architecture outside the approved specification.
2. Kept the CLI TypeScript/Node and cross-platform.
3. Added tests alongside implementation.
4. Kept core logic separate from CLI presentation.
5. Used stable structured error codes.
6. Did not add cloud services, vector search, embeddings or a GUI.
7. Did not silently overwrite authoritative files.
8. Implemented deterministic/rebuildable indexing and structural validation.

Run the implemented checks:

```powershell
npm run build
npm run check
npm test
node dist/cli/index.js validate --root "C:\path\to\target" --json
```

See `docs/PHASE-0-1.md` for implementation documentation on discovery and validation.
`SPEC.md` and `ARCHITECTURE-DECISIONS.md` remain authoritative, and
`FIRST-CODEX-TASK.md` defines the implementation task contract.

## 9. Commit the first implementation phase

Only after tests pass:

```powershell
git status
git add .
git commit -m "TASK-0001: implement Keystone Phase 0 and Phase 1 foundation"
git push
```

## 10. Second repository comes later

The approved architecture uses two repositories:

- **Repo A — Keystone:** this repository, containing the reusable framework.
- **Repo B — trainer benchmark:** the personal-trainer application used to benchmark Keystone.

Do **not** put the trainer application into this repository. Build/scaffold it when the Keystone
foundation is ready for benchmark initialization.

## Working rule

Any material architecture question discovered during implementation must be recorded as a proposed
ADR for approval. It must not be silently resolved by changing the architecture in code.
