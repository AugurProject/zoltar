import { parseDecimalWeth } from './operator-state.js'

export type RiskLimits = {
	lifecycleGasReserveWeth: bigint
	maxConcurrentPositions: number
	maxDailyGasSpendWeth: bigint
	maxPositionNotionalWeth: bigint
	maxTotalLockedWeth: bigint
}

export const DEFAULT_RISK_LIMITS = {
	lifecycleGasReserveWeth: 10n ** 16n,
	maxConcurrentPositions: 1,
	maxDailyGasSpendWeth: 5n * 10n ** 16n,
	maxPositionNotionalWeth: 5n * 10n ** 18n,
	maxTotalLockedWeth: 10n * 10n ** 18n,
} satisfies RiskLimits

export function adjustedNetProfitWeth(parameters: { entryGasCostWeth: bigint; hedgeSlippageReserveWeth: bigint; lifecycleGasReserveWeth: bigint; profitBeforeGasWeth: bigint }) {
	return parameters.profitBeforeGasWeth - parameters.entryGasCostWeth - parameters.hedgeSlippageReserveWeth - parameters.lifecycleGasReserveWeth
}

export function riskLimitMismatch(
	exposure: {
		capitalAtRiskWeth: bigint
		concurrentPositions: number
		dailyGasSpentWeth: bigint
		projectedLockedWeth: bigint
	},
	limits: RiskLimits,
) {
	if (exposure.concurrentPositions >= limits.maxConcurrentPositions) return 'Maximum concurrent position limit reached'
	if (exposure.capitalAtRiskWeth > limits.maxPositionNotionalWeth) return 'Maximum position notional exceeded'
	if (exposure.projectedLockedWeth > limits.maxTotalLockedWeth) return 'Maximum total locked capital exceeded'
	if (exposure.dailyGasSpentWeth > limits.maxDailyGasSpendWeth) return 'Maximum daily gas loss budget exceeded'
	return undefined
}

type RecordedRiskPosition = {
	actualEntryGasCostEth: string
	capitalAtRiskWeth: string
	lifecycleGasCostEth: string
	lifecycleUpdatedAt: string | undefined
	openedAt: string
	status: string
}

export function positionRiskLimitMismatch(
	parameters: {
		capitalAtRiskWeth: bigint
		positions: readonly RecordedRiskPosition[]
		projectedGasCostWeth: bigint
	},
	limits: RiskLimits,
	now = new Date(),
) {
	const openPositions = parameters.positions.filter(position => position.status !== 'closed')
	const lockedWeth = openPositions.reduce((total, position) => total + parseDecimalWeth(position.capitalAtRiskWeth), 0n)
	const day = now.toISOString().slice(0, 10)
	const dailyGasSpentWeth = parameters.positions.reduce((total, position) => total + (position.openedAt.slice(0, 10) === day ? parseDecimalWeth(position.actualEntryGasCostEth) : 0n) + (position.lifecycleUpdatedAt?.slice(0, 10) === day ? parseDecimalWeth(position.lifecycleGasCostEth) : 0n), 0n)
	return riskLimitMismatch(
		{
			capitalAtRiskWeth: parameters.capitalAtRiskWeth,
			concurrentPositions: openPositions.length,
			dailyGasSpentWeth: dailyGasSpentWeth + parameters.projectedGasCostWeth,
			projectedLockedWeth: lockedWeth + parameters.capitalAtRiskWeth,
		},
		limits,
	)
}
