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
