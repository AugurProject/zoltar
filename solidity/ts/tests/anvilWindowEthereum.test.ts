import { afterEach, beforeEach, expect, test } from 'bun:test'
import { getDefaultAnvilRpcUrl, getMockedEthSimulateWindowEthereum, JsonRpcError, normalizeAnvilTransactionParams, parseJsonRpcResponse, validateLocalAnvilRpcUrl, validateRpcResult } from '../testSupport/simulator/AnvilWindowEthereum'

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
	expect(() => validateLocalAnvilRpcUrl('http://example.com:8545')).toThrow("Anvil RPC points to unauthorized host 'example.com'")
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
			gas: '0x1c9c380',
			gasPrice: '0x0',
			value: '0x0',
		},
	])
})

test('normalizeAnvilTransactionParams preserves explicit gas and legacy gas pricing for basefee tests', () => {
	const params = [
		{
			from: '0x1234',
			to: '0x5678',
			gas: '0x5208',
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
			gas: '0x5208',
			gasPrice: '0x1',
			value: '0x0',
		},
	])
})

test('normalizeAnvilTransactionParams leaves non-object params unchanged', () => {
	const params = ['latest']

	expect(normalizeAnvilTransactionParams(params)).toEqual(params)
})

test('JSON-RPC envelopes and method results fail closed', () => {
	expect(() => parseJsonRpcResponse({ jsonrpc: '2.0', id: 8, result: '0x1' }, 7)).toThrow('response id')
	expect(() => parseJsonRpcResponse({ jsonrpc: '2.0', id: 7, error: { code: 'bad', message: 'failure' } }, 7)).toThrow('malformed error')
	expect(() => parseJsonRpcResponse({ jsonrpc: '2.0', id: 7, result: true, error: undefined }, 7)).toThrow('exactly one')
	expect(() => validateRpcResult('eth_chainId', '0x01')).toThrow('canonical quantity')
	expect(() => validateRpcResult('eth_sendTransaction', '0x1234')).toThrow('transaction hash')
	expect(() => validateRpcResult('eth_getTransactionReceipt', { status: '0x2', transactionHash: `0x${'11'.repeat(32)}` }, { transactionHash: `0x${'11'.repeat(32)}` })).toThrow('status')
	expect(() => validateRpcResult('eth_getTransactionReceipt', { status: '0x1', transactionHash: `0x${'22'.repeat(32)}` }, { transactionHash: `0x${'11'.repeat(32)}` })).toThrow('submitted hash')
	expect(() => validateRpcResult('anvil_revert', false)).not.toThrow()
})

test('JSON-RPC failures preserve structured code and data', () => {
	const error = new JsonRpcError({ code: -32601, message: 'alternate unsupported wording', data: { method: 'evm_mine' } })
	expect(error.code).toBe(-32601)
	expect(error.data).toEqual({ method: 'evm_mine' })
	expect(error.message).toBe('alternate unsupported wording')
})

test('request and requestRaw both preserve structured JSON-RPC failures', async () => {
	globalThis.fetch = createMockedFetch(async (_input, init) => {
		if (typeof init?.body !== 'string') throw new Error('Expected a JSON-RPC string body')
		const request = JSON.parse(init.body) as JsonRpcRequest
		if (request.method === 'anvil_reset') return createJsonRpcResponse(request, { result: null })
		if (request.method === 'anvil_setNextBlockBaseFeePerGas') return createJsonRpcResponse(request, { result: null })
		if (request.method === 'eth_getBlockByNumber') return createJsonRpcResponse(request, { result: { timestamp: '0x0' } })
		return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32_001, message: 'structured failure', data: '0xdead' } }))
	})
	const ethereum = await getMockedEthSimulateWindowEthereum()
	for (const invoke of [() => ethereum.request({ method: 'unknown_method' }), () => ethereum.requestRaw({ method: 'unknown_method' })]) {
		try {
			await invoke()
			throw new Error('Expected request failure')
		} catch (error) {
			expect(error).toBeInstanceOf(JsonRpcError)
			if (!(error instanceof JsonRpcError)) throw error
			expect(error.code).toBe(-32_001)
			expect(error.data).toBe('0xdead')
		}
	}
})

test('nested snapshots restore their own node timestamp and reject consumed snapshots', async () => {
	let timestamp = 1n
	let nextSnapshot = 1
	const snapshots = new Map<string, bigint>()
	globalThis.fetch = createMockedFetch(async (_input, init) => {
		if (typeof init?.body !== 'string') throw new Error('Expected a JSON-RPC string body')
		const request = JSON.parse(init.body) as JsonRpcRequest
		if (request.method === 'eth_getBlockByNumber') return createJsonRpcResponse(request, { result: { timestamp: `0x${timestamp.toString(16)}` } })
		if (request.method === 'evm_setNextBlockTimestamp') {
			const value = request.params?.[0]
			if (typeof value !== 'string') throw new Error('Missing timestamp')
			timestamp = BigInt(value)
			return createJsonRpcResponse(request, { result: null })
		}
		if (request.method === 'anvil_snapshot') {
			const id = `0x${nextSnapshot.toString(16)}`
			nextSnapshot += 1
			snapshots.set(id, timestamp)
			return createJsonRpcResponse(request, { result: id })
		}
		if (request.method === 'anvil_revert') {
			const id = request.params?.[0]
			if (typeof id !== 'string') throw new Error('Missing snapshot id')
			const restored = snapshots.get(id)
			if (restored === undefined) return createJsonRpcResponse(request, { result: false })
			timestamp = restored
			snapshots.delete(id)
			return createJsonRpcResponse(request, { result: true })
		}
		return createJsonRpcResponse(request, { result: null })
	})
	const ethereum = await getMockedEthSimulateWindowEthereum()
	await ethereum.setTime(10n)
	const outer = await ethereum.anvilSnapshot()
	await ethereum.setTime(20n)
	const inner = await ethereum.anvilSnapshot()
	await ethereum.setTime(30n)
	await ethereum.anvilRevert(inner)
	expect(await ethereum.getTime()).toBe(20n)
	await ethereum.anvilRevert(outer)
	expect(await ethereum.getTime()).toBe(10n)
	await expect(ethereum.anvilRevert(outer)).rejects.toThrow('snapshot')
})

test('send transaction lets automining publish a delayed receipt before fallback mining', async () => {
	delete process.env['SOLIDITY_BYTECODE_COVERAGE']
	const originalDateNow = Date.now
	const observedMethods: string[] = []
	const transactionHash = `0x${'11'.repeat(32)}`
	let receiptRequestCount = 0

	const mockedFetch = createMockedFetch(async (_input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
		if (typeof init?.body !== 'string') throw new Error('Expected a JSON-RPC string body')
		const request = JSON.parse(init.body) as JsonRpcRequest
		observedMethods.push(request.method)

		if (request.method === 'anvil_reset' || request.method === 'anvil_setNextBlockBaseFeePerGas' || request.method === 'evm_setNextBlockTimestamp') return createJsonRpcResponse(request, { result: '0x1' })
		if (request.method === 'anvil_getAutomine') return createJsonRpcResponse(request, { result: true })
		if (request.method === 'eth_getBlockByNumber') return createJsonRpcResponse(request, { result: { timestamp: '0x0' } })
		if (request.method === 'eth_sendTransaction') return createJsonRpcResponse(request, { result: transactionHash })
		if (request.method === 'eth_getTransactionReceipt') {
			receiptRequestCount += 1
			if (receiptRequestCount === 1) return createJsonRpcResponse(request, { result: null })
			return createJsonRpcResponse(request, {
				result: {
					contractAddress: null,
					status: '0x1',
					transactionHash,
					to: '0x0000000000000000000000000000000000000002',
				},
			})
		}
		throw new Error(`Unexpected JSON-RPC method: ${request.method}`)
	})
	globalThis.fetch = mockedFetch
	let now = 10_000
	Date.now = () => (now += 501)

	try {
		const anvilWindow = await getMockedEthSimulateWindowEthereum()
		await expect(
			anvilWindow.request({
				method: 'eth_sendTransaction',
				params: [
					{
						data: '0xabcd',
						from: '0x0000000000000000000000000000000000000001',
						to: '0x0000000000000000000000000000000000000002',
					},
				],
			}),
		).resolves.toBe(transactionHash)
		expect(receiptRequestCount).toBe(2)
		expect(observedMethods).not.toContain('evm_mine')
	} finally {
		Date.now = originalDateNow
	}
})

test('send transaction waits for a delayed receipt and mines pending Anvil transactions', async () => {
	delete process.env['SOLIDITY_BYTECODE_COVERAGE']
	const originalDateNow = Date.now
	const observedMethods: string[] = []
	const transactionHash = `0x${'12'.repeat(32)}`
	let receiptRequestCount = 0
	let now = 0

	const mockedFetch = createMockedFetch(async (_input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
		if (typeof init?.body !== 'string') throw new Error('Expected a JSON-RPC string body')
		const request = JSON.parse(init.body) as JsonRpcRequest
		observedMethods.push(request.method)

		if (request.method === 'anvil_reset' || request.method === 'anvil_setNextBlockBaseFeePerGas' || request.method === 'evm_setNextBlockTimestamp' || request.method === 'evm_mine') return createJsonRpcResponse(request, { result: '0x1' })
		if (request.method === 'anvil_getAutomine') return createJsonRpcResponse(request, { result: false })
		if (request.method === 'eth_getBlockByNumber') return createJsonRpcResponse(request, { result: { timestamp: '0x0' } })
		if (request.method === 'eth_sendTransaction') return createJsonRpcResponse(request, { result: transactionHash })
		if (request.method === 'eth_getTransactionReceipt') {
			receiptRequestCount += 1
			if (receiptRequestCount === 1) return createJsonRpcResponse(request, { result: null })
			return createJsonRpcResponse(request, {
				result: {
					contractAddress: null,
					status: '0x1',
					transactionHash,
					to: '0x0000000000000000000000000000000000000002',
				},
			})
		}
		throw new Error(`Unexpected JSON-RPC method: ${request.method}`)
	})
	globalThis.fetch = mockedFetch
	Date.now = () => (now += 1_000)

	try {
		const anvilWindow = await getMockedEthSimulateWindowEthereum()
		await expect(
			anvilWindow.request({
				method: 'eth_sendTransaction',
				params: [
					{
						data: '0xabcd',
						from: '0x0000000000000000000000000000000000000001',
						to: '0x0000000000000000000000000000000000000002',
					},
				],
			}),
		).resolves.toBe(transactionHash)
		expect(receiptRequestCount).toBe(2)
		expect(observedMethods).toContain('evm_mine')
	} finally {
		Date.now = originalDateNow
	}
})

test('send transaction throws a targeted error when Anvil never returns a receipt', async () => {
	delete process.env['SOLIDITY_BYTECODE_COVERAGE']
	const originalDateNow = Date.now
	const clockValues = [0, 1, 180_001, 180_002]
	const transactionHash = `0x${'34'.repeat(32)}`

	const mockedFetch = createMockedFetch(async (_input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
		if (typeof init?.body !== 'string') throw new Error('Expected a JSON-RPC string body')
		const request = JSON.parse(init.body) as JsonRpcRequest

		if (request.method === 'anvil_reset' || request.method === 'anvil_setNextBlockBaseFeePerGas' || request.method === 'evm_setNextBlockTimestamp' || request.method === 'evm_mine') return createJsonRpcResponse(request, { result: '0x1' })
		if (request.method === 'anvil_getAutomine') return createJsonRpcResponse(request, { result: true })
		if (request.method === 'eth_getBlockByNumber') return createJsonRpcResponse(request, { result: { timestamp: '0x0' } })
		if (request.method === 'eth_sendTransaction') return createJsonRpcResponse(request, { result: transactionHash })
		if (request.method === 'eth_getTransactionReceipt') return createJsonRpcResponse(request, { result: null })
		if (request.method === 'eth_getTransactionByHash') return createJsonRpcResponse(request, { result: null })
		if (request.method === 'eth_blockNumber') return createJsonRpcResponse(request, { result: '0x7' })
		if (request.method === 'txpool_status') return createJsonRpcResponse(request, { result: { pending: '0x0', queued: '0x0' } })
		throw new Error(`Unexpected JSON-RPC method: ${request.method}`)
	})
	globalThis.fetch = mockedFetch

	Date.now = () => clockValues.shift() ?? 180_002
	try {
		const anvilWindow = await getMockedEthSimulateWindowEthereum()
		await expect(
			anvilWindow.request({
				method: 'eth_sendTransaction',
				params: [
					{
						data: '0xabcd',
						from: '0x0000000000000000000000000000000000000001',
						to: '0x0000000000000000000000000000000000000002',
					},
				],
			}),
		).rejects.toThrow(`Anvil did not return a receipt for sent transaction ${transactionHash} within 180000ms. Diagnostics: transaction not found; latest block 0x7; transaction pool {"pending":"0x0","queued":"0x0"}.`)
	} finally {
		Date.now = originalDateNow
	}
})

test('send transaction preserves the receipt timeout when diagnostic RPC calls stop responding', async () => {
	delete process.env['SOLIDITY_BYTECODE_COVERAGE']
	const originalDateNow = Date.now
	const clockValues = [0, 1, 180_001, 180_002]
	const transactionHash = `0x${'56'.repeat(32)}`
	const diagnosticMethods = new Set(['eth_getTransactionByHash', 'eth_blockNumber', 'txpool_status'])

	const mockedFetch = createMockedFetch(async (_input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) => {
		if (typeof init?.body !== 'string') throw new Error('Expected a JSON-RPC string body')
		const request = JSON.parse(init.body) as JsonRpcRequest

		if (request.method === 'anvil_reset' || request.method === 'anvil_setNextBlockBaseFeePerGas' || request.method === 'evm_setNextBlockTimestamp' || request.method === 'evm_mine') return createJsonRpcResponse(request, { result: '0x1' })
		if (request.method === 'anvil_getAutomine') return createJsonRpcResponse(request, { result: true })
		if (request.method === 'eth_getBlockByNumber') return createJsonRpcResponse(request, { result: { timestamp: '0x0' } })
		if (request.method === 'eth_sendTransaction') return createJsonRpcResponse(request, { result: transactionHash })
		if (request.method === 'eth_getTransactionReceipt') return createJsonRpcResponse(request, { result: null })
		if (diagnosticMethods.has(request.method)) {
			const signal = init.signal
			if (signal === undefined || signal === null) throw new Error(`Expected ${request.method} to use an abort signal`)
			return await new Promise<Response>((_resolve, reject) => {
				const rejectAsAborted = () => reject(new Error('mocked diagnostic RPC aborted'))
				if (signal.aborted) {
					rejectAsAborted()
					return
				}
				signal.addEventListener('abort', rejectAsAborted, { once: true })
			})
		}
		throw new Error(`Unexpected JSON-RPC method: ${request.method}`)
	})
	globalThis.fetch = mockedFetch

	Date.now = () => clockValues.shift() ?? 180_002
	try {
		const anvilWindow = await getMockedEthSimulateWindowEthereum()
		const diagnosticStart = performance.now()
		let caughtError: unknown
		try {
			await anvilWindow.request({
				method: 'eth_sendTransaction',
				params: [
					{
						data: '0xabcd',
						from: '0x0000000000000000000000000000000000000001',
						to: '0x0000000000000000000000000000000000000002',
					},
				],
			})
		} catch (error) {
			caughtError = error
		}
		if (!(caughtError instanceof Error)) throw new Error('Expected the transaction request to fail')
		expect(caughtError.message).toContain(`Anvil did not return a receipt for sent transaction ${transactionHash} within 180000ms.`)
		expect(caughtError.message).toContain('transaction lookup failed: Anvil RPC eth_getTransactionByHash did not respond within 1000ms')
		expect(caughtError.message).toContain('latest block lookup failed: Anvil RPC eth_blockNumber did not respond within 1000ms')
		expect(caughtError.message).toContain('transaction pool lookup failed: Anvil RPC txpool_status did not respond within 1000ms')
		expect(performance.now() - diagnosticStart).toBeLessThan(2_000)
	} finally {
		Date.now = originalDateNow
	}
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
