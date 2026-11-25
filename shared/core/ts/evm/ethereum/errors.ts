import type { Hash } from './types.js'

export class RpcError extends Error {
	code?: number | string | undefined
	override cause?: unknown
	shortMessage?: string | undefined

	constructor(message: string, options: { cause?: unknown; code?: number | string | undefined; shortMessage?: string | undefined } = {}) {
		super(message)
		this.name = 'RpcError'
		this.code = options.code
		this.cause = options.cause
		this.shortMessage = options.shortMessage
	}
}

export class TransactionLookupNotFoundError extends RpcError {
	constructor(
		readonly kind: 'transaction' | 'receipt',
		readonly hash: Hash,
		cause?: Error,
	) {
		super(cause?.message ?? `Transaction${kind === 'receipt' ? ' receipt' : ''} with hash "${hash}" could not be found.`, { cause, code: cause instanceof RpcError ? cause.code : undefined, shortMessage: cause instanceof RpcError ? cause.shortMessage : undefined })
		this.name = 'TransactionLookupNotFoundError'
	}
}

export class ContractFunctionError extends Error {
	constructor(name: 'ContractFunctionRevertedError' | 'ContractFunctionZeroDataError', message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause })
		this.name = name
	}
}
