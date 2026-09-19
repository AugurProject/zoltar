import type { Configuration } from '#config/configuration'
import type { CoordinatorGamePolicy } from '#core/game-policy'
import type { ReadClient, WriteClient } from '#core/operator-types'
import { rewardWithdrawalDecision } from '#core/settlement-strategy'
import { selectSettlementPlan, settlementQueue } from '#core/settlement-queue'
import { executeRewardWithdrawal, executeSettlement, reconcilePendingSettlements, unclaimedSettlementReward, type SettlementExecutionContext } from '#execution/settlement-execution'
import type { TrackTransaction } from '#execution/transaction-tracker'
import type { ActiveReport } from '#monitoring/oracle-log-state'
import { recordOperation, type OperatorState } from '#state/operator-state'
import { appendSettlementRecord, loadSettlementJournal, mergeSettlementRecord, settlementAttemptMayStillLand, settlementGasSpentAttoEthOnUtcDay, settlementJournalPath, settlementSnapshot, type RewardWithdrawalDecision, type SettlementCandidateSnapshot, type SettlementRecord } from '#state/settlement-store'
import { isExecutionPausedError } from '#execution/execution-orchestration'
import { dateFromBlockTimestamp } from '#execution/recovery-support'
import type { Address } from '@zoltar/bot-shared/ethereum'
import { errorMessage } from '@zoltar/bot-shared/infrastructure/error-message'
import { operationalFailureDisposition } from '@zoltar/bot-shared/monitoring/resilience'

/**
 * Owns the settlement journal for the operator process and keeps the dashboard snapshot in sync with it. The chain id and
 * path are read at every append because queued network initialization replaces `config.network` while the process runs.
 */
export async function createSettlementJournal(config: Pick<Configuration, 'positionFile' | 'settlement'> & { network: Pick<Configuration['network'], 'chain'> }, state: Pick<OperatorState, 'blockTimestamp' | 'settlements'>) {
	const path = () => settlementJournalPath(config.positionFile)
	const chainId = () => config.network.chain.id
	let records = await loadSettlementJournal(path(), chainId())
	let unclaimedRewardAttoEth: bigint | undefined
	let withdrawalDecision: RewardWithdrawalDecision = 'unavailable'
	const publish = (queue: readonly SettlementCandidateSnapshot[] = state.settlements.queue) => {
		const now = state.blockTimestamp === undefined ? new Date() : dateFromBlockTimestamp(BigInt(state.blockTimestamp))
		state.settlements = settlementSnapshot({ now, queue, records, settings: config.settlement, unclaimedRewardAttoEth, withdrawalDecision })
	}
	publish([])
	return {
		persist: async (record: SettlementRecord) => {
			await appendSettlementRecord(path(), record, chainId())
			records = mergeSettlementRecord(records, record)
			publish()
		},
		publish,
		get records() {
			return records
		},
		/** Rereads the journal for the chain the operator now targets. */
		reload: async () => {
			records = await loadSettlementJournal(path(), chainId())
			unclaimedRewardAttoEth = undefined
			withdrawalDecision = 'unavailable'
			publish([])
		},
		setUnclaimedReward: (value: bigint | undefined, decision: RewardWithdrawalDecision) => {
			unclaimedRewardAttoEth = value
			withdrawalDecision = decision
			publish()
		},
		get unclaimedRewardAttoEth() {
			return unclaimedRewardAttoEth
		},
	}
}

type SettlementJournal = Awaited<ReturnType<typeof createSettlementJournal>>

export type SettlementStageConfiguration = Pick<Configuration, 'connectivity' | 'execute' | 'openOracle' | 'pollMilliseconds' | 'quorumRpcUrls' | 'riskLimits' | 'settlement' | 'submission'> & { network: Pick<Configuration['network'], 'chain'> }

type SettlementStageParameters = {
	block: { baseFeePerGas: bigint; number: bigint; timestamp: bigint }
	client: ReadClient
	config: SettlementStageConfiguration
	coordinatorPolicies: readonly CoordinatorGamePolicy[]
	/** Position gas already counted against today's budget; settlement gas from the journal is added here. */
	dailyPositionGasSpentAttoWeth: bigint
	gasPrice: bigint
	isPaused: () => boolean
	journal: SettlementJournal
	readClients: readonly ReadClient[]
	reports: Iterable<ActiveReport>
	state: Pick<OperatorState, 'blockTimestamp' | 'operationLog' | 'paused' | 'settlements'>
	tokenSymbol: (token: Address) => string | undefined
	track: TrackTransaction
	transactionSlotFree: boolean
	wallet: WriteClient | undefined
}

/**
 * Runs once per successful scan at the pinned head: recovers interrupted attempts, publishes the queue, then spends at
 * most one transaction on the best eligible settlement or, when none is due, on withdrawing accrued rewards.
 */
export async function runSettlementStage(parameters: SettlementStageParameters) {
	const { block, client, config, journal, readClients, state, wallet } = parameters
	const account = wallet?.account.address
	for (const resolved of await reconcilePendingSettlements(readClients, config, journal.records, block.number)) {
		await journal.persist(resolved)
		recordOperation(state, { category: 'transaction', details: `status=${resolved.status}`, level: resolved.status === 'confirmed' ? 'info' : 'warning', message: 'Settlement attempt recovered', reason: `Transaction ${resolved.transactionHash}`, reportId: resolved.reportId })
	}
	const dailyGas = { limitAttoWeth: config.riskLimits.maxDailyGasSpendAttoWeth, spentAttoWeth: parameters.dailyPositionGasSpentAttoWeth + settlementGasSpentAttoEthOnUtcDay(journal.records, dateFromBlockTimestamp(block.timestamp)) }
	const unclaimedRewardAttoEth = account === undefined ? undefined : await unclaimedSettlementReward(readClients, config, account, block.number)
	const signerReady = config.execute && wallet !== undefined
	const withdrawalDecision = rewardWithdrawalDecision({
		dailyGas,
		enabled: config.settlement.enabled,
		execute: config.execute,
		gasPrice: parameters.gasPrice,
		inFlight: journal.records.some(record => record.kind === 'reward-withdrawal' && settlementAttemptMayStillLand(record, block.number)),
		paused: state.paused,
		settings: config.settlement,
		signerReady,
		unclaimedRewardAttoEth,
	})
	journal.setUnclaimedReward(unclaimedRewardAttoEth, withdrawalDecision)
	const { plans, queue } = settlementQueue({
		account,
		blockNumber: block.number,
		blockTimestamp: block.timestamp,
		config,
		coordinatorPolicies: parameters.coordinatorPolicies,
		dailyGas,
		gasPrice: parameters.gasPrice,
		paused: state.paused,
		records: journal.records,
		reports: parameters.reports,
		signerReady,
		tokenSymbol: parameters.tokenSymbol,
	})
	journal.publish(queue)
	if (!signerReady || wallet === undefined || !config.settlement.enabled || state.paused || !parameters.transactionSlotFree) return
	const context: SettlementExecutionContext = { baseFeePerGas: block.baseFeePerGas, blockNumber: block.number, client, config, gasPrice: parameters.gasPrice, isPaused: parameters.isPaused, persist: journal.persist, readClients, track: parameters.track, wallet }
	const plan = selectSettlementPlan(plans)
	const candidate = plan === undefined ? undefined : queue.find(entry => entry.reportId === plan.report.helper.reportId.toString())
	if (plan !== undefined && candidate !== undefined) {
		try {
			const record = await executeSettlement(context, plan)
			candidate.decision = record.status === 'confirmed' ? 'settled' : 'execution-failed'
			recordOperation(state, {
				category: 'transaction',
				details: `reward=${record.rewardEth} ETH gas=${record.actualGasCostEth ?? 'unknown'} ETH`,
				level: record.status === 'confirmed' ? 'info' : 'error',
				message: record.status === 'confirmed' ? 'Third-party settlement confirmed' : 'Third-party settlement reverted',
				reason: `Report ${candidate.reportId} settled for coordinator ${plan.coordinator}`,
				reportId: candidate.reportId,
			})
		} catch (error) {
			if (operationalFailureDisposition(error) === 'connectivity-degraded') throw error
			if (isExecutionPausedError(error)) candidate.decision = 'paused'
			else {
				candidate.decision = 'execution-failed'
				recordOperation(state, { category: 'transaction', details: undefined, level: 'warning', message: 'Third-party settlement skipped', reason: errorMessage(error), reportId: candidate.reportId })
			}
		}
		journal.publish(queue)
		return
	}
	if (withdrawalDecision !== 'due' || unclaimedRewardAttoEth === undefined) return
	try {
		const record = await executeRewardWithdrawal(context, unclaimedRewardAttoEth)
		// The snapshot reflects the withdrawal immediately instead of advertising the pre-withdrawal balance until the next scan.
		journal.setUnclaimedReward(record.status === 'confirmed' ? 0n : unclaimedRewardAttoEth, record.status === 'confirmed' ? 'below-threshold' : 'in-flight')
		recordOperation(state, {
			category: 'transaction',
			details: `withdrawn=${record.rewardEth} ETH gas=${record.actualGasCostEth ?? 'unknown'} ETH`,
			level: record.status === 'confirmed' ? 'info' : 'error',
			message: record.status === 'confirmed' ? 'Settlement rewards withdrawn' : 'Settlement reward withdrawal reverted',
			reason: `Transaction ${record.transactionHash}`,
			reportId: undefined,
		})
	} catch (error) {
		if (operationalFailureDisposition(error) === 'connectivity-degraded') throw error
		journal.setUnclaimedReward(unclaimedRewardAttoEth, 'in-flight')
		// A pause or shutdown mid-flight leaves the pending record for the next scan's receipt recovery, like the settle branch.
		if (isExecutionPausedError(error)) return
		recordOperation(state, { category: 'transaction', details: undefined, level: 'warning', message: 'Settlement reward withdrawal skipped', reason: errorMessage(error), reportId: undefined })
	}
}
