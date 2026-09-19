import type { Address, Hex } from '@zoltar/bot-shared/ethereum'

export type ExecutionRecord = {
	actualGasCostEth: string
	blockNumber: string
	direction: 'buy-rep' | 'sell-rep'
	estimatedNetProfitWeth: string
	estimatedProfitBeforeGasEth: string
	executedAt: string
	pool: Address
	poolFee: number
	reportId: string
	requiredToken: string
	requiredWeth: string
	token: Address
	tokenSymbol: string
	trackedNetProfitEth: string
	transactionHash: Hex
}

/** Validates one journaled dispute execution record; every field is required so a partial line never becomes history. */
export function parseExecutionRecord(value: unknown): ExecutionRecord | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
	const record = value as Record<string, unknown>
	const decimal = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/
	if (
		typeof record['actualGasCostEth'] !== 'string' ||
		!decimal.test(record['actualGasCostEth']) ||
		typeof record['blockNumber'] !== 'string' ||
		!/^(?:0|[1-9]\d*)$/.test(record['blockNumber']) ||
		(record['direction'] !== 'buy-rep' && record['direction'] !== 'sell-rep') ||
		typeof record['estimatedNetProfitWeth'] !== 'string' ||
		!decimal.test(record['estimatedNetProfitWeth']) ||
		typeof record['estimatedProfitBeforeGasEth'] !== 'string' ||
		!decimal.test(record['estimatedProfitBeforeGasEth']) ||
		typeof record['executedAt'] !== 'string' ||
		!Number.isFinite(Date.parse(record['executedAt'])) ||
		typeof record['pool'] !== 'string' ||
		!/^0x[0-9a-fA-F]{40}$/.test(record['pool']) ||
		typeof record['poolFee'] !== 'number' ||
		!Number.isSafeInteger(record['poolFee']) ||
		record['poolFee'] < 0 ||
		typeof record['reportId'] !== 'string' ||
		!/^(?:0|[1-9]\d*)$/.test(record['reportId']) ||
		typeof record['requiredToken'] !== 'string' ||
		!decimal.test(record['requiredToken']) ||
		typeof record['requiredWeth'] !== 'string' ||
		!decimal.test(record['requiredWeth']) ||
		typeof record['token'] !== 'string' ||
		!/^0x[0-9a-fA-F]{40}$/.test(record['token']) ||
		typeof record['tokenSymbol'] !== 'string' ||
		record['tokenSymbol'].length === 0 ||
		typeof record['trackedNetProfitEth'] !== 'string' ||
		!decimal.test(record['trackedNetProfitEth'].replace(/^-/, '')) ||
		typeof record['transactionHash'] !== 'string' ||
		!/^0x[0-9a-fA-F]{64}$/.test(record['transactionHash'])
	)
		return undefined
	return {
		actualGasCostEth: record['actualGasCostEth'],
		blockNumber: record['blockNumber'],
		direction: record['direction'],
		estimatedNetProfitWeth: record['estimatedNetProfitWeth'],
		estimatedProfitBeforeGasEth: record['estimatedProfitBeforeGasEth'],
		executedAt: record['executedAt'],
		pool: record['pool'] as Address,
		poolFee: record['poolFee'],
		reportId: record['reportId'],
		requiredToken: record['requiredToken'],
		requiredWeth: record['requiredWeth'],
		token: record['token'] as Address,
		tokenSymbol: record['tokenSymbol'],
		trackedNetProfitEth: record['trackedNetProfitEth'],
		transactionHash: record['transactionHash'] as Hex,
	}
}
