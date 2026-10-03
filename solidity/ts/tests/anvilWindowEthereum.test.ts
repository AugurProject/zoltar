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

const parseJsonRpcRequest = (init: RequestInit | BunFetchRequestInit | undefined) => {
	if (typeof init?.body !== 'string') throw new Error('Expected a JSON-RPC string body')
	return JSON.parse(init.body) as JsonRpcRequest
}

// Answers the calls every mocked window makes on startup, then delegates the rest to the handler.
const mockJsonRpc = (handler: (request: JsonRpcRequest, init: RequestInit | BunFetchRequestInit | undefined) => Promise<Response | undefined> | Response | undefined, observedMethods?: string[]) => {
	globalThis.fetch = createMockedFetch(async (_input, init) => {
		const request = parseJsonRpcRequest(init)
		observedMethods?.push(request.method)
		const response = await handler(request, init)
		if (response !== undefined) return response
		if (request.method === 'anvil_reset' || request.method === 'anvil_setNextBlockBaseFeePerGas') return createJsonRpcResponse(request, { result: '0x1' })
		if (request.method === 'eth_getBlockByNumber') return createJsonRpcResponse(request, { result: { timestamp: '0x0' } })
		throw new Error(`Unexpected JSON-RPC method: ${request.method}`)
	})
}

const sendTestTransaction = async () =>
	await (await getMockedEthSimulateWindowEthereum()).request({
		method: 'eth_sendTransaction',
		params: [
			{
				data: '0xabcd',
				from: '0x0000000000000000000000000000000000000001',
				to: '0x0000000000000000000000000000000000000002',
			},
		],
	})

const successfulReceipt = (transactionHash: string) => ({
	contractAddress: null,
	status: '0x1',
	transactionHash,
	to: '0x0000000000000000000000000000000000000002',
})

const withMockedClock = async (now: () => number, run: () => Promise<void>) => {
	const originalDateNow = Date.now
	Date.now = now
	try {
		await run()
	} finally {
		Date.now = originalDateNow
	}
}

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

test.each([
	{ label: 'non-HTTP', url: 'https://127.0.0.1:8545', message: 'Must use http:// for a local Anvil endpoint' },
	{ label: 'non-local', url: 'http://example.com:8545', message: "Anvil RPC points to unauthorized host 'example.com'" },
])('validateLocalAnvilRpcUrl rejects $label endpoints', ({ url, message }) => {
	expect(() => validateLocalAnvilRpcUrl(url)).toThrow(message)
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
		const request = parseJsonRpcRequest(init)
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
		const request = parseJsonRpcRequest(init)
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

test.each([
	{ automaticBlocks: true, clockStart: 10_000, clockStep: 501, expectsFallbackBlockAdvance: false, name: 'lets automatic block production publish a delayed receipt before fallback block advancement', hashByte: '11' },
	{ automaticBlocks: false, clockStart: 0, clockStep: 1_000, expectsFallbackBlockAdvance: true, name: 'waits for a delayed receipt and includes pending Anvil transactions in a block', hashByte: '12' },
])('send transaction $name', async ({ automaticBlocks, clockStart, clockStep, expectsFallbackBlockAdvance, hashByte }) => {
	delete process.env['SOLIDITY_BYTECODE_COVERAGE']
	const observedMethods: string[] = []
	const transactionHash = `0x${hashByte.repeat(32)}`
	let receiptRequestCount = 0
	mockJsonRpc(request => {
		if (request.method === 'evm_setNextBlockTimestamp' || (!automaticBlocks && request.method === 'evm_mine')) return createJsonRpcResponse(request, { result: '0x1' })
		if (request.method === 'anvil_getAutomine') return createJsonRpcResponse(request, { result: automaticBlocks })
		if (request.method === 'eth_sendTransaction') return createJsonRpcResponse(request, { result: transactionHash })
		if (request.method === 'eth_getTransactionReceipt') {
			receiptRequestCount += 1
			return createJsonRpcResponse(request, { result: receiptRequestCount === 1 ? null : successfulReceipt(transactionHash) })
		}
		return undefined
	}, observedMethods)
	let now = clockStart
	await withMockedClock(
		() => (now += clockStep),
		async () => {
			await expect(sendTestTransaction()).resolves.toBe(transactionHash)
			expect(receiptRequestCount).toBe(2)
			if (expectsFallbackBlockAdvance) expect(observedMethods).toContain('evm_mine')
			else expect(observedMethods).not.toContain('evm_mine')
		},
	)
})

const mockMissingReceipt = (transactionHash: string, diagnostics: (request: JsonRpcRequest, init: RequestInit | BunFetchRequestInit | undefined) => Promise<Response | undefined> | Response | undefined) =>
	mockJsonRpc((request, init) => {
		if (request.method === 'evm_setNextBlockTimestamp' || request.method === 'evm_mine') return createJsonRpcResponse(request, { result: '0x1' })
		if (request.method === 'anvil_getAutomine') return createJsonRpcResponse(request, { result: true })
		if (request.method === 'eth_sendTransaction') return createJsonRpcResponse(request, { result: transactionHash })
		if (request.method === 'eth_getTransactionReceipt') return createJsonRpcResponse(request, { result: null })
		return diagnostics(request, init)
	})

const receiptTimeoutClock = () => {
	const clockValues = [0, 1, 180_001, 180_002]
	return () => clockValues.shift() ?? 180_002
}

test('send transaction throws a targeted error when Anvil never returns a receipt', async () => {
	delete process.env['SOLIDITY_BYTECODE_COVERAGE']
	const transactionHash = `0x${'34'.repeat(32)}`
	mockMissingReceipt(transactionHash, request => {
		if (request.method === 'eth_getTransactionByHash') return createJsonRpcResponse(request, { result: null })
		if (request.method === 'eth_blockNumber') return createJsonRpcResponse(request, { result: '0x7' })
		if (request.method === 'txpool_status') return createJsonRpcResponse(request, { result: { pending: '0x0', queued: '0x0' } })
		return undefined
	})
	await withMockedClock(receiptTimeoutClock(), async () => {
		await expect(sendTestTransaction()).rejects.toThrow(`Anvil did not return a receipt for sent transaction ${transactionHash} within 180000ms. Diagnostics: transaction not found; latest block 0x7; transaction pool {"pending":"0x0","queued":"0x0"}.`)
	})
})

test('send transaction preserves the receipt timeout when diagnostic RPC calls stop responding', async () => {
	delete process.env['SOLIDITY_BYTECODE_COVERAGE']
	const transactionHash = `0x${'56'.repeat(32)}`
	const diagnosticMethods = new Set(['eth_getTransactionByHash', 'eth_blockNumber', 'txpool_status'])
	mockMissingReceipt(transactionHash, async (request, init) => {
		if (!diagnosticMethods.has(request.method)) return undefined
		const signal = init?.signal
		if (signal === undefined || signal === null) throw new Error(`Expected ${request.method} to use an abort signal`)
		return await new Promise<Response>((_resolve, reject) => {
			const rejectAsAborted = () => reject(new Error('mocked diagnostic RPC aborted'))
			if (signal.aborted) {
				rejectAsAborted()
				return
			}
			signal.addEventListener('abort', rejectAsAborted, { once: true })
		})
	})
	await withMockedClock(receiptTimeoutClock(), async () => {
		const diagnosticStart = performance.now()
		let caughtError: unknown
		try {
			await sendTestTransaction()
		} catch (error) {
			caughtError = error
		}
		if (!(caughtError instanceof Error)) throw new Error('Expected the transaction request to fail')
		expect(caughtError.message).toContain(`Anvil did not return a receipt for sent transaction ${transactionHash} within 180000ms.`)
		expect(caughtError.message).toContain('transaction lookup failed: Anvil RPC eth_getTransactionByHash did not respond within 1000ms')
		expect(caughtError.message).toContain('latest block lookup failed: Anvil RPC eth_blockNumber did not respond within 1000ms')
		expect(caughtError.message).toContain('transaction pool lookup failed: Anvil RPC txpool_status did not respond within 1000ms')
		expect(performance.now() - diagnosticStart).toBeLessThan(2_000)
	})
})

test('ordinary eth_call requests do not trigger debug traces when Solidity bytecode coverage is disabled', async () => {
	delete process.env['SOLIDITY_BYTECODE_COVERAGE']
	const observedMethods: string[] = []
	mockJsonRpc(request => (request.method === 'eth_call' ? createJsonRpcResponse(request, { result: '0x' }) : undefined), observedMethods)

	const anvilWindow = await getMockedEthSimulateWindowEthereum()
	await expect(anvilWindow.request({ method: 'eth_call', params: [{ to: '0x1234', data: '0xabcd' }, '0x7b'] })).resolves.toBe('0x')
	expect(observedMethods.includes('debug_traceCall')).toBe(false)
})

const mockTracedEthCall = (reverts: boolean) => {
	process.env['SOLIDITY_BYTECODE_COVERAGE'] = '1'
	const debugTraceCallRequests: JsonRpcRequest[] = []
	mockJsonRpc(request => {
		if (request.method === 'eth_call') return createJsonRpcResponse(request, reverts ? { error: { code: -32000, message: 'execution reverted: nope' } } : { result: '0x' })
		if (request.method !== 'debug_traceCall') return undefined
		debugTraceCallRequests.push(request)
		return createJsonRpcResponse(request, { result: { failed: reverts, gas: 0, returnValue: '0x', structLogs: [] } })
	})
	return debugTraceCallRequests
}

const traceOptions = { disableStack: false, disableMemory: true, disableStorage: true }

test('ordinary eth_call requests trace coverage with the original block tag, state overrides, and block overrides', async () => {
	const debugTraceCallRequests = mockTracedEthCall(false)
	const stateOverrides = { '0x0000000000000000000000000000000000000001': { balance: '0x1' } }
	const blockOverrides = { timestamp: '0x2a', baseFeePerGas: '0x3' }

	const anvilWindow = await getMockedEthSimulateWindowEthereum()
	await expect(anvilWindow.request({ method: 'eth_call', params: [{ to: '0x1234', data: '0xabcd' }, '0x7b', stateOverrides, blockOverrides] })).resolves.toBe('0x')

	expect(debugTraceCallRequests).toHaveLength(1)
	expect(debugTraceCallRequests[0]?.params).toEqual([{ to: '0x1234', data: '0xabcd' }, '0x7b', { ...traceOptions, stateOverrides, blockOverrides }])
})

test('reverting eth_call requests still trace coverage with the original block tag and state overrides', async () => {
	const debugTraceCallRequests = mockTracedEthCall(true)
	const stateOverrides = { '0x0000000000000000000000000000000000000002': { balance: '0x2' } }

	const anvilWindow = await getMockedEthSimulateWindowEthereum()
	await expect(anvilWindow.request({ method: 'eth_call', params: [{ to: '0x5678', data: '0xdcba' }, 'pending', stateOverrides] })).rejects.toThrow('execution reverted: nope')

	expect(debugTraceCallRequests).toHaveLength(1)
	expect(debugTraceCallRequests[0]?.params).toEqual([{ to: '0x5678', data: '0xdcba' }, 'pending', { ...traceOptions, stateOverrides }])
})
