/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { getAddress, zeroAddress } from 'viem'
import { createInjectedBackend, normalizeAccount } from '../lib/chainBackend.js'
import type { InjectedEthereum } from '../injectedEthereum.js'

type FetchArguments = Parameters<typeof fetch>
type FetchHandler = (input: FetchArguments[0], init: FetchArguments[1] | undefined) => Promise<Response>

type RpcBody = Record<string, unknown>

const isRpcBody = (value: unknown): value is RpcBody => typeof value === 'object' && value !== null

const extractRpcId = (value: unknown): number | string => {
	if (isRpcBody(value) && (typeof value['id'] === 'number' || typeof value['id'] === 'string')) return value['id']
	return 0
}

const createMockFetch = (originalFetch: typeof fetch, handler: FetchHandler): typeof fetch => {
	const mocked = (async (input: FetchArguments[0], init?: FetchArguments[1]) => handler(input, init)) as typeof fetch
	mocked.preconnect = originalFetch.preconnect
	return mocked
}

function ensureWindowObject() {
	const globalWindow = globalThis as typeof globalThis & {
		window?: Window
	}
	if (globalWindow.window === undefined) globalWindow.window = globalThis as Window & typeof globalThis
	return globalWindow.window
}

type MockRequestParameters = {
	method: string
	params?: unknown
}

function createMockInjectedEthereum(requestHandler: (parameters: MockRequestParameters) => Promise<unknown>): InjectedEthereum {
	return {
		on: () => undefined,
		removeListener: () => undefined,
		request: requestHandler as InjectedEthereum['request'],
	}
}

function createMockInjectedEthereumWithListeners() {
	const callbacks: { accounts: unknown[]; chain: unknown[] } = { accounts: [], chain: [] }
	const calls: { action: 'add' | 'remove'; event: string; handler: unknown }[] = []

	const ethereum = {
		on: (event: string, handler: unknown) => {
			calls.push({ action: 'add', event, handler })
			if (event === 'accountsChanged') callbacks.accounts = [handler]
			if (event === 'chainChanged') callbacks.chain = [handler]
		},
		removeListener: (event: string, handler: unknown) => {
			calls.push({ action: 'remove', event, handler })
			if (event === 'accountsChanged') callbacks.accounts = callbacks.accounts?.filter(value => value !== handler)
			if (event === 'chainChanged') callbacks.chain = callbacks.chain?.filter(value => value !== handler)
		},
		request: async () => {
			throw new Error('No request handler')
		},
	}

	return { calls, ethereum: ethereum as InjectedEthereum }
}

afterEach(() => {
	const windowObject = ensureWindowObject()
	delete windowObject.ethereum
})

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
		globalThis.fetch = createMockFetch(originalFetch, async () => {
			fetchCalled = true
			throw new Error('fetch should not be called while provider reads are enabled')
		})
		const backend = createInjectedBackend()
		const code = await backend.createReadClient().getCode({ address: zeroAddress })
		expect(code).toBeUndefined()
		expect(requestCalls).toEqual(['eth_getCode'])
		expect(fetchCalled).toBe(false)
	})

	test('switches injected reads to the configured RPC backend when requested', async () => {
		const requestCalls: string[] = []
		ensureWindowObject().ethereum = createMockInjectedEthereum(async parameters => {
			requestCalls.push(parameters.method)
			return '0x'
		})
		const fetchCalls: string[] = []
		globalThis.fetch = createMockFetch(originalFetch, async (input, init) => {
			const url = input instanceof Request ? input.url : String(input)
			fetchCalls.push(url)

			let rawBody: string | undefined
			if (input instanceof Request) {
				rawBody = await input.clone().text()
			} else if (typeof init?.body === 'string') {
				rawBody = init.body
			}

			const body = rawBody === undefined || rawBody === '' ? undefined : JSON.parse(rawBody)
			const responseBody = Array.isArray(body) ? body.map(item => ({ id: extractRpcId(item), jsonrpc: '2.0', result: '0x' })) : { id: extractRpcId(body), jsonrpc: '2.0', result: '0x' }
			return new Response(JSON.stringify(responseBody), {
				headers: {
					'content-type': 'application/json',
				},
			})
		})
		const backend = createInjectedBackend({ rpcUrl: 'https://rpc.example' })
		backend.setReadTransportMode?.('rpc')
		const code = await backend.createReadClient().getCode({ address: zeroAddress })
		expect(code).toBeUndefined()
		expect(fetchCalls).toHaveLength(1)
		const [fetchUrl] = fetchCalls
		if (fetchUrl === undefined) throw new Error('Expected configured RPC fetch call')
		expect(new URL(fetchUrl).origin).toBe('https://rpc.example')
		expect(requestCalls).toEqual([])
	})

	test('handles malformed wallet responses and rejects malformed chain responses', async () => {
		ensureWindowObject().ethereum = createMockInjectedEthereum(async ({ method }) => {
			if (method === 'eth_accounts') return 'not-an-array'
			if (method === 'eth_chainId') return 42
			if (method === 'eth_requestAccounts') return null
			return []
		})

		const backend = createInjectedBackend()
		expect(await backend.getAccounts()).toEqual([])
		expect(await backend.requestAccounts()).toEqual([])
		await expect(backend.getChainId()).rejects.toThrow('Wallet returned an invalid chain ID.')
	})

	test('rejects malformed chainId responses instead of defaulting to mainnet', async () => {
		ensureWindowObject().ethereum = createMockInjectedEthereum(async ({ method }) => {
			if (method === 'eth_accounts') return []
			if (method === 'eth_chainId') return 123
			if (method === 'eth_requestAccounts') return []
			return []
		})

		const backend = createInjectedBackend()
		await expect(backend.getChainId()).rejects.toThrow('Wallet returned an invalid chain ID.')
	})

	test('reports wallet presence and uses read paths when a provider is available', async () => {
		expect(createInjectedBackend().hasWallet()).toBe(false)

		const injectedWallet = createMockInjectedEthereum(async () => [])
		ensureWindowObject().ethereum = injectedWallet
		const backend = createInjectedBackend()

		expect(backend.hasWallet()).toBe(true)
		expect(await backend.getAccounts()).toEqual([])
		expect(await backend.requestAccounts()).toEqual([])
	})

	test('throws when creating a write client before wallet injection', () => {
		const backend = createInjectedBackend()
		expect(() => backend.createWriteClient(zeroAddress)).toThrow('No injected wallet found')
	})

	test('normalizes wallet account lists and filters invalid addresses', async () => {
		const validAddress = '0x0000000000000000000000000000000000000001'
		ensureWindowObject().ethereum = createMockInjectedEthereum(async ({ method }) => {
			if (method === 'eth_accounts') return ['  ', `0x${validAddress.slice(2).toUpperCase()}`, 'not-an-address']
			if (method === 'eth_requestAccounts') return [validAddress, 'bad-address']
			return []
		})
		const backend = createInjectedBackend()

		expect(await backend.getAccounts()).toEqual([getAddress(validAddress)])
		expect(await backend.requestAccounts()).toEqual([getAddress(validAddress)])
	})

	test('invokes injected transaction callbacks for write methods', async () => {
		const callbacks: string[] = []
		let sendRawTransactionCalls = 0
		ensureWindowObject().ethereum = createMockInjectedEthereum(async ({ method }) => {
			if (method === 'eth_accounts') return [zeroAddress]
			if (method === 'eth_chainId') return '0x1'
			if (method === 'eth_getTransactionCount') return '0x1'
			if (method === 'eth_estimateGas') return '0x5208'
			if (method === 'eth_gasPrice') return '0x1'
			if (method === 'eth_maxPriorityFeePerGas') return '0x1'
			if (method === 'eth_sendTransaction') {
				callbacks.push('sent')
				return `0x${String(callbacks.length).padStart(64, '0')}`
			}
			if (method === 'eth_sendRawTransaction') {
				sendRawTransactionCalls += 1
				return `0x${String(sendRawTransactionCalls + callbacks.length).padStart(64, '0')}`
			}
			return '0x'
		})

		const backend = createInjectedBackend()
		const onTransactionSubmitted = mock(() => undefined)
		const writeClient = backend.createWriteClient(zeroAddress, { onTransactionSubmitted })

		await writeClient.sendTransaction({ to: zeroAddress })
		await writeClient.sendRawTransaction({ serializedTransaction: '0x' })
		await writeClient.writeContract({
			address: zeroAddress,
			abi: [
				{
					type: 'function',
					name: 'foo',
					inputs: [],
					outputs: [],
					stateMutability: 'nonpayable',
				},
			] as const,
			functionName: 'foo',
		})

		expect(onTransactionSubmitted).toHaveBeenCalledTimes(3)
		expect(onTransactionSubmitted).toHaveBeenCalledWith('0x0000000000000000000000000000000000000000000000000000000000000001')
		expect(onTransactionSubmitted).toHaveBeenCalledWith('0x0000000000000000000000000000000000000000000000000000000000000002')
		expect(onTransactionSubmitted).toHaveBeenCalledWith('0x0000000000000000000000000000000000000000000000000000000000000002')
		expect(callbacks.length).toBe(2)
	})

	test('handles provider call failures in read paths without throwing', async () => {
		ensureWindowObject().ethereum = createMockInjectedEthereum(async () => {
			throw new Error('provider unavailable')
		})

		const backend = createInjectedBackend()

		expect(await backend.getAccounts()).toEqual([])
		expect(await backend.requestAccounts()).toEqual([])
		await expect(backend.createReadClient().getCode({ address: zeroAddress })).rejects.toThrow('provider unavailable')
	})

	test('rejects chain RPC failures instead of defaulting to mainnet', async () => {
		ensureWindowObject().ethereum = createMockInjectedEthereum(async ({ method }) => {
			if (method === 'eth_chainId') throw new Error('RPC offline')
			return []
		})

		const backend = createInjectedBackend()
		await expect(backend.getChainId()).rejects.toThrow('Unable to verify wallet network.')
	})

	test('subscribes and unsubscribes event listeners cleanly', async () => {
		const { calls, ethereum } = createMockInjectedEthereumWithListeners()
		ensureWindowObject().ethereum = ethereum
		const backend = createInjectedBackend()
		const unsubscribeAccounts = backend.subscribeAccountsChanged(() => undefined)
		const unsubscribeChain = backend.subscribeChainChanged(() => undefined)

		expect(calls).toEqual([
			{ action: 'add', event: 'accountsChanged', handler: calls[0]?.handler },
			{ action: 'add', event: 'chainChanged', handler: calls[1]?.handler },
		])

		unsubscribeAccounts()
		unsubscribeChain()

		expect(calls).toEqual([
			{ action: 'add', event: 'accountsChanged', handler: calls[0]?.handler },
			{ action: 'add', event: 'chainChanged', handler: calls[1]?.handler },
			{ action: 'remove', event: 'accountsChanged', handler: calls[0]?.handler },
			{ action: 'remove', event: 'chainChanged', handler: calls[1]?.handler },
		])
	})

	test('normalizes mixed-case and rejects malformed wallet values for normalizeAccount', () => {
		expect(normalizeAccount('0x00000000000000000000000000000000000000a1')).toBe(getAddress('0x00000000000000000000000000000000000000A1'))
		expect(normalizeAccount('0X00000000000000000000000000000000000000A1')).toBe(undefined)
		expect(normalizeAccount('bad-address')).toBe(undefined)
		expect(normalizeAccount(123)).toBe(undefined)
	})

	test('rejects chain id reads without an injected provider', async () => {
		delete ensureWindowObject().ethereum
		const backend = createInjectedBackend()
		await expect(backend.getChainId()).rejects.toThrow('Unable to verify wallet network because no injected wallet was found.')
	})
})
