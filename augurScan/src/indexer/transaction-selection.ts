import { requestRpc, type PublicClient } from '../ethereum.ts'

export const protocolCallDestination = (contract: { kind: string } | undefined): boolean => contract !== undefined && !['weth', 'usdc', 'multicall3', 'proxyDeployer', 'uniswapV2Factory', 'uniswapV3Factory', 'uniswapV4PoolManager', 'uniswapV2Pair', 'uniswapV3Pool'].includes(contract.kind)

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

export const relevantCallTrace = (value: unknown, targets: ReadonlySet<string>): boolean => {
	if (!record(value)) return false
	if (typeof value['to'] === 'string' && targets.has(value['to'].toLowerCase())) return true
	if (typeof value['from'] === 'string' && targets.has(value['from'].toLowerCase())) return true
	return Array.isArray(value['calls']) && value['calls'].some(call => relevantCallTrace(call, targets))
}

export const blockCallTraces = async (client: PublicClient, blockHash: string): Promise<readonly { hash: string; trace: Record<string, unknown> }[]> => {
	const response = await requestRpc<unknown>(client.transport, { method: 'debug_traceBlockByHash', params: [blockHash, { tracer: 'callTracer', timeout: '15s' }] })
	if (!Array.isArray(response)) throw new Error('Block call trace response is not an array')
	return response.map(item => {
		if (!record(item) || typeof item['txHash'] !== 'string' || !/^0x[\da-f]{64}$/i.test(item['txHash']) || !record(item['result'])) throw new Error('Block call trace is missing its transaction hash or result')
		return { hash: item['txHash'].toLowerCase(), trace: item['result'] }
	})
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
