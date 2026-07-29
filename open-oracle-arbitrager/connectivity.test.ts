import { afterEach, describe, expect, test } from 'bun:test'
import type { Hex } from '@zoltar/shared/ethereum'
import {
	checkConnectivity,
	checkSubmissionEndpoints,
	endpointLabel,
	readRpcChainId,
	sendRawTransactionToRpc,
	updateConnectivityEndpointChecks,
	updateSubmissionEndpointChecks,
	validateConnectivitySettings,
	validateIndependentReadRpcUrls,
	validateReadRpcUrls,
	withConnectivityChecks,
	withSubmissionChecks,
	type EndpointCheck,
} from './connectivity.js'
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
			const response = await handler(value['method'], value['params'])
			return response instanceof Response ? response : Response.json({ id: value['id'], jsonrpc: value['jsonrpc'], result: response })
		},
		hostname: '127.0.0.1',
		port: 0,
	})
	servers.push(server)
	if (server.port === undefined) throw new Error('RPC test server did not expose a port')
	return `http://127.0.0.1:${server.port.toString()}`
}

describe('operator connectivity', () => {
	test('rejects a quorum that only varies paths on the same RPC origin', () => {
		expect(() => validateIndependentReadRpcUrls('https://rpc.example/read', ['https://rpc.example/quorum'])).toThrow('independent origins')
		expect(validateIndependentReadRpcUrls('https://one.example', ['https://two.example'])).toEqual(['https://two.example/'])
	})

	test('redacts RPC path and query credentials from endpoint labels', () => {
		const settings = validateConnectivitySettings({
			publicRpcUrls: ['https://rpc.example/v1?api-key=secret', 'https://rpc.example/v1?api-key=secret'],
			readRpcUrl: 'https://read.example/key',
		})
		expect(settings.publicRpcUrls).toHaveLength(1)
		expect(endpointLabel(settings.publicRpcUrls[0] ?? '')).toBe('https://rpc.example')
		expect(endpointLabel('https://eth-mainnet.g.alchemy.com/v2/SUPER_SECRET?token=HIDDEN')).toBe('https://eth-mainnet.g.alchemy.com')
		expect(() => validateConnectivitySettings({ publicRpcUrls: [], readRpcUrl: 'https://read.example' })).toThrow('At least one')
		expect(() => validateConnectivitySettings({ publicRpcUrls: ['http://rpc.example'], readRpcUrl: 'https://read.example' })).toThrow('HTTPS')
		expect(() => validateConnectivitySettings({ publicRpcUrls: ['https://rpc.example'], readRpcUrl: 'https://user:secret@read.example' })).toThrow('credentials')
		expect(validateReadRpcUrls(['https://one.example', 'https://one.example/'])).toEqual(['https://one.example/'])
		expect(() => validateReadRpcUrls(['http://unsafe.example'])).toThrow('HTTPS')
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
		const relay = (chainId: string) =>
			rpc(method => {
				if (method === 'eth_chainId') return chainId
				if (method === 'eth_callBundle' || method === 'eth_sendBundle') return Response.json({ error: { code: -32_600, message: 'signature is required' }, id: null, jsonrpc: '2.0' })
				throw new Error(`Unexpected method: ${method}`)
			})
		const mainnetRelay = relay('0x1')
		const sepoliaRelay = relay('0xaa36a7')
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

	test('rejects a same-chain JSON-RPC endpoint that is not a private transaction relay', async () => {
		for (const error of [
			{ code: -32_601, message: 'method not found' },
			{ code: -32_004, message: 'Method not supported' },
			{ code: -32_004, message: 'invalid params' },
			{ code: -32_000, message: 'unsupported method' },
			{ code: -32_000, message: 'upstream unavailable' },
		]) {
			const regularRpc = rpc(method => {
				if (method === 'eth_chainId') return '0x1'
				if (method === 'eth_callBundle' || method === 'eth_sendBundle') return Response.json({ error, id: 1, jsonrpc: '2.0' })
				throw new Error(`Unexpected method: ${method}`)
			})
			const settings = validateSubmissionSettings({ mode: 'private', relayUrls: [regularRpc] })
			const state: { endpointChecks: EndpointCheck[] } = { endpointChecks: [] }
			await expect(updateSubmissionEndpointChecks(state, () => checkSubmissionEndpoints(settings, 1))).rejects.toThrow('did not prove eth_callBundle support')
			expect(state.endpointChecks).toMatchObject([{ chainId: 1, kind: 'private-relay', status: 'failed' }])
			expect(state.endpointChecks[0]?.error).toContain(error.message)
		}
	})

	test('accepts structured signature and invalid-parameter errors as positive relay capability evidence', async () => {
		for (const error of [
			{ code: -32_600, message: 'signature is required' },
			{ code: -32_602, message: 'invalid params' },
		]) {
			const privateRelay = rpc(method => {
				if (method === 'eth_chainId') return '0x1'
				if (method === 'eth_callBundle' || method === 'eth_sendBundle') return Response.json({ error, id: 1, jsonrpc: '2.0' })
				throw new Error(`Unexpected method: ${method}`)
			})
			await expect(checkSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [privateRelay] }), 1)).resolves.toMatchObject([{ chainId: 1, status: 'healthy' }])
		}
	})

	test('rejects malformed and successful private transaction probe responses as inconclusive', async () => {
		for (const responseBody of [
			{ id: 1, jsonrpc: '2.0', result: null },
			{ error: { code: -32_602, message: 'invalid params' }, id: 1, jsonrpc: '1.0' },
			{ error: { code: -32_602, message: 'invalid params' }, id: 2, jsonrpc: '2.0' },
			{ error: { code: -32_602, message: 'invalid params' }, id: 1, jsonrpc: '2.0', result: null },
			{ error: { code: -32_602 }, id: 1, jsonrpc: '2.0' },
			{ error: 'invalid params', id: 1, jsonrpc: '2.0' },
		]) {
			const endpoint = rpc(method => {
				if (method === 'eth_chainId') return '0x1'
				if (method === 'eth_callBundle' || method === 'eth_sendBundle') return Response.json(responseBody)
				throw new Error(`Unexpected method: ${method}`)
			})
			await expect(checkSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [endpoint] }), 1)).rejects.toThrow('did not prove eth_callBundle support')
		}
	})

	test('rejects unavailable private relays even when their body resembles capability evidence', async () => {
		const endpoint = rpc(method => {
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_callBundle' || method === 'eth_sendBundle') return Response.json({ error: { code: -32_600, message: 'signature is required' }, id: 1, jsonrpc: '2.0' }, { status: 503 })
			throw new Error(`Unexpected method: ${method}`)
		})
		await expect(checkSubmissionEndpoints(validateSubmissionSettings({ mode: 'private', relayUrls: [endpoint] }), 1)).rejects.toThrow('HTTP 503')
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
