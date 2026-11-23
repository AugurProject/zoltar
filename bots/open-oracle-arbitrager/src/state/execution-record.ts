import type { Address, Hex } from '@zoltar/bot-shared/ethereum'
import { isPlainRecord } from '@zoltar/core-shared/validation/guards'

export type ExecutionIntent = {
	/** Symbol of a non-WETH report collateral; `requiredWeth` is then an amount of that token. */
	collateralSymbol?: string | undefined
	direction: 'buy-rep' | 'sell-rep'
	estimatedNetProfitWeth: string
	estimatedProfitBeforeGasEth: string
	pool: Address
	poolFee: number
	reportId: string
	requiredToken: string
	requiredWeth: string
	token: Address
	tokenSymbol: string
}

export type ExecutionRecord = ExecutionIntent & {
	actualGasCostEth: string
	blockNumber: string
	executedAt: string
	trackedNetProfitEth: string
	transactionHash: Hex
}

const decimal = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/
const integer = /^(?:0|[1-9]\d*)$/

const isExecutionAddress = (value: unknown): value is Address => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
const isTransactionHash = (value: unknown): value is Hex => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)

export function parseExecutionIntentFields(record: Record<string, unknown>): ExecutionIntent | undefined {
	if (
		(record['direction'] !== 'buy-rep' && record['direction'] !== 'sell-rep') ||
		typeof record['estimatedNetProfitWeth'] !== 'string' ||
		!decimal.test(record['estimatedNetProfitWeth']) ||
		typeof record['estimatedProfitBeforeGasEth'] !== 'string' ||
		!decimal.test(record['estimatedProfitBeforeGasEth']) ||
		!isExecutionAddress(record['pool']) ||
		typeof record['poolFee'] !== 'number' ||
		!Number.isSafeInteger(record['poolFee']) ||
		record['poolFee'] < 0 ||
		typeof record['reportId'] !== 'string' ||
		!integer.test(record['reportId']) ||
		typeof record['requiredToken'] !== 'string' ||
		!decimal.test(record['requiredToken']) ||
		typeof record['requiredWeth'] !== 'string' ||
		!decimal.test(record['requiredWeth']) ||
		!isExecutionAddress(record['token']) ||
		typeof record['tokenSymbol'] !== 'string' ||
		record['tokenSymbol'].length === 0 ||
		(record['collateralSymbol'] !== undefined && (typeof record['collateralSymbol'] !== 'string' || record['collateralSymbol'].length === 0))
	)
		return undefined
	return {
		...(record['collateralSymbol'] === undefined ? {} : { collateralSymbol: record['collateralSymbol'] }),
		direction: record['direction'],
		estimatedNetProfitWeth: record['estimatedNetProfitWeth'],
		estimatedProfitBeforeGasEth: record['estimatedProfitBeforeGasEth'],
		pool: record['pool'],
		poolFee: record['poolFee'],
		reportId: record['reportId'],
		requiredToken: record['requiredToken'],
		requiredWeth: record['requiredWeth'],
		token: record['token'],
		tokenSymbol: record['tokenSymbol'],
	}
}

/** Validates one journaled dispute execution record; every execution field is required so a partial line never becomes history. */
export function parseExecutionRecord(value: unknown): ExecutionRecord | undefined {
	if (!isPlainRecord(value)) return undefined
	const intent = parseExecutionIntentFields(value)
	if (
		intent === undefined ||
		typeof value['actualGasCostEth'] !== 'string' ||
		!decimal.test(value['actualGasCostEth']) ||
		typeof value['blockNumber'] !== 'string' ||
		!integer.test(value['blockNumber']) ||
		typeof value['executedAt'] !== 'string' ||
		!Number.isFinite(Date.parse(value['executedAt'])) ||
		typeof value['trackedNetProfitEth'] !== 'string' ||
		!decimal.test(value['trackedNetProfitEth'].replace(/^-/, '')) ||
		!isTransactionHash(value['transactionHash'])
	)
		return undefined
	return {
		...intent,
		actualGasCostEth: value['actualGasCostEth'],
		blockNumber: value['blockNumber'],
		executedAt: value['executedAt'],
		trackedNetProfitEth: value['trackedNetProfitEth'],
		transactionHash: value['transactionHash'],
	}
}
