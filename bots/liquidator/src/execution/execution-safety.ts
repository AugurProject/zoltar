import type { finalizedReceiptWithQuorum } from '#execution/recovery'
import { type RuntimeState } from '#state/operator-state'
import { type Hex } from '@zoltar/bot-shared/ethereum'
import { maximumFeePerGas, paddedTransactionGas } from '@zoltar/bot-shared/execution/transaction-submission'

const shutdownChecks = new WeakMap<object, () => boolean>()

export class TransactionAwaitingCanonicalFinality extends Error {
	readonly hash: Hex

	constructor(label: string, hash: Hex) {
		super(`${label} transaction ${hash} is awaiting canonical finality`)
		this.name = 'TransactionAwaitingCanonicalFinality'
		this.hash = hash
	}
}

export class OperatorStopping extends Error {
	constructor() {
		super('Operator stopping before transaction submission')
		this.name = 'OperatorStopping'
	}
}

export function requireFinalizedTransactionReceipt(label: string, hash: Hex, result: Awaited<ReturnType<typeof finalizedReceiptWithQuorum>>) {
	if (result.receipt !== undefined) return result.receipt
	if (!result.observed) throw new Error(`${label} receipt disappeared before canonical finality`)
	throw new TransactionAwaitingCanonicalFinality(label, hash)
}

function assertGasCostLimit(gasEstimate: bigint, maxFeePerGas: bigint, maximumGasCost: bigint, label = 'Transaction') {
	if (maxFeePerGas * paddedTransactionGas(gasEstimate) > maximumGasCost) {
		throw new Error(`${label} estimated gas ceiling exceeds strategy.maximumGasCostEth`)
	}
}

export function assertGasCostLimitForBaseFee(gasEstimate: bigint, baseFeePerGas: bigint, maximumGasCost: bigint, label = 'Transaction') {
	assertGasCostLimit(gasEstimate, maximumFeePerGas(baseFeePerGas), maximumGasCost, label)
}

export function assertExecutionActive(state: Pick<RuntimeState, 'paused'>) {
	assertOperatorNotStopping(state)
	if (state.paused) throw new Error('Operator paused before transaction submission')
}

export function assertOperatorNotStopping(state: Pick<RuntimeState, 'paused'>) {
	if (shutdownChecks.get(state)?.() ?? false) throw new OperatorStopping()
}

export function setExecutionShutdownCheck(state: RuntimeState, isRequested: () => boolean) {
	shutdownChecks.set(state, isRequested)
}
