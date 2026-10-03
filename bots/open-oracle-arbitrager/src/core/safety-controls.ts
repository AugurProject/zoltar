import { MAX_PRIORITY_FEE_PER_GAS } from '@zoltar/bot-shared/execution/transaction-submission'
import { parseDecimalAmount } from '@zoltar/bot-shared/infrastructure/json-validation'

const parseDecimalWeth = (value: string) => parseDecimalAmount(value, 'WETH amount')

export type RiskLimits = {
	lifecycleGasReserveAttoWeth: bigint
	maxConcurrentPositions: number
	maxDailyGasSpendAttoWeth: bigint
	maxPositionNotionalAttoWeth: bigint
	maxTotalLockedAttoWeth: bigint
}

export function positionConsumesRisk(status: string) {
	return status !== 'closed' && status !== 'expired-not-included'
}

export function adjustedNetProfitWeth(parameters: { entryGasCostAttoWeth: bigint; hedgeSlippageReserveAttoWeth: bigint; lifecycleGasReserveAttoWeth: bigint; profitBeforeGasAttoWeth: bigint }) {
	return parameters.profitBeforeGasAttoWeth - parameters.entryGasCostAttoWeth - parameters.hedgeSlippageReserveAttoWeth - parameters.lifecycleGasReserveAttoWeth
}

/**
 * Gas price used to plan entry and lifecycle costs. Doubling the base fee covers the one-block ceiling the dispute is signed
 * with (base fee plus one 12.5% increase plus the shared priority fee) and leaves headroom for lifecycle transactions signed
 * later at a then-current base fee. No operator cap applies: the settlement fee cap bounds only settlement submissions.
 */
export function plannedGasPriceAttoEth(baseFeePerGas: bigint) {
	return baseFeePerGas * 2n + MAX_PRIORITY_FEE_PER_GAS
}

export function projectedLifecycleGasReserveAttoWeth(parameters: { callbackGasLimit: bigint; configuredReserveAttoWeth: bigint; gasPrice: bigint; submissionMode: 'private' | 'public' }) {
	const transactionPlanGas = parameters.callbackGasLimit + 900_000n
	const projectedGasAttoWeth = parameters.gasPrice * transactionPlanGas
	return projectedGasAttoWeth > parameters.configuredReserveAttoWeth ? projectedGasAttoWeth : parameters.configuredReserveAttoWeth
}

function riskLimitMismatch(
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
		includedAt: string
	}[]
	lifecycleGasCostEth: string
	lifecycleUpdatedAt: string | undefined
	openedAt: string
	status: string
}

export function utcDayGasSpentWeth(positions: readonly Pick<RecordedRiskPosition, 'gasExpenditures'>[], now = new Date()) {
	const day = now.toISOString().slice(0, 10)
	return positions.reduce((total, position) => total + position.gasExpenditures.reduce((positionTotal, expenditure) => positionTotal + (expenditure.includedAt.slice(0, 10) === day ? parseDecimalWeth(expenditure.costEth) : 0n), 0n), 0n)
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
