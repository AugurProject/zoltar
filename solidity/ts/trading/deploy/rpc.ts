import { isRecord } from './manifest'

export function parseRpcResponse(payload: unknown, method: string) {
	if (!isRecord(payload)) throw new Error(`${method} returned malformed JSON-RPC data`)
	const hasResult = Object.prototype.hasOwnProperty.call(payload, 'result')
	const hasError = Object.prototype.hasOwnProperty.call(payload, 'error')
	if (payload.jsonrpc !== '2.0' || payload.id !== 1 || hasResult === hasError) throw new Error(`${method} returned malformed JSON-RPC data`)
	if (hasError) {
		const error = payload.error
		if (!isRecord(error) || typeof error.code !== 'number' || !Number.isInteger(error.code) || typeof error.message !== 'string') throw new Error(`${method} returned malformed JSON-RPC error data`)
		throw new Error(`${method}: ${error.message}`)
	}
	return payload.result
}
