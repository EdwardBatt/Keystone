# TASK-0003 — Project onboarding and task-creation UX

**ADOPTED DESIGN RECORD / NON-AUTHORITATIVE — adopted through ADR-0001 after independent review**

Associated task: [TASK-0003](../tasks/TASK-0003-project-onboarding-task-creation-ux.md).
This document records the design analysis that was adopted through
[ADR-0001](../adr/ADR-0001-start-context-eligibility.md). It remains a historical,
non-authoritative proposal: ADR-0001 and SPEC.md are the authority. It does not authorize
implementation beyond the separately scoped Phase 3 task. D03 and D09 remain unchanged.
Trainer examples are fictional UX scenarios, not Keystone or benchmark project facts.

## Basis, inspection and narrowed scope

Inspected SPEC.md, ARCHITECTURE-DECISIONS.md, AGENTS.md, TASK-0003, managed artifact schemas,
templates, discovery/graph/init behavior, fixtures and the previous proposal. At the time of the original TASK-0003 inspection/design analysis, there was no project
adr directory. The frozen decision table is the architectural baseline; fixtures are not approvals.

- [Discovery](../src/parser/discovery.ts) validates/indexes typed artifacts without approval
  filtering. Status fields remain open-ended strings.
- The [ADR template](../templates/adr.md) uses proposed; fixtures include accepted/superseded.
  Learning uses candidate; project, feature and trap templates use active. These establish
  neither a universal lifecycle nor an exhaustive approved START policy.
- [Graph links](../src/graph/index.ts) establish relationships, not authority. File links must
  exist. Supersession semantics are ADR-specific.
- [Init](../src/commands/init.ts) preserves project documents and validates at the end.
  Config-only force cannot repair/overwrite an ordinary PROJECT.md.
- Task metadata requires type/version/ID/title/status, not a feature or every template heading.
  TASKS.md is not automatically reconciled.

**The main gap was START eligibility, not the onboarding interview.** The narrow Phase 3
contract is now adopted by ADR-0001; full authoring automation remains deferred. This record
has completed independent review and adoption. The task artifact remains a historical design
task record; ADR-0001 and SPEC.md carry the authoritative decision.

“Proposed policy” below means a concrete recommendation requiring explicit approval, not an
assertion that permissive schemas or current implementation already enforce it.

## 1. Features: preferred and optional

**Problem:** stable middle context is useful without forcing maintenance into artificial buckets.

| Alternative | Advantage | Disadvantage / compatibility |
|---|---|---|
| Mandatory hierarchy | Uniform navigation | Artificial ownership; violates D03/SPEC principle 8 |
| Flat project/tasks only | Minimal setup | Underuses D04 boundaries at scale |
| Preferred optional features | Useful middle layer without forced classification | Must handle absent/multiple features; recommended |

PROJECT → optional FEATURES → TASKS is navigation through a graph. Featureless/cross-cutting tasks
are valid. Relevant ADR/rule/skill/learning/trap/file links do not imply scope or authority.
No miscellaneous feature is required. **Impact:** START selection clarification; D03 unchanged.

## 2. Feature-map creation and evolution

**Problem:** manual documents burden users; a comprehensive invented roadmap creates requirements.

Manual authoring gives explicit choices but clerical overhead. Automatic roadmap expansion looks
complete but risks unsupported commitments. **Recommend** a small map of supported capabilities,
evolving with actual work under D02–D04.

Purely organizational grouping can proceed within existing authorization. Confirm grouping only
when it creates consequential scope, ownership or architectural commitments. A feature mention
does not authorize its interfaces, permissions or acceptance criteria. Unknowns remain unknown.

Preserve stable identity while boundaries remain meaningful. Propose consequential splits/merges
with affected references; do not rewrite completed task history or introduce feature supersession.
**Impact:** authoring guidance/SPEC clarification, not new schema requirements.

## 3. Provenance, authority and authorization

**Problem:** a valid inference can be presented as an approved fact. Treating indexed text as
accepted violates D01/D20; approval records per sentence create unnecessary governance burden.

**Recommend** three separate questions:

1. What supports this statement: user instruction, approved document, inspected code/test,
   or inference? Supply supporting references where applicable.
2. What role may it play: requirement within its scope, observation, unresolved proposal,
   or unknown? Existing behavior is not necessarily intended future behavior.
3. What change did the user/applicable reviewer authorize: faithful task capture, investigation,
   scoped project edits, or a separately reviewed high-authority decision?

Material additions need concise change summaries and supporting references. No mandatory
per-sentence records, governance database, transcripts or private reasoning. An authorized review
task does not approve its subject. An accepted task cannot silently amend an ADR or out-of-scope
project requirement. Authorization is scoped; confidence is not authorization.

**Deterministic validation cannot prove semantic faithfulness.** A model can misstate intent in
valid content. Review of material changes and existing agent rules address that risk; the compiler
cannot certify every semantic assertion. **Impact:** clarify D01/D15/D20 practice, not a new engine.

## 4. Proposal lifecycle: inventory is not binding context

**Problem:** making all indexed content binding approves proposals; excluding every proposal
prevents legitimate review and breaks the existing typed ADR workflow.

**Recommend** preserving inventory and classifying START use separately:

- Known artifact: identity, structure and relationships, not approval.
- Binding context: applicable requirements within the source's authorized remit.
- Non-binding material: observations, procedures/evidence, history and explicitly relevant
  proposals. Relevance and retention priority are not authority.

| Before acceptance | Recommended behavior |
|---|---|
| Validation | Typed proposed ADRs stay discoverable and subject to existing schema/ID/link checks. Free-form notes need not pretend to be typed artifacts. |
| Indexes | Discovered valid typed proposals stay indexed; no approval meaning or Phase 0/1 filtering change. |
| START | Explicitly relevant proposals may appear as labelled review material, never constraints. Unrelated proposals are not selected. |
| Validation effects | Duplicate IDs/broken links in discovered proposals still matter. Proposed requirements do not become validation rules for other artifacts. |
| References | Accepted artifacts may reference proposals for review/history/evidence. A claimed implementation dependency on an unaccepted decision is unresolved, not approved. |
| Acceptance | Existing authorized edits and applicable review establish decisions; indexing, moving, copying or status text alone does not perform approval. |

No mandatory proposal directory or migration. Typed proposed ADRs can stay in adr; notes can
stay in docs. Custom discovery and file links confer no authority. **Impact:** approve section 11's
narrow START policy, not a general lifecycle engine or generic status interpretation.

## 5. Material ambiguity and confirmation

**Problem:** every-edit confirmation creates overhead; model-confidence approval guesses intent.
**Recommend** observable consequences under existing authority rules.

| Situation | Criterion | Action |
|---|---|---|
| Harmless discretion | Alternatives preserve authorized behavior, scope, acceptance and constraints | Choose and proceed |
| Consequential ambiguity | Interpretations change actors, permissions, outputs, data handling, scope or completion conditions | Ask the smallest resolving question |
| Architectural decision | Changes an approved decision, durable interface, responsibility boundary or high-authority constraint | Existing proposal/review process |
| Unknown requirement | No supporting instruction/approved source exists | Leave unknown; ask only when current work depends on it |

Reuse prior authorization; faithful capture needs no second task-document approval. High-authority
review still applies to unambiguous requests. Bundle questions, continue independent investigation,
and wait on materially dependent implementation. Silence is not approval.

Software detects structural failures but cannot reliably determine that natural-language ambiguity
is harmless; host/reviewer judgment remains necessary. **Impact:** clarification, not an approval registry.

## 6. Natural-language requests and minimum meaningful tasks

**Problem:** manual YAML burdens users; unchecked model-written tasks risk invented scope.
**Recommend** human/assistant preparation of ordinary scoped repository edits, followed by existing
deterministic validation, rather than a generic candidate/application system.

A meaningful implementation task contains concisely:

- intended outcome;
- enough scope/context to identify the change;
- observable completion condition;
- relevant constraints/references where they exist;
- explicit blocking unknowns where applicable.

These are semantic guidance, not new mandatory headings or schema fields. Keep required metadata.
Featureless/cross-cutting tasks are valid. Link existing files; describe planned files in prose.
A blocked task may authorize investigation, not implementation dependent on unanswered questions.

Read applicable context, inspect actual overlap, clarify consequential gaps, prepare authorized
edits and validate. Reuse only within an existing task's authorized scope. Do not silently enlarge
or reopen historical work; similar wording does not establish identity.

**Impact:** no new schema/CLI prerequisite. Add a narrow task-create helper later only if repeated
ID/serialization work justifies it; settle collision/retry behavior with that command's contract.

## 7. Trivial work

**Problem:** full-template ceremony for a typo is disproportionate; task-free managed changes
weaken traceability. **Recommend** minimal tasks or appropriate existing tasks under D05/D22.

A concise objective and completion condition can suffice. Let the assistant handle representation,
without a mandatory feature or field-by-field approval. Read-only exploration need not itself
create a development task. Small edits can still involve consequential ambiguity. Unmanaged edits
are not retroactively claimed to have used Keystone context. **Impact:** no D22 amendment recommended.

## 8. Individual task files own facts; defer TASKS.md automation

**Problem:** duplicate writable facts invite drift and synchronization complexity.

| Alternative | Advantage | Disadvantage / compatibility |
|---|---|---|
| Task and inventory both own facts | Flexible editing | Conflicting authority; poor fit with D01 |
| Manual inventory, task files own facts | No new machinery | Navigation may become stale; recommended now |
| Explicitly adopted whole-file generation | Simple deterministic projection | Preserve existing prose/approve migration; preferred later |
| Managed sections | Keeps inline prose | Marker/merge/ownership/recovery complexity; only if that need is established |

Individual TASK-#### files own identity, scope, acceptance and lifecycle facts. TASKS.md is
inventory/projection. START reads individual tasks independent of TASKS.md freshness/existence.
Inventory rows and feature Active Tasks lists do not update task facts. No automation/migration
is part of this task or a Phase 3 prerequisite.

Later, prefer explicitly adopted whole-file generation; preserve unowned files until an approved
migration. Filename alone grants no ownership. Consider sections only if inline prose preservation
is demonstrated necessary. **Impact:** approve D01/D05 task-fact clarification for START; future
generation needs explicit D05/D16 clarification/ADR if material. TASKS.md is not declared disposable now.

## 9. Onboarding stays separate from init

**Problem:** establishing intent differs from installing scaffolding. An interview inside init
changes established behavior; a dedicated onboard command needs a real interaction/recovery
contract. **Recommend** a separate host workflow using ordinary edits first.

Greenfield starts with natural-language purpose/users/outcomes and retains unknowns. Existing
repositories require targeted read-only inspection of approved documents and relevant code/tests.
Use concise material references, not exhaustive evidence ledgers. Code describes observed behavior,
not necessarily required architecture. Incomplete documentation does not license invented facts.
Onboarding may finish with nonblocking unknowns.

Init remains safe setup, not proof of a complete brief. Do not silently initialize Git, reset
custom sources or broaden config-only force.

**PROJECT.md collision/recovery:** preserve an ordinary PROJECT.md lacking Keystone metadata;
report the mismatch; propose a compatible adaptation under existing authorization; validate after
approved adaptation. Do not claim success while validation fails or use force to overwrite it.
Init may already have created other complete scaffold files: report partial state and retry after
recovery. TASKS migration is not required.

**Impact:** preserve Phase 2. Add onboard only when its concrete interaction/recovery contract
justifies it; neither that command nor automated onboarding is needed for Phase 3.

## 10. One model-independent authoring protocol

**Problem:** mandatory hosted models couple the core; a generic plan/apply platform adds unproven
machinery. **Recommend:** read context → interpret intent → resolve consequential unknowns →
prepare scoped ordinary edits → apply within authorization → validate → report.

Humans, local models or optional hosted assistants can follow this procedure. Thin adapters refer
to shared protocol and repository facts. Material additions need concise summaries/support, not
standalone proposals for every ordinary edit. ADR/rule/skill changes retain required review.

Separate proposal storage, candidate interchange, plan/apply, source-version machinery, retry
identity, approval registries and generic application engines are not Phase 3 prerequisites.
Ordinary careful editing under the stable-working-tree assumption suffices initially. Later
automated operations may justify stronger recovery contracts, not vice versa.
**Impact:** preserve D08/D15/D18/D25; approve new automation contracts separately if justified.

## 11. Proposed minimum START contract — the actual Phase 3 prerequisite

This replaces the deferred eligibility question with concrete recommendations for approval.
The mappings are a small type-specific selection policy, not a universal lifecycle or proof that
content was honestly approved. Existing governance controls authorship.

### 11.1 Input authority and configured discovery

START remains `keystone start <TASK-ID>`. Individual task files supply task facts; TASKS.md
freshness/existence never controls them. Recompute inventory in memory or verify disposable caches
against sources. Deleting generated state must not prevent compilation.

**Configured/discovered inventory controls authoritative artifact selection.** Conventional paths
do not override explicit discovery. Select PROJECT.md only if it is in that inventory; otherwise
use a sole discovered project artifact. Multiple discovered projects are incomplete/conflicted,
not a filename-based choice. No discovered project means mandatory project context is unavailable.
Do not inspect excluded conventional files to resurrect their contents. Default discovery may
include conventional paths when configuration has not overridden it.

Explicit ordinary file references remain evidence/review inputs under existing path checks, not
an alternative authoritative discovery channel. If such a reference identifies an excluded managed
artifact, do not admit it as binding through the file path. Report unavailable mandatory context
when binding context depends on it. Discovery, structural validity, links and index membership
are not approval operations. Existing outside-envelope agent instructions remain in force; this
does not authorize START to scan outside configured discovery for additional binding artifacts.

The root task defines the requested scope, not approval of every proposal it discusses. Any valid
root task status may be compiled for inspection/review, with its actual status visibly preserved.
START never mutates status, reopens work or infers implementation authorization from success.

### 11.2 Artifact-specific roles and unknown states

| Type | Binding-capable or supporting use on an independently eligible path | Non-binding/uncertain treatment |
|---|---|---|
| Task | Root supplies recorded scope at Tier 0; other tasks are dependencies/history | Other tasks cannot expand root scope. Non-active root status remains visible and permits inspection, not implementation authorization. |
| Project | Active project supplies its established requirements/constraints at Tier 0 | Internal observations/proposals/unknowns retain their roles. Other authority states cannot supply binding project context without resolution. |
| Feature | Active features supply established applicable boundary constraints | Proposed/unknown states are non-binding; no feature is mandatory. |
| ADR | Accepted ADR supplies applicable effective decision under 11.4 | Proposed is review material. Superseded is historical previously accepted context for replacement traversal, not a current binding decision. Unknown states are not accepted. |
| Rule | Established plain rules or typed rules without status retain D07 authority; active typed rules are current | Draft/proposed or unknown states do not automatically bind. Ingestion itself never approves a rule. |
| Skill | Established plain/typed-without-status or active skills supply procedures, normally Tier 2 | Procedures cannot create architectural requirements. Proposed/unknown states remain non-binding. |
| Learning | Accepted learnings supply supporting knowledge at Tier 2 | Candidate is unverified material, not an accepted lesson or rule. Other states do not mean accepted. |
| Trap | Active traps supply applicable failure evidence/avoidance, not amendments to ADRs/rules | Proposed/unknown authority states are non-binding. Severity governs retention, not authority; see 11.5. |

These exact type-specific mappings are proposed for approval, not inferred from a generic enum.
No schema changes or Phase 0/1 lifecycle filtering. Structurally valid unknown states remain in
inventory. Directly relevant unknown-state artifacts are labelled non-binding and diagnosed.
When unresolved authority is needed to establish binding context, the outcome is incomplete/
conflicted. A merely inspected unknown-state review subject need not make unrelated binding context
incomplete: its known review role and unknown state must both be represented explicitly.

The superseded-ADR interpretation is deliberately type-specific and subject to approval. No
acceptance meaning is assigned to a task's completed status or any arbitrary string elsewhere.
Current project/task bodies preserve their internal role labels. The compiler cannot prove semantic
faithfulness; existing authorization and review govern source edits.

### 11.3 Role-aware traversal and deduplication

**A non-binding or unknown-eligibility artifact MUST NOT establish binding applicability through
its outgoing relationships.** A descendant being accepted elsewhere is insufficient. Every selection
reason retains the role of the path establishing applicability; reading a proposal cannot approve
its proposed feature, rule, decision, learning or trap associations.

For the initial bounded policy:
- Root-task relationships establish requested relevance, subject to each target's authority and
  the task's scope; they do not approve target contents. Eligible project/current-feature paths
  may establish binding applicability within their remit.
- Directly requested review nodes may expose one hop of their existing supported relationships
  as non-binding supporting review material at Tier 2. No further expansion from those descendants.
  Show relation/source labels. Indirect proposal nodes encountered along ordinary selection receive
  diagnostics/relationship entries, not unrestricted review-tree expansion.
- Review-only or unknown-eligibility feature dependencies, project/feature links, ADR/rule links,
  reverse associations, learning/trap matches and replacement edges cannot introduce binding context.
  Do not use a review-only feature or its files as an eligible anchor for automatic reverse selection.
- A separate eligible path may independently establish the same descendant's binding applicability.
  Combine reasons and retain the strongest independently established eligible role and most protective
  tier. Review reachability alone never upgrades authority. An unresolved replacement conflict is
  an authority restriction, not something another duplicate link can override.
- Supporting skills, learnings, traps and historical tasks do not recursively introduce new binding
  requirements. The root task's role as a scope anchor is distinct from supporting/review-only tasks.

Examples:
1. Root reviews proposed F; F links accepted A. F and A are non-binding on this path. A may appear
   in the bounded one-hop supporting review material, labelled accordingly.
2. The same root also independently selects A through an eligible task ADR relationship. A can
   bind through that independent path; F has not approved or made A applicable.
3. Deduplicate A to one content unit, retain both reasons, and show its binding role with the
   independent binding reason. Do not discard provenance or multiply its token allocation.

This is a small selection-path rule, not a general authority engine or approval registry.

### 11.4 Whole-artifact ADR replacement resolution

The following algorithm applies only to ADRs already selected through an eligible binding path.
For review-only selection, replacement relationships remain review/history and cannot produce
a binding endpoint. All examined ADRs must come from the configured inventory.

1. **Normalize:** B.supersedes=[A] and A.superseded_by=[B] both represent A → B (older → newer).
   Union/deduplicate relationships, preserving which artifact asserted each edge. Either valid
   one-sided declaration suffices; reciprocal metadata is not required. Existing structural
   validation still rejects missing/wrong-type targets, self-links and cycles.
2. **Qualify edges:** binding replacement traversal uses only edges supported by an accepted or
   historical superseded ADR declaration, between ADRs with accepted/superseded authority states.
   Thus a proposed declarer cannot establish replacement applicability; a proposed or unknown-state
   successor cannot replace an accepted ADR. Preserve excluded relationships as non-binding evidence.
   An unknown-state successor relevant to resolving the effective decision causes incomplete context;
   a clearly proposed successor by itself does not retire A or prevent A remaining effective.
3. **Traverse history:** starting from the selected accepted/superseded ADR, traverse qualified
   outgoing edges through accepted or historical superseded intermediates. Superseded means
   previously accepted history for this ADR-only contract. Historical nodes do not bind.
4. **Unique chain:** every reached node must have at most one distinct qualified successor.
   Any branching is unresolved, even if branches later reconverge; do not invent a precedence rule.
   The unique terminal must be accepted. A terminal marked superseded has no effective accepted
   endpoint and is incomplete/conflicted. An accepted start with no qualified successor is its
   own endpoint, unless unresolved authority prevents determining that fact.
5. **Effective decision:** only the unique accepted endpoint imposes the replacement decision.
   Replacement is whole-artifact, not paragraph-level merging. Predecessors are provenance/history,
   not simultaneously binding obsolete decisions. Preserve compact chain references in the envelope;
   history bodies are Tier 3 unless independently requested for review.
6. **Conflict:** competing qualified successors, no unique accepted endpoint, incompatible branches
   or other unresolved replacement authority produce an incomplete/conflicted outcome and explicit
   diagnostic. Include the affected chain and competing decisions as labelled conflicted/non-binding
   inspection material, retaining enough whole bodies at the originating mandatory tier to inspect
   the conflict. No winner by filename, ID, timestamps, order or majority. Do not bind all competitors.
   Other independently unconflicted constraints remain represented with their established roles.
   Structural cycles/missing targets remain failed outcomes under existing validation, not this
   semantic-conflict path.

Examples (arrows are normalized older → newer):
- A → B → C, with historical A/B and accepted C: selecting A resolves through B to C. If predecessors
  still say accepted but form the same single accepted chain, explicit replacement edges make C
  effective; A/B remain history. No reciprocal declarations or status rewrites are needed.
- Accepted A → proposed B: A remains effective; B cannot retire it. B appears as review material only
  when selected by the review rules, not as an automatic binding successor.
- Accepted B and accepted C both supersede A: unresolved branch. A/B/C are visible as conflicted/
  non-binding decisions; result incomplete/conflicted, not a pair of simultaneous binding decisions.
- Only accepted B.supersedes=[A]: normalized A → B suffices; B is effective.
- Only accepted or historical A.superseded_by=[B], with accepted B: the same A → B suffices.
- A → B(superseded) with no accepted endpoint: incomplete/conflicted, not revival of A by guessing.

This changes no Phase 1 graph checks and creates no universal supersession semantics. The authority
interpretation and whole-artifact replacement rule are explicit architectural approval items.

### 11.5 Final bounded selection mappings

All selections below respect 11.1–11.4. No whole-connected-graph traversal.

**Mandatory project and always-load context.** Tier 0 includes the root task and the sole eligible
discovered project body. Full project inclusion avoids inferring which sentences are critical;
embedded unknowns/proposals keep their labels. No project or unresolved project authority means
incomplete/conflicted, not invented context. Recommend only the eligible project's key_rules as
the explicit always-load rule selector, plus discovered rules/GLOBAL.md under conventional default
discovery. Other project rules references are relevant Tier 1 rules, not automatically Tier 0.
GLOBAL.md is not an implicit mandatory slot when explicit sources override default discovery.
If an explicitly named mandatory selector cannot resolve, preserve existing structural failure;
if mandatory project context is excluded/absent, report incomplete/conflicted without loading it.
Do not make every discovered rule/artifact always-load. Eligibility of the selecting project and
rule is required independently. Unknown-state mandatory rule targets are diagnosed and incomplete.

**Features and dependencies.** Direct feature selection is the union of root feature/features
relationships. Eligible boundaries are Tier 1; featureless/cross-cutting tasks remain valid.
Follow depends_on transitively only through eligible feature paths, with cycle control, for Tier 2
dependency boundaries. Review paths obey the one-hop rule. Never reverse-select additional features
from tasks fields or scan the project's whole feature catalog/Active Tasks headings.

**ADR/rule/skill links.** Resolve adrs/key_adrs, rules/key_rules and skills on root, eligible project
and eligible selected features. Direct applicable ADR decisions/rules are Tier 1; skills Tier 2.
Dependency-feature constraints are Tier 2 unless independently selected directly/globally.
Replacement resolution is the sole additional ADR expansion; review-only paths cannot use it
to establish binding decisions.

**Related tasks.** Root depends_on follows transitive task dependencies at Tier 2 with cycle control.
Do not import their feature/ADR/file neighborhoods. Root tasks links identify Tier 3 related/history
material without recursion. Excerpts obey whole-body fallback below. Actual status is always visible.

**Bounded reverse associations.** Accepted learnings and active traps may match their explicit tasks
references to the root, or features references to an eligible direct root feature. Traps may also
match their files against explicit root file targets. Normalize references using existing resolved
identity/path semantics. No match through dependency tasks, review-only features, arbitrary shared
neighbors or transitive reverse closure. A reverse match establishes relevance only, never approval.
Candidate/unknown-state reverse matches are not automatic binding/supporting lessons. Directly
requested such artifacts remain available for labelled review. No automatic reverse feature selection.

**Severity evidence and final recommendation.** Current common.schema.json permits an arbitrary
severity string. The trap template and valid trap fixture use medium. Neither high nor critical
is enumerated or exemplified in current schemas/templates/fixtures. Therefore withdraw the previous
high/critical threshold: do not pretend those values are an established vocabulary.
For this first contract recommend: relevant active medium traps are Tier 2; absent or any other
severity is unclassified, diagnosed, and retained as non-binding Tier 1 inspection material with an
incomplete outcome until severity can be interpreted. This is protective retention of uncertainty,
not classification as severe, high authority or a new rule. There is currently no positively known
severe value to automatically classify; the inspectable fallback prevents a potentially severe trap
silently disappearing. Adopting a richer severity vocabulary later requires explicit clarification,
not a schema enum introduced by the implementer. Only relevant traps qualify for this fallback;
unknown severity elsewhere in inventory does not expand every task's envelope.

**Review retention and ordinary files.** Direct root relationships to typed proposed/candidate/
unknown-state artifacts, including known typed file aliases, select Tier 1 non-binding review
material. No prose-title classifier or new review command is needed. Ordinary root files references,
including untyped Markdown, are Tier 3 evidence: withdraw blanket Markdown Tier 1 promotion.
Always retain a compact record of their explicit relevance/path and any body omission. A plain
proposal body can therefore be omitted under budget, but cannot be silently omitted or promoted;
the root task and explicit reference remain visible for inspection. If the host knows this omitted
body is essential for the intended review, it must fetch/review it before claiming review completion.
No existing SPEC guarantee makes every untyped Markdown file mandatory. No new relationship/schema
field is introduced. File references cannot bypass configured authoritative discovery.

**Deduplication and ordering.** Retain every independent reason, strongest independently established
role and most protective applicable tier, subject to unresolved-conflict restrictions. Use stable
tier/role/type/identity ordering. Exact identity/path mechanics are implementation-contract matters;
multiple paths must not cause role loss, authority promotion or nondeterministic output.

### 11.6 Lossless content fallback

Semantic sections may be preferred where safely identifiable, but managed Markdown need not follow
template headings. A valid ADR without Decision or Constraints is not a decision with no content.
Use the **whole Markdown body** whenever an expected section cannot safely be identified, including
missing/ambiguous headings or an unsafe partial extraction. Apply the same rule to feature boundaries,
task dependency summaries, rule/skill/learning/trap excerpts and other managed Markdown selection.
Preserve metadata needed for identity, status and role separately; fallback is not loss of metadata.

At Tier 0/1, required content must not silently disappear because of excerpt heuristics or budget.
When there is doubt whether a preferred excerpt preserves required context, include the whole body.
No new mandatory headings or schema changes. Exact boundary/duplicate-heading mechanics belong to
the Phase 3 implementation contract and tests; they must obey this fallback guarantee.

### 11.7 Three semantic compilation outcomes

| Outcome | Meaning and required behavior |
|---|---|
| complete | Structural compilation succeeded and no unresolved context condition prevents representing the selected context under this contract. Budgeted Tier 2/3 omissions are listed. This does NOT mean implementation ready or authorized. |
| incomplete/conflicted | Inspectable context can be produced, but mandatory context is unavailable, authority/replacement is unresolved, severity cannot be interpreted, or comparable uncertainty remains. Preserve evidence, role labels and diagnostics; do not present a winner or claim readiness. |
| failed | Structural/input failure prevents a valid usable envelope: invalid metadata, duplicate IDs, broken required references, unsafe/unreadable inputs or structural supersession cycles, under existing checks. Report the failure; do not label invalid output successful. |

Known incompleteness is surfaced even where a host, rather than structural software, identifies the
semantic issue. The compiler cannot prove the absence of all hidden semantic contradictions. Success
never decides whether a user authorized implementation. Non-active roots are inspectable without
status mutation. Absent optional features, TASKS.md or generated indexes do not cause failure.

Incomplete/conflicted output must remain inspectable. Phase 3 must specify whether and how each
outcome replaces an existing generated envelope atomically. Failed builds must not destroy the last
valid envelope or misidentify it as current output for the failed request. An incomplete envelope,
if installed as current, must visibly retain that outcome. Exact exit codes, serialization and
diagnostic identifiers belong to the implementation contract. No approval registry.

### 11.8 Output guarantees and implementation mechanics

Context is disposable and rebuildable from identical authoritative inputs/configuration. Preserve
source Markdown/YAML bytes. Keep SPEC's 8,000 estimated-token target and Tier 0/1 retention guarantees;
expand and explain rather than silently drop mandatory context. Deduplication cannot weaken the
strongest independently established role. Budget behavior must be reproducible and inspectable,
with omissions and reasons. The deterministic compiler uses no model-generated summaries.

Phase 3 must specify/test exact excerpt boundaries, duplicate headings, path normalization, ID/path
deduplication mechanics, estimator, serialization, diagnostic identifiers and oversized Tier 2
packing strategy. These are implementation-contract choices within the architectural guarantees,
not reasons to design another authority system.

### 11.9 Narrow gate and deferrals

Approve the explicit semantics above before implementing START. D03 remains optional features and
D09 remains deterministic task-ID-based compilation. No new authoring/lifecycle implementation is
authorized by this proposal. General proposal lifecycle engines, onboarding/task-create commands,
approval registries, TASKS migration/generation and generic application engines remain beyond the
Phase 3 prerequisite, as do candidate interchange, separate proposal storage, plan/apply and
source-version/retry machinery.

## Concrete walkthroughs

### A. Greenfield trainer application

“An app for independent trainers to manage clients and assign training plans. Clients see their
own plans. Start with a web app.” Summarize exactly that. Organize client management/training plans
without extra approval if grouping is harmless; confirm consequential ownership/scope choices.
Account provisioning remains unknown. Prepare authorized ordinary PROJECT/feature edits and
validate. No schema interview or new command. A bare “trainer app” needs clarification of users
and first outcome before those capabilities can be asserted.

### B. Existing substantial repository

Inspect approved documents and relevant code/tests. Show a brief supported map; separate observed
behavior from intended policy. Missing docs do not license guesses. Preserve an ordinary PROJECT.md
without Keystone metadata, report mismatch, propose adaptation and validate after authorization.
Init without force may fill missing scaffold but cannot fix that document: report partial progress,
not success. Do not require TASKS migration or reset custom sources. Keep material contradictions visible.

### C. “Add trainer invitations”

Reuse settled policy. With only A's context, ask whether trainers invite clients or other trainers;
roles and permissions differ. If the answer specifies client invitations by shareable link and no
email integration, capture that scope and observable criteria. Clarify consequential missing access/
lifetime policy only when needed, not every implementation parameter. Prepare an ordinary valid task.
START later compiles by ID. A linked proposed ADR is review material, not permission to implement its
access model; dependent implementation waits where necessary.

### D. Login-button typo

If “Logni” clearly should be “Login,” use a minimal task or in-scope active task: correct the label;
completion means intended copy appears and behavior is unchanged. No feature/full form/extra prompt.
Do not reopen completed work. Ask only about consequential uncertainty. Hide artifact mechanics.

### E. “Let trainers access all clients”

Existing policy limits access to assigned clients. Ask which population and whether policy should
change. A task/ADR relationship does not approve broadening access. START can include the accepted
restriction and directly linked proposed change in distinct roles for review, without erasing the
restriction. Continue investigation; await the material answer and required high-authority review
before dependent implementation. Silence is not approval.

## Ordinary developer experience

“Here is what I am building” or “Understand this repo” yields a short supported brief, not a form.
“Add trainer invitations” yields the smallest necessary question, then scoped task capture.
“Fix the typo” normally proceeds under a minimal task. Show outcomes, material boundaries and
unresolved choices; keep IDs available without making users manage document mechanics.

The current CLI does not offer standalone conversational onboarding. Human/local assistance works;
hosted services are optional. Phase 3 remains unimplemented.

## Review disposition and proposed acceptance scenarios

The earlier settled directions remain: separate support/role/authorization; individual-task fact
authority; optional features; scoped confirmation; lightweight tasks; preserved PROJECT.md collision
recovery; ordinary model-independent authoring; deferred authoring machinery. This revision changes
only the remaining START contract and its approval/test package.

| Second-review finding | Resolution proposed |
|---|---|
| B1 role lost through traversal | 11.3 retains path roles; review-only descendants cannot bind without an independent eligible path. |
| B2 ADR effective endpoint undefined | 11.4 normalizes both directions, permits one-sided declarations, traverses history, resolves a unique accepted whole-artifact endpoint or reports visible conflict. |
| I1 missing headings lose content | 11.6 requires whole-body fallback without schema/heading mandates. |
| I2 configured/conventional precedence | 11.1 makes discovered inventory controlling; excluded files cannot be silently resurrected. |
| I3 incomplete result contract | 11.7 defines complete, incomplete/conflicted and failed; write/exit mechanics assigned to Phase 3. |
| I4 unresolved selector recommendations | 11.5 gives final recommendations, withdraws unsupported severity vocabulary and blanket Markdown Tier 1 retention. |
| M1 byte-level mechanics | 11.8 assigns deterministic mechanics to implementation contract/tests, preserving architectural guarantees. |

Future acceptance scenarios, not tests implemented by this revision:

1. Proposed feature F links accepted ADR A: reached solely through F, A is non-binding review
   material, never a binding requirement.
2. Root independently selects A through an eligible path as well: one deduplicated A has binding
   role through that independent reason; the review reason is retained.
3. Accepted/historical A → B → accepted C resolves to C as the only effective binding decision;
   A/B remain provenance/history, not simultaneous obsolete constraints.
4. Accepted B and C both replace A: incomplete/conflicted output shows the competing decisions
   as conflicted/non-binding, with no order/ID-based winner. Reconvergence does not erase the conflict.
5. Proposed B replacing accepted A does not retire A; B is review-only when explicitly relevant.
6. One-sided supersedes and one-sided superseded_by produce identical normalized replacement
   relationships and effective endpoints; reciprocal metadata is not required.
7. Valid ADR without Decision/Constraints uses its whole body. Equivalent fallback applies to
   all managed excerpts, including ambiguous headings, with Tier 0/1 content preserved.
8. PROJECT.md or GLOBAL.md excluded by configured discovery is not silently loaded. Missing
   mandatory project/declared mandatory context is diagnosed with the appropriate incomplete or
   structurally failed outcome, without undoing current discovery guarantees.
9. Directly relevant unknown-state artifact stays non-binding and diagnosed. If needed to establish
   binding context, the outcome is incomplete/conflicted; mere inventory presence changes nothing.
10. A valid non-active root task compiles for inspection, preserving status, without reopening it,
    mutating sources or authorizing implementation.
11. Complete, incomplete/conflicted and failed are observably distinct. Incomplete output remains
    inspectable; a failed build does not destroy or pass off the prior envelope as current success.
12. Relevant medium trap is Tier 2; unknown severity is unclassified/non-binding Tier 1 inspection
    material and diagnosed incomplete, not silently mapped to high authority.
13. A directly linked untyped Markdown file is Tier 3 with visible reference/omission reporting;
    directly linked typed proposals remain Tier 1 non-binding review material.
14. Typed proposed ADR stays indexed/validated; invalid discovered proposal links/IDs still fail
    structural checks. Featureless/cross-cutting tasks compile and stale TASKS does not control facts.
15. Reverse matches are bounded to eligible task-relevant anchors, not proposed feature neighborhoods.
    Duplicate reachability preserves role and reason without multiplying content.
16. Identical source/configuration inputs yield deterministic output, generated-state deletion permits
    rebuild, sources remain unchanged, and Tier 0/1 budget overflow expands visibly.

## Approval package and remaining decisions

### Architectural decisions now proposed for approval

Approve the following concrete START semantics as a focused contract, not a general governance system:

- Configured inventory controls authoritative inputs; individual tasks own task facts, and conventional
  paths do not override explicit discovery or revive excluded binding context.
- Artifact-specific authority mapping and role-aware paths; non-binding traversal cannot establish
  binding descendants, while independent eligible paths survive deduplication.
- Whole-artifact ADR replacement with normalized one-sided declarations, historical traversal,
  a unique accepted endpoint and explicitly non-binding conflicted output instead of arbitrary winners.
- Whole-body fallback for managed Markdown whenever semantic extraction is unsafe.
- Sole eligible discovered project body at Tier 0; eligible project key_rules as always-load selectors,
  plus discovered GLOBAL.md only under default discovery. Other project rules are Tier 1.
- Bounded eligible feature/task dependency traversal and task/direct-eligible-feature reverse matching.
- Medium as the only evidenced trap severity mapping (Tier 2), all other/missing severity unclassified
  with protective non-binding inspection and incomplete outcome; no assumed high/critical vocabulary.
- Direct typed proposals/unknown-state subjects retained as non-binding Tier 1; ordinary file evidence,
  including untyped Markdown, Tier 3 with visible references/omissions.
- Unknown authority states never silently bind; non-active task roots permit inspection only.
- Complete, incomplete/conflicted and failed outcomes; no outcome asserts implementation authorization.
- Deterministic rebuildability, source preservation, strongest independently established role and
  mandatory Tier 0/1 retention under budget pressure.

These recommendations closed the previously open choices and were adopted through ADR-0001 after
independent review. They describe the architectural contract; implementation authorization remains
limited to the separately scoped Phase 3 task. No unresolved choice is deliberately delegated to
coding about who/what becomes binding.

### Deferred Phase 3 implementation contract

Specify and test exact excerpt boundaries and duplicate-heading fallback, path/reference normalization,
ID/path deduplication mechanics, estimator, serialization, diagnostic identifiers, exit codes, oversized
Tier 2 packing, and atomic generated-envelope replacement behavior for each semantic outcome.
They must preserve the guarantees above, but do not require another architectural redesign.

### Still deferred beyond Phase 3

Onboarding/task-create commands; general proposal lifecycle/application engines; approval registries;
TASKS automation/migration; candidate interchange; separate proposal storage; generic plan/apply;
source-version and retry-identity machinery. Future TASKS generation requires explicit D05/D16
ownership/disposability and migration clarification; it is not part of this gate.

### Governance and readiness

D03 and D09 require no amendment. The adopted clarification of D01/D05/D06/D07/D15/D16/D17/D20
application to START is recorded authoritatively in ADR-0001 and the corresponding SPEC section; it
does not reverse those decisions. This document remains non-authoritative and does not itself grant
implementation authorization.

TASK-0003 completed independent review and was adopted through ADR-0001. Phase 3 remains blocked
only on its separately scoped implementation task, not on unresolved onboarding machinery.
Richer severity vocabulary is a future optional clarification:
the unclassified fallback already defines behavior now. Validation only checks repository structure.

This remains a historical **NON-AUTHORITATIVE** design record; ADR-0001 and SPEC.md are authoritative.
