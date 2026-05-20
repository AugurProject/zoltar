/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { createInjectedBackend } from '../lib/chainBackend.js'
import type { InjectedEthereum } from '../injectedEthereum.js'

type RequestParameters = {
	method: string
	params?: unknown
}

function ensureWindowObject() {
	const globalWindow = globalThis as typeof globalThis & { window?: Window }
	if (globalWindow.window === undefined) {
		globalWindow.window = globalThis as Window & typeof globalThis
	}
	return globalWindow.window
}

function createMockInjectedEthereum(requestHandler: (parameters: RequestParameters) => Promise<unknown>): InjectedEthereum {
	return {
		on: () => undefined,
		removeListener: () => undefined,
		request: requestHandler as InjectedEthereum['request'],
	}
}

function getRpcId(value: unknown) {
	if (typeof value !== 'object' || value === null || !('id' in value)) return undefined
	return value.id
}

describe('injected backend read transport', () => {
	const originalFetch = globalThis.fetch
	const originalEthereum = ensureWindowObject().ethereum

	afterEach(() => {
		globalThis.fetch = originalFetch
		const windowObject = ensureWindowObject()
		if (originalEthereum === undefined) {
			delete windowObject.ethereum
			return
		}
		windowObject.ethereum = originalEthereum
	})

	test('uses the injected provider for reads by default', async () => {
		const requestCalls: string[] = []
		ensureWindowObject().ethereum = createMockInjectedEthereum(async parameters => {
			requestCalls.push(parameters.method)
			return '0x'
		})

		let fetchCalled = false
		globalThis.fetch = (async () => {
			fetchCalled = true
			throw new Error('fetch should not be called while provider reads are enabled')
		}) as unknown as typeof fetch

		const backend = createInjectedBackend()
		const code = await backend.createReadClient().getCode({ address: zeroAddress })

		expect(code).toBeUndefined()
		expect(requestCalls).toEqual(['eth_getCode'])
		expect(fetchCalled).toBe(false)
	})

	test('switches injected reads to the shared RPC backend when requested', async () => {
		const requestCalls: string[] = []
		ensureWindowObject().ethereum = createMockInjectedEthereum(async parameters => {
			requestCalls.push(parameters.method)
			return '0x'
		})

		const fetchCalls: string[] = []
		globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
			const url = input instanceof Request ? input.url : String(input)
			fetchCalls.push(url)
			const rawBody = input instanceof Request ? await input.clone().text() : typeof init?.body === 'string' ? init.body : undefined
			const body = rawBody === undefined || rawBody === '' ? undefined : JSON.parse(rawBody)
			const responseBody = Array.isArray(body) ? body.map(item => ({ id: getRpcId(item), jsonrpc: '2.0', result: '0x' })) : { id: getRpcId(body), jsonrpc: '2.0', result: '0x' }
			return new Response(JSON.stringify(responseBody), {
				headers: {
					'content-type': 'application/json',
				},
			})
		}) as unknown as typeof fetch

		const backend = createInjectedBackend()
		backend.setReadTransportMode?.('rpc')
		const code = await backend.createReadClient().getCode({ address: zeroAddress })

		expect(code).toBeUndefined()
		expect(fetchCalls).toEqual(['https://ethereum.dark.florist'])
		expect(requestCalls).toEqual([])
	})
})
