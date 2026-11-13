import type { ContractReference } from './contract-reference-metadata.mts'
export const oracleMarketContractReferences: ContractReference[] = [
	{
		compiledAbiFingerprint: 'da22986690d7acacbc4520f6620f2e8f6246a794effd69e88f1084843c2440e2',
		name: 'OpenOraclePriceCoordinator',
		purpose: 'Per-question adapter to the portfolio universe\u2019s shared collateral/REP feed. It exposes reporting and canonical price reads without staging capital operations.',
		readAbiFingerprint: 'a9ae0df17c5fadf1119fce59c68a4e0ed9b9fd49db9fadc8f35f9268e9a3c30a',
		readSurface:
			'`priceFeed` and `sharedPriceFeed` identify the shared universe feed. It owns accepted price, freshness and report candidates. `lastSettlementTimestamp` records settlement eligibility, not delayed execution time. `isPriceValid` checks the accepted price and canonical `priceValidUntil`; pending or rejected reports do not extend expiry. `pendingReportId` and `pendingReportSponsor` identify the latest candidate, without blocking independent candidates. Reports use separate escrows. `reportDelegate` implements authenticated shared report creation. `securityPool` is bound once by the coordinator factory. Capital operations execute directly against an accepted price; there is no operation queue. Additional validated getters: `lastPrice`, `pendingReportMaxSettlementBaseFeeAttoEthPerGas`, `minimumToken1ReportAttoEth`, `getRequestPriceCostAttoEth`, `getSettlementCallbackGasLimit`, `reputationToken`, `openOracle`, `collateralToken`, `weth`, `gasConsumedOpenOracleReportPrice`, `gasConsumedSettlement`, `gasUnitsForOneDispute`, `initialReportPriorityFeeAttoEthPerGas`, `targetPriceErrorForDispute`, `openOracleSecurityMultiplierBps`, `settlementTime`, `disputeDelay`, `protocolFee`, `feePercentage`, `multiplier`, `timeType`, `trackDisputes`, `protocolFeeRecipient`, `escalationHaltMultiplierBps`, `maxSettlementBaseFeeMultiplierBps`, `minLiquidationPriceDistanceBps`.',
		securityBoundary:
			'Report liveness depends on [A16 timely inclusion](./security-model.html#assumption-a16), [A17 corrector capability](./security-model.html#assumption-a17), [A18 independent correction incentive](./security-model.html#assumption-a18), [A19 observable correctable price](./security-model.html#assumption-a19), and [A06 lifecycle executors](./security-model.html#assumption-a06). When `lastPrice` is zero, the official client currently needs an offchain market quote to propose the first report; quote availability is a client limitation rather than a protocol security assumption. Proposals copied from a nonzero cached price do not use that quote path.',
		readDeclarations: [
			{ name: 'collateralToken', sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol' },
			{
				name: 'pendingReportId',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'pendingReportSponsor',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'lastSettlementTimestamp',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'lastPrice',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'pendingReportMaxSettlementBaseFeeAttoEthPerGas',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'priceFeed',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'isPriceValid',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'priceValidUntil',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'minimumToken1ReportAttoEth',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'getRequestPriceCostAttoEth',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'getSettlementCallbackGasLimit',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
		],
		readStorageDeclarations: [
			{
				name: 'sharedPriceFeed',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'reportDelegate',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'reputationToken',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'securityPool',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'openOracle',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'weth',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'gasConsumedOpenOracleReportPrice',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'gasConsumedSettlement',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'gasUnitsForOneDispute',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'initialReportPriorityFeeAttoEthPerGas',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'targetPriceErrorForDispute',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'openOracleSecurityMultiplierBps',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'settlementTime',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'disputeDelay',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'protocolFee',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'feePercentage',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'multiplier',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'timeType',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'trackDisputes',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'protocolFeeRecipient',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'escalationHaltMultiplierBps',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'maxSettlementBaseFeeMultiplierBps',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
			{
				name: 'minLiquidationPriceDistanceBps',
				sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
			},
		],
		sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol',
		interactions: [
			{
				call: '`requestPrice(proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth)` with report funding',
				caller: 'Anyone; shared candidates may coexist and renew before the accepted price expires',
				effect: 'Opens and atomically funds a fresh collateral/REP report without staging a new operation, retains the whole committed bounty as the settler reward, then refunds any ETH above the bounty through a low-level caller callback. Callback rejection rolls back the report and initial position.',
				declarations: [
					{
						name: 'requestPrice',
						sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
					},
				],
				preconditions:
					'Nonzero proposed raw REP-per-collateral price scaled by 1e18, a bounty of at least 101 attoETH covered by msg.value, and sufficient collateral/REP funding and approvals for the shared feed’s live exposure and inventory bounds. Zero requested collateral uses the computed minimum. The creator-configured collateral stake floor plus the exposure minimum replaces gas-cost-based report sizing; it does not guarantee dispute gas costs are covered. Funding is isolated in a new report escrow; the caller must accept any excess-ETH refund.',
				signals: '`PriceRequested` and `ReportFundingAssigned` from the shared feed.',
			},
			{
				call: '`recoverSettledPendingReport()`',
				caller: 'Anyone',
				effect: 'Recovers the feed’s latest settled candidate without accepting its price. Use feed.recoverReport(reportId) for another unprocessed settled candidate. Recovery marks only that candidate rejected and returns its isolated escrow credits to its original sponsor.',
				declarations: [
					{
						name: 'recoverSettledPendingReport',
						sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
					},
				],
				preconditions: 'A pending report ID exists and its stored OpenOracle `storedGame(reportId).settlementTimestamp` is nonzero.',
				signals: '`PendingReportRecovered` from the shared feed.',
			},
			{
				call: '`setSharedPriceFeed(feed)`',
				caller: 'Deployment worker only',
				effect: 'Binds the shared report source once, before the question ledger is assigned.',
				declarations: [
					{
						name: 'setSharedPriceFeed',
						sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
					},
				],
				preconditions: 'No prior shared feed or ledger; nonzero feed with matching REP, configured WETH wrapper, and OpenOracle.',
				signals: '`SharedPriceFeedSet`',
			},
			{
				call: '`syncExposure()`',
				caller: 'Anyone; pool accounting checkpoints also invoke it',
				effect: 'Reads the live portfolio aggregate, max(standing commitments, funded demand), and emits a checkpoint if it changed. Question finality does not independently clear this shared exposure.',
				declarations: [
					{
						name: 'syncExposure',
						sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
					},
				],
				preconditions: 'A shared coordinator must already be registered by its canonical factory.',
				signals: 'Feed `ExposureCheckpoint` when the portfolio aggregate changes',
			},
			{
				call: '`setSecurityPool(securityPool)`',
				caller: 'The coordinator\u2019s deployer only; production binding passes through the authenticated factory and deployment-worker chain',
				effect:
					'A nonzero value binds the pool permanently. A zero value emits SecurityPoolSet with zero but leaves the setter callable by its deployer. `SecurityPoolFactory` supplies the nonzero canonical pool immediately after deploying the pool. A prepared coordinator cannot be claimed by another caller between transactions.',
				declarations: [
					{
						name: 'setSecurityPool',
						sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceSource.sol',
					},
				],
				preconditions: 'Current `securityPool` is zero (`Security pool already set`); the argument itself is not required to be nonzero.',
				signals: '`SecurityPoolSet`',
			},
		],
	},
	{
		compiledAbiFingerprint: 'a5a5bd5ea48f6e815f880a8e6b86840cc0793340eafff23ab28879af48c551cd',
		name: 'ShareToken',
		purpose: "Stores universe-aware ERC-1155 [outcome shares](./glossary.html#outcome-share) and materializes a holder's persistent source entitlement in selected fork branches.",
		readAbiFingerprint: '0194bb1e0f88ac06380299cf0929f248401c3fb6db8373010f01cba437918089',
		readSurface:
			'Base and relationship getters are `name`, `symbol`, `zoltar`, `canonicalPoolByUniverse`, `recoveredCompleteSetShares`, `_balances`, `_supplies`, and `_operatorApprovals`. Standard ERC-1155 reads are `supportsInterface`, `balanceOf`, `totalSupply`, `balanceOfBatch`, and `isApprovedForAll`; protocol-specific reads are `isAuthorized`, `totalSupplyForOutcome`, `maximumOutcomeSupply`, `balanceOfOutcome`, `balanceOfShares`, `getMigratedShareAmountAttoShares`, `getTokenId`, `getTokenIds`, `unpackTokenId`, `isPortfolioRecoveryEligible`, and `balanceOfPortfolioRecoveryRights`. The eligibility getter applies the [source recovery rules](./contract-inventory.html#portfolio-recovery-rights), preserving ordinary source-pool redemption for protected finalized questions. The balance getter returns unspent Invalid, Yes and No recovery rights, or all zeros when ineligible; the minimum bounds complete-set cash recovery. Received rights are included independently of the holder\u2019s source-token balances.',
		readDeclarations: [
			{
				name: 'supportsInterface',
				sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol',
			},
			{
				name: 'balanceOf',
				sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol',
			},
			{
				name: 'totalSupply',
				sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol',
			},
			{
				name: 'balanceOfBatch',
				sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol',
			},
			{
				name: 'isApprovedForAll',
				sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol',
			},
			{
				name: 'isAuthorized',
			},
			{
				name: 'totalSupplyForOutcome',
			},
			{
				name: 'maximumOutcomeSupply',
			},
			{
				name: 'balanceOfOutcome',
			},
			{
				name: 'balanceOfShares',
			},
			{
				name: 'balanceOfPortfolioRecoveryRights',
			},
			{
				name: 'isPortfolioRecoveryEligible',
			},
			{
				name: 'getMigratedShareAmountAttoShares',
			},
			{
				name: 'getTokenId',
			},
			{
				name: 'getTokenIds',
			},
			{
				name: 'unpackTokenId',
			},
		],
		readStorageDeclarations: [
			{
				name: 'name',
			},
			{
				name: 'symbol',
			},
			{
				name: 'zoltar',
			},
			{
				name: 'canonicalPoolByUniverse',
			},
			{
				name: 'recoveredCompleteSetShares',
			},
			{
				name: '_balances',
				sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol',
			},
			{
				name: '_supplies',
				sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol',
			},
			{
				name: '_operatorApprovals',
				sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol',
			},
		],
		sourcePath: 'solidity/contracts/statoblast/tokens/ShareToken.sol',
		interactions: [
			{
				call: '`setApprovalForAll(operator, approved)`',
				caller: 'Any token account setting its own operator approval',
				effect: "Sets or clears the operator's authority over all of the caller's outcome-token balances.",
				declarations: [
					{
						name: 'setApprovalForAll',
						sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol',
					},
				],
				preconditions: 'The operator differs from the caller.',
				signals: '`ApprovalForAll`',
			},
			{
				call: '`safeTransferFrom(from, to, id, value)` and `safeTransferFrom(from, to, id, value, data)`',
				caller: 'Share holder or approved ERC-1155 operator',
				effect: 'Transfers one outcome-token balance without changing supply.',
				declarations: [
					{
						name: 'safeTransferFrom',
						sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol',
					},
				],
				preconditions:
					'Caller holds the source balance or has operator approval; the source account has neither materialized that token into a child branch nor spent source-backed recovery rights by transferring or consuming them; destination is nonzero; the source balance is sufficient; under [A22 asset-recipient compatibility](./security-model.html#assumption-a22), a contract recipient accepts the ERC-1155 callback.',
				signals: '`TransferSingle`',
			},
			{
				call: '`safeBatchTransferFrom(from, to, ids, values)` and `safeBatchTransferFrom(from, to, ids, values, data)`',
				caller: 'Share holder or approved ERC-1155 operator for a nonempty batch; any caller for an empty batch',
				effect: 'A nonempty batch transfers each listed outcome-token balance without changing supply. Equal empty ID and value arrays return as a no-op without an event.',
				declarations: [
					{
						name: 'safeBatchTransferFrom',
						sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol',
					},
				],
				preconditions:
					'ID and value array lengths match. A nonempty batch also requires holder or operator authority, no listed source token already locked by child materialization or spending source-backed recovery rights, a nonzero destination, sufficient source balances, and, under [A22 asset-recipient compatibility](./security-model.html#assumption-a22), an accepting ERC-1155 callback from a contract recipient; the empty-batch no-op performs none of those checks.',
				signals: '`TransferBatch` for a nonempty batch; no event for an empty batch',
			},
			{
				call: '`transferPortfolioRecoveryRights(sourceUniverse, recipient, amountsAttoShares)`',
				caller: 'Recovery-right holder transferring only their own rights; ERC-1155 operator approval does not authorize this call',
				effect:
					'Transfers the specified Invalid, Yes and No recovery rights independently. Source and child token balances and every branch migration entitlement remain intact. Received credits are spent first; spending source-backed rights locks that source token against transfer. No token-receiver callback is invoked.',
				declarations: [
					{
						name: 'transferPortfolioRecoveryRights',
					},
				],
				preconditions:
					'Canonical source is a portfolio question in a forked universe with `isPortfolioRecoveryEligible(sourceUniverse) == true` (`No live source recovery right`); recipient is a different nonzero account; at least one amount is positive; every amount fits its corresponding unspent recovery-right balance.',
				signals: '`PortfolioRecoveryRightsTransferred`',
			},
			{
				call: '`consumePortfolioRecoveryCompleteSets(sourceUniverse, holder, amountAttoShares)`',
				caller: 'The canonical source pool\u2019s portfolio or its configured fork coordinator',
				effect:
					'Consumes equal amounts of Invalid, Yes and No recovery rights, using independently received credits before source-backed rights. Spending a source-backed right locks that source token against transfer; spending received credits alone does not. Source balances and every branch\u2019s migration rights remain intact. Returns cumulative consumed shares.',
				declarations: [
					{
						name: 'consumePortfolioRecoveryCompleteSets',
					},
				],
				preconditions:
					'Canonical source is a portfolio question in a forked universe with `isPortfolioRecoveryEligible(sourceUniverse) == true` (`No live source recovery right`); positive amount no greater than any of the holder\u2019s three unspent recovery-right balances. The coordinator authenticates the holder and calculates the corresponding cash payout.',
				signals: '`PortfolioRecoveryRightsConsumed`',
			},
			{
				call: '`migrate(fromId, targetOutcomeIndexes)`',
				caller: 'Holder of the source token ID',
				effect:
					"If needed, first freezes the operational source pool and records its fork snapshot. A single-target call may lazily create that child while the branch-creation window is open. It keeps and locks the holder's source entitlement, then mints each selected child-universe token ID up to the current source balance. Later source additions materialize only the unminted delta. A contract holder receives the ERC-1155 single-receiver callback for each mint; rejection rolls back the mint and preceding fork or child setup.",
				declarations: [
					{
						name: 'migrate',
					},
				],
				preconditions:
					'Source universe forked; canonical source pool is `Operational` or `PoolForked`, and an `Operational` source has no inherited fixed outcome because auto-fork activation rejects one; positive source balance; nonempty, strictly increasing, well-formed outcomes; every target in a multi-target call already has a canonical child pool; after the branch-creation window, a single target must also already exist; each target is an immediate native child, including when its bound question contract skips intermediate reporter ancestors; at least one selected child has an unmaterialized balance; under [A22 asset-recipient compatibility](./security-model.html#assumption-a22), a contract holder accepts `onERC1155Received` for every target mint.',
				signals: 'Canonical child preparation may emit `SecurityPoolRegistered`, `DeploySecurityPool`, and share-token `AuthorizationUpdated`. Successful materialization emits ERC-1155 `TransferSingle` and `Migrate` for each target.',
			},
			{
				call: '`authorize(securityPoolCandidate)`',
				caller: 'Initially authorized `SecurityPoolFactory` for an origin pool; an authorized parent `SecurityPool` for a child pool',
				effect: 'Establishes the candidate as `canonicalPoolByUniverse` for its universe and adds it to the set allowed to mint, burn, and authorize descendants. Reauthorizing the same candidate is a no-op.',
				declarations: [
					{
						name: 'authorize',
					},
				],
				preconditions: 'Caller is already authorized; the candidate reports this exact share token; its universe has no different canonical pool.',
				signals: '`AuthorizationUpdated` on first authorization; no event when the same candidate is already authorized',
			},
			{
				call: '`mintCompleteSets(universeId, account, amountAttoShares)`',
				caller: 'An authorized `SecurityPool`',
				effect: "Mints `amountAttoShares` each of Invalid, Yes, and No to `account`, then invokes its ERC-1155 batch-receiver callback when it is a contract. Rejection rolls back the mint and the authorized pool's surrounding transaction.",
				declarations: [
					{
						name: 'mintCompleteSets',
					},
				],
				preconditions: 'Caller is authorized; `account` is nonzero; `amountAttoShares` is positive; under [A22 asset-recipient compatibility](./security-model.html#assumption-a22), a contract account accepts `onERC1155BatchReceived`.',
				signals: '`TransferBatch` on a successful callback',
			},
			{
				call: '`burnCompleteSets(universeId, owner, amountAttoShares)`',
				caller: 'An authorized `SecurityPool`',
				effect: 'Burns `amountAttoShares` each of Invalid, Yes, and No from `owner`; global outcome supplies may differ.',
				declarations: [
					{
						name: 'burnCompleteSets',
					},
				],
				preconditions: 'Caller is authorized; `owner` is nonzero and has at least `amountAttoShares` of every outcome. Each remaining source balance must still cover its already-separated recovery rights.',
				signals: '`TransferBatch`',
			},
			{
				call: '`burnTokenIdAndGetRemainingSupply(tokenId, owner)`',
				caller: 'An authorized `SecurityPool`',
				effect: "Burns `owner`'s full balance of `tokenId` and returns the burned amount and that token ID's remaining supply.",
				declarations: [
					{
						name: 'burnTokenIdAndGetRemainingSupply',
					},
				],
				preconditions: '`owner` is nonzero; caller is authorized; no source-backed recovery rights have already been separated for this token.',
				signals: '`TransferSingle`, including when the burned balance is zero',
			},
		],
	},
]
