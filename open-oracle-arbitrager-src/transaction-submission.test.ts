import { afterEach, describe, expect, test } from 'bun:test'
import { keccak256, parseTransaction, privateKeyToAccount, type Address, type Hex } from '@zoltar/shared/ethereum'
import { assertSubmissionWindowOpen, mergeSubmissionFailures, prepareSignedTransaction, SubmissionFailure, submitSignedTransaction, validateSubmissionSettings } from './transaction-submission.js'

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
	})
})

describe('signed transaction delivery', () => {
	test('prepares one canonical EIP-1559 transaction with pending nonce and gas margin', async () => {
		const account = privateKeyToAccount(privateKey)
		if (account.signTransaction === undefined) throw new Error('Local signer missing')
		const prepared = await prepareSignedTransaction({
			baseFeePerGas: 10n * 10n ** 9n,
			blockNumber: 100n,
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
			data: '0x1234' as Hex,
			from: account.address,
			gasEstimate: 100_000n,
			lastValidBlockNumber: 101n,
			nonce: 7n,
			signTransaction: account.signTransaction,
			to: address,
		}
		const prepared = await prepareSignedTransaction(parameters)
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

	test('submits directly to the public mempool without contacting relays', async () => {
		let submitted: Hex | undefined
		const result = await submitSignedTransaction({
			address,
			hash,
			maxBlockNumber: 125n,
			publicSubmit: transaction => {
				submitted = transaction
				return Promise.resolve(hash)
			},
			serializedTransaction,
			settings: validateSubmissionSettings({ mode: 'public', relayUrls: ['https://relay.flashbots.net'] }),
			signMessage: () => Promise.reject(new Error('must not sign relay payload')),
		})
		expect(submitted).toBe(serializedTransaction)
		expect(result).toEqual({
			acceptedTargets: ['public mempool'],
			failedTargets: [],
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

	test('fails closed when every private relay rejects the transaction', async () => {
		const rejected = relay(() => Response.json({ error: { code: -32_000, message: 'rejected' }, id: 1, jsonrpc: '2.0' }))
		try {
			await submitSignedTransaction({
				address,
				hash,
				maxBlockNumber: 125n,
				publicSubmit: () => Promise.reject(new Error('must not use public RPC')),
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
