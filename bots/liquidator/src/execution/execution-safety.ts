import type { finalizedReceiptWithQuorum } from '#execution/recovery'
import type { RuntimeState } from '#state/operator-state'
import type { Hex } from '@zoltar/bot-shared/ethereum'

const shutdownChecks = new WeakMap<object, () => boolean>()

export class FinalizedTakeoverExpired extends Error {
	override name = 'FinalizedTakeoverExpired'
}

export class TransactionAwaitingCanonicalFinality extends Error {
	readonly hash: Hex

	constructor(label: string, hash: Hex, cause?: unknown) {
		super(`${label} transaction ${hash} is awaiting canonical finality`, { cause })
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
