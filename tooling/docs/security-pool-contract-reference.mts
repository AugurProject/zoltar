import type { ContractReference } from './contract-reference-metadata.mts'
export const securityPoolContractReference: ContractReference = {
	compiledAbiFingerprint: 'e147bc36ab1d3343ca30c88666ec72d36b19246490e6dbd562bb117ec58f4e9f',
	name: 'SecurityPool',
	interactionNotes:
		'All deployed question ledgers belong to a portfolio. Providers use its capital ledger for deposits, commitments, health targets, retirement and liquidation. Reporters fund separate reporter custody with wallet REP. Purchases use the registered portfolio route; traders redeem through the question ledger. There is no standalone vault, tick auction or operation queue.',
	purpose: 'Question ledger for one shared portfolio, question and universe. Shares and reporting are question-specific; provider capital, settlement cash and fees are accounted centrally.',
	readAbiFingerprint: '2c146710571c345bfcd78d7da6ffb8e0e9705d2c4efe5317b77b3233b7e9e9f3',
	readSurface:
		'Read portfolio owner positions from the capital ledger and question fee streams from the settlement book. Native storage mirrors settlement cash, share supply and the last fee checkpoint; it does not enumerate owners. `getTotalPoolHeldAttoRep` is always zero because provider capital is central. `getCurrentMintingCapacityAttoEth` is zero after reporting starts; otherwise it includes current question collateral and available shared capacity. `attoSharesToAttoEth`, `attoSharesToAttoRep` and `attoEthToAttoShares` quote central settlement including fork recovery rights. `isEscalationResolved` recognizes inherited final outcomes and locally finalized reports. `getFeeEpochEndTime` is the native fee cutoff, bounded by the universe fork time. Additional validated configuration and accounting getters: `questionId`, `universeId`, `initialEscalationGameDepositAttoRep`, `zoltar`, `parent`, `shareToken`, `repToken`, `openOraclePriceCoordinator`, `openOracle`, `escalationGameFactory`, `eventEmitter`, `escalationGame`, `questionData`, `securityPoolForker`, `truthAuction`, `securityPoolFactory`, `settlementCollateralAttoEth`, `statoblastSecurityMultiplierBps`, `shareTokenSupplyAttoShares`, `lastUpdatedFeeAccumulator`, `awaitingForkContinuation`, `systemState`, `portfolioCustody`.',
	securityBoundary:
		'Price-sensitive withdrawal, commitment-increase, and liquidation calls depend on [A16 timely inclusion](./security-model.html#assumption-a16), [A21 genesis REP and WETH behavior](./security-model.html#assumption-a21), [A19 observable correctable price](./security-model.html#assumption-a19), and [A06 lifecycle executors](./security-model.html#assumption-a06). User-initiated pool calls additionally depend on [A28 account authority](./security-model.html#assumption-a28).',
	readDeclarations: [
		{
			name: 'attoSharesToAttoEth',
		},
		{
			name: 'attoSharesToAttoRep',
		},
		{
			name: 'attoEthToAttoShares',
		},
		{
			name: 'getTotalPoolHeldAttoRep',
		},
		{
			name: 'getFeeEpochEndTime',
		},
		{
			name: 'getCurrentMintingCapacityAttoEth',
		},
		{
			name: 'isEscalationResolved',
		},
	],
	readStorageDeclarations: [
		{
			name: 'questionId',
		},
		{
			name: 'universeId',
		},
		{
			name: 'initialEscalationGameDepositAttoRep',
		},
		{
			name: 'zoltar',
		},
		{
			name: 'parent',
		},
		{
			name: 'shareToken',
		},
		{
			name: 'repToken',
		},
		{
			name: 'openOraclePriceCoordinator',
		},
		{
			name: 'openOracle',
		},
		{
			name: 'escalationGameFactory',
		},
		{
			name: 'eventEmitter',
		},
		{
			name: 'escalationGame',
			sourcePath: 'solidity/contracts/statoblast/SecurityPoolStorage.sol',
		},
		{
			name: 'questionData',
		},
		{
			name: 'securityPoolForker',
		},
		{
			name: 'truthAuction',
		},
		{
			name: 'securityPoolFactory',
		},
		{
			name: 'settlementCollateralAttoEth',
			sourcePath: 'solidity/contracts/statoblast/SecurityPoolStorage.sol',
		},
		{
			name: 'statoblastSecurityMultiplierBps',
			sourcePath: 'solidity/contracts/statoblast/SecurityPoolStorage.sol',
		},
		{
			name: 'shareTokenSupplyAttoShares',
			sourcePath: 'solidity/contracts/statoblast/SecurityPoolStorage.sol',
		},
		{
			name: 'lastUpdatedFeeAccumulator',
			sourcePath: 'solidity/contracts/statoblast/SecurityPoolStorage.sol',
		},
		{
			name: 'awaitingForkContinuation',
			sourcePath: 'solidity/contracts/statoblast/SecurityPoolStorage.sol',
		},
		{
			name: 'systemState',
			sourcePath: 'solidity/contracts/statoblast/SecurityPoolStorage.sol',
		},
		{
			name: 'portfolioCustody',
			sourcePath: 'solidity/contracts/statoblast/SecurityPoolStorage.sol',
		},
	],
	sourcePath: 'solidity/contracts/statoblast/SecurityPool.sol',
	interactions: [
		{
			call: '`setPortfolioCustody(custody)`',
			caller: 'The canonical portfolio',
			effect: 'Binds its central capital ledger once and registers the question fee stream.',
			declarations: [
				{
					name: 'setPortfolioCustody',
				},
			],
			preconditions: 'Nonzero custody; not already bound; caller matches factory registration.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`creditEscalationSurplus(amountAttoRep)`',
			caller: 'The active escalation game',
			effect: 'Transfers irrevocable surplus REP to the portfolio for vested provider earnings. Reporter principal remains separate.',
			declarations: [
				{
					name: 'creditEscalationSurplus',
				},
			],
			preconditions: 'Caller matches the configured game; REP has already been transferred.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`refreshPortfolioFees()`',
			caller: 'Anyone',
			effect: 'Refreshes the question linear stream and settlement mirrors.',
			declarations: [
				{
					name: 'refreshPortfolioFees',
				},
			],
			preconditions: 'Central accounting is bound.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`burnEscalationWinnerHaircut(amountAttoRep)`',
			caller: 'The active escalation game',
			effect: 'Burns the winning settlement haircut through Zoltar.',
			declarations: [
				{
					name: 'burnEscalationWinnerHaircut',
				},
			],
			preconditions: 'Caller matches the configured game; REP has already been transferred.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`createCompleteSet()` with ETH',
			caller: 'The registered portfolio purchase route',
			effect: 'Mints question complete sets using central settlement cash and shared backing. The portfolio transfers the resulting shares to the buyer.',
			declarations: [
				{
					name: 'createCompleteSet',
				},
			],
			preconditions: 'Operational unforked universe, reporting not started, question not ended, authenticated purchase and sufficient healthy backing.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`redeemCompleteSet(amountAttoShares)`',
			caller: 'A complete-set holder',
			effect: 'Burns complete sets and pays their current ETH and recovery REP entitlement. Released exposure becomes available to the portfolio.',
			declarations: [
				{
					name: 'redeemCompleteSet',
				},
			],
			preconditions: 'Operational unforked universe; holder has all outcome shares.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`redeemShares()`',
			caller: 'A winning-share holder',
			effect: 'Burns winning shares and pays their central ETH and recovery REP entitlement.',
			declarations: [
				{
					name: 'redeemShares',
				},
			],
			preconditions: 'Operational question with a final outcome; finalized claims retain their protected settlement path.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`depositWalletRepToEscalationGame(outcome, maximumDepositAttoRep)`',
			caller: 'Any reporter',
			effect: 'Transfers accepted wallet REP into separate reporter custody and records the chosen outcome; creates the game if needed.',
			declarations: [
				{
					name: 'depositWalletRepToEscalationGame',
				},
			],
			preconditions: 'Valid outcome, wallet allowance and balance, operational reporting window; no inherited fixed outcome.',
			signals: '`EscalationGameSet` when the game is created, followed by reporter deposit and REP transfer events.',
		},
		{
			call: '`withdrawFromEscalationGame(outcome, depositIndexes)`',
			caller: 'Anyone, for one recorded depositor',
			effect: 'Settles the supplied local deposit indexes. Payout goes to the recorded owner; losing claims receive no REP.',
			declarations: [
				{
					name: 'withdrawFromEscalationGame',
				},
			],
			preconditions: 'Operational question and final outcome; unresolved parent claims follow the child settlement path.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`withdrawForkedEscalationDeposits(outcome, proofs)`',
			caller: 'Anyone, for one recorded depositor',
			effect: 'Settles authenticated inherited leaves without migrating every reporter. Bounded checkpoints prepare deep history; payouts go to the recorded owner.',
			declarations: [
				{
					name: 'withdrawForkedEscalationDeposits',
				},
			],
			preconditions: 'Operational finalized question, valid unconsumed proofs, one depositor per batch.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`updateSettlementCollateral()`',
			caller: 'Anyone',
			effect: 'Checkpoints central question fees and updates the local settlement mirror.',
			declarations: [
				{
					name: 'updateSettlementCollateral',
				},
			],
			preconditions: 'Central accounting is bound.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`updateRetentionRate()`',
			caller: 'Anyone',
			effect: 'Refreshes the central linear fee stream. No standalone retention curve is maintained.',
			declarations: [
				{
					name: 'updateRetentionRate',
				},
			],
			preconditions: 'Central accounting is bound.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`setStartingParams(currentRetentionRate, settlementCollateralAttoEth)`',
			caller: 'The factory',
			effect: 'Initializes the question fee clock and settlement mirror.',
			declarations: [
				{
					name: 'setStartingParams',
				},
			],
			preconditions: 'Factory authentication; deployment initialization.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`activateForkMode()`',
			caller: 'The canonical forker',
			declarations: [
				{
					name: 'activateForkMode',
				},
			],
			effect: 'Freezes shared portfolio accounting and marks the question forked.',
			preconditions: 'No inherited fixed outcome; the central fork checks apply.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`initializeForkedEscalationGame(startBondAttoRep, nonDecisionThresholdAttoRep, elapsedAtFork, fixedQuestionOutcome)`',
			caller: 'The canonical forker',
			declarations: [
				{
					name: 'initializeForkedEscalationGame',
				},
			],
			effect: 'Deploys a continuation game with the inherited bond, threshold, elapsed time and outcome.',
			preconditions: 'No existing game.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`initializeForkCarryOutcome(sourceGame, snapshotId, peaks, leafCount, carryTotalAttoRep, resolutionBalanceAttoRep, nullifierRoot)`',
			caller: '`SecurityPoolForker` only',
			declarations: [
				{
					name: 'initializeForkCarryOutcome',
				},
			],
			effect: 'Installs the next outcome of the continuation game’s canonical snapshot. Three calls complete its immutable carry peaks, counts, totals, resolution balances, and normalized nullifier roots.',
			preconditions: 'A game is configured; it is a fork continuation with fewer than three initialized outcomes; leaf counts fit the MMR; every call supplies the same source and nonzero snapshot ID, with the next outcome’s data; the third call verifies the full commitment.',
			signals: '`ForkCarryCheckpoint` on completion of the third outcome',
		},
		{
			call: '`resumeForkedEscalationGame()`',
			caller: 'Anyone',
			declarations: [
				{
					name: 'resumeForkedEscalationGame',
				},
			],
			effect: 'Resumes a prepared continuation at its fixed logical-clock anchor.',
			preconditions: 'Complete authenticated carry snapshot and funded central reporter custody.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`setAwaitingForkContinuation(shouldAwait)`',
			caller: '`SecurityPoolForker` only',
			declarations: [
				{
					name: 'setAwaitingForkContinuation',
				},
			],
			effect: 'Stores whether complete-set minting must wait for continuation initialization, then refreshes bound portfolio fee accounting.',
			preconditions: 'No lifecycle or value-change guard.',
			signals: '`AwaitingForkContinuationSet`, including for a repeated value; bound pools then emit central checkpoints and stream replacement when applicable',
		},
		{
			call: '`setSystemState(newState)`',
			caller: '`SecurityPoolForker` only',
			declarations: [
				{
					name: 'setSystemState',
				},
			],
			effect: 'Replaces the pool lifecycle state directly, then refreshes bound portfolio fee accounting.',
			preconditions: 'No transition or value-change guard.',
			signals: '`SystemStateSet`, including for a repeated state; bound pools then emit central checkpoints and stream replacement when applicable',
		},
		{
			call: '`setShareTokenSupplyAttoShares(newShareTokenSupplyAttoShares)`',
			caller: 'The canonical forker',
			declarations: [
				{
					name: 'setShareTokenSupplyAttoShares',
				},
			],
			effect: 'Initializes the child question share-supply mirror.',
			preconditions: 'Caller is the immutable forker.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`authorizeChildPool(pool)`',
			caller: '`SecurityPoolForker` only',
			declarations: [
				{
					name: 'authorizeChildPool',
				},
			],
			effect: 'Asks the lineage share token to establish `pool` as the canonical authorized pool for its universe; reauthorizing the same pool is a no-op.',
			preconditions: 'This parent pool is already authorized; candidate reports this share token; candidate universe has no different canonical pool. No pool-lifecycle guard.',
			signals: '`AuthorizationUpdated` only on first authorization; no event when already authorized',
		},
		{
			call: 'Direct ETH transfer to `receive()`',
			caller: 'Portfolio transfers and permitted initialization senders',
			effect: 'Accepts ETH; unsolicited ETH creates no settlement or provider claim.',
			declarations: [
				{
					kind: 'receive',
					name: 'receive',
				},
			],
			preconditions: 'Bound portfolio, or the configured parent, forker or auction sender before binding.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
	],
}
