import { getAddress, type Address, type Hash } from '../support/bot-shared.ts'
import type { EcosystemSnapshot } from '../../src/operations/types.ts'

export const address = (value: number): Address => getAddress(`0x${value.toString(16).padStart(40, '0')}`)
export const hash = (value: number): Hash => `0x${value.toString(16).padStart(64, '0')}`

export function snapshotFixture(): EcosystemSnapshot {
	const wallet = address(1)
	const zoltar = address(2)
	const questionData = address(3)
	const factory = address(4)
	const forker = address(5)
	const openOracle = address(6)
	const weth = address(7)
	const tradingFactory = address(8)
	const router = address(9)
	const rep = address(10)
	const pool = address(11)
	const coordinator = address(12)
	const shareToken = address(13)
	const pair = address(14)
	return {
		anchor: { baseFeePerGas: '1', blockHash: hash(100), blockNumber: '100', timestamp: '2000000000' },
		auctions: [],
		chainId: 31337,
		deployments: { openOracle, questionData, securityPoolFactory: factory, securityPoolForker: forker, tradingFactory, tradingRouter: router, weth, zoltar },
		escalationDeposits: [],
		pairs: [{ address: pair, effectiveNoReserve: '1000000000000000000', effectiveYesReserve: '1000000000000000000', feeBps: 30, noReserve: '1000000000000000000', pool, shareToken, status: 0, totalSupply: '1000000000000000000', universeId: '0', walletLiquidity: '1000000000000000', yesReserve: '1000000000000000000' }],
		pools: [
			{
				address: pool,
				awaitingForkContinuation: false,
				canonicalVaultCount: '1',
				coordinator,
				currentMintingCapacityAttoEth: (10n ** 19n).toString(),
				escalationCanTriggerOwnFork: false,
				escalationForkContinuation: false,
				escalationForkCarryFundingComplete: false,
				escalationForkResumedAt: '0',
				escalationFinalQuestionResolution: 3,
				escalationGame: address(15),
				escalationGameEndTime: '2000001000',
				escalationHasReachedNonDecision: false,
				escalationNonDecisionState: 0,
				escalationNonDecisionThresholdAttoRep: 1_000n.toString(),
				escalationOutcomeBalancesAttoRep: ['0', '0', '0'],
				directEscalationDepositQuotes: [
					{ acceptedAmountAttoRep: 1_000n.toString(), maximumDepositAttoRep: 1_000n.toString(), mutationExpectedSuccess: false, resultingCumulativeAmountAttoRep: 1_000n.toString() },
					{ acceptedAmountAttoRep: 1_000n.toString(), maximumDepositAttoRep: 1_000n.toString(), mutationExpectedSuccess: false, resultingCumulativeAmountAttoRep: 1_000n.toString() },
					{ acceptedAmountAttoRep: 1_000n.toString(), maximumDepositAttoRep: 1_000n.toString(), mutationExpectedSuccess: false, resultingCumulativeAmountAttoRep: 1_000n.toString() },
				],
				safeEscalationDepositMaximumsAttoRep: ['1000', '1000', '1000'],
				escalationRepBalanceAttoRep: 0n.toString(),
				escalationResolved: false,
				escalationResidualSweepExpectedSuccess: false,
				escalationStartBondAttoRep: 1_000n.toString(),
				forkActivationTime: '0',
				forkCarrySnapshotInitialized: false,
				feeIndex: '0',
				forkOutcomeIndex: '0',
				forkOwnQuestion: false,
				forkMigratedAttoRep: 0n.toString(),
				forkRepMigrationProgressByOutcome: {},
				forkRepMigrationTargetAttoRep: 0n.toString(),
				forkUnresolvedEscalation: false,
				lastRepPerEthPrice: '1000000000000000000',
				lastOracleSettlementTimestamp: '1999999900',
				lastUpdatedFeeAccumulator: '1999999999',
				minimumToken1ReportAttoEth: 10_000_000_000_000_002n.toString(),
				minimumSafeWalletVaultDepositAttoRep: 1_000n.toString(),
				minimumVaultRepDepositAttoRep: 1_000n.toString(),
				oraclePriceValid: true,
				oracleRequestFunding: {
					escalationHaltMultiplierBps: '10000',
					feePercentage: '0',
					gasConsumedOpenOracleReportPrice: '3',
					gasUnitsForOneDispute: '1',
					initialReportPriorityFeeAttoEthPerGas: 1n.toString(),
					openOracleSecurityMultiplierBps: '10000',
					protocolFee: '0',
					settlementCallbackGasLimit: '2',
					targetPriceErrorForDispute: '10000000',
				},
				oracleSettlementTime: '900',
				pendingReportId: '0',
				pendingReportSettled: false,
				parent: address(0),
				parentForkActivationTime: '0',
				poolRepBalanceAttoRep: (10n ** 18n).toString(),
				questionId: '77',
				questionOutcome: 3,
				repToken: rep,
				requestPriceCostAttoEth: 121n.toString(),
				projectedSettlementCollateralAttoEth: (10n ** 18n).toString(),
				settlementCollateralAttoEth: (10n ** 18n).toString(),
				shareTokenSupplyAttoShares: (10n ** 36n).toString(),
				totalBadDebtAttoEth: 0n.toString(),
				shareToken,
				statoblastSecurityMultiplierBps: '11000',
				systemState: 0,
				totalCapacityOwnershipAttoRep: (10n ** 18n).toString(),
				totalPoolHeldAttoRep: (10n ** 18n).toString(),
				totalRepBackingUnits: '1000000000000000000',
				truthAuction: address(0),
				unassignedBadDebtAttoEth: 0n.toString(),
				unassignedCapacityOwnershipAttoRep: 0n.toString(),
				unassignedRepBackingAttoRep: 0n.toString(),
				unresolvedEscalationMigrationReadyOutcomes: [],
				universeId: '0',
				stagedOperationCounter: '0',
				vaultDiscoveryComplete: true,
				vaults: [
					{
						address: wallet,
						badDebtAttoEth: 0n.toString(),
						capacityOwnershipAttoRep: (10n ** 18n).toString(),
						claimableFeesAttoEth: 1_000n.toString(),
						disputeStakedAttoRep: 0n.toString(),
						feeIndex: '0',
						openInterestAttoEth: 0n.toString(),
						repBackingAttoRep: (10n ** 18n).toString(),
						repBackingUnits: '1000000000000000000',
					},
				],
				walletEscalationMaterializedOutcomes: [false, false, false],
				walletVaultRegistered: true,
			},
		],
		questions: [{ createdAt: '1', endTime: '1999999999', id: '77', kind: 'binary', numTicks: '0', outcomeLabels: ['Yes', 'No'], startTime: '1' }],
		reports: [],
		schemaVersion: 1,
		stagedOperations: [],
		universes: [
			{
				forkBurnDivisor: '5',
				forkQuestionId: '0',
				forkThresholdAttoRep: (10n ** 18n).toString(),
				forkTime: '0',
				id: '0',
				initialEscalationDepositAttoRep: (10n ** 18n).toString(),
				knownChildOutcomes: [],
				migrationBalance: '0',
				migrationRepSplitProgressByOutcome: {},
				nonDecisionThresholdAttoRep: (2n * 10n ** 18n).toString(),
				repToken: rep,
			},
		],
		wallet: {
			address: wallet,
			ethBalanceAttoEth: (10n ** 19n).toString(),
			lpTokens: [{ allowanceToRouter: '0', balance: '1000000000000000', pair }],
			openOracleEthCredit: '1',
			shares: [{ invalid: '1000000000000000000', isApprovedForAll: { [pair]: false, [router]: false }, migrationProgressByRoute: {}, no: '1000000000000000000', shareToken, universeId: '0', yes: '1000000000000000000' }],
			tokens: [
				{ address: rep, allowances: { [openOracle]: '0', [pool]: '0', [address(15)]: '0', [zoltar]: '0' }, balance: '10000000000000000000', openOracleCredit: '1', openOracleInternalAllowanceToSelf: '0', symbol: 'REP' },
				{ address: weth, allowances: { [openOracle]: '0', [pool]: '0', [zoltar]: '0' }, balance: '1000000000000000000', openOracleCredit: '1', openOracleInternalAllowanceToSelf: '0', symbol: 'WETH' },
			],
		},
		warnings: [],
	}
}
