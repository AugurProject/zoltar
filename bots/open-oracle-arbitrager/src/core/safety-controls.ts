function parseDecimalWeth(value: string) {
	if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error(`Invalid WETH amount: ${value}`)
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
}

export type RiskLimits = {
	lifecycleGasReserveWethAttoEth: bigint
	maxConcurrentPositions: number
	maxDailyGasSpendWethAttoEth: bigint
	maxPositionNotionalWethAttoEth: bigint
	maxTotalLockedWethAttoEth: bigint
}

export const DEFAULT_RISK_LIMITS = {
	lifecycleGasReserveWethAttoEth: 10n ** 16n,
	maxConcurrentPositions: 1,
	maxDailyGasSpendWethAttoEth: 5n * 10n ** 16n,
	maxPositionNotionalWethAttoEth: 5n * 10n ** 18n,
	maxTotalLockedWethAttoEth: 10n * 10n ** 18n,
} satisfies RiskLimits

export function positionConsumesRisk(status: string) {
	return status !== 'closed' && status !== 'expired-not-included'
}

export function adjustedNetProfitWeth(parameters: { entryGasCostWethAttoEth: bigint; hedgeSlippageReserveWethAttoEth: bigint; lifecycleGasReserveWethAttoEth: bigint; profitBeforeGasWethAttoEth: bigint }) {
	return parameters.profitBeforeGasWethAttoEth - parameters.entryGasCostWethAttoEth - parameters.hedgeSlippageReserveWethAttoEth - parameters.lifecycleGasReserveWethAttoEth
}

export function projectedLifecycleGasReserveWethAttoEth(parameters: { callbackGasLimit: bigint; configuredReserveWethAttoEth: bigint; gasPrice: bigint; submissionMode: 'private' | 'public' }) {
	const transactionPlanGas = parameters.callbackGasLimit + 900_000n
	const projectedGasWethAttoEth = parameters.gasPrice * transactionPlanGas
	return projectedGasWethAttoEth > parameters.configuredReserveWethAttoEth ? projectedGasWethAttoEth : parameters.configuredReserveWethAttoEth
}

export function riskLimitMismatch(
	exposure: {
		capitalAtRiskWethAttoEth: bigint
		concurrentPositions: number
		dailyGasSpentWethAttoEth: bigint
		projectedLockedWethAttoEth: bigint
	},
	limits: RiskLimits,
) {
	if (exposure.concurrentPositions >= limits.maxConcurrentPositions) return 'Maximum concurrent position limit reached'
	if (exposure.capitalAtRiskWethAttoEth > limits.maxPositionNotionalWethAttoEth) return 'Maximum position notional exceeded'
	if (exposure.projectedLockedWethAttoEth > limits.maxTotalLockedWethAttoEth) return 'Maximum total locked capital exceeded'
	if (exposure.dailyGasSpentWethAttoEth > limits.maxDailyGasSpendWethAttoEth) return 'Maximum UTC-day gas spend budget exceeded'
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
		capitalAtRiskWethAttoEth: bigint
		positions: readonly RecordedRiskPosition[]
		projectedGasCostWethAttoEth: bigint
	},
	limits: RiskLimits,
	now = new Date(),
) {
	const openPositions = parameters.positions.filter(position => positionConsumesRisk(position.status))
	const lockedWeth = openPositions.reduce((total, position) => total + parseDecimalWeth(position.capitalAtRiskWeth), 0n)
	const dailyGasSpentWethAttoEth = utcDayGasSpentWeth(parameters.positions, now)
	return riskLimitMismatch(
		{
			capitalAtRiskWethAttoEth: parameters.capitalAtRiskWethAttoEth,
			concurrentPositions: openPositions.length,
			dailyGasSpentWethAttoEth: dailyGasSpentWethAttoEth + parameters.projectedGasCostWethAttoEth,
			projectedLockedWethAttoEth: lockedWeth + parameters.capitalAtRiskWethAttoEth,
		},
		limits,
	)
}
