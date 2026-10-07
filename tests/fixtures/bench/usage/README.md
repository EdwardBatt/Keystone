# Usage-parser fixtures

`codex-jsonl.synthetic.jsonl` is **SYNTHETIC AND UNVERIFIED**. It was written by hand from the
documented shape of the Codex CLI's `codex exec --json` event stream (TASK-0015 item 2, owner
decision Q4). It was not captured from a real Codex session. It exercises the provisional
`codex-jsonl` mapping offline: `turn.completed` usage, tool-like `item.completed` events, and a
malformed line, which the parser skips.

Before TASK-0015 is accepted, one real Codex CLI parser integration verification (criterion 33)
confirms or corrects the mapping. That verification is never benchmark evidence.
