import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, mkdir, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initialCursor, scanRanges } from '../src/monitoring/block-sync.ts'
import { quorumValue, settledQuorumValue } from '../src/monitoring/read-quorum.ts'
import { boundedDashboardJson } from '../src/dashboard/security.ts'
import { acquireExclusiveProcessLock } from '../src/execution/process-lock.ts'
import { createSignerOperationGate } from '../src/execution/signer-operation-gate.ts'
import { paddedTransactionGas, prepareSignedTransaction, submitSignedTransaction } from '../src/execution/transaction-submission.ts'
import { createPublicClient, custom, encodeAbiParameters, http, parseTransaction, privateKeyToAccount, RpcError } from '../src/ethereum.ts'
import { createRpcEndpointPool, RpcEndpointPoolFailure } from '../src/ethereum/rpc-resilience.ts'
import { ConnectivityDegradedError, operationalFailureDisposition } from '../src/monitoring/resilience.ts'
import { bigintToSafeNumber } from '../src/ethereum/codec.ts'
import { confirmCanonicalReceiptFinality } from '../src/execution/canonical-finality.ts'
import { EndpointCheckFailure } from '../src/monitoring/connectivity.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

describe('shared bot primitives', () => {
	test('converts bigint values only inside the safe integer range', () => {
		expect(bigintToSafeNumber(9_007_199_254_740_991n)).toBe(Number.MAX_SAFE_INTEGER)
		expect(() => bigintToSafeNumber(9_007_199_254_740_992n)).toThrow('safe integer range')
	})
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

	test('keeps transport-only quorum loss classified as degraded connectivity', async () => {
		const unavailable = new RpcEndpointPoolFailure([{ error: 'cooling down until 2026-08-13T00:00:00.000Z', target: 'https://offline.example' }])
		const result = settledQuorumValue('head', [Promise.resolve({ endpoint: 'one', value: 1n }), Promise.reject(unavailable), Promise.reject(unavailable)])
		await expect(result).rejects.toThrow('at least two available')
		await result.catch(error => expect(operationalFailureDisposition(error)).toBe('connectivity-degraded'))
	})

	test('gives endpoint safety failures precedence over simultaneous transport failures', () => {
		const checkedAt = new Date(0).toISOString()
		const mixedFailure = new EndpointCheckFailure('wrong chain; fetch failed', [
			{ chainId: 1, checkedAt, error: 'Expected chain 11155111, received 1', failureDisposition: 'safety-paused', kind: 'public-rpc', status: 'failed', target: 'https://wrong.example' },
			{ chainId: undefined, checkedAt, error: 'fetch failed', failureDisposition: 'connectivity-degraded', kind: 'public-rpc', status: 'failed', target: 'https://offline.example' },
		])
		const offlineFailure = new EndpointCheckFailure('fetch failed', [{ chainId: undefined, checkedAt, error: 'fetch failed', failureDisposition: 'connectivity-degraded', kind: 'public-rpc', status: 'failed', target: 'https://offline.example' }])
		expect(operationalFailureDisposition(mixedFailure)).toBe('safety-paused')
		expect(operationalFailureDisposition(offlineFailure)).toBe('connectivity-degraded')
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

	test('rejects finality evidence when readers switch forks after the descendant query', async () => {
		const receiptHash = `0x${'11'.repeat(32)}` as const
		const replacementReceiptHash = `0x${'33'.repeat(32)}` as const
		const descendantHash = `0x${'22'.repeat(32)}` as const
		const switchingReader = () => {
			let switched = false
			return {
				getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
					if (blockNumber === 112n) {
						switched = true
						return { hash: descendantHash }
					}
					return { hash: switched ? replacementReceiptHash : receiptHash }
				},
				getBlockNumber: async () => 112n,
			}
		}
		await expect(confirmCanonicalReceiptFinality([switchingReader(), switchingReader()], ['one', 'two'], 'switching receipt', { blockHash: receiptHash, blockNumber: 100n }, 12n)).rejects.toThrow('receipt is no longer canonical')
	})

	test('requires the same endpoint quorum to attest descendant and receipt ancestry', async () => {
		const receiptHash = `0x${'11'.repeat(32)}` as const
		const descendantHash = `0x${'22'.repeat(32)}` as const
		const reader = (failsAt: 100n | 112n) => ({
			getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
				if (blockNumber === failsAt) throw new ConnectivityDegradedError(`unavailable at ${blockNumber.toString()}`)
				return { hash: blockNumber === 100n ? receiptHash : descendantHash }
			},
			getBlockNumber: async () => 112n,
		})
		await expect(confirmCanonicalReceiptFinality([reader(100n), reader(100n), reader(112n), reader(112n)], ['one', 'two', 'three', 'four'], 'disjoint receipt', { blockHash: receiptHash, blockNumber: 100n }, 12n)).rejects.toThrow('requires at least two available independent RPC endpoints')
	})

	test('never omits semantic failures from canonical finality evidence', async () => {
		const receiptHash = `0x${'11'.repeat(32)}` as const
		const descendantHash = `0x${'22'.repeat(32)}` as const
		const healthy = {
			getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ hash: blockNumber === 100n ? receiptHash : descendantHash }),
			getBlockNumber: async () => 112n,
		}
		const malformedHead = {
			...healthy,
			getBlockNumber: async () => {
				throw new TypeError('Malformed block-number response')
			},
		}
		const missingDescendant = {
			...healthy,
			getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
				if (blockNumber === 100n) return { hash: receiptHash }
				const error = new Error('Requested canonical block is missing')
				error.name = 'BlockNotFoundError'
				throw error
			},
		}
		await expect(confirmCanonicalReceiptFinality([healthy, healthy, malformedHead], ['one', 'two', 'three'], 'test receipt', { blockHash: receiptHash, blockNumber: 100n }, 12n)).rejects.toThrow('Malformed block-number response')
		await expect(confirmCanonicalReceiptFinality([healthy, healthy, missingDescendant], ['one', 'two', 'three'], 'test receipt', { blockHash: receiptHash, blockNumber: 100n }, 12n)).rejects.toThrow('Requested canonical block is missing')
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

	test('fails over retryable reads and records endpoint recovery', async () => {
		let primaryHealthy = false
		const primary = Bun.serve({
			port: 0,
			fetch: () => (primaryHealthy ? Response.json({ id: 1, jsonrpc: '2.0', result: '0x1' }) : new Response('unavailable', { status: 503 })),
		})
		const secondary = Bun.serve({ port: 0, fetch: () => Response.json({ id: 1, jsonrpc: '2.0', result: '0x1' }) })
		try {
			if (primary.port === undefined || secondary.port === undefined) throw new Error('RPC pool test servers did not expose ports')
			let now = 1_000
			const primaryUrl = `http://127.0.0.1:${primary.port.toString()}`
			const secondaryUrl = `http://127.0.0.1:${secondary.port.toString()}`
			const pool = createRpcEndpointPool([primaryUrl, secondaryUrl], {
				baseCooldownMilliseconds: 100,
				now: () => now,
				random: () => 0,
			})
			const client = createPublicClient({ transport: pool.transport })
			await expect(client.getChainId()).resolves.toBe(1)
			expect(pool.snapshot()).toMatchObject([
				{ consecutiveFailures: 1, status: 'degraded', target: new URL(primaryUrl).origin },
				{ consecutiveFailures: 0, status: 'healthy', target: new URL(secondaryUrl).origin },
			])

			primaryHealthy = true
			now += 101
			await expect(client.getChainId()).resolves.toBe(1)
			expect(pool.snapshot()[0]).toMatchObject({ consecutiveFailures: 0, status: 'healthy', target: new URL(primaryUrl).origin })
		} finally {
			primary.stop(true)
			secondary.stop(true)
		}
	})

	test('omits one refused endpoint from endpoint-bound quorum reads', async () => {
		const first = Bun.serve({ port: 0, fetch: () => Response.json({ id: 1, jsonrpc: '2.0', result: '0x1' }) })
		const second = Bun.serve({ port: 0, fetch: () => Response.json({ id: 1, jsonrpc: '2.0', result: '0x1' }) })
		try {
			if (first.port === undefined || second.port === undefined) throw new Error('RPC quorum test servers did not expose ports')
			const urls = ['http://127.0.0.1:1', `http://127.0.0.1:${first.port.toString()}`, `http://127.0.0.1:${second.port.toString()}`]
			const pool = createRpcEndpointPool(urls, { timeoutMilliseconds: 100 })
			const value = await settledQuorumValue(
				'chain ID',
				urls.map(async url => ({ endpoint: url, value: await createPublicClient({ transport: pool.transportFor(url) }).getChainId() })),
			)
			expect(value).toBe(1)
			expect(pool.snapshot()[0]).toMatchObject({ consecutiveFailures: 1, status: 'degraded' })
		} finally {
			first.stop(true)
			second.stop(true)
		}
	})

	test('fails over Bun connection failures to a healthy endpoint', async () => {
		const healthy = Bun.serve({ port: 0, fetch: () => Response.json({ id: 1, jsonrpc: '2.0', result: '0x1' }) })
		try {
			if (healthy.port === undefined) throw new Error('RPC pool test server did not expose a port')
			const unavailableUrl = 'http://127.0.0.1:1'
			const healthyUrl = `http://127.0.0.1:${healthy.port.toString()}`
			const pool = createRpcEndpointPool([unavailableUrl, healthyUrl], { timeoutMilliseconds: 100 })
			const client = createPublicClient({ transport: pool.transport })
			await expect(client.getChainId()).resolves.toBe(1)
			expect(pool.snapshot()).toMatchObject([
				{ consecutiveFailures: 1, status: 'degraded', target: new URL(unavailableUrl).origin },
				{ consecutiveFailures: 0, status: 'healthy', target: new URL(healthyUrl).origin },
			])
		} finally {
			healthy.stop(true)
		}
	})

	test('does not request endpoints again before every cooldown expires', async () => {
		let firstRequests = 0
		let secondRequests = 0
		const first = Bun.serve({
			port: 0,
			fetch: () => {
				firstRequests += 1
				return new Response('unavailable', { status: 503 })
			},
		})
		const second = Bun.serve({
			port: 0,
			fetch: () => {
				secondRequests += 1
				return new Response('unavailable', { status: 503 })
			},
		})
		try {
			if (first.port === undefined || second.port === undefined) throw new Error('RPC cooldown test servers did not expose ports')
			let now = 1_000
			const pool = createRpcEndpointPool([`http://127.0.0.1:${first.port.toString()}`, `http://127.0.0.1:${second.port.toString()}`], {
				baseCooldownMilliseconds: 100,
				now: () => now,
				random: () => 0,
			})
			const client = createPublicClient({ transport: pool.transport })
			await expect(client.getChainId()).rejects.toThrow('Every read RPC is unavailable')
			expect([firstRequests, secondRequests]).toEqual([1, 1])
			await expect(client.getChainId()).rejects.toThrow('cooling down until')
			expect([firstRequests, secondRequests]).toEqual([1, 1])
			now += 101
			await expect(client.getChainId()).rejects.toThrow('Every read RPC is unavailable')
			expect([firstRequests, secondRequests]).toEqual([2, 2])
		} finally {
			first.stop(true)
			second.stop(true)
		}
	})

	test('caps jitter at the configured maximum cooldown', async () => {
		const server = Bun.serve({ port: 0, fetch: () => new Response('unavailable', { status: 503 }) })
		try {
			if (server.port === undefined) throw new Error('RPC jitter test server did not expose a port')
			const pool = createRpcEndpointPool([`http://127.0.0.1:${server.port.toString()}`], {
				baseCooldownMilliseconds: 100,
				maximumCooldownMilliseconds: 100,
				now: () => 1_000,
				random: () => 1,
			})
			await expect(createPublicClient({ transport: pool.transport }).getChainId()).rejects.toThrow('Every read RPC is unavailable')
			expect(pool.snapshot()[0]?.nextRetryAt).toBe(new Date(1_100).toISOString())
		} finally {
			server.stop(true)
		}
	})

	test('does not fail over past malformed JSON-RPC evidence', async () => {
		let healthyRequests = 0
		const malformed = Bun.serve({ port: 0, fetch: () => Response.json({ id: 1, jsonrpc: '2.0' }) })
		const healthy = Bun.serve({
			port: 0,
			fetch: () => {
				healthyRequests += 1
				return Response.json({ id: 1, jsonrpc: '2.0', result: '0x1' })
			},
		})
		try {
			if (malformed.port === undefined || healthy.port === undefined) throw new Error('RPC pool test servers did not expose ports')
			const pool = createRpcEndpointPool([`http://127.0.0.1:${malformed.port.toString()}`, `http://127.0.0.1:${healthy.port.toString()}`])
			const client = createPublicClient({ transport: pool.transport })
			await expect(client.getChainId()).rejects.toThrow('Invalid JSON-RPC envelope')
			expect(healthyRequests).toBe(0)
		} finally {
			malformed.stop(true)
			healthy.stop(true)
		}
	})

	test('tracks independent live-mode transports in one endpoint-health snapshot', async () => {
		const offline = Bun.serve({ port: 0, fetch: () => new Response('unavailable', { status: 503 }) })
		const healthy = Bun.serve({ port: 0, fetch: () => Response.json({ id: 1, jsonrpc: '2.0', result: '0x1' }) })
		try {
			if (offline.port === undefined || healthy.port === undefined) throw new Error('Independent RPC health test servers did not expose ports')
			const offlineUrl = `http://127.0.0.1:${offline.port.toString()}`
			const healthyUrl = `http://127.0.0.1:${healthy.port.toString()}`
			const pool = createRpcEndpointPool([offlineUrl, healthyUrl], { random: () => 0 })
			const clients = [offlineUrl, healthyUrl].map(url => createPublicClient({ transport: pool.transportFor(url) }))
			const settled = await Promise.allSettled(clients.map(client => client.getChainId()))
			expect(settled.map(result => result.status)).toEqual(['rejected', 'fulfilled'])
			expect(pool.snapshot()).toMatchObject([
				{ consecutiveFailures: 1, status: 'degraded', target: new URL(offlineUrl).origin },
				{ consecutiveFailures: 0, status: 'healthy', target: new URL(healthyUrl).origin },
			])
		} finally {
			offline.stop(true)
			healthy.stop(true)
		}
	})

	test('never exposes RPC path or query credentials in endpoint health', async () => {
		const server = Bun.serve({ port: 0, fetch: () => new Response('unavailable', { status: 503 }) })
		try {
			if (server.port === undefined) throw new Error('Credential redaction test server did not expose a port')
			const secret = 'provider-secret-token'
			const url = `http://127.0.0.1:${server.port.toString()}/v1/${secret}?apiKey=${secret}`
			const pool = createRpcEndpointPool([url])
			let failure: unknown
			try {
				await createPublicClient({ transport: pool.transport }).getChainId()
			} catch (error) {
				failure = error
			}
			expect(failure).toBeDefined()
			const serialized = JSON.stringify(pool.snapshot())
			expect(serialized).not.toContain(secret)
			expect(serialized).not.toContain('/v1/')
			expect(failure instanceof Error ? failure.message : String(failure)).not.toContain(secret)
			expect(pool.snapshot()[0]?.target).toBe(new URL(url).origin)
		} finally {
			server.stop(true)
		}
	})

	test('distinguishes recoverable connectivity loss from safety faults', () => {
		expect(operationalFailureDisposition(new TypeError('fetch failed'))).toBe('connectivity-degraded')
		expect(operationalFailureDisposition(new RpcError('request timed out', { code: -32_000 }))).toBe('safety-paused')
		expect(operationalFailureDisposition(new TypeError('Malformed JSON-RPC result'))).toBe('safety-paused')
		const missingBlock = new Error('Requested block is missing')
		missingBlock.name = 'BlockNotFoundError'
		expect(operationalFailureDisposition(missingBlock)).toBe('safety-paused')
		expect(operationalFailureDisposition(new Error('eth_getBlockByNumber timed out after 15000ms'))).toBe('connectivity-degraded')
		expect(operationalFailureDisposition(new Error('Unable to connect. Is the computer able to access the url?'))).toBe('connectivity-degraded')
		expect(operationalFailureDisposition(new Error('RPC disagreement for canonical head'))).toBe('safety-paused')
		expect(operationalFailureDisposition(new Error('Read RPC chain mismatch: expected 1, received 11155111'))).toBe('safety-paused')
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
