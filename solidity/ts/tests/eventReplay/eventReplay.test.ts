import { beforeEach, describe, expect, test } from 'bun:test'
import { decodeEventLog, zeroAddress, type Abi, type Address, type Hex } from '@zoltar/shared/ethereum'
import {
	peripherals_EscalationGame_EscalationGame,
	peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
	peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	peripherals_SecurityPool_SecurityPool,
	peripherals_SecurityPoolForker_SecurityPoolForker,
	peripherals_tokens_ShareToken_ShareToken,
	Zoltar_Zoltar,
} from '../../types/contractArtifact'
import { getMigrationRepBalanceAttoRep, getUniverseData, getUniverseTheoreticalSupplyAttoRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { hashCarryLeaf, hashParent } from '../carryProofHelpers'
import { isIgnorableLogDecodeError } from '../logDecodeErrors'
import { usePeripheralsForkMigrationFixture, type PeripheralsForkMigrationFixture } from '../peripherals/fixture'
import { getCanonicalEventIdentity, replayZoltarEvents, type ReplayLog } from './eventReplayModel'

const poolAccountingCheckpointEvent = {
	type: 'event',
	name: 'PoolAccountingCheckpoint',
	inputs: [
		{ name: 'reason', type: 'uint8', indexed: false },
		{ name: 'vault', type: 'address', indexed: true },
		{ name: 'settlementCollateralAttoEth', type: 'uint256', indexed: false },
		{ name: 'totalCoverageCommitmentAttoEth', type: 'uint256', indexed: false },
		{ name: 'feeEligibleCoverageCommitmentAttoEth', type: 'uint256', indexed: false },
		{ name: 'totalClaimableVaultFeesAttoEth', type: 'uint256', indexed: false },
		{ name: 'unallocatedAccruedFeesAttoEth', type: 'uint256', indexed: false },
		{ name: 'feeIndex', type: 'uint256', indexed: false },
		{ name: 'feeIndexRemainder', type: 'uint256', indexed: false },
		{ name: 'totalFeesOwedRemainder', type: 'uint256', indexed: false },
		{ name: 'uncheckpointedFeeEligibleCoverageCommitmentAttoEth', type: 'uint256', indexed: false },
		{ name: 'lastUpdatedFeeAccumulator', type: 'uint256', indexed: false },
		{ name: 'currentRetentionRate', type: 'uint256', indexed: false },
	],
} as const

const poolAccountingSnapshotAbi = [
	{
		type: 'function',
		name: 'getPoolAccountingSnapshot',
		stateMutability: 'view',
		inputs: [],
		outputs: [
			{
				name: 'snapshot',
				type: 'tuple',
				components: [
					{ name: 'settlementCollateralAttoEth', type: 'uint256' },
					{ name: 'totalCoverageCommitmentAttoEth', type: 'uint256' },
					{ name: 'feeEligibleCoverageCommitmentAttoEth', type: 'uint256' },
					{ name: 'totalClaimableVaultFeesAttoEth', type: 'uint256' },
					{ name: 'unallocatedAccruedFeesAttoEth', type: 'uint256' },
					{ name: 'feeIndex', type: 'uint256' },
					{ name: 'feeIndexRemainder', type: 'uint256' },
					{ name: 'totalFeesOwedRemainder', type: 'uint256' },
					{ name: 'uncheckpointedFeeEligibleCoverageCommitmentAttoEth', type: 'uint256' },
					{ name: 'lastUpdatedFeeAccumulator', type: 'uint256' },
					{ name: 'currentRetentionRate', type: 'uint256' },
				],
			},
		],
	},
] as const

const securityPoolForkSnapshotEvent = {
	type: 'event',
	name: 'SecurityPoolForkSnapshot',
	inputs: [
		{ name: 'parentPool', type: 'address', indexed: true },
		{ name: 'migrationProxy', type: 'address', indexed: true },
		{ name: 'ownFork', type: 'bool', indexed: false },
		{ name: 'unresolvedEscalation', type: 'bool', indexed: false },
		{ name: 'settlementCollateralAtForkAttoEth', type: 'uint256', indexed: false },
		{ name: 'poolRepAtForkAttoRep', type: 'uint256', indexed: false },
		{ name: 'auctionableRepAtForkAttoRep', type: 'uint256', indexed: false },
		{ name: 'escalationSourceRepAtForkAttoRep', type: 'uint256', indexed: false },
		{ name: 'escalationChildRepAtForkAttoRep', type: 'uint256', indexed: false },
		{ name: 'escalationStartBondAtForkAttoRep', type: 'uint256', indexed: false },
		{ name: 'escalationNonDecisionThresholdAtForkAttoRep', type: 'uint256', indexed: false },
		{ name: 'escalationElapsedAtFork', type: 'uint256', indexed: false },
		{ name: 'escalationSnapshotId', type: 'bytes32', indexed: false },
	],
} as const

function createReplayLog(overrides: Partial<ReplayLog> = {}): ReplayLog {
	return {
		chainId: 1n,
		blockHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		blockNumber: 1n,
		transactionHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
		transactionIndex: 0,
		logIndex: 0,
		emitter: '0x1111111111111111111111111111111111111111',
		eventName: 'PoolAccountingCheckpoint',
		args: {
			reason: 0n,
			vault: zeroAddress,
			settlementCollateralAttoEth: 1n,
			totalCoverageCommitmentAttoEth: 2n,
			feeEligibleCoverageCommitmentAttoEth: 2n,
			totalClaimableVaultFeesAttoEth: 0n,
			unallocatedAccruedFeesAttoEth: 0n,
			feeIndex: 0n,
			feeIndexRemainder: 0n,
			totalFeesOwedRemainder: 0n,
			uncheckpointedFeeEligibleCoverageCommitmentAttoEth: 0n,
			lastUpdatedFeeAccumulator: 1n,
			currentRetentionRate: 1n,
		},
		...overrides,
	}
}

describe('event-only replay', () => {
	test('canonical identities are stable and orphaned blocks roll back deterministically', () => {
		const canonicalLog = createReplayLog()
		const orphanedLog = createReplayLog({
			blockHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
			blockNumber: 2n,
			transactionHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
			args: { ...canonicalLog.args, settlementCollateralAttoEth: 3n, lastUpdatedFeeAccumulator: 2n },
		})
		const fullState = replayZoltarEvents([orphanedLog, canonicalLog, canonicalLog])
		const emitter = canonicalLog.emitter
		if (fullState.pools.get(emitter)?.settlementCollateralAttoEth !== 3n) throw new Error('ordered replay did not apply the later block')
		if (fullState.identities.size !== 2) throw new Error('duplicate canonical event identity was not ignored')

		const rolledBack = replayZoltarEvents([orphanedLog, canonicalLog], new Set<Hex>([orphanedLog.blockHash]))
		if (rolledBack.pools.get(emitter)?.settlementCollateralAttoEth !== 1n) throw new Error('orphaned block was not removed')
		if (getCanonicalEventIdentity(canonicalLog) !== getCanonicalEventIdentity({ ...canonicalLog })) throw new Error('canonical identity is not deterministic')
	})

	test('vault checkpoints preserve the fractional fee entitlement carried into later accrual', () => {
		const pool = '0x1111111111111111111111111111111111111111'
		const vault = '0x2222222222222222222222222222222222222222'
		const replayed = replayZoltarEvents([
			createReplayLog({
				emitter: pool,
				eventName: 'VaultAccountingCheckpoint',
				args: {
					vault,
					repBackingUnits: 10n,
					coverageCommitmentAttoEth: 3n,
					claimableFeesAttoEth: 1n,
					feeIndex: 4n,
					vaultFeeRemainder: 7n,
					resultingTotalRepBackingUnits: 10n,
					resultingFeeEligibleCoverageCommitmentAttoEth: 3n,
				},
			}),
		])
		const replayedVault = replayed.vaults.get(pool)?.get(vault)
		if (replayedVault?.vaultFeeRemainder !== 7n) throw new Error('vault fee remainder was not replayed')
	})

	test('coordinator checkpoints preserve report sponsorship and operation state', () => {
		const coordinator = '0x1111111111111111111111111111111111111111'
		const sponsor = '0x2222222222222222222222222222222222222222'
		const replayed = replayZoltarEvents([
			createReplayLog({
				emitter: coordinator,
				eventName: 'CoordinatorStateCheckpoint',
				args: {
					reason: 2n,
					reportId: 9n,
					operationId: 4n,
					pendingReportId: 9n,
					pendingReportSponsor: sponsor,
					pendingOperationSlotId: 4n,
					pendingReportMaxSettlementBaseFee: 100n,
					lastPrice: 12n,
					lastSettlementTimestamp: 20n,
					stagedOperationCounter: 4n,
					activeStagedOperationCount: 2n,
					pendingSettlementOperationCount: 1n,
				},
			}),
		])
		const replayedCoordinator = replayed.coordinators.get(coordinator)
		if (replayedCoordinator?.pendingReportSponsor !== sponsor) throw new Error('pending report sponsor was not replayed')
		if (replayedCoordinator.activeStagedOperationCount !== 2n) throw new Error('active operation count was not replayed')
	})

	test('REP discovery replays genesis token history before the ZoltarQuestionData event anchor', () => {
		const zoltar = '0x1111111111111111111111111111111111111111'
		const genesisRep = '0x2222222222222222222222222222222222222222'
		const holder = '0x3333333333333333333333333333333333333333'
		const burn = '0x4444444444444444444444444444444444444444'
		const genesisMint = createReplayLog({
			blockNumber: 1n,
			transactionHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
			emitter: genesisRep,
			eventName: 'Transfer',
			args: { from: zeroAddress, to: holder, value: 100n },
		})
		const universeInitialized = createReplayLog({
			blockNumber: 2n,
			transactionHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
			emitter: zoltar,
			eventName: 'UniverseInitialized',
			args: {
				universeId: 0n,
				forkTime: 0n,
				forkQuestionId: 0n,
				forkingOutcomeIndex: 0n,
				reputationToken: genesisRep,
				parentUniverseId: 0n,
				universeTheoreticalSupplyAttoRep: 100n,
			},
		})
		const forkBurn = createReplayLog({
			blockNumber: 3n,
			transactionHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
			emitter: genesisRep,
			eventName: 'Transfer',
			args: { from: holder, to: burn, value: 40n },
		})
		const universeForked = createReplayLog({
			blockNumber: 3n,
			transactionHash: forkBurn.transactionHash,
			logIndex: 1,
			emitter: zoltar,
			eventName: 'UniverseForked',
			args: {
				forker: holder,
				universeId: 0n,
				questionId: 9n,
				forkTime: 30n,
				forkThresholdAttoRep: 40n,
				migrationRepBalanceAttoRep: 36n,
				universeTheoreticalSupplyAttoRep: 60n,
			},
		})

		const replayed = replayZoltarEvents([universeForked, forkBurn, universeInitialized, genesisMint])
		const tokenBalances = replayed.repBalances.get(genesisRep)
		if (tokenBalances?.get(holder) !== 60n) throw new Error('genesis REP holder balance mismatch')
		if (tokenBalances.get(burn) !== 40n) throw new Error('genesis REP burn-address balance mismatch')
		if (replayed.repSupply.get(genesisRep) !== 100n) throw new Error('genesis REP supply mismatch')
		if (replayed.universeForks.get('0')?.migrationRepBalanceAttoRep !== 36n) throw new Error('genesis universe fork state mismatch')
		if (replayed.universes.get('0')?.universeTheoreticalSupplyAttoRep !== 60n) throw new Error('genesis universe supply checkpoint mismatch')
	})

	test('pool discovery retains earlier setup logs and expands ERC1155 batches by token id', () => {
		const factory = '0x1111111111111111111111111111111111111111'
		const pool = '0x2222222222222222222222222222222222222222'
		const shareToken = '0x3333333333333333333333333333333333333333'
		const coordinator = '0x4444444444444444444444444444444444444444'
		const holder = '0x5555555555555555555555555555555555555555'
		const receiver = '0x6666666666666666666666666666666666666666'
		const unrecognizedEmitter = '0x7777777777777777777777777777777777777777'
		const game = '0x8888888888888888888888888888888888888888'
		const unrecognizedGame = '0x9999999999999999999999999999999999999999'
		const logs = [
			createReplayLog({
				emitter: shareToken,
				eventName: 'AuthorizationUpdated',
				logIndex: 0,
				args: { account: pool, actor: factory, authorized: true },
			}),
			createReplayLog({ emitter: pool, logIndex: 1 }),
			createReplayLog({
				emitter: coordinator,
				eventName: 'CoordinatorStateCheckpoint',
				logIndex: 2,
				args: {
					reason: 0n,
					reportId: 0n,
					operationId: 0n,
					pendingReportId: 0n,
					pendingReportSponsor: zeroAddress,
					pendingOperationSlotId: 0n,
					pendingReportMaxSettlementBaseFee: 0n,
					lastPrice: 0n,
					lastSettlementTimestamp: 0n,
					stagedOperationCounter: 0n,
					activeStagedOperationCount: 0n,
					pendingSettlementOperationCount: 0n,
				},
			}),
			createReplayLog({
				emitter: shareToken,
				eventName: 'TransferBatch',
				logIndex: 3,
				args: { operator: pool, from: zeroAddress, to: holder, ids: [1n, 2n], values: [10n, 20n] },
			}),
			createReplayLog({
				emitter: shareToken,
				eventName: 'TransferBatch',
				logIndex: 4,
				args: { operator: holder, from: holder, to: receiver, ids: [1n, 2n], values: [3n, 5n] },
			}),
			createReplayLog({
				emitter: shareToken,
				eventName: 'TransferBatch',
				logIndex: 5,
				args: { operator: receiver, from: receiver, to: zeroAddress, ids: [1n, 2n], values: [1n, 2n] },
			}),
			createReplayLog({
				emitter: factory,
				eventName: 'DeploySecurityPool',
				logIndex: 8,
				args: {
					securityPool: pool,
					truthAuction: zeroAddress,
					priceOracleManagerAndOperatorQueuer: coordinator,
					shareToken,
					parent: zeroAddress,
					universeId: 1n,
					questionId: 2n,
					statoblastSecurityMultiplierBps: 30_000n,
					initialReportPriorityFeeAttoEthPerGas: 10n,
					currentRetentionRate: 4n,
					settlementCollateralAttoEth: 0n,
				},
			}),
			createReplayLog({
				emitter: unrecognizedEmitter,
				eventName: 'AuthorizationUpdated',
				logIndex: 9,
				args: { account: holder, actor: holder, authorized: true },
			}),
			createReplayLog({ emitter: game, eventName: 'GameStarted', logIndex: 6, args: { activationTime: 10n, startBondAttoRep: 2n, nonDecisionThresholdAttoRep: 20n } }),
			createReplayLog({ emitter: pool, eventName: 'EscalationGameSet', logIndex: 7, args: { escalationGame: game } }),
			createReplayLog({ emitter: unrecognizedGame, eventName: 'GameStarted', logIndex: 10, args: { activationTime: 10n, startBondAttoRep: 2n, nonDecisionThresholdAttoRep: 20n } }),
		]

		const replayed = replayZoltarEvents(logs, new Set(), new Set([factory]))
		if (replayed.poolDeployments.get(pool)?.shareToken !== shareToken) throw new Error('pool relationship was not pre-discovered')
		if (replayed.authorizations.get(shareToken)?.get(pool) !== true) throw new Error('constructor authorization was not retained')
		if (replayed.authorizations.has(unrecognizedEmitter)) throw new Error('unrecognized authorization emitter was accepted')
		if (replayed.escalationLifecycles.get(game)?.activationTime !== 10n) throw new Error('initial game lifecycle was not retained')
		if (replayed.escalationLifecycles.has(unrecognizedGame)) throw new Error('unrecognized escalation-game emitter was accepted')
		if (replayed.pools.get(pool)?.settlementCollateralAttoEth !== 1n) throw new Error('pool initialization checkpoint was not retained')
		if (replayed.coordinators.get(coordinator)?.checkpointReason !== 0n) throw new Error('coordinator setup checkpoint was not retained')
		if (replayed.shareTokenBalances.get(shareToken)?.get(1n)?.get(holder) !== 7n) throw new Error('token 1 holder balance mismatch')
		if (replayed.shareTokenBalances.get(shareToken)?.get(2n)?.get(receiver) !== 3n) throw new Error('token 2 receiver balance mismatch')
		if (replayed.shareTokenSupplies.get(shareToken)?.get(1n) !== 9n) throw new Error('token 1 supply mismatch')
		if (replayed.shareTokenSupplies.get(shareToken)?.get(2n) !== 18n) throw new Error('token 2 supply mismatch')
	})

	test('a question created before root Zoltar deployment replays with universe and coordinator terminal state', () => {
		const questionData = '0x1111111111111111111111111111111111111111'
		const zoltar = '0x2222222222222222222222222222222222222222'
		const repToken = '0x3333333333333333333333333333333333333333'
		const forker = '0x4444444444444444444444444444444444444444'
		const coordinator = '0x5555555555555555555555555555555555555555'
		const pool = '0x6666666666666666666666666666666666666666'
		const logs = [
			createReplayLog({
				emitter: questionData,
				eventName: 'QuestionCreated',
				blockNumber: 1n,
				logIndex: 0,
				args: {
					questionId: 9n,
					createdTimestamp: 10n,
					questionData: {
						title: 'Will the event occur?',
						description: 'Binary event question',
						startTime: 11n,
						endTime: 20n,
						numTicks: 0n,
						displayValueMin: 0n,
						displayValueMax: 0n,
						answerUnit: '',
					},
					outcomeOptions: ['Yes', 'No'],
				},
			}),
			createReplayLog({
				emitter: zoltar,
				eventName: 'UniverseInitialized',
				blockNumber: 2n,
				logIndex: 1,
				args: {
					universeId: 0n,
					forkTime: 0n,
					forkQuestionId: 0n,
					forkingOutcomeIndex: 0n,
					reputationToken: repToken,
					parentUniverseId: 0n,
					universeTheoreticalSupplyAttoRep: 100n,
				},
			}),
			createReplayLog({
				emitter: zoltar,
				eventName: 'UniverseForked',
				logIndex: 2,
				args: {
					forker,
					universeId: 0n,
					questionId: 9n,
					forkTime: 21n,
					forkThresholdAttoRep: 10n,
					migrationRepBalanceAttoRep: 9n,
					universeTheoreticalSupplyAttoRep: 90n,
				},
			}),
			createReplayLog({ emitter: coordinator, eventName: 'SecurityPoolSet', logIndex: 3, args: { securityPool: pool } }),
			createReplayLog({ emitter: coordinator, eventName: 'RepEthPriceSet', logIndex: 4, args: { price: 12n } }),
			createReplayLog({
				emitter: coordinator,
				eventName: 'PriceRequested',
				logIndex: 5,
				args: { reportId: 1n, pendingReportMaxSettlementBaseFee: 100n },
			}),
			createReplayLog({
				emitter: coordinator,
				eventName: 'PriceReportRejected',
				logIndex: 6,
				args: {
					reportId: 1n,
					reason: 'Base fee too high',
					pendingReportId: 0n,
					pendingReportMaxSettlementBaseFee: 0n,
					lastPrice: 12n,
					lastSettlementTimestamp: 20n,
				},
			}),
			createReplayLog({
				emitter: coordinator,
				eventName: 'PriceRequested',
				logIndex: 7,
				args: { reportId: 2n, pendingReportMaxSettlementBaseFee: 101n },
			}),
			createReplayLog({
				emitter: coordinator,
				eventName: 'PriceReported',
				logIndex: 8,
				args: { reportId: 2n, price: 15n, lastSettlementTimestamp: 25n },
			}),
			createReplayLog({
				emitter: coordinator,
				eventName: 'PriceRequested',
				logIndex: 9,
				args: { reportId: 3n, pendingReportMaxSettlementBaseFee: 102n },
			}),
			createReplayLog({
				emitter: coordinator,
				eventName: 'PendingReportRecovered',
				logIndex: 10,
				args: {
					reportId: 3n,
					settlementTimestamp: 26n,
					pendingReportId: 0n,
					pendingReportMaxSettlementBaseFee: 0n,
					lastPrice: 15n,
					lastSettlementTimestamp: 25n,
				},
			}),
			createReplayLog({
				emitter: coordinator,
				eventName: 'StagedOperationQueued',
				logIndex: 11,
				args: {
					operationId: 7n,
					operation: 2n,
					initiatorVault: forker,
					targetVault: pool,
					amount: 3n,
					queuedAt: 27n,
					validForSeconds: 300n,
					snapshotTargetBackingUnits: 11n,
					snapshotTargetCoverageCommitmentAttoEth: 12n,
					snapshotTotalPoolHeldRepAttoRep: 13n,
					snapshotDenominator: 14n,
					isPendingSlot: true,
				},
			}),
			createReplayLog({
				emitter: coordinator,
				eventName: 'PendingOperationRecoveryConsumed',
				logIndex: 12,
				args: { operationId: 7n, operation: 2n },
			}),
		]

		const anchoredLogs = logs.map((log, index) => (index === 0 ? log : { ...log, blockNumber: 2n }))
		const replayed = replayZoltarEvents(anchoredLogs.toReversed())
		if (replayed.questions.get(9n)?.endTime !== 20n) throw new Error('question lifecycle mismatch')
		if (replayed.universeForks.get('0')?.questionId !== 9n) throw new Error('universe fork question mismatch')
		const coordinatorState = replayed.coordinators.get(coordinator)
		if (coordinatorState?.reports.get(1n)?.status !== 'Rejected') throw new Error('rejected coordinator report mismatch')
		if (coordinatorState.reports.get(2n)?.status !== 'Reported') throw new Error('reported coordinator report mismatch')
		if (coordinatorState.reports.get(3n)?.status !== 'Recovered') throw new Error('recovered coordinator report mismatch')
		if (coordinatorState.pendingReportId !== 0n || coordinatorState.lastPrice !== 15n) throw new Error('coordinator resulting state mismatch')
		if (replayed.coordinatorOperations.get(coordinator)?.get(7n)?.status !== 'Recovered') throw new Error('recovered operation mismatch')
	})

	test('contract-local escalation and coordinator counters remain isolated by emitter', () => {
		const firstGame = '0x1111111111111111111111111111111111111111'
		const secondGame = '0x2222222222222222222222222222222222222222'
		const firstCoordinator = '0x3333333333333333333333333333333333333333'
		const secondCoordinator = '0x4444444444444444444444444444444444444444'
		const firstVault = '0x5555555555555555555555555555555555555555'
		const secondVault = '0x6666666666666666666666666666666666666666'
		const logs = [
			createReplayLog({
				emitter: firstGame,
				eventName: 'LocalDepositAppended',
				logIndex: 0,
				args: { nodeId: 1n, outcome: 1n, depositor: firstVault, repAmountAttoRep: 10n, parentDepositIndex: 1n, cumulativeRepAmountAttoRep: 10n },
			}),
			createReplayLog({
				emitter: secondGame,
				eventName: 'LocalDepositAppended',
				logIndex: 1,
				args: { nodeId: 1n, outcome: 1n, depositor: secondVault, repAmountAttoRep: 20n, parentDepositIndex: 1n, cumulativeRepAmountAttoRep: 20n },
			}),
			createReplayLog({
				emitter: firstCoordinator,
				eventName: 'StagedOperationQueued',
				logIndex: 2,
				args: {
					operationId: 1n,
					operation: 0n,
					initiatorVault: firstVault,
					targetVault: firstVault,
					amount: 3n,
					queuedAt: 10n,
					validForSeconds: 300n,
					snapshotTargetBackingUnits: 5n,
					snapshotTargetCoverageCommitmentAttoEth: 6n,
					snapshotTotalPoolHeldRepAttoRep: 7n,
					snapshotDenominator: 8n,
					isPendingSlot: true,
				},
			}),
			createReplayLog({
				emitter: secondCoordinator,
				eventName: 'StagedOperationQueued',
				logIndex: 3,
				args: {
					operationId: 1n,
					operation: 1n,
					initiatorVault: secondVault,
					targetVault: secondVault,
					amount: 4n,
					queuedAt: 11n,
					validForSeconds: 600n,
					snapshotTargetBackingUnits: 9n,
					snapshotTargetCoverageCommitmentAttoEth: 10n,
					snapshotTotalPoolHeldRepAttoRep: 11n,
					snapshotDenominator: 12n,
					isPendingSlot: false,
				},
			}),
		]

		const replayed = replayZoltarEvents(logs.toReversed())
		if (replayed.escalationDeposits.get(firstGame)?.get('1:1')?.depositor !== firstVault) throw new Error('first game deposit counter collided')
		if (replayed.escalationDeposits.get(secondGame)?.get('1:1')?.depositor !== secondVault) throw new Error('second game deposit counter collided')
		if (replayed.coordinatorOperations.get(firstCoordinator)?.get(1n)?.amount !== 3n) throw new Error('first coordinator operation counter collided')
		if (replayed.coordinatorOperations.get(secondCoordinator)?.get(1n)?.amount !== 4n) throw new Error('second coordinator operation counter collided')
	})

	test('escalation claim replay preserves immutable depositors and truth-auction retention', () => {
		const game: Address = '0x1111111111111111111111111111111111111111'
		const firstVault: Address = '0x2222222222222222222222222222222222222222'
		const secondVault: Address = '0x3333333333333333333333333333333333333333'
		const postResumeVault: Address = '0x6666666666666666666666666666666666666666'
		const logs = [
			createReplayLog({
				emitter: game,
				eventName: 'LocalDepositAppended',
				logIndex: 0,
				args: { nodeId: 1n, outcome: 1n, depositor: firstVault, repAmountAttoRep: 100n, parentDepositIndex: 0n, cumulativeRepAmountAttoRep: 100n },
			}),
			createReplayLog({
				emitter: game,
				eventName: 'LocalDepositAppended',
				logIndex: 1,
				args: { nodeId: 2n, outcome: 2n, depositor: secondVault, repAmountAttoRep: 50n, parentDepositIndex: 0n, cumulativeRepAmountAttoRep: 50n },
			}),
			createReplayLog({
				emitter: game,
				eventName: 'DepositOnOutcome',
				logIndex: 2,
				args: { depositor: firstVault, outcome: 1n, repAmountAttoRep: 100n, depositIndex: 0n, cumulativeRepAmountAttoRep: 100n, resultingVaultDisputeStakedRepAttoRep: 100n, resultingTotalDisputeStakedRepAttoRep: 100n },
			}),
			createReplayLog({
				emitter: game,
				eventName: 'DepositOnOutcome',
				logIndex: 3,
				args: { depositor: secondVault, outcome: 2n, repAmountAttoRep: 50n, depositIndex: 0n, cumulativeRepAmountAttoRep: 50n, resultingVaultDisputeStakedRepAttoRep: 50n, resultingTotalDisputeStakedRepAttoRep: 150n },
			}),
			createReplayLog({
				emitter: game,
				eventName: 'TruthAuctionHaircutApplied',
				logIndex: 4,
				args: { repBefore: 150n, repRemoved: 60n, repRemaining: 90n, rebasedElapsed: 10n },
			}),
			createReplayLog({
				emitter: game,
				eventName: 'LocalDepositAppended',
				logIndex: 5,
				args: { nodeId: 3n, outcome: 0n, depositor: postResumeVault, repAmountAttoRep: 1n, parentDepositIndex: 0n, cumulativeRepAmountAttoRep: 1n },
			}),
		]

		const replayed = replayZoltarEvents(logs)
		const bundles = replayed.escalationClaimBundles.get(game)
		const firstBundle = bundles?.get(firstVault)
		const secondBundle = bundles?.get(secondVault)
		const postResumeBundle = bundles?.get(postResumeVault)
		if (firstBundle === undefined || secondBundle === undefined || postResumeBundle === undefined) throw new Error('claim bundles missing')
		expect(firstBundle.depositor).toBe(firstVault)
		expect(secondBundle.depositor).toBe(secondVault)
		expect((firstBundle.claimRepUnits * 90n) / 150n).toBe(60n)
		expect((secondBundle.claimRepUnits * 90n) / 150n).toBe(30n)
		expect(replayed.escalationTotalEscrowedRep.get(game)).toBe(90n)
		expect(replayed.escalationResolutionBalances.get(game)).toEqual([1n, 60n, 30n])
		expect(postResumeBundle.claimRepUnits).toBe(2n)
		expect((postResumeBundle.claimRepUnits * 90n) / 150n).toBe(1n)
	})

	test('local carry consumption updates peaks before a recursive fork checkpoint', () => {
		const parentGame = '0x1111111111111111111111111111111111111111'
		const childGame = '0x2222222222222222222222222222222222222222'
		const grandchildGame = '0x3333333333333333333333333333333333333333'
		const depositor = '0x4444444444444444444444444444444444444444'
		const zeroHash = `0x${'0'.repeat(64)}` as Hex
		const parentLeaf = hashCarryLeaf(depositor, 1n, 10n, 0n, 10n, 1n)
		const childLeaf = hashCarryLeaf(depositor, 1n, 5n, 7n, 15n, 1n)
		const consumedChildRoot = hashParent(parentLeaf, zeroHash)
		const logs = [
			createReplayLog({ emitter: parentGame, eventName: 'GameStarted', logIndex: 0, args: { activationTime: 1n, startBondAttoRep: 1n, nonDecisionThresholdAttoRep: 100n } }),
			createReplayLog({
				emitter: parentGame,
				eventName: 'LocalDepositAppended',
				logIndex: 1,
				args: { nodeId: 1n, outcome: 1n, depositor, repAmountAttoRep: 10n, parentDepositIndex: 0n, cumulativeRepAmountAttoRep: 10n },
			}),
			createReplayLog({ emitter: childGame, eventName: 'GameContinuedFromFork', logIndex: 2, args: { startBondAttoRep: 1n, nonDecisionThresholdAttoRep: 100n, elapsedAtFork: 0n } }),
			createReplayLog({
				emitter: childGame,
				eventName: 'ForkCarryCheckpoint',
				logIndex: 3,
				args: {
					sourceGame: parentGame,
					snapshotId: zeroHash,
					carryRoots: [zeroHash, parentLeaf, zeroHash],
					nullifierRoots: [zeroHash, zeroHash, zeroHash],
					leafCounts: [0n, 1n, 0n],
					unresolvedTotalsAttoRep: [0n, 10n, 0n],
					resolutionBalancesAttoRep: [0n, 10n, 0n],
				},
			}),
			createReplayLog({
				emitter: childGame,
				eventName: 'LocalDepositAppended',
				logIndex: 4,
				args: { nodeId: 1n, outcome: 1n, depositor, repAmountAttoRep: 5n, parentDepositIndex: 7n, cumulativeRepAmountAttoRep: 15n },
			}),
			createReplayLog({
				emitter: childGame,
				eventName: 'CarryDepositConsumed',
				logIndex: 5,
				args: {
					parentDepositIndex: 7n,
					sourceNodeId: 1n,
					depositor,
					outcome: 1n,
					repAmountAttoRep: 5n,
					reason: 0n,
					resultingUnresolvedTotalAttoRep: 10n,
					resultingNullifierRoot: zeroHash,
					resultingCarryRoot: consumedChildRoot,
				},
			}),
			createReplayLog({ emitter: grandchildGame, eventName: 'GameContinuedFromFork', logIndex: 6, args: { startBondAttoRep: 1n, nonDecisionThresholdAttoRep: 100n, elapsedAtFork: 0n } }),
			createReplayLog({
				emitter: grandchildGame,
				eventName: 'ForkCarryCheckpoint',
				logIndex: 7,
				args: {
					sourceGame: childGame,
					snapshotId: zeroHash,
					carryRoots: [zeroHash, consumedChildRoot, zeroHash],
					nullifierRoots: [zeroHash, zeroHash, zeroHash],
					leafCounts: [0n, 2n, 0n],
					unresolvedTotalsAttoRep: [0n, 10n, 0n],
					resolutionBalancesAttoRep: [0n, 15n, 0n],
				},
			}),
		]

		const replayed = replayZoltarEvents(logs)
		if (replayed.escalationCarryRoots.get(grandchildGame)?.[1] !== consumedChildRoot) throw new Error('recursive carry root mismatch')
		if (replayed.escalationCarryPeaks.get(grandchildGame)?.[1]?.[1] !== consumedChildRoot) throw new Error('recursive carry peak mismatch')
		if (hashParent(parentLeaf, childLeaf) === consumedChildRoot) throw new Error('test setup did not distinguish live and consumed child roots')
	})

	test('explicit local and inherited non-decision states replay independently from timestamps', () => {
		const localGame = '0x1111111111111111111111111111111111111111'
		const continuationGame = '0x2222222222222222222222222222222222222222'
		const zeroHash = `0x${'0'.repeat(64)}` as Hex
		const logs = [
			createReplayLog({ emitter: localGame, eventName: 'GameStarted', logIndex: 0, args: { activationTime: 1n, startBondAttoRep: 1n, nonDecisionThresholdAttoRep: 100n } }),
			createReplayLog({ emitter: localGame, eventName: 'NonDecisionReached', logIndex: 1, args: { nonDecisionTimestamp: 20n } }),
			createReplayLog({ emitter: continuationGame, eventName: 'GameContinuedFromFork', logIndex: 2, args: { startBondAttoRep: 1n, nonDecisionThresholdAttoRep: 100n, elapsedAtFork: 5n } }),
			createReplayLog({
				emitter: continuationGame,
				eventName: 'ForkCarryCheckpoint',
				logIndex: 3,
				args: {
					sourceGame: localGame,
					snapshotId: zeroHash,
					carryRoots: [zeroHash, zeroHash, zeroHash],
					nullifierRoots: [zeroHash, zeroHash, zeroHash],
					leafCounts: [0n, 0n, 0n],
					unresolvedTotalsAttoRep: [0n, 0n, 0n],
					resolutionBalancesAttoRep: [100n, 100n, 0n],
				},
			}),
			createReplayLog({ emitter: continuationGame, eventName: 'InheritedThresholdTie', logIndex: 4, args: { sourceGame: localGame } }),
		]

		const replayed = replayZoltarEvents(logs)
		const localLifecycle = replayed.escalationLifecycles.get(localGame)
		const continuationLifecycle = replayed.escalationLifecycles.get(continuationGame)
		if (localLifecycle?.nonDecisionState !== 'local' || localLifecycle.nonDecisionTimestamp !== 20n) {
			throw new Error('local non-decision lifecycle mismatch')
		}
		if (continuationLifecycle?.nonDecisionState !== 'inheritedThresholdTie' || continuationLifecycle.nonDecisionTimestamp !== undefined) {
			throw new Error('inherited threshold tie should replay without a local timestamp')
		}
		if (continuationLifecycle.inheritedThresholdTieSourceGame !== localGame) throw new Error('inherited threshold tie source game mismatch')
	})

	test('inherited threshold tie replay requires a matching preceding fork carry checkpoint', () => {
		const sourceGame = '0x1111111111111111111111111111111111111111'
		const otherGame = '0x2222222222222222222222222222222222222222'
		const continuationGame = '0x3333333333333333333333333333333333333333'
		const zeroHash = `0x${'0'.repeat(64)}` as Hex
		const continued = createReplayLog({
			emitter: continuationGame,
			eventName: 'GameContinuedFromFork',
			logIndex: 1,
			args: { startBondAttoRep: 1n, nonDecisionThresholdAttoRep: 100n, elapsedAtFork: 5n },
		})
		const inheritedTie = createReplayLog({
			emitter: continuationGame,
			eventName: 'InheritedThresholdTie',
			logIndex: 3,
			args: { sourceGame },
		})

		expect(() => replayZoltarEvents([continued, inheritedTie])).toThrow('inherited threshold tie requires a preceding fork carry checkpoint')

		const checkpointLogs = [
			createReplayLog({ emitter: otherGame, eventName: 'GameStarted', logIndex: 0, args: { activationTime: 1n, startBondAttoRep: 1n, nonDecisionThresholdAttoRep: 100n } }),
			continued,
			createReplayLog({
				emitter: continuationGame,
				eventName: 'ForkCarryCheckpoint',
				logIndex: 2,
				args: {
					sourceGame: otherGame,
					snapshotId: zeroHash,
					carryRoots: [zeroHash, zeroHash, zeroHash],
					nullifierRoots: [zeroHash, zeroHash, zeroHash],
					leafCounts: [0n, 0n, 0n],
					unresolvedTotalsAttoRep: [0n, 0n, 0n],
					resolutionBalancesAttoRep: [100n, 100n, 0n],
				},
			}),
			inheritedTie,
		]
		expect(() => replayZoltarEvents(checkpointLogs)).toThrow('inherited threshold tie source game does not match its fork carry checkpoint')
	})

	test('late children inherit the immutable fork-time carry snapshot after source consumption', () => {
		const parentPool = '0x1111111111111111111111111111111111111111'
		const parentGame = '0x2222222222222222222222222222222222222222'
		const childGame = '0x3333333333333333333333333333333333333333'
		const depositor = '0x4444444444444444444444444444444444444444'
		const forker = '0x5555555555555555555555555555555555555555'
		const migrationProxy = '0x6666666666666666666666666666666666666666'
		const zeroHash = `0x${'0'.repeat(64)}` as Hex
		const snapshotId = `0x${'1'.repeat(64)}` as Hex
		const parentLeaf = hashCarryLeaf(depositor, 1n, 10n, 0n, 10n, 1n)
		const logs = [
			createReplayLog({ emitter: parentGame, eventName: 'GameStarted', logIndex: 0, args: { activationTime: 1n, startBondAttoRep: 1n, nonDecisionThresholdAttoRep: 100n } }),
			createReplayLog({
				emitter: parentGame,
				eventName: 'LocalDepositAppended',
				logIndex: 1,
				args: { nodeId: 1n, outcome: 1n, depositor, repAmountAttoRep: 10n, parentDepositIndex: 0n, cumulativeRepAmountAttoRep: 10n },
			}),
			createReplayLog({ emitter: forker, eventName: 'DisputeStakedRepDrainedAtFork', logIndex: 2, args: { parentPool, sourceGame: parentGame, repAmountAttoRep: 10n } }),
			createReplayLog({
				emitter: forker,
				eventName: 'SecurityPoolForkSnapshot',
				logIndex: 3,
				args: {
					parentPool,
					migrationProxy,
					ownFork: true,
					unresolvedEscalation: true,
					settlementCollateralAtForkAttoEth: 0n,
					poolRepAtForkAttoRep: 0n,
					auctionableRepAtForkAttoRep: 0n,
					escalationSourceRepAtForkAttoRep: 10n,
					escalationChildRepAtForkAttoRep: 0n,
					escalationStartBondAtForkAttoRep: 1n,
					escalationNonDecisionThresholdAtForkAttoRep: 100n,
					escalationElapsedAtFork: 0n,
					escalationSnapshotId: snapshotId,
				},
			}),
			createReplayLog({
				emitter: parentGame,
				eventName: 'CarryDepositConsumed',
				logIndex: 4,
				args: {
					parentDepositIndex: 0n,
					sourceNodeId: 1n,
					depositor,
					outcome: 1n,
					repAmountAttoRep: 10n,
					reason: 0n,
					resultingUnresolvedTotalAttoRep: 0n,
					resultingNullifierRoot: zeroHash,
					resultingCarryRoot: zeroHash,
				},
			}),
			createReplayLog({ emitter: childGame, eventName: 'GameContinuedFromFork', logIndex: 5, args: { startBondAttoRep: 1n, nonDecisionThresholdAttoRep: 100n, elapsedAtFork: 0n } }),
			createReplayLog({
				emitter: childGame,
				eventName: 'ForkCarryCheckpoint',
				logIndex: 6,
				args: {
					sourceGame: parentGame,
					snapshotId,
					carryRoots: [zeroHash, parentLeaf, zeroHash],
					nullifierRoots: [zeroHash, zeroHash, zeroHash],
					leafCounts: [0n, 1n, 0n],
					unresolvedTotalsAttoRep: [0n, 10n, 0n],
					resolutionBalancesAttoRep: [0n, 10n, 0n],
				},
			}),
		]

		const replayed = replayZoltarEvents(logs)
		if (replayed.escalationCarryRoots.get(parentGame)?.[1] !== zeroHash) throw new Error('source carry root was not consumed')
		if (replayed.escalationCarrySnapshots.get(snapshotId)?.carryRoots[1] !== parentLeaf) throw new Error('fork-time carry snapshot was not preserved')
		if (replayed.escalationCarryRoots.get(childGame)?.[1] !== parentLeaf) throw new Error('late child carry root mismatch')
		if (replayed.escalationCarryPeaks.get(childGame)?.[1]?.[0] !== parentLeaf) throw new Error('late child did not inherit fork-time carry peaks')
	})

	test('universe migration and child records use canonical resulting state', () => {
		const zoltar = '0x1111111111111111111111111111111111111111'
		const parentRep = '0x2222222222222222222222222222222222222222'
		const childRep = '0x3333333333333333333333333333333333333333'
		const forker = '0x4444444444444444444444444444444444444444'
		const migrator = '0x5555555555555555555555555555555555555555'
		const logs = [
			createReplayLog({
				emitter: zoltar,
				eventName: 'UniverseInitialized',
				logIndex: 0,
				args: { universeId: 1n, forkTime: 0n, forkQuestionId: 0n, forkingOutcomeIndex: 0n, reputationToken: parentRep, parentUniverseId: 0n, universeTheoreticalSupplyAttoRep: 100n },
			}),
			createReplayLog({
				emitter: zoltar,
				eventName: 'UniverseForked',
				logIndex: 1,
				args: { forker, universeId: 1n, questionId: 8n, forkTime: 10n, forkThresholdAttoRep: 20n, migrationRepBalanceAttoRep: 18n, universeTheoreticalSupplyAttoRep: 80n },
			}),
			createReplayLog({
				emitter: zoltar,
				eventName: 'MigrationRepAdded',
				logIndex: 2,
				args: { migrator, universeId: 1n, amountAttoRep: 5n, migrationRepBalanceAttoRep: 5n, universeTheoreticalSupplyAttoRep: 75n },
			}),
			createReplayLog({
				emitter: zoltar,
				eventName: 'DeployChild',
				logIndex: 3,
				args: { deployer: forker, universeId: 1n, outcomeIndex: 2n, childUniverseId: 9n, childReputationToken: childRep, childUniverseTheoreticalSupplyAttoRep: 98n },
			}),
		]

		const replayed = replayZoltarEvents(logs)
		if (replayed.migrationRepBalancesAttoRep.get('1')?.get(forker) !== 18n) throw new Error('fork initiator migration balance mismatch')
		if (replayed.migrationRepBalancesAttoRep.get('1')?.get(migrator) !== 5n) throw new Error('later migration balance mismatch')
		if (replayed.universes.get('1')?.universeTheoreticalSupplyAttoRep !== 75n) throw new Error('parent universe supply mismatch')
		if (replayed.universes.get('9')?.forkQuestionId !== 8n) throw new Error('child fork question mismatch')
	})

	test('canonical security-pool deployment and resulting-state events reconstruct child initialization', () => {
		const factory = '0x3333333333333333333333333333333333333333'
		const pool = '0x1111111111111111111111111111111111111111'
		const game = '0x2222222222222222222222222222222222222222'
		const parent = '0x4444444444444444444444444444444444444444'
		const logs = [
			createReplayLog({
				emitter: factory,
				eventName: 'DeploySecurityPool',
				logIndex: 0,
				args: {
					securityPool: pool,
					truthAuction: zeroAddress,
					priceOracleManagerAndOperatorQueuer: zeroAddress,
					shareToken: zeroAddress,
					parent,
					universeId: 1n,
					questionId: 2n,
					statoblastSecurityMultiplierBps: 30_000n,
					initialReportPriorityFeeAttoEthPerGas: 10n,
					currentRetentionRate: 4n,
					settlementCollateralAttoEth: 5n,
				},
			}),
			createReplayLog({ emitter: pool, eventName: 'ShareTokenSupplySet', logIndex: 1, args: { shareTokenSupplyAttoShares: 40n } }),
			createReplayLog({ emitter: pool, eventName: 'TotalRepBackingUnitsSet', logIndex: 2, args: { totalRepBackingUnits: 50n } }),
			createReplayLog({ emitter: pool, eventName: 'AwaitingForkContinuationSet', logIndex: 3, args: { awaitingForkContinuation: true } }),
			createReplayLog({ emitter: pool, eventName: 'EscalationGameSet', logIndex: 4, args: { escalationGame: game } }),
			createReplayLog({ emitter: pool, eventName: 'PoolForkModeActivated', logIndex: 5, args: { repTransferredAttoRep: 60n, currentRetentionRate: 70n, systemState: 1n } }),
		]

		const replayed = replayZoltarEvents(logs)
		if (replayed.poolDeployments.get(pool)?.statoblastSecurityMultiplierBps !== 30_000n) throw new Error('child security multiplier mismatch')
		if (replayed.completeSetSupplies.get(pool) !== 40n) throw new Error('child share-token supply mismatch')
		const poolState = replayed.poolStates.get(pool)
		if (poolState?.shareTokenSupplyAttoShares !== 40n) throw new Error('child pool share-token state mismatch')
		if (poolState.totalRepBackingUnits !== 50n) throw new Error('child backingUnits denominator mismatch')
		if (poolState.systemState !== 1n || !poolState.forkModeActive) throw new Error('child system state mismatch')
		if (poolState.awaitingForkContinuation !== true) throw new Error('child continuation state mismatch')
		if (poolState.escalationGame !== game) throw new Error('child escalation-game relationship mismatch')
		if (poolState.repTransferredAtFork !== 60n || poolState.currentRetentionRate !== 70n) throw new Error('child fork activation state mismatch')
	})

	test('escalation reducers track stable leaves, escrow, claims, exports, and residual settlement', () => {
		const game = '0x1111111111111111111111111111111111111111'
		const vault = '0x2222222222222222222222222222222222222222'
		const secondVault = '0x3333333333333333333333333333333333333333'
		const receiver = '0x4444444444444444444444444444444444444444'
		const rootA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
		const rootB = `0x${'0'.repeat(64)}` as Hex
		const logs = [
			createReplayLog({ emitter: game, eventName: 'GameStarted', logIndex: 0, args: { activationTime: 10n, startBondAttoRep: 1n, nonDecisionThresholdAttoRep: 100n } }),
			createReplayLog({
				emitter: game,
				eventName: 'LocalDepositAppended',
				logIndex: 1,
				args: { nodeId: 1n, outcome: 1n, depositor: vault, repAmountAttoRep: 10n, parentDepositIndex: 5n, cumulativeRepAmountAttoRep: 10n },
			}),
			createReplayLog({
				emitter: game,
				eventName: 'DepositOnOutcome',
				logIndex: 2,
				args: {
					depositor: vault,
					outcome: 1n,
					repAmountAttoRep: 10n,
					depositIndex: 0n,
					cumulativeRepAmountAttoRep: 10n,
					resultingVaultDisputeStakedRepAttoRep: 10n,
					resultingTotalDisputeStakedRepAttoRep: 10n,
				},
			}),
			createReplayLog({
				emitter: game,
				eventName: 'CarryDepositConsumed',
				logIndex: 3,
				args: {
					parentDepositIndex: 5n,
					sourceNodeId: 1n,
					depositor: vault,
					outcome: 1n,
					repAmountAttoRep: 10n,
					reason: 0n,
					resultingUnresolvedTotalAttoRep: 0n,
					resultingNullifierRoot: rootA,
					resultingCarryRoot: rootB,
				},
			}),
			createReplayLog({
				emitter: game,
				eventName: 'ClaimDeposit',
				logIndex: 4,
				args: {
					depositor: vault,
					outcome: 1n,
					parentDepositIndex: 5n,
					originalDepositAmountAttoRep: 10n,
					amountToWithdrawAttoRep: 9n,
					burnAmountAttoRep: 1n,
					transferredRep: true,
				},
			}),
			createReplayLog({ emitter: game, eventName: 'VaultEscrowUpdated', logIndex: 5, args: { vault, disputeStakedRepByVaultAttoRep: 0n, totalDisputeStakedRepAttoRep: 0n } }),
			createReplayLog({
				emitter: game,
				eventName: 'ForkedEscrowRecorded',
				logIndex: 6,
				args: {
					depositor: vault,
					outcome: 2n,
					sourcePrincipalTotalAttoRep: 20n,
					childRepTotalAttoRep: 15n,
					disputeStakedRepByVaultAttoRep: 15n,
					totalDisputeStakedRepAttoRep: 15n,
					outcomeBalanceAttoRep: 20n,
				},
			}),
			createReplayLog({
				emitter: game,
				eventName: 'ForkedEscrowClaimed',
				logIndex: 7,
				args: { depositor: vault, outcome: 2n, sourcePrincipalClaimedAttoRep: 10n, childRepClaimedAttoRep: 8n },
			}),
			createReplayLog({ emitter: game, eventName: 'VaultEscrowUpdated', logIndex: 8, args: { vault, disputeStakedRepByVaultAttoRep: 7n, totalDisputeStakedRepAttoRep: 7n } }),
			createReplayLog({
				emitter: game,
				eventName: 'ForkedEscrowExported',
				logIndex: 9,
				args: {
					vault,
					repReceiver: receiver,
					sourcePrincipalByOutcomeAttoRep: [0n, 0n, 10n],
					childRepByOutcomeAttoRep: [0n, 0n, 7n],
					totalChildRepToTransferAttoRep: 7n,
					transferredRep: true,
				},
			}),
			createReplayLog({ emitter: game, eventName: 'VaultEscrowUpdated', logIndex: 10, args: { vault, disputeStakedRepByVaultAttoRep: 0n, totalDisputeStakedRepAttoRep: 0n } }),
			createReplayLog({
				emitter: game,
				eventName: 'LocalDepositAppended',
				logIndex: 11,
				args: { nodeId: 2n, outcome: 2n, depositor: secondVault, repAmountAttoRep: 4n, parentDepositIndex: 7n, cumulativeRepAmountAttoRep: 4n },
			}),
			createReplayLog({
				emitter: game,
				eventName: 'DepositOnOutcome',
				logIndex: 12,
				args: {
					depositor: secondVault,
					outcome: 2n,
					repAmountAttoRep: 4n,
					depositIndex: 0n,
					cumulativeRepAmountAttoRep: 4n,
					resultingVaultDisputeStakedRepAttoRep: 4n,
					resultingTotalDisputeStakedRepAttoRep: 4n,
				},
			}),
			createReplayLog({
				emitter: game,
				eventName: 'VaultUnresolvedTotalsExported',
				logIndex: 13,
				args: {
					vault: secondVault,
					repReceiver: receiver,
					principalByOutcomeAttoRep: [0n, 0n, 4n],
					principalToTransferAttoRep: 4n,
					transferredRep: true,
				},
			}),
			createReplayLog({ emitter: game, eventName: 'VaultEscrowUpdated', logIndex: 14, args: { vault: secondVault, disputeStakedRepByVaultAttoRep: 0n, totalDisputeStakedRepAttoRep: 0n } }),
			createReplayLog({ emitter: game, eventName: 'ResidualRepSweptToSecurityPool', logIndex: 15, args: { amountAttoRep: 2n } }),
		]

		const replayed = replayZoltarEvents(logs.toReversed())
		const deposit = replayed.escalationDeposits.get(game)?.get('1:5')
		if (deposit?.nodeId !== 1n || !deposit.consumed) throw new Error('stable local deposit identity mismatch')
		if (replayed.escalationConsumptions.get(game)?.get('5:1')?.reason !== 0n) throw new Error('carry consumption mismatch')
		if (replayed.escalationClaims.get(game)?.get('1:5')?.amountToWithdrawAttoRep !== 9n) throw new Error('claim accounting mismatch')
		if (replayed.escalationVaultEscrowedRep.get(game)?.get(vault) !== 0n) throw new Error('vault escrow mismatch')
		if (replayed.escalationTotalEscrowedRep.get(game) !== 0n) throw new Error('total escrow mismatch')
		if (replayed.escalationLocalUnresolvedByVault.get(game)?.get(secondVault)?.[2] !== 0n) throw new Error('vault unresolved export mismatch')
		const forkedEscrow = replayed.escalationForkedEscrow.get(game)?.get(`${vault}:2`)
		if (forkedEscrow?.sourcePrincipalClaimedAttoRep !== 20n || forkedEscrow.childRepClaimedAttoRep !== 15n) throw new Error('forked escrow settlement mismatch')
		if (replayed.escalationForkedExports.get(game)?.get(vault)?.totalChildRepToTransferAttoRep !== 7n) throw new Error('forked escrow export mismatch')
		if (replayed.escalationResidualRepSwept.get(game) !== 2n) throw new Error('residual REP sweep mismatch')
	})

	test('vault migration replay keeps the same vault isolated across parallel child pools', () => {
		const parentPool: Address = '0x1111111111111111111111111111111111111111'
		const yesChildPool: Address = '0x2222222222222222222222222222222222222222'
		const noChildPool: Address = '0x3333333333333333333333333333333333333333'
		const vault: Address = '0x4444444444444444444444444444444444444444'
		const migrationLog = (childPool: Address, outcomeIndex: bigint, logIndex: number) =>
			createReplayLog({
				emitter: '0x5555555555555555555555555555555555555555',
				eventName: 'VaultMigrationCheckpoint',
				logIndex,
				args: {
					parentPool,
					childPool,
					vault,
					outcomeIndex,
					migratedRepDeltaAttoRep: 1n,
					resultingChildMigratedRepTotalAttoRep: 1n,
					resultingParentRepBackingUnits: 0n,
					resultingParentCoverageCommitmentAttoEth: 0n,
					resultingChildRepBackingUnits: 1n,
					resultingChildCoverageCommitmentAttoEth: 1n,
					resultingParentTotalRepBackingUnits: 0n,
					resultingChildTotalRepBackingUnits: 1n,
					resultingParentTotalCoverageCommitmentAttoEth: 0n,
					resultingChildTotalCoverageCommitmentAttoEth: 1n,
					settlementCollateralTransferredAttoEth: 0n,
					cumulativeSettlementCollateralTransferredAttoEth: 0n,
				},
			})

		const replayed = replayZoltarEvents([migrationLog(noChildPool, 2n, 1), migrationLog(yesChildPool, 1n, 0)])
		const migrationsByChild = replayed.vaultMigrations.get(parentPool)
		const yesMigrations = migrationsByChild?.get(yesChildPool)
		const noMigrations = migrationsByChild?.get(noChildPool)
		if (!(yesMigrations instanceof Map) || !yesMigrations.has(vault)) {
			throw new Error('Yes-child vault migration was overwritten')
		}
		if (!(noMigrations instanceof Map) || !noMigrations.has(vault)) {
			throw new Error('No-child vault migration was overwritten')
		}
	})

	test('protocol reducers reconstruct relationships, REP, lifecycle, and commitment state', () => {
		const zoltar = '0x1111111111111111111111111111111111111111'
		const repToken = '0x2222222222222222222222222222222222222222'
		const migrator = '0x3333333333333333333333333333333333333333'
		const poolFactory = '0x4444444444444444444444444444444444444444'
		const pool = '0x5555555555555555555555555555555555555555'
		const auction = '0x6666666666666666666666666666666666666666'
		const coordinator = '0x7777777777777777777777777777777777777777'
		const game = '0x8888888888888888888888888888888888888888'
		const rootA = `0x${'0'.repeat(64)}` as Hex
		const rootC = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
		const logs = [
			createReplayLog({
				emitter: zoltar,
				eventName: 'DeployChild',
				logIndex: 0,
				args: {
					deployer: migrator,
					universeId: 1n,
					outcomeIndex: 2n,
					childUniverseId: 9n,
					childReputationToken: repToken,
					childUniverseTheoreticalSupplyAttoRep: 100n,
				},
			}),
			createReplayLog({
				emitter: zoltar,
				eventName: 'MigrationRepAdded',
				logIndex: 1,
				args: { migrator, universeId: 1n, amountAttoRep: 10n, migrationRepBalanceAttoRep: 10n, universeTheoreticalSupplyAttoRep: 90n },
			}),
			createReplayLog({
				emitter: zoltar,
				eventName: 'MigrationRepSplit',
				logIndex: 2,
				args: {
					migrator,
					recipient: migrator,
					universeId: 1n,
					outcomeIndex: 2n,
					childUniverseId: 9n,
					amountAttoRep: 10n,
					childMigrationRepAmountAttoRep: 10n,
				},
			}),
			createReplayLog({
				emitter: repToken,
				eventName: 'Transfer',
				logIndex: 3,
				args: { from: zeroAddress, to: migrator, value: 10n },
			}),
			createReplayLog({
				emitter: poolFactory,
				eventName: 'DeploySecurityPool',
				logIndex: 4,
				args: {
					securityPool: pool,
					truthAuction: auction,
					priceOracleManagerAndOperatorQueuer: coordinator,
					shareToken: repToken,
					parent: zeroAddress,
					universeId: 9n,
					questionId: 12n,
					statoblastSecurityMultiplierBps: 30_000n,
					initialReportPriorityFeeAttoEthPerGas: 10n,
					currentRetentionRate: 4n,
					settlementCollateralAttoEth: 0n,
				},
			}),
			createReplayLog({
				emitter: pool,
				eventName: 'CompleteSetCreated',
				logIndex: 5,
				args: { creator: migrator, settlementCollateralProvidedAttoEth: 5n, completeSetsMintedAttoShares: 5n, resultingShareTokenSupplyAttoShares: 5n, resultingSettlementCollateralAttoEth: 5n },
			}),
			createReplayLog({
				emitter: game,
				eventName: 'GameStarted',
				logIndex: 6,
				args: { activationTime: 10n, startBondAttoRep: 10n, nonDecisionThresholdAttoRep: 100n },
			}),
			createReplayLog({
				emitter: game,
				eventName: 'LocalDepositAppended',
				logIndex: 7,
				args: {
					nodeId: 1n,
					outcome: 1n,
					depositor: migrator,
					repAmountAttoRep: 10n,
					parentDepositIndex: 0n,
					cumulativeRepAmountAttoRep: 10n,
				},
			}),
			createReplayLog({
				emitter: game,
				eventName: 'DepositOnOutcome',
				logIndex: 8,
				args: {
					depositor: migrator,
					outcome: 1n,
					repAmountAttoRep: 10n,
					depositIndex: 0n,
					cumulativeRepAmountAttoRep: 10n,
					resultingVaultDisputeStakedRepAttoRep: 10n,
					resultingTotalDisputeStakedRepAttoRep: 10n,
				},
			}),
			createReplayLog({
				emitter: game,
				eventName: 'CarryDepositConsumed',
				logIndex: 9,
				args: {
					parentDepositIndex: 0n,
					sourceNodeId: 1n,
					depositor: migrator,
					outcome: 1n,
					repAmountAttoRep: 10n,
					reason: 0n,
					resultingUnresolvedTotalAttoRep: 0n,
					resultingNullifierRoot: rootC,
					resultingCarryRoot: rootA,
				},
			}),
			createReplayLog({
				emitter: auction,
				eventName: 'AuctionStarted',
				logIndex: 10,
				args: { startTimestamp: 20n, endTimestamp: 30n },
			}),
			createReplayLog({
				emitter: auction,
				eventName: 'AuctionFinalized',
				logIndex: 11,
				args: { clearingTick: -1n, grossAcceptedAttoEth: 5n, repSoldAttoRep: 8n, bidAtClearingTickAttoEth: 5n, funded: true },
			}),
			createReplayLog({
				emitter: coordinator,
				eventName: 'StagedOperationQueued',
				logIndex: 12,
				args: {
					operationId: 3n,
					operation: 1n,
					initiatorVault: migrator,
					targetVault: pool,
					amount: 2n,
					queuedAt: 21n,
					validForSeconds: 300n,
					snapshotTargetBackingUnits: 5n,
					snapshotTargetCoverageCommitmentAttoEth: 6n,
					snapshotTotalPoolHeldRepAttoRep: 7n,
					snapshotDenominator: 8n,
					isPendingSlot: true,
				},
			}),
			createReplayLog({
				emitter: coordinator,
				eventName: 'ExecutedStagedOperation',
				logIndex: 13,
				args: { operationId: 3n, operation: 1n, success: true, errorMessage: '' },
			}),
		]

		const replayed = replayZoltarEvents(logs.toReversed())
		if (replayed.universeChildren.get('1')?.get(2n) !== '9') throw new Error('child universe relationship mismatch')
		if (replayed.universeRepTokens.get('9') !== repToken) throw new Error('child REP token mismatch')
		if (replayed.migrationRepBalancesAttoRep.get('1')?.get(migrator) !== 10n) throw new Error('migration REP balance mismatch')
		if (replayed.childMigrationRepAmounts.get('1')?.get(migrator)?.get('9') !== 10n) throw new Error('child migration REP mismatch')
		if (replayed.repBalances.get(repToken.toLowerCase())?.get(migrator) !== 10n) throw new Error('REP balance mismatch')
		if (replayed.repSupply.get(repToken.toLowerCase()) !== 10n) throw new Error('REP supply mismatch')
		if (replayed.poolDeployments.get(pool)?.parent !== zeroAddress) throw new Error('pool relationship mismatch')
		if (replayed.completeSetSupplies.get(pool) !== 5n) throw new Error('complete-set supply mismatch')
		if (replayed.escalationUnresolvedTotals.get(game)?.[1] !== 0n) throw new Error('carry total mismatch')
		if (replayed.escalationNullifierRoots.get(game)?.[1] !== rootC) throw new Error('nullifier root mismatch')
		if (replayed.escalationDeposits.get(game)?.get('1:0')?.consumed !== true) throw new Error('deposit consumption mismatch')
		if (replayed.auctions.get(auction)?.funded !== true) throw new Error('auction lifecycle mismatch')
		if (replayed.coordinatorOperations.get(coordinator)?.get(3n)?.status !== 'Succeeded') throw new Error('coordinator terminal state mismatch')
	})

	const fixture = usePeripheralsForkMigrationFixture()
	const strictEqualTypeSafe: PeripheralsForkMigrationFixture['strictEqualTypeSafe'] = fixture.strictEqualTypeSafe
	let client: PeripheralsForkMigrationFixture['client']
	let mockWindow: PeripheralsForkMigrationFixture['mockWindow']
	let securityPoolAddresses: PeripheralsForkMigrationFixture['securityPoolAddresses']

	beforeEach(() => {
		client = fixture.client
		mockWindow = fixture.mockWindow
		securityPoolAddresses = fixture.securityPoolAddresses
	})

	const getContractReplayLogs = async (address: Address, abi: Abi, fromBlock: bigint, toBlock: bigint) => {
		const chainId = BigInt(await client.getChainId())
		const logs = await client.getLogs({ address, fromBlock, toBlock })
		const replayLogs: ReplayLog[] = []
		for (const log of logs) {
			let decoded: ReturnType<typeof decodeEventLog>
			try {
				decoded = decodeEventLog({ abi, data: log.data, topics: log.topics })
			} catch (error) {
				if (!isIgnorableLogDecodeError(error)) throw error
				continue
			}
			if (
				log.blockHash === null ||
				log.blockHash === undefined ||
				log.blockNumber === null ||
				log.blockNumber === undefined ||
				log.transactionHash === null ||
				log.transactionHash === undefined ||
				log.transactionIndex === null ||
				log.logIndex === null ||
				typeof decoded.args !== 'object' ||
				decoded.args === null ||
				Array.isArray(decoded.args)
			) {
				throw new Error('contract event log is missing replay identity or named arguments')
			}
			replayLogs.push({
				chainId,
				blockHash: log.blockHash,
				blockNumber: log.blockNumber,
				transactionHash: log.transactionHash,
				transactionIndex: Number(log.transactionIndex),
				logIndex: Number(log.logIndex),
				emitter: log.address,
				eventName: decoded.eventName,
				args: Object.fromEntries(Object.entries(decoded.args)),
			})
		}
		return replayLogs
	}

	test('actual origin deployment pre-discovers relationships before constructor checkpoints', async () => {
		const questionData = { ...fixture.questionData, title: 'Event replay deployment discovery' }
		const questionId = fixture.getQuestionId(questionData, fixture.outcomes)
		await fixture.createQuestion(client, questionData, fixture.outcomes)
		const factory = fixture.getInfraContractAddresses().securityPoolFactory
		const deploymentHash = await client.writeContract({
			address: factory,
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'deployOriginSecurityPool',
			args: [fixture.genesisUniverse, questionId, fixture.statoblastSecurityMultiplierBps, 10n * 10n ** 9n],
		})
		const receipt = await client.waitForTransactionReceipt({ hash: deploymentHash })
		if (receipt.status === 'reverted') throw new Error('origin pool deployment reverted')
		const addresses = fixture.getSecurityPoolAddresses(zeroAddress, fixture.genesisUniverse, questionId, fixture.statoblastSecurityMultiplierBps)
		const blockNumber = receipt.blockNumber
		const replayLogs = (
			await Promise.all([
				getContractReplayLogs(factory, peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi, blockNumber, blockNumber),
				getContractReplayLogs(addresses.securityPool, peripherals_SecurityPool_SecurityPool.abi, blockNumber, blockNumber),
				getContractReplayLogs(addresses.shareToken, peripherals_tokens_ShareToken_ShareToken.abi, blockNumber, blockNumber),
				getContractReplayLogs(addresses.priceOracleManagerAndOperatorQueuer, peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, blockNumber, blockNumber),
			])
		)
			.flat()
			.filter(log => log.transactionHash === deploymentHash)
		const deploymentLog = replayLogs.find(log => log.eventName === 'DeploySecurityPool')
		const authorizationLog = replayLogs.find(log => log.eventName === 'AuthorizationUpdated')
		const poolCheckpointLog = replayLogs.find(log => log.eventName === 'PoolAccountingCheckpoint')
		const coordinatorCheckpointLog = replayLogs.find(log => log.eventName === 'CoordinatorStateCheckpoint')
		if (deploymentLog === undefined || authorizationLog === undefined || poolCheckpointLog === undefined || coordinatorCheckpointLog === undefined) {
			throw new Error('origin deployment receipt is missing replay relationships or setup checkpoints')
		}
		for (const setupLog of [authorizationLog, poolCheckpointLog, coordinatorCheckpointLog]) {
			if (setupLog.logIndex >= deploymentLog.logIndex) throw new Error('setup checkpoint did not precede relationship discovery')
		}

		const replayed = replayZoltarEvents(replayLogs, new Set(), new Set([factory]))
		if (replayed.poolDeployments.get(addresses.securityPool)?.shareToken !== addresses.shareToken) throw new Error('origin deployment relationship mismatch')
		const storedOriginPriorityFee = await client.readContract({
			address: addresses.priceOracleManagerAndOperatorQueuer,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'initialReportPriorityFeeAttoEthPerGas',
			args: [],
		})
		strictEqualTypeSafe(replayed.poolDeployments.get(addresses.securityPool)?.initialReportPriorityFeeAttoEthPerGas, storedOriginPriorityFee, 'origin priority fee replay mismatch')
		if (replayed.authorizations.get(addresses.shareToken)?.get(addresses.securityPool) !== true) throw new Error('origin pool authorization was not replayed')
		if (replayed.pools.get(addresses.securityPool)?.reason !== 5n) throw new Error('origin pool initialization checkpoint was not replayed')
		if (replayed.coordinators.get(addresses.priceOracleManagerAndOperatorQueuer)?.securityPool !== addresses.securityPool) {
			throw new Error('origin coordinator setup checkpoint was not replayed')
		}
	})

	test('actual queued coordinator operation replays every governing field and pending membership', async () => {
		const coordinator = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
		const validForSeconds = 300n
		const transactionHash = await fixture.requestPriceIfNeededAndStageOperation(client, coordinator, fixture.OperationType.SetCoverageCommitment, client.account.address, fixture.reportBond, validForSeconds)
		const receipt = await client.getTransactionReceipt({ hash: transactionHash })
		const replayLogs = (await getContractReplayLogs(coordinator, peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, receipt.blockNumber, receipt.blockNumber)).filter(log => log.transactionHash === transactionHash)
		const queuedLog = replayLogs.find(log => log.eventName === 'StagedOperationQueued')
		if (queuedLog === undefined) throw new Error('queued operation event missing')
		const operationId = queuedLog.args['operationId']
		if (typeof operationId !== 'bigint') throw new Error('queued operation ID missing')
		const replayed = replayZoltarEvents(replayLogs)
		const operation = replayed.coordinatorOperations.get(coordinator)?.get(operationId)
		if (operation === undefined) throw new Error('queued operation replay missing')
		const storedOperation = await client.readContract({
			address: coordinator,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'stagedOperations',
			args: [operationId],
		})
		strictEqualTypeSafe(operation.operation, storedOperation[0], 'queued operation type replay mismatch')
		strictEqualTypeSafe(operation.initiatorVault, storedOperation[1], 'queued initiator replay mismatch')
		strictEqualTypeSafe(operation.targetVault, storedOperation[2], 'queued target replay mismatch')
		strictEqualTypeSafe(operation.amount, storedOperation[3], 'queued amount replay mismatch')
		strictEqualTypeSafe(operation.queuedAt, storedOperation[4], 'queued timestamp replay mismatch')
		strictEqualTypeSafe(operation.validForSeconds, storedOperation[5], 'queued validity replay mismatch')
		strictEqualTypeSafe(operation.snapshotTargetBackingUnits, storedOperation[6], 'queued backingUnits snapshot replay mismatch')
		strictEqualTypeSafe(operation.snapshotTargetCoverageCommitmentAttoEth, storedOperation[7], 'coverage commitment')
		strictEqualTypeSafe(operation.snapshotTargetDisputeStakedRepAttoRep, storedOperation[8], 'queued dispute-staked REP snapshot replay mismatch')
		strictEqualTypeSafe(operation.snapshotTotalPoolHeldRepAttoRep, storedOperation[9], 'queued REP snapshot replay mismatch')
		strictEqualTypeSafe(operation.snapshotDenominator, storedOperation[10], 'queued denominator snapshot replay mismatch')
		const pendingOperationIds = await client.readContract({
			address: coordinator,
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'getPendingSettlementOperationIds',
			args: [],
		})
		strictEqualTypeSafe(operation.isPendingSlot, pendingOperationIds.includes(operationId), 'queued pending-set membership replay mismatch')
		strictEqualTypeSafe(replayed.coordinators.get(coordinator)?.pendingOperationSlotId, operationId, 'queued compatibility slot replay mismatch')
	})

	test('actual first escalation deposit pre-discovers the game before its lifecycle event', async () => {
		await mockWindow.setTime(fixture.questionData.endTime + 1n)
		const depositHash = await fixture.depositToEscalationGame(client, securityPoolAddresses.securityPool, fixture.QuestionOutcome.Yes, fixture.reportBond)
		const receipt = await client.getTransactionReceipt({ hash: depositHash })
		const factory = fixture.getInfraContractAddresses().securityPoolFactory
		const factoryLogs = await getContractReplayLogs(factory, peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi, 0n, receipt.blockNumber)
		const deploymentLogs = factoryLogs.filter(log => {
			const deployedPool = log.args['securityPool']
			return log.eventName === 'DeploySecurityPool' && typeof deployedPool === 'string' && deployedPool.toLowerCase() === securityPoolAddresses.securityPool.toLowerCase()
		})
		const receiptLogs = (
			await Promise.all([getContractReplayLogs(securityPoolAddresses.securityPool, peripherals_SecurityPool_SecurityPool.abi, receipt.blockNumber, receipt.blockNumber), getContractReplayLogs(securityPoolAddresses.escalationGame, peripherals_EscalationGame_EscalationGame.abi, receipt.blockNumber, receipt.blockNumber)])
		)
			.flat()
			.filter(log => log.transactionHash === depositHash)
		const gameStarted = receiptLogs.find(log => log.eventName === 'GameStarted')
		const gameSet = receiptLogs.find(log => log.eventName === 'EscalationGameSet')
		if (deploymentLogs.length !== 1 || gameStarted === undefined || gameSet === undefined) throw new Error('first escalation deposit is missing discovery events')
		if (gameStarted.logIndex >= gameSet.logIndex) throw new Error('game lifecycle event did not precede pool relationship event')

		const replayed = replayZoltarEvents([...deploymentLogs, ...receiptLogs], new Set(), new Set([factory]))
		if (replayed.poolStates.get(securityPoolAddresses.securityPool)?.escalationGame !== securityPoolAddresses.escalationGame) {
			throw new Error('pool escalation-game relationship was not replayed')
		}
		if (replayed.escalationLifecycles.get(securityPoolAddresses.escalationGame)?.activationTime === undefined) {
			throw new Error('initial escalation-game lifecycle was not replayed')
		}
	})

	test('actual child continuation replays its inherited carry checkpoint and storage', async () => {
		const fromBlock = (await client.getBlockNumber()) + 1n
		await mockWindow.setTime(fixture.questionData.endTime + 1n)
		await fixture.depositToEscalationGame(client, securityPoolAddresses.securityPool, fixture.QuestionOutcome.Yes, fixture.reportBond)
		await fixture.triggerExternalForkForSecurityPool(undefined, 'event replay child continuation')
		await fixture.migrateRepToZoltar(client, securityPoolAddresses.securityPool, [fixture.QuestionOutcome.Yes])
		const childDeploymentHash = await fixture.createChildUniverse(client, securityPoolAddresses.securityPool, fixture.QuestionOutcome.Yes)
		const receipt = await client.getTransactionReceipt({ hash: childDeploymentHash })
		const childUniverseId = fixture.getChildUniverseId(fixture.genesisUniverse, fixture.QuestionOutcome.Yes)
		const child = fixture.getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverseId, fixture.questionId, fixture.statoblastSecurityMultiplierBps)
		const factory = fixture.getInfraContractAddresses().securityPoolFactory
		const forker = fixture.getInfraContractAddresses().securityPoolForker
		const factoryLogs = await getContractReplayLogs(factory, peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi, 0n, receipt.blockNumber)
		const canonicalPools = new Set([securityPoolAddresses.securityPool.toLowerCase(), child.securityPool.toLowerCase()])
		const deploymentLogs = factoryLogs.filter(log => {
			const deployedPool = log.args['securityPool']
			return log.eventName === 'DeploySecurityPool' && typeof deployedPool === 'string' && canonicalPools.has(deployedPool.toLowerCase())
		})
		const [sourcePoolLogs, sourceGameLogs, forkerLogs] = await Promise.all([
			getContractReplayLogs(securityPoolAddresses.securityPool, peripherals_SecurityPool_SecurityPool.abi, fromBlock, receipt.blockNumber),
			getContractReplayLogs(securityPoolAddresses.escalationGame, peripherals_EscalationGame_EscalationGame.abi, fromBlock, receipt.blockNumber),
			getContractReplayLogs(forker, peripherals_SecurityPoolForker_SecurityPoolForker.abi, fromBlock, receipt.blockNumber),
		])
		const receiptLogs = (await Promise.all([getContractReplayLogs(child.securityPool, peripherals_SecurityPool_SecurityPool.abi, receipt.blockNumber, receipt.blockNumber), getContractReplayLogs(child.escalationGame, peripherals_EscalationGame_EscalationGame.abi, receipt.blockNumber, receipt.blockNumber)]))
			.flat()
			.filter(log => log.transactionHash === childDeploymentHash)
		const continued = receiptLogs.find(log => log.eventName === 'GameContinuedFromFork')
		const carryCheckpoint = receiptLogs.find(log => log.eventName === 'ForkCarryCheckpoint')
		const gameSet = receiptLogs.find(log => log.eventName === 'EscalationGameSet')
		if (deploymentLogs.length !== 2 || continued === undefined || carryCheckpoint === undefined || gameSet === undefined) {
			throw new Error('child continuation is missing deployment, carry, or discovery events')
		}
		if (continued.logIndex >= gameSet.logIndex) throw new Error('child continuation event did not precede pool relationship event')
		if (receiptLogs.some(log => log.eventName === 'SystemStateSet')) throw new Error('child constructor state should not depend on a synthetic system-state event')

		const replayed = replayZoltarEvents([...deploymentLogs, ...sourcePoolLogs, ...sourceGameLogs, ...forkerLogs, ...receiptLogs], new Set(), new Set([factory]))
		const deployment = replayed.poolDeployments.get(child.securityPool)
		if (deployment === undefined) throw new Error('child pool deployment replay missing')
		const [storedStatoblastSecurityMultiplierBps, storedPriorityFee, storedCurrentRetentionRate, storedCollateral, storedSystemState, storedCarryRoots, storedCarrySnapshot] = await Promise.all([
			client.readContract({ address: child.securityPool, abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'statoblastSecurityMultiplierBps', args: [] }),
			client.readContract({
				address: child.priceOracleManagerAndOperatorQueuer,
				abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'initialReportPriorityFeeAttoEthPerGas',
				args: [],
			}),
			client.readContract({ address: child.securityPool, abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'currentRetentionRate', args: [] }),
			client.readContract({ address: child.securityPool, abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'settlementCollateralAttoEth', args: [] }),
			client.readContract({ address: child.securityPool, abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'systemState', args: [] }),
			client.readContract({ address: child.escalationGame, abi: peripherals_EscalationGame_EscalationGame.abi, functionName: 'getForkCarryRoots', args: [] }),
			client.readContract({ address: child.escalationGame, abi: peripherals_EscalationGame_EscalationGame.abi, functionName: 'getForkCarrySnapshot', args: [] }),
		])
		const storedOutcomeStates = await Promise.all(
			([0, 1, 2] as const).map(
				async outcome =>
					await client.readContract({
						address: child.escalationGame,
						abi: peripherals_EscalationGame_EscalationGame.abi,
						functionName: 'getOutcomeState',
						args: [outcome],
					}),
			),
		)
		strictEqualTypeSafe(deployment.factory, factory, 'child factory replay mismatch')
		strictEqualTypeSafe(deployment.parent, securityPoolAddresses.securityPool, 'child parent replay mismatch')
		strictEqualTypeSafe(deployment.universeId, childUniverseId, 'child universe replay mismatch')
		strictEqualTypeSafe(deployment.questionId, fixture.questionId, 'child question replay mismatch')
		strictEqualTypeSafe(deployment.truthAuction, child.truthAuction, 'child auction replay mismatch')
		strictEqualTypeSafe(deployment.coordinator, child.priceOracleManagerAndOperatorQueuer, 'child coordinator replay mismatch')
		strictEqualTypeSafe(deployment.shareToken, child.shareToken, 'child share token replay mismatch')
		strictEqualTypeSafe(deployment.statoblastSecurityMultiplierBps, storedStatoblastSecurityMultiplierBps, 'child security multiplier replay mismatch')
		strictEqualTypeSafe(deployment.initialReportPriorityFeeAttoEthPerGas, storedPriorityFee, 'child priority fee replay mismatch')
		strictEqualTypeSafe(deployment.currentRetentionRate, storedCurrentRetentionRate, 'child retention rate replay mismatch')
		strictEqualTypeSafe(deployment.settlementCollateralAttoEth, storedCollateral, 'child collateral replay mismatch')
		strictEqualTypeSafe(replayed.poolStates.get(child.securityPool)?.systemState, storedSystemState, 'child constructor system state replay mismatch')
		if (replayed.escalationLifecycles.get(child.escalationGame)?.forkContinuation !== true) {
			throw new Error('child continuation lifecycle was not replayed')
		}

		const replayedCarryRoots = replayed.escalationCarryRoots.get(child.escalationGame)
		const replayedCarryPeaks = replayed.escalationCarryPeaks.get(child.escalationGame)
		const replayedLeafCounts = replayed.escalationLeafCounts.get(child.escalationGame)
		const replayedCarryTotals = replayed.escalationUnresolvedTotals.get(child.escalationGame)
		const replayedNullifierRoots = replayed.escalationNullifierRoots.get(child.escalationGame)
		if (replayedCarryRoots === undefined || replayedCarryPeaks === undefined || replayedLeafCounts === undefined || replayedCarryTotals === undefined || replayedNullifierRoots === undefined) {
			throw new Error('child carry replay state is incomplete')
		}
		const emptyHash = `0x${'0'.repeat(64)}` as Hex
		for (const outcomeIndex of [0, 1, 2] as const) {
			strictEqualTypeSafe(replayedCarryRoots[outcomeIndex], storedCarryRoots[outcomeIndex], `child carry root replay mismatch for outcome ${outcomeIndex.toString()}`)
			strictEqualTypeSafe(replayedLeafCounts[outcomeIndex], storedCarrySnapshot[1][outcomeIndex], `child carry leaf-count replay mismatch for outcome ${outcomeIndex.toString()}`)
			strictEqualTypeSafe(replayedCarryTotals[outcomeIndex], storedCarrySnapshot[2][outcomeIndex], `child carry total replay mismatch for outcome ${outcomeIndex.toString()}`)
			strictEqualTypeSafe(replayedNullifierRoots[outcomeIndex], storedCarrySnapshot[3][outcomeIndex], `child carry nullifier replay mismatch for outcome ${outcomeIndex.toString()}`)
			const storedOutcomeState = storedOutcomeStates[outcomeIndex]
			if (storedOutcomeState === undefined) throw new Error(`child carry storage outcome ${outcomeIndex.toString()} is missing`)
			const storedOutcomePeaks = storedOutcomeState.currentPeaks
			const replayedOutcomePeaks = replayedCarryPeaks[outcomeIndex]
			if (replayedOutcomePeaks === undefined) throw new Error(`child carry outcome ${outcomeIndex.toString()} is missing`)
			for (const [peakIndex, storedPeak] of storedOutcomePeaks.entries()) {
				strictEqualTypeSafe(replayedOutcomePeaks[peakIndex] ?? emptyHash, storedPeak, `child carry peak replay mismatch for outcome ${outcomeIndex.toString()} height ${peakIndex.toString()}`)
			}
		}
	})

	test('actual universe logs reconstruct migration balances and child storage', async () => {
		await fixture.triggerExternalForkForSecurityPool(undefined, 'event replay universe state source')
		await fixture.createChildUniverse(client, securityPoolAddresses.securityPool, fixture.QuestionOutcome.Yes)
		const toBlock = await client.getBlockNumber()
		const replayLogs = await getContractReplayLogs(fixture.getZoltarAddress(), Zoltar_Zoltar.abi, 0n, toBlock)
		const replayed = replayZoltarEvents(replayLogs)
		const universeId = fixture.genesisUniverse.toString()
		const replayedParent = replayed.universes.get(universeId)
		const replayedFork = replayed.universeForks.get(universeId)
		if (replayedParent === undefined || replayedFork === undefined) throw new Error('parent universe replay state missing')
		const childUniverseId = fixture.getChildUniverseId(fixture.genesisUniverse, fixture.QuestionOutcome.Yes)
		const replayedChild = replayed.universes.get(childUniverseId.toString())
		if (replayedChild === undefined) throw new Error('child universe replay state missing')

		const parentStorage = await getUniverseData(client, fixture.genesisUniverse)
		const childStorage = await getUniverseData(client, childUniverseId)
		const parentSupply = await getUniverseTheoreticalSupplyAttoRep(client, fixture.genesisUniverse)
		const childSupply = await getUniverseTheoreticalSupplyAttoRep(client, childUniverseId)
		strictEqualTypeSafe(replayedParent.forkTime, parentStorage.forkTime, 'parent universe fork time replay mismatch')
		strictEqualTypeSafe(replayedParent.forkQuestionId, parentStorage.forkQuestionId, 'parent universe fork question replay mismatch')
		strictEqualTypeSafe(replayedParent.universeTheoreticalSupplyAttoRep, parentSupply, 'parent universe supply replay mismatch')
		strictEqualTypeSafe(replayedChild.forkQuestionId, childStorage.forkQuestionId, 'child universe fork question replay mismatch')
		strictEqualTypeSafe(replayedChild.forkingOutcomeIndex, childStorage.forkingOutcomeIndex, 'child universe outcome replay mismatch')
		strictEqualTypeSafe(replayedChild.reputationToken, childStorage.reputationToken, 'child REP address replay mismatch')
		strictEqualTypeSafe(replayedChild.parentUniverseId, childStorage.parentUniverseId.toString(), 'child parent universe replay mismatch')
		strictEqualTypeSafe(replayedChild.universeTheoreticalSupplyAttoRep, childSupply, 'child universe supply replay mismatch')
		const migrationBalances = replayed.migrationRepBalancesAttoRep.get(universeId)
		if (migrationBalances === undefined || migrationBalances.size === 0) throw new Error('migration balances were not replayed')
		for (const [migrator, migrationBalance] of migrationBalances) {
			strictEqualTypeSafe(migrationBalance, await getMigrationRepBalanceAttoRep(client, fixture.genesisUniverse, migrator), `migration balance replay mismatch for ${migrator}`)
		}
	})

	test('seeded actual-log accounting replay matches child pool and vault storage', async () => {
		const fromBlock = (await client.getBlockNumber()) + 1n
		const scenario = await fixture.setupFinalizedTruthAuctionWithMixedBids()
		let seed = 0x5eedn
		const nextRandom = () => {
			seed = (seed * 1103515245n + 12345n) % (1n << 31n)
			return seed
		}
		for (let updateIndex = 0; updateIndex < 6; updateIndex += 1) {
			await mockWindow.advanceTime((nextRandom() % 7n) + 1n)
			await fixture.updateSettlementCollateral(client, scenario.yesSecurityPool.securityPool)
		}
		await fixture.updateVaultFees(client, scenario.yesSecurityPool.securityPool, client.account.address)
		await mockWindow.advanceTime((nextRandom() % 17n) + 3n)
		await fixture.claimAuctionProceeds(client, scenario.yesSecurityPool.securityPool, scenario.winningBidder.account.address, [{ tick: scenario.winningTick, bidIndex: 0n }])

		const checkpointVaults = [client.account.address, scenario.winningBidder.account.address]
		if ((nextRandom() & 1n) === 1n) checkpointVaults.reverse()
		await mockWindow.advanceTime((nextRandom() % 11n) + 1n)
		for (const vault of checkpointVaults) await fixture.updateVaultFees(client, scenario.yesSecurityPool.securityPool, vault)
		for (let updateIndex = 0; updateIndex < 4; updateIndex += 1) {
			await mockWindow.advanceTime((nextRandom() % 5n) + 1n)
			await fixture.updateSettlementCollateral(client, scenario.yesSecurityPool.securityPool)
		}
		for (const vault of checkpointVaults.toReversed()) await fixture.updateVaultFees(client, scenario.yesSecurityPool.securityPool, vault)
		for (const vault of checkpointVaults) await fixture.redeemFees(client, scenario.yesSecurityPool.securityPool, vault)

		const toBlock = await client.getBlockNumber()
		const replayLogs = await getContractReplayLogs(scenario.yesSecurityPool.securityPool, peripherals_SecurityPool_SecurityPool.abi, fromBlock, toBlock)
		const replayedState = replayZoltarEvents(replayLogs)
		const replayedPool = replayedState.pools.get(scenario.yesSecurityPool.securityPool)
		if (replayedPool === undefined) throw new Error('seeded pool accounting replay state missing')
		const snapshot = await client.readContract({ address: scenario.yesSecurityPool.securityPool, abi: poolAccountingSnapshotAbi, functionName: 'getPoolAccountingSnapshot', args: [] })
		strictEqualTypeSafe(replayedPool.settlementCollateralAttoEth, snapshot.settlementCollateralAttoEth, 'seeded collateral replay mismatch')
		strictEqualTypeSafe(replayedPool.totalCoverageCommitmentAttoEth, snapshot.totalCoverageCommitmentAttoEth, 'coverage commitment')
		strictEqualTypeSafe(replayedPool.feeEligibleCoverageCommitmentAttoEth, snapshot.feeEligibleCoverageCommitmentAttoEth, 'coverage commitment')
		strictEqualTypeSafe(replayedPool.totalClaimableVaultFeesAttoEth, snapshot.totalClaimableVaultFeesAttoEth, 'seeded fee liability replay mismatch')
		strictEqualTypeSafe(replayedPool.unallocatedAccruedFeesAttoEth, snapshot.unallocatedAccruedFeesAttoEth, 'seeded fee reserve replay mismatch')
		strictEqualTypeSafe(replayedPool.feeIndex, snapshot.feeIndex, 'seeded fee-index replay mismatch')
		strictEqualTypeSafe(replayedPool.feeIndexRemainder, snapshot.feeIndexRemainder, 'seeded fee-index remainder replay mismatch')
		strictEqualTypeSafe(replayedPool.totalFeesOwedRemainder, snapshot.totalFeesOwedRemainder, 'seeded total-fee remainder replay mismatch')
		strictEqualTypeSafe(replayedPool.uncheckpointedFeeEligibleCoverageCommitmentAttoEth, snapshot.uncheckpointedFeeEligibleCoverageCommitmentAttoEth, 'coverage commitment')
		strictEqualTypeSafe(replayedPool.lastUpdatedFeeAccumulator, snapshot.lastUpdatedFeeAccumulator, 'seeded accumulator replay mismatch')
		strictEqualTypeSafe(replayedPool.currentRetentionRate, snapshot.currentRetentionRate, 'seeded retention-rate replay mismatch')

		for (const vault of checkpointVaults) {
			const replayedVault = replayedState.vaults.get(scenario.yesSecurityPool.securityPool)?.get(vault)
			if (replayedVault === undefined) throw new Error(`seeded vault replay state missing for ${vault}`)
			const storedVault = await fixture.getSecurityVault(client, scenario.yesSecurityPool.securityPool, vault)
			const storedVaultFeeRemainder = await client.readContract({
				address: scenario.yesSecurityPool.securityPool,
				abi: peripherals_SecurityPool_SecurityPool.abi,
				functionName: 'getVaultFeeRemainder',
				args: [vault],
			})
			strictEqualTypeSafe(replayedVault.repBackingUnits, storedVault.vaultRepBackingAttoRep, `seeded backingUnits replay mismatch for ${vault}`)
			strictEqualTypeSafe(replayedVault.coverageCommitmentAttoEth, storedVault.coverageCommitmentAttoEth, `seeded coverageCommitmentAttoEth replay mismatch for ${vault}`)
			strictEqualTypeSafe(replayedVault.claimableFeesAttoEth, storedVault.claimableFeesAttoEth, `seeded unpaid-fees replay mismatch for ${vault}`)
			strictEqualTypeSafe(replayedVault.feeIndex, storedVault.feeIndex, `seeded vault fee-index replay mismatch for ${vault}`)
			strictEqualTypeSafe(replayedVault.vaultFeeRemainder, storedVaultFeeRemainder, `seeded vault fee remainder replay mismatch for ${vault}`)
		}
		const replayedPoolState = replayedState.poolStates.get(scenario.yesSecurityPool.securityPool)
		if (replayedPoolState === undefined) throw new Error('seeded child pool state replay missing')
		const storedShareSupply = await client.readContract({ address: scenario.yesSecurityPool.securityPool, abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'shareTokenSupplyAttoShares', args: [] })
		const storedBackingUnitsDenominator = await client.readContract({ address: scenario.yesSecurityPool.securityPool, abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'totalRepBackingUnits', args: [] })
		const storedSystemState = await client.readContract({ address: scenario.yesSecurityPool.securityPool, abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'systemState', args: [] })
		const storedAwaitingContinuation = await client.readContract({ address: scenario.yesSecurityPool.securityPool, abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'awaitingForkContinuation', args: [] })
		const storedEscalationGame = await client.readContract({ address: scenario.yesSecurityPool.securityPool, abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'escalationGame', args: [] })
		strictEqualTypeSafe(replayedPoolState.shareTokenSupplyAttoShares, storedShareSupply, 'seeded child share supply replay mismatch')
		strictEqualTypeSafe(replayedPoolState.totalRepBackingUnits, storedBackingUnitsDenominator, 'seeded child backingUnits denominator replay mismatch')
		strictEqualTypeSafe(replayedPoolState.systemState, storedSystemState, 'seeded child system state replay mismatch')
		strictEqualTypeSafe(replayedPoolState.awaitingForkContinuation ?? false, storedAwaitingContinuation, 'seeded child continuation state replay mismatch')
		strictEqualTypeSafe(replayedPoolState.escalationGame ?? zeroAddress, storedEscalationGame, 'seeded child escalation-game replay mismatch')
	})

	test('actual vault checkpoints carry a fractional fee entitlement into a later whole attoETH', async () => {
		const pool = securityPoolAddresses.securityPool
		const vault = client.account.address
		const storedVaultBefore = await fixture.getSecurityVault(client, pool, vault)
		const vaultSlot = fixture.getMappingStorageSlot(vault, 16n)
		const vaultFeeRemainderSlot = fixture.getMappingStorageSlot(vault, 17n)
		const firstFeeIndex = storedVaultBefore.feeIndex + 1n
		const maxUint256 = (1n << 256n) - 1n
		await mockWindow.addStateOverrides({
			[pool]: {
				stateDiff: {
					[fixture.formatStorageSlot(1n)]: 1n,
					[fixture.formatStorageSlot(7n)]: maxUint256,
					[fixture.formatStorageSlot(8n)]: firstFeeIndex,
					[fixture.formatStorageSlot(12n)]: 1n,
					[fixture.formatStorageSlot(13n)]: 1n,
					[fixture.formatStorageSlot(vaultSlot + 1n)]: 1n,
					[fixture.formatStorageSlot(vaultFeeRemainderSlot)]: fixture.PRICE_PRECISION - 2n,
				},
			},
		})

		const firstCheckpointHash = await fixture.updateVaultFees(client, pool, vault)
		const firstCheckpointReceipt = await client.getTransactionReceipt({ hash: firstCheckpointHash })
		const remainderAfterFirstCheckpoint = await client.readContract({
			address: pool,
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'getVaultFeeRemainder',
			args: [vault],
		})
		const vaultAfterFirstCheckpoint = await fixture.getSecurityVault(client, pool, vault)
		strictEqualTypeSafe(remainderAfterFirstCheckpoint, fixture.PRICE_PRECISION - 1n, 'first checkpoint should preserve the sub-attoETH vault entitlement')
		strictEqualTypeSafe(vaultAfterFirstCheckpoint.claimableFeesAttoEth, storedVaultBefore.claimableFeesAttoEth, 'fractional entitlement alone should not credit a whole attoETH')

		await mockWindow.addStateOverrides({
			[pool]: {
				stateDiff: {
					[fixture.formatStorageSlot(8n)]: firstFeeIndex + 1n,
					[fixture.formatStorageSlot(11n)]: 1n,
					[fixture.formatStorageSlot(13n)]: 1n,
				},
			},
		})
		const secondCheckpointHash = await fixture.updateVaultFees(client, pool, vault)
		const secondCheckpointReceipt = await client.getTransactionReceipt({ hash: secondCheckpointHash })
		const replayLogs = await getContractReplayLogs(pool, peripherals_SecurityPool_SecurityPool.abi, firstCheckpointReceipt.blockNumber, secondCheckpointReceipt.blockNumber)
		const replayedVault = replayZoltarEvents(replayLogs).vaults.get(pool)?.get(vault)
		if (replayedVault === undefined) throw new Error('fractional vault checkpoint replay state missing')
		const storedVaultAfter = await fixture.getSecurityVault(client, pool, vault)
		const storedRemainderAfter = await client.readContract({
			address: pool,
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'getVaultFeeRemainder',
			args: [vault],
		})
		strictEqualTypeSafe(storedVaultAfter.claimableFeesAttoEth, storedVaultBefore.claimableFeesAttoEth + 1n, 'the carried fraction plus one fee-index unit should credit one whole attoETH')
		strictEqualTypeSafe(storedRemainderAfter, 0n, 'whole-attoETH credit should consume the carried fraction exactly')
		strictEqualTypeSafe(replayedVault.claimableFeesAttoEth, storedVaultAfter.claimableFeesAttoEth, 'replayed whole-attoETH vault credit mismatch')
		strictEqualTypeSafe(replayedVault.vaultFeeRemainder, storedRemainderAfter, 'replayed final vault fee remainder mismatch')
	})

	test('zero fee eligibility emits an authoritative accounting checkpoint matching storage', async () => {
		await mockWindow.advanceTime(10n)
		const transactionHash = await fixture.updateSettlementCollateral(client, securityPoolAddresses.securityPool)
		const receipt = await client.getTransactionReceipt({ hash: transactionHash })
		const logs = await client.getLogs({
			address: securityPoolAddresses.securityPool,
			event: poolAccountingCheckpointEvent,
			fromBlock: receipt.blockNumber,
			toBlock: receipt.blockNumber,
		})
		const checkpointLog = logs.find(log => log.transactionHash === transactionHash)
		if (checkpointLog === undefined) throw new Error('PoolAccountingCheckpoint log missing')
		if (
			checkpointLog.blockHash === null ||
			checkpointLog.blockHash === undefined ||
			checkpointLog.blockNumber === null ||
			checkpointLog.blockNumber === undefined ||
			checkpointLog.transactionHash === null ||
			checkpointLog.transactionHash === undefined ||
			checkpointLog.logIndex === null ||
			checkpointLog.logIndex === undefined ||
			checkpointLog.transactionIndex === null ||
			checkpointLog.transactionIndex === undefined ||
			checkpointLog.args === undefined
		) {
			throw new Error('checkpoint log identity is incomplete')
		}
		const replayLog: ReplayLog = {
			chainId: BigInt(await client.getChainId()),
			blockHash: checkpointLog.blockHash,
			blockNumber: checkpointLog.blockNumber,
			transactionHash: checkpointLog.transactionHash,
			transactionIndex: Number(checkpointLog.transactionIndex),
			logIndex: Number(checkpointLog.logIndex),
			emitter: checkpointLog.address,
			eventName: 'PoolAccountingCheckpoint',
			args: {
				reason: checkpointLog.args.reason,
				vault: checkpointLog.args.vault,
				settlementCollateralAttoEth: checkpointLog.args.settlementCollateralAttoEth,
				totalCoverageCommitmentAttoEth: checkpointLog.args.totalCoverageCommitmentAttoEth,
				feeEligibleCoverageCommitmentAttoEth: checkpointLog.args.feeEligibleCoverageCommitmentAttoEth,
				totalClaimableVaultFeesAttoEth: checkpointLog.args.totalClaimableVaultFeesAttoEth,
				unallocatedAccruedFeesAttoEth: checkpointLog.args.unallocatedAccruedFeesAttoEth,
				feeIndex: checkpointLog.args.feeIndex,
				feeIndexRemainder: checkpointLog.args.feeIndexRemainder,
				totalFeesOwedRemainder: checkpointLog.args.totalFeesOwedRemainder,
				uncheckpointedFeeEligibleCoverageCommitmentAttoEth: checkpointLog.args.uncheckpointedFeeEligibleCoverageCommitmentAttoEth,
				lastUpdatedFeeAccumulator: checkpointLog.args.lastUpdatedFeeAccumulator,
				currentRetentionRate: checkpointLog.args.currentRetentionRate,
			},
		}
		const replayed = replayZoltarEvents([replayLog]).pools.get(securityPoolAddresses.securityPool)
		if (replayed === undefined) throw new Error('pool checkpoint was not replayed')
		const snapshot = await client.readContract({
			address: securityPoolAddresses.securityPool,
			abi: poolAccountingSnapshotAbi,
			functionName: 'getPoolAccountingSnapshot',
			args: [],
		})
		strictEqualTypeSafe(replayed.settlementCollateralAttoEth, snapshot.settlementCollateralAttoEth, 'collateral checkpoint mismatch')
		strictEqualTypeSafe(replayed.totalCoverageCommitmentAttoEth, snapshot.totalCoverageCommitmentAttoEth, 'coverage commitment')
		strictEqualTypeSafe(replayed.feeEligibleCoverageCommitmentAttoEth, snapshot.feeEligibleCoverageCommitmentAttoEth, 'coverage commitment')
		strictEqualTypeSafe(replayed.totalClaimableVaultFeesAttoEth, snapshot.totalClaimableVaultFeesAttoEth, 'vault fee liability checkpoint mismatch')
		strictEqualTypeSafe(replayed.unallocatedAccruedFeesAttoEth, snapshot.unallocatedAccruedFeesAttoEth, 'unallocated reserve checkpoint mismatch')
		strictEqualTypeSafe(replayed.feeIndex, snapshot.feeIndex, 'fee-index checkpoint mismatch')
		strictEqualTypeSafe(replayed.feeIndexRemainder, snapshot.feeIndexRemainder, 'fee-index remainder checkpoint mismatch')
		strictEqualTypeSafe(replayed.totalFeesOwedRemainder, snapshot.totalFeesOwedRemainder, 'total fee remainder checkpoint mismatch')
		strictEqualTypeSafe(replayed.uncheckpointedFeeEligibleCoverageCommitmentAttoEth, snapshot.uncheckpointedFeeEligibleCoverageCommitmentAttoEth, 'uncheckpointed eligibility checkpoint mismatch')
		strictEqualTypeSafe(replayed.lastUpdatedFeeAccumulator, snapshot.lastUpdatedFeeAccumulator, 'fee accumulator checkpoint mismatch')
		strictEqualTypeSafe(replayed.currentRetentionRate, snapshot.currentRetentionRate, 'retention-rate checkpoint mismatch')
		strictEqualTypeSafe(replayed.vault, zeroAddress, 'accrual checkpoint should not attribute a vault')
	})

	test('external forks emit one canonical pool snapshot after REP is locked', async () => {
		const poolRepAtForkAttoRep = await fixture.getTotalPoolHeldRepAttoRep(client, securityPoolAddresses.securityPool)
		const settlementCollateralAtForkAttoEth = await fixture.getSettlementCollateralAttoEth(client, securityPoolAddresses.securityPool)
		const transactionHash = await fixture.triggerExternalForkForSecurityPool(undefined, 'event replay fork source')
		const receipt = await client.getTransactionReceipt({ hash: transactionHash })
		const forker = fixture.getInfraContractAddresses().securityPoolForker
		const logs = await client.getLogs({
			address: forker,
			event: securityPoolForkSnapshotEvent,
			fromBlock: receipt.blockNumber,
			toBlock: receipt.blockNumber,
		})
		const snapshotLog = logs.find(log => log.transactionHash === transactionHash && log.args?.parentPool === securityPoolAddresses.securityPool)
		if (snapshotLog === undefined) throw new Error('SecurityPoolForkSnapshot log missing')
		if (snapshotLog.args === undefined) throw new Error('SecurityPoolForkSnapshot arguments missing')
		const expectedMigrationProxy = await client.readContract({
			address: forker,
			abi: fixture.getMigrationProxyAddressAbi,
			functionName: 'getMigrationProxyAddress',
			args: [securityPoolAddresses.securityPool],
		})
		strictEqualTypeSafe(snapshotLog.args.migrationProxy, expectedMigrationProxy, 'migration proxy snapshot mismatch')
		strictEqualTypeSafe(snapshotLog.args.settlementCollateralAtForkAttoEth, settlementCollateralAtForkAttoEth, 'fork collateral snapshot mismatch')
		strictEqualTypeSafe(snapshotLog.args.poolRepAtForkAttoRep, poolRepAtForkAttoRep, 'fork REP snapshot mismatch')
		strictEqualTypeSafe(snapshotLog.args.auctionableRepAtForkAttoRep, poolRepAtForkAttoRep, 'external-fork auctionable REP mismatch')
		strictEqualTypeSafe(snapshotLog.args.ownFork, false, 'external fork should not be marked as own fork')
		strictEqualTypeSafe(snapshotLog.args.unresolvedEscalation, false, 'test fork should not report unresolved escalation')
	})
})
