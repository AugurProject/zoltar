import type { Address } from '@zoltar/bot-shared/ethereum'
import type { Configuration } from '#config/configuration'
import { gamePolicyMismatch, type CoordinatorGamePolicy } from '#core/game-policy'
import { settlementDecision, settlementEconomics, settlementEligibilityMismatch, settlementTiming } from '#core/settlement-strategy'
import type { SettlementPlan } from '#execution/settlement-execution'
import type { ActiveReport } from '#monitoring/oracle-log-state'
import { decimalSignedEth, decimalWeth } from '#state/operator-state'
import { settlementAttemptMayStillLand, type SettlementCandidateSnapshot, type SettlementRecord } from '#state/settlement-store'

export type SettlementQueueInput = {
	account: Address | undefined
	blockNumber: bigint
	blockTimestamp: bigint
	config: Pick<Configuration, 'execute' | 'openOracle' | 'settlement'>
	coordinatorPolicies: readonly CoordinatorGamePolicy[]
	/** Gas already spent on the current UTC day by positions and settlements, and the configured daily ceiling. */
	dailyGas: { limitAttoWeth: bigint; spentAttoWeth: bigint }
	gasPrice: bigint
	paused: boolean
	records: readonly SettlementRecord[]
	reports: Iterable<ActiveReport>
	signerReady: boolean
	tokenSymbol: (token: Address) => string | undefined
}

export type SettlementQueue = { plans: Map<string, SettlementPlan>; queue: SettlementCandidateSnapshot[] }

/** Pure candidate selection: every unsettled approved-coordinator report past its window, with the gate that keeps it waiting. */
export function settlementQueue(input: SettlementQueueInput): SettlementQueue {
	const queue: SettlementCandidateSnapshot[] = []
	const plans = new Map<string, SettlementPlan>()
	const inFlightReports = new Set(input.records.filter(record => record.reportId !== undefined && settlementAttemptMayStillLand(record, input.blockNumber)).map(record => record.reportId))
	for (const report of input.reports) {
		const { game, helper } = report.latest
		if (report.settled || gamePolicyMismatch(report.latest, input.coordinatorPolicies, input.config.openOracle) !== undefined) continue
		if (settlementEligibilityMismatch(game, input.blockNumber, input.blockTimestamp, input.account) !== undefined) continue
		const reportId = helper.reportId.toString()
		const economics = settlementEconomics({ callbackGasLimit: game.callbackGasLimit, gasPrice: input.gasPrice, rewardAttoEth: game.settlerRewardAttoEth, settings: input.config.settlement })
		const withinDailyGasBudget = input.dailyGas.spentAttoWeth + economics.projectedGasCostAttoEth <= input.dailyGas.limitAttoWeth
		const decision = settlementDecision({ economics, enabled: input.config.settlement.enabled, execute: input.config.execute, inFlight: inFlightReports.has(reportId), paused: input.paused, signerReady: input.signerReady, withinDailyGasBudget })
		const timing = settlementTiming(game, input.blockNumber, input.blockTimestamp)
		queue.push({
			callbackGasLimit: game.callbackGasLimit.toString(),
			coordinator: helper.creator,
			decision,
			elapsed: timing.elapsed.toString(),
			projectedGasCostEth: decimalWeth(economics.projectedGasCostAttoEth),
			projectedNetEth: decimalSignedEth(economics.netAttoEth),
			reportId,
			rewardEth: decimalWeth(game.settlerRewardAttoEth),
			token: game.token2,
			tokenSymbol: input.tokenSymbol(game.token2) ?? 'token',
			windowUnit: timing.windowUnit,
		})
		if (decision === 'eligible') plans.set(reportId, { coordinator: helper.creator, gas: economics.gas, projectedGasCostAttoEth: economics.projectedGasCostAttoEth, report: report.latest, rewardAttoEth: game.settlerRewardAttoEth, token: game.token2, tokenSymbol: input.tokenSymbol(game.token2) ?? 'token' })
	}
	queue.sort((left, right) => (BigInt(right.reportId) > BigInt(left.reportId) ? 1 : -1))
	return { plans, queue }
}

/** Highest projected net first so one poll spends its single settlement slot on the best report. */
export function selectSettlementPlan(plans: ReadonlyMap<string, SettlementPlan>) {
	let best: SettlementPlan | undefined
	for (const plan of plans.values()) {
		if (best === undefined || plan.rewardAttoEth - plan.projectedGasCostAttoEth > best.rewardAttoEth - best.projectedGasCostAttoEth) best = plan
	}
	return best
}
