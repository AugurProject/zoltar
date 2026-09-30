import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runtimeConfig } from '../../src/config.ts'
import { runSerializedIndexerLeaseOperation } from '../../src/database.ts'
import { databaseJsonText } from '../../src/database-json.ts'
import { safeIndexerFailureReason } from '../../src/indexer-runtime.ts'
import type { RpcFetchFn } from '../../src/ethereum.ts'
import { createRotatingJsonLog, createRpcLoggingFetch, jsonRpcErrorName } from '../../src/logging.ts'
import { RpcRequestMethodError } from '../../src/rpc-request-queue.ts'

const temporaryDirectories: string[] = []

const temporaryDirectory = async (): Promise<string> => {
	const directory = await mkdtemp(path.join(tmpdir(), 'augurscan-log-test-'))
	temporaryDirectories.push(directory)
	return directory
}

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) await rm(directory, { force: true, recursive: true })
})

const rpcLogPath = async (): Promise<string> => path.join(await temporaryDirectory(), 'rpc.jsonl')

const readLogLines = async (filename: string): Promise<string[]> => (await readFile(filename, 'utf8')).trim().split('\n')

const createRethLoggingFetch = (filename: string, fetchFn: RpcFetchFn): RpcFetchFn => createRpcLoggingFetch('http://reth:8545', '#1 http://reth:8545', filename, createRotatingJsonLog(filename), fetchFn)

const postRpc = (loggingFetch: RpcFetchFn, id: number, method: string, params: readonly unknown[]) =>
	loggingFetch('http://reth:8545', {
		body: JSON.stringify({ id, jsonrpc: '2.0', method, params }),
		method: 'POST',
	})

const silenceConsole = (method: 'error' | 'warn') => spyOn(console, method).mockImplementation(() => {})

const withSilencedConsole = async (body: (spies: { consoleError: ReturnType<typeof silenceConsole>; consoleWarn: ReturnType<typeof silenceConsole> }) => Promise<void>): Promise<void> => {
	const consoleError = silenceConsole('error')
	const consoleWarn = silenceConsole('warn')
	try {
		await body({ consoleError, consoleWarn })
	} finally {
		consoleError.mockRestore()
		consoleWarn.mockRestore()
	}
}

describe('AugurScan runtime logging', () => {
	test('maps standard and reserved JSON-RPC error codes', () => {
		expect(jsonRpcErrorName(-32700)).toBe('Parse error')
		expect(jsonRpcErrorName(-32603)).toBe('Internal error')
		expect(jsonRpcErrorName(-32000)).toBe('Server error')
		expect(jsonRpcErrorName(123)).toBeUndefined()
	})

	test('includes the RPC method, server, and mapped code in safe console diagnostics', () => {
		const rpcError = Object.assign(new Error('provider detail'), { code: -32603, name: 'RpcError' })
		const wrapped = new RpcRequestMethodError('eth_getCode', rpcError, '#1 https://*.tenderly.co')
		expect(safeIndexerFailureReason(wrapped)).toBe('RpcRequestMethodError caused by RpcError; method eth_getCode; RPC #1 https://*.tenderly.co; code -32603 (Internal error)')
		const pruned = Object.assign(new Error('state at block #1 is pruned'), {
			code: -32603,
			details: 'state at block #1 is pruned',
			name: 'RpcRequestError',
		})
		expect(safeIndexerFailureReason(new RpcRequestMethodError('eth_getCode', pruned, '#1 http://reth:8545'))).toBe('RpcRequestMethodError caused by RpcRequestError; method eth_getCode; RPC #1 http://reth:8545; code -32603 (Internal error); message: state at block #1 is pruned')
		const wrappedRpcError = Object.assign(new Error('state at block #1 is pruned'), { code: -32603, name: 'RpcError' })
		expect(safeIndexerFailureReason(new RpcRequestMethodError('eth_getCode', wrappedRpcError, '#1 http://reth:8545'))).toBe('RpcRequestMethodError caused by RpcError; method eth_getCode; RPC #1 http://reth:8545; code -32603 (Internal error); message: state at block #1 is pruned')
	})

	test('resolves the RPC log path absolutely at configuration load', () => {
		const configuredPath = process.env['RPC_LOG_PATH']
		expect(runtimeConfig.rpcLogPath).toBe(configuredPath === undefined ? path.resolve(import.meta.dir, '../../logs/rpc.jsonl') : path.resolve(configuredPath))
	})

	test('logs the full RPC request, response, endpoint, and readable error name', async () => {
		const filename = await rpcLogPath()
		const responseBody = JSON.stringify({
			id: 1,
			jsonrpc: '2.0',
			error: { code: -32603, message: 'upstream failed https://rpc.example/private-key\ninjected line', data: { trace: 'full' } },
		})
		await withSilencedConsole(async ({ consoleError }) => {
			const loggingFetch = createRpcLoggingFetch('https://rpc.example/private-key', '#1 https://rpc.example', filename, createRotatingJsonLog(filename), async () => new Response(responseBody, { headers: { 'x-provider': 'example' }, status: 200 }))
			const requestBody = JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_getCode', params: ['0x1234', '0x1'] })
			await loggingFetch('https://rpc.example/private-key', { body: requestBody, method: 'POST' })

			expect(JSON.parse((await readFile(filename, 'utf8')).trim())).toMatchObject({
				rpcServer: 'https://rpc.example/private-key',
				request: { body: requestBody },
				response: { body: responseBody, headers: { 'x-provider': 'example' } },
			})
			expect(consoleError).toHaveBeenCalledWith(`RPC error from #1 https://rpc.example; method eth_getCode; code -32603 (Internal error); full exchange logged to ${filename}`)
			const consoleOutput = consoleError.mock.calls.flat().join(' ')
			expect(consoleOutput).not.toContain('private-key')
			expect(consoleOutput).not.toContain('injected line')
		})
	})

	test('does not log successful RPC exchanges', async () => {
		const filename = await rpcLogPath()
		const loggingFetch = createRethLoggingFetch(filename, async () => Response.json({ id: 1, jsonrpc: '2.0', result: '0xaa36a7' }))
		await postRpc(loggingFetch, 1, 'eth_chainId', [])
		await expect(access(filename)).rejects.toMatchObject({ code: 'ENOENT' })
	})

	test('logs invalid JSON and malformed JSON-RPC error responses as failures', async () => {
		const filename = await rpcLogPath()
		const responses = [new Response('not json'), Response.json({ error: { message: 'missing error code' }, id: 2, jsonrpc: '2.0' })]
		const loggingFetch = createRethLoggingFetch(filename, async () => {
			const response = responses.shift()
			if (response === undefined) throw new Error('Unexpected RPC request')
			return response
		})
		for (const id of [1, 2]) await postRpc(loggingFetch, id, 'eth_chainId', [])
		const records = (await readLogLines(filename)).map(line => JSON.parse(line))
		expect(records).toHaveLength(2)
		expect(records[0]).toMatchObject({ request: { body: expect.stringContaining('"id":1') }, response: { body: 'not json', status: 200 } })
		expect(records[1]).toMatchObject({
			request: { body: expect.stringContaining('"id":2') },
			response: { body: JSON.stringify({ error: { message: 'missing error code' }, id: 2, jsonrpc: '2.0' }), status: 200 },
		})
	})

	test.each([
		{
			name: 'shows an allowlisted pruned-state message without exposing arbitrary provider text',
			error: { code: -32603, message: 'state at block #1 is pruned' },
			method: 'eth_getCode',
			params: ['0x1234', '0x1'],
			warning: (filename: string) => `Historical state unavailable from #1 http://reth:8545; method eth_getCode; message: state at block #1 is pruned; locating earliest retrievable state block; repeated pruned-state exchanges remain in ${filename}`,
		},
		{
			name: 'reports pruned log history as recoverable boundary discovery',
			error: { code: 4444, message: 'pruned history unavailable' },
			method: 'eth_getLogs',
			params: [{ fromBlock: '0x1', toBlock: '0x1' }],
			warning: (filename: string) => `Historical log history unavailable from #1 http://reth:8545; method eth_getLogs; message: pruned history unavailable; locating earliest retrievable block; full exchange logged to ${filename}`,
		},
	])('$name', async ({ error, method, params, warning }) => {
		const filename = await rpcLogPath()
		await withSilencedConsole(async ({ consoleError, consoleWarn }) => {
			const loggingFetch = createRethLoggingFetch(filename, async () => Response.json({ error, id: 1, jsonrpc: '2.0' }))
			await postRpc(loggingFetch, 1, method, params)
			expect(consoleWarn).toHaveBeenCalledWith(warning(filename))
			expect(consoleError).not.toHaveBeenCalled()
		})
	})

	test.each([
		{ name: 'reports a pruned-state boundary probe once while retaining every exchange', method: 'eth_getBalance', message: (id: number) => `state at block #${id} is pruned`, warningContains: undefined, warningOmits: undefined },
		{
			name: 'coalesces wrapped Reth trace pruning errors while retaining every exchange',
			method: 'debug_traceBlockByHash',
			message: (id: number) => `failed to apply blockhash contract call: database error: Database error: state at block #${id} is pruned`,
			warningContains: undefined,
			warningOmits: undefined,
		},
		{ name: 'coalesces missing-trie-node state probes while retaining every exchange', method: 'eth_getCode', message: () => 'missing trie node 0xsecret', warningContains: 'message: missing trie node', warningOmits: '0xsecret' },
	])('$name', async ({ method, message, warningContains, warningOmits }) => {
		const filename = await rpcLogPath()
		await withSilencedConsole(async ({ consoleError, consoleWarn }) => {
			const loggingFetch = createRethLoggingFetch(filename, async (_input, init) => {
				const request: unknown = JSON.parse(String(init?.body))
				if (typeof request !== 'object' || request === null || Array.isArray(request) || !('id' in request) || typeof request.id !== 'number') throw new Error('Expected a numeric JSON-RPC request identifier')
				return Response.json({ error: { code: -32603, message: message(request.id) }, id: request.id, jsonrpc: '2.0' })
			})
			for (const id of [1, 2, 3]) await postRpc(loggingFetch, id, method, ['0x1234', `0x${id.toString(16)}`])
			expect(consoleWarn).toHaveBeenCalledTimes(1)
			if (warningContains !== undefined) expect(consoleWarn.mock.calls[0]?.[0]).toContain(warningContains)
			if (warningOmits !== undefined) expect(consoleWarn.mock.calls[0]?.[0]).not.toContain(warningOmits)
			expect(consoleError).not.toHaveBeenCalled()
			expect(await readLogLines(filename)).toHaveLength(3)
		})
	})

	test('rotates the current RPC log before it exceeds its configured size', async () => {
		const filename = await rpcLogPath()
		const log = createRotatingJsonLog(filename, 80)
		await log.append({ payload: 'a'.repeat(40) })
		await log.append({ payload: 'b'.repeat(40) })

		expect(await readFile(`${filename}.1`, 'utf8')).toContain('a'.repeat(40))
		expect(await readFile(filename, 'utf8')).toContain('b'.repeat(40))
	})

	test('serializes operations that share one reserved database lease', async () => {
		const lease = {}
		let active = 0
		let maximumActive = 0
		const operation = async (): Promise<void> => {
			active++
			maximumActive = Math.max(maximumActive, active)
			await Promise.resolve()
			active--
		}

		await Promise.all([runSerializedIndexerLeaseOperation(lease, operation), runSerializedIndexerLeaseOperation(lease, operation), runSerializedIndexerLeaseOperation(lease, operation)])
		expect(maximumActive).toBe(1)
	})

	test('continues serializing lease operations after one rejects', async () => {
		const lease = {}
		await expect(
			runSerializedIndexerLeaseOperation(lease, async () => {
				throw new Error('expected operation failure')
			}),
		).rejects.toThrow('expected operation failure')
		await expect(runSerializedIndexerLeaseOperation(lease, async () => 'recovered')).resolves.toBe('recovered')
	})

	test('serializes nested bigints for PostgreSQL JSON columns', () => {
		expect(JSON.parse(databaseJsonText({ blockNumber: 2n, receipt: { gasUsed: 21_000n }, values: [1n, undefined] }))).toEqual({
			blockNumber: '2',
			receipt: { gasUsed: '21000' },
			values: ['1', null],
		})
	})

	test('preserves JSON absence and non-finite number behavior', () => {
		expect(JSON.parse(databaseJsonText({ omitted: undefined, invalid: Number.POSITIVE_INFINITY, timestamp: new Date('2026-01-02T00:00:00Z') }))).toEqual({
			invalid: null,
			timestamp: '2026-01-02T00:00:00.000Z',
		})
		expect(() => databaseJsonText(undefined)).toThrow('Database JSON value cannot be serialized')
	})
})
