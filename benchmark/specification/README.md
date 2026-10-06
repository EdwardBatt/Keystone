# Benchmark — Specification

Generic, versioned `keystone-bench` specification formats (ADR-0004; `docs/PHASE-7.md`):
- `schemas/`: JSON Schemas for tasks, conditions, agent profiles, plans, run records, manual
  records, judgements and the scorecard;
- `scorecard.json`: the balanced D24 measure definitions, each labelled by source and scope;
- `conditions/baseline` and `conditions/keystone`: peer reference condition definitions.

Application-specific task content lives with its subject repository, not here.
`keystone-bench validate` checks every specification in this directory.
