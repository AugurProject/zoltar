# Zoltar / Placeholder UI Security, UX, Product, and Visual Design Audit

Date: 2026-06-22

Scope reviewed: UI TypeScript source, Preact components, hooks, stores, contract-call helpers, transaction presentation logic, RPC/environment configuration, generated-binding usage paths, tests, CSS, README, deployment docs, and Zoltar / Placeholder whitepaper docs. Generated `js/` outputs were not used as sources when TypeScript sources existed.

## Architecture Map

Zoltar / Placeholder is implemented as a Preact single-page app under `ui/ts`. `ui/ts/App.tsx` wires global wallet/RPC/deployment state into route content. Routes are defined in `ui/ts/lib/routing.ts` and rendered through `ui/ts/components/AppRouteContent.tsx`, with major surfaces for deployment, Zoltar question/fork/migration flows, security pools, and OpenOracle.

Core UI state is held in Preact signals and hook-local form state. `ui/ts/hooks/useOnchainState.ts` manages wallet account, chain, read backend selection, deployment status, and clock polling. Domain hooks implement each high-risk workflow: `useMarketCreation.ts`, `useZoltarUniverse.ts`, `useZoltarFork.ts`, `useZoltarMigration.ts`, `useSecurityPoolCreation.ts`, `useTradingOperations.ts`, `useReportingOperations.ts`, `useForkAuctionOperations.ts`, `useSecurityVaultOperations.ts`, `useOpenOracleOperations.ts`, `useSecurityPoolsOverview.ts`, `usePriceOracleManager.ts`, and `useRepPrices.ts`.

Contract writes go through typed helpers in `ui/ts/contracts/**` and the shared encoder/sender in `ui/ts/contracts/core.ts`. `ui/ts/lib/writeAction.ts` wraps high-level write flows, invokes transaction-tray callbacks, and refreshes state after success. Global transaction feedback is rendered by `ui/ts/lib/transactionTray.ts`, `ui/ts/lib/transactionPresentations.tsx`, and `ui/ts/components/GlobalTransactionTray.tsx`.

The app is mostly direct-RPC driven. It supports injected wallets and a configurable read RPC via `?rpcUrl`, `localStorage.zoltar.rpcUrl`, `globalThis.__ZOLTAR_RPC_URL__`, `ZOLTAR_RPC_URL`, or the default `https://ethereum.dark.florist` in `ui/ts/lib/rpcConfig.ts`. Simulation mode is handled separately under `ui/ts/simulation`.

Visual structure is CSS-driven in `ui/css/index.css`, with reusable primitives such as `SectionBlock`, `EntityCard`, `ActionLauncherCard`, `MetricGrid`, `LifecycleStageBanner`, `OperationModal`, and sticky context surfaces. The design language is a dark, dense, operator-focused console with cyan/purple accents and warning/danger state colors.

Positive controls observed:

- No `dangerouslySetInnerHTML`, direct `innerHTML`, `eval`, or `new Function` paths were found in `ui/ts`.
- External links reviewed are constrained to Etherscan transaction links and Uniswap pool links, and use `target='_blank' rel='noreferrer'`.
- Local storage is used for RPC override and simulation saved states, not private keys or wallet secrets.
- Several critical hooks do perform just-in-time reloads before writes, especially reporting, OpenOracle dispute/settlement, and security-vault operations.

## Findings

### Finding ZOL-UI-001: Paginated "Use For Fork" question selection cannot complete the fork flow

**Severity:** High
**Category:** Product / UX
**Confidence:** High
**Affected files/components:** `ui/ts/components/MarketQuestionsSection.tsx`, `ui/ts/components/MarketSection.tsx`, `ui/ts/hooks/useZoltarUniverse.ts`, `ui/ts/components/ForkZoltarSection.tsx`
**Affected functions/hooks/flows:** `MarketQuestionsSection` question actions, `MarketSection` Zoltar route, `loadQuestionsPage`, `ForkZoltarSection` selected-question validation, Zoltar fork flow

**Summary:**
The normal browse-page action for selecting a Zoltar question to fork stores only the question ID, but the fork modal requires that full question to exist in a separate `zoltarQuestions` cache. A user can click "Use For Fork" from the loaded paginated question list and still be blocked from forking with "Select a valid fork question before forking Zoltar."

**Description:**
`MarketQuestionsSection` maps over `visibleQuestions` from `zoltarQuestionPage` and the "Use For Fork" button only calls `onUseQuestionForFork(question.questionId)` before switching to the fork tab (`ui/ts/components/MarketQuestionsSection.tsx:110-124`). `MarketSection` passes `onLoadZoltarQuestionPage` into this page but does not pass or invoke `onLoadZoltarQuestions` in the browse route (`ui/ts/components/MarketSection.tsx:116-126`). In `useZoltarUniverse`, `loadQuestionsPage` only updates `zoltarQuestionPage.value` and does not merge page questions into `zoltarQuestions` (`ui/ts/hooks/useZoltarUniverse.ts:175-200`). The full-question cache is populated by the separate all-question loader (`ui/ts/hooks/useZoltarUniverse.ts:154-164`).

The fork modal then resolves `selectedQuestion` only by searching `zoltarQuestions` (`ui/ts/components/ForkZoltarSection.tsx:61-70`). If the user has only loaded a page of questions, `selectedQuestion` remains undefined and `canFork` is false. The guard shown is "Select a valid fork question before forking Zoltar" (`ui/ts/components/ForkZoltarSection.tsx:78-88`), even though the question was just selected from the UI.

**Impact:**
This breaks a core oracle journey: selecting an existing question as the fork question. For a forkable oracle base layer, a dead-end fork path is a major product failure and can delay or prevent users from initiating a protocol-critical action through the public UI.

**Exploit, failure, or user-confusion scenario:**
A reporter or governance participant browses questions, clicks "Use For Fork" on a valid question, and lands on the Fork tab. The UI displays the selected question ID, but opening the fork modal leaves the fork transaction disabled. The user cannot distinguish whether the question is invalid, their REP/allowance is insufficient, or the UI lost the loaded question object.

**Root cause:**
The UI has two sources of truth for questions: a paginated `zoltarQuestionPage` used by browsing, and an all-question `zoltarQuestions` cache used by the fork modal. The fork-selection path transfers only an ID across this boundary.

**Recommendation:**
Use one selected-question source of truth. Either store the full selected question in fork state, merge paginated questions into `zoltarQuestions`, or add a direct `loadZoltarQuestionById` fallback when the selected ID is not present in the full cache.

**Suggested patch or design change:**
Merge page results into the lookup cache:

```ts
onSuccess: page => {
	zoltarQuestionPage.value = page
	zoltarQuestions.value = mergeQuestionsById(zoltarQuestions.value, page.questions)
}
```

Alternatively, change the fork state to hold `{ questionId, question }` when selection comes from a rendered card, and only fall back to cache lookup for manually pasted IDs. The fork modal should display the selected question title/outcomes, not only the raw ID, before asking for REP approval or a fork transaction.

**Tests or review checks to add:**
Add a component or integration test for: load paginated questions, click "Use For Fork", open the fork modal, and assert that the selected question is recognized and the only remaining blockers are wallet, mainnet, REP balance, and approval. Add a regression test for manually typed question IDs when only a page cache is available.

### Finding ZOL-UI-002: Writes rely on stale account and chain state, and failed `eth_chainId` reads are treated as mainnet

**Severity:** Medium
**Category:** Security
**Confidence:** High
**Affected files/components:** `ui/ts/lib/chainBackend.ts`, `ui/ts/hooks/useOnchainState.ts`, `ui/ts/lib/writeAction.ts`, `ui/ts/lib/clients.ts`, `ui/ts/tests/chainBackend.test.ts`
**Affected functions/hooks/flows:** Injected wallet backend, account and chain refresh, all contract write flows

**Summary:**
The app captures account/chain state during refresh and does not revalidate the current wallet account and chain immediately before sending a transaction. In addition, malformed or failed `eth_chainId` reads are explicitly normalized to Ethereum mainnet.

**Description:**
`createWriteClient` builds a viem wallet client with the captured `accountAddress` and fixed `MAINNET_NETWORK_PROFILE.chain` (`ui/ts/lib/chainBackend.ts:96-106`). `runWriteAction` only checks that `parameters.accountAddress` is defined before calling the action (`ui/ts/lib/writeAction.ts:45-60`); it does not call `eth_accounts` or `eth_chainId` at the moment the transaction is built and submitted.

`getChainId` returns mainnet when no provider exists, when a provider request error occurs, or when the response is not a string (`ui/ts/lib/chainBackend.ts:121-132`). `useOnchainState` then compares this chain ID to the expected profile and sets read mode/validation based on that stale or normalized value (`ui/ts/hooks/useOnchainState.ts:181-230`). The current tests codify this behavior by expecting malformed or failed chain ID reads to return `0x1`.

Provider `accountsChanged` and `chainChanged` subscriptions exist (`ui/ts/lib/chainBackend.ts:154-166`), but those events trigger asynchronous refresh behavior and do not close the race between displayed state and the user clicking a transaction button.

**Impact:**
If the wallet account or chain changes after the last refresh, the UI can build a transaction using stale displayed state and a stale sender. If a wallet/provider fails `eth_chainId`, the UI can treat an unknown chain as mainnet and enable mainnet-specific flows. Wallet confirmation screens may still show the real chain, but the application-level preview and guards can be wrong, which is dangerous for approvals, REP migration, reports, disputes, forks, and ETH-valued OpenOracle actions.

**Exploit, failure, or user-confusion scenario:**
A user opens a report or migration modal on mainnet, then switches their wallet to another account or chain before clicking the final action. The UI still displays balances, allowances, and state for the old account/chain. The wallet receives a transaction built for the same protocol address constants, but the user's current wallet context has changed. If the target chain has contracts at those addresses, or the wallet does not clearly surface the mismatch, the user can sign an unintended transaction.

**Root cause:**
Wallet account and chain are treated as refresh-time UI state rather than just-in-time transaction preconditions. Unknown chain state is collapsed into mainnet instead of being represented as unsafe/unknown.

**Recommendation:**
Never default unknown provider chain state to mainnet. Add a mandatory write preflight that reads `eth_accounts` and `eth_chainId` immediately before each write, compares them against the displayed account and expected chain ID, and aborts on mismatch or unknown state.

**Suggested patch or design change:**

```ts
async function assertCurrentWallet(backend: ChainBackend, expectedAccount: Address, expectedChainId: string) {
	const [account] = await backend.getAccounts()
	const chainId = await backend.getChainId()
	if (account === undefined || !sameAddress(account, expectedAccount)) {
		throw new Error('Wallet account changed. Review the action and try again.')
	}
	if (chainId !== expectedChainId) {
		throw new Error('Wallet network changed. Switch to Ethereum mainnet and try again.')
	}
}
```

Call this from `runWriteAction` or from `createWalletWriteClient` before the contract helper sends calldata. Change `getChainId` to return `undefined` or throw on provider request errors/malformed values, then block writes and show "Unable to verify wallet network."

**Tests or review checks to add:**
Add tests for account switching and chain switching between modal open and transaction submission. Add tests proving failed/malformed `eth_chainId` blocks writes instead of returning `0x1`. Add mocked wallet tests for delayed `accountsChanged` / `chainChanged` events.

### Finding ZOL-UI-003: Trading and truth-auction writes can sign against stale cached state

**Severity:** Medium
**Category:** Security / UX
**Confidence:** High
**Affected files/components:** `ui/ts/hooks/useTradingOperations.ts`, `ui/ts/components/TradingSection.tsx`, `ui/ts/hooks/useForkAuctionOperations.ts`
**Affected functions/hooks/flows:** Complete-set mint/redeem, share redemption, share migration, fork/security-pool migration actions, truth-auction bid/refund/finalize/claim actions

**Summary:**
Trading and fork-auction actions rely on cached details that may have changed before the user signs. Some neighboring flows correctly reload state immediately before writes, but these flows do not consistently do so.

**Description:**
`TradingSection` derives button guards from `selectedPool`, `tradingDetails`, and `tradingForkUniverse` (`ui/ts/components/TradingSection.tsx:70-115`). `useTradingOperations` has a `refreshTradingDetails` loader (`ui/ts/hooks/useTradingOperations.ts:103-124`), but `runTradingAction` captures the current form, parses the pool address, and calls the write action without force-reloading pool details or recomputing the guard (`ui/ts/hooks/useTradingOperations.ts:127-148`). The actual writes for mint, redeem, share redeem, and share migration happen afterward (`ui/ts/hooks/useTradingOperations.ts:164-184`).

`useForkAuctionOperations` explicitly reuses `forkAuctionDetails.value` when the selected security pool address matches (`ui/ts/hooks/useForkAuctionOperations.ts:93-98`). Truth-auction bid validation then uses `details.currentTime` and `details.truthAuction` from that cached object (`ui/ts/hooks/useForkAuctionOperations.ts:160-178`), while refund/finalize/claim paths also use the same detail object (`ui/ts/hooks/useForkAuctionOperations.ts:184-213`).

This is inconsistent with stronger patterns elsewhere. For example, `reportOutcome` reloads `loadReportingDetails` immediately before checking contribution capacity and submitting the report (`ui/ts/hooks/useReportingOperations.ts:140-159`).

**Impact:**
Users can sign transactions based on outdated mint capacity, share balances, fork state, target child universes, auction phase, or bid availability. Many cases will revert, causing fees and failed action, but some can become stale-intent signatures where the transaction is still valid but no longer matches what the UI displayed.

**Exploit, failure, or user-confusion scenario:**
A user opens a truth-auction bid modal near the end of an auction. The cached `currentTime` and auction state show bidding as available. Before signing, the auction moves past the bidding window or a competing bid changes the economics. The UI still asks the user to sign without reloading the auction state, resulting in a revert or a transaction that no longer matches the user's decision context.

**Root cause:**
Cached read models are used as transaction preconditions. Freshness is not enforced at the final signing boundary for trading and fork-auction flows.

**Recommendation:**
Before every trading and fork-auction write, reload the relevant pool/auction details with the current wallet and selected pool address, recompute the exact guard, and abort if the reloaded state differs from the displayed intent. Add a visible "last updated" or block-number indicator for market/action panels.

**Suggested patch or design change:**

```ts
const latest = await loadTradingDetailsForPool(createConnectedReadClient(), securityPoolAddress, walletAddress)
const guard = getTradingMintGuardMessage({
	accountAddress: walletAddress,
	completeSetCollateralAmount: latest.pool.completeSetCollateralAmount,
	ethBalance: await createConnectedReadClient().getBalance({ address: walletAddress }),
	hasSelectedPool: true,
	isMainnet: true,
	mintAmountInput: currentForm.completeSetAmount,
	totalRepDeposit: latest.pool.totalRepDeposit,
	totalSecurityBondAllowance: latest.pool.totalSecurityBondAllowance,
})
if (guard !== undefined) throw new Error(guard)
```

For fork auctions, remove `canReuseLoadedDetails` for writes or only reuse if the details include a recent block number within a strict threshold and the action is not time-sensitive.

**Tests or review checks to add:**
Add tests where trading details change between modal open and submit. Add truth-auction tests for phase changes, bid/refund selection changes, and finalization race conditions. Add regression tests comparing stale cached guards to just-in-time reloaded guards.

### Finding ZOL-UI-004: Awaiting-wallet transaction preview omits contract, function, value, chain, sender, and critical arguments

**Severity:** Medium
**Category:** Security / UX / Product
**Confidence:** High
**Affected files/components:** `ui/ts/lib/transactionPresentations.tsx`, `ui/ts/lib/transactionTray.ts`, `ui/ts/components/GlobalTransactionTray.tsx`, `ui/ts/lib/writeAction.ts`, `ui/ts/contracts/core.ts`
**Affected functions/hooks/flows:** All transaction flows, especially fork, migration, reporting, disputes, settlement, OpenOracle, security-vault, liquidation, and approvals

**Summary:**
When the app asks the user to confirm a wallet transaction, the global transaction tray only says "Confirm the transaction in your wallet." It does not show the decoded operation that the app is about to send.

**Description:**
`createAwaitingWalletPresentation` renders the generic detail "Confirm the transaction in your wallet" and optional generic rows from the transaction intent (`ui/ts/lib/transactionPresentations.tsx:83-90`). The tray marks a transaction as requested before the action has built call parameters (`ui/ts/lib/transactionTray.ts:23-32`; `ui/ts/lib/writeAction.ts:57-60`). Actual calldata, `to`, and `value` are constructed inside `writeContractAndWaitForReceipt` immediately before `sendTransaction` (`ui/ts/contracts/core.ts:75-91`).

After submission, `GlobalTransactionTray` hides the detail for non-error transactions once a hash exists (`ui/ts/components/GlobalTransactionTray.tsx:50-62`). The user gets a hash, but not a durable app-level record of the intended contract function and arguments.

**Impact:**
High-stakes actions ask users to rely on wallet UI alone for transaction interpretation. Wallets often abbreviate contract calls, omit decoded protocol-specific meaning, or show only raw addresses. This increases the chance of signing the wrong approval, migration, report, dispute, fork, settlement, or ETH-valued OpenOracle action.

**Exploit, failure, or user-confusion scenario:**
A user initiates "Migrate Shares" after selecting target outcome indexes. The app-level confirmation only says to confirm in the wallet. If the form state or cached details were stale, or if a user selected the wrong target universe, there is no final UI surface showing "migrate outcome X to child universes [A, B] on security pool Y with sender Z on chain 1" before signing.

**Root cause:**
The transaction pipeline separates high-level intent presentation from low-level call construction. The UI does not create a typed transaction descriptor before the wallet prompt.

**Recommendation:**
Build and display a transaction descriptor before calling `sendTransaction`. The descriptor should include sender, expected chain, contract label and address, function name, decoded arguments, ETH value, approval spender/amount where relevant, and a fresh-state/simulation status.

**Suggested patch or design change:**

```ts
type TransactionDescriptor = {
	account: Address
	chainId: string
	contractLabel: string
	to: Address
	functionName: string
	args: readonly TransactionPreviewRow[]
	value: bigint
}
```

Change action helpers to return or accept a descriptor before the wallet request. Render it in `OperationModal` and the global tray. For irreversible or security-sensitive actions, require an explicit confirmation checkbox or typed acknowledgement only after the descriptor is visible.

**Tests or review checks to add:**
Add unit tests for transaction descriptors for each write category. Add UI tests asserting that awaiting-wallet state shows contract, function, sender, chain, value, and critical args. Add tests that the descriptor and sent calldata are generated from the same call parameters.

### Finding ZOL-UI-005: OpenOracle initial-report quote freshness is not timestamped or revalidated before submit

**Severity:** Medium
**Category:** Security / Product / UX
**Confidence:** High
**Affected files/components:** `ui/ts/hooks/useOpenOracleOperations.ts`, `ui/ts/components/OpenOracleSection.tsx`, `ui/ts/lib/openOracle.ts`
**Affected functions/hooks/flows:** OpenOracle initial report creation, default Uniswap quote, price-source display, security-pool oracle price inputs

**Summary:**
The initial-report UI can auto-fill a Uniswap-derived price, but it stores no quote block/timestamp and does not refresh the quote immediately before submitting the report.

**Description:**
`refreshOpenOracleInitialReportQuote` fetches a default price and stores `openOracleInitialReportDefaultPrice`, source, and source URL (`ui/ts/hooks/useOpenOracleOperations.ts:291-312`). The derived submission details consume those values (`ui/ts/hooks/useOpenOracleOperations.ts:476-482`; `ui/ts/lib/openOracle.ts:450-518`). `submitInitialReport` reloads the selected report and token access before writing (`ui/ts/hooks/useOpenOracleOperations.ts:630-640`), but it does not refresh the price quote before using `openOracleForm.value.price`.

The UI exposes "Fetch price from Uniswap" and shows "Price source" (`ui/ts/components/OpenOracleSection.tsx:206-210`), but it does not show quote age, block number, or stale/manual override risk.

**Impact:**
Users can submit an old auto-filled REP/ETH or token price as an OpenOracle initial report. If the report is not disputed and later settles, downstream security-pool operations such as liquidation, withdrawals, and bond allowance updates can be influenced by stale pricing.

**Exploit, failure, or user-confusion scenario:**
A user opens the OpenOracle report panel and lets the UI fetch a Uniswap price. They leave the tab open during market volatility and submit later. The UI still labels the price as sourced from Uniswap, but the value reflects an old quote and no longer matches current liquidity. Other users may not dispute in time, allowing stale price settlement.

**Root cause:**
The price quote state records value and source, but not freshness metadata. Submit-time validation treats the form price as current user intent even when it came from an old automatic quote.

**Recommendation:**
Record quote block number and timestamp. Display quote age. Mark quotes stale after a short threshold. If the price field still matches an auto quote, refresh it immediately before submit or require explicit manual confirmation when stale.

**Suggested patch or design change:**

```ts
type OpenOracleInitialQuoteState = {
	price: string
	source: 'Uniswap V4' | 'Uniswap V3' | 'MOCK'
	sourceUrl: string | undefined
	blockNumber: bigint
	loadedAtMs: number
}
```

On submit, if `price` equals the stored auto quote and the quote is stale, refresh the quote and require the user to review the changed value. If the user edits the field, label it "Manual override" and require copy explaining that the value may be disputed.

**Tests or review checks to add:**
Add tests for stale auto quote display, submit-time refresh, quote-change confirmation, and manual override warning. Add mocked-chain tests where the quote changes between load and submit.

### Finding ZOL-UI-006: Public RPC override can silently control displayed protocol state

**Severity:** Medium
**Category:** Security / Product
**Confidence:** High
**Affected files/components:** `ui/ts/lib/rpcConfig.ts`, `ui/ts/lib/chainBackend.ts`, `ui/ts/hooks/useOnchainState.ts`, `ui/ts/components/OverviewPanels.tsx`, `README.md`
**Affected functions/hooks/flows:** Read backend selection, wallet wrong-network fallback reads, all protocol-state displays derived from read RPC

**Summary:**
The UI accepts read RPC overrides from URL/hash query and local storage, but the active RPC source is not persistently visible in the main interface. A malicious or stale RPC can shape displayed protocol state while still passing a chain ID check.

**Description:**
`resolveConfiguredRpcUrl` accepts `overrideRpcUrl`, `?rpcUrl`, hash query `rpcUrl`, `localStorage.zoltar.rpcUrl`, `globalThis.__ZOLTAR_RPC_URL__`, environment, or fallback URL, returning the first non-empty string without allowlisting or user confirmation (`ui/ts/lib/rpcConfig.ts:50-67`). `createInjectedBackend` uses this value for read clients (`ui/ts/lib/chainBackend.ts:86-95`). When the wallet is missing or not on the expected chain, `useOnchainState` switches reads to the configured RPC and only validates that it is the expected chain (`ui/ts/hooks/useOnchainState.ts:214-229`).

The README documents this override behavior, including `?rpcUrl` and local storage. The primary overview does not persistently show the active RPC host/source, block lag, or deployment code-hash validation status.

**Impact:**
A shared link containing `?rpcUrl=` can cause the app to read from an attacker-controlled endpoint. That endpoint can return stale or selectively omitted data while reporting chain ID 1. Users can then make reporting, trading, dispute, liquidation, settlement, or migration decisions from manipulated state. Contract writes still go through the wallet, but user intent is formed by untrusted reads.

**Exploit, failure, or user-confusion scenario:**
A user receives a link to the app with a custom RPC in the hash query. The UI loads, shows normal market and oracle state, and uses the malicious RPC for reads. The RPC hides a dispute contribution or reports an outdated finalization state, causing the user to miss a dispute window or attempt an unsafe settlement.

**Root cause:**
The app treats arbitrary configured RPC endpoints as acceptable read backends after a basic network validation. It does not surface the active backend as a trust boundary or verify deployed bytecode against expected mainnet addresses.

**Recommendation:**
Require explicit user confirmation for URL/localStorage RPC overrides in production. Show the active RPC host and source in a persistent status surface. Validate block freshness and key deployment code hashes before enabling high-stakes actions.

**Suggested patch or design change:**

```ts
type ReadBackendStatus = {
	source: 'default' | 'url' | 'localStorage' | 'global' | 'env'
	rpcUrl: string
	chainId: string | undefined
	blockNumber: bigint | undefined
	blockTimestamp: bigint | undefined
	codeHashStatus: 'valid' | 'invalid' | 'unchecked'
}
```

If `source` is `url` or `localStorage`, render a warning banner and disable writes until the user acknowledges the backend. Add code-hash checks for key contracts from `docs/mainnet-deployment-addresses.json`.

**Tests or review checks to add:**
Add tests for URL/hash/localStorage RPC precedence, visible backend indicator, stale block rejection, and code-hash mismatch blocking. Add manual QA for links containing `?rpcUrl=`.

### Finding ZOL-UI-007: Disabled high-stakes actions often hide the blocker reason from visible and accessible UI

**Severity:** Low
**Category:** Accessibility / UX
**Confidence:** High
**Affected files/components:** `ui/ts/components/TransactionActionButton.tsx`, `ui/ts/components/ActionLauncherCard.tsx`, trading/reporting/security-vault/OpenOracle/fork action panels
**Affected functions/hooks/flows:** Disabled transaction buttons and readiness/action launcher cards

**Summary:**
`TransactionActionButton` defaults to hiding disabled reasons and only places them in the button `title`. Many high-stakes blocked actions therefore rely on hover-only browser tooltips or surrounding incidental copy.

**Description:**
`TransactionActionButton` defaults `showDisabledReason` to false (`ui/ts/components/TransactionActionButton.tsx:3`). It always passes the reason into the button `title` (`ui/ts/components/TransactionActionButton.tsx:8`), but visible text is only rendered when `showDisabledReason` is true (`ui/ts/components/TransactionActionButton.tsx:11-16`). `ActionLauncherCard` passes an action blocker into the button availability object and does not render the blocker separately (`ui/ts/components/ActionLauncherCard.tsx:13-23`).

This pattern appears across trading, reporting, security-vault, OpenOracle, deployment, and fork actions. Some panels include separate requirement text, but the blocked reason is not consistently visible or programmatically associated with the disabled control.

**Impact:**
Keyboard users, touch users, and screen-reader users may not know why a transaction is unavailable. For complex oracle flows, hidden blockers can cause users to misdiagnose wallet/network/approval/fork-window issues and lose confidence or miss time-sensitive actions.

**Exploit, failure, or user-confusion scenario:**
A user attempts to report during an escalation window but sees a disabled action button. On mobile there is no hover tooltip, and the surrounding panel contains several metrics. The user cannot identify whether they need to switch networks, deposit REP, wait for a window, or refresh state.

**Root cause:**
Disabled reason presentation is opt-in and hover-dependent. Readiness blockers are treated as button metadata rather than visible flow guidance.

**Recommendation:**
Make disabled reasons visible by default for transaction buttons, and associate the reason with the button via `aria-describedby`. `ActionLauncherCard` should render `action.blocker` in the card body whenever present.

**Suggested patch or design change:**

```tsx
const reasonId = disabledReason === undefined ? undefined : useStableId('tx-disabled-reason')
<button aria-describedby={reasonId} ... />
{disabledReason === undefined ? undefined : (
	<p id={reasonId} className='detail disabled-reason'>{disabledReason}</p>
)}
```

Use warning/danger tone for irreversible blockers and neutral tone for missing optional data.

**Tests or review checks to add:**
Add component tests asserting that blocked `ActionLauncherCard` actions render visible blocker text. Add accessibility tests for `aria-describedby` and keyboard-only navigation through disabled action panels.

### Finding ZOL-UI-008: Placeholder documentation disagrees with UI and contract constants for OpenOracle validity windows

**Severity:** Low
**Category:** Documentation / Product
**Confidence:** High
**Affected files/components:** `docs/whitepaper_placeholder.html`, `solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol`, `ui/ts/lib/securityVault.ts`, `ui/ts/contracts/deploymentHelpers.ts`, `ui/ts/tests/liquidationModal.test.tsx`, `ui/ts/tests/securityVaultSection.test.tsx`
**Affected functions/hooks/flows:** User/operator expectations for OpenOracle settlement and price-validity timing; security-vault liquidation/withdrawal/bond update timing

**Summary:**
The Placeholder whitepaper says OpenOracle prices remain valid for one hour and uses a `15 * 12` settlement delay, while Solidity, UI constants, deployment helpers, and tests use five-minute validity and a `40 * 12` settlement delay.

**Description:**
The docs state `PRICE_VALID_FOR_SECONDS = 1 hour` (`docs/whitepaper_placeholder.html:1868`, `docs/whitepaper_placeholder.html:1985`) and list OpenOracle `settlementTime` as `180` / `15 * 12` (`docs/whitepaper_placeholder.html:1991`). The Solidity coordinator defines `PRICE_VALID_FOR_SECONDS = 5 minutes` and `MAX_OPERATION_VALID_FOR_SECONDS = 5 minutes` (`solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol:10-13`). The UI mirrors five minutes in `ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS` (`ui/ts/lib/securityVault.ts:8`), deployment helpers use `ORACLE_SETTLEMENT_TIME = 40 * 12` (`ui/ts/contracts/deploymentHelpers.ts:28`), and tests expect "expire 5m after the oracle settlement window completes" (`ui/ts/tests/liquidationModal.test.tsx:204`, `ui/ts/tests/securityVaultSection.test.tsx:221`).

**Impact:**
Operators and users relying on the docs can misunderstand liquidation, withdrawal, bond update, and oracle settlement timing. Timing misunderstandings are product-risk relevant because these flows are time-sensitive and can affect capital availability and dispute behavior.

**Exploit, failure, or user-confusion scenario:**
A user reads the whitepaper and expects a settled REP/ETH price to remain usable for one hour. The UI and contract expire it after five minutes. The user waits too long to execute a staged operation and sees it expire, despite following the documented mental model.

**Root cause:**
Protocol constants changed in implementation or deployment helpers without updating the published Placeholder whitepaper.

**Recommendation:**
Update the docs to match the canonical implementation, or add a generation/freshness check that imports constants from source and fails if the docs drift.

**Suggested patch or design change:**
Replace the whitepaper constants with the current canonical values:

```text
PRICE_VALID_FOR_SECONDS = 5 minutes
MAX_OPERATION_VALID_FOR_SECONDS = 5 minutes
OpenOracle settlementTime = 480 (40 * 12)
```

If the docs are intended to describe an earlier or theoretical configuration, label them as non-deployment-specific and link to `docs/mainnet-deployment-addresses.md` for current parameters.

**Tests or review checks to add:**
Add a docs freshness test that compares documented OpenOracle timing constants to `SecurityPoolOracleCoordinator.sol`, `ui/ts/lib/securityVault.ts`, and `ui/ts/contracts/deploymentHelpers.ts`.

## Executive Summary

The Zoltar / Placeholder frontend is meaningfully more rigorous than a basic dapp UI. It has structured domain hooks, typed viem calls, a simulation harness, extensive unit/component tests, no obvious raw-HTML rendering path, safe external-link attributes, and several strong just-in-time validation patterns in reporting, OpenOracle dispute/settlement, and security-vault operations.

The UI is not ready for production use without remediation of the core flow and trust-boundary issues above. The highest-risk security flows are wallet/network validation, transaction preview, RPC read-backend trust, stale state before trading/fork-auction writes, and OpenOracle price freshness. The highest-risk product/UX flow is the Zoltar fork path, where selecting a question from the normal paginated list can dead-end before the fork transaction.

The product purpose is understandable to protocol experts but weak for first-time users. The UI looks like a serious operator console and broadly matches a high-stakes oracle/prediction-market protocol, but it leans heavily on jargon and dense panels. It communicates many state details well once the user knows the system, but it does not consistently explain Zoltar versus Placeholder, fork consequences, dispute windows, claimability, or why actions are blocked.

The visual language is coherent, dark, technical, and trust-oriented. Its biggest strengths are density, consistent section/card primitives, serious color choices, and useful staged-operation panels. Its biggest weaknesses are cognitive load, one-note dark cyan/purple emphasis, hidden disabled reasons, limited transaction previews, and insufficient visual distinction between routine and irreversible actions.

## Findings Table

| ID | Severity | Category | Title | Affected file/component/function/flow | Status | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| ZOL-UI-001 | High | Product / UX | Paginated "Use For Fork" question selection cannot complete the fork flow | `MarketQuestionsSection`, `MarketSection`, `useZoltarUniverse`, `ForkZoltarSection` | Open | High |
| ZOL-UI-002 | Medium | Security | Writes rely on stale account and chain state, and failed `eth_chainId` reads are treated as mainnet | `chainBackend`, `useOnchainState`, `writeAction`, all writes | Open | High |
| ZOL-UI-003 | Medium | Security / UX | Trading and truth-auction writes can sign against stale cached state | `useTradingOperations`, `TradingSection`, `useForkAuctionOperations` | Open | High |
| ZOL-UI-004 | Medium | Security / UX / Product | Awaiting-wallet transaction preview omits contract, function, value, chain, sender, and critical arguments | Transaction tray/presentations, `writeAction`, `contracts/core` | Open | High |
| ZOL-UI-005 | Medium | Security / Product / UX | OpenOracle initial-report quote freshness is not timestamped or revalidated before submit | `useOpenOracleOperations`, `OpenOracleSection`, `openOracle` | Open | High |
| ZOL-UI-006 | Medium | Security / Product | Public RPC override can silently control displayed protocol state | `rpcConfig`, `chainBackend`, `useOnchainState`, overview/read flows | Open | High |
| ZOL-UI-007 | Low | Accessibility / UX | Disabled high-stakes actions often hide the blocker reason from visible and accessible UI | `TransactionActionButton`, `ActionLauncherCard`, action panels | Open | High |
| ZOL-UI-008 | Low | Documentation / Product | Placeholder documentation disagrees with UI and contract constants for OpenOracle validity windows | Placeholder whitepaper, coordinator, security-vault UI constants | Open | High |

## Product and UX Assessment

The product appears to help users create oracle questions, fork Zoltar universes, create and operate Placeholder security pools, trade complete sets and shares, report/dispute outcomes, migrate during forks, manage security vaults, liquidate unhealthy pools, and create/settle OpenOracle games.

Those goals are partially clear from the interface. Expert users can infer the workflow from route labels and dense panels. New users are likely to struggle because Zoltar, Placeholder, security pools, escalation games, truth auctions, fork universes, and non-decision outcomes are not introduced with enough contextual hierarchy. The UI is more operational console than onboarding product.

Market creation, reporting, liquidation, and vault flows have some of the strongest UX. They use requirement lists, staged operation states, projected outcomes, timing copy, and balance/allowance metrics. Trading and truth-auction flows need stronger freshness checks and final previews. Forking and migration are the least legible relative to their protocol importance: the UI shows many raw protocol nouns but does not consistently explain consequences, irreversible steps, or next actions.

Users do not receive enough app-level context before signing high-stakes transactions. The wallet prompt surface should summarize the exact function and arguments, especially for fork, migration, report, dispute, settlement, liquidation, approval, and OpenOracle actions.

The UI creates confidence through consistent structure, conservative tone, strong test coverage around many domain helpers, and visible protocol metrics. It creates confusion through hidden disabled reasons, fragmented question caches, raw OpenOracle creation parameters, dense jargon, and weak distinction between routine and dangerous actions.

Overall, the product currently feels usable by expert operators and developers. It is not yet understandable enough for new or occasional prediction-market users without documentation beside the app.

## Visual Language Assessment

The interface has a coherent dark technical aesthetic. `ui/css/index.css` defines a serious navy/black base with cyan and purple accents (`--bg`, `--bg-deep`, `--accent`, `--accent-strong`) and separate success/warning/danger state colors. This fits an oracle and financial protocol better than a playful or marketing-heavy style.

Typography is dense and functional, but some large headings and display treatments use negative letter spacing (`ui/css/index.css:211`, `ui/css/index.css:220`, `ui/css/index.css:366`, and other heading/card rules). In a high-stakes financial interface, tighter tracking can hurt legibility, especially with long protocol terms and addresses. Monospace labels and metric grids work well for addresses, balances, and state.

Spacing and layout are consistent but heavy. The repeated `SectionBlock`, `EntityCard`, metric grid, and action launcher patterns make the app feel systematic. However, there are many surfaces within surfaces, and some pages become visually saturated with borders, metrics, badges, and small explanatory copy. The design supports expert scanning but risks cognitive overload during fork, reporting, and auction flows.

Visual hierarchy is strongest in liquidation and vault panels where staged states and readiness are clear. It is weaker where routine and irreversible actions share similar button treatments. Forking, migration, dispute, liquidation execution, large approvals, and settlement should receive stronger danger/irreversibility styling and final confirmation treatment.

Color use is coherent but somewhat one-note. The cyan/purple accent system is polished, but it can make many interactive controls feel equally important. Warning and danger colors exist and should be used more aggressively for irreversible or time-sensitive protocol states.

Component consistency is good. Cards, badges, metric rows, modals, and transaction notices mostly share a visual grammar. Iconography is minimal; the app relies mostly on text, which is acceptable for expert tooling but makes dense action panels less scannable. Motion appears restrained, which is appropriate.

Charts and state indicators are present in specialized areas such as truth-auction depth and collateralization metrics. They should be audited with visual regression and edge-case data because odds, payout, collateralization, and dispute indicators can directly influence financial decisions.

Empty/loading/error/success states are present and often useful, but blocked actions need visible reasons by default. Error handling should distinguish failed, reverted, replaced, dropped, and submitted-but-refresh-failed transactions more explicitly in user-facing language.

The UI looks intentional and serious, but not fully production-polished for a broad Web3 prediction-market audience. It needs better hierarchy around risk, more contextual copy, stronger transaction previews, and screenshot-level responsive/accessibility verification.

## Zoltar / Placeholder UI Invariants

- The connected account used to derive balances, allowances, claimability, and guards must match the account used for the signed transaction.
- The connected chain must be verified as Ethereum mainnet immediately before every production write.
- Unknown or failed provider chain detection must block writes, not default to mainnet.
- Contract addresses and deployment configuration must match the selected network and verified bytecode.
- Every displayed transaction intent must match the encoded calldata, target contract, value, sender, and chain sent to the wallet.
- REP balances, allowances, staking availability, migration balances, and fork thresholds must be refreshed before approval, fork, report, dispute, and migration writes.
- Dispute bonds, contribution capacity, selected outcome, and reporting windows must be recomputed immediately before report/dispute/withdraw writes.
- Fork state must distinguish pre-fork, forked, child-universe creation, migration, unresolved escalation, and final settlement states.
- Market finalization, settlement, claimability, and redemption displays must reflect contract state, not stale cached or RPC-only assumptions.
- Share balances, complete-set capacity, payout previews, and selected outcome indexes must be refreshed before trading and migration writes.
- OpenOracle price quotes must include source and freshness metadata, and stale auto quotes must not be presented as live.
- Migration between forks/universes must display source universe, target child universe, outcome, amount, and irreversibility before signing.
- Oracle liveness, dispute windows, auction windows, and operation expiry must be visible wherever an action depends on them.
- Cached, indexed, or API-derived data must show freshness and be treated as advisory unless validated against chain state before signing.
- Visual indicators, badges, and colors must map one-to-one to actual protocol states.
- User-visible copy must match contract behavior and deployment constants.
- Failed, reverted, replaced, dropped, submitted, confirmed, and refresh-failed transaction states must be distinguishable.

## Manual Review Hotspots

- `ui/ts/lib/chainBackend.ts`, `ui/ts/hooks/useOnchainState.ts`, `ui/ts/lib/writeAction.ts`, `ui/ts/lib/clients.ts`: wallet, chain, provider, read/write backend trust boundaries.
- `ui/ts/contracts/core.ts`, `ui/ts/contracts.ts`, `ui/ts/contracts/securityPools.ts`, `ui/ts/contracts/zoltar.ts`, `ui/ts/contracts/deployment.ts`, `ui/ts/contracts/deploymentHelpers.ts`: calldata construction, value handling, ABI/address correctness, deployment constants.
- `ui/ts/hooks/useMarketCreation.ts`, `ui/ts/hooks/useZoltarUniverse.ts`, `ui/ts/hooks/useZoltarFork.ts`, `ui/ts/hooks/useZoltarMigration.ts`: Zoltar question lifecycle, fork, REP approval, and migration assumptions.
- `ui/ts/components/MarketQuestionsSection.tsx`, `ui/ts/components/ForkZoltarSection.tsx`, `ui/ts/components/ZoltarMigrationSection.tsx`: fork question selection, migration copy, state clarity.
- `ui/ts/hooks/useSecurityPoolCreation.ts`, `ui/ts/components/SecurityPoolSection.tsx`, `ui/ts/components/SecurityPoolsOverviewSection.tsx`, `ui/ts/components/SecurityPoolWorkflowSection.tsx`: pool creation and lifecycle.
- `ui/ts/hooks/useTradingOperations.ts`, `ui/ts/components/TradingSection.tsx`: complete sets, share balances, forked share migration, stale state.
- `ui/ts/hooks/useReportingOperations.ts`, `ui/ts/components/ReportingSection.tsx`, `ui/ts/lib/reportingDomain.ts`, `ui/ts/lib/reportingGuards.ts`: reporting, escalation, withdrawals, selected outcomes.
- `ui/ts/hooks/useForkAuctionOperations.ts`, `ui/ts/components/ForkAuctionSection.tsx`, `ui/ts/lib/forkAuction.ts`, `ui/ts/components/TruthAuctionDepthChart.tsx`: truth auction, fork migration, bid/refund/claim settlement.
- `ui/ts/hooks/useSecurityVaultOperations.ts`, `ui/ts/components/SecurityVaultSection.tsx`, `ui/ts/lib/securityVaultGuards.ts`, `ui/ts/lib/securityVault.ts`: security vault deposits, staged operations, oracle-price validity.
- `ui/ts/hooks/useOpenOracleOperations.ts`, `ui/ts/components/OpenOracleSection.tsx`, `ui/ts/lib/openOracle.ts`, `ui/ts/lib/uniswapQuoter.ts`, `ui/ts/hooks/useRepPrices.ts`: price quotes, report/dispute/settle flows, raw OpenOracle creation fields.
- `ui/ts/components/LiquidationModal.tsx`, `ui/ts/lib/liquidation.ts`, `ui/ts/hooks/useSecurityPoolsOverview.ts`, `ui/ts/hooks/usePriceOracleManager.ts`: liquidation simulations, collateralization display, price source trust.
- `ui/ts/lib/transactionPresentations.tsx`, `ui/ts/lib/transactionTray.ts`, `ui/ts/components/GlobalTransactionTray.tsx`, `ui/ts/components/TransactionActionButton.tsx`, `ui/ts/components/OperationModal.tsx`: transaction previews, status handling, accessibility.
- `ui/ts/lib/rpcConfig.ts`, `ui/ts/lib/activeEnvironment.ts`, `ui/ts/simulation/**`: environment switching, simulation-only behavior, RPC trust.
- `ui/css/index.css` and shared design primitives: hierarchy, mobile layout, warning/danger treatment, disabled state visibility.

## Test Coverage Gaps

- Browser end-to-end tests with wallet account switching, chain switching, rejected signatures, dropped/replaced transactions, and stale provider events.
- Fresh-state preflight tests for every write path, especially trading and fork-auction actions.
- Transaction preview tests proving displayed descriptors match encoded calldata and ETH value.
- RPC override tests for visible backend source, stale block detection, code-hash mismatch, and malicious read data.
- Zoltar fork tests covering paginated question selection, manual question ID entry, approval, fork execution, child universe creation, and migration.
- Forking edge cases across unresolved escalation, multiple child universes, migration target selection, and post-fork share/REP claimability.
- Dispute escalation tests with malicious reporters, capacity exhaustion, window expiry, and withdrawal edge cases.
- Market settlement edge cases for invalid outcomes, ambiguous outcomes, non-decision outcomes, rounding, payout distribution, and share redemption.
- ERC20 approval and allowance edge cases, including reduced allowance, non-standard tokens where applicable, and spender/address display.
- MEV-sensitive flow tests for reporting, dispute, finalization, settlement, liquidation execution, and auction bidding.
- Denial-of-service scenarios for pending settlement slots, unavailable OpenOracle prices, full contribution sides, and long-running refresh failures.
- Visual-regression tests across desktop, tablet, and mobile for dense protocol states.
- Accessibility tests with axe or equivalent, keyboard-only modal/action traversal, and visible disabled-reason assertions.
- Usability tests with non-expert users for fork, dispute, settlement, and migration concepts.
- Copy review checks for high-stakes actions and docs/code constant drift.

## Recommended Hardening

- Add a central just-in-time wallet assertion for account and chain before all writes.
- Treat unknown wallet chain state as unsafe; remove mainnet fallback on failed/malformed `eth_chainId`.
- Build typed transaction descriptors and show decoded previews before wallet prompts.
- Run transaction simulation or `eth_call` preflight from the same call parameters before asking for a signature when feasible.
- Force fresh state reload and guard recomputation before every write.
- Add persistent read-backend, block freshness, and code-hash status indicators.
- Require explicit acknowledgement for URL/localStorage RPC overrides in production.
- Timestamp Uniswap/OpenOracle quotes and mark stale values visibly.
- Add state-machine assertions for market lifecycle, oracle lifecycle, fork lifecycle, settlement, and migration transitions.
- Make fork, dispute, liquidation, migration, settlement, and large approval actions visually distinct from routine actions.
- Render disabled reasons visibly by default and wire them to controls with `aria-describedby`.
- Improve copy around Zoltar versus Placeholder, REP, security pools, escalation games, truth auctions, non-decision outcomes, and fork consequences.
- Add deployment-time sanity checks for contract addresses, chain IDs, bytecode hashes, and docs constants.
- Monitor frontend RPC lag, refresh failures, reverted transactions, oracle liveness, pending staged operations, and dispute/fork window deadlines.
- Define an emergency frontend shutdown or read-only mode for wrong deployment, stale RPC, or known-bad contract state.
- Add visual-regression, responsive, and accessibility CI coverage.

## Open Questions

- Is the standalone OpenOracle "Create Open Oracle Game" panel intended to be production-facing for all users, or is it a developer/admin tool? It currently exposes raw low-level fields and zero-like defaults, so its risk depends on intended audience.
- Are `?rpcUrl` and `localStorage.zoltar.rpcUrl` intended to remain enabled in the public production UI? If yes, the trust model should explicitly include user-facing backend verification.
- Which OpenOracle timing constants are canonical for current deployments: the Placeholder whitepaper values or the Solidity/UI/deployment-helper values?
- Which wallet/provider implementations are officially supported? The account/chain race risk should be tested against those exact providers.
- Is any indexer/subgraph/API planned beyond direct RPC reads? If yes, stale-data and validation invariants should be extended to that layer before launch.
