import { afterEach, beforeEach, expect, test } from 'bun:test'
import { getDefaultAnvilRpcUrl, getMockedEthSimulateWindowEthereum, normalizeAnvilTransactionParams, validateLocalAnvilRpcUrl } from '../testsuite/simulator/AnvilWindowEthereum'

type JsonRpcRequest = {
	readonly id: number | string
	readonly method: string
	readonly params?: unknown[]
}

const createJsonRpcResponse = (request: JsonRpcRequest, payload: { readonly result?: unknown; readonly error?: { readonly code: number; readonly message: string } }) =>
	new Response(
		JSON.stringify({
			jsonrpc: '2.0',
			id: request.id,
			...payload,
		}),
		{
			headers: { 'Content-Type': 'application/json' },
		},
	)

let originalFetch: typeof fetch
let originalCoverageFlag: string | undefined

const createMockedFetch = (handler: (input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => Promise<Response>): typeof fetch => Object.assign(handler, { preconnect: originalFetch.preconnect }) as typeof fetch

beforeEach(() => {
	originalFetch = globalThis.fetch
	originalCoverageFlag = process.env['SOLIDITY_BYTECODE_COVERAGE']
})

afterEach(() => {
	globalThis.fetch = originalFetch
	if (originalCoverageFlag === undefined) {
		delete process.env['SOLIDITY_BYTECODE_COVERAGE']
		return
	}
	process.env['SOLIDITY_BYTECODE_COVERAGE'] = originalCoverageFlag
})

test('getDefaultAnvilRpcUrl uses localhost for host CLI execution', () => {
	expect(getDefaultAnvilRpcUrl()).toBe('http://127.0.0.1:8545')
})

test('validateLocalAnvilRpcUrl accepts local HTTP endpoints', () => {
	expect(() => validateLocalAnvilRpcUrl('http://127.0.0.1:8545')).not.toThrow()
	expect(() => validateLocalAnvilRpcUrl('http://host.docker.internal:8545')).not.toThrow()
})

test('validateLocalAnvilRpcUrl rejects non-HTTP endpoints', () => {
	expect(() => validateLocalAnvilRpcUrl('https://127.0.0.1:8545')).toThrow('Must use http:// for a local Anvil endpoint')
})

test('validateLocalAnvilRpcUrl rejects non-local endpoints', () => {
	expect(() => validateLocalAnvilRpcUrl('http://example.com:8545')).toThrow("ANVIL_RPC points to unauthorized host 'example.com'")
})

test('normalizeAnvilTransactionParams forces legacy zero-gas pricing for send transactions', () => {
	const params = [
		{
			from: '0x1234',
			to: '0x5678',
			maxFeePerGas: '0x1',
			maxPriorityFeePerGas: '0x2',
			type: '0x2',
			value: '0x0',
		},
	]

	expect(normalizeAnvilTransactionParams(params)).toEqual([
		{
			from: '0x1234',
			to: '0x5678',
			gasPrice: '0x0',
			value: '0x0',
		},
	])
})

test('normalizeAnvilTransactionParams preserves explicit legacy gas pricing for basefee tests', () => {
	const params = [
		{
			from: '0x1234',
			to: '0x5678',
			gasPrice: '0x1',
			maxFeePerGas: '0x2',
			maxPriorityFeePerGas: '0x3',
			type: '0x2',
			value: '0x0',
		},
	]

	expect(normalizeAnvilTransactionParams(params)).toEqual([
		{
			from: '0x1234',
			to: '0x5678',
			gasPrice: '0x1',
			value: '0x0',
		},
	])
})

test('normalizeAnvilTransactionParams leaves non-object params unchanged', () => {
	const params = ['latest']

	expect(normalizeAnvilTransactionParams(params)).toEqual(params)
})

test('ordinary eth_call requests do not trigger debug traces when Solidity bytecode coverage is disabled', async () => {
	delete process.env['SOLIDITY_BYTECODE_COVERAGE']
	const observedMethods: string[] = []

	const mockedFetch = createMockedFetch(async (_input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
		if (typeof init?.body !== 'string') throw new Error('Expected a JSON-RPC string body')
		const request = JSON.parse(init.body) as JsonRpcRequest
		observedMethods.push(request.method)

		if (request.method === 'anvil_reset' || request.method === 'anvil_setNextBlockBaseFeePerGas') return createJsonRpcResponse(request, { result: '0x1' })
		if (request.method === 'eth_getBlockByNumber') return createJsonRpcResponse(request, { result: { timestamp: '0x0' } })
		if (request.method === 'eth_call') return createJsonRpcResponse(request, { result: '0x' })
		throw new Error(`Unexpected JSON-RPC method: ${request.method}`)
	})
	globalThis.fetch = mockedFetch

	const anvilWindow = await getMockedEthSimulateWindowEthereum()
	await expect(anvilWindow.request({ method: 'eth_call', params: [{ to: '0x1234', data: '0xabcd' }, '0x7b'] })).resolves.toBe('0x')
	expect(observedMethods.includes('debug_traceCall')).toBe(false)
})

test('ordinary eth_call requests trace coverage with the original block tag, state overrides, and block overrides', async () => {
	process.env['SOLIDITY_BYTECODE_COVERAGE'] = '1'
	const debugTraceCallRequests: JsonRpcRequest[] = []
	const stateOverrides = {
		'0x0000000000000000000000000000000000000001': {
			balance: '0x1',
		},
	}
	const blockOverrides = {
		timestamp: '0x2a',
		baseFeePerGas: '0x3',
	}

	const mockedFetch = createMockedFetch(async (_input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
		if (typeof init?.body !== 'string') throw new Error('Expected a JSON-RPC string body')
		const request = JSON.parse(init.body) as JsonRpcRequest

		if (request.method === 'anvil_reset' || request.method === 'anvil_setNextBlockBaseFeePerGas') return createJsonRpcResponse(request, { result: '0x1' })
		if (request.method === 'eth_getBlockByNumber') return createJsonRpcResponse(request, { result: { timestamp: '0x0' } })
		if (request.method === 'eth_call') return createJsonRpcResponse(request, { result: '0x' })
		if (request.method === 'debug_traceCall') {
			debugTraceCallRequests.push(request)
			return createJsonRpcResponse(request, {
				result: {
					failed: false,
					gas: 0,
					returnValue: '0x',
					structLogs: [],
				},
			})
		}
		throw new Error(`Unexpected JSON-RPC method: ${request.method}`)
	})
	globalThis.fetch = mockedFetch

	const anvilWindow = await getMockedEthSimulateWindowEthereum()
	await expect(
		anvilWindow.request({
			method: 'eth_call',
			params: [{ to: '0x1234', data: '0xabcd' }, '0x7b', stateOverrides, blockOverrides],
		}),
	).resolves.toBe('0x')

	expect(debugTraceCallRequests).toHaveLength(1)
	expect(debugTraceCallRequests[0]?.params).toEqual([
		{ to: '0x1234', data: '0xabcd' },
		'0x7b',
		{
			disableStack: false,
			disableMemory: true,
			disableStorage: true,
			stateOverrides,
			blockOverrides,
		},
	])
})

test('reverting eth_call requests still trace coverage with the original block tag and state overrides', async () => {
	process.env['SOLIDITY_BYTECODE_COVERAGE'] = '1'
	const debugTraceCallRequests: JsonRpcRequest[] = []
	const stateOverrides = {
		'0x0000000000000000000000000000000000000002': {
			balance: '0x2',
		},
	}

	const mockedFetch = createMockedFetch(async (_input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
		if (typeof init?.body !== 'string') throw new Error('Expected a JSON-RPC string body')
		const request = JSON.parse(init.body) as JsonRpcRequest

		if (request.method === 'anvil_reset' || request.method === 'anvil_setNextBlockBaseFeePerGas') return createJsonRpcResponse(request, { result: '0x1' })
		if (request.method === 'eth_getBlockByNumber') return createJsonRpcResponse(request, { result: { timestamp: '0x0' } })
		if (request.method === 'eth_call') {
			return createJsonRpcResponse(request, {
				error: {
					code: -32000,
					message: 'execution reverted: nope',
				},
			})
		}
		if (request.method === 'debug_traceCall') {
			debugTraceCallRequests.push(request)
			return createJsonRpcResponse(request, {
				result: {
					failed: true,
					gas: 0,
					returnValue: '0x',
					structLogs: [],
				},
			})
		}
		throw new Error(`Unexpected JSON-RPC method: ${request.method}`)
	})
	globalThis.fetch = mockedFetch

	const anvilWindow = await getMockedEthSimulateWindowEthereum()
	await expect(
		anvilWindow.request({
			method: 'eth_call',
			params: [{ to: '0x5678', data: '0xdcba' }, 'pending', stateOverrides],
		}),
	).rejects.toThrow('execution reverted: nope')

	expect(debugTraceCallRequests).toHaveLength(1)
	expect(debugTraceCallRequests[0]?.params).toEqual([
		{ to: '0x5678', data: '0xdcba' },
		'pending',
		{
			disableStack: false,
			disableMemory: true,
			disableStorage: true,
			stateOverrides,
		},
	])
})
