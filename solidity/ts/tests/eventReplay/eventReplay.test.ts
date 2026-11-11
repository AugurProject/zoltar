import { getZoltarAddress, getRepTokenAddress, forkUniverse } from '../../testSupport/simulator/utils/contracts/zoltar'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { withdrawFromEscalationGame } from '../../testSupport/simulator/utils/contracts/securityPool'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { beforeEach, describe, expect, test } from 'bun:test'
import { decodeEventLog, zeroAddress, type Abi, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as uniformAuctionArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_EscalationGame_EscalationGame,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	statoblast_SecurityPool_SecurityPool,
	statoblast_SecurityPoolForker_SecurityPoolForker,
	statoblast_tokens_ShareToken_ShareToken,
	Zoltar_Zoltar,
} from '../../types/contractArtifact'
import { getMigrationRepBalanceAttoRep, getUniverseData, getUniverseTheoreticalSupplyAttoRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { hashCarryLeaf, hashParent } from '../carryProofHelpers'
import { isIgnorableLogDecodeError } from '../logDecodeErrors'
import { unit, useSecurityPoolPortfolioFixture } from '../statoblast/securityPoolPortfolioFixture'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { advancePastOrdinaryEscalationDeadline, ordinaryEscalationPrincipals } from '../residualCaptureHelpers'
import { getCanonicalEventIdentity, replayZoltarEvents, type ReplayLog } from './eventReplayModel'

function createReplayLog(overrides: Partial<ReplayLog> = {}): ReplayLog {
	const blockNumber = overrides.blockNumber ?? 1n
	const transactionIndex = overrides.transactionIndex ?? 0
	return {
		chainId: 1n,
		blockHash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
		blockNumber,
		transactionHash: `0x${(blockNumber * 1_000n + BigInt(transactionIndex) + 1n).toString(16).padStart(64, '0')}`,
		transactionIndex,
		logIndex: 0,
		emitter: '0x1111111111111111111111111111111111111111',
		eventName: 'QuestionAccountingCheckpoint',
		args: {
			reason: 0n,
			settlementCollateralAttoEth: 1n,
			shareTokenSupplyAttoShares: 2n,
			lastSettlementPortfolioTime: 1n,
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
			args: { ...canonicalLog.args, settlementCollateralAttoEth: 3n, lastSettlementPortfolioTime: 2n },
		})
		const fullState = replayZoltarEvents([orphanedLog, canonicalLog, canonicalLog])
		const emitter = canonicalLog.emitter
		if (fullState.pools.get(emitter)?.settlementCollateralAttoEth !== 3n) throw new Error('ordered replay did not apply the later block')
		if (fullState.identities.size !== 2) throw new Error('duplicate canonical event identity was not ignored')

		const rolledBack = replayZoltarEvents([orphanedLog, canonicalLog], new Set<Hex>([orphanedLog.blockHash]))
		if (rolledBack.pools.get(emitter)?.settlementCollateralAttoEth !== 1n) throw new Error('orphaned block was not removed')
		if (getCanonicalEventIdentity(canonicalLog) !== getCanonicalEventIdentity({ ...canonicalLog })) throw new Error('canonical identity is not deterministic')
	})

	test('replay rejects conflicting identities, mixed chains, and competing block hashes deterministically', () => {
		const canonical = createReplayLog()
		const conflict = createReplayLog({ args: { ...canonical.args, settlementCollateralAttoEth: 9n } })
		for (const input of [
			[canonical, conflict],
			[conflict, canonical],
		])
			expect(() => replayZoltarEvents(input)).toThrow('conflicting duplicate')
		const typedConflict = createReplayLog({ args: { ...canonical.args, reason: '0n' } })
		for (const input of [
			[canonical, typedConflict],
			[typedConflict, canonical],
		])
			expect(() => replayZoltarEvents(input)).toThrow('conflicting duplicate')
		expect(() => replayZoltarEvents([canonical, createReplayLog({ chainId: 2n, logIndex: 1 })])).toThrow('mixed-chain')
		expect(() => replayZoltarEvents([canonical, createReplayLog({ blockHash: `0x${'cc'.repeat(32)}`, logIndex: 1 })])).toThrow('competing block hashes')
		const orphanedCompetitor = createReplayLog({ blockHash: `0x${'cc'.repeat(32)}`, logIndex: 1 })
		expect(replayZoltarEvents([canonical, orphanedCompetitor], new Set([orphanedCompetitor.blockHash])).identities.size).toBe(1)
		const mixedCaseOrphan = canonical.blockHash.toUpperCase().replace('0X', '0x') as Hex
		expect(replayZoltarEvents([canonical], new Set([mixedCaseOrphan])).identities.size).toBe(0)
		expect(() => replayZoltarEvents([canonical, createReplayLog({ blockNumber: 2n, blockHash: canonical.blockHash, transactionHash: `0x${'ee'.repeat(32)}`, logIndex: 1 })])).toThrow('block hash appears at inconsistent positions')
		expect(() => replayZoltarEvents([canonical, createReplayLog({ transactionHash: canonical.transactionHash, transactionIndex: 1, logIndex: 1 })])).toThrow('transaction hash appears at inconsistent positions')
		expect(() => replayZoltarEvents([canonical, createReplayLog({ transactionHash: `0x${'ef'.repeat(32)}`, logIndex: 1 })])).toThrow('transaction position contains conflicting hashes')
		expect(() => replayZoltarEvents([canonical, createReplayLog({ transactionHash: `0x${'fe'.repeat(32)}`, transactionIndex: 1 })])).toThrow('block log position contains conflicting transactions')
	})

	test('uniform auction replay tracks bid IDs, lots, partial fills and refunds', () => {
		const auction = '0x1111111111111111111111111111111111111111'
		const bidder = '0x2222222222222222222222222222222222222222'
		const vault = '0x3333333333333333333333333333333333333333'
		const logs = [
			createReplayLog({ emitter: auction, logIndex: 0, eventName: 'AuctionStarted', args: { opensAt: 10n, closesAt: 20n, lotAttoEth: 5n, targetLots: 3n, inventoryAttoRep: 60n, maximumAttoRepPerLot: 20n } }),
			createReplayLog({ emitter: auction, logIndex: 1, eventName: 'BidSubmitted', args: { bidId: 1n, bidder, vault, lots: 4n, minimumAttoRepPerLot: 20n, targetHealthBps: 15_000n } }),
			createReplayLog({ emitter: auction, logIndex: 2, eventName: 'AuctionFinalized', args: { attoRepPerLot: 20n, filledLots: 3n, raisedAttoEth: 15n, soldAttoRep: 60n } }),
			createReplayLog({ emitter: auction, logIndex: 3, eventName: 'BidSettled', args: { bidId: 1n, bidder, filledLots: 3n, refundAttoEth: 5n } }),
		]
		for (const log of logs) {
			const event = uniformAuctionArtifact.abi.find(item => item.type === 'event' && item.name === log.eventName)
			if (event?.type !== 'event') throw new Error(`Missing uniform auction event ${log.eventName}`)
			expect(Object.keys(log.args).sort()).toEqual(event.inputs.map(input => input.name).sort())
		}
		const replayed = replayZoltarEvents(logs.toReversed())
		expect(replayed.auctions.get(auction)).toEqual({ opensAt: 10n, closesAt: 20n, lotAttoEth: 5n, targetLots: 3n, inventoryAttoRep: 60n, maximumAttoRepPerLot: 20n, attoRepPerLot: 20n, filledLots: 3n, raisedAttoEth: 15n, soldAttoRep: 60n })
		expect(replayed.auctionBids.get(auction)?.get('1')).toEqual({ bidder, vault, bidId: 1n, lots: 4n, minimumAttoRepPerLot: 20n, targetHealthBps: 15_000n, filledLots: 3n, refundAttoEth: 5n })
		expect(() => replayZoltarEvents(logs.slice(3))).toThrow('BidSettled references unknown bid')
	})

	test('coordinator reports preserve pending report and maximum settlement fee', () => {
		const coordinator = '0x1111111111111111111111111111111111111111'
		const replayed = replayZoltarEvents([createReplayLog({ emitter: coordinator, eventName: 'PriceRequested', args: { reportId: 9n, pendingReportMaxSettlementBaseFeeAttoEthPerGas: 100n } })])
		expect(replayed.coordinators.get(coordinator)?.pendingReportId).toBe(9n)
		expect(replayed.coordinators.get(coordinator)?.pendingReportMaxSettlementBaseFeeAttoEthPerGas).toBe(100n)
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
			createReplayLog({ emitter: coordinator, logIndex: 2, eventName: 'SecurityPoolSet', args: { securityPool: pool } }),
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
					collateralRepairAuction: zeroAddress,
					openOraclePriceCoordinator: coordinator,
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
		if (replayed.coordinators.get(coordinator)?.securityPool !== pool) throw new Error('coordinator setup checkpoint was not retained')
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
				args: { reportId: 1n, pendingReportMaxSettlementBaseFeeAttoEthPerGas: 100n },
			}),
			createReplayLog({
				emitter: coordinator,
				eventName: 'PriceReportRejected',
				logIndex: 6,
				args: {
					reportId: 1n,
					reason: 'Base fee too high',
					pendingReportId: 0n,
					pendingReportMaxSettlementBaseFeeAttoEthPerGas: 0n,
					lastPrice: 12n,
					lastSettlementTimestamp: 20n,
				},
			}),
			createReplayLog({
				emitter: coordinator,
				eventName: 'PriceRequested',
				logIndex: 7,
				args: { reportId: 2n, pendingReportMaxSettlementBaseFeeAttoEthPerGas: 101n },
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
				args: { reportId: 3n, pendingReportMaxSettlementBaseFeeAttoEthPerGas: 102n },
			}),
			createReplayLog({
				emitter: coordinator,
				eventName: 'PendingReportRecovered',
				logIndex: 10,
				args: {
					reportId: 3n,
					settlementTimestamp: 26n,
					pendingReportId: 0n,
					pendingReportMaxSettlementBaseFeeAttoEthPerGas: 0n,
					lastPrice: 15n,
					lastSettlementTimestamp: 25n,
				},
			}),
		]

		const secondBlockHash: Hex = `0x${'2'.padStart(64, '0')}`
		const secondTransactionHash: Hex = `0x${'3'.padStart(64, '0')}`
		const anchoredLogs = logs.map((log, index) =>
			index === 0
				? log
				: {
						...log,
						blockHash: secondBlockHash,
						blockNumber: 2n,
						transactionHash: secondTransactionHash,
					},
		)
		const replayed = replayZoltarEvents(anchoredLogs.toReversed())
		if (replayed.questions.get(9n)?.endTime !== 20n) throw new Error('question lifecycle mismatch')
		if (replayed.universeForks.get('0')?.questionId !== 9n) throw new Error('universe fork question mismatch')
		const coordinatorState = replayed.coordinators.get(coordinator)
		if (coordinatorState?.reports.get(1n)?.status !== 'Rejected') throw new Error('rejected coordinator report mismatch')
		if (coordinatorState.reports.get(2n)?.status !== 'Reported') throw new Error('reported coordinator report mismatch')
		if (coordinatorState.reports.get(3n)?.status !== 'Recovered') throw new Error('recovered coordinator report mismatch')
		if (coordinatorState.pendingReportId !== 0n || coordinatorState.lastPrice !== 15n) throw new Error('coordinator resulting state mismatch')
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
				args: { nodeId: 1n, outcome: 1n, depositor: firstVault, amountAttoRep: 10n, parentDepositIndex: 1n, cumulativeRepAmountAttoRep: 10n },
			}),
			createReplayLog({
				emitter: secondGame,
				eventName: 'LocalDepositAppended',
				logIndex: 1,
				args: { nodeId: 1n, outcome: 1n, depositor: secondVault, amountAttoRep: 20n, parentDepositIndex: 1n, cumulativeRepAmountAttoRep: 20n },
			}),
			createReplayLog({ emitter: firstCoordinator, logIndex: 2, eventName: 'PriceReported', args: { reportId: 1n, price: 3n, lastSettlementTimestamp: 10n } }),
			createReplayLog({ emitter: secondCoordinator, logIndex: 3, eventName: 'PriceReported', args: { reportId: 1n, price: 4n, lastSettlementTimestamp: 11n } }),
		]

		const replayed = replayZoltarEvents(logs.toReversed())
		if (replayed.escalationDeposits.get(firstGame)?.get('1:1')?.depositor !== firstVault) throw new Error('first game deposit counter collided')
		if (replayed.escalationDeposits.get(secondGame)?.get('1:1')?.depositor !== secondVault) throw new Error('second game deposit counter collided')
		if (replayed.coordinators.get(firstCoordinator)?.reports.get(1n)?.price !== 3n) throw new Error('first coordinator report counter collided')
		if (replayed.coordinators.get(secondCoordinator)?.reports.get(1n)?.price !== 4n) throw new Error('second coordinator report counter collided')
	})

	test('escalation claim replay preserves immutable depositors and complete reporter principal', () => {
		const game: Address = '0x1111111111111111111111111111111111111111'
		const firstVault: Address = '0x2222222222222222222222222222222222222222'
		const secondVault: Address = '0x3333333333333333333333333333333333333333'
		const postResumeVault: Address = '0x6666666666666666666666666666666666666666'
		const logs = [
			createReplayLog({
				emitter: game,
				eventName: 'LocalDepositAppended',
				logIndex: 0,
				args: { nodeId: 1n, outcome: 1n, depositor: firstVault, amountAttoRep: 100n, parentDepositIndex: 0n, cumulativeRepAmountAttoRep: 100n },
			}),
			createReplayLog({
				emitter: game,
				eventName: 'LocalDepositAppended',
				logIndex: 1,
				args: { nodeId: 2n, outcome: 2n, depositor: secondVault, amountAttoRep: 50n, parentDepositIndex: 0n, cumulativeRepAmountAttoRep: 50n },
			}),
			createReplayLog({
				emitter: game,
				eventName: 'DepositOnOutcome',
				logIndex: 2,
				args: { depositor: firstVault, outcome: 1n, amountAttoRep: 100n, depositIndex: 0n, cumulativeRepAmountAttoRep: 100n, resultingVaultDisputeStakedAttoRep: 100n, resultingTotalDisputeStakedAttoRep: 100n },
			}),
			createReplayLog({
				emitter: game,
				eventName: 'DepositOnOutcome',
				logIndex: 3,
				args: { depositor: secondVault, outcome: 2n, amountAttoRep: 50n, depositIndex: 0n, cumulativeRepAmountAttoRep: 50n, resultingVaultDisputeStakedAttoRep: 50n, resultingTotalDisputeStakedAttoRep: 150n },
			}),

			createReplayLog({
				emitter: game,
				eventName: 'LocalDepositAppended',
				logIndex: 5,
				args: { nodeId: 3n, outcome: 0n, depositor: postResumeVault, amountAttoRep: 1n, parentDepositIndex: 0n, cumulativeRepAmountAttoRep: 1n },
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
		expect(firstBundle.claimRepUnits).toBe(100n)
		expect(secondBundle.claimRepUnits).toBe(50n)
		expect(replayed.escalationTotalEscrowedRep.get(game)).toBe(150n)
		expect(replayed.escalationResolutionBalances.get(game)).toEqual([1n, 100n, 50n])
		expect(postResumeBundle.claimRepUnits).toBe(1n)
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
				args: { nodeId: 1n, outcome: 1n, depositor, amountAttoRep: 10n, parentDepositIndex: 0n, cumulativeRepAmountAttoRep: 10n },
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
				args: { nodeId: 1n, outcome: 1n, depositor, amountAttoRep: 5n, parentDepositIndex: 7n, cumulativeRepAmountAttoRep: 15n },
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
					amountAttoRep: 5n,
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
		const reopened = replayZoltarEvents([...logs, createReplayLog({ emitter: continuationGame, eventName: 'InheritedThresholdTieReopened', logIndex: 5, args: {} })])
		if (reopened.escalationLifecycles.get(continuationGame)?.nonDecisionState !== 'none') throw new Error('reopened inherited tie must replay as an ordinary dispute')
		if (reopened.escalationLifecycles.get(localGame)?.nonDecisionState !== 'local') throw new Error('reopening a continuation must preserve the parent local transition')
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
					collateralRepairAuction: zeroAddress,
					openOraclePriceCoordinator: zeroAddress,
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
				args: { nodeId: 1n, outcome: 1n, depositor: vault, amountAttoRep: 10n, parentDepositIndex: 5n, cumulativeRepAmountAttoRep: 10n },
			}),
			createReplayLog({
				emitter: game,
				eventName: 'DepositOnOutcome',
				logIndex: 2,
				args: {
					depositor: vault,
					outcome: 1n,
					amountAttoRep: 10n,
					depositIndex: 0n,
					cumulativeRepAmountAttoRep: 10n,
					resultingVaultDisputeStakedAttoRep: 10n,
					resultingTotalDisputeStakedAttoRep: 10n,
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
					amountAttoRep: 10n,
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
			createReplayLog({ emitter: game, eventName: 'VaultEscrowUpdated', logIndex: 5, args: { vault, disputeStakedRepByVaultAttoRep: 0n, totalDisputeStakedAttoRep: 0n } }),
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
					totalDisputeStakedAttoRep: 15n,
					outcomeBalanceAttoRep: 20n,
				},
			}),
			createReplayLog({
				emitter: game,
				eventName: 'ForkedEscrowExported',
				logIndex: 9,
				args: {
					vault,
					repReceiver: receiver,
					sourcePrincipalByOutcomeAttoRep: [0n, 0n, 20n],
					childRepByOutcomeAttoRep: [0n, 0n, 15n],
					totalChildRepToTransferAttoRep: 15n,
					transferredRep: true,
				},
			}),
			createReplayLog({ emitter: game, eventName: 'VaultEscrowUpdated', logIndex: 10, args: { vault, disputeStakedRepByVaultAttoRep: 0n, totalDisputeStakedAttoRep: 0n } }),
			createReplayLog({
				emitter: game,
				eventName: 'LocalDepositAppended',
				logIndex: 11,
				args: { nodeId: 2n, outcome: 2n, depositor: secondVault, amountAttoRep: 4n, parentDepositIndex: 7n, cumulativeRepAmountAttoRep: 4n },
			}),
			createReplayLog({
				emitter: game,
				eventName: 'DepositOnOutcome',
				logIndex: 12,
				args: {
					depositor: secondVault,
					outcome: 2n,
					amountAttoRep: 4n,
					depositIndex: 0n,
					cumulativeRepAmountAttoRep: 4n,
					resultingVaultDisputeStakedAttoRep: 4n,
					resultingTotalDisputeStakedAttoRep: 4n,
				},
			}),
			createReplayLog({
				emitter: game,
				eventName: 'VaultUnresolvedTotalsExported',
				logIndex: 13,
				args: {
					vault: secondVault,
					repReceiver: zeroAddress,
					principalByOutcomeAttoRep: [0n, 0n, 4n],
					principalToTransferAttoRep: 4n,
					transferredRep: false,
				},
			}),
			createReplayLog({ emitter: game, eventName: 'VaultEscrowUpdated', logIndex: 14, args: { vault: secondVault, disputeStakedRepByVaultAttoRep: 0n, totalDisputeStakedAttoRep: 0n } }),
			createReplayLog({ emitter: game, eventName: 'EscalationSurplusAccrued', logIndex: 15, args: { amountAttoRep: 2n, cumulativeSurplusAttoRep: 2n } }),
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
		if (replayed.escalationForkedExports.get(game)?.get(vault)?.totalChildRepToTransferAttoRep !== 15n) throw new Error('forked escrow export mismatch')
		if (replayed.escalationSurplusAccrued.get(game) !== 2n) throw new Error('source-accrued REP surplus mismatch')
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
					collateralRepairAuction: auction,
					openOraclePriceCoordinator: coordinator,
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
					amountAttoRep: 10n,
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
					amountAttoRep: 10n,
					depositIndex: 0n,
					cumulativeRepAmountAttoRep: 10n,
					resultingVaultDisputeStakedAttoRep: 10n,
					resultingTotalDisputeStakedAttoRep: 10n,
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
					amountAttoRep: 10n,
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
				args: { opensAt: 20n, closesAt: 30n, lotAttoEth: 5n, targetLots: 1n, inventoryAttoRep: 8n, maximumAttoRepPerLot: 8n },
			}),
			createReplayLog({
				emitter: auction,
				eventName: 'AuctionFinalized',
				logIndex: 11,
				args: { attoRepPerLot: 8n, filledLots: 1n, raisedAttoEth: 5n, soldAttoRep: 8n },
			}),
			createReplayLog({ emitter: coordinator, logIndex: 12, eventName: 'PriceRequested', args: { reportId: 3n, pendingReportMaxSettlementBaseFeeAttoEthPerGas: 100n } }),
			createReplayLog({ emitter: coordinator, logIndex: 13, eventName: 'PriceReported', args: { reportId: 3n, price: 7n, lastSettlementTimestamp: 22n } }),
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
		if (replayed.auctions.get(auction)?.soldAttoRep !== 8n) throw new Error('auction lifecycle mismatch')
		if (replayed.coordinators.get(coordinator)?.reports.get(3n)?.status !== 'Reported') throw new Error('coordinator terminal state mismatch')
	})

	const portfolioFixture = useSecurityPoolPortfolioFixture()
	const fixture = portfolioFixture.base
	const reportBond = 100n * unit

	let client: typeof fixture.client
	let mockWindow: typeof fixture.mockWindow
	let securityPoolAddresses: ReturnType<typeof portfolioFixture.poolFor>

	beforeEach(() => {
		client = fixture.client
		mockWindow = fixture.mockWindow
		securityPoolAddresses = portfolioFixture.poolFor(fixture.questionId)
	})

	const depositWallet = async (outcome: number, amount: bigint) => {
		const now = await mockWindow.getTime()
		if (now <= fixture.questionData.endTime) await mockWindow.setTime(fixture.questionData.endTime + 1n)
		await approveToken(client, getRepTokenAddress(fixture.genesisUniverse), securityPoolAddresses.securityPool)
		return writeContractAndWait(client, () => client.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddresses.securityPool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, amount] }))
	}
	const activateChild = async (title: string) => {
		const question = { ...fixture.questionData, title, endTime: (await mockWindow.getTime()) - 1n, startTime: 0n }
		await createQuestion(client, question, fixture.outcomes)
		await approveToken(client, getRepTokenAddress(fixture.genesisUniverse), getZoltarAddress())
		await forkUniverse(client, fixture.genesisUniverse, getQuestionId(question, fixture.outcomes))
		const controller = await client.readContract({ abi: portfolioArtifact.abi, address: portfolioFixture.portfolio, functionName: 'forkController' })
		const forkTime = (await getUniverseData(client, fixture.genesisUniverse)).forkTime
		await mockWindow.setTime(forkTime + 63n * DAY)
		const childUniverseId = getChildUniverseId(fixture.genesisUniverse, 1n)
		await writeContractAndWait(client, () => client.writeContract({ abi: forkArtifact.abi, address: controller, functionName: 'startBranch', args: [fixture.genesisUniverse, 1n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: forkArtifact.abi, address: controller, functionName: 'finalizeBranch', args: [childUniverseId] }))
		const target = { abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi, address: getInfraContractAddresses().securityPoolForker }
		const childDeploymentHash = await writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'preparePortfolioQuestion', args: [securityPoolAddresses.securityPool, childUniverseId] }))
		for (let outcome = 0; outcome < 3; outcome++) await writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'materializePortfolioQuestion', args: [securityPoolAddresses.securityPool, childUniverseId] }))
		return { childUniverseId, childDeploymentHash }
	}

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
				log.transactionIndex === undefined ||
				log.logIndex === null ||
				log.logIndex === undefined ||
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
				transactionIndex: Number.parseInt(log.transactionIndex.toString(), 10),
				logIndex: Number.parseInt(log.logIndex.toString(), 10),
				emitter: log.address,
				eventName: decoded.eventName,
				args: Object.fromEntries(Object.entries(decoded.args)),
			})
		}
		return replayLogs
	}

	test('actual origin deployment pre-discovers relationships before constructor checkpoints', async () => {
		const questionData = { ...fixture.questionData, title: 'Event replay deployment discovery' }
		const questionId = getQuestionId(questionData, fixture.outcomes)
		await createQuestion(client, questionData, fixture.outcomes)
		const factory = getInfraContractAddresses().securityPoolFactory
		const deploymentHash = await portfolioFixture.register(questionId)
		const receipt = await client.waitForTransactionReceipt({ hash: deploymentHash })
		if (receipt.status === 'reverted') throw new Error('origin pool deployment reverted')
		const addresses = portfolioFixture.poolFor(questionId)
		const blockNumber = receipt.blockNumber
		const replayLogs = (
			await Promise.all([
				getContractReplayLogs(factory, statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi, blockNumber, blockNumber),
				getContractReplayLogs(addresses.securityPool, statoblast_SecurityPool_SecurityPool.abi, blockNumber, blockNumber),
				getContractReplayLogs(addresses.shareToken, statoblast_tokens_ShareToken_ShareToken.abi, blockNumber, blockNumber),
				getContractReplayLogs(addresses.openOraclePriceCoordinator, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, blockNumber, blockNumber),
			])
		)
			.flat()
			.filter(log => log.transactionHash === deploymentHash)
		const deploymentLog = replayLogs.find(log => log.eventName === 'DeploySecurityPool')
		const authorizationLog = replayLogs.find(log => log.eventName === 'AuthorizationUpdated')
		const coordinatorCheckpointLog = replayLogs.find(log => log.eventName === 'SecurityPoolSet')
		if (deploymentLog === undefined || authorizationLog === undefined || coordinatorCheckpointLog === undefined) {
			throw new Error('origin deployment receipt is missing replay relationships or setup events')
		}
		for (const setupLog of [authorizationLog, coordinatorCheckpointLog]) {
			if (setupLog.logIndex >= deploymentLog.logIndex) throw new Error('setup checkpoint did not precede relationship discovery')
		}

		const replayed = replayZoltarEvents(replayLogs, new Set(), new Set([factory]))
		if (replayed.poolDeployments.get(addresses.securityPool)?.shareToken !== addresses.shareToken) throw new Error('origin deployment relationship mismatch')
		const storedOriginPriorityFee = await client.readContract({
			address: addresses.openOraclePriceCoordinator,
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'initialReportPriorityFeeAttoEthPerGas',
			args: [],
		})
		strictEqualTypeSafe(replayed.poolDeployments.get(addresses.securityPool)?.initialReportPriorityFeeAttoEthPerGas, storedOriginPriorityFee, 'origin priority fee replay mismatch')
		if (replayed.authorizations.get(addresses.shareToken)?.get(addresses.securityPool) !== true) throw new Error('origin pool authorization was not replayed')
		if (replayed.coordinators.get(addresses.openOraclePriceCoordinator)?.securityPool !== addresses.securityPool) {
			throw new Error('origin coordinator setup checkpoint was not replayed')
		}
	})

	test('shared question accounting and share balances replay across purchases and returns', async () => {
		await portfolioFixture.prepare()
		const holder = portfolioFixture.other()
		for (const question of [fixture.questionId, portfolioFixture.secondQuestionId]) {
			const pool = portfolioFixture.poolFor(question)
			for (const amount of [3n * unit, 5n * unit, 2n * unit]) {
				await portfolioFixture.mint(amount, question)
				await writeContractAndWait(holder, () => holder.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool.securityPool, functionName: 'redeemCompleteSet', args: [amount / 2n] }))
			}
			await mockWindow.advanceTime(10n)
			await writeContractAndWait(client, () => client.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool.securityPool, functionName: 'updateSettlementCollateral' }))
			const latest = await client.getBlockNumber()
			const logs = (await Promise.all([getContractReplayLogs(pool.securityPool, statoblast_SecurityPool_SecurityPool.abi, 0n, latest), getContractReplayLogs(pool.shareToken, statoblast_tokens_ShareToken_ShareToken.abi, 0n, latest)])).flat()
			const replayed = replayZoltarEvents(logs)
			const state = replayed.pools.get(pool.securityPool)
			if (state === undefined) throw new Error('Question accounting event missing')
			expect(state.settlementCollateralAttoEth).toBe(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool.securityPool, functionName: 'settlementCollateralAttoEth' }))
			expect(state.shareTokenSupplyAttoShares).toBe(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool.securityPool, functionName: 'shareTokenSupplyAttoShares' }))
			expect(state.lastSettlementPortfolioTime).toBe(await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool.securityPool, functionName: 'lastSettlementPortfolioTime' }))
			for (const outcome of [0n, 1n, 2n]) {
				const id = fixture.genesisUniverse * 256n + outcome
				expect(replayed.shareTokenBalances.get(pool.shareToken)?.get(id)?.get(holder.account.address)).toBe(await holder.readContract({ abi: statoblast_tokens_ShareToken_ShareToken.abi, address: pool.shareToken, functionName: 'balanceOf', args: [holder.account.address, id] }))
			}
		}
	})

	test('actual first escalation deposit pre-discovers the game before its lifecycle event', async () => {
		await mockWindow.setTime(fixture.questionData.endTime + 1n)
		const depositHash = await depositWallet(QuestionOutcome.Yes, reportBond)
		const receipt = await client.getTransactionReceipt({ hash: depositHash })
		const factory = getInfraContractAddresses().securityPoolFactory
		const factoryLogs = await getContractReplayLogs(factory, statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi, 0n, receipt.blockNumber)
		const deploymentLogs = factoryLogs.filter(log => {
			const deployedPool = log.args['securityPool']
			return log.eventName === 'DeploySecurityPool' && typeof deployedPool === 'string' && deployedPool.toLowerCase() === securityPoolAddresses.securityPool.toLowerCase()
		})
		const receiptLogs = (
			await Promise.all([getContractReplayLogs(securityPoolAddresses.securityPool, statoblast_SecurityPool_SecurityPool.abi, receipt.blockNumber, receipt.blockNumber), getContractReplayLogs(securityPoolAddresses.escalationGame, statoblast_EscalationGame_EscalationGame.abi, receipt.blockNumber, receipt.blockNumber)])
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

	test('actual ordinary settlement replays global losing retirement without synthetic per-deposit cleanup', async () => {
		const fromBlock = (await client.getBlockNumber()) + 1n
		const pool = securityPoolAddresses.securityPool
		const game = securityPoolAddresses.escalationGame
		const abi = statoblast_EscalationGame_EscalationGame.abi
		await mockWindow.setTime(fixture.questionData.endTime + 1n)
		for (const [outcome, principal] of [
			[0, ordinaryEscalationPrincipals.lowLosingPrincipal],
			[2, ordinaryEscalationPrincipals.bindingLosingPrincipal],
			[1, ordinaryEscalationPrincipals.winningPrincipal],
		] as const)
			await depositWallet(outcome, principal)
		await advancePastOrdinaryEscalationDeadline(client, mockWindow, pool)
		const settlement = await writeContractAndWait(client, () => client.writeContract({ abi, address: game, functionName: 'settleOrdinaryGame' }))
		const checkpointBlock = await client.getBlockNumber()
		const logs = await getContractReplayLogs(game, abi, fromBlock, checkpointBlock)
		const checkpointLogs = logs.filter(log => log.transactionHash === settlement)
		expect(checkpointLogs.filter(log => log.eventName === 'OrdinarySettlementInitialized')).toHaveLength(1)
		expect(checkpointLogs.some(log => log.eventName === 'CarryDepositConsumed' || log.eventName === 'VaultEscrowUpdated')).toBe(false)
		const replayed = replayZoltarEvents(logs)
		expect(replayed.escalationTotalEscrowedRep.get(game)).toBe(ordinaryEscalationPrincipals.winningPrincipal)
		expect(replayed.escalationVaultEscrowedRep.get(game)?.get(client.account.address)).toBe(ordinaryEscalationPrincipals.winningPrincipal)
		expect(replayed.escalationLocalUnresolvedByVault.get(game)?.get(client.account.address)).toEqual([0n, ordinaryEscalationPrincipals.winningPrincipal, 0n])
		const snapshot = await client.readContract({ abi, address: game, functionName: 'getForkCarrySnapshot' })
		expect(replayed.escalationCarryRoots.get(game)).toEqual([...(await client.readContract({ abi, address: game, functionName: 'getForkCarryRoots' }))])
		expect(replayed.escalationLeafCounts.get(game)).toEqual([...snapshot[1]])
		expect(replayed.escalationUnresolvedTotals.get(game)).toEqual([...snapshot[2]])
		expect(replayed.escalationNullifierRoots.get(game)).toEqual([...snapshot[3]])
		expect(replayed.escalationLifecycles.get(game)?.ordinarySettlementOutcome).toBe(BigInt(QuestionOutcome.Yes))
		expect(replayed.escalationLifecycles.get(game)?.ordinaryWinningReserveAttoRep).toBe(await client.readContract({ abi, address: game, functionName: 'ordinaryWinningReserveAttoRep' }))
		expect(replayed.escalationConsumptions.get(game)?.size ?? 0).toBe(0)
		expect(replayed.escalationDeposits.get(game)?.get('0:0')?.consumed).toBe(false)
		await withdrawFromEscalationGame(client, pool, QuestionOutcome.Yes, [0n])
		const afterClaim = replayZoltarEvents(await getContractReplayLogs(game, abi, fromBlock, await client.getBlockNumber()))
		expect(afterClaim.escalationTotalEscrowedRep.get(game)).toBe(0n)
		expect(afterClaim.escalationUnresolvedTotals.get(game)).toEqual([0n, 0n, 0n])
		expect(afterClaim.escalationConsumptions.get(game)?.size).toBe(1)
		expect(afterClaim.escalationLifecycles.get(game)?.ordinaryWinningReserveAttoRep).toBe(0n)
	})

	test('actual child continuation replays its inherited carry checkpoint and storage', async () => {
		const fromBlock = (await client.getBlockNumber()) + 1n
		await mockWindow.setTime(fixture.questionData.endTime + 1n)
		await depositWallet(QuestionOutcome.Yes, reportBond)
		const { childUniverseId, childDeploymentHash } = await activateChild('event replay child continuation')
		const receipt = await client.getTransactionReceipt({ hash: childDeploymentHash })
		const initializedAtBlock = await client.getBlockNumber()
		const child = portfolioFixture.poolFor(fixture.questionId, childUniverseId, securityPoolAddresses.securityPool)
		const factory = getInfraContractAddresses().securityPoolFactory
		const forker = getInfraContractAddresses().securityPoolForker
		const factoryLogs = await getContractReplayLogs(factory, statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi, 0n, initializedAtBlock)
		const canonicalPools = new Set([securityPoolAddresses.securityPool.toLowerCase(), child.securityPool.toLowerCase()])
		const deploymentLogs = factoryLogs.filter(log => {
			const deployedPool = log.args['securityPool']
			return log.eventName === 'DeploySecurityPool' && typeof deployedPool === 'string' && canonicalPools.has(deployedPool.toLowerCase())
		})
		const [sourcePoolLogs, sourceGameLogs, forkerLogs] = await Promise.all([
			getContractReplayLogs(securityPoolAddresses.securityPool, statoblast_SecurityPool_SecurityPool.abi, fromBlock, initializedAtBlock),
			getContractReplayLogs(securityPoolAddresses.escalationGame, statoblast_EscalationGame_EscalationGame.abi, fromBlock, initializedAtBlock),
			getContractReplayLogs(forker, statoblast_SecurityPoolForker_SecurityPoolForker.abi, fromBlock, initializedAtBlock),
		])
		const receiptLogs = (await Promise.all([getContractReplayLogs(child.securityPool, statoblast_SecurityPool_SecurityPool.abi, receipt.blockNumber, initializedAtBlock), getContractReplayLogs(child.escalationGame, statoblast_EscalationGame_EscalationGame.abi, receipt.blockNumber, initializedAtBlock)])).flat()
		const continued = receiptLogs.find(log => log.eventName === 'GameContinuedFromFork')
		const carryCheckpoint = receiptLogs.find(log => log.eventName === 'ForkCarryCheckpoint')
		const gameSet = receiptLogs.find(log => log.eventName === 'EscalationGameSet')
		if (deploymentLogs.length !== 2 || continued === undefined || carryCheckpoint === undefined || gameSet === undefined) {
			throw new Error('child continuation is missing deployment, carry, or discovery events')
		}
		if (continued.logIndex >= gameSet.logIndex) throw new Error('child continuation event did not precede pool relationship event')
		if (carryCheckpoint.transactionHash === childDeploymentHash) throw new Error('carry checkpoint must follow bounded initialization in a separate transaction')
		expect(receiptLogs.find(log => log.eventName === 'SystemStateSet')?.args['systemState']).toBe(0n)

		const replayed = replayZoltarEvents([...deploymentLogs, ...sourcePoolLogs, ...sourceGameLogs, ...forkerLogs, ...receiptLogs], new Set(), new Set([factory]))
		const deployment = replayed.poolDeployments.get(child.securityPool)
		if (deployment === undefined) throw new Error('child pool deployment replay missing')
		const [storedStatoblastSecurityMultiplierBps, storedPriorityFee, storedCollateral, storedSystemState, storedCarryRoots, storedCarrySnapshot] = await Promise.all([
			client.readContract({ address: child.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'statoblastSecurityMultiplierBps', args: [] }),
			client.readContract({
				address: child.openOraclePriceCoordinator,
				abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				functionName: 'initialReportPriorityFeeAttoEthPerGas',
				args: [],
			}),
			client.readContract({ address: child.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'settlementCollateralAttoEth', args: [] }),
			client.readContract({ address: child.securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'systemState', args: [] }),
			client.readContract({ address: child.escalationGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'getForkCarryRoots', args: [] }),
			client.readContract({ address: child.escalationGame, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'getForkCarrySnapshot', args: [] }),
		])
		const storedOutcomeStates = await Promise.all(
			([0, 1, 2] as const).map(
				async outcome =>
					await client.readContract({
						address: child.escalationGame,
						abi: statoblast_EscalationGame_EscalationGame.abi,
						functionName: 'getOutcomeState',
						args: [outcome],
					}),
			),
		)
		strictEqualTypeSafe(deployment.factory, factory, 'child factory replay mismatch')
		strictEqualTypeSafe(deployment.parent, securityPoolAddresses.securityPool, 'child parent replay mismatch')
		strictEqualTypeSafe(deployment.universeId, childUniverseId, 'child universe replay mismatch')
		strictEqualTypeSafe(deployment.questionId, fixture.questionId, 'child question replay mismatch')
		strictEqualTypeSafe(deployment.collateralRepairAuction, child.collateralRepairAuction, 'child auction replay mismatch')
		strictEqualTypeSafe(deployment.coordinator, child.openOraclePriceCoordinator, 'child coordinator replay mismatch')
		strictEqualTypeSafe(deployment.shareToken, child.shareToken, 'child share token replay mismatch')
		strictEqualTypeSafe(deployment.statoblastSecurityMultiplierBps, storedStatoblastSecurityMultiplierBps, 'child security multiplier replay mismatch')
		strictEqualTypeSafe(deployment.initialReportPriorityFeeAttoEthPerGas, storedPriorityFee, 'child priority fee replay mismatch')
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
		await depositWallet(QuestionOutcome.Yes, reportBond)
		await activateChild('event replay universe state source')
		const toBlock = await client.getBlockNumber()
		const replayLogs = await getContractReplayLogs(getZoltarAddress(), Zoltar_Zoltar.abi, 0n, toBlock)
		const replayed = replayZoltarEvents(replayLogs)
		const universeId = fixture.genesisUniverse.toString()
		const replayedParent = replayed.universes.get(universeId)
		const replayedFork = replayed.universeForks.get(universeId)
		if (replayedParent === undefined || replayedFork === undefined) throw new Error('parent universe replay state missing')
		const childUniverseId = getChildUniverseId(fixture.genesisUniverse, QuestionOutcome.Yes)
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
})
