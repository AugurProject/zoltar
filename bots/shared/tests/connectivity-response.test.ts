import { expect, spyOn, test } from 'bun:test'
import { privateKeyToAccount } from '../src/ethereum.ts'
import { checkPrivateTransactionSubmissionEndpoints, checkPublicTransactionSubmissionEndpoints, checkSubmissionEndpoints, readRpcChainId, validateConnectivitySettings } from '../src/monitoring/connectivity.ts'
import { validateSubmissionSettings } from '../src/execution/transaction-submission.ts'

for (const probe of ['rpc', 'relay', 'public-transaction', 'private-transaction']) {
	for (const cleanup of ['resolve', 'reject', 'pending']) {
		test(`${probe} probe cancels failed HTTP bodies when cleanup is ${cleanup}`, async () => {
			let cancelled = false
			const body = new ReadableStream<Uint8Array>({
				cancel() {
					cancelled = true
					if (cleanup === 'reject') return Promise.reject(new Error('cleanup failed'))
					if (cleanup === 'pending') return new Promise<void>(() => undefined)
					return undefined
				},
			})
			let requests = 0
			const fetchResponse = async () => {
				requests += 1
				if (probe !== 'rpc' && requests === 1) return Response.json({ id: 1, jsonrpc: '2.0', result: '0x1' })
				return new Response(body, { status: 503 })
			}
			fetchResponse.preconnect = globalThis.fetch.preconnect
			const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(fetchResponse)
			try {
				const settings = validateSubmissionSettings({ mode: 'private', relayUrls: ['https://relay.example.test'] })
				const result = (() => {
					if (probe === 'rpc') return readRpcChainId('https://rpc.example.test')
					if (probe === 'public-transaction') return checkPublicTransactionSubmissionEndpoints(['https://rpc.example.test'], 1)
					if (probe === 'private-transaction') return checkPrivateTransactionSubmissionEndpoints(settings, 1, privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'))
					return checkSubmissionEndpoints(settings, 1)
				})()
				await expect(result).rejects.toThrow('HTTP 503')
				if (probe !== 'rpc') await expect(result).rejects.toMatchObject({ checks: [{ status: 'failed', failureDisposition: 'connectivity-degraded' }] })
				expect(cancelled).toBe(true)
			} finally {
				fetchMock.mockRestore()
			}
		})
	}
}

test('#1496: bundle support cannot certify private transaction submission', async () => {
	const respond = async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
		const payload: unknown = JSON.parse(String(init?.body))
		if (typeof payload !== 'object' || payload === null || !('method' in payload)) throw new Error('Missing probe method')
		if (payload.method === 'eth_chainId') return Response.json({ id: 1, jsonrpc: '2.0', result: '0x1' })
		return Response.json({ id: 1, jsonrpc: '2.0', error: payload.method === 'eth_sendPrivateTransaction' ? { code: -32601, message: 'Method not found' } : { code: -32602, message: 'Invalid params' } })
	}
	respond.preconnect = globalThis.fetch.preconnect
	const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(respond)
	try {
		const settings = validateSubmissionSettings({ mode: 'private', relayUrls: ['https://relay.example.test'] })
		await expect(checkSubmissionEndpoints(settings, 1)).rejects.toThrow('eth_sendPrivateTransaction')
	} finally {
		fetchMock.mockRestore()
	}
})

test('arbitrager preflight requires bundle methods as well as private transaction delivery', async () => {
	const respond = async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
		const payload: unknown = JSON.parse(String(init?.body))
		if (typeof payload !== 'object' || payload === null || !('method' in payload)) throw new Error('Missing probe method')
		if (payload.method === 'eth_chainId') return Response.json({ id: 1, jsonrpc: '2.0', result: '0x1' })
		return Response.json({ id: 1, jsonrpc: '2.0', error: payload.method === 'eth_sendPrivateTransaction' ? { code: -32602, message: 'Invalid params' } : { code: -32601, message: 'Method not found' } })
	}
	respond.preconnect = globalThis.fetch.preconnect
	const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(respond)
	try {
		const settings = validateSubmissionSettings({ mode: 'private', relayUrls: ['https://relay.example.test'] })
		await expect(checkSubmissionEndpoints(settings, 1)).rejects.toThrow('eth_callBundle')
		await expect(checkSubmissionEndpoints(settings, 1, ['eth_sendPrivateTransaction'])).resolves.toMatchObject([{ status: 'healthy' }])
	} finally {
		fetchMock.mockRestore()
	}
})

test('accepts only known local node services as non-loopback HTTP RPCs', () => {
	expect(validateConnectivitySettings({ publicRpcUrls: ['http://anvil:8545'], readRpcUrl: 'http://anvil:8545' })).toEqual({
		publicRpcUrls: ['http://anvil:8545/'],
		readRpcUrl: 'http://anvil:8545/',
	})
	expect(validateConnectivitySettings({ publicRpcUrls: ['http://reth:8545'], readRpcUrl: 'http://reth:8545' })).toEqual({
		publicRpcUrls: ['http://reth:8545/'],
		readRpcUrl: 'http://reth:8545/',
	})
	expect(() => validateConnectivitySettings({ publicRpcUrls: ['http://other-service:8545'], readRpcUrl: 'http://other-service:8545' })).toThrow('HTTPS or HTTP on loopback, anvil, or reth')
})
