# Glossary

*Reference.* The vocabulary CENZONTLE uses for itself — in the code, in the API and
in the rest of this documentation. Every definition here is derived from the source
of truth (the Prisma schema, the shared types and the `factory` module), not from
prose, so when a doc and this file disagree, this file wins.

Two things to know before you read:

- **The product is documented in English; the application UI is still in Spanish.**
  Wherever a term shows up on screen with a Spanish label, the literal label appears
  in bold with an English gloss right after it, exactly as in the rest of this
  documentation: **Nodos de cómputo** ("Compute nodes"), **Células** ("Pods"),
  **Dar VoBo** ("sign off"). Click what is in bold; the parentheses are only there so
  you know what it means.
- **Some Spanish words are not translated at all** because they are proper names or
  code identifiers: Forge, Pod, batch, wave, slot, worker, gate, vault, DAG. Those
  are listed as-is.

Grouped by area rather than alphabetically, because the terms only make sense next
to their siblings.

- [Product and planning](#product-and-planning)
- [The Forge](#the-forge)
- [QA and release](#qa-and-release)
- [Platform, identity and security](#platform-identity-and-security)
- [Analytics](#analytics)
- [A note on "VoBo"](#a-note-on-vobo)

---

## Product and planning

### software factory

The generic category the product belongs to: a platform that turns requirements into
merged, tested code using AI agents. Lowercase in prose. Not a synonym for the Forge —
the Forge is CENZONTLE's *implementation* of a software factory.

### initiative

Top level of the planning hierarchy (**initiative → epic → story**). Has a name, a
description, a status (`planning` | `active` | `completed` | `on_hold`), optional
start/target dates, an owner, attached documents, an optional external tracker
reference, a cached executive summary and a vault markdown path. Deleting one
cascades to its epics. Code identifier: `Initiative`.

### epic

Middle level of the hierarchy: a body of work under one initiative, expressed as a
single markdown document with nine mandatory level-2 headings (description,
qualitative and quantitative benefits, benefit measurement, scope, acceptance
criteria, technological improvements, impacted channels and flows, third-party
dependencies). An epic carries the three role sign-offs, the QA matrices, the design
bundle and every Forge lifecycle timestamp. Code identifier: `Epic`. An epic that has
been enqueued to the Forge is called a **batch**.

### story

The smallest unit of work, and the atomic unit the Forge executes: **one story = one
agent run on one compute node**. Belongs to exactly one epic and one Pod, and carries
story points, a status (`backlog` | `todo` | `in_progress` | `in_review` | `qa` |
`done` | `blocked`), labels, covered components, a vault markdown path, DAG edges and
a claim marker. Code identifier: `Story`. Always "story", never "user history".

### Pod

A delivery team. Epics attach to Pods many-to-many; every story belongs to exactly one
Pod. Pod membership is also an authorization boundary — vault access and Forge batch
access are both checked against the Pods you belong to.

The UI calls them **Células** ("Pods"), in Settings ("Configuración") → Ecosistema →
**Células** (`/factory/settings?section=pods`). The canonical English term is **Pod**,
matching the code identifier and the API surface. Never "cell" or "squad" in prose
about the data model.

### sprint

A time-boxed period (name, start/end dates, Pod, status) that stories can be assigned
to. **A sprint is not a batch.** The Forge's integration branch prefix is
`forge/sprint-batch-` and one shared type is called `SprintBatch`, but those names are
historical: a Forge batch is an *epic*.

### proposal

An artifact drafted by an AI agent and held in staging until a human accepts it. Three
flavors: a proposed epic and a proposed story (both streamed over SSE while an agent
generates them), and an assistant proposal (a scoped edit the chat assistant offers,
reviewed as a diff). You **accept** or **apply** a proposal — "approve" is reserved
for sign-offs and gates.

### sign-off

One of the three per-role approvals — Product Owner, Tech Lead, QA — an epic must
collect before it can be enqueued to the Forge. Each records a status, the approver,
a snapshot of their name, a timestamp and a comment. Granting one requires **step-up
authentication** and an exact role match.

In the UI the control is the **Dar VoBo** ("sign off") button on the epic. See
[A note on "VoBo"](#a-note-on-vobo).

### tracker reference

An optional pointer from an initiative, epic or story to an item in an external
tracker (Jira or Linear). Optional *everywhere* — epics created and enqueued inside
CENZONTLE frequently have none, and the UI falls back to the internal id.

### QA matrix

The QA artifact attached to an epic, at two levels: the story-level matrix (one row
per story with its acceptance criteria, test cases and coverage percentage) and the
epic-level matrix (systemic tests plus non-functional coverage per category:
integration, e2e, performance, security). Either can be AI-generated or written by
hand; both are prerequisites for the QA sign-off.

---

## The Forge

### Forge

Proper name of CENZONTLE's software factory subsystem: the fleet of workers that
claim stories, implement them with headless Claude Code, verify the Definition of
Done, open pull requests, run the automated QA pipeline and drive the batch to
Released. Concretely, the `apps/worker` daemons plus the `factory` module of the API.
Its git footprint is the branch prefix `forge/sprint-batch-`, cut from the DEV branch.

Always capitalized. Never translated.

### fleet

The set of registered compute nodes and the `factory-worker` daemons running on them —
the execution capacity available to the Forge. Concretely: the `ComputeNode` rows
managed by the API's `fleet` module (`apps/api/src/modules/factory/fleet/`) plus the
`apps/worker` processes that authenticate against it. **A fleet is made of nodes and
workers, not of agents**; an agent is what a worker spawns to do one story.

Careful: there is **no screen called "Fleet"** in Settings. Nodes are registered and
worker tokens are minted in Settings → Infraestructura → **Nodos de cómputo**
("Compute nodes") (`/factory/settings?section=nodes`), whose panel is titled
**Gestión de flota** ("Fleet management"). The string "Fleet Monitor" does exist, but
on a different page (`/factory/agents`), which cannot register nodes or generate
tokens.

### compute node

A registered machine that can run Forge workers. Records a name, a hardware type
(`local` | `mac_mini` | `cloud_vm` | `gpu_instance` | `other` — metadata only,
scheduling ignores it), OS, location, IP, slot count, status (`online` | `offline` |
`degraded`) and a last-heartbeat timestamp. Retiring a node is a soft delete, so
historical agent runs survive. Code identifier: `ComputeNode`. Often just "node".

### slot

One unit of concurrency on a compute node: the maximum number of stories that node's
worker will run at the same time (1–32, default 1). The dashboard is the source of
truth — the worker syncs its slot count on every heartbeat, unless the operator
pinned it with `--slots`.

### worker

The `factory-worker` daemon installed on a compute node. It registers with a worker
token, heartbeats every 30 s, polls for claimable stories every 5 s until its slots
are full, runs each claimed story (clone, spawn headless Claude Code inside an OS
sandbox, run the DoD verification loop, commit, push, open a pull request), reports
progress and completion, and drains active runs for up to 60 s on `SIGINT`/`SIGTERM`.
Also the name of the CLI binary.

### worker token

The bearer credential that authenticates one worker against the API. Plaintext format
`worker_<32 chars>`, shown **exactly once** at creation; the database keeps only an
11-character prefix — the literal `worker_` plus the first four characters of the
secret (`apps/api/src/modules/factory/fleet/worker-token.service.ts:52`) — and a
SHA-256 hash. Supports immediate revocation and optional expiry, and every agent run
records which token claimed it.

Generated per node in Settings → **Nodos de cómputo** → **Generar** ("Generate").

### agent

An LLM-driven actor invoked by the platform. Two families:

- **Project agents**, which draft artifacts: the Product Owner, Tech Lead and QA story
  agents, the epic agent, the diagram agent and the editing assistant. Each has its
  own configurable model and thinking effort, tuned in Settings → Automatización →
  **Tokens IA** ("AI tokens") (`/factory/settings?section=agent-tokens`).
- **Forge agents**, which produce and check code: the planner, the generator (the
  "Coder Agent" in the UI), the DoD verifier, the QA lens agents, the adversarial
  refuters and the QA synthesizer.

In Forge documentation, "the agent" on its own means the generator running under a
worker.

### agent run

One execution of a Claude Code agent over **one story on one compute node** — the
Forge's unit of execution. Lifecycle: `claimed` → `running` → `completed` | `failed`,
plus `abandoned`, the sweeper's terminal state after more than 10 minutes without
progress (which also releases the story so another worker can re-claim it). Carries
the branch, the output tail, the pull request number, the exit code, the criteria
timeline, the DoD verification log, token usage and the modified file paths. At most
one non-terminal run may exist per story; many terminal runs may (that is how retries
work). Code identifier: `AgentRun`.

### claim

The atomic act of a worker taking ownership of a story. The API selects one eligible
story with `FOR UPDATE ... SKIP LOCKED`, so many workers can claim concurrently
without blocking each other. Every hard DAG blocker must be `done` first. On success
the API marks the story claimed, inserts the agent run, and returns the payload the
worker needs: prompt, branch, repository URL, Anthropic key, external secrets, DoD
criteria, acceptance criteria, QA test cases, technical requirements and design
manifests. Both a verb and a noun.

### story DAG

The directed acyclic graph of story-to-story ordering dependencies inside one epic,
emitted by the Tech Lead agent. Each edge records a hardness (`hard` | `soft`) and a
reason (`api_contract`, `migration_order`, `shared_model`, `sequential_logic`,
`other`). **Only hard edges gate claiming.**

### wave

A topological level of the story DAG inside one batch: wave 0 holds the stories with
no hard dependencies; wave N+1 holds stories whose hard dependencies all sit in waves
≤ N. Computed at read time, not stored. Stories in the same wave run in parallel
across the fleet.

### batch

An epic that has been enqueued to the Forge — the unit that moves across the Pipeline
Board. A batch is **not a table**: it is the epic row itself, identified by its
enqueued-batch id and anchored in time by its enqueue timestamp. Every batch-scoped
endpoint keys off that id. Keep the English word; never "lote" or "job".

### integration branch

The per-epic branch `forge/sprint-batch-<epic id prefix>`, cut from the DEV branch
when the epic is enqueued. Every story of the batch opens its pull request against
this branch; when the whole batch is done, a single **consolidated PR** merges it into
DEV. The DEV SHA at creation is recorded for drift detection, and the branch is
auto-deleted after the merge when that option is enabled.

### consolidated PR

The single pull request that merges an epic's integration branch into DEV once every
story of the batch is done. This is what the staging gate approves. Its number,
creation time, merge time and merge SHA are persisted on the epic, so the preview can
still resolve the post-merge snapshot after the branch is deleted.

### Definition of Done (DoD)

The global checklist every Forge story must satisfy before its run counts as complete.
One flat catalog applying to all stories — not per-Pod, not per-team. Each criterion
has a short text, a mandatory long description injected into the agent prompt, and a
stable kind that maps to a deterministic evaluator; operator-added criteria have no
kind. The ten canonical kinds are `code-written`, `acceptance-criteria`,
`technical-design`, `tests-passing`, `no-errors`, `security-scan`, `code-security`,
`design-coverage-check`, `pr-created` and `docs-updated`.

Edited in Settings → Automatización → **Definition of Done**
(`/factory/settings?section=dod`).

### DoD verifier

The reviewer agent the worker runs after the generator finishes, independently of it.
Layer 1 runs deterministic subprocesses; layer 3 escalates to an LLM verifier that
emits one verdict per criterion — `passed`, `failed` or `skipped`, where **skipped
means "does not apply to this environment"**, not failure. Failures feed a retry
prompt and re-spawn the generator, up to the configured maximum number of attempts.

### attempt

One pass of the DoD enforcement loop inside a single agent run. Starts at 1 and
increments each time the worker re-spawns the generator after a failed verification.
Distinguishes clean runs from runs that needed corrections, and roughly doubles the
cost of a story each time.

### doom loop

The failure mode where an agent keeps attempting the DoD without converging. Two
kinds: **REGRESSION**, where the number of passing criteria dropped between attempts
(active damage — escalates immediately), and **STAGNATION**, where the number did not
increase (escalates after a grace period).

### acceptance criterion

One testable condition extracted from the story's acceptance-criteria markdown section
and passed to the worker as a flat list. Each becomes an individual milestone in the
run timeline and is evaluated one by one by the layer-3 verifier. If the section is
missing, the verifier degrades to evaluating the story as a block. Plural: acceptance
criteria.

### QA test case

An individual scenario extracted from the story's QA markdown, tagged `happy` (main
flow, at least one) or `edge` (boundaries, errors, empty inputs — typically 3 to 7 per
story). The worker turns each into a granular milestone, and the verifier evaluates
them one by one — find a covering test, read it, run the repository's test runner,
emit a per-case verdict. This is how the `tests-passing` criterion is judged.

### technical requirement

An item extracted from the Tech Lead sections of a story's markdown, categorized as
checklist, contract, validation or errors. Used for per-item evaluation of the
`technical-design` criterion: a deterministic grep pre-flight over the repository,
followed by an LLM check that the code actually *implements* the item rather than
merely mentioning the keywords. Distinct from a story's external technical
dependencies (APIs, secrets, fixtures, services, teams).

### design bundle / component manifest

The UX/UI design artifacts attached to an epic. The backend parses each design into a
**component manifest** — a list of expected components with their kind, source lines
and file path — which travels to the worker inside the claim. The
`design-coverage-check` criterion greps the workspace for each component name and
reports the missing ones as a non-blocking warning. Complementary to the enqueue-time
coverage gate, which requires every manifest component to appear in some story.
Backend-only epics carry no manifests.

### sweeper

A periodic job that reconciles reality with stored state. Three exist: the fleet
sweeper marks nodes offline after 90 s without a heartbeat (three times the 30 s
interval); the run sweeper marks agent runs abandoned after 10 minutes without
progress and releases their story; and the QA sweep both auto-triggers campaigns for
freshly merged batches and marks stale lenses and campaigns.

### heartbeat

The worker's 30-second liveness ping to the API. It reports how many slots are in use
and receives back the next interval plus the dashboard's authoritative slot count, so
slot changes made in the UI propagate without re-registering. Node-level heartbeat is
distinct from run-level progress.

### kill switch

The Forge's emergency control, in Settings → Infraestructura → **Kill Switch del
Forge** (`/factory/settings?section=kill-switch`). Three operations: **pause** (blocks future claims; work already running is
not killed), **resume**, and **abort all** (marks every active run abandoned; each
worker sees a 410 on its next progress ping, about 30 seconds later, and terminates
its agent). Aborting is irreversible and requires confirmation.

---

## QA and release

### stage

The column a batch occupies on the Pipeline Board. The five stages are **In Queue →
Forge → Staged → QA Testing → Released** (already English in the UI — reproduce them
exactly). A stage is **derived, never stored**: it is computed from the epic's
timestamps, with later timestamps taking precedence. The internal field that holds a
related enum is called `currentLayer`; prefer "stage" in prose and only say "layer"
when naming that field.

### Pipeline Board

The kanban view in the Factory dashboard (`/factory`) whose columns are the pipeline
stages and whose cards are batches.

### gate

A mandatory human decision point in the Forge pipeline, distinct from the pre-Forge
epic sign-offs. There are exactly two — the **staging gate** and the **release gate**.
Both require step-up authentication and the Tech Lead or senior-management role.

### staging gate

The first gate: a Tech Lead (or senior management) approves merging the batch's
consolidated PR into DEV, moving it from Forge to Staged. Enforced with a Pod access
check, a strict role check, a step-up password and partial idempotency — a failed
merge can be retried without losing the original approver.

### release gate

The second gate: a Tech Lead or senior management approves the rollout after reading
the synthesized QAReport, moving the batch to Released. The API refuses while the QA
campaign has not completed.

### release

The final stage of the pipeline: a batch whose release gate has been approved. Note
that QA vocabulary keeps **rollout** (ship it) and **rollback** (revert) as the two
possible QAReport recommendations — those are verdicts, whereas "release" is a stage.

### QA campaign

One automated multi-agent QA run over a batch that has merged to DEV. Lifecycle:
`pending` → `running` → `synthesizing` → `completed`, plus `failed` (infrastructure)
and `superseded` (replaced by a manual re-run). It fans out N lenses in parallel,
verifies their findings adversarially, and synthesizes a QAReport that unlocks the
release gate. Triggered by a per-minute sweep or manually from the UI, and pins the
staging SHA so the report states exactly which code was tested. Only one non-terminal
campaign may exist per epic. The underlying record is a "QA run".

### QA lens

One dimension of a QA campaign, executed in parallel with the others. Four kinds:

| Lens | What it does |
| --- | --- |
| `test_suite` | Runs the repository's Jest/Vitest suite and parses pass, fail and coverage |
| `e2e` | Serves the app in an ephemeral environment and exercises the live URL |
| `security_diff` | Differential scan over the merged diff — secret regexes plus an AI review |
| `perf_a11y` | Latency plus axe accessibility checks against the live URL |

Each lens has its own lifecycle (`pending` → `running` → `completed` | `failed` |
`abandoned`) and reports a normalized test suite and/or findings. One lens crashing
does not abort the campaign. Plural: lenses.

### finding

A defect reported by a QA lens: an id, a category (`functional`, `unit`,
`integration`, `e2e`, `security`, `performance`, `accessibility`), a title, truncated
evidence, a severity (`critical` | `high` | `medium` | `low`), the adversarial vote
tally, and whether it survived verification. Deliberately distinct from a failed test
and from a failed run — a finding is a *claim about a defect*.

### adversarial verification / refuter

The step that separates real defects from flaky or environmental noise. For each
non-deterministic finding, N independent **refuters** try to *prove the finding is not
real* and vote `refuted`, `upheld` or `uncertain`. The policy is deliberately
conservative: a finding counts as real unless a **majority** refutes it — ties and
all-uncertain resolve to real. Deterministic findings (regex-matched secrets,
accessibility violations, latency breaches) short-circuit as real without refutation.

### QAReport

The synthesized output of a QA campaign, and the payload the release-gate reviewer
reads: a rollout-or-rollback recommendation, a 0–100 confidence score, normalized e2e,
integration and performance suites, and a log analysis block. The numbers are computed
deterministically, with an AI-written narrative on top and a templated fallback.
Written to the QA run and mirrored onto the epic in the same transaction. Keep the
code spelling `QAReport` when naming the object.

### ephemeral preview environment

A short-lived instance of the batch's code that the API clones, installs and serves on
a local private-range port, so the e2e and perf/a11y lenses (and the operator) can
exercise a live app. States: `starting` → `running` → `stopped`, or `error`. Its URL
is validated as internal before being persisted. "Preview" alone is fine once
established.

---

## Platform, identity and security

### vault

The knowledge base backing CENZONTLE, stored as markdown in a GitHub repository.
Initiatives, epics and stories each keep a path pointing at their markdown file, and
the agents read that markdown when they work. Several vaults may be configured, but
only one is active at a time.

Two different screens share the name: the **reader** is in the left sidebar as
**Vault** but lives at `/proyectos/definiciones`; the **configuration** is Settings →
Integraciones → **Vault** (`/factory/settings?section=vault`).

### role

CENZONTLE's RBAC layer, orthogonal to Pod membership. Five roles, each mapped to a
fixed permission set, delivered in the Auth0 token and checked by API guards:

| Identifier | UI label | In English prose |
| --- | --- | --- |
| `alta_gerencia` | **Alta Gerencia** | senior management — full access and user management |
| `product_owner` | **Product Owner** | Product Owner |
| `tech_lead` | **Tech Lead** | Tech Lead |
| `qa` | **QA** | QA |
| `viewer` | **Viewer** | Viewer |

Editable in Settings → Ecosistema → **Roles y permisos** ("Roles and permissions")
(`/factory/settings?section=roles`).

### ReBAC

Relationship-based access control for the vault. **What the server actually enforces
is vault-level:** the user must belong to at least one allowed Pod, and a
deny-by-default role map decides owner/editor/viewer; holders of the
manage-integrations permission bypass both, and the guard re-resolves the target vault
from the request to prevent object-reference attacks.

A richer per-node ACL model (per-folder entries, inheritance, an
owner > editor > viewer > none hierarchy) exists in the shared types but is consumed
**only by the web client**. There is no server-side per-folder ACL table or endpoint.
Do not read folder-level inheritance as a server-enforced guarantee.

### step-up authentication

Re-confirming the current user's password at the moment of a high-consequence
approval, on top of the existing session. Required for the three epic sign-offs and
for both human gates. Combined with a strict role check, it makes an approval
non-repudiable.

### external secret

A third-party API key (Stripe, Twilio, Amadeus, …) stored encrypted with AES-256-GCM
and forwarded, decrypted, inside each claim. The worker injects it as an environment
variable and into an ephemeral `0600` `.env` file that is git-excluded and deleted
before staging, never persists it anywhere else, never logs the value, and redacts it
from agent output before sending that output back.

Managed in Settings → Integraciones → **Secretos externos** ("External secrets")
(`/factory/settings?section=external-secrets`).

### sandbox

The OS-level isolation wrapper around every spawn of the coding agent —
`sandbox-exec` on macOS, `firejail` on Linux, or `none`. Running with `none` requires
a **double opt-in**: the mode must be set to `none` *and* a second variable must
explicitly allow it. Otherwise every run aborts before the spawn.

### changelog

The in-product audit trail: who changed which entity, when, and from which value to
which value. Gate approvals, node lifecycle events and QA synthesis all write an entry
in the same transaction as the state change — which is why approver display names are
snapshotted, so the record survives a user rename. Distinct from this repository's own
`CHANGELOG.md`.

---

## Analytics

### story points

The Fibonacci-bucketed estimate (1, 2, 3, 5, 8, 13) the Product Owner agent assigns to
a story. The *planned* side of the velocity comparison; the *measured* side is the
effort score.

### effort score

A composite, unitless index of what a story actually cost, normalized against the
medians of the visible population (done stories with a cost and an estimate greater
than zero, inside the window). Weighted 0.5 USD cost + 0.3 duration + 0.2 DoD
attempts, each divided by its population median; components whose median is zero are
dropped and the remaining weights re-normalized. An effort score of 1.0 reads as "the
effort of the median story". Null below three samples.

### velocity

The calibration analytics: story points delivered per week (a four-week average, with
the current partial week counted at full weight — deliberately conservative), plus an
estimate-versus-reality verdict per story (`over`, `calibrated`, `under`, `no-data`).
The per-bucket calibration table is fed back into the Product Owner agent's prompt,
closing the estimation loop. Derived at read time; no extra tables.

### cost analytics

Read-time aggregation of each agent run's token usage, per batch and per story, broken
into three components: **planner**, **generator** and **verifier**. Token totals split
into "new" (input, output and cache creation, billed at full price) and "cached" (cache
reads, roughly ten times cheaper), so a large total is not mistaken for a large bill.

**All figures are client-side SDK estimates, not authoritative billing.** Treat them
as order-of-magnitude operational signals.

---

## A note on "VoBo"

You will see "VoBo" on screen and in older commit history — for example in the
**Dar VoBo** button on an epic, and in the permission labels **VoBo PO**, **VoBo TL**
and **VoBo QA**.

"VoBo" is a Mexican-Spanish abbreviation of *visto bueno*, "approved". It is not a
product name and not a code identifier — the code says `poApproval`, `tlApproval`,
`qaApproval`. **In English documentation the term is "sign-off"**: *epic sign-off*,
*the three sign-offs*, *PO/TL/QA sign-off*, verb *to sign off*. When a doc names the
literal button, it writes: the **Dar VoBo** ("sign off") button.

One distinction is worth keeping sharp, because a single word for both would erase it:

| | **sign-off** | **gate** |
| --- | --- | --- |
| When | Before the Forge | After the Forge |
| Who | Product Owner, Tech Lead, QA — one each | Tech Lead or senior management |
| How many | Three | Two (staging, release) |
| What it unlocks | Enqueueing the epic | Merging to DEV / the rollout |
| Step-up auth | Yes | Yes |

Both are human approvals with step-up authentication, but they sit on opposite sides of
the pipeline. "Sign-off" is never a gate, and a gate is never a sign-off.
