# Benchmark — Specification

Generic, versioned `keystone-bench` specification formats (ADR-0004; `docs/PHASE-7.md`):
- `schemas/`: JSON Schemas for tasks, conditions, agent profiles, plans, run records, manual
  records, judgements and the scorecard;
  - version 2 plans, agent profiles, run records and judgements (`*-v2.schema.json`, TASK-0015);
  - locations, analysis specifications, inspection terms, attempt classifications and packet
    releases;
- `scorecard.json`: the balanced D24 measure definitions, each labelled by source and scope;
- `conditions/baseline` and `conditions/keystone`: peer reference condition definitions;
- `inspection/keystone-terms.json`: the generic default packet-inspection terms (Keystone
  identifiers only; experiment-specific terms come from the plan).

Application-specific task content lives with its subject repository, or a separately pinned
benchmark repository (ADR-0004), not here. Experiment plans live under `benchmark/plans/`.
`keystone-bench validate` checks every specification in this directory.
