# New UI Proposal

This document proposes a redesign of the UI. Unlike [`docs/ui.md`](./ui.md), which describes the existing interface, this document describes a new target UI intended to reduce operator friction, simplify dense workflows, and make transaction-heavy actions easier to understand.

## Executive Summary

The redesign keeps the current protocol capabilities and top-level route model, but changes how the UI presents state and actions.

What stays the same:

- the four top-level routes
- the core workflows and protocol actions
- explicit gating, deep linking, and operator seriousness

What changes:

- large inline transaction forms move into focused execution modals
- pages show readiness and blockers before the user clicks
- lifecycle stage becomes much more visible
- dense tables and metric walls are replaced with clearer grouped summaries
- advanced detail remains available, but becomes visually secondary

The core interaction model is:

- page = state, scope, readiness, and action choice
- modal = execution

The first implementation slice should focus on:

1. shared action-card and modal patterns
2. `Security Pools > Operate`
3. `Open Oracle > Selected Report`
4. shared notice, stage, and sticky-context systems

## How To Use This Document

This document should be treated as an implementation spec for the redesigned UI.

Use [`docs/ui.md`](./ui.md) for the inventory of existing screens, controls, and flows.
Use this document for:

- the target interaction model
- the target page structure
- which flows move to modal-first execution
- which elements remain inline
- how route state, blockers, stage, and cross-route handoffs should be presented

If a designer or engineer needs to implement the redesign, the default rule should be:

- preserve the same protocol capabilities unless this document explicitly says otherwise
- change presentation, action grouping, execution flow, and hierarchy to match this redesign
- keep the route model intact unless this document explicitly proposes a different structure

## Document Structure

This document is organized into three layers:

1. principles
   - the target interaction model, clarity rules, and visual rules
2. route specs
   - how each route and major workspace should be redesigned
3. implementation
   - migration mapping, modal inventory, state contracts, rollout order, and acceptance criteria

Quick readers should start with:

- `Executive Summary`
- `Goals`
- `Route Before vs After`
- `Recommended First Pass`

Implementers should then use:

- `Route Implementation Requirements`
- `Route Layout Contracts`
- `Current-To-New Control Migration Map`
- `Modal Inventory`
- `Redesign Acceptance Criteria`

## Redesign Contract

The redesigned UI should preserve:

- the four top-level routes
- the same operational capabilities described in [`docs/ui.md`](./ui.md)
- deep-linkable route and object context
- visibility into protocol state and workflow blockers

The redesigned UI should change:

- where actions are presented
- how actions are launched
- how approvals are handled
- how stage and readiness are explained
- how dense technical detail is prioritized on the page

## Goals

The redesign should:

- keep the current route model and core product capabilities
- reduce the amount of always-visible form chrome on each screen
- make the next required action more obvious
- keep all available actions visible before the user clicks into execution
- show requirements and blockers inline instead of revealing them late
- separate read-only context from write actions more clearly
- standardize high-risk transaction flows
- make approvals feel like part of an operation, not a separate page-level workflow

The redesign should not:

- remove advanced operator capabilities
- hide critical protocol state
- turn the app into a consumer UI
- reduce precision where the current UI is intentionally explicit

## Non-Goals

This redesign is not intended to:

- remove advanced or low-frequency protocol actions
- replace explicit lifecycle state with vague abstractions
- hide blockers until the user attempts an action
- optimize for decorative UI over operational clarity
- turn the interface into a beginner-oriented tutorial product

## Core Design Changes

When the redesign has to choose between competing priorities, use this order:

1. preserve workflow correctness
2. preserve clarity of state and blockers
3. reduce visual and interaction noise
4. improve speed of execution
5. improve visual refinement

### 1. Stronger Route Structure

Each major route should follow a stricter composition:

1. route header
2. top-level context summary
3. action readiness panel
4. supporting detail sections
5. advanced or lifecycle sections

The intent is to make every route answer these questions immediately:

- where am I?
- what object am I operating on?
- what actions are available here?
- which action is recommended next?
- what is blocked, and why?

Universal environment blockers should be handled once at the route or app-shell level, not repeated on every action card.

### 2. Read-Only Context First, Actions Second

The current UI mixes state summaries and transaction forms inside the same panels. The redesign should separate them:

- read-only context panels explain the current onchain state
- route-level environment gates show universal blockers only when they are failing
- action cards stay visible on the route and show readiness, blockers, and intent
- action launchers open focused transaction modals
- advanced diagnostics stay available, but lower on the page

This keeps route surfaces lighter and lowers scanning cost.

### 3. Modal-First Transaction Flows

Many write actions should work like the current liquidation flow:

- the main route shows the action, readiness state, and blockers
- clicking the action opens a focused modal
- the modal contains inputs, approval state, validation, warnings, and final submit

This is the biggest proposed interaction change.

## Modal-First Transaction Pattern

### Pattern

Every modal-first write flow should follow the same structure:

1. modal title
2. short purpose text
3. read-only context summary
4. input fields for that one operation
5. approval state if the operation needs approvals
6. requirement checklist
7. final submit action

The route that launches the modal should still show:

- what the action does
- whether it is ready now
- which local requirements are missing
- any important balance, approval, or lifecycle blocker

The modal should also have:

- a cancel button
- explicit error surface
- explicit success surface or close-on-success behavior with route-level success notice
- stable pending state inside the submit button

### Why this is better

This pattern would:

- remove large clusters of inputs from the base route
- make each action feel intentional and bounded
- let approvals live inside the operation that needs them
- keep prerequisite discovery on the page instead of in the modal
- reduce confusion about which field belongs to which transaction
- make high-risk actions feel more deliberate

### Approval Handling

Approvals should move into the modal for the specific action that requires them.

Example:

- today: `Deposit REP` sits on the page, and REP approval lives directly in the route
- proposed: `Deposit REP` is a button on the page, which opens a `Deposit REP` modal
- inside the modal:
  - deposit amount
  - wallet balance
  - current allowance
  - `Approve REP`
  - `Deposit REP`

This keeps the main route cleaner and preserves all current safety checks.

The page should still tell the user that approval is required before they open the modal. The modal should execute the approval, not surprise the user with the need for it.

## Global vs Local Readiness

The redesign should separate universal environment state from action-specific readiness.

### Global environment gates

These should live at the app-shell or route level and should only become prominent when they are failing:

- wallet disconnected
- wrong network
- setup or deployment incomplete

If these states are healthy, they should not be repeated on every action card.

Simulation mode should not be treated as a blocker or prerequisite by default. It should remain a lightweight environment indicator and only be mentioned near a specific action when simulation changes the meaning of that action.

### Action-specific readiness

Action cards should only show blockers that are local to that action, such as:

- insufficient REP
- approval required
- no selected vault
- report not in the correct stage
- pool belongs to a different universe
- child universe not created yet

This keeps readiness useful without repeating the same environment checks across the entire page.

### Flows that should move to modal-first

These are strong candidates:

- vault deposit REP
- vault withdraw REP
- set security bond allowance
- claim fees
- mint complete sets
- redeem complete sets
- migrate shares
- redeem shares
- report outcome / contribute
- withdraw escalation deposits
- create child universe
- migrate REP to Zoltar from pool flow
- migrate vault
- migrate escalation deposits
- start truth auction
- submit bid
- refund losing bid
- claim auction proceeds
- withdraw bids
- initial report submission
- dispute report
- settle report
- fork Zoltar
- prepare REP
- split REP

### Flows that can stay inline

Some lightweight actions can remain inline if they do not need extra inputs:

- refresh actions
- navigation actions
- open/select actions
- simple deploy actions
- route tab switches

## Route Before vs After

This section summarizes the redesign at the route level for readers who want a fast comparison with the current UI.

### Deploy

Before:

- already one of the clearer routes
- still somewhat list-driven and step-driven
- deployment state and next action compete for attention

After:

- deployment summary appears first
- the next recommended deploy step is visually primary
- completed groups collapse by default
- per-step controls remain available but become secondary

What stays the same:

- deterministic deployment workflow
- `Deploy Next Missing`
- per-step deployment access

### Zoltar

Before:

- good route split, but post-fork state is not visually dominant enough
- question browsing, forking, and migration are present but not sequenced strongly

After:

- universe stage becomes much more visible
- post-fork actions become more prominent when relevant
- `Fork Zoltar`, `Prepare REP`, and `Split REP` move to modal execution
- question-to-pool and question-to-fork handoffs become more explicit

What stays the same:

- `Questions`, `Create Question`, `Fork`, and `Migration`
- inline question creation
- question-driven pool and fork flows

### Security Pools

Before:

- the densest route in the app
- `Operate` mixes state, inputs, approvals, and lifecycle details
- many unrelated amount inputs are visible at once

After:

- `Browse`, `Create`, and `Operate` remain, but `Operate` is restructured
- selected-pool context becomes sticky
- action cards replace long inline transaction panels
- most state-changing actions move into focused modals
- fork and reporting stages become easier to read as workflows

What stays the same:

- browse, create, and operate capabilities
- pool, vault, trading, reporting, and fork workflows
- liquidation as an available high-risk action

### Open Oracle

Before:

- selected-report pages mix heavy read-only detail with action flows
- report stage is present but not visually dominant enough

After:

- report stage becomes the first thing the user sees
- action mode becomes visually primary
- initial report, dispute, and settle become focused modal flows
- long report details move lower and become easier to collapse

What stays the same:

- browse, create, and selected-report entry structure
- initial report, dispute, and settle capabilities
- report deep-linking and route handoffs

## Route Specs

This section describes the target route behavior and the intended user-facing structure for each major workspace.

Use it to answer:

- what the redesigned route should feel like
- what changes from the current UI
- which actions stay inline versus move to modal execution

## Route-by-Route Redesign

### App Shell

The top shell should stay, but with clearer priority:

- wallet and universe summary stay visible
- pricing stays visible
- route tabs stay visible
- global notices stay visible

Improvements:

- make the active universe and network state more prominent
- group status notices into one consistent notice stack
- keep only one obvious wallet action in the header

### Deploy

The current `Deploy` route is already relatively clear. It mostly needs stronger next-action framing.

Proposed structure:

- route header with deployment summary
- `Action Readiness` panel showing all deploy actions and the next recommended step
- deployment group list
- advanced per-step actions

Improvements:

- make `Deploy Next Missing` the obvious primary action
- collapse already-complete groups by default
- keep individual deploy buttons available, but visually secondary

### Zoltar

The current `Zoltar` route is functionally good but could be sequenced more clearly.

Proposed view model:

- `Questions`
- `Create Question`
- `Fork`
- `Migration`

#### Questions

The `Questions` view should emphasize:

- active universe summary
- question list
- next available universe-level action

Improvements:

- keep the question list primary
- move child-universe deployment into a dedicated `Post-Fork Universe Actions` block
- when the universe is forked, show a clear banner explaining that question creation is no longer the primary lifecycle

#### Create Question

Improvements:

- keep the form inline
- add a compact live validation summary near the submit action
- after creation, show a stronger handoff block:
  - `Fork this question`
  - `Use for pool creation`
  - `Create another`

#### Fork

This should become a modal-first action.

Base route should show:

- fork threshold
- selected question summary
- readiness checklist

Primary action:

- `Fork Zoltar`

Modal contents:

- selected question
- fork threshold
- wallet REP balance
- approval state
- approval action
- final fork action

#### Migration

This should also become modal-first for the actual write operations.

Base route should show:

- migration balance
- wallet REP balance
- selected child universes
- split-capacity summary

Primary actions:

- `Prepare REP`
- `Split REP`

Each opens its own modal or a shared two-step migration modal.

### Security Pools

This route has the largest improvement opportunity.

Proposed top-level structure:

- `Browse`
- `Create`
- `Operate`

#### Browse

Keep the browse registry, but improve action hierarchy:

- pool cards remain visible
- pool summary stays read-only
- `Open Pool` remains primary
- `Liquidate Vault` remains a modal launcher

Improvements:

- make `Refresh pools` secondary and less visually heavy
- keep liquidation clearly marked as destructive/high-risk
- add clearer separation between pool metrics and vault actions

#### Create

Keep the create form inline, but simplify the result flow:

- compact question context
- existing-pools summary
- creation form
- post-success handoff card

Improvements:

- stronger validation summary
- show why creation is blocked in one dedicated requirements strip

#### Operate

This should become much more structured.

Proposed layout:

1. selected pool header
2. pool summary
3. action readiness panel
4. workflow tabs
5. advanced details

The pool summary should stay read-only. Actions should move into modals.

##### Vaults

Current issue:

- too many inputs and approvals live directly in the route

Proposed change:

- keep vault directory inline
- keep selected vault summary inline
- replace inline write forms with action launchers

Main vault actions:

- `Deposit REP`
- `Withdraw REP`
- `Set Bond Allowance`
- `Claim Fees`
- `Liquidate Vault`

Each opens a modal with:

- selected vault summary
- relevant balances and allowances
- one focused input
- approval control if needed
- submit button

Result:

- remove most always-visible input fields from the route
- keep the page focused on vault state, not vault forms

##### Trading

Current issue:

- four separate transaction sections create a long action stack

Proposed change:

- replace inline forms with action cards:
  - `Mint Complete Sets`
  - `Redeem Complete Sets`
  - `Migrate Shares`
  - `Redeem Shares`

Each opens a focused modal.

Benefits:

- no more always-visible amount fields for unrelated actions
- per-flow validation stays local to the action

##### Reporting

Current issue:

- escalation context is good, but the write panel is dense

Proposed change:

- keep escalation metrics and side summaries inline
- move write actions to modals:
  - `Report / Contribute`
  - `Withdraw Deposits`

Each modal should show:

- selected outcome side
- current bond and threshold context
- user stake on that side
- amount or deposit-index input
- submit action

##### Fork

Current issue:

- the route exposes many lifecycle operations simultaneously

Proposed change:

- keep lifecycle tabs and read-only state inline
- make every actual fork/auction operation modal-first

Examples:

- `Initiate Pool Fork`
- `Create Child Universe`
- `Migrate Vault`
- `Submit Bid`
- `Claim Auction Proceeds`

Each modal should carry the exact stage context needed for that one action.

### Open Oracle

This route is a good candidate for stronger separation between read-only report state and write actions.

#### Browse

Mostly fine now. Improvements:

- keep browse list primary
- keep selected report route as the deep workspace

#### Create Open Oracle Game

This should stay inline as a standalone creation flow.

Base route:

- compact explanation of what direct game creation does
- grouped creation fields
- validation summary
- `Create Open Oracle Game`

Rationale:

- it creates a new record rather than mutating an existing one
- it fits the document's broader rule that creation flows usually stay page-native
- it is technical, but not improved by hiding the whole form behind a launcher

#### Selected Report

Current issue:

- report details and action workflow compete for visual priority

Proposed change:

- keep report summary at top
- move long read-only sections into collapsible panels
- make the active action mode the primary call to action

Action-mode changes:

- `Initial Report` action opens `Submit Initial Report` modal
- `Dispute Report` action opens `Dispute & Swap` modal
- `Settle Report` action opens `Settle Report` confirmation modal

Benefits:

- the selected report page reads like a report viewer
- the modal handles the actual transaction workflow

## Standard UI Components To Add

The redesign should introduce a small shared set of higher-level components:

- `NextActionPanel`
  - shows the recommended next action and why without hiding other available actions
  - should be treated as a recommendation surface, not a single-path workflow surface
- `ActionReadinessPanel`
  - shows the full set of available actions plus action-specific readiness and blockers for the current object
- `EnvironmentGate`
  - shows global blockers such as disconnected wallet, wrong network, or incomplete setup only when they are failing
- `RequirementsChecklist`
  - shows local requirements for the selected action, such as approval, balance, selected object, or lifecycle stage
- `ActionLauncherCard`
  - read-only action summary with readiness state, blockers, and a single primary launcher
- `OperationModal`
  - shared shell for modal-first transactions after the user has already seen the requirements on-page
- `ReadOnlyDetailAccordion`
  - collapsible technical detail sections
- `ResultBanner`
  - consistent success state after a write action
- `LifecycleStageBanner`
  - shows the current object stage, what it means, and which actions are unlocked
- `ContextBreadcrumb`
  - shows how the current route or record relates to the previous workflow step
- `OutcomeSummary`
  - explains what changed after a completed action and what the operator should do next

## Shared Module Architecture

The redesigned UI should be implemented as a layered module system rather than as one-off route-specific panels.

The goal is to share structure, interaction patterns, and state presentation across routes without forcing unrelated workflows into the same component.

### 1. UI Primitives

Reusable low-level building blocks:

- buttons
- badges
- icons
- cards
- section wrappers
- metric rows
- form fields
- inline status labels

These should define the visual language but not contain route-specific workflow logic.

### 2. Shared Workflow Modules

Reusable higher-level workflow surfaces:

- `EnvironmentGate`
- `LifecycleStageBanner`
- `StickyObjectContext`
- `ActionReadinessPanel`
- `NextActionPanel`
- `ActionLauncherCard`
- `RequirementsChecklist`
- `BlockedReason`
- `RiskNotice`
- `ResultBanner`
- `OutcomeSummary`
- `WorkflowSummaryStrip`
- `ReadOnlyDetailAccordion`

These should capture repeated interaction patterns across Zoltar, Security Pools, and Open Oracle.

### 3. Shared Data Presentation Modules

Reusable state-display modules:

- `ObjectIdentityCard`
- `RegistryList`
- `MetricGroup`
- `ComparisonMetrics`
- `StatusBadge`
- `StateChipRow`
- `EmptyState`
- `LoadingState`
- `ErrorState`

These should replace one-off summary panels and make the information hierarchy more consistent.

### 4. Shared State And Navigation Modules

Reusable non-visual or lightly visual modules:

- URL-backed selected-object state
- route handoff helpers
- transaction queue state
- global notice stack state
- modal state orchestration
- refresh and stale-state tracking

These should preserve continuity across routes and keep route behavior consistent.

### 5. Domain-Specific Workspace Shells

Reusable domain-aware composition layers:

- `ZoltarWorkspaceShell`
- `PoolWorkspaceShell`
- `ReportWorkspaceShell`
- `ForkWorkspaceShell`
- `QuestionWorkflowShell`

These should compose shared modules into domain-appropriate screens without collapsing all workflows into one generic layout.

### 6. Route Implementations

Top-level routes should mostly assemble shared modules and domain shells rather than inventing new workflow patterns.

The default implementation rule should be:

- prefer a new composition of shared modules before inventing a new custom interaction surface
- create a new domain-specific shell only when multiple related screens need the same structure
- avoid creating route-local one-off controls when an existing shared workflow module can be extended cleanly

### Modularity Guidance

The redesign should avoid two failure modes:

- over-generic components that hide domain meaning
- route-specific components that duplicate shared interaction patterns

The right split is:

- shared primitives for look and feel
- shared workflow modules for repeated UX patterns
- domain shells for protocol-specific structure
- route pages for final composition

## Implementation Blueprint

Someone implementing this redesign should apply the same page contract everywhere.

### Canonical rules

When sections in this document overlap, use these as the controlling rules:

- route = state, scope, readiness, and action choice
- modal = execution, confirmation, and operation-specific inputs
- global blockers appear once per route
- action cards show only local blockers
- creation flows usually stay inline unless this document explicitly says otherwise
- selected object identity and lifecycle stage stay visible while working
- advanced detail remains available but visually secondary
- copy stays short and high-signal by default

### Shared page contract

Every route or deep object workspace should be built from these layers:

1. route header
2. object or route summary
3. environment gate if failing
4. lifecycle stage banner when relevant
5. action readiness panel
6. action launcher cards
7. supporting read-only records
8. advanced diagnostics or historical details

### Shared interaction contract

Every action in the UI should be classified as one of these types:

- navigation
  - changes route, tab, or selected object
- refresh
  - reloads state without changing onchain data
- inline creation
  - creates a new record and stays page-native
- modal execution
  - changes state on an existing record through a focused transaction modal
- destructive or high-risk execution
  - uses the same modal pattern with stronger warnings and confirmation language

### Shared implementation rules

Apply these rules across all routes:

- global blockers such as disconnected wallet, wrong network, or incomplete setup appear once per route
- action cards only show local blockers
- if an action needs approval, the route should say approval is needed and the modal should execute it
- if an action is blocked by stage, the stage banner and the action card should agree on why
- if an action completes, the result surface should explain the state change and next step
- if a record is selected, its identity and stage should remain visible while the user works
- if a list is the entry point to a workflow, it should support search, filtering, and empty-state guidance

## Additional Redesign Priorities

The modal-first pattern is only one part of the redesign. The UI should also improve clarity around stage, continuity, hierarchy, and protocol comprehension.

### 1. Lifecycle Stage Clarity

Many workflows are really stage-driven rather than form-driven. The UI should make that explicit.

Add a visible stage banner to the top of any object workspace that has meaningful lifecycle transitions, such as:

- active universe before fork
- universe after fork
- report awaiting initial report
- report in dispute
- report ready to settle
- pool fork available
- truth auction active

Each stage banner should show:

- the current stage name
- a one-line explanation of what the stage means
- which actions are available in this stage
- which actions are blocked until the next stage

This should reduce the need for operators to infer lifecycle state from scattered badges and disabled controls.

Route examples:

- `Zoltar`
  - when a universe is forked, the page should clearly state that question creation is no longer the primary workflow and migration is now relevant
- `Security Pools > Reporting`
  - the route should explain whether the pool is awaiting a report, in escalation, or ready for withdrawal
- `Security Pools > Fork`
  - the route should explain whether the operator is before fork, in child-universe creation, in migration, in auction, or in settlement
- `Open Oracle > Selected Report`
  - the page should state whether the report is waiting for initial report, disputable, or settleable

### 2. Cross-Route Continuity

The app already has important route-to-route handoffs. The redesign should make them visible so the product feels like one workflow instead of several separate tools.

Add lightweight context breadcrumbs or handoff summaries such as:

- `Came from: Question`
- `Linked pool`
- `Linked report`
- `Current universe`
- `Return to previous workflow`

These should appear when the user arrived from a meaningful upstream action or when the current object is strongly tied to another object.

Route examples:

- after creating a question in `Zoltar`, the handoff into pool creation should name the question that is being carried forward
- when opening a report from a pool workflow, the report page should say which pool triggered the handoff
- when a pool belongs to a different universe than the active one, the relationship should be explained as a contextual mismatch rather than just a warning

### 3. Better Post-Action Feedback

The UI should not stop at `transaction submitted` or `confirmed`. After a write action, the operator should understand the outcome.

Add a consistent outcome summary that tells the user:

- what just changed
- whether the page has already refreshed
- whether a follow-up action is now available
- what the recommended next step is

This matters most for actions where the chain update changes the operator's available workflows immediately.

Examples:

- after `Deposit REP`, show the new vault balance and whether the vault is now eligible for the next operation
- after `Fork Zoltar`, explain that migration or child-universe actions are now relevant
- after `Submit Initial Report`, explain whether the report is now awaiting dispute or already on a path to settlement

### 4. Stronger Visual Hierarchy

The redesign should assign stricter visual priority across the page so that everything does not compete equally for attention.

Use this order:

1. current object and stage
2. available actions and blockers
3. key balances and operational metrics
4. technical diagnostics and deep detail
5. historical or rarely used supporting information

This should be reflected in spacing, heading weight, panel emphasis, and default collapse behavior.

Route examples:

- `Security Pools > Operate`
  - pool state and current actionable workflows should sit above vault tables, technical summaries, and low-frequency lifecycle detail
- `Open Oracle > Selected Report`
  - the action mode and report stage should have stronger emphasis than long record details

### 5. Better Terminology and Risk Framing

The UI should stay precise without assuming every operator remembers every protocol term instantly.

Add compact inline explanations for specialized concepts such as:

- universe
- fork
- child universe
- escalation
- complete sets
- truth auction

These should be short, contextual, and easy to ignore once understood.

Risk framing should also be more deliberate:

- routine actions should look routine
- high-risk or irreversible actions should look weightier
- destructive actions should explain consequences before submit

Examples:

- `Liquidate Vault` should clearly communicate that it is a punitive or corrective action, not a neutral maintenance step
- `Create Child Universe`, `Migrate Vault`, and `Claim Auction Proceeds` should explain why the action exists and what state change it finalizes

### 6. Reduce Tab Ambiguity

The redesigned UI should make it obvious what each tab is changing.

When a page has multiple layers of navigation, the UI should distinguish between:

- route-level tabs
- workflow tabs inside the selected object
- record selection inside a list
- modal execution for the selected action

Each tab set should have a short scope label such as:

- `Route`
- `Pool Workflow`
- `Report Action`
- `Selected Vault`

This should prevent the user from confusing a tab change with an object change.

### 7. Sticky Selected-Object Context

When the user selects a pool, report, question, or vault, that identity should remain visible while scrolling.

Add a compact sticky context bar for deep workspaces that shows:

- object name, id, or address
- current universe
- lifecycle stage
- current selected child object if relevant
- the current primary or recommended action

This is most important for:

- `Security Pools > Operate`
- `Open Oracle > Selected Report`
- `Zoltar` after a question is selected for forking

### 8. Better List Scanning And Filtering

Lists should be treated as operational search tools, not just static registries.

Add filtering and sorting to:

- questions
- security pools
- vaults
- reports

Useful controls include:

- search by question id, report id, pool address, or vault address
- filter by lifecycle stage
- filter by active universe versus different universe
- filter by user-relevant records versus all records
- sort by recency, pending status, or operational priority

### 9. Normalize Button Semantics

The UI should use a clearer visual language for different button intents.

At minimum, distinguish between:

- navigation
- refresh
- modal open
- approve
- submit
- destructive action

`Refresh`, `Approve`, `Open`, and `Execute` should not look interchangeable.

### 10. Transaction Queue Visibility

Pending transactions should be visible outside the local panel where they started.

Add a persistent transaction tray or queue surface that shows:

- action name
- target object
- current transaction status
- a link back to the related route or object

This should help operators who perform multiple transactions across routes.

### 11. Better Empty And Blocked States

Every empty or blocked state should answer three questions:

- why is this empty or blocked?
- is that normal?
- what can I do next?

Examples that need explicit handling:

- no pools yet
- no selected report
- migration unavailable before fork
- no child universes created yet
- no vault selected

### 12. Refresh Trust And State Freshness

The UI should make freshness easier to understand.

Important records should show:

- last updated time
- whether the data was auto-refreshed or manually refreshed
- whether a recent transaction result has already been incorporated

After a transaction, the UI should clearly state whether the displayed record is already updated.

### 13. Compact Blocker Explanations

Disabled actions should have a short, direct explanation available next to them.

Use patterns like:

- `Blocked: requires REP approval`
- `Blocked: no vault selected`
- `Blocked: report is not in dispute stage`
- `Blocked: pool belongs to a different universe`

This should reduce the need to scan the rest of the page to understand one disabled control.

### 14. Responsive Priority

The redesigned UI should preserve the same workflow hierarchy on smaller screens.

For narrow layouts:

- keep object identity and stage visible first
- keep action readiness above deep detail
- collapse lower-priority summaries earlier
- avoid tables as the only way to inspect important state

### 15. Workflow Summaries For Advanced Routes

The most complicated routes should begin with a short workflow summary strip.

This should:

- show 3 to 5 steps
- highlight the current step
- explain what the operator is trying to achieve in that route
- stay short enough to obey the copy constraints in this document

Best candidates:

- `Security Pools > Reporting`
- `Security Pools > Fork`
- `Open Oracle > Selected Report`
- `Zoltar` after fork

### 16. Scenario-Driven Entry Points

The UI should not rely only on route names to help users begin work.

Add compact scenario entry points where appropriate, especially on top-level route landing surfaces.

Examples:

- `Create a question`
- `Create a security pool`
- `Report an outcome`
- `Handle a fork`
- `Migrate REP`
- `Operate a vault`

These should act as clear workflow starts for users who think in tasks rather than in route taxonomy.

### 17. Before / Now / Next Framing

Important workspaces should communicate time and sequence more clearly.

Where lifecycle matters, the UI should show:

- the last meaningful event
- the current stage
- the next available step

This should not become a long timeline by default. It should be a compact framing surface that reduces the need for the user to reconstruct workflow state mentally.

Best candidates:

- reporting flows
- fork flows
- auction flows
- migration flows

### 18. Make Numbers Easier To Compare

Important numeric values should be presented comparatively, not just listed.

Prefer:

- aligned side-by-side values
- threshold versus current comparisons
- `Current`, `Required`, and `Needed` labels
- delta or gap indicators

Avoid making the user compare multiple precise numbers mentally across different parts of the page.

### 19. Reduce Address-First Presentation

Technical identifiers are necessary, but they should not dominate first read.

Prefer:

- human meaning first
- technical id second
- full identifier on demand

For example:

- `Pool for Question X`
- smaller address below
- copy action still available

This should make the UI easier to scan without hiding technical identity.

### 20. Group Actions By Operator Intent

Actions should be grouped by what the user is trying to achieve, not only by the underlying contract mechanics.

Examples:

- `Prepare`, `Approve`, `Submit`
- `Create`, `Open`, `Operate`
- `Report`, `Dispute`, `Settle`

This should make action areas read like workflows rather than implementation surfaces.

### 21. Stronger Transition States

The UI should visually distinguish between intermediate states such as:

- loading
- waiting for dependency
- waiting for wallet interaction
- waiting for chain confirmation
- refreshing after confirmation

These states should not all collapse into the same spinner treatment.

### 22. Make Advanced Detail Truly Secondary

Advanced and technical detail should remain available without competing with routine operation.

Use patterns like:

- expandable advanced sections
- compact default operator view
- optional technical mode for power users

The goal is to preserve seriousness while making the default workflow easier to read.

### 23. Improve Page Endings

The bottom of complex pages should feel intentional.

Each page should end with one of these:

- advanced detail
- recent related activity
- no further content

Avoid random low-priority leftovers at the bottom of the page.

### 24. Distinguish Object Types Visually

Questions, pools, vaults, reports, universes, and auctions should not all feel visually identical.

Use:

- distinct icons
- stable accent colors
- consistent header patterns
- consistent summary-card structure per object type

This should improve orientation without adding extra text.

### 25. Make Success Feel Conclusive

After an action succeeds, the UI should make completion feel final and trustworthy.

Do this by:

- clearly marking the completed action state
- retiring or de-emphasizing the action that was just completed
- elevating the next available action
- updating nearby summaries quickly

The user should feel that the interface and chain state are aligned, not merely that a transaction was accepted.

## Clarity Principles

The redesign should make the UI clearer without depending on large amounts of explanatory text.

The default communication order should be:

1. layout and hierarchy
2. color and emphasis
3. iconography
4. short labels
5. short helper text only when needed

Long explanatory copy should be avoided in the main workflow surfaces.

### 1. Lead With A Stage Sentence

Every actionable workspace should communicate one short state sentence near the top of the page.

Examples:

- `Report open for dispute`
- `Pool in reporting stage`
- `Universe forked`
- `Auction active`

This should usually be a compact label or banner, not a paragraph.

### 2. Lead With A Recommended Action Sentence

Near the primary action area, show one short sentence describing what the operator can do now.

Examples:

- `You can dispute this report now`
- `You can migrate REP now`
- `Select a vault to continue`

This should remain short enough to scan instantly.

### 3. Prefer Visual Meaning Over Explanatory Copy

Use visual systems to communicate meaning before adding text.

Examples:

- color-coded stage badges
- warning icons for risky actions
- success icons for completed steps
- muted styling for unavailable workflows
- stronger button treatment for the main action

The UI should not rely on paragraphs to explain ordinary state transitions.

### 4. Use Short Meaning Text For Advanced Actions

Some actions still need explanation, but it should be minimal.

Use one short supporting line for advanced or domain-heavy actions such as:

- `Create Child Universe`
- `Prepare REP`
- `Split REP`
- `Migrate Vault`
- `Claim Auction Proceeds`

The supporting line should explain purpose, not mechanics.

Good:

- `Finalize the child universe for the winning fork outcome`

Bad:

- a multi-sentence explanation of every step that follows

### 5. Separate State, Action, And Mechanics

To reduce cognitive load, every major screen should clearly separate:

- current state
- available actions
- execution mechanics

That means:

- the page shows what is true
- the action area shows what can be done
- the modal shows how to do it

The user should not need to read long text to distinguish those layers.

### 6. Reduce Duplicate Summaries

Do not repeat the same information in multiple formats on the same screen.

Each summary surface should have one job:

- header summary
  - object identity
- stage banner
  - lifecycle status
- action card
  - readiness and intent
- modal summary
  - execution context

Reducing duplicate summaries will make the interface feel simpler without removing information.

### 7. Make Disabled States Decisive

Blocked actions should use short, direct labels.

Preferred patterns:

- `Blocked: requires REP approval`
- `Blocked: no vault selected`
- `Blocked: report not disputable`

Avoid generic disabled states that force the user to search elsewhere on the page for the reason.

### 8. Distinguish Informational Surfaces From Actionable Ones

The UI should make it immediately obvious whether a surface is:

- read-only information
- a selector
- navigation
- an action launcher
- a submit action

This should be done with spacing, button style, icon usage, and hover or focus behavior rather than extra explanation text.

### 9. Show Consequences Before Commitment

Risky actions should communicate consequences before the submit step.

This should be done with:

- warning tone
- short consequence label
- clear object identification
- explicit final action wording

Examples:

- `Liquidate selected vault`
- `Start truth auction`
- `Create child universe`

The user should understand impact before confirming without needing to read long paragraphs.

### 10. Keep Scope Visible

In dense workflows, the UI should continuously show what object the user is acting on.

Scope should be visible through:

- sticky context bars
- compact object headers
- selected-row emphasis
- modal headers that repeat the target object

This is especially important when moving between pool-level, vault-level, report-level, and universe-level actions.

### 11. Make Modes Explicit

When a page can be in different modes, show that with short labels instead of relying on the user to infer it from the surrounding layout.

Examples:

- `Browsing Pools`
- `Operating on Pool`
- `Submitting Initial Report`
- `Reviewing Fork State`

These mode labels should be compact and visually integrated into the page header or stage area.

### 12. Teach Through Empty States

Empty states should explain what to do next with one short sentence, not a long explanation block.

Good examples:

- `No pools exist for this question yet`
- `Select a report to continue`
- `Migration becomes available after fork`

Short follow-up actions or links are better than longer descriptive text.

### 13. Avoid Metric Blobs

The redesign should avoid presenting large groups of metrics as undifferentiated tables or dense numeric walls by default.

When data is important, the UI should decide which values are:

- primary operational signals
- secondary supporting context
- deep technical detail

Those categories should not be rendered with equal visual weight.

Preferred patterns:

- small grouped metric cards for the most important values
- paired value-and-status rows for closely related numbers
- segmented summaries that group metrics by meaning
- expandable detail sections for low-priority technical values
- charts, timelines, or progress-style visuals when they communicate state better than raw numbers

Avoid:

- wide tables of unrelated metrics
- long stacks of equally styled key-value rows
- repeated summary cards that all look equally important
- showing every available number at the top of the page

This matters most in:

- pool summaries
- vault summaries
- reporting and fork state
- open oracle report detail

The goal is not to remove data. The goal is to present data in a way that reveals hierarchy, status, and relationships at a glance.

## Modal Design Rules

All transactional modals should follow these rules:

- one modal should represent one transaction intent
- approvals should live in the same modal as the operation that needs them
- destructive operations should have a stronger warning tone
- the final submit button should be the only primary action in the modal footer
- loading spinners should stay inside the action button that initiated the transaction
- the modal can repeat blocked requirements, but the route should already show them before click
- the modal should be for execution, not first-time discovery of core prerequisites

## What Should Stay Inline

Not everything should become modal-first.

Keep these inline:

- selectors that choose context for the page
- route-level environment gates
- readiness summaries and blocker explanations
- refresh actions
- tabs
- lightweight deploy actions
- read-only summaries
- question creation form
- pool creation form

Rationale:

- context selection belongs to the route
- object creation forms that define a new record can remain page-native
- transactional state changes on existing records benefit most from modals

## State And URL Contract

The redesign must preserve the current UI's ability to restore working context through URL state.

At minimum, the redesigned UI should preserve URL-backed state for:

- top-level route
- active universe context
- selected security pool
- selected report
- selected Zoltar subview
- simulation mode and scenario

The redesign should follow these rules:

- refreshing the page should preserve the current working object whenever that object is URL-backed
- browser back and forward should restore prior route and selected-object context without a full reset
- cross-route handoffs should update URL state immediately when a new route context becomes active
- modal open state does not need to be URL-backed by default
- transient form inputs inside a modal do not need to be URL-backed by default
- invalid URL-backed object state should degrade into a clear missing-state surface, not a broken page

Examples:

- opening a pool from `Browse` should update the URL-backed pool selection
- opening a pending report from a pool should update the selected report state as part of the route transition
- switching Zoltar views should remain deep-linkable

## Simulation Mode Treatment

Simulation should remain a clearly separated environment mode, not a redesign driver for the normal operator workflow.

The redesign should preserve these principles:

- simulation is informational context, not a blocker
- simulation controls remain visually distinct from production route UI
- simulation-specific caveats only appear near the features they affect
- simulation should not overload normal action readiness unless it changes a specific action's meaning

Examples:

- mock pricing controls belong in the simulation banner or a simulation-only surface, not inside normal price widgets
- if simulation disables live quote behavior, only quote-dependent actions should mention that limitation

## Exceptional-State Design

The redesign must explicitly handle non-happy-path states as first-class screens or panels.

These states include:

- wrong network
- setup incomplete
- missing selected object
- invalid deep link
- unsupported route
- loading with partial data
- hard data-load failure

Design rules:

- wrong network should remain a full-page gate for route content, not a small inline warning
- setup-incomplete state should clearly redirect or funnel the user toward `Deploy`
- missing selected object state should explain what object is missing and how to recover
- invalid deep-link state should preserve the route but show a recoverable missing-state surface
- unsupported route state should remain a dedicated `404` experience with clear recovery actions
- loading states should prefer purposeful skeletons or staged loading surfaces over blank panels
- hard failures should state what failed and whether retry is possible from the current screen

## Global Notice System

The redesign should formalize the app-wide notice stack instead of leaving notices as loosely related banners.

The notice system should support at least these categories:

- blocking environment notices
- warning notices
- transaction progress notices
- transaction success notices
- simulation bootstrap issues
- wallet guidance

Global notices should follow these rules:

- blocking notices appear above warning and status notices
- transaction progress should have a single global source of truth
- route-local result surfaces should complement global notices, not duplicate them
- success notices can fade or collapse once the route-level outcome summary is visible
- persistent warnings such as fork-state warnings should remain visible until the underlying state changes

## Fork And Auction Layout Contract

The current fork and auction workflows are too important to leave abstract in the redesign spec. The redesigned UI should keep their stages explicit.

### Fork `Initiate`

This stage should show:

- current pool or universe fork status
- direct initiation options
- recommended initiation path
- blocking conditions

Action area:

- `Initiate Pool Fork`
- `Fork With Own Escalation`
- any direct-fork launcher if still supported

### Fork `Migration`

This stage should show:

- created versus missing child universes
- REP migration availability
- vault migration availability
- escalation-deposit migration availability

Action area:

- `Create Child Universe`
- `Migrate REP To Zoltar`
- `Migrate Vault`
- `Migrate Escalation Deposits`

### Fork `Auction`

This stage should show:

- truth-auction status
- current best bid or bid state
- whether auction start, bidding, refund, or finalization is available

Action area:

- `Start Truth Auction`
- `Submit Bid`
- `Refund Losing Bid`
- `Finalize Truth Auction`

### Fork `Settlement`

This stage should show:

- whether proceeds are claimable
- whether bids are withdrawable
- any remaining settlement dependencies

Action area:

- `Claim Auction Proceeds`
- `Withdraw Bids`

Across all fork stages:

- use one stage banner
- keep only the current stage's main actions visually primary
- move lower-priority technical fields and historical detail below the stage action area

## Visual System Contract

The redesign should define a lightweight but explicit visual system so the interface does not regress into generic cards and tables.

At minimum, define:

- color roles for routine, warning, destructive, success, and informational states
- icon roles for object type, risk level, and status
- badge roles for lifecycle stage and readiness state
- spacing tiers for page, section, card, and inline grouping
- stable card patterns for questions, pools, vaults, reports, universes, and auctions
- default replacements for dense tables, such as grouped cards, segmented summaries, and expandable details
- responsive collapse rules for small screens

The goal is to make the UI more legible and more visually intentional without becoming decorative.

## Do Not Regress

The redesign must not lose the current UI's strongest operational properties.

Do not regress on:

- disabled actions explaining why they are unavailable
- explicit cross-route handoffs
- visible object identity while operating
- advanced protocol actions remaining available somewhere in the UI
- deep-linkable working context
- simulation usefulness for QA
- obvious mainnet and setup gating

## Implementation

This section is the build-facing layer of the document.

Use it to answer:

- which shared modules should exist
- how current controls map into the redesign
- which states must remain supported
- how to phase the rollout without losing important behavior

## Route Implementation Requirements

This section is the practical build checklist for the redesign. It should be enough for an implementer to translate the existing UI into the redesigned one without inventing the interaction model from scratch.

### App Shell Requirements

Keep these elements visible:

- wallet summary
- balance summary
- active universe summary
- pricing summary
- top-level route tabs
- global notice stack

Change the shell in these ways:

- show route-level environment gates only when failing
- keep simulation as a lightweight environment context, not a blocker
- make the active universe and route context easier to identify at a glance
- normalize notice styling so blocking notices, warnings, and transaction notices feel like one system

### Deploy Requirements

Keep these capabilities:

- deployment progress visibility
- individual deploy actions
- `Deploy Next Missing`

Redesign requirements:

- show the deployment summary before the action list
- make the next recommended deploy action visually primary
- keep per-step actions available but secondary
- collapse already-complete deployment groups by default
- show blocked deployment reasons in one place rather than across multiple rows

### Zoltar Requirements

Keep these capabilities:

- browse questions
- create question
- select question for fork
- fork Zoltar
- prepare and split REP
- post-fork universe actions

Redesign requirements:

- keep `Create Question` inline
- keep `Questions`, `Fork`, and `Migration` as distinct workflow surfaces
- show the active universe stage clearly above the question registry
- when forked, elevate migration and child-universe actions above routine question browsing
- keep question-to-pool handoffs explicit and visible

### Security Pools Requirements

Keep these capabilities:

- browse pools
- create pool
- open selected pool
- liquidate vault
- operate on vaults
- trading flows
- reporting flows
- fork and auction flows

Redesign requirements:

- keep `Browse`, `Create`, and `Operate` as the main route modes
- make `Browse` searchable and easier to scan
- keep `Create` inline with a stronger requirements strip and clearer post-success handoff
- make `Operate` use a sticky selected-pool context bar
- separate `Pool State`, `Action Readiness`, `Workflow Tabs`, and `Advanced Details`
- convert state-changing operations on existing records to modal execution
- keep lists and read-only summaries visible while modals handle execution

#### Security Pools `Operate > Vaults`

Build this surface around:

- selected pool summary
- selected vault summary
- vault list or directory
- action launcher cards for write operations

Do not keep multiple unrelated amount inputs open on the page at the same time.

#### Security Pools `Operate > Trading`

Build this surface around:

- trading state summary
- action launcher cards for mint, redeem, migrate, and share redemption
- compact readiness and result surfaces

#### Security Pools `Operate > Reporting`

Build this surface around:

- reporting stage banner
- escalation metrics
- outcome-side context
- modal launchers for reporting and withdrawal

#### Security Pools `Operate > Fork`

Build this surface around:

- fork stage banner
- workflow summary strip
- currently available lifecycle actions
- lower-priority historical or technical detail below the main action area

### Open Oracle Requirements

Keep these capabilities:

- browse reports
- open selected report
- create open oracle game
- initial report
- dispute and swap
- settle report

Redesign requirements:

- keep `Browse Reports` as the main entry surface
- keep report details accessible but reduce their visual competition with the active action
- make selected-report pages stage-driven
- move transaction-heavy selected-report actions into modals
- keep the linked pool or route handoff visible when present

### Shared Delivery Requirements

Across all routes:

- selected object identity should remain visible while working
- blocked actions should have compact local explanations
- lists should support search or filtering when they are the main entry to work
- success states should describe the resulting workflow state, not only the transaction state
- refresh behavior should expose whether data is fresh enough to trust

## Route Layout Contracts

These are the default layout contracts for the major redesigned workspaces. They are intended to reduce ambiguity when implementing page structure.

### Deploy Layout Contract

Use this order:

1. route header and deployment progress
2. environment gate if failing
3. action readiness panel for deployment
4. `Deploy Next Missing`
5. grouped deployment sections
6. advanced per-step controls

### Zoltar Layout Contract

Use this order:

1. route header and universe identity
2. universe stage banner
3. subview tabs
4. active subview summary
5. action readiness or next-action area
6. main working surface
7. advanced or historical detail

### Security Pools Layout Contract

For `Browse`:

1. route header
2. search and filter controls
3. browse summary
4. pool registry
5. liquidation launcher or related modal entry

For `Create`:

1. route header
2. carried-forward question context if present
3. requirements strip
4. create form
5. post-success handoff

For `Operate`:

1. sticky selected-pool context
2. pool stage banner
3. workflow tabs
4. action readiness panel
5. action launcher group
6. supporting data panels
7. advanced details

### Open Oracle Layout Contract

For `Browse`:

1. route header
2. browse summary
3. report list
4. pagination and filters

For `Selected Report`:

1. sticky report context
2. report stage banner
3. action mode selector if needed
4. action readiness and launcher area
5. report summary
6. supporting report detail
7. advanced detail

## Current-To-New Control Migration Map

This section maps the most important current UI controls into their redesigned homes.

### App Shell

- `Connect wallet`
  - stays in the shell
  - remains primary only when disconnected
- top route tabs
  - stay in the shell
  - keep the same route model
- REP price refresh
  - stays inline as a lightweight refresh action
- `Go to Genesis universe`
  - stays route-level or shell-level as a recovery action
  - should be visually secondary

### Zoltar

- `Create Question`
  - stays inline
  - remains page-native because it creates a new record
- `Use For Fork`
  - stays inline on question records
  - becomes a stronger handoff action
- `Use For Create Pool`
  - stays inline on question records
  - becomes a stronger handoff action
- `Fork Zoltar`
  - moves from inline workflow to modal execution
- `Prepare REP`
  - moves to modal execution
- `Split REP`
  - moves to modal execution
- child-universe deployment actions
  - remain visible in post-fork actions
  - can launch focused execution modals if inputs are needed

### Security Pools

- `Create Pool`
  - stays inline
  - remains page-native because it creates a new record
- `Open Pool`
  - stays inline as navigation
- `Liquidate Vault`
  - keeps the existing modal-first pattern
  - becomes the reference interaction for other state-changing actions
- `Deposit REP`
  - moves from inline form to action card plus modal
- `Withdraw REP`
  - moves from inline form to action card plus modal
- `Set Security Bond Allowance`
  - moves from inline form to action card plus modal
- `Claim Fees`
  - moves from inline button to action card plus modal or confirmation modal
- `Mint Complete Sets`
  - moves to action card plus modal
- `Redeem Complete Sets`
  - moves to action card plus modal
- `Migrate Shares`
  - moves to action card plus modal
- `Redeem Shares`
  - moves to action card plus modal
- `Report / Contribute`
  - moves to action card plus modal
- `Withdraw Escalation Deposits`
  - moves to action card plus modal
- fork and auction actions
  - remain visible in stage-specific action groups
  - execute through focused modals

### Open Oracle

- `Create Open Oracle Game`
  - stays inline as a route-level creation form
- `Open report`
  - stays inline as navigation
- `Submit Initial Report`
  - moves to action card plus modal
- `Dispute & Swap`
  - moves to action card plus modal
- `Settle Report`
  - moves to action card plus confirmation modal

## Modal Inventory

The redesign should define and build these modal surfaces explicitly.

### Core Modal Types

- `Deposit REP`
- `Withdraw REP`
- `Set Security Bond Allowance`
- `Claim Fees`
- `Mint Complete Sets`
- `Redeem Complete Sets`
- `Migrate Shares`
- `Redeem Shares`
- `Report / Contribute`
- `Withdraw Escalation Deposits`
- `Fork Zoltar`
- `Prepare REP`
- `Split REP`
- `Create Child Universe`
- `Migrate REP To Zoltar`
- `Migrate Vault`
- `Migrate Escalation Deposits`
- `Start Truth Auction`
- `Submit Bid`
- `Refund Losing Bid`
- `Claim Auction Proceeds`
- `Withdraw Bids`
- `Submit Initial Report`
- `Dispute & Swap`
- `Settle Report`

### Modal Contract

Each modal definition should specify:

- modal name
- triggering route and subview
- target object type
- fields shown
- approvals handled inside the modal
- success and result behavior
- risk level
- whether it is a simple confirm modal or an input-driven modal

## State Matrix

The redesign should keep a compact state matrix for the most lifecycle-driven objects.

At minimum, define matrices for:

- universe state
- selected pool state
- selected report state
- fork stage
- truth-auction stage

Each matrix should document:

- current stage
- visible stage banner
- visible actions
- blocked actions
- recommended next action
- local blockers that must be shown

## Information Priority System

The redesign should classify information into four tiers so visibility decisions stay consistent.

- critical
  - object identity, lifecycle stage, global blockers, current primary action
- important
  - local action blockers, balances needed for the current workflow, result state, linked context
- supporting
  - secondary metrics, neighboring actions, historical context
- advanced
  - deep technical diagnostics, raw ids, detailed breakdowns, low-frequency maintenance controls

This priority system should drive:

- default visibility
- sticky context inclusion
- collapse behavior
- modal summaries
- section ordering

## Reusable Presentation Patterns

The redesign should define a small set of presentation patterns and reuse them consistently.

- registry list
  - searchable, filterable, state-tagged list of records
- selected-object card
  - compact identity, stage, and key state summary
- comparison metrics group
  - side-by-side current, required, and needed values
- lifecycle summary
  - before / now / next framing
- action card group
  - local blockers plus execution launchers
- advanced detail accordion
  - collapsible technical detail

This should reduce one-off layouts and make the interface easier to learn.

## Copy Constraints

The redesigned UI should stay concise by default.

Apply these constraints:

- stage messaging should usually be one short sentence or less
- recommended-action messaging should usually be one short sentence or less
- helper text should be reserved for high-risk, domain-heavy, or unusual actions
- primary workflow surfaces should avoid paragraph-length explanation
- empty-state guidance should be short and action-oriented
- repeated helper text should be avoided when the same meaning can be conveyed with structure or labels

## Redesign Acceptance Criteria

The redesign should be considered successful only if these conditions are met.

- a user can identify the current object and its stage quickly from the top of the workspace
- blocked actions always show a local reason
- no current state-changing operation is lost
- deep-linkable working context still works for core objects and routes
- transaction success always produces a visible state-change summary
- advanced actions remain accessible without dominating the default workflow
- pages no longer rely on dense inline transaction forms for routine state changes on existing records
- metric-heavy surfaces no longer default to large undifferentiated tables or numeric walls

## Patterns To Avoid

Avoid these redesign regressions:

- too many equally weighted cards on the same screen
- repeating global blockers on every action card
- revealing basic prerequisites only after opening a modal
- raw metric dumps without hierarchy
- address-first headers
- duplicate summaries that restate the same information
- long explanatory paragraphs inside primary action areas
- multiple unrelated amount inputs open at once on the same workflow surface

## Rollout Sequence By Dependency

If the redesign is implemented incrementally, use this dependency order:

1. shared visual system and presentation patterns
2. environment gate and notice system
3. sticky selected-object context
4. action readiness and blocker presentation
5. modal shells and modal contracts
6. route-by-route action migration
7. advanced-detail cleanup and metric presentation improvements

## Risks and Tradeoffs

### Benefits

- cleaner routes
- fewer visible inputs at once
- stronger action clarity
- approvals feel attached to real tasks
- easier operator scanning

### Risks

- too many modals could feel heavy if overused
- advanced users may prefer inline power workflows
- modals need careful keyboard/focus handling
- some multi-step flows may need staged modal design, not a single simple dialog

### Mitigation

- use modal-first mainly for state-changing operations on existing entities
- keep action prerequisites and blockers visible on the route
- show universal environment blockers once per route instead of duplicating them per action
- keep object creation inline where it improves flow
- support deep links back to the underlying route context
- preserve advanced read-only details outside the modal

## Recommended First Pass

If this redesign is implemented incrementally, start here:

1. build the shared action-card, modal, notice, and sticky-context foundations
2. convert vault actions to modal-first
3. convert trading actions to modal-first
4. convert reporting actions to modal-first
5. convert Open Oracle selected-report actions to modal-first

This would capture most of the clarity benefit without redesigning every page at once.

## Relationship To Current UI

The current UI should continue to be documented in [`docs/ui.md`](./ui.md).

This proposal keeps:

- the same route model
- the same protocol actions
- the same operational seriousness

This proposal changes:

- action placement
- write-flow interaction model
- balance between inline forms and modal workflows
- visual priority between state display and action execution
