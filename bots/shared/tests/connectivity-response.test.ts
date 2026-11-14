import { expect, spyOn, test } from 'bun:test'
import { privateKeyToAccount } from '../src/ethereum.ts'
import { checkPrivateTransactionSubmissionEndpoints, checkPublicTransactionSubmissionEndpoints, checkSubmissionEndpoints, readRpcChainId } from '../src/monitoring/connectivity.ts'
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
