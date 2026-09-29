import { afterEach, describe, expect, test } from 'bun:test'
import { keccak256, parseTransaction, privateKeyToAccount, type Address, type Hex } from '../src/ethereum.ts'
import { assertSubmissionWindowOpen, maximumFeePerGas, mergeSubmissionFailures, prepareSignedTransaction, simulateSignedBundleEveryRelay, SubmissionFailure, submitSignedBundle, submitSignedTransaction, validateSubmissionSettings, type SubmissionSettings } from '../src/execution/transaction-submission.ts'

const servers: Bun.Server<unknown>[] = []
const address = '0x0000000000000000000000000000000000000001' as Address
const hash = `0x${'12'.repeat(32)}` as Hex
const serializedTransaction = `0x${'34'.repeat(64)}` as Hex
const signature = `0x${'56'.repeat(65)}` as Hex
const privateKey = `0x${'78'.repeat(32)}` as Hex
const signMessage = () => Promise.resolve(signature)

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

function rejectingRelay(message: string, init?: ResponseInit) {
	return relay(() => Response.json({ error: { code: -32_000, message }, id: 1, jsonrpc: '2.0' }, init))
}

function expectedBundleHash(transactions: readonly Hex[]) {
	const transactionHashes = transactions.map(transaction => keccak256(transaction).slice(2)).join('')
	return keccak256(`0x${transactionHashes}` as Hex)
}

/** A relay that accepts a one-transaction bundle simulation at state block 99. */
function acceptingSimulationRelay() {
	return relay(() =>
		Response.json({
			id: 1,
			jsonrpc: '2.0',
			result: { bundleHash: expectedBundleHash([serializedTransaction]), results: [{ gasUsed: 21_000, txHash: keccak256(serializedTransaction) }], stateBlockNumber: 99, totalGasUsed: 21_000 },
		}),
	)
}

function acceptingBundleRelay(transactions: readonly Hex[] = [serializedTransaction]) {
	return relay(() => Response.json({ id: 1, jsonrpc: '2.0', result: { bundleHash: expectedBundleHash(transactions) } }))
}

function simulateEveryRelay(relayUrls: readonly string[], minimumSuccessfulRelays?: number, transactions: readonly Hex[] = [serializedTransaction]) {
	return simulateSignedBundleEveryRelay({ address, ...(minimumSuccessfulRelays === undefined ? {} : { minimumSuccessfulRelays }), relayUrls, signMessage, stateBlockNumber: 99n, targetBlockNumber: 100n, transactions })
}

// Simulates through the every-relay path with one relay so single-relay behaviour stays observable.
async function simulateBundle(relayUrl: string, transactions: readonly Hex[] = [serializedTransaction]) {
	const result = await simulateEveryRelay([relayUrl], undefined, transactions)
	const simulation = result.successful[0]?.simulation
	if (simulation === undefined) throw new Error('Bundle simulation produced no successful relay result')
	return simulation
}

function submitBundle(relayUrls: readonly string[], minimumSuccessfulRelays?: number, transactions: readonly Hex[] = [serializedTransaction]) {
	return submitSignedBundle({ address, ...(minimumSuccessfulRelays === undefined ? {} : { minimumSuccessfulRelays }), relayUrls, signMessage, targetBlockNumber: 100n, transactions })
}

/** Submits the fixture transaction privately; the public RPC path must never be used. */
function submitPrivately(settings: SubmissionSettings, overrides: { publicRpcUrls?: readonly string[]; relayTimeoutMilliseconds?: number } = {}) {
	return submitSignedTransaction({
		address,
		hash,
		maxBlockNumber: 125n,
		publicSubmit: () => Promise.reject(new Error('must not use public RPC')),
		publicRpcUrls: ['https://rpc.example'],
		serializedTransaction,
		settings,
		signMessage,
		...overrides,
	})
}

function privateSettings(relayUrls: readonly string[], minimumBundleRelaySuccesses?: number) {
	return validateSubmissionSettings({ ...(minimumBundleRelaySuccesses === undefined ? {} : { minimumBundleRelaySuccesses }), mode: 'private', relayUrls })
}

describe('transaction submission settings', () => {
	test('validates modes, normalizes relay URLs, and rejects unsafe endpoints', () => {
		expect(validateSubmissionSettings({ mode: 'private', relayUrls: ['https://relay.flashbots.net', 'https://relay.flashbots.net/'] })).toEqual({
			minimumBundleRelaySuccesses: 1,
			mode: 'private',
			relayUrls: ['https://relay.flashbots.net/'],
		})
		expect(validateSubmissionSettings({ mode: 'public', relayUrls: [] })).toEqual({ minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] })
		expect(validateSubmissionSettings({ minimumBundleRelaySuccesses: 2, mode: 'private', relayUrls: ['https://one.example', 'https://two.example'] }).minimumBundleRelaySuccesses).toBe(2)
		expect(() => validateSubmissionSettings({ minimumBundleRelaySuccesses: 2, mode: 'private', relayUrls: ['https://one.example'] })).toThrow('Minimum bundle relay successes')
		expect(() => validateSubmissionSettings({ mode: 'private', relayUrls: [] })).toThrow('at least one relay')
		expect(() => validateSubmissionSettings({ mode: 'private', relayUrls: ['http://relay.example'] })).toThrow('HTTPS')
		expect(() => validateSubmissionSettings({ mode: 'private', relayUrls: ['https://user:secret@relay.example'] })).toThrow('credentials')
		expect(() => validateSubmissionSettings({ mode: 'private', relayUrls: ['https://relay.example?api-key=secret'] })).toThrow('query parameters')
		expect(() => validateSubmissionSettings({ mode: 'private', relayUrls: ['https://relay.example?'] })).toThrow('query parameters')
		expect(() => validateSubmissionSettings({ mode: 'private', relayUrls: ['https://relay.example#'] })).toThrow('fragments')
		expect(() => validateSubmissionSettings({ mode: 'private', relayUrls: ['https://relay.example', 'https://relay.example?'] })).toThrow('query parameters')
	})

	test('does not include rejected relay endpoint secrets in validation errors', () => {
		expect(() => validateSubmissionSettings({ mode: 'private', relayUrls: ['not-a-url?token=RELAY_SECRET'] })).toThrow(/^Invalid relay URL$/)
		expect(() => validateSubmissionSettings({ mode: 'private', relayUrls: ['ftp://user:RELAY_SECRET@relay.example/private?key=HIDDEN'] })).toThrow(/^Relay URL must use HTTPS or loopback HTTP$/)
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
					stateBlockNumber: 99,
					totalGasUsed: 51_000,
				},
			})
		})
		const result = await simulateBundle(endpoint, transactions)
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
					stateBlockNumber: 99,
					totalGasUsed: 51_000,
				},
			}),
		)
		await expect(simulateBundle(endpoint, transactions)).rejects.toThrow('Bundle simulation reverted')
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
				result: { bundleHash: expectedBundleHash(transactions), results, stateBlockNumber: 99, totalGasUsed: 51_000 },
			}),
		)
		await expect(simulateBundle(endpoint, transactions)).rejects.toThrow()
	})

	test.each([
		// A valid-looking hash for another bundle.
		{ bundleHash: hash, results: [{ gasUsed: 21_000, txHash: keccak256(serializedTransaction) }], stateBlockNumber: 99, totalGasUsed: 21_000 },
		// A missing or stale simulation state block for requested block 99.
		{ bundleHash: expectedBundleHash([serializedTransaction]), results: [{ gasUsed: 21_000, txHash: keccak256(serializedTransaction) }], stateBlockNumber: undefined, totalGasUsed: 21_000 },
		{ bundleHash: expectedBundleHash([serializedTransaction]), results: [{ gasUsed: 21_000, txHash: keccak256(serializedTransaction) }], stateBlockNumber: 98, totalGasUsed: 21_000 },
		// Incomplete or inconsistent simulation gas.
		{ bundleHash: expectedBundleHash([serializedTransaction]), results: [{ txHash: keccak256(serializedTransaction) }], stateBlockNumber: 99, totalGasUsed: 0 },
		{ bundleHash: expectedBundleHash([serializedTransaction]), results: [{ gasUsed: 'invalid', txHash: keccak256(serializedTransaction) }], stateBlockNumber: 99, totalGasUsed: 21_000 },
		{ bundleHash: expectedBundleHash([serializedTransaction]), results: [{ gasUsed: 21_000, txHash: keccak256(serializedTransaction) }], stateBlockNumber: 99, totalGasUsed: 20_999 },
	])('rejects a simulation result bound to another bundle, state block, or gas total %#', async result => {
		const endpoint = relay(() => Response.json({ id: 1, jsonrpc: '2.0', result }))
		await expect(simulateBundle(endpoint)).rejects.toThrow()
	})

	test.each([
		{ id: 2, jsonrpc: '2.0', result: { results: [{ gasUsed: 21_000 }], totalGasUsed: 21_000 } },
		{ id: 1, jsonrpc: '1.0', result: { results: [{ gasUsed: 21_000 }], totalGasUsed: 21_000 } },
		{ id: 1, jsonrpc: '2.0' },
		{ error: { code: -32_000, message: 'rejected' }, id: 1, jsonrpc: '2.0', result: { results: [{ gasUsed: 21_000 }], totalGasUsed: 21_000 } },
	])('rejects malformed JSON-RPC simulation envelope %#', async response => {
		const endpoint = relay(() => Response.json(response))
		await expect(simulateBundle(endpoint)).rejects.toThrow()
	})

	test('uses successfully simulated relays when another configured relay rejects the bundle', async () => {
		const accepted = acceptingSimulationRelay()
		const rejected = rejectingRelay('bundle reverted')
		const result = await simulateEveryRelay([accepted, rejected])
		expect(result).toMatchObject({
			failedTargets: [{ error: expect.stringContaining('bundle reverted'), target: rejected }],
			successful: [{ relayUrl: accepted, simulation: { totalGasUsed: 21_000n } }],
		})
	})

	test('enforces the configured successful relay simulation threshold', async () => {
		await expect(simulateEveryRelay([acceptingSimulationRelay(), rejectingRelay('bundle reverted')], 2)).rejects.toThrow('required 2 successful relays')
	})

	test('counts distinct relay origins toward the successful simulation threshold', async () => {
		const acceptedOrigin = acceptingSimulationRelay()
		await expect(simulateEveryRelay([`${acceptedOrigin}/one`, `${acceptedOrigin}/two`, rejectingRelay('bundle reverted')], 2)).rejects.toThrow('received 1 distinct relay origin')
	})

	test('fans one ordered bundle out to every configured relay without allowed reverts', async () => {
		const requests: unknown[] = []
		const transactions = [serializedTransaction, '0x1234'] as const
		const accepted = relay(async request => {
			requests.push(await request.json())
			return Response.json({ id: 1, jsonrpc: '2.0', result: { bundleHash: expectedBundleHash(transactions) } })
		})
		const result = await submitBundle([accepted], undefined, transactions)
		expect(result.acceptedTargets).toEqual([accepted])
		expect(requests).toEqual([
			{
				id: 1,
				jsonrpc: '2.0',
				method: 'eth_sendBundle',
				params: [{ blockNumber: '0x64', txs: [serializedTransaction, '0x1234'] }],
			},
		])
	})

	test('enforces the configured successful relay threshold during bundle submission', async () => {
		await expect(submitBundle([acceptingBundleRelay(), rejectingRelay('submission rejected')], 2)).rejects.toThrow('required 2 accepting relays')
	})

	test('counts distinct relay origins toward the successful bundle submission threshold', async () => {
		const acceptedOrigin = acceptingBundleRelay()
		await expect(submitBundle([`${acceptedOrigin}/one`, `${acceptedOrigin}/two`, rejectingRelay('submission rejected')], 2)).rejects.toThrow('received 1 distinct relay origin')
	})

	test.each(['', 'bundle', '0x1234', hash])('rejects malformed or foreign relay bundle hash %p', async bundleHash => {
		const endpoint = relay(() => Response.json({ id: 1, jsonrpc: '2.0', result: { bundleHash } }))
		await expect(submitBundle([endpoint])).rejects.toThrow('Every private relay rejected the bundle')
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
		expect(parsed.maxFeePerGas).toBe(maximumFeePerGas(10n * 10n ** 9n))
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
		const rejected = rejectingRelay('relay unavailable', { status: 503 })
		const result = await submitPrivately(privateSettings([accepted, rejected]))
		expect(result.mode).toBe('private')
		expect(result.acceptedTargets).toEqual([accepted])
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

	test('enforces the configured acceptance threshold for private transactions', async () => {
		const accepted = relay(() => Response.json({ id: 1, jsonrpc: '2.0', result: hash }))
		await expect(submitPrivately(privateSettings([accepted, rejectingRelay('relay unavailable')], 2), { publicRpcUrls: [] })).rejects.toThrow('required 2 accepting relays')
	})

	test('counts distinct relay origins toward the private transaction acceptance threshold', async () => {
		const acceptedOrigin = relay(() => Response.json({ id: 1, jsonrpc: '2.0', result: hash }))
		await expect(submitPrivately(privateSettings([`${acceptedOrigin}/one`, `${acceptedOrigin}/two`, rejectingRelay('relay unavailable')], 2), { publicRpcUrls: [] })).rejects.toThrow('received 1 distinct relay origin')
	})

	test.each([0, -1, 1.5, 2])('rejects an unvalidated private relay threshold of %p before submission', async minimumBundleRelaySuccesses => {
		let relayRequests = 0
		const accepted = relay(() => {
			relayRequests += 1
			return Response.json({ id: 1, jsonrpc: '2.0', result: hash })
		})
		await expect(submitPrivately({ minimumBundleRelaySuccesses, mode: 'private', relayUrls: [accepted] }, { publicRpcUrls: [] })).rejects.toThrow('Minimum bundle relay successes must be an integer between 1 and the configured private relay count')
		expect(relayRequests).toBe(0)
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
		await expect(submitPrivately(privateSettings([endpoint]))).rejects.toThrow('Every private relay rejected the transaction')
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
			acceptedTargets: ['https://rpc-a.example'],
			// A transport failure is not a refusal: the node may still hold the transaction.
			failedTargets: [{ error: 'RPC unavailable', rejected: false, target: 'https://rpc-b.example' }],
			hash,
			mode: 'public',
		})
	})

	test('does not let a stalled relay block an accepted private submission', async () => {
		const accepted = relay(() => Response.json({ id: 1, jsonrpc: '2.0', result: hash }))
		const stalled = relay(() => new Promise<Response>(() => undefined))
		const result = await submitPrivately(privateSettings([accepted, stalled]), { relayTimeoutMilliseconds: 20 })
		expect(result.acceptedTargets).toEqual([accepted])
		expect(result.failedTargets).toHaveLength(1)
		expect(result.failedTargets[0]?.target).toBe(stalled)
		expect(result.failedTargets[0]?.error?.toLowerCase()).toContain('timed out')
	})

	test('does not follow relay redirects outside the validated target set', async () => {
		let destinationRequests = 0
		const destination = relay(() => {
			destinationRequests += 1
			return Response.json({ id: 1, jsonrpc: '2.0', result: hash })
		})
		const redirecting = relay(() => Response.redirect(destination, 307))
		await expect(submitPrivately(privateSettings([redirecting]))).rejects.toThrow('Every private relay rejected')
		expect(destinationRequests).toBe(0)
	})

	test('fails closed when every private relay rejects the transaction', async () => {
		const rejected = rejectingRelay('rejected')
		const error: unknown = await submitPrivately(privateSettings([rejected])).then(
			() => new Error('Expected private relay submission to fail'),
			(failure: unknown) => failure,
		)
		expect(error).toBeInstanceOf(SubmissionFailure)
		if (!(error instanceof SubmissionFailure)) throw error
		expect(error.message).toContain('Every private relay rejected')
		expect(error.failedTargets).toEqual([{ error: 'RPC -32000: rejected', target: rejected }])
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
