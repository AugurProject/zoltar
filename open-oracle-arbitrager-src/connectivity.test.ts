import { afterEach, describe, expect, test } from 'bun:test'
import type { Hex } from '@zoltar/shared/ethereum'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, readRpcChainId, sendRawTransactionToRpc, updateConnectivityEndpointChecks, updateSubmissionEndpointChecks, validateConnectivitySettings, withConnectivityChecks, withSubmissionChecks, type EndpointCheck } from './connectivity.js'
import { validateSubmissionSettings } from './transaction-submission.js'

const servers: Bun.Server<unknown>[] = []

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true)
})

function rpc(handler: (method: string, params: readonly unknown[]) => unknown | Promise<unknown>) {
	const server = Bun.serve({
		fetch: async request => {
			const value = await request.json()
			if (typeof value !== 'object' || value === null || !('id' in value) || !('jsonrpc' in value) || !('method' in value) || !('params' in value) || typeof value['id'] !== 'number' || typeof value['jsonrpc'] !== 'string' || typeof value['method'] !== 'string' || !Array.isArray(value['params']))
				throw new Error('Invalid test RPC request')
			return Response.json({ id: value['id'], jsonrpc: value['jsonrpc'], result: await handler(value['method'], value['params']) })
		},
		hostname: '127.0.0.1',
		port: 0,
	})
	servers.push(server)
	if (server.port === undefined) throw new Error('RPC test server did not expose a port')
	return `http://127.0.0.1:${server.port.toString()}`
}

describe('operator connectivity', () => {
	test('validates read and public RPC endpoints without exposing URL query values in labels', () => {
		const settings = validateConnectivitySettings({
			publicRpcUrls: ['https://rpc.example/v1?api-key=secret', 'https://rpc.example/v1?api-key=secret'],
			readRpcUrl: 'https://read.example/key',
		})
		expect(settings.publicRpcUrls).toHaveLength(1)
		expect(endpointLabel(settings.publicRpcUrls[0] ?? '')).toBe('https://rpc.example/v1')
		expect(() => validateConnectivitySettings({ publicRpcUrls: [], readRpcUrl: 'https://read.example' })).toThrow('At least one')
		expect(() => validateConnectivitySettings({ publicRpcUrls: ['http://rpc.example'], readRpcUrl: 'https://read.example' })).toThrow('HTTPS')
		expect(() => validateConnectivitySettings({ publicRpcUrls: ['https://rpc.example'], readRpcUrl: 'https://user:secret@read.example' })).toThrow('credentials')
	})

	test('checks the configured chain and sends raw transactions', async () => {
		const hash = `0x${'12'.repeat(32)}` as Hex
		const url = rpc((method, params) => {
			if (method === 'eth_chainId') return '0xaa36a7'
			if (method === 'eth_sendRawTransaction') {
				expect(params).toEqual(['0x1234'])
				return hash
			}
			throw new Error(`Unexpected method: ${method}`)
		})
		expect(await readRpcChainId(url)).toBe(11_155_111)
		expect(await sendRawTransactionToRpc(url, '0x1234')).toBe(hash)
		const checks = await checkConnectivity(validateConnectivitySettings({ publicRpcUrls: [url], readRpcUrl: url }), 11_155_111)
		expect(checks.map(check => check.status)).toEqual(['healthy', 'healthy'])
		await expect(checkConnectivity(validateConnectivitySettings({ publicRpcUrls: [url], readRpcUrl: url }), 1)).rejects.toThrow('Expected chain 1')
	})

	test('fails closed on wrong-chain private relays and clears checks for public mode', async () => {
		const mainnetRelay = rpc(() => '0x1')
		const sepoliaRelay = rpc(() => '0xaa36a7')
		const healthy = await checkSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [mainnetRelay] }), 1)
		expect(healthy).toMatchObject([{ chainId: 1, kind: 'private-relay', status: 'healthy' }])
		const connectivity = await checkConnectivity(validateConnectivitySettings({ publicRpcUrls: [mainnetRelay], readRpcUrl: mainnetRelay }), 1)
		expect(withConnectivityChecks(healthy, connectivity).map(check => check.kind)).toEqual(['read-rpc', 'public-rpc', 'private-relay'])
		expect(withSubmissionChecks(connectivity, healthy).map(check => check.kind)).toEqual(['read-rpc', 'public-rpc', 'private-relay'])
		await expect(checkSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [sepoliaRelay] }), 1)).rejects.toThrow('Expected chain 1')
		const publicChecks = await checkSubmissionEndpoints(validateSubmissionSettings({ mode: 'public', relayUrls: [mainnetRelay] }), 1)
		expect(publicChecks).toEqual([])
		expect(withSubmissionChecks([...connectivity, ...healthy], publicChecks).map(check => check.kind)).toEqual(['read-rpc', 'public-rpc'])
	})

	test('preserves every endpoint role regardless of concurrent update completion order', async () => {
		const privateRelay = { chainId: 1, checkedAt: new Date().toISOString(), error: undefined, kind: 'private-relay', status: 'healthy', target: 'https://relay.example/' } as const
		const readRpc = { chainId: 1, checkedAt: new Date().toISOString(), error: undefined, kind: 'read-rpc', status: 'healthy', target: 'https://read.example/' } as const
		const publicRpc = { chainId: 1, checkedAt: new Date().toISOString(), error: undefined, kind: 'public-rpc', status: 'healthy', target: 'https://submit.example/' } as const
		for (const completionOrder of ['connectivity-first', 'submission-first'] as const) {
			let releaseConnectivity: ((checks: readonly EndpointCheck[]) => void) | undefined
			let releaseSubmission: ((checks: readonly EndpointCheck[]) => void) | undefined
			const connectivity = new Promise<readonly EndpointCheck[]>(resolve => {
				releaseConnectivity = resolve
			})
			const submission = new Promise<readonly EndpointCheck[]>(resolve => {
				releaseSubmission = resolve
			})
			const state: { endpointChecks: EndpointCheck[] } = { endpointChecks: [] }
			const updates = [updateConnectivityEndpointChecks(state, () => connectivity), updateSubmissionEndpointChecks(state, () => submission)]
			if (releaseConnectivity === undefined || releaseSubmission === undefined) throw new Error('Endpoint check releases were not initialized')
			if (completionOrder === 'connectivity-first') {
				releaseConnectivity([readRpc, publicRpc])
				releaseSubmission([privateRelay])
			} else {
				releaseSubmission([privateRelay])
				releaseConnectivity([readRpc, publicRpc])
			}
			await Promise.all(updates)
			expect(state.endpointChecks.map(check => check.kind)).toEqual(['read-rpc', 'public-rpc', 'private-relay'])
		}
	})
})
