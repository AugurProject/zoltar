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

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Connect wallet` | Connect the injected wallet. | No field input. | Disabled while a wallet connection is already in progress. |
| REP/ETH refresh | Reload the displayed REP/ETH quote. | No field input. | Disabled while REP prices are already refreshing. |
| `Go to Genesis universe` | Reset the active universe context back to universe `0`. | No field input. | Only shown when the overview renders a universe-state hint that offers recovery back to the genesis universe. |
| Top route tabs | Switch between `Deploy`, `Zoltar`, `Security Pools`, and `Open Oracle`. | No field input. | Non-deploy routes are disabled until setup prerequisites are satisfied. |

### App Shell Read-Only Surfaces

- The overview can show source labels or links for REP pricing, including Uniswap and simulation mock sources.
- The overview can show a universe-state hint when the active universe context needs correction or recovery.

## Global Notices and Transaction State

Above the route content, the app can show page-wide notices for:

- simulation bootstrap failures
- the active Zoltar universe having already forked
- setup being incomplete and the app requiring the `Deploy` flow
- wallet availability guidance when no injected wallet is present
- transaction progress and the most recent transaction hash

Transaction state is shared across the app. While a transaction is waiting on wallet confirmation or onchain confirmation, the UI shows a global pending notice. Buttons that launched pending actions also keep their loading state in place and stay disabled until the action resolves.

### Global Notice Variants

- A pending transaction notice can show `Awaiting wallet confirmation.` before a signature is submitted.
- After submission, the pending notice can show the transaction hash while confirmation is still pending.
- After the pending state resolves, the app can keep showing the last transaction hash as a success notice.

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

Known simulation scenarios are `baseline`, `deployed`, `security-pool`, and `securitypoolx2`.

### Simulation Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| Scenario selector | Switch the seeded simulation scenario and reload the page into that scenario. | Must be one of the known simulation scenarios. | Disabled while the simulation is busy or bootstrapping. |
| QA account selector | Switch the active seeded account. | Must match one of the available simulated accounts. | Disabled while the simulation is busy or before bootstrap finishes. |
| `Query delay (ms)` | Add artificial latency to read calls. | Numeric milliseconds. | Not disabled in normal simulation operation. |
| `REP / ETH mock price` | Set the simulated REP/ETH price. | Must parse as a decimal price. Invalid edits revert to the current controller value. | Disabled while the simulation is busy. |
| `REP / USDC mock price` | Set the simulated REP/USDC price. | Must parse as a decimal price. Invalid edits revert to the current controller value. | Disabled while the simulation is busy. |
| `Transaction receipt delay (ms)` | Add artificial latency before simulated transactions confirm. | Numeric milliseconds. | Disabled while the simulation is busy. |
| `Reset scenario` | Reset the simulation back to its seeded state. | No field input. | Disabled while busy or before bootstrap finishes. |
| `Mine block` | Advance the simulation by one block. | No field input. | Disabled while busy or before bootstrap finishes. |
| `+1 hour` | Advance simulation time by one hour. | No field input. | Disabled while busy or before bootstrap finishes. |
| `+1 day` | Advance simulation time by one day. | No field input. | Disabled while busy or before bootstrap finishes. |

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

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Deploy Next Missing` | Submit the next deployable deterministic deployment step. | No text input. Uses the next undeployed eligible step. | Disabled when no account is connected, the wallet is not on mainnet, no deployable step exists, another deployment is busy, or a deploy-next action is already pending. |
| Per-step deploy actions | Deploy one explicit contract step inside a deployment group. | No text input. Step prerequisites must already be satisfied. | Disabled when no account is connected, the wallet is not on mainnet, the step is already deployed, the step is blocked by prerequisites, or another deployment is already busy. |

### Zoltar

The `Zoltar` route is the main universe and question-management area. It has four subviews:

- `Questions`
- `Create Question`
- `Fork Zoltar`
- `Migrate REP`

The top tabbed block summarizes the active universe. In `Questions`, it can show a fuller universe overview. In the other views, it compresses that into smaller universe, status, and question-count metrics.

#### Questions

The `Questions` view is used to fetch and browse questions in the active universe.

#### Questions Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Questions`, `Create Question`, `Fork Zoltar`, `Migrate REP` tabs | Switch between Zoltar subviews. | No field input. | `Migrate REP` is disabled until the universe has forked. |
| `Fetch Questions` | Load questions for the active universe. | No field input. | Disabled while questions are loading or when question count is zero. |
| `Refresh Questions` | Reload the question list. | No field input. | Disabled while questions are loading. |
| `Use For Fork` | Copy the selected question into the fork flow and open `Fork Zoltar`. | Question must already exist in the loaded list. | Disabled after the universe has already forked. |
| `Use For Create Pool` | Copy a binary question into Security Pools create mode. | Question must already exist in the loaded list. | Disabled for non-binary questions. |
| `Deploy Universe` in `Child Universes` | Deploy one not-yet-deployed child universe after fork. | Requires connected wallet, mainnet, a forked universe, and a child universe entry that does not already exist. | Disabled when no wallet is connected, the wallet is not on mainnet, the universe has not forked yet, or the selected child universe already exists. |
| Scalar child-universe deployment controls | Deploy scalar child universes from the scalar-specific deployment panel. | Require connected wallet, mainnet, a forked scalar universe, and a valid selected scalar outcome. | Disabled whenever the scalar child-universe deployment flow's wallet, network, fork-state, or outcome-selection guards fail. |

#### Questions Read-Only Surfaces

- The overview can show universe status, fork time, fork threshold, reputation token, and total theoretical supply.
- After fork, the overview can show the selected fork question as a dedicated record card.
- Child universes render with existence status, outcome details, and deployment availability.

#### Create Question

The `Create Question` view creates new Zoltar questions. The form supports `Binary`, `Categorical`, and `Scalar`.

#### Create Question Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Question Type` | Choose between `Binary`, `Categorical`, and `Scalar`. | Must be one of the supported market types. | Never disabled in the base form. |
| `Title` | Set the market title. | Required. | Never disabled in the base form. |
| `Description` | Add optional explanatory text. | Free text. | Never disabled in the base form. |
| `Start Time` | Set when the market becomes active. | Optional, but if present must parse as a valid timestamp. | Never disabled in the base form. |
| `End Time` | Set when the market closes. | Required and must parse as a valid timestamp later than `Start Time`. | Never disabled in the base form. |
| `Outcomes` | Enter categorical outcome labels. | For `Categorical`, needs at least two non-empty unique outcomes. | Only shown for categorical questions. |
| `Add Outcome` | Add another categorical outcome row. | No direct validation. | Only shown for categorical questions. |
| `Remove` | Remove one categorical outcome row. | No direct validation. | Only shown for categorical questions. |
| `Scalar Min` | Define the scalar lower bound. | Required for scalar questions and must participate in a valid scalar range. | Only shown for scalar questions. |
| `Scalar Increment` | Define the scalar tick spacing. | Required for scalar questions and must parse into a valid scalar increment. | Only shown for scalar questions. |
| `Scalar Max` | Define the scalar upper bound. | Required for scalar questions and must be greater than `Scalar Min`. | Only shown for scalar questions. |
| `Answer Unit` | Define the scalar display unit. | Free text. | Only shown for scalar questions. |
| Scalar preview | Show how the scalar tick space resolves. | Requires valid scalar inputs. | Hidden until scalar inputs are sufficiently valid. |
| `Create Question` | Submit the new question. | Requires a connected wallet, Ethereum mainnet, and a valid form. | Disabled until the wallet is connected, the wallet is on mainnet, and the full form validates. |
| `Use For Fork` after creation | Send the created question into the fork flow. | Created question must exist. | Disabled after the universe has already forked. |
| `Use For Create Pool` after creation | Send the created question into pool creation. | Created question must be binary. | Disabled for non-binary questions. |
| `Create Another Question` | Clear the result state and return to the form. | No field input. | Not disabled in the success state. |

#### Fork Zoltar

The `Fork Zoltar` view is focused on selecting the fork question and executing the fork path.

#### Fork Zoltar Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| REP approval control | Approve enough REP to satisfy the fork threshold. | Required amount is the universe fork threshold. | Blocked when no wallet is connected, the wallet is not on mainnet, or Zoltar is already forked. |
| `Fork Question ID` | Select the question that will trigger the fork. | Must resolve to a valid question from the loaded question set. | Disabled after Zoltar has already forked or while a fork is pending. |
| Selected question card | Confirm which question will be used. | Read-only. | Hidden until a valid selected question resolves. |
| `Fork Zoltar` | Submit the fork transaction. | Requires connected wallet, mainnet, loaded universe, valid selected question, enough REP balance, and enough REP approval. | Disabled whenever any fork guard condition fails. |

#### Migrate REP

The `Migrate REP` view handles post-fork REP preparation and migration into child universes.

#### Migrate REP Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Migration Amount` | Set how much REP moves through the migration workflow. | Must parse into a REP amount greater than zero. | Disabled while migration is pending or before the universe has forked. |
| `Max` | Fill `Migration Amount` with all available wallet REP plus prepared migration REP. | No direct validation beyond available balance. | Disabled while migration is pending, before fork, or when no REP is available. |
| REP approval control | Approve any additional REP still needed to prepare the selected amount. | Required amount is the missing preparation amount. | Blocked by missing wallet, wrong network, missing universe, no valid amount, or no fork. |
| Outcome universe selector | Choose which child universes receive split REP. | Selected outcomes must parse as valid outcome indexes and map to valid child universes. | Disabled while migration is pending. |
| `Add Next Outcome` | Add the next unselected outcome universe. | No direct validation. | Disabled while migration is pending or when no further outcome exists. |
| Outcome toggles | Select or deselect individual target universes. | Target set must remain parseable into valid indexes. | Disabled while migration is pending. |
| `Prepare REP` | Move wallet REP into migration balance. | Requires connected wallet, mainnet, loaded universe, valid amount, forked universe, enough wallet REP, and enough approval. | Disabled whenever preparation is unnecessary or any guard condition fails. |
| `Split REP` | Split prepared migration REP across selected outcomes. | Requires connected wallet, mainnet, loaded universe, valid amount, enough prepared REP, at least one selected outcome, and sufficient split capacity. | Disabled whenever any split guard condition fails. |

### Security Pools

The `Security Pools` route has three high-level modes: `Browse`, `Create`, and `Operate`.

#### Browse

`Browse` loads the pool registry and lists deployed pools.

#### Browse Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Browse`, `Create`, `Operate` tabs | Switch between Security Pools modes. | No field input. | Not disabled by default, though `Operate` only becomes useful once a pool is selected. |
| `Refresh pools` | Reload the pool registry and all listed pool summaries. | No field input. | Disabled while pool registry loading is already in progress. |
| Pool selection actions | Open a listed pool into `Operate`. | Pool must exist in the loaded list. | Not disabled in the normal browse state. |
| Liquidation entry actions | Open liquidation from a listed vault. | Requires a pool/vault context that supports liquidation. | Disabled when the wallet is missing, not on mainnet, or the price-oracle state makes liquidation unavailable. |
| Queued-liquidation success notice | Show the most recent queued liquidation transaction hash. | Read-only. | Only shown after a liquidation queue action succeeds. |

##### Liquidation Modal Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Target Vault` | Choose which vault address should be liquidated. | Required non-empty address input for the queue action to proceed. | Not disabled while the modal is open. |
| `Liquidation Amount` | Set the liquidation amount to queue. | Required non-empty amount input for the queue action to proceed. | Not disabled while the modal is open. |
| `Cancel` | Close the liquidation modal without submitting. | No field input. | Not disabled while the modal is open. |
| `Close` | Close the liquidation modal from the header. | No field input. | Not disabled while the modal is open. |
| `Queue Liquidation` | Submit the liquidation-queue transaction for the selected manager, pool, vault, and amount. | Requires connected wallet, mainnet, loaded manager address, loaded pool address, non-empty target vault, and non-empty liquidation amount. | Disabled whenever any of those queue-liquidation guard conditions fail. |

#### Browse Read-Only Surfaces

- Each pool card exposes question details, pool metrics, manager address, and truth-auction address when one exists.
- Each vault card in browse mode exposes vault metrics even before the operator opens the full vault workflow.
- The browse screen can render empty, loading, and error states through the pool-registry presentation hint and error notice.

#### Create

`Create` is the pool-deployment workflow.

#### Create Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Question ID` | Select the binary question used as the pool's origin market. | Must parse as a valid decimal or hex bigint. | Never disabled in the base form. |
| `Security Multiplier` | Set the pool collateralization multiplier. | Must parse as a bigint. | Never disabled in the base form. |
| `Open Interest Fee / Year (%)` | Set the retention-rate-based open-interest fee. | Must parse as a valid retention-rate percentage. | Never disabled in the base form. |
| `Create Pool` | Submit the pool deployment. | Requires connected wallet, mainnet, no pending duplicate check, no pending pool creation, loaded binary market, no matching duplicate pool, and no Zoltar fork. | Disabled whenever any of those guards fail. |
| `Open Pool` | Jump into the created pool's `Operate` workspace. | Requires a successful pool creation result. | Only shown after a successful deployment. |
| `Create Another Pool` | Reset the create flow after a success. | No field input. | Only shown after a successful deployment. |

#### Operate

`Operate` opens a selected-pool workspace with `Vaults`, `Trading`, `Reporting`, and `Fork` subviews.

#### Operate Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| Vertical workflow tabs | Switch between `Vaults`, `Trading`, `Reporting`, and `Fork`. | No field input. | Individual views can be disabled when pool state or universe state locks the workflow. |
| `Security Pool Address` | Select the pool that should be opened in the selected-pool workspace. | Free-form address interpreted by the selected-pool loader. | Not disabled in the normal selected-pool header. |
| `Refresh pool` | Reload the selected pool from chain state. | No field input. | Disabled when no pool address is present or while pool loading is already in progress. |
| `Refresh Oracle` | Reload the pool oracle-manager view. | No field input. | Disabled while oracle-manager details are loading. |
| `Load Price Oracle` | Load oracle-manager details for the first time. | No field input. | Disabled while oracle-manager details are loading. |
| `Request New Price` | Queue or request a fresh price. | Requires a loaded oracle-manager and any pool-level oracle preconditions. | Disabled when the local guard message says price request is not currently available. |
| Pending report link | Open the current pending report inside `Open Oracle`. | Requires a loaded oracle-manager with a non-zero pending report id. | Hidden when there is no pending report. |

#### Operate Read-Only Surfaces

- The selected-pool header can show a lookup-state hint before a pool resolves.
- The `Pool Summary` surface shows status, vault count, security multiplier, open interest fee, total security bond allowance, manager address, last price, settlement timestamp, expiry, and, when relevant, fork and truth-auction data.
- A success notice can appear after requesting a new price.
- If the selected pool belongs to a different universe than the app's active universe, a dedicated `Universe Mismatch` warning appears.
- If the selected pool has not reached a usable state for the chosen workflow, the UI can replace that workflow with a locked-state hint instead of the action panel.

##### Vaults

The `Vaults` subview has `Directory` and `Selected` modes.

###### Vaults Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Directory` / `Selected` tabs | Switch between vault directory and selected-vault workflow. | No field input. | Not disabled by default. |
| `Selected Vault Address` | Choose which vault to inspect or operate on. | Free-form address input interpreted by the vault load flow. | Not disabled in the normal selected-pool state. |
| `Refresh` | Reload the selected vault from chain state. | No field input. | Disabled while vault loading is in progress. |
| `Select Vault` | Copy a directory vault into the selected-vault workflow. | Vault must exist in the listed pool vaults. | Not disabled in the normal directory state. |
| `Liquidate Vault` | Open liquidation for the chosen vault. | Requires pool/oracle context that allows liquidation. | Disabled when the wallet is missing, not on mainnet, or oracle state blocks liquidation. |
| `Claim Fees` | Redeem claimable ETH fees from the selected owned vault. | Requires loaded vault details with claimable fees. | Disabled unless the selected vault is owned by the account, the wallet is on mainnet, and fees are claimable. |
| `REP Deposit Amount` | Set the REP deposit amount. | Must parse into a valid REP amount. | Not disabled in the normal selected-vault state. |
| Deposit `Max` | Fill the deposit field from wallet REP balance. | No direct validation. | Disabled when wallet REP balance is unavailable. |
| REP approval control | Approve enough REP for the selected deposit amount. | Required amount is the parsed deposit amount. | Blocked when the wallet is missing, the selected vault is not owned, the pool is missing, or the vault has not been refreshed. |
| `Create / Deposit REP` | Create a new vault if needed or deposit REP into the selected owned vault. | Requires connected wallet, mainnet, owned vault, sufficient REP approval, sufficient REP balance, and at least `10 REP` for a brand-new vault. | Disabled whenever any deposit guard condition fails. |
| `Security Bond Allowance Amount` | Set the new security bond allowance in ETH terms. | Must parse into a valid REP-style amount greater than zero. | Not disabled in the normal selected-vault state. |
| `Set Security Bond Allowance` | Queue the allowance update. | Requires connected wallet, mainnet, owned vault, loaded vault details, valid oracle price, and positive allowance amount. | Disabled whenever any allowance guard condition fails. |
| `REP Withdraw Amount` | Set how much withdrawable REP to remove. | Must parse into a valid REP amount. | Not disabled in the normal selected-vault state. |
| Withdraw `Max` | Fill the withdrawal amount with currently withdrawable REP. | No direct validation. | Disabled when withdrawable REP is unavailable. |
| `Withdraw REP` | Queue the REP withdrawal. | Requires connected wallet, mainnet, owned vault, valid oracle price, non-zero withdraw amount, and available withdrawable REP. | Disabled whenever any withdraw guard condition fails. |

##### Trading

The `Trading` subview handles complete-set and share flows.

###### Trading Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Security Pool Address` | Select the target pool when trading is used standalone. | Free-form address interpreted by the selected pool loader. | Hidden in embedded pool workflows. |
| `Mint Complete Sets Amount` | Set how many complete sets to mint. | Must parse into a positive trading amount within remaining mint capacity. | Not disabled in the normal form, but action depends on the guard. |
| `Mint Complete Sets` | Submit the mint transaction. | Requires loaded pool, connected wallet, mainnet, unforked universe, operational pool, available capacity, valid amount, and enough ETH. | Disabled whenever any mint guard condition fails. |
| `Redeem Complete Sets Amount` | Set how many complete sets to redeem. | Must parse into a positive trading amount not above the wallet maximum. | Not disabled in the normal form. |
| Redeem `Max` | Fill the redemption amount from the wallet maximum. | No direct validation. | Disabled when the redeemable maximum is unavailable or zero. |
| `Redeem Complete Sets` | Submit complete-set redemption. | Requires loaded pool, connected wallet, mainnet, unforked universe, operational pool, loaded balances, and a valid redeem amount within the maximum. | Disabled whenever any redeem-complete-set guard condition fails. |
| `Share Outcome To Migrate` | Choose which share side is being migrated after a fork. | Must be one of the supported reporting outcomes. | Disabled until the universe has forked. |
| Share migration target selector | Choose destination child outcomes for migrated shares. | Target child universes must parse and resolve as valid destinations. | Disabled until the universe has forked. |
| `Select All` / `Clear` / target toggles | Manage migration target selection. | Target set must remain valid. | Disabled until the universe has forked. |
| `Migrate Shares` | Submit share migration. | Requires loaded pool, connected wallet, mainnet, forked universe, loaded fork targets, at least one valid target, loaded share balances, and wallet balance for the selected share side. | Disabled whenever any share-migration guard condition fails. |
| `Redeem Shares` | Redeem finalized or otherwise redeemable shares. | Requires loaded pool, connected wallet, mainnet, unforked universe, operational pool, and finalized market outcome. | Disabled whenever any redeem-shares guard condition fails. |

##### Reporting

The `Reporting` subview handles reporting and escalation.

###### Reporting Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Security Pool Address` | Select the target pool when reporting is used standalone. | Free-form address interpreted by the reporting loader. | Hidden in embedded pool workflows. |
| `Refresh reporting` | Load or reload escalation/reporting state. | No field input. | Disabled while reporting details are loading or when the workflow is locked by pool state. |
| `Outcome Side` | Choose the reporting side for contribution or withdrawal. | Must be one of the supported reporting outcomes. | Disabled when the workflow is locked. |
| `Report / Contribution Amount` | Set the REP amount to stake on the selected side. | Must parse into a valid positive REP amount. | Disabled when the workflow is locked. |
| `Report / Contribute On Selected Side` | Submit reporting or contribution. | Requires unlocked workflow, connected wallet, mainnet, loaded reporting details, and valid positive amount. | Disabled whenever any reporting guard condition fails. |
| `Withdraw Deposit Indexes` | Optionally narrow withdrawal to specific deposits. | Optional input. If used, it must match the downstream withdrawal parser's expected format. | Disabled when the workflow is locked. |
| `Withdraw Escalation Deposits` | Submit the withdrawal. | Requires unlocked workflow, connected wallet, mainnet, loaded reporting details, and at least one withdrawable user deposit on the selected side. | Disabled whenever any withdrawal guard condition fails. |

##### Fork

The `Fork` subview handles the selected pool's fork and truth-auction lifecycle.

###### Fork Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Security Pool Address` | Select the pool whose fork lifecycle is being inspected. | Free-form address interpreted by the fork loader. | Hidden in embedded pool workflows. |
| `Refresh fork` | Load or reload fork and truth-auction state. | No field input. | Disabled while fork details are loading. |
| Lifecycle tabs | Switch between `Initiate`, `Migration`, `Auction`, and `Settlement`. | No field input. | Not disabled by default, though later stages can show explanatory messages when the pool has not progressed that far. |
| `Fork With Own Escalation` | Start a fork using the operator's own escalation path. | No extra field input. | Disabled when the wallet is missing, not on mainnet, or the broader workflow is disabled. |
| `Initiate Pool Fork` | Trigger the pool-level fork path. | No extra field input. | Disabled when the wallet is missing, not on mainnet, or the broader workflow is disabled. |
| `Direct Fork Universe ID` | Set the universe to fork directly. | Must be parseable by the direct-fork action path. | Field itself is not disabled in the active stage panel. |
| `Direct Fork Question ID` | Set the direct fork question. | Must be parseable by the direct-fork action path. | Field itself is not disabled in the active stage panel. |
| `Fork Universe Directly` | Submit the direct universe fork. | Requires connected wallet, mainnet, enabled workflow, and parseable direct-fork inputs. | Disabled whenever the base fork action guard fails. |
| `Outcome` in child/migration actions | Choose the child outcome used by the action. | Must be one of the supported reporting outcomes. | Not disabled unless the broader stage panel is disabled. |
| `Create ... Child Universe` | Deploy the child universe for the selected outcome. | Requires connected wallet, mainnet, enabled workflow, and a selected outcome. | Disabled whenever the base fork action guard fails. |
| `REP Migration Outcomes` | Describe which outcomes should receive migrated REP through the pool flow. | Must be parseable by the migration action path. | Not disabled unless the broader stage panel is disabled. |
| `Migrate REP To Zoltar` | Submit REP migration to Zoltar through the pool flow. | Requires connected wallet, mainnet, enabled workflow, and parseable migration outcomes. | Disabled whenever the base fork action guard fails. |
| `Vault Address` in `Migrate Vault` | Choose which vault to migrate. | Optional. Empty falls back to connected-wallet vault context. | Not disabled unless the broader stage panel is disabled. |
| `Migrate Vault` | Submit vault migration. | Requires connected wallet, mainnet, enabled workflow, and any required parseable fields. | Disabled whenever the base fork action guard fails. |
| `Escalation Deposit Indexes` | Choose which escalation deposits to migrate. | Must be parseable by the deposit-migration path. | Not disabled unless the broader stage panel is disabled. |
| `Migrate Escalation Deposits` | Submit escalation deposit migration. | Requires connected wallet, mainnet, enabled workflow, and parseable indexes. | Disabled whenever the base fork action guard fails. |
| `Start Truth Auction` | Start the truth auction. | No extra field input. | Disabled when the wallet is missing, not on mainnet, or the broader workflow is disabled. |
| `Bid Tick` | Set the tick for a bid. | Must be parseable by the bid action path. | Field itself is not disabled unless the stage panel is disabled. |
| `Bid Amount (ETH)` | Set the ETH amount for a bid. | Must be parseable by the bid action path. | Field itself is not disabled unless the stage panel is disabled. |
| `Submit Bid` | Submit the truth-auction bid. | Requires connected wallet, mainnet, enabled workflow, and parseable bid inputs. | Disabled whenever the base fork action guard fails. |
| `Finalize Truth Auction` | Finalize the auction once ready. | No extra field input. | Disabled when the wallet is missing, not on mainnet, or the broader workflow is disabled. |
| `Refund Tick` / `Refund Bid Index` | Choose a losing bid to refund. | Must be parseable by the refund action path. | Fields themselves are not disabled unless the stage panel is disabled. |
| `Refund Losing Bid` | Submit the refund. | Requires connected wallet, mainnet, enabled workflow, and parseable refund inputs. | Disabled whenever the base fork action guard fails. |
| `Vault Address` / `Claim Bid Tick` / `Claim Bid Index` | Choose which vault and winning bid position to claim against. | Must be parseable by the claim action path. Vault address is optional and can fall back to the connected wallet. | Fields themselves are not disabled unless the stage panel is disabled. |
| `Claim Auction Proceeds` | Claim proceeds for a winning bid position. | Requires connected wallet, mainnet, enabled workflow, and parseable claim inputs. | Disabled whenever the base fork action guard fails. |
| `Withdraw For Address` / `Withdraw Tick` / `Withdraw Bid Index` | Choose which bids to withdraw. | Must be parseable by the withdraw action path. Withdraw-for address is optional and can fall back to the connected wallet. | Fields themselves are not disabled unless the stage panel is disabled. |
| `Withdraw Bids` | Submit bid withdrawal. | Requires connected wallet, mainnet, enabled workflow, and parseable withdraw inputs. | Disabled whenever the base fork action guard fails. |

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

`Browse` loads paginated Open Oracle report summaries.

#### Browse Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Browse`, `Create`, `Selected Report` tabs | Switch between Open Oracle views. | No field input. | `Selected Report` is still reachable even before a report is loaded, but it will show a loading or missing state until a report resolves. |
| `Previous Page` | Load the previous report-summary page. | No field input. | Disabled on the first page or while browse data is loading. |
| `Next Page` | Load the next report-summary page. | No field input. | Disabled on the last page or while browse data is loading. |
| `Open report` | Load a selected report into the selected-report workspace. | Report id comes from the loaded report card. | Not disabled in the normal browse list. |

#### Browse Read-Only Surfaces

- Each report summary card exposes token pair, current price, current reporter, current token amounts, report timestamp, and settlement timestamp.
- A latest-action card can appear after a recent Oracle action, including report creation.
- The browse route can render loading, empty, and error states when report summaries are being fetched.

#### Create Open Oracle Game

`Create` is a direct report-instance creation flow.

#### Create Open Oracle Game Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Token1 Address` | Set the first token contract. | Parsed by the create-game action path. | Never disabled in the base form. |
| `Token2 Address` | Set the second token contract. | Parsed by the create-game action path. | Never disabled in the base form. |
| `Exact Token1 Report` | Set the exact token1 report amount. | Parsed by the create-game action path. | Never disabled in the base form. |
| `Settler Reward` | Set the ETH reward paid to the settler. | Parsed by the create-game action path. | Never disabled in the base form. |
| `ETH Value To Send` | Set the ETH value attached to creation. | Parsed by the create-game action path. | Never disabled in the base form. |
| `Fee Percentage` | Set the fee percentage. | Parsed by the create-game action path. | Never disabled in the base form. |
| `Multiplier` | Set the oracle multiplier. | Parsed by the create-game action path. | Never disabled in the base form. |
| `Settlement Time` | Set the base settlement delay. | Parsed by the create-game action path. | Never disabled in the base form. |
| `Escalation Halt` | Set the escalation halt threshold. | Parsed by the create-game action path. | Never disabled in the base form. |
| `Dispute Delay` | Set the dispute delay. | Parsed by the create-game action path. | Never disabled in the base form. |
| `Protocol Fee` | Set the protocol fee share. | Parsed by the create-game action path. | Never disabled in the base form. |
| `Create Open Oracle Game` | Submit the standalone game creation. | Requires a connected wallet. Most field correctness is enforced by the action path rather than by front-end validation in this component. | Disabled until a wallet is connected. |

#### Create Open Oracle Game Read-Only Surfaces

- A latest-action card can appear after recent Open Oracle create actions.
- The create route can show an error notice below the form when the action fails.

#### Selected Report

`Selected Report` is the loaded report workspace.

#### Selected Report Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Report ID` | Choose which report to load in the selected-report workspace. | Must identify a loadable report for the workspace to become actionable. | Never disabled in the base selected-report form. |
| `Open report` | Load the selected report when no report is currently loaded. | Uses the entered report id. | Disabled while a report is already loading. |
| `Refresh report` | Reload the selected report when one is already loaded. | Uses the current report id. | Disabled while a report is already loading. |

#### Selected Report Read-Only Surfaces

- The loaded report card shows a status badge such as awaiting initial report, pending, disputed, or settled.
- The top summary grid exposes report id, oracle address, current reporter, current price, and settlement timestamp.
- The report body is broken into read-only sections for `Identity`, `Economics`, `Status`, `Settlement`, and `Callback / Extra`.
- When no report is loaded, the selected-report screen can show an explicit missing or loading state hint rather than the full report body.

##### Initial Report

The `Initial Report` mode appears while the report still needs its first report.

###### Initial Report Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Price (token1 / token2)` | Set the initial reported price. | Must parse into a valid price before token2 approval and full submission can resolve. | Not disabled in the normal initial-report state. |
| `Fetch price from Uniswap` | Populate the price from the quote source. | No field input. | Disabled while quote loading is already in progress. |
| Token1 approval control | Approve enough token1 for the initial report. | Required amount is derived from the report requirements. | Disabled when no wallet is connected. |
| Token2 approval control | Approve enough token2 for the initial report. | Required amount depends on a valid price-derived token2 amount. | Disabled when no wallet is connected or until a valid price produces a valid token2 amount. |
| `Wrap needed ETH to WETH` | Wrap ETH into WETH when additional WETH is required. | Wrap requirement is derived from the report state and wallet balances. | Hidden unless wrap is needed. When shown, disabled unless the wallet is connected and wrapping is currently possible. |
| `Submit Initial Report` | Submit the first report. | Requires connected wallet, report still awaiting initial report, valid price-derived amounts, satisfied token approvals, and satisfied WETH wrap requirements if any. | Disabled whenever any submission guard condition fails. |

##### Dispute Report

The `Dispute Report` mode appears while a report is in a disputable lifecycle window.

###### Dispute Report Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Token to Swap Out` | Choose which side of the pair is swapped out during dispute. | Must be one of the supported pair tokens. | Not disabled in normal dispute mode. |
| `New token1 Amount` | Set the replacement amount for token1. | Must parse by the downstream dispute flow. | Not disabled in normal dispute mode. |
| `New token2 Amount` | Set the replacement amount for token2. | Must parse by the downstream dispute flow. | Not disabled in normal dispute mode. |
| `Dispute & Swap` | Submit the dispute transaction. | Requires connected wallet, loaded report, and report state that is currently disputable. | Disabled whenever any dispute guard condition fails. |
| `Settle Report` in dispute mode | Settle if the report has already reached settlement eligibility. | Requires connected wallet, loaded report, and report state that is currently settleable. | Disabled whenever any settle guard condition fails. |

##### Settle Report

The `Settle Report` mode appears when dispute is no longer allowed but settlement is ready.

###### Settle Report Controls

| Control | Purpose | Validation | Disabled when |
| --- | --- | --- | --- |
| `Settle Report` | Finalize the report. | Requires connected wallet, loaded report, initial report already present, report not already settled, and settlement window already open. | Disabled whenever any settle guard condition fails. |

##### Settled Report

Once settled, the report stays available in a read-oriented state with status and summary fields, but the actionable lifecycle moves to a completed presentation.

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

## Exceptional States

- If the user lands on an unsupported hash route, the app renders a dedicated `404` route with `Return to Deploy`, `Open Zoltar`, and `Open Security Pools`.
- If the wallet is on the wrong network, the app replaces the selected route content with a mainnet-gate route that instructs the operator to switch to Ethereum mainnet.
- Across the app, many sections use explicit empty, loading, missing, blocked, and success presentations instead of leaving panels blank.

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
