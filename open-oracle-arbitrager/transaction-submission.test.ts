import { afterEach, describe, expect, test } from 'bun:test'
import { keccak256, parseTransaction, privateKeyToAccount, type Address, type Hex } from '@zoltar/shared/ethereum'
import { assertSubmissionWindowOpen, mergeSubmissionFailures, prepareSignedTransaction, simulateBundle, simulateSignedBundleEveryRelay, SubmissionFailure, submitSignedBundle, submitSignedTransaction, validateSubmissionSettings } from './transaction-submission.js'

const servers: Bun.Server<unknown>[] = []
const address = '0x0000000000000000000000000000000000000001' as Address
const hash = `0x${'12'.repeat(32)}` as Hex
const serializedTransaction = `0x${'34'.repeat(64)}` as Hex
const signature = `0x${'56'.repeat(65)}` as Hex
const privateKey = `0x${'78'.repeat(32)}` as Hex

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true)
})

function relay(handler: (request: Request) => Response | Promise<Response>) {
	const server = Bun.serve({
		fetch: handler,
		hostname: '127.0.0.1',
		port: 0,
	})
	servers.push(server)
	if (server.port === undefined) throw new Error('Test relay did not expose a port')
	return `http://127.0.0.1:${server.port.toString()}`
}

function expectedBundleHash(transactions: readonly Hex[]) {
	const transactionHashes = transactions.map(transaction => keccak256(transaction).slice(2)).join('')
	return keccak256(`0x${transactionHashes}` as Hex)
}

describe('transaction submission settings', () => {
	test('validates modes, normalizes relay URLs, and rejects unsafe endpoints', () => {
		expect(validateSubmissionSettings({ mode: 'private', relayUrls: ['https://relay.flashbots.net', 'https://relay.flashbots.net/'] })).toEqual({
			mode: 'private',
			relayUrls: ['https://relay.flashbots.net/'],
		})
		expect(validateSubmissionSettings({ mode: 'public', relayUrls: [] })).toEqual({ mode: 'public', relayUrls: [] })
		expect(() => validateSubmissionSettings({ mode: 'private', relayUrls: [] })).toThrow('at least one relay')
		expect(() => validateSubmissionSettings({ mode: 'private', relayUrls: ['http://relay.example'] })).toThrow('HTTPS')
		expect(() => validateSubmissionSettings({ mode: 'private', relayUrls: ['https://user:secret@relay.example'] })).toThrow('credentials')
		expect(() => validateSubmissionSettings({ mode: 'private', relayUrls: ['https://relay.example?api-key=secret'] })).toThrow('query parameters')
		expect(() => validateSubmissionSettings({ mode: 'private', relayUrls: ['https://relay.example?'] })).toThrow('query parameters')
		expect(() => validateSubmissionSettings({ mode: 'private', relayUrls: ['https://relay.example#'] })).toThrow('fragments')
		expect(() => validateSubmissionSettings({ mode: 'private', relayUrls: ['https://relay.example', 'https://relay.example?'] })).toThrow('query parameters')
	})
})

describe('signed transaction delivery', () => {
	test('simulates an ordered all-or-nothing bundle at the target block', async () => {
		const requests: unknown[] = []
		const transactions = [serializedTransaction, '0x1234'] as const
		const endpoint = relay(async request => {
			requests.push(await request.json())
			return Response.json({
				id: 1,
				jsonrpc: '2.0',
				result: {
					bundleGasPrice: '0x1',
					bundleHash: expectedBundleHash(transactions),
					results: [
						{ gasUsed: 21_000, txHash: keccak256(serializedTransaction) },
						{ gasUsed: 30_000, txHash: keccak256('0x1234') },
					],
					totalGasUsed: 51_000,
				},
			})
		})
		const result = await simulateBundle({
			address,
			relayUrl: endpoint,
			signMessage: () => Promise.resolve(signature),
			stateBlockNumber: 99n,
			targetBlockNumber: 100n,
			transactions,
		})
		expect(result.totalGasUsed).toBe(51_000n)
		expect(requests).toEqual([
			{
				id: 1,
				jsonrpc: '2.0',
				method: 'eth_callBundle',
				params: [{ blockNumber: '0x64', stateBlockNumber: '0x63', txs: [serializedTransaction, '0x1234'] }],
			},
		])
	})

	test('rejects a bundle when any simulated transaction reverts', async () => {
		const transactions = [serializedTransaction, '0x1234'] as const
		const endpoint = relay(() =>
			Response.json({
				id: 1,
				jsonrpc: '2.0',
				result: {
					bundleHash: expectedBundleHash(transactions),
					results: [
						{ gasUsed: 21_000, txHash: keccak256(serializedTransaction) },
						{ error: 'execution reverted', txHash: keccak256('0x1234') },
					],
					totalGasUsed: 51_000,
				},
			}),
		)
		await expect(
			simulateBundle({
				address,
				relayUrl: endpoint,
				signMessage: () => Promise.resolve(signature),
				stateBlockNumber: 99n,
				targetBlockNumber: 100n,
				transactions,
			}),
		).rejects.toThrow('Bundle simulation reverted')
	})

	test.each([
		[{ gasUsed: 21_000 }, { gasUsed: 30_000 }],
		[
			{ gasUsed: 21_000, txHash: hash },
			{ gasUsed: 30_000, txHash: keccak256('0x1234') },
		],
		[
			{ gasUsed: 21_000, txHash: keccak256('0x1234') },
			{ gasUsed: 30_000, txHash: keccak256(serializedTransaction) },
		],
	])('rejects missing, wrong, or reordered simulation transaction hashes %#', async results => {
		const transactions = [serializedTransaction, '0x1234'] as const
		const endpoint = relay(() =>
			Response.json({
				id: 1,
				jsonrpc: '2.0',
				result: { bundleHash: expectedBundleHash(transactions), results, totalGasUsed: 51_000 },
			}),
		)
		await expect(
			simulateBundle({
				address,
				relayUrl: endpoint,
				signMessage: () => Promise.resolve(signature),
				stateBlockNumber: 99n,
				targetBlockNumber: 100n,
				transactions,
			}),
		).rejects.toThrow()
	})

	test('rejects a valid-looking simulation hash for another bundle', async () => {
		const endpoint = relay(() =>
			Response.json({
				id: 1,
				jsonrpc: '2.0',
				result: {
					bundleHash: hash,
					results: [{ gasUsed: 21_000, txHash: keccak256(serializedTransaction) }],
					totalGasUsed: 21_000,
				},
			}),
		)
		await expect(
			simulateBundle({
				address,
				relayUrl: endpoint,
				signMessage: () => Promise.resolve(signature),
				stateBlockNumber: 99n,
				targetBlockNumber: 100n,
				transactions: [serializedTransaction],
			}),
		).rejects.toThrow()
	})

	test.each([
		{ id: 2, jsonrpc: '2.0', result: { results: [{ gasUsed: 21_000 }], totalGasUsed: 21_000 } },
		{ id: 1, jsonrpc: '1.0', result: { results: [{ gasUsed: 21_000 }], totalGasUsed: 21_000 } },
		{ id: 1, jsonrpc: '2.0' },
		{ error: { code: -32_000, message: 'rejected' }, id: 1, jsonrpc: '2.0', result: { results: [{ gasUsed: 21_000 }], totalGasUsed: 21_000 } },
	])('rejects malformed JSON-RPC simulation envelope %#', async response => {
		const endpoint = relay(() => Response.json(response))
		await expect(
			simulateBundle({
				address,
				relayUrl: endpoint,
				signMessage: () => Promise.resolve(signature),
				stateBlockNumber: 99n,
				targetBlockNumber: 100n,
				transactions: [serializedTransaction],
			}),
		).rejects.toThrow()
	})

	test.each([
		{ results: [{ txHash: keccak256(serializedTransaction) }], totalGasUsed: 0 },
		{ results: [{ gasUsed: 'invalid', txHash: keccak256(serializedTransaction) }], totalGasUsed: 21_000 },
		{ results: [{ gasUsed: 21_000, txHash: keccak256(serializedTransaction) }], totalGasUsed: 20_999 },
	])('rejects incomplete or inconsistent simulation gas %#', async result => {
		const endpoint = relay(() => Response.json({ id: 1, jsonrpc: '2.0', result: { bundleHash: expectedBundleHash([serializedTransaction]), ...result } }))
		await expect(
			simulateBundle({
				address,
				relayUrl: endpoint,
				signMessage: () => Promise.resolve(signature),
				stateBlockNumber: 99n,
				targetBlockNumber: 100n,
				transactions: [serializedTransaction],
			}),
		).rejects.toThrow()
	})

	test('attributes every relay that cannot simulate the complete bundle', async () => {
		const accepted = relay(() =>
			Response.json({
				id: 1,
				jsonrpc: '2.0',
				result: { bundleHash: expectedBundleHash([serializedTransaction]), results: [{ gasUsed: 21_000, txHash: keccak256(serializedTransaction) }], totalGasUsed: 21_000 },
			}),
		)
		const rejected = relay(() => Response.json({ error: { code: -32_000, message: 'bundle reverted' }, id: 1, jsonrpc: '2.0' }))
		await expect(
			simulateSignedBundleEveryRelay({
				address,
				relayUrls: [accepted, rejected],
				signMessage: () => Promise.resolve(signature),
				stateBlockNumber: 99n,
				targetBlockNumber: 100n,
				transactions: [serializedTransaction],
			}),
		).rejects.toMatchObject({
			failedTargets: [{ error: expect.stringContaining('bundle reverted'), target: `${rejected}/` }],
		})
	})

	test('fans one ordered bundle out to every configured relay without allowed reverts', async () => {
		const requests: unknown[] = []
		const transactions = [serializedTransaction, '0x1234'] as const
		const accepted = relay(async request => {
			requests.push(await request.json())
			return Response.json({ id: 1, jsonrpc: '2.0', result: { bundleHash: expectedBundleHash(transactions) } })
		})
		const result = await submitSignedBundle({
			address,
			relayUrls: [accepted],
			signMessage: () => Promise.resolve(signature),
			targetBlockNumber: 100n,
			transactions,
		})
		expect(result.acceptedTargets).toEqual([`${accepted}/`])
		expect(requests).toEqual([
			{
				id: 1,
				jsonrpc: '2.0',
				method: 'eth_sendBundle',
				params: [{ blockNumber: '0x64', txs: [serializedTransaction, '0x1234'] }],
			},
		])
	})

	test.each(['', 'bundle', '0x1234'])('rejects malformed relay bundle hash %p', async bundleHash => {
		const endpoint = relay(() => Response.json({ id: 1, jsonrpc: '2.0', result: { bundleHash } }))
		await expect(
			submitSignedBundle({
				address,
				relayUrls: [endpoint],
				signMessage: () => Promise.resolve(signature),
				targetBlockNumber: 100n,
				transactions: [serializedTransaction],
			}),
		).rejects.toThrow('Every private relay rejected the bundle')
	})

	test('rejects a valid-looking relay hash for another submitted bundle', async () => {
		const endpoint = relay(() => Response.json({ id: 1, jsonrpc: '2.0', result: { bundleHash: hash } }))
		await expect(
			submitSignedBundle({
				address,
				relayUrls: [endpoint],
				signMessage: () => Promise.resolve(signature),
				targetBlockNumber: 100n,
				transactions: [serializedTransaction],
			}),
		).rejects.toThrow('Every private relay rejected the bundle')
	})

	test('prepares one canonical EIP-1559 transaction with pending nonce and gas margin', async () => {
		const account = privateKeyToAccount(privateKey)
		if (account.signTransaction === undefined) throw new Error('Local signer missing')
		const prepared = await prepareSignedTransaction({
			baseFeePerGas: 10n * 10n ** 9n,
			blockNumber: 100n,
			chainId: 1,
			data: '0x1234',
			from: account.address,
			gasEstimate: 100_000n,
			nonce: 7n,
			signTransaction: account.signTransaction,
			to: address,
		})
		const parsed = parseTransaction(prepared.serializedTransaction)
		expect(prepared.hash).toBe(keccak256(prepared.serializedTransaction))
		expect(prepared.maxBlockNumber).toBe(125n)
		expect(parsed.chainId).toBe(1n)
		expect(parsed.gas).toBe(130_000n)
		expect(parsed.maxFeePerGas).toBe(22n * 10n ** 9n)
		expect(parsed.maxPriorityFeePerGas).toBe(2n * 10n ** 9n)
		expect(parsed.nonce).toBe(7n)
		expect(parsed.to).toBe(address)
		expect(prepared.lastValidBlockNumber).toBeUndefined()
		expect(prepared.transaction).toMatchObject({
			from: account.address,
			hash: prepared.hash,
			input: '0x1234',
			nonce: 7n,
			to: address,
		})
	})

	test('caps private inclusion at calldata validity and refuses an already-expired transaction', async () => {
		const account = privateKeyToAccount(privateKey)
		if (account.signTransaction === undefined) throw new Error('Local signer missing')
		const parameters = {
			baseFeePerGas: 10n,
			blockNumber: 100n,
			chainId: 11_155_111,
			data: '0x1234' as Hex,
			from: account.address,
			gasEstimate: 100_000n,
			lastValidBlockNumber: 101n,
			nonce: 7n,
			signTransaction: account.signTransaction,
			to: address,
		}
		const prepared = await prepareSignedTransaction(parameters)
		expect(parseTransaction(prepared.serializedTransaction).chainId).toBe(11_155_111n)
		expect(prepared.maxBlockNumber).toBe(101n)
		expect(prepared.lastValidBlockNumber).toBe(101n)
		await expect(prepareSignedTransaction({ ...parameters, blockNumber: 101n })).rejects.toThrow('validity window expired')
		expect(() => assertSubmissionWindowOpen(101n, 100n)).not.toThrow()
		expect(() => assertSubmissionWindowOpen(101n, 101n)).toThrow('validity window expired')
	})

	test('submits one authenticated payload to every private relay and tolerates partial failure', async () => {
		const requests: { body: unknown; signature: string | null }[] = []
		const accepted = relay(async request => {
			requests.push({
				body: await request.json(),
				signature: request.headers.get('x-flashbots-signature'),
			})
			return Response.json({ id: 1, jsonrpc: '2.0', result: hash })
		})
		const rejected = relay(() => Response.json({ error: { code: -32_000, message: 'relay unavailable' }, id: 1, jsonrpc: '2.0' }, { status: 503 }))
		const result = await submitSignedTransaction({
			address,
			hash,
			maxBlockNumber: 125n,
			publicSubmit: () => Promise.reject(new Error('must not use public RPC')),
			publicRpcUrls: ['https://rpc.example'],
			serializedTransaction,
			settings: validateSubmissionSettings({ mode: 'private', relayUrls: [accepted, rejected] }),
			signMessage: () => Promise.resolve(signature),
		})
		expect(result.mode).toBe('private')
		expect(result.acceptedTargets).toEqual([`${accepted}/`])
		expect(result.failedTargets).toHaveLength(1)
		expect(requests).toHaveLength(1)
		expect(requests[0]?.signature).toBe(`${address}:${signature}`)
		expect(requests[0]?.body).toEqual({
			id: 1,
			jsonrpc: '2.0',
			method: 'eth_sendPrivateTransaction',
			params: [{ maxBlockNumber: '0x7d', tx: serializedTransaction }],
		})
	})

	test.each([
		{ response: { id: 2, jsonrpc: '2.0', result: hash } },
		{ response: { id: 1, jsonrpc: '1.0', result: hash } },
		{ response: { id: 1, jsonrpc: '2.0' } },
		{ response: { error: { code: -32_000, message: 'rejected' }, id: 1, jsonrpc: '2.0', result: hash } },
		{ response: [] },
		{ response: 'not an envelope' },
		{ response: { error: { message: 'missing code' }, id: 1, jsonrpc: '2.0' } },
		{ response: { id: 1, jsonrpc: '2.0', result: hash }, status: 503 },
	])('rejects malformed JSON-RPC private transaction envelope %#', async ({ response, status }) => {
		const endpoint = relay(() => Response.json(response, status === undefined ? undefined : { status }))
		await expect(
			submitSignedTransaction({
				address,
				hash,
				maxBlockNumber: 125n,
				publicSubmit: () => Promise.reject(new Error('must not use public RPC')),
				publicRpcUrls: ['https://rpc.example'],
				serializedTransaction,
				settings: validateSubmissionSettings({ mode: 'private', relayUrls: [endpoint] }),
				signMessage: () => Promise.resolve(signature),
			}),
		).rejects.toThrow('Every private relay rejected the transaction')
	})

	test('submits directly to the public mempool without contacting relays', async () => {
		const submitted: { transaction: Hex; url: string }[] = []
		const result = await submitSignedTransaction({
			address,
			hash,
			maxBlockNumber: 125n,
			publicRpcUrls: ['https://rpc-a.example', 'https://rpc-b.example'],
			publicSubmit: (url, transaction) => {
				submitted.push({ transaction, url })
				return url.includes('rpc-a') ? Promise.resolve(hash) : Promise.reject(new Error('RPC unavailable'))
			},
			serializedTransaction,
			settings: validateSubmissionSettings({ mode: 'public', relayUrls: ['https://relay.flashbots.net'] }),
			signMessage: () => Promise.reject(new Error('must not sign relay payload')),
		})
		expect(submitted).toEqual([
			{ transaction: serializedTransaction, url: 'https://rpc-a.example' },
			{ transaction: serializedTransaction, url: 'https://rpc-b.example' },
		])
		expect(result).toEqual({
			acceptedTargets: ['https://rpc-a.example/'],
			failedTargets: [{ error: 'RPC unavailable', target: 'https://rpc-b.example/' }],
			hash,
			mode: 'public',
		})
	})

	test('does not let a stalled relay block an accepted private submission', async () => {
		const accepted = relay(() => Response.json({ id: 1, jsonrpc: '2.0', result: hash }))
		const stalled = relay(() => new Promise<Response>(() => undefined))
		const result = await submitSignedTransaction({
			address,
			hash,
			maxBlockNumber: 125n,
			publicSubmit: () => Promise.reject(new Error('must not use public RPC')),
			publicRpcUrls: ['https://rpc.example'],
			relayTimeoutMilliseconds: 20,
			serializedTransaction,
			settings: validateSubmissionSettings({ mode: 'private', relayUrls: [accepted, stalled] }),
			signMessage: () => Promise.resolve(signature),
		})
		expect(result.acceptedTargets).toEqual([`${accepted}/`])
		expect(result.failedTargets).toHaveLength(1)
		expect(result.failedTargets[0]?.target).toBe(`${stalled}/`)
		expect(result.failedTargets[0]?.error?.toLowerCase()).toContain('timed out')
	})

	test('does not follow relay redirects outside the validated target set', async () => {
		let destinationRequests = 0
		const destination = relay(() => {
			destinationRequests += 1
			return Response.json({ id: 1, jsonrpc: '2.0', result: hash })
		})
		const redirecting = relay(() => Response.redirect(destination, 307))
		await expect(
			submitSignedTransaction({
				address,
				hash,
				maxBlockNumber: 125n,
				publicSubmit: () => Promise.reject(new Error('must not use public RPC')),
				publicRpcUrls: ['https://rpc.example'],
				serializedTransaction,
				settings: validateSubmissionSettings({ mode: 'private', relayUrls: [redirecting] }),
				signMessage: () => Promise.resolve(signature),
			}),
		).rejects.toThrow('Every private relay rejected')
		expect(destinationRequests).toBe(0)
	})

	test('fails closed when every private relay rejects the transaction', async () => {
		const rejected = relay(() => Response.json({ error: { code: -32_000, message: 'rejected' }, id: 1, jsonrpc: '2.0' }))
		try {
			await submitSignedTransaction({
				address,
				hash,
				maxBlockNumber: 125n,
				publicSubmit: () => Promise.reject(new Error('must not use public RPC')),
				publicRpcUrls: ['https://rpc.example'],
				serializedTransaction,
				settings: validateSubmissionSettings({ mode: 'private', relayUrls: [rejected] }),
				signMessage: () => Promise.resolve(signature),
			})
			throw new Error('Expected private relay submission to fail')
		} catch (error) {
			expect(error).toBeInstanceOf(SubmissionFailure)
			if (!(error instanceof SubmissionFailure)) throw error
			expect(error.message).toContain('Every private relay rejected')
			expect(error.failedTargets).toEqual([{ error: 'RPC -32000: rejected', target: `${rejected}/` }])
		}
	})

	test('merges confirmation-time relay failures into the tracked target results', () => {
		const previous = [{ error: 'initial rejection', target: 'https://relay-a.example/' }]
		const failure = new SubmissionFailure('retry rejected', [
			{ error: 'retry rejection', target: 'https://relay-a.example/' },
			{ error: 'timeout', target: 'https://relay-b.example/' },
		])
		expect(mergeSubmissionFailures(previous, failure)).toEqual([
			{ error: 'retry rejection', target: 'https://relay-a.example/' },
			{ error: 'timeout', target: 'https://relay-b.example/' },
		])
	})
})
