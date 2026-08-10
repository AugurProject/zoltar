import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, mkdir, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initialCursor, scanRanges } from '../src/monitoring/block-sync.ts'
import { quorumValue } from '../src/monitoring/read-quorum.ts'
import { boundedDashboardJson } from '../src/dashboard/security.ts'
import { acquireExclusiveProcessLock } from '../src/execution/process-lock.ts'
import { createSignerOperationGate } from '../src/execution/signer-operation-gate.ts'
import { paddedTransactionGas, prepareSignedTransaction, submitSignedTransaction } from '../src/execution/transaction-submission.ts'
import { createPublicClient, custom, encodeAbiParameters, http, parseTransaction, privateKeyToAccount } from '../src/ethereum.ts'
import { confirmCanonicalReceiptFinality } from '../src/execution/canonical-finality.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

describe('shared bot primitives', () => {
	test('splits a block scan into bounded inclusive ranges', () => {
		const cursor = initialCursor(25n, 25n)
		expect(scanRanges(cursor, 25n, 10n)).toEqual([
			{ fromBlock: 0n, toBlock: 9n },
			{ fromBlock: 10n, toBlock: 19n },
			{ fromBlock: 20n, toBlock: 25n },
		])
	})

	test('requires independent quorum observations to agree', () => {
		expect(
			quorumValue('head', [
				{ endpoint: 'https://one.example', value: { hash: '0x01', number: 1n } },
				{ endpoint: 'https://two.example', value: { hash: '0x01', number: 1n } },
			]),
		).toEqual({ hash: '0x01', number: 1n })
		expect(() =>
			quorumValue('head', [
				{ endpoint: 'https://one.example', value: 1n },
				{ endpoint: 'https://two.example', value: 2n },
			]),
		).toThrow('RPC disagreement')
	})

	test('requires canonical receipt ancestry and confirmation depth across the RPC quorum', async () => {
		const receiptHash = `0x${'11'.repeat(32)}` as const
		const descendantHash = `0x${'22'.repeat(32)}` as const
		const reader = (head: bigint, canonicalReceiptHash = receiptHash) => ({
			getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ hash: blockNumber === 100n ? canonicalReceiptHash : descendantHash }),
			getBlockNumber: async () => head,
		})
		await expect(confirmCanonicalReceiptFinality([reader(111n), reader(112n)], ['one', 'two'], 'test receipt', { blockHash: receiptHash, blockNumber: 100n }, 12n)).resolves.toBe(false)
		await expect(confirmCanonicalReceiptFinality([reader(112n), reader(113n)], ['one', 'two'], 'test receipt', { blockHash: receiptHash, blockNumber: 100n }, 12n)).resolves.toBe(true)
		await expect(confirmCanonicalReceiptFinality([reader(112n), reader(112n, descendantHash)], ['one', 'two'], 'test receipt', { blockHash: receiptHash, blockNumber: 100n }, 12n)).rejects.toThrow('RPC disagreement')
	})

	test('serializes signer operations', () => {
		const gate = createSignerOperationGate()
		expect(gate.acquire('scan')).toBe(true)
		expect(gate.acquire('deployment')).toBe(false)
		gate.release('scan')
		expect(gate.acquire('deployment')).toBe(true)
	})

	test('rejects oversized dashboard JSON before parsing it', async () => {
		const request = new Request('http://127.0.0.1/api/settings', {
			body: JSON.stringify({ value: 'x'.repeat(1024 * 1024) }),
			headers: { 'content-type': 'application/json' },
			method: 'PUT',
		})
		await expect(boundedDashboardJson(request)).rejects.toThrow('exceeds 1 MiB')
	})

	test('aborts a stalled JSON-RPC request at the transport deadline', async () => {
		const server = Bun.serve({ port: 0, fetch: () => new Promise(() => undefined) })
		try {
			if (server.port === undefined) throw new Error('Stalled RPC did not expose a port')
			const client = createPublicClient({ transport: http(`http://127.0.0.1:${server.port.toString()}`, { timeoutMilliseconds: 25 }) })
			await expect(client.getChainId()).rejects.toThrow()
		} finally {
			server.stop(true)
		}
	})

	test('rejects an oversized JSON-RPC response before parsing it', async () => {
		const server = Bun.serve({
			port: 0,
			fetch: () => Response.json({ id: 1, jsonrpc: '2.0', result: 'x'.repeat(4 * 1024 * 1024) }),
		})
		try {
			if (server.port === undefined) throw new Error('Oversized RPC did not expose a port')
			const client = createPublicClient({ transport: http(`http://127.0.0.1:${server.port.toString()}`) })
			await expect(client.getChainId()).rejects.toThrow('response exceeds')
		} finally {
			server.stop(true)
		}
	})

	test.each([
		{ id: 2, jsonrpc: '2.0', result: '0x1' },
		{ id: 1, jsonrpc: '1.0', result: '0x1' },
		{ id: 1, jsonrpc: '2.0' },
		{ error: { code: -32_000, message: 'failed' }, id: 1, jsonrpc: '2.0', result: '0x1' },
	])('rejects a malformed JSON-RPC envelope %#', async envelope => {
		const server = Bun.serve({ port: 0, fetch: () => Response.json(envelope) })
		try {
			if (server.port === undefined) throw new Error('Malformed RPC did not expose a port')
			const client = createPublicClient({ transport: http(`http://127.0.0.1:${server.port.toString()}`) })
			await expect(client.getChainId()).rejects.toThrow('Invalid JSON-RPC envelope')
		} finally {
			server.stop(true)
		}
	})

	test('bounds a stalled custom-provider request at the transport deadline', async () => {
		const client = createPublicClient({
			transport: custom(
				{
					request: () => new Promise(() => undefined),
				},
				{ timeoutMilliseconds: 25 },
			),
		})
		await expect(client.getChainId()).rejects.toThrow('timed out after 25ms')
	})

	test('forwards a pinned simulation block to eth_call', async () => {
		const client = createPublicClient({
			transport: custom({
				request: async ({ method, params }) => {
					if (method !== 'eth_call') throw new Error(`Unexpected RPC method: ${method}`)
					if (!Array.isArray(params)) throw new Error('Expected eth_call parameters')
					expect(params[1]).toBe('0x2a')
					return encodeAbiParameters([{ type: 'uint256' }], [7n])
				},
			}),
		})
		const result = await client.simulateContract({
			abi: [{ inputs: [], name: 'value', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' }] as const,
			address: '0x0000000000000000000000000000000000000001',
			blockNumber: 42n,
			functionName: 'value',
		})

		expect(result.result).toBe(7n)
	})

	test('rejects JSON-RPC redirects without forwarding the request body', async () => {
		let forwardedRequests = 0
		const destination = Bun.serve({
			port: 0,
			fetch: () => {
				forwardedRequests += 1
				return Response.json({ id: 1, jsonrpc: '2.0', result: '0x1' })
			},
		})
		if (destination.port === undefined) throw new Error('Redirect destination did not expose a port')
		const redirect = Bun.serve({
			port: 0,
			fetch: () => Response.redirect(`http://127.0.0.1:${destination.port?.toString() ?? '0'}/rpc`, 307),
		})
		try {
			if (redirect.port === undefined) throw new Error('Redirecting RPC did not expose a port')
			const client = createPublicClient({ transport: http(`http://127.0.0.1:${redirect.port.toString()}`) })
			await expect(client.getChainId()).rejects.toThrow()
			expect(forwardedRequests).toBe(0)
		} finally {
			redirect.stop(true)
			destination.stop(true)
		}
	})

	test('unlinks a failed lock initialization even when closing the handle fails', async () => {
		let removed = false
		await expect(
			acquireExclusiveProcessLock(
				'operator.lock',
				'Test lock',
				{},
				{
					mkdir: async () => undefined,
					open: async () => ({
						chmod: async () => undefined,
						close: async () => {
							throw new Error('close failed')
						},
						sync: async () => undefined,
						writeFile: async () => {
							throw new Error('write failed')
						},
					}),
					readFile: async () => '',
					rm: async () => {
						removed = true
					},
				},
			),
		).rejects.toThrow('Failed to initialize and clean up process lock')
		expect(removed).toBe(true)
	})

	test('retries process-lock cleanup after a transient unlink failure', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-process-lock-'))
		temporaryDirectories.push(directory)
		const lockPath = join(directory, 'operator.lock')
		let removals = 0
		const filesystem = {
			mkdir,
			open,
			readFile,
			rm: async (path: string, options: { force: true }) => {
				removals += 1
				if (removals === 1) throw new Error('transient unlink failure')
				await rm(path, options)
			},
		}
		const lock = await acquireExclusiveProcessLock(lockPath, 'Test lock', {}, filesystem)
		await expect(lock.release()).rejects.toThrow('transient unlink failure')
		await lock.release()
		const replacement = await acquireExclusiveProcessLock(lockPath, 'Test lock', {}, filesystem)
		await replacement.release()
	})

	test('rejects a process-lock directory writable by other users', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-unsafe-process-lock-'))
		temporaryDirectories.push(directory)
		await chmod(directory, 0o777)
		await expect(acquireExclusiveProcessLock(join(directory, 'operator.lock'), 'Test lock', {})).rejects.toThrow('unsafe permissions')
	})

	test('rejects a process-lock directory that is owner-only but not mode 0700', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-unsafe-process-lock-'))
		temporaryDirectories.push(directory)
		await chmod(directory, 0o600)
		await expect(acquireExclusiveProcessLock(join(directory, 'operator.lock'), 'Test lock', {})).rejects.toThrow('unsafe permissions')
	})

	test('preserves ETH value in a prepared signed transaction', async () => {
		const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
		if (account.signTransaction === undefined) throw new Error('Local test account cannot sign')
		const signed = await prepareSignedTransaction({
			baseFeePerGas: 10n,
			blockNumber: 100n,
			chainId: 1,
			data: '0x1234',
			from: account.address,
			gasEstimate: 100_000n,
			nonce: 3n,
			signTransaction: account.signTransaction,
			to: '0x0000000000000000000000000000000000000010',
			value: 42n,
		})
		expect(signed.transaction.value).toBe(42n)
		expect(parseTransaction(signed.serializedTransaction).value).toBe(42n)
		expect(signed.transaction.gas).toBe(paddedTransactionGas(100_000n))
	})

	test('does not accept an oversized private-relay response', async () => {
		const hash = `0x${'44'.repeat(32)}` as const
		const relay = Bun.serve({
			port: 0,
			fetch: () => Response.json({ id: 1, jsonrpc: '2.0', padding: 'x'.repeat(16 * 1024 * 1024), result: hash }),
		})
		try {
			if (relay.port === undefined) throw new Error('Oversized relay did not bind a port')
			await expect(
				submitSignedTransaction({
					address: '0x0000000000000000000000000000000000000001',
					hash,
					maxBlockNumber: 100n,
					publicRpcUrls: [],
					publicSubmit: async () => hash,
					serializedTransaction: '0x1234',
					settings: {
						minimumBundleRelaySuccesses: 1,
						mode: 'private',
						relayUrls: [`http://127.0.0.1:${relay.port.toString()}`],
					},
					signMessage: async () => `0x${'22'.repeat(65)}`,
				}),
			).rejects.toThrow('Relay response exceeds 16 MiB')
		} finally {
			relay.stop(true)
		}
	})
})
