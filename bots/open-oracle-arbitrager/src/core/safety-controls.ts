function parseDecimalWeth(value: string) {
	if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error(`Invalid WETH amount: ${value}`)
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
}

export type RiskLimits = {
	lifecycleGasReserveAttoWeth: bigint
	maxConcurrentPositions: number
	maxDailyGasSpendAttoWeth: bigint
	maxPositionNotionalAttoWeth: bigint
	maxTotalLockedAttoWeth: bigint
}

export const DEFAULT_RISK_LIMITS = {
	lifecycleGasReserveAttoWeth: 10n ** 16n,
	maxConcurrentPositions: 1,
	maxDailyGasSpendAttoWeth: 5n * 10n ** 16n,
	maxPositionNotionalAttoWeth: 5n * 10n ** 18n,
	maxTotalLockedAttoWeth: 10n * 10n ** 18n,
} satisfies RiskLimits

export function positionConsumesRisk(status: string) {
	return status !== 'closed' && status !== 'expired-not-included'
}

export function adjustedNetProfitWeth(parameters: { entryGasCostAttoWeth: bigint; hedgeSlippageReserveAttoWeth: bigint; lifecycleGasReserveAttoWeth: bigint; profitBeforeGasAttoWeth: bigint }) {
	return parameters.profitBeforeGasAttoWeth - parameters.entryGasCostAttoWeth - parameters.hedgeSlippageReserveAttoWeth - parameters.lifecycleGasReserveAttoWeth
}

export function projectedLifecycleGasReserveAttoWeth(parameters: { callbackGasLimit: bigint; configuredReserveAttoWeth: bigint; gasPrice: bigint; submissionMode: 'private' | 'public' }) {
	const transactionPlanGas = parameters.callbackGasLimit + 900_000n
	const projectedGasAttoWeth = parameters.gasPrice * transactionPlanGas
	return projectedGasAttoWeth > parameters.configuredReserveAttoWeth ? projectedGasAttoWeth : parameters.configuredReserveAttoWeth
}

export function riskLimitMismatch(
	exposure: {
		capitalAtRiskAttoWeth: bigint
		concurrentPositions: number
		dailyGasSpentAttoWeth: bigint
		projectedLockedAttoWeth: bigint
	},
	limits: RiskLimits,
) {
	if (exposure.concurrentPositions >= limits.maxConcurrentPositions) return 'Maximum concurrent position limit reached'
	if (exposure.capitalAtRiskAttoWeth > limits.maxPositionNotionalAttoWeth) return 'Maximum position notional exceeded'
	if (exposure.projectedLockedAttoWeth > limits.maxTotalLockedAttoWeth) return 'Maximum total locked capital exceeded'
	if (exposure.dailyGasSpentAttoWeth > limits.maxDailyGasSpendAttoWeth) return 'Maximum UTC-day gas spend budget exceeded'
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
		archivedDailyGasSpentAttoWeth?: bigint
		capitalAtRiskAttoWeth: bigint
		positions: readonly RecordedRiskPosition[]
		projectedGasCostAttoWeth: bigint
	},
	limits: RiskLimits,
	now = new Date(),
) {
	const openPositions = parameters.positions.filter(position => positionConsumesRisk(position.status))
	const lockedAttoWeth = openPositions.reduce((total, position) => total + parseDecimalWeth(position.capitalAtRiskWeth), 0n)
	const dailyGasSpentAttoWeth = utcDayGasSpentWeth(parameters.positions, now) + (parameters.archivedDailyGasSpentAttoWeth ?? 0n)
	return riskLimitMismatch(
		{
			capitalAtRiskAttoWeth: parameters.capitalAtRiskAttoWeth,
			concurrentPositions: openPositions.length,
			dailyGasSpentAttoWeth: dailyGasSpentAttoWeth + parameters.projectedGasCostAttoWeth,
			projectedLockedAttoWeth: lockedAttoWeth + parameters.capitalAtRiskAttoWeth,
		},
		limits,
	)
}
