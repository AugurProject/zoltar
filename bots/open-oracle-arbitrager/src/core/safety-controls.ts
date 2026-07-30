function parseDecimalWeth(value: string) {
	if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error(`Invalid WETH amount: ${value}`)
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
}

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

export function positionConsumesRisk(status: string) {
	return status !== 'closed' && status !== 'expired-not-included'
}

export function adjustedNetProfitWeth(parameters: { entryGasCostWeth: bigint; hedgeSlippageReserveWeth: bigint; lifecycleGasReserveWeth: bigint; profitBeforeGasWeth: bigint }) {
	return parameters.profitBeforeGasWeth - parameters.entryGasCostWeth - parameters.hedgeSlippageReserveWeth - parameters.lifecycleGasReserveWeth
}

export function projectedLifecycleGasReserveWeth(parameters: { callbackGasLimit: bigint; configuredReserveWeth: bigint; gasPrice: bigint; submissionMode: 'private' | 'public' }) {
	const transactionPlanGas = parameters.callbackGasLimit + 900_000n
	const projectedGasWeth = parameters.gasPrice * transactionPlanGas
	return projectedGasWeth > parameters.configuredReserveWeth ? projectedGasWeth : parameters.configuredReserveWeth
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
	if (exposure.dailyGasSpentWeth > limits.maxDailyGasSpendWeth) return 'Maximum UTC-day gas spend budget exceeded'
	return undefined
}

type RecordedRiskPosition = {
	actualEntryGasCostEth: string
	capitalAtRiskWeth: string
	gasExpenditures: readonly {
		costEth: string
		minedAt: string
	}[]
	lifecycleGasCostEth: string
	lifecycleUpdatedAt: string | undefined
	openedAt: string
	status: string
}

export function utcDayGasSpentWeth(positions: readonly Pick<RecordedRiskPosition, 'gasExpenditures'>[], now = new Date()) {
	const day = now.toISOString().slice(0, 10)
	return positions.reduce((total, position) => total + position.gasExpenditures.reduce((positionTotal, expenditure) => positionTotal + (expenditure.minedAt.slice(0, 10) === day ? parseDecimalWeth(expenditure.costEth) : 0n), 0n), 0n)
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
	const openPositions = parameters.positions.filter(position => positionConsumesRisk(position.status))
	const lockedWeth = openPositions.reduce((total, position) => total + parseDecimalWeth(position.capitalAtRiskWeth), 0n)
	const dailyGasSpentWeth = utcDayGasSpentWeth(parameters.positions, now)
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
