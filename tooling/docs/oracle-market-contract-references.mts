import type { ContractReference } from './contract-reference-metadata.mts'
export const oracleMarketContractReferences: ContractReference[] = [
	{
		compiledAbiFingerprint: '8301ec3a120867d885afecc9b55a38dbab9cf678ff248f9263ad0f7794fe86a6',
		name: 'SharedPoolPriceFeed',
		purpose: 'Canonical REP/collateral reporting and price source for every question in one security pool and universe.',
		readAbiFingerprint: 'bc1d44d6d200cd829c7b91de21f3412e030748acfc485b1219dbcc270da1bf8d',
		readSurface:
			'Accepted price and freshness: `lastPrice`, `lastSettlementTimestamp`, `priceValidUntil` and `isPriceValid`. Pending reports do not extend freshness. Reports retain isolated sponsor-owned escrows. Configuration, exposure and candidate getters: `reportCandidates`, `reportOutcome`, `universeId`, `reputationToken`, `aggregateExposureAttoEth`, `validateExposure`, `conservativePrice`, `liquidationPrice`, `minimumToken1ReportAttoEth`, `minimumToken2ReportAttoRep`, `minimumToken1ReportAttoEthForPrice`, `getSettlementCallbackGasLimit`, `getRequestPriceCostAttoEth`, `reportAuthorization`, `priceValidityWindowSeconds`, `timeType`, `trackDisputes`, `OPEN_INTEREST_DIVIDER`, `REPORT_OPERATION_GAS_OVERHEAD`, `MAXIMUM_REPORT_OPERATION_DATA_BYTES`, `FEED_SETTLEMENT_GAS_OVERHEAD`, `securityPoolFactory`, `securityPool`, `openOracle`, `collateralToken`, `minimumReportCollateral`, `weth`, `initialReportPriorityFeeAttoEthPerGas`, `targetPriceErrorForDispute`, `settlementTime`, `disputeDelay`, `protocolFee`, `feePercentage`, `multiplier`, `protocolFeeRecipient`, `escalationHaltMultiplierBps`, `maxSettlementBaseFeeMultiplierBps`, `pendingReportId`, `pendingReportSponsor`, `pendingReportMaxSettlementBaseFeeAttoEthPerGas`, `pendingExposureLimitAttoEth`, `acceptedExposureLimitAttoEth`, `acceptedRepExposureLimitAttoRep`, `acceptedEpoch`, `sponsorOperationReport`.',
		sourcePath: 'solidity/contracts/statoblast/SharedPoolPriceFeed.sol',
		securityBoundary:
			'Report liveness depends on [A16 timely inclusion](./security-model.html#assumption-a16), [A17 corrector capability](./security-model.html#assumption-a17), [A18 independent correction incentive](./security-model.html#assumption-a18), [A19 observable correctable price](./security-model.html#assumption-a19), and [A06 lifecycle executors](./security-model.html#assumption-a06).',
		readDeclarations: [
			{ name: 'reportCandidates' },
			{ name: 'reportOutcome' },
			{ name: 'universeId' },
			{ name: 'reputationToken' },
			{ name: 'aggregateExposureAttoEth' },
			{ name: 'validateExposure' },
			{ name: 'conservativePrice' },
			{ name: 'liquidationPrice' },
			{ name: 'minimumToken1ReportAttoEth' },
			{ name: 'minimumToken2ReportAttoRep' },
			{ name: 'minimumToken1ReportAttoEthForPrice' },
			{ name: 'getSettlementCallbackGasLimit' },
			{ name: 'getRequestPriceCostAttoEth' },
			{ name: 'reportAuthorization' },
			{ name: 'isPriceValid' },
			{ name: 'priceValidityWindowSeconds' },
			{ name: 'priceValidUntil' },
		],
		readStorageDeclarations: [
			{ name: 'timeType' },
			{ name: 'trackDisputes' },
			{ name: 'OPEN_INTEREST_DIVIDER' },
			{ name: 'REPORT_OPERATION_GAS_OVERHEAD' },
			{ name: 'MAXIMUM_REPORT_OPERATION_DATA_BYTES' },
			{ name: 'FEED_SETTLEMENT_GAS_OVERHEAD' },
			{ name: 'securityPoolFactory' },
			{ name: 'securityPool' },
			{ name: 'openOracle' },
			{ name: 'collateralToken' },
			{ name: 'minimumReportCollateral' },
			{ name: 'weth' },
			{ name: 'initialReportPriorityFeeAttoEthPerGas' },
			{ name: 'targetPriceErrorForDispute' },
			{ name: 'settlementTime' },
			{ name: 'disputeDelay' },
			{ name: 'protocolFee' },
			{ name: 'feePercentage' },
			{ name: 'multiplier' },
			{ name: 'protocolFeeRecipient' },
			{ name: 'escalationHaltMultiplierBps' },
			{ name: 'maxSettlementBaseFeeMultiplierBps' },
			{ name: 'pendingReportId' },
			{ name: 'pendingReportSponsor' },
			{ name: 'pendingReportMaxSettlementBaseFeeAttoEthPerGas' },
			{ name: 'pendingExposureLimitAttoEth' },
			{ name: 'acceptedExposureLimitAttoEth' },
			{ name: 'acceptedRepExposureLimitAttoRep' },
			{ name: 'acceptedEpoch' },
			{ name: 'lastPrice' },
			{ name: 'lastSettlementTimestamp' },
			{ name: 'sponsorOperationReport' },
		],
		interactions: [
			{
				call: '`requestSecurityPoolPrice(proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth)`',
				caller: 'Anyone',
				effect: 'Opens an independently funded report. Collateral and REP move directly from the caller to its isolated escrow; the caller receives returned funding.',
				preconditions: 'Approve this feed for exact collateral and REP; positive price; sufficient report stake; msg.value covers the committed bounty; excess ETH is refunded after candidate storage is complete; reporting window open.',
				signals: '`PriceRequested`, `ReportFundingAssigned`',
				declarations: [{ name: 'requestSecurityPoolPrice' }],
			},
			{
				call: '`requestSecurityPoolPriceWithOperations(proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth, batch)`',
				caller: 'Anyone',
				effect: 'Opens a report and retains the caller as sponsor for ordered bounded capital operations after acceptance.',
				preconditions: 'Same funding checks; unexpired batch, price bounds and sufficient bounded callback gas.',
				signals: '`PriceRequested`, `ReportFundingAssigned`, `ReportOperationAttempted`',
				declarations: [{ name: 'requestSecurityPoolPriceWithOperations' }],
			},
			{
				call: '`syncExposure()`',
				caller: 'Canonical question ledgers only',
				effect: 'Emits changed live aggregate exposure. The factory mapping, ledger factory, universe, REP and feed must agree.',
				preconditions: 'Caller belongs to this security pool and universe; this is the factory-registered feed.',
				signals: '`ExposureCheckpoint`',
				declarations: [{ name: 'syncExposure' }],
			},
			{
				call: '`createReportEscrow(payer, sponsor, wethAmount, repAmount, haltAmount, bounty, callbackGasLimit)`',
				caller: 'This feed only',
				effect: 'Creates the report escrow and pulls caller-funded tokens into it atomically.',
				preconditions: 'Authenticated self-call from report creation; OpenOracle amount and bounty widths already checked.',
				signals: 'OpenOracle report creation',
				declarations: [{ name: 'createReportEscrow' }],
			},
			{
				call: '`settleReport(reportId, amount1, amount2)`',
				caller: 'The registered report escrow only',
				effect: 'Validates report economics, freshness, base-fee ceiling and exposure. An acceptance records the candidate and canonical prices before sponsor operations use the canonical price.',
				preconditions: 'Known pending candidate; authenticated escrow callback.',
				signals: '`PriceCandidateAccepted`, `PriceReported`, `PriceReportRejected`, `PriceReportDeferred`, `ReportOperationAttempted`',
				declarations: [{ name: 'settleReport' }],
			},
			{
				call: '`recoverReport(reportId)`',
				caller: 'Anyone',
				effect: 'Retries a settled candidate using stored OpenOracle amounts and timestamps. Funding withdrawal remains separate.',
				preconditions: 'Known unprocessed report with nonzero settlement timestamp. Accepting its price or attempting operations under a fresh canonical price requires base fee at or below its cap; other invalid candidates can retire above the cap.',
				signals: '`PendingReportRecovered` and report outcome events',
				declarations: [{ name: 'recoverReport' }],
			},
			{
				call: '`recoverSettledPendingReport()`',
				caller: 'Anyone',
				effect: 'Recovers the latest pending candidate through recoverReport.',
				preconditions: 'Latest candidate is settled and recoverable.',
				signals: '`PendingReportRecovered` and report outcome events',
				declarations: [{ name: 'recoverSettledPendingReport' }],
			},
		],
	},
	{
		compiledAbiFingerprint: '790ccaf0f17571515aaf5603b08550689b1deab361af6af68b9cf4c024534db3',
		name: 'ShareToken',
		purpose: "Stores universe-aware ERC-1155 [outcome shares](./glossary.html#outcome-share) and materializes a holder's persistent source entitlement in selected fork branches.",
		readAbiFingerprint: '7579ee9d868a9c4ed0ce13e35d1286a34804e1dca9789be15dc5aaf7a2aa41d2',
		readSurface:
			'Base and relationship getters are `name`, `symbol`, `zoltar`, `canonicalQuestionLedgerByUniverse`, `recoveredCompleteSetShares`, `_balances`, `_supplies`, and `_operatorApprovals`. Standard ERC-1155 reads are `supportsInterface`, `balanceOf`, `totalSupply`, `balanceOfBatch`, and `isApprovedForAll`; protocol-specific reads are `isAuthorized`, `totalSupplyForOutcome`, `maximumOutcomeSupply`, `balanceOfOutcome`, `balanceOfShares`, `getMigratedShareAmountAttoShares`, `getTokenId`, `getTokenIds`, `unpackTokenId`, `isSecurityPoolRecoveryEligible`, and `balanceOfSecurityPoolRecoveryRights`. The balance getter returns unspent Invalid, Yes and No recovery rights, or all zeros when ineligible. See the [source recovery rules](./contract-inventory.html#security-pool-recovery-rights) for eligibility and complete-set recovery. Received rights are included independently of the holder\u2019s source-token balances.',
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
				name: 'balanceOfSecurityPoolRecoveryRights',
			},
			{
				name: 'isSecurityPoolRecoveryEligible',
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
				name: 'canonicalQuestionLedgerByUniverse',
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
				preconditions: 'The operator differs from the caller and from the token itself, which `isApprovedForAll` always reports as an operator.',
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
				caller: 'Source account or approved ERC-1155 operator',
				effect: 'Transfers each listed outcome-token balance without changing supply. Empty batches change no balances.',
				declarations: [
					{
						name: 'safeBatchTransferFrom',
						sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol',
					},
				],
				preconditions:
					'ID and value array lengths match; caller is the source account or has operator approval; destination is nonzero; no listed source token is locked by child materialization or spending source-backed recovery rights; source balances are sufficient. Under [A22 asset-recipient compatibility](./security-model.html#assumption-a22), a contract recipient must accept the ERC-1155 callback, including for an empty batch.',
				signals: '`TransferBatch`, including empty batches',
			},
			{
				call: '`transferSecurityPoolRecoveryRights(sourceUniverse, recipient, amountsAttoShares)`',
				caller: 'Recovery-right holder transferring only their own rights; ERC-1155 operator approval does not authorize this call',
				effect:
					'Transfers the specified Invalid, Yes and No recovery rights independently. Source and child token balances and every branch migration entitlement remain intact. Received credits are spent first; spending source-backed rights locks that source token against transfer. No token-receiver callback is invoked.',
				declarations: [
					{
						name: 'transferSecurityPoolRecoveryRights',
					},
				],
				preconditions:
					'Canonical source is a security pool question in a forked universe with `isSecurityPoolRecoveryEligible(sourceUniverse) == true` (`No live source recovery right`); recipient is a different nonzero account; at least one amount is positive; every amount fits its corresponding unspent recovery-right balance.',
				signals: '`SecurityPoolRecoveryRightsTransferred`',
			},
			{
				call: '`consumeSecurityPoolRecoveryCompleteSets(sourceUniverse, holder, amountAttoShares)`',
				caller: 'The canonical source question ledger\u2019s security pool or its configured fork coordinator',
				effect:
					'Consumes equal amounts of Invalid, Yes and No recovery rights, using independently received credits before source-backed rights. Spending a source-backed right locks that source token against transfer; spending received credits alone does not. Source balances and every branch\u2019s migration rights remain intact. Returns cumulative consumed shares.',
				declarations: [
					{
						name: 'consumeSecurityPoolRecoveryCompleteSets',
					},
				],
				preconditions:
					'Canonical source is a security pool question in a forked universe with `isSecurityPoolRecoveryEligible(sourceUniverse) == true` (`No live source recovery right`); positive amount no greater than any of the holder\u2019s three unspent recovery-right balances. The coordinator authenticates the holder and calculates the corresponding cash payout.',
				signals: '`SecurityPoolRecoveryRightsConsumed`',
			},
			{
				call: '`migrate(fromId, targetOutcomeIndexes)`',
				caller: 'Holder of the source token ID',
				effect:
					"If needed, first puts the source question ledger into fork mode and records its fork snapshot; this applies to an operational source and to a ledger that was prepared in its universe but never activated before that universe forked. A single-target call may lazily materialize that child's question ledger once the security pool's fork branch into that universe is active; it never prepares, starts, or activates the branch itself, so the call stays within the transaction gas limit. It keeps and locks the holder's source entitlement, then mints each selected child-universe token ID up to the current source balance. Later source additions materialize only the unminted delta. A contract holder receives the ERC-1155 single-receiver callback for each mint; rejection rolls back the mint and preceding fork or child setup.",
				declarations: [
					{
						name: 'migrate',
					},
				],
				preconditions:
					'Source universe forked; for a security pool question, `isSecurityPoolRecoveryEligible(sourceUniverse)` is true (`ShareToken question finalized before fork`): shares of a question whose claims were final before the fork redeem in the source universe; a canonical source question ledger that is not yet `PoolForked` has no final outcome and no inherited fixed outcome, because fork-mode activation rejects both; positive source balance; nonempty, strictly increasing, well-formed outcomes; every target in a multi-target call already has a canonical child question ledger; a single target without one requires the security pool\u2019s fork branch into that universe to be active (`Fork branch not active: run prepareBranch, startBranch and finalizeBranch first`); each target is an immediate native child, including when its bound question contract skips intermediate reporter ancestors; at least one selected child has an unmaterialized balance; under [A22 asset-recipient compatibility](./security-model.html#assumption-a22), a contract holder accepts `onERC1155Received` for every target mint.',
				signals: 'Canonical child preparation may emit `QuestionLedgerRegistered`, `DeployQuestionLedger`, and share-token `AuthorizationUpdated`. Successful materialization emits ERC-1155 `TransferSingle` and `Migrate` for each target.',
			},
			{
				call: '`authorize(questionLedgerCandidate)`',
				caller: 'Initially authorized `SecurityPoolFactory` for an origin question ledger; an authorized parent `QuestionLedger` for a child question ledger',
				effect: 'Establishes the candidate as `canonicalQuestionLedgerByUniverse` for its universe and adds it to the set allowed to mint, burn, and authorize descendants. Reauthorizing the same candidate is a no-op.',
				declarations: [
					{
						name: 'authorize',
					},
				],
				preconditions: 'Caller is already authorized; the candidate reports this exact share token; its universe has no different canonical question ledger.',
				signals: '`AuthorizationUpdated` on first authorization; no event when the same candidate is already authorized',
			},
			{
				call: '`mintCompleteSets(universeId, account, amountAttoShares)`',
				caller: 'An authorized `QuestionLedger`',
				effect: "Mints `amountAttoShares` each of Invalid, Yes, and No to `account`, then invokes its ERC-1155 batch-receiver callback when it is a contract. Rejection rolls back the mint and the authorized question ledger's surrounding transaction.",
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
				caller: 'An authorized `QuestionLedger`',
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
				caller: 'An authorized `QuestionLedger`',
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
