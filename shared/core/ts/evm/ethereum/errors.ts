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

export class ContractFunctionError extends Error {
	constructor(name: 'ContractFunctionRevertedError' | 'ContractFunctionZeroDataError', message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause })
		this.name = name
	}
}
