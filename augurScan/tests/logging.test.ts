import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRpcLogPath } from '../src/config.ts'
import { runSerializedIndexerLeaseOperation } from '../src/database.ts'
import { safeIndexerFailureReason } from '../src/indexer-runtime.ts'
import { createRpcLoggingFetch, jsonRpcErrorName, RotatingJsonLog, timestampedLogArguments } from '../src/logging.ts'
import { RpcRequestMethodError } from '../src/rpc-request-queue.ts'

const temporaryDirectories: string[] = []

const temporaryDirectory = async (): Promise<string> => {
	const directory = await mkdtemp(path.join(tmpdir(), 'augurscan-log-test-'))
	temporaryDirectories.push(directory)
	return directory
}

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) await rm(directory, { force: true, recursive: true })
})

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
		expect(safeIndexerFailureReason(wrapped)).toBe(
			'RpcRequestMethodError caused by RpcError; method eth_getCode; RPC #1 https://*.tenderly.co; code -32603 (Internal error)',
		)
	})

	test('prefixes console values with an ISO timestamp', () => {
		expect(timestampedLogArguments(['indexer started'], new Date('2026-08-21T06:08:10.919Z'))).toEqual(['[2026-08-21T06:08:10.919Z]:', 'indexer started'])
	})

	test('resolves the default RPC log independently of the working directory', async () => {
		const originalWorkingDirectory = process.cwd()
		const directory = await temporaryDirectory()
		try {
			process.chdir(directory)
			expect(resolveRpcLogPath(undefined)).toBe(path.resolve(import.meta.dir, '../logs/rpc.jsonl'))
			const configuredPath = path.join(directory, 'configured-rpc.jsonl')
			expect(resolveRpcLogPath(configuredPath)).toBe(configuredPath)
		} finally {
			process.chdir(originalWorkingDirectory)
		}
	})

	test('logs the full RPC request, response, endpoint, and readable error name', async () => {
		const directory = await temporaryDirectory()
		const filename = path.join(directory, 'rpc.jsonl')
		const consoleError = spyOn(console, 'error').mockImplementation(() => {})
		try {
			const loggingFetch = createRpcLoggingFetch(
				'https://rpc.example/private-key',
				'#1 https://rpc.example',
				filename,
				new RotatingJsonLog(filename),
				async () =>
					new Response(
						JSON.stringify({
							id: 1,
							jsonrpc: '2.0',
							error: { code: -32603, message: 'upstream failed https://rpc.example/private-key\ninjected line', data: { trace: 'full' } },
						}),
						{
							headers: { 'x-provider': 'example' },
							status: 200,
						},
					),
			)
			const requestBody = JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_getCode', params: ['0x1234', '0x1'] })
			await loggingFetch('https://rpc.example/private-key', { body: requestBody, method: 'POST' })

			const responseBody = JSON.stringify({
				id: 1,
				jsonrpc: '2.0',
				error: { code: -32603, message: 'upstream failed https://rpc.example/private-key\ninjected line', data: { trace: 'full' } },
			})
			expect(JSON.parse((await readFile(filename, 'utf8')).trim())).toMatchObject({
				rpcServer: 'https://rpc.example/private-key',
				request: { body: requestBody },
				response: { body: responseBody, headers: { 'x-provider': 'example' } },
			})
			expect(consoleError).toHaveBeenCalledWith(
				`RPC error from #1 https://rpc.example; method eth_getCode; code -32603 (Internal error); full exchange logged to ${filename}`,
			)
			const consoleOutput = consoleError.mock.calls.flat().join(' ')
			expect(consoleOutput).not.toContain('private-key')
			expect(consoleOutput).not.toContain('injected line')
		} finally {
			consoleError.mockRestore()
		}
	})

	test('rotates the current RPC log before it exceeds its configured size', async () => {
		const directory = await temporaryDirectory()
		const filename = path.join(directory, 'rpc.jsonl')
		const log = new RotatingJsonLog(filename, 80)
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

		await Promise.all([
			runSerializedIndexerLeaseOperation(lease, operation),
			runSerializedIndexerLeaseOperation(lease, operation),
			runSerializedIndexerLeaseOperation(lease, operation),
		])
		expect(maximumActive).toBe(1)
	})
})
