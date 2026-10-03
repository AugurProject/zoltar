import { requestRpc, type PublicClient } from '../ethereum.ts'

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

export const transactionCallTrace = async (client: PublicClient, hash: string): Promise<Record<string, unknown>> => {
	const response = await requestRpc<unknown>(client.transport, { method: 'debug_traceTransaction', params: [hash, { tracer: 'callTracer', timeout: '15s' }] })
	if (!record(response)) throw new Error('Transaction call trace response is not an object')
	return response
}

export const unsupportedTraceError = (error: unknown): boolean => {
	const seen = new Set<unknown>()
	let current = error
	while (record(current) && !seen.has(current)) {
		seen.add(current)
		if (current['code'] === -32601 || current['code'] === -32004) return true
		if (typeof current['message'] === 'string' && /method not found|method.*(?:not supported|not available|does not exist|not enabled)|unsupported.*(?:method|tracer)|unauthorized|forbidden/i.test(current['message'])) return true
		current = current['cause']
	}
	return false
}

export const traceParticipants = (receipt: unknown): readonly string[] => {
	const addresses = new Set<string>()
	const visit = (call: unknown) => {
		if (!record(call)) return
		for (const key of ['from', 'to']) {
			const address = call[key]
			if (typeof address === 'string' && /^0x[\da-f]{40}$/i.test(address)) addresses.add(address.toLowerCase())
		}
		if (Array.isArray(call['calls'])) for (const child of call['calls']) visit(child)
	}
	if (record(receipt)) visit(receipt['callTrace'])
	return [...addresses]
}
