import type { ContractReference } from './contract-reference-metadata.mts'
export const questionLedgerContractReference: ContractReference = {
	compiledAbiFingerprint: '4f97bfd0bab8c31d9feb92cd9e7b4a5deb8a0f101af0a5bad29a7010dbb04b96',
	name: 'QuestionLedger',
	interactionNotes: 'See the [security pool module boundaries](./contract-inventory.html#security-pool-boundary) for capital, settlement, and reporter custody.',
	purpose: 'Question ledger for one shared security pool, question and universe. Shares and reporting are question-specific; provider capital, settlement cash and fees are accounted centrally.',
	readAbiFingerprint: '39577cbecb307d806103962c9af8042e5d486d5c35ce6b04d649e8d544a90c63',
	readSurface:
		'Read security pool owner positions from the capital ledger and question fee streams from the settlement book. Amounts named `AttoEth` use raw units of the security pool collateral token; no token metadata is required. After security pool binding, question storage mirrors settlement cash, share supply and `lastSettlementSecurityPoolTime`, the security pool time of its last checkpoint. Fee stream deadlines use native time; question storage does not enumerate owners. `additionalMintCapacityAttoEth` is zero once the question ends, reporting starts or its admission policy rejects it; otherwise it returns available shared capacity, excluding existing question collateral. `attoSharesToAttoEth`, `attoSharesToAttoRep` and `attoEthToAttoShares` quote central settlement including fork recovery rights. The collateral quote projects holding fees through the effective price checkpoint. After the source book seals, active source claims quote zero current collateral and REP proceeds; protected claims finalized in that source retain their ordinary quotes. `isEscalationResolved` recognizes inherited final outcomes and locally finalized reports. The settlement book tracks each question’s fee stream. An unreported question can continue paying fees after its calendar end until reporting starts. `initialReportingResponseWindow` returns the seconds between the first report and ordinary escalation game activation, and can be read before a game exists. Additional validated configuration and accounting getters: `questionId`, `universeId`, `initialEscalationGameDepositAttoRep`, `zoltar`, `parent`, `shareToken`, `repToken`, `priceFeed`, `openOracle`, `escalationGameFactory`, `escalationGame`, `questionData`, `questionForker`, `securityPoolFactory`, `settlementCollateralAttoEth`, `statoblastSecurityMultiplierBps`, `shareTokenSupplyAttoShares`, `lastSettlementSecurityPoolTime`, `awaitingForkContinuation`, `systemState`, `securityPoolCustody`.',
	securityBoundary:
		'Price-sensitive withdrawal, commitment-increase, and liquidation calls depend on [A16 timely inclusion](./security-model.html#assumption-a16), [A21 REP and selected collateral behavior](./security-model.html#assumption-a21), [A19 observable correctable price](./security-model.html#assumption-a19), and [A06 lifecycle executors](./security-model.html#assumption-a06). User-initiated question ledger calls additionally depend on [A28 account authority](./security-model.html#assumption-a28).',
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
			name: 'additionalMintCapacityAttoEth',
		},
		{
			name: 'isEscalationResolved',
		},
	],
	readStorageDeclarations: [
		{
			name: 'initialReportingResponseWindow',
		},
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
			name: 'priceFeed',
		},
		{
			name: 'openOracle',
		},
		{
			name: 'escalationGameFactory',
		},
		{
			name: 'escalationGame',
			sourcePath: 'solidity/contracts/statoblast/QuestionLedgerStorage.sol',
		},
		{
			name: 'questionData',
		},
		{
			name: 'questionForker',
		},
		{
			name: 'securityPoolFactory',
		},
		{
			name: 'settlementCollateralAttoEth',
			sourcePath: 'solidity/contracts/statoblast/QuestionLedgerStorage.sol',
		},
		{
			name: 'statoblastSecurityMultiplierBps',
		},
		{
			name: 'shareTokenSupplyAttoShares',
			sourcePath: 'solidity/contracts/statoblast/QuestionLedgerStorage.sol',
		},
		{
			name: 'lastSettlementSecurityPoolTime',
			sourcePath: 'solidity/contracts/statoblast/QuestionLedgerStorage.sol',
		},
		{
			name: 'awaitingForkContinuation',
			sourcePath: 'solidity/contracts/statoblast/QuestionLedgerStorage.sol',
		},
		{
			name: 'systemState',
			sourcePath: 'solidity/contracts/statoblast/QuestionLedgerStorage.sol',
		},
		{
			name: 'securityPoolCustody',
			sourcePath: 'solidity/contracts/statoblast/QuestionLedgerStorage.sol',
		},
	],
	sourcePath: 'solidity/contracts/statoblast/QuestionLedger.sol',
	interactions: [
		{
			call: '`setSecurityPoolCustody(custody)`',
			caller: 'The canonical security pool',
			effect: 'Binds its central capital ledger once and registers the question fee stream.',
			declarations: [
				{
					name: 'setSecurityPoolCustody',
				},
			],
			preconditions: 'Nonzero custody; not already bound; caller matches factory registration.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`creditEscalationSurplus(amountAttoRep)`',
			caller: 'The active escalation game',
			effect: 'Transfers irrevocable surplus REP to the security pool for vested provider earnings. Reporter principal remains separate.',
			declarations: [
				{
					name: 'creditEscalationSurplus',
				},
			],
			preconditions: 'Caller matches the configured game; REP has already been transferred.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`refreshSecurityPoolFees()`',
			caller: 'Anyone',
			effect: 'Refreshes the question linear stream and settlement mirrors.',
			declarations: [
				{
					name: 'refreshSecurityPoolFees',
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
			call: '`createCompleteSet(cash, recipient, minimumShares, fee, premium)`',
			caller: 'The registered security pool purchase route',
			effect: 'Completes central settlement and purchase-fee funding, then mints question complete sets directly to the recipient.',
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
			effect: 'Burns complete sets and pays their current collateral and recovery REP entitlement. Released exposure becomes available to the security pool.',
			declarations: [
				{
					name: 'redeemCompleteSet',
				},
			],
			preconditions: 'Operational unforked universe; holder has all outcome shares. Collateral and recovery REP are paid at their execution-time values without caller-supplied floors; worthless shares can be disposed of.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`redeemShares()`',
			caller: 'A winning-share holder',
			effect: 'Burns winning shares and pays their central collateral and recovery REP entitlement.',
			declarations: [
				{
					name: 'redeemShares',
				},
			],
			preconditions: 'Operational question with a final outcome; finalized claims retain their protected settlement path. Collateral and recovery REP are paid at their execution-time values without caller-supplied floors.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`depositWalletRepToEscalationGame(outcome, maximumDepositAttoRep)`',
			caller: 'Any reporter',
			effect: 'Transfers accepted wallet REP into separate reporter custody and records the chosen outcome; starts the game if needed, deploying it unless `EscalationGameFactory.prepareEscalationGame` already did.',
			declarations: [
				{
					name: 'depositWalletRepToEscalationGame',
				},
			],
			preconditions: 'Valid outcome, wallet allowance and balance, operational reporting window; no inherited fixed outcome.',
			signals: '`EscalationGameSet` when the game is created, followed by reporter deposit and REP transfer events.',
		},
		{
			call: '`depositWalletRepToEscalationGameWithLead(outcome, maximumDepositAttoRep)`',
			caller: 'Any reporter',
			effect: 'Performs the ordinary wallet deposit only if it leaves the chosen outcome strictly leading, or fills its non-decision threshold. The reporting UI uses this protected form when the caller requests a leading result.',
			declarations: [{ name: 'depositWalletRepToEscalationGameWithLead' }],
			preconditions: 'Ordinary wallet reporting prerequisites; the resulting outcome balance exceeds every other balance or fills its threshold (`Deposit does not lead`). An opposing top-up that invalidates this condition causes the whole transaction to revert.',
			signals: 'The ordinary wallet deposit signals; none survive a failed lead condition.',
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
			effect: 'Settles authenticated inherited leaves without migrating every reporter. Payouts go to the recorded owner.',
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
			call: '`setStartingParams()`',
			caller: 'The factory',
			effect: 'Initializes the question fee clock.',
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
			caller: 'QuestionForker only',
			declarations: [
				{
					name: 'activateForkMode',
				},
			],
			effect: 'Freezes shared security pool accounting and marks the question forked.',
			preconditions: 'No inherited fixed outcome; the central fork checks apply.',
			signals: '`SystemStateSet` on the transition to forked, and none for a repeated call; relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`initializeForkedEscalationGame(startBondAttoRep, nonDecisionThresholdAttoRep, elapsedAtFork, fixedQuestionOutcome)`',
			caller: 'QuestionForker only',
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
			call: '`initializeForkCarryOutcome(sourceGame, snapshotId, peaks, leafCount, carryTotalAttoRep, resolutionBalanceAttoRep)`',
			caller: '`QuestionForker` only',
			declarations: [
				{
					name: 'initializeForkCarryOutcome',
				},
			],
			effect: 'Installs the next outcome of the continuation game’s canonical snapshot. Three calls install immutable inherited roots and leaf counts, plus append-only current peaks, carry totals and resolution balances. Sources export only live carry, which never contains spent deposits.',
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
			effect: 'Resumes a prepared continuation from the shared child branch activation timestamp.',
			preconditions: 'Complete authenticated carry snapshot and funded central reporter custody.',
			signals: 'Relevant share, reporting or central accounting events; no standalone vault accounting.',
		},
		{
			call: '`setAwaitingForkContinuation(shouldAwait)`',
			caller: '`QuestionForker` only',
			declarations: [
				{
					name: 'setAwaitingForkContinuation',
				},
			],
			effect: 'Stores whether complete-set minting must wait for continuation initialization, then refreshes bound security pool fee accounting.',
			preconditions: 'No lifecycle or value-change guard.',
			signals: '`AwaitingForkContinuationSet`, including for a repeated value; bound question ledgers then emit central checkpoints and stream replacement when applicable',
		},
		{
			call: '`setSystemState(newState)`',
			caller: '`QuestionForker` only',
			declarations: [
				{
					name: 'setSystemState',
				},
			],
			effect: 'Replaces the question ledger lifecycle state directly, then refreshes bound security pool fee accounting.',
			preconditions: 'No transition or value-change guard.',
			signals: '`SystemStateSet`, including for a repeated state; bound question ledgers then emit central checkpoints and stream replacement when applicable',
		},
		{
			call: '`authorizeChildQuestionLedger(pool)`',
			caller: '`QuestionForker` only',
			declarations: [
				{
					name: 'authorizeChildQuestionLedger',
				},
			],
			effect: 'Asks the lineage share token to establish `pool` as the canonical authorized question ledger for its universe; reauthorizing the same question ledger is a no-op.',
			preconditions: 'This parent question ledger is already authorized; candidate reports this share token; candidate universe has no different canonical question ledger. No question ledger lifecycle guard.',
			signals: '`AuthorizationUpdated` only on first authorization; no event when already authorized',
		},
	],
}
