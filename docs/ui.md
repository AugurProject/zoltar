# UI Guide

This document explains how the UI works from an operator's perspective. It is intended to provide a text explanation of the interface alongside the UI itself.

## Reading the UI

The UI is built as a restrained operations interface. Each route follows the same general rhythm:

- a route header or top summary
- a context strip or overview
- tabs when a route has multiple working modes
- one or more task sections for the active workflow

Most content appears inside section-level wrappers. Record-style cards are reserved for concrete things such as questions, reports, pools, or vaults. Actions that the UI can already determine are unavailable are disabled before submission, and the UI shows the reason directly instead of letting the user send a known-failing transaction.

## App Shell and Navigation

The app shell has two main layers:

- the top overview area, which shows wallet state, balances, REP pricing, and the active universe
- the route navigation tabs, which switch between the main app sections

The UI uses hash routing. The top-level routes are:

- `#/deploy`
- `#/zoltar`
- `#/security-pools`
- `#/open-oracle`

If the page loads without a hash, the app defaults to `#/zoltar`.

Outside the `Deploy` route, the main workflows are gated behind setup. Until the required Augur PLACEHOLDER deployment state is ready, the non-deploy tabs stay disabled and explain that deployment must be completed first. If setup becomes incomplete while the user is on another route, the app redirects back to `Deploy`.

The overview panel shows:

- wallet connection state and the connected address
- ETH, WETH, and REP balances when a wallet is connected
- REP/ETH and REP/USDC price references, with a refresh control for the REP/ETH quote
- the active universe label

If the user is connected to an unsupported chain, the route content is replaced by a mainnet gate message instead of rendering the selected route workflow.

### App Shell Controls

- `Connect wallet` connects the injected wallet when no account is connected.
- The REP/ETH refresh button reloads the displayed REP pricing source.
- The top route tabs switch between `Deploy`, `Zoltar`, `Security Pools`, and `Open Oracle`.

## Global Notices and Transaction State

Above the route content, the app can show page-wide notices for:

- simulation bootstrap failures
- the active Zoltar universe having already forked
- setup being incomplete and the app requiring the `Deploy` flow
- wallet availability guidance when no injected wallet is present
- transaction progress and the most recent transaction hash

Transaction state is shared across the app. While a transaction is waiting on wallet confirmation or onchain confirmation, the UI shows a global pending notice. Buttons that launched pending actions also keep their loading state in place and stay disabled until the action resolves.

## Simulation Mode

Appending `?simulate=1` switches the app from the injected-wallet backend to the browser simulation backend. In this mode, a simulation banner appears above the normal top shell.

The simulation banner exposes:

- the active simulation scenario, selected with `simScenario`
- the active QA account
- query delay controls for slower read paths
- REP/ETH and REP/USDC mock price controls
- transaction receipt delay controls
- reset, mine block, `+1 hour`, and `+1 day` controls

Simulation mode is intended for walletless or repeatable manual QA. It seeds known accounts and lets the operator move blockchain time forward without leaving the browser. Per the repo guidance, Uniswap-backed REP pricing is intentionally disabled in simulation mode, so quote-dependent features are expected to degrade gracefully rather than assume mainnet liquidity.

### Simulation Controls

- The scenario selector changes the seeded simulation scenario and reloads the page into that scenario.
- The QA account selector switches which seeded account the UI uses.
- `Query delay (ms)` adds artificial latency to read calls.
- `REP / ETH mock price` sets the simulated REP/ETH price.
- `REP / USDC mock price` sets the simulated REP/USDC price.
- `Transaction receipt delay (ms)` adds artificial latency before simulated transactions confirm.
- `Reset scenario` resets the simulation back to its seeded state.
- `Mine block` advances the simulation by one block.
- `+1 hour` advances simulation time by one hour.
- `+1 day` advances simulation time by one day.

## URL-Driven State and Deep Linking

In addition to the hash route, the UI stores several pieces of user-visible state in query params:

- `universe`
- `reportId`
- `securityPool`
- `zoltarView`
- `simulate`
- `simScenario`

These params let the UI restore or deep-link into working context:

- `universe` controls the active Zoltar and pool universe context
- `reportId` reopens or preloads a selected Open Oracle report
- `securityPool` reopens a selected pool inside Security Pools
- `zoltarView` reopens the selected Zoltar subview
- `simulate` and `simScenario` choose the simulated backend and seeded scenario

The app updates these values with browser history APIs, so back and forward navigation preserve them without a full page reload.

## Route Guide

### Deploy

`Deploy` is the setup route for deterministic contract deployment. It exists to bring the shared app contracts into the expected deployed state before the rest of the UI is usable.

The route header summarizes:

- how many deployment steps are already deployed
- the next deployable step

The primary action is `Deploy Next Missing`. Below that, the route groups deployment steps into deployment sections, so operators can see which contracts belong together and can also trigger individual deployment actions where needed.

When setup is incomplete, this route becomes the prerequisite path for the rest of the app.

#### Deploy Controls

- `Deploy Next Missing` submits the next deployable deterministic deployment step.
- Per-group deployment actions deploy individual contracts inside the grouped deployment sections.
- The route header summary is read-only and shows deployment progress rather than accepting input.

### Zoltar

The `Zoltar` route is the main universe and question-management area. It has four subviews:

- `Questions`
- `Create Question`
- `Fork Zoltar`
- `Migrate REP`

The top tabbed block summarizes the active universe. In `Questions`, it can show a fuller universe overview. In the other views, it compresses that into smaller universe, status, and question-count metrics.

#### Questions

The `Questions` view is used to fetch and browse questions in the active universe.

It supports:

- loading or refreshing the question list
- reviewing each question in a record card
- sending a question into the fork flow with `Use For Fork`
- sending a binary question into the pool-creation flow with `Use For Create Pool`

If the universe has already forked, the fork action is disabled and replaced with an already-forked state.

##### Questions Controls

- `Questions`, `Create Question`, `Fork Zoltar`, and `Migrate REP` are the Zoltar view tabs.
- `Fetch Questions` loads the question list the first time.
- `Refresh Questions` reloads the question list after an earlier load.
- `No Questions` appears as a disabled state when the universe has no questions.
- `Use For Fork` copies the selected question into the fork workflow and opens the `Fork Zoltar` tab.
- `Use For Create Pool` copies a binary question into the Security Pools create flow and navigates there.

#### Create Question

The `Create Question` view creates new Zoltar questions. The form supports:

- `Binary`
- `Categorical`
- `Scalar`

The operator can set title, description, timing, and type-specific fields. Scalar questions also show a live preview once the scalar inputs are valid enough to derive the outcome ticks.

After creation, the UI shows the created question as a record card and exposes follow-up actions:

- `Use For Fork`
- `Use For Create Pool`
- `Create Another Question`

This makes the view both a creation flow and a handoff point into downstream workflows.

##### Create Question Fields and Buttons

- `Question Type` chooses between `Binary`, `Categorical`, and `Scalar`.
- `Title` sets the market title shown in question cards and summaries.
- `Description` adds optional explanatory text for the question.
- `Start Time` sets when the market becomes active.
- `End Time` sets when the market closes.
- `Outcomes` appears for categorical markets and lets the operator add, edit, and remove categorical labels.
- `Add Outcome` adds another categorical outcome row.
- `Remove` deletes one categorical outcome row.
- `Scalar Min`, `Scalar Increment`, `Scalar Max`, and `Answer Unit` appear for scalar markets and define the scalar range and display unit.
- The scalar preview is read-only and shows how the scalar tick slider resolves from the entered bounds.
- `Create Question` submits the new question.
- After creation, `Use For Fork` passes the new question into the fork flow.
- After creation, `Use For Create Pool` passes the new question into pool creation when the question is binary.
- `Create Another Question` clears the result card and returns to the input form.

#### Fork Zoltar

The `Fork Zoltar` view is focused on selecting the fork question and executing the fork path. It surfaces:

- the selected question context
- REP approval state
- fork eligibility and block reasons
- the active fork transaction state

Operators typically arrive here by selecting `Use For Fork` from the questions list or from a newly created question.

##### Fork Zoltar Fields and Buttons

- The REP approval control approves enough REP to satisfy the fork threshold.
- `Fork Question ID` selects the question that will trigger the universe fork.
- The selected-question card is read-only and confirms which question will be used.
- `Fork Zoltar` submits the fork transaction once wallet, network, REP balance, approval, and question selection all satisfy the guard conditions.

#### Migrate REP

The `Migrate REP` view handles post-fork REP preparation and migration into child universes.

It only becomes usable after the universe has forked. Before that, the tab remains disabled and shows the reason directly in the UI. Once enabled, it supports preparing REP for migration and executing migration actions into child-universe balances.

##### Migrate REP Fields and Buttons

- `Migration Amount` sets how much REP should move through the migration workflow.
- `Max` fills `Migration Amount` with all wallet REP plus already prepared migration REP available in the universe.
- The REP approval control approves any additional REP still needed to prepare the chosen migration amount.
- The migration outcome selector lists child universes and lets the operator choose which outcome universes receive the split.
- `Add Next Outcome` adds the next unselected child universe to the split set.
- Outcome toggles select or deselect individual target universes.
- `Prepare REP` moves wallet REP into the migration balance for the active universe.
- `Split REP` splits prepared migration REP across the selected outcome universes.
- The migration summary card is read-only and shows the last migration action, amount, and selected outcomes.

### Security Pools

The `Security Pools` route has three high-level modes:

- `Browse`
- `Create`
- `Operate`

#### Browse

`Browse` loads the pool registry and lists deployed pools. From here, the operator can:

- inspect deployed pool records
- open a selected pool into the `Operate` workspace
- access liquidation entry points where the loaded pool and vault context exposes them

The route auto-loads pool data when this view opens for the first time.

##### Browse Controls

- `Browse`, `Create`, and `Operate` are the Security Pools route tabs.
- Pool selection actions open the selected pool inside `Operate`.
- Liquidation entry buttons appear only where the loaded vault and oracle-manager context makes liquidation available.

#### Create

`Create` is the pool-deployment workflow. It guides the operator through:

- loading or confirming the binary market question context
- checking for existing pools tied to the same origin question
- reviewing existing pool records for that question
- configuring pool parameters such as the security multiplier and retention rate
- deploying the pool

This view is designed to receive a binary question from Zoltar through the `Use For Create Pool` handoff.

##### Create Fields and Buttons

- `Question ID` selects the binary question used as the pool's origin market.
- `Security Multiplier` sets the collateralization multiplier for the pool.
- `Open Interest Fee / Year (%)` sets the pool's retention-rate-based open-interest fee.
- `Create Pool` submits a pool deployment for the entered question and settings.
- `Open Pool` appears after a successful deployment and jumps into the new pool's `Operate` workspace.
- `Create Another Pool` appears after a successful deployment and resets the create form.
- The `Question Context` section is read-only and shows the loaded market.
- The `Existing Pools` section is read-only and lists pools already created for the same question.

#### Operate

`Operate` opens a selected-pool workspace. If the app has a valid `securityPool` query param but has not yet loaded that pool into the registry view, it refreshes selected-pool data automatically.

The selected pool workspace includes summary data such as:

- pool status and question context
- the pool's oracle-manager context
- price-oracle refresh controls
- a `Request New Price` action when the oracle-manager state allows it

If the selected pool belongs to a different universe than the app's active universe, the UI shows a universe mismatch warning and tells the operator to switch to the same universe before using the pool.

Inside `Operate`, the main subviews are:

- `Vaults`
- `Trading`
- `Reporting`
- `Fork`

##### Operate Controls

- The vertical workflow tabs switch between `Vaults`, `Trading`, `Reporting`, and `Fork`.
- `Refresh Oracle` reloads the pool oracle-manager view.
- `Request New Price` asks the oracle-manager flow to queue or request a fresh price when allowed.
- The pool summary and question cards are read-only and anchor the active pool context.

##### Vaults

The `Vaults` subview is split again into:

- `Directory`
- `Selected`

`Directory` lists vaults for the selected pool. From there, the operator can:

- choose a vault with `Select Vault`
- open liquidation for a vault when the loaded context allows it

`Selected` focuses on a single vault and its actions. The vault workflow supports:

- claiming fees
- depositing REP
- setting security bond allowance
- withdrawing REP

If the selected vault is not owned by the connected account, the UI keeps the vault visible but explains that the actions are read-only until the operator selects their own vault.

###### Vaults Fields and Buttons

- `Directory` and `Selected` are the vault-local view tabs inside the `Vaults` workspace.
- `Selected Vault Address` chooses which vault to inspect or operate on.
- `Refresh` reloads the selected vault from chain state.
- `Select Vault` copies a vault from the directory into the selected-vault workflow.
- `Liquidate Vault` opens the liquidation flow for that vault when the current pool and oracle state allows it.
- `Claim Fees` redeems claimable ETH fees from the selected owned vault.
- `REP Deposit Amount` sets the REP deposit amount.
- Deposit `Max` fills the REP deposit field from the wallet REP balance.
- The REP approval control approves enough REP for the deposit amount.
- `Create / Deposit REP` creates a new vault if needed or deposits REP into the selected owned vault.
- `Security Bond Allowance Amount` sets the new security bond allowance in ETH terms.
- `Set Security Bond Allowance` queues the allowance update for the selected owned vault.
- `REP Withdraw Amount` sets how much withdrawable REP to remove from the vault.
- Withdraw `Max` fills the withdrawal field with the vault's currently withdrawable REP.
- `Withdraw REP` queues the REP withdrawal for the selected owned vault.

##### Trading

The `Trading` subview handles share and complete-set flows for the selected pool. It supports:

- minting complete sets
- redeeming complete sets
- migrating forked shares
- redeeming resolved shares

This is the pool-level share operations workspace rather than a general exchange UI.

###### Trading Fields and Buttons

- `Security Pool Address` appears when the trading section is used standalone and selects the target pool.
- `Mint Complete Sets Amount` sets how many complete sets to mint.
- `Mint Complete Sets` submits the mint transaction.
- `Redeem Complete Sets Amount` sets how many complete sets to redeem back into collateral.
- Redeem `Max` fills the redemption amount from the wallet's maximum redeemable complete sets.
- `Redeem Complete Sets` submits the complete-set redemption.
- `Share Outcome To Migrate` chooses which share side is being migrated after a fork.
- The share-migration target selector chooses the destination child outcomes for migrated shares.
- `Select All` in the target selector fills all available destination outcomes.
- `Clear` clears the selected migration targets.
- Individual target toggles add or remove a destination outcome.
- `Migrate Shares` submits the share migration.
- `Redeem Shares` redeems finalized or otherwise redeemable shares.
- The `Your Shares` metrics are read-only and show wallet balances for `Yes`, `No`, `Invalid`, and `Total Complete Sets`.

##### Reporting

The `Reporting` subview focuses on escalation and reporting for the selected pool. It shows the reporting context and supports:

- loading the reporting or escalation state
- reporting an outcome
- withdrawing escalation deposits

It is the main operator view for the pool's reporting and dispute lifecycle.

###### Reporting Fields and Buttons

- `Security Pool Address` appears when the reporting section is used standalone and selects the target pool.
- `Refresh reporting` loads or reloads escalation and reporting state for the selected pool.
- `Outcome Side` chooses which reporting side the next contribution or withdrawal targets.
- `Report / Contribution Amount` sets the REP amount to stake on the selected reporting side.
- `Report / Contribute On Selected Side` submits the reporting or contribution transaction.
- `Withdraw Deposit Indexes` optionally narrows withdrawal to specific deposit indexes on the selected side.
- Leaving `Withdraw Deposit Indexes` empty means withdraw all of the operator's deposits on that side.
- `Withdraw Escalation Deposits` submits the withdrawal transaction.
- The reporting preview text is read-only and estimates possible profit if the selected side wins and later contributions do not change the pool.
- The escalation metrics and side cards are read-only and summarize bond size, threshold, timer, leading outcome, and user stake.

##### Fork

The `Fork` subview is the selected pool's fork and truth-auction workspace. It covers the lifecycle from fork initiation through migration and auction settlement.

The actions exposed here include:

- forking with the operator's own escalation
- initiating a pool fork
- direct universe fork actions
- creating child universes
- migrating REP, vault state, and escalation deposits
- starting the truth auction
- submitting bids
- finalizing the truth auction
- refunding losing bids
- claiming auction proceeds
- withdrawing bids

This is the deepest lifecycle workspace in the Security Pools route.

###### Fork Fields and Buttons

- `Security Pool Address` selects the pool whose fork and auction lifecycle is being inspected.
- `Refresh fork` loads or reloads the fork and truth-auction state.
- `Initiate`, `Migration`, `Auction`, and `Settlement` are lifecycle tabs for the fork workspace.
- `Fork With Own Escalation` starts a fork using the operator's own escalation path.
- `Initiate Pool Fork` triggers the pool-level fork path.
- `Direct Fork Universe ID` sets the universe to fork directly.
- `Direct Fork Question ID` sets the direct fork question.
- `Fork Universe Directly` submits the direct universe fork.
- `Outcome` in `Create Child Universe` selects which child outcome universe to deploy.
- `Create ... Child Universe` deploys the child universe for the selected outcome.
- `REP Migration Outcomes` lists the REP migration outcome names or keys used when migrating REP into Zoltar from the pool flow.
- `Migrate REP To Zoltar` submits that REP migration.
- `Outcome` in `Migrate Vault` selects which child outcome receives the migrated vault.
- `Vault Address` in `Migrate Vault` chooses which vault to migrate. Leaving it empty uses the connected wallet's vault context.
- `Migrate Vault` submits the vault migration.
- `Outcome` in `Migrate Escalation Deposits` selects which child outcome receives the migrated deposits.
- `Escalation Deposit Indexes` selects which deposit indexes to migrate.
- `Migrate Escalation Deposits` submits the escalation deposit migration.
- `Start Truth Auction` starts the truth auction once the lifecycle reaches that stage.
- `Bid Tick` sets the tick for the submitted bid.
- `Bid Amount (ETH)` sets the ETH amount offered in the bid.
- `Submit Bid` submits the auction bid.
- The bid estimate text is read-only and shows the approximate REP that would be purchased at the current clearing price.
- `Finalize Truth Auction` finalizes the auction once it is ready.
- `Refund Tick` selects the tick for a losing-bid refund.
- `Refund Bid Index` selects the bid index to refund.
- `Refund Losing Bid` submits the refund.
- `Vault Address` in `Claim Auction Proceeds` selects the vault that should claim auction proceeds. Leaving it empty uses the connected wallet's vault context.
- `Claim Bid Tick` selects the winning bid tick to claim against.
- `Claim Bid Index` selects the winning bid index to claim against.
- `Claim Auction Proceeds` claims proceeds for that bid position.
- `Withdraw For Address` selects the address whose bids should be withdrawn. Leaving it empty uses the connected wallet.
- `Withdraw Tick` selects the auction tick to withdraw from.
- `Withdraw Bid Index` selects the bid index to withdraw.
- `Withdraw Bids` submits the withdrawal.

#### Security Pools Route Handoffs

The route-level handoffs are:

- a Zoltar question can prefill the pool creation workflow
- a selected pool can open a pending report inside `Open Oracle`

When the user opens a pending report from the selected pool workspace, the app navigates to `#/open-oracle`, fills the report id, and loads that report.

### Open Oracle

The `Open Oracle` route has three working states exposed through tabs:

- `Browse`
- `Create`
- `Selected Report`

The first two are route-level entry points. The third becomes the focused report workspace once a specific report is loaded or selected.

#### Browse Reports

`Browse` loads paginated Open Oracle report summaries. The route header shows:

- total browse count
- page
- the selected report id, if any

Inside the browse section, the operator can:

- page through report summaries
- inspect per-report status badges
- open a report with `Open report`

The page size is fixed.

##### Browse Fields and Buttons

- `Browse`, `Create`, and `Selected Report` are the Open Oracle route tabs.
- `Previous Page` loads the prior report-summary page.
- `Next Page` loads the next report-summary page.
- `Open report` loads a selected report into the `Selected Report` workspace.
- The route header metrics are read-only and show browse count, page, and selected report id.

#### Create Open Oracle Game

`Create` is a direct report-instance creation flow. It is separate from any pool oracle-manager workflow and creates a standalone Open Oracle game.

The form exposes fields for:

- token addresses
- exact token1 report amount
- settler reward
- ETH value to send
- fee percentage
- multiplier
- settlement time
- escalation halt
- dispute delay
- protocol fee

The main action is `Create Open Oracle Game`.

##### Create Open Oracle Game Fields and Buttons

- `Token1 Address` sets the first token contract for the oracle game.
- `Token2 Address` sets the second token contract.
- `Exact Token1 Report` sets the exact token1 amount that reports must satisfy.
- `Settler Reward` sets the ETH reward paid to the settler.
- `ETH Value To Send` sets the ETH value attached to the creation transaction.
- `Fee Percentage` sets the report fee percentage.
- `Multiplier` sets the oracle multiplier.
- `Settlement Time` sets the base settlement delay.
- `Escalation Halt` sets the escalation halt threshold.
- `Dispute Delay` sets the delay before disputes or settlement progression.
- `Protocol Fee` sets the protocol fee share.
- `Create Open Oracle Game` submits the standalone game creation.

#### Selected Report

`Selected Report` is the loaded report workspace. The UI chooses the visible action mode from the report state and presents one of the following paths.

##### Selected Report Fields and Buttons

- `Report ID` chooses which report to load in the selected-report workspace.
- `Open report` loads the report if nothing is loaded yet.
- `Refresh report` reloads the report if it is already loaded.
- The report summary and identity/economics/status/settlement/callback sections are read-only and expose the full report state.

##### Initial Report

When the report still needs its first report, the UI exposes:

- manual price entry
- `Fetch price from Uniswap`
- token approval controls for both tokens
- optional ETH-to-WETH wrapping when needed
- `Submit Initial Report`

The section also shows the price source and any visible prerequisite or blocking messages.

###### Initial Report Fields and Buttons

- `Price (token1 / token2)` sets the initial reported price.
- `Fetch price from Uniswap` asks the UI to populate the price from the quote source.
- The token approval controls approve enough `token1` and `token2` to satisfy the initial report deposit requirements.
- `Wrap needed ETH to WETH` appears only when the report needs additional WETH and wrapping is possible.
- `Submit Initial Report` submits the first report.
- The price source line and WETH requirement messages are read-only and explain how the current submission values were derived.

##### Dispute Report

When the report is in a disputable state, the UI exposes:

- token selection for the swap-out side
- new token amounts
- `Dispute & Swap`

If settlement is also eligible, the selected report view can show a parallel `Settle Report` action alongside the dispute flow.

###### Dispute Report Fields and Buttons

- `Token to Swap Out` chooses which side of the pair is swapped out during dispute.
- `New token1 Amount` sets the replacement amount for token1.
- `New token2 Amount` sets the replacement amount for token2.
- `Dispute & Swap` submits the dispute transaction.
- `Settle Report` may also appear here when settlement is already allowed in parallel with dispute.

##### Settle Report

When the report is ready for settlement, the selected report workspace exposes settlement directly through `Settle Report`.

###### Settle Report Buttons

- `Settle Report` finalizes the report when the report lifecycle and timing allow settlement.

##### Settled Report

Once settled, the report stays available in a read-oriented state with status and summary fields, but the actionable lifecycle moves to a completed presentation.

Across these modes, button availability is used heavily to communicate unmet prerequisites such as:

- no connected wallet
- no loaded report
- invalid approval or token state
- report-state-specific restrictions on dispute or settlement

## Common Journeys

Common cross-route journeys include:

- finish `Deploy`, then move into `Zoltar`, `Security Pools`, or `Open Oracle`
- create or review a Zoltar question, then send it into pool creation
- browse pools, then open a specific pool into `Operate`
- move from a selected pool into a pending Open Oracle report
- fork a universe, then return to `Zoltar` and continue in `Migrate REP`

These handoffs are part of the operator flow, not separate apps.

## Current Constraints and Gotchas

- Outside simulation mode, the app expects an injected wallet and Ethereum mainnet-compatible context for normal operation.
- Some routes and buttons are intentionally disabled until prerequisites are satisfied, especially deployment prerequisites, network prerequisites, and fork-state prerequisites.
- Query params can reopen prior working context, so a page refresh may return to a previously selected universe, pool, report, or Zoltar subview.
- Simulation mode changes both the backend and the data assumptions. It is useful for QA, but it is not a mainnet-equivalent environment.
- Once a universe has forked, several actions change availability. In particular, some fork-related setup actions disappear or become disabled, while migration actions become relevant.

## Contributor Note

For contributors verifying or updating this document, the main behavior described here is driven by:

- [`ui/ts/App.tsx`](../ui/ts/App.tsx)
- [`ui/ts/components/DeploymentRouteContent.tsx`](../ui/ts/components/DeploymentRouteContent.tsx)
- [`ui/ts/components/MarketSection.tsx`](../ui/ts/components/MarketSection.tsx)
- [`ui/ts/components/ForkZoltarSection.tsx`](../ui/ts/components/ForkZoltarSection.tsx)
- [`ui/ts/components/ZoltarMigrationSection.tsx`](../ui/ts/components/ZoltarMigrationSection.tsx)
- [`ui/ts/components/SecurityPoolsSection.tsx`](../ui/ts/components/SecurityPoolsSection.tsx)
- [`ui/ts/components/SecurityPoolSection.tsx`](../ui/ts/components/SecurityPoolSection.tsx)
- [`ui/ts/components/SecurityPoolWorkflowSection.tsx`](../ui/ts/components/SecurityPoolWorkflowSection.tsx)
- [`ui/ts/components/SecurityVaultSection.tsx`](../ui/ts/components/SecurityVaultSection.tsx)
- [`ui/ts/components/TradingSection.tsx`](../ui/ts/components/TradingSection.tsx)
- [`ui/ts/components/ReportingSection.tsx`](../ui/ts/components/ReportingSection.tsx)
- [`ui/ts/components/ForkAuctionSection.tsx`](../ui/ts/components/ForkAuctionSection.tsx)
- [`ui/ts/components/OpenOracleSection.tsx`](../ui/ts/components/OpenOracleSection.tsx)
- [`ui/ts/components/SimulationBanner.tsx`](../ui/ts/components/SimulationBanner.tsx)
