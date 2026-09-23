import { expect, test } from 'bun:test'
import { createPublicClient, custom, getAddress, type BlockTransaction, type Hash, type TransactionReplacement } from '@zoltar/core-shared/evm/ethereum'

const original = {
	from: getAddress('0x00000000000000000000000000000000000000bb'),
	gas: 21_000n,
	hash: `0x${'11'.repeat(32)}`,
	input: '0xabcd',
	nonce: 7n,
	to: getAddress('0x00000000000000000000000000000000000000cc'),
	value: 5n,
} satisfies BlockTransaction
const replacementHash = `0x${'22'.repeat(32)}` satisfies Hash
const quantity = (number: bigint) => `0x${number.toString(16)}`
const blockHash = (number: bigint, fork: boolean): Hash => `0x${(number + (fork ? 10_000n : 1_000n)).toString(16).padStart(64, '0')}`
type ChainState = { head: bigint; forkFrom?: bigint; replacementBlock?: bigint }

function replacementFixture(states: ChainState[], options: { reason?: 'repriced' | 'cancelled' | 'replaced'; onBlock?: (number: bigint, full: boolean, poll: number) => void } = {}) {
	let poll = 0
	let state = states[0]
	const reads: { number: bigint; full: boolean; poll: number }[] = []
	const replacements: TransactionReplacement[] = []
	const hashAt = (number: bigint) => blockHash(number, state?.forkFrom !== undefined && number >= state.forkFrom)
	const client = createPublicClient({
		transport: custom(
			{
				request: async ({ method, params }) => {
					if (method === 'eth_getTransactionReceipt') {
						if (!Array.isArray(params)) throw new Error('Expected receipt params')
						if (params[0] === original.hash) {
							state = states[Math.min(poll, states.length - 1)]
							poll += 1
							return null
						}
						if (params[0] !== replacementHash || state?.replacementBlock === undefined) throw new Error('Unexpected receipt lookup')
						return {
							blockHash: hashAt(state.replacementBlock),
							blockNumber: quantity(state.replacementBlock),
							cumulativeGasUsed: '0x5208',
							from: original.from,
							gasUsed: '0x5208',
							logs: [],
							status: '0x1',
							to: original.to,
							transactionHash: replacementHash,
							transactionIndex: '0x0',
						}
					}
					if (state === undefined) throw new Error('Missing chain state')
					if (method === 'eth_blockNumber') return quantity(state.head)
					if (method === 'eth_getBlockByNumber') {
						if (!Array.isArray(params) || typeof params[0] !== 'string') throw new Error('Expected block params')
						const number = BigInt(params[0])
						const full = params[1] === true
						reads.push({ number, full, poll })
						options.onBlock?.(number, full, poll)
						if (number > state.head) throw new Error('Read above head')
						const replacement = {
							...original,
							hash: replacementHash,
							blockHash: hashAt(number),
							blockNumber: quantity(number),
							transactionIndex: '0x0',
							...(options.reason === 'cancelled' ? { to: original.from, input: '0x', value: 0n } : {}),
							...(options.reason === 'replaced' ? { input: '0xdead' } : {}),
						}
						return {
							hash: hashAt(number),
							number: quantity(number),
							parentHash: hashAt(number - 1n),
							timestamp: '0x5',
							transactions: number === state.replacementBlock ? [full ? replacement : replacementHash] : [],
						}
					}
					throw new Error(`Unexpected RPC method: ${method}`)
				},
			},
			{ retryCount: 0, retryDelay: 0 },
		),
	})
	return {
		reads,
		replacements,
		wait: async (timeout = 200) => await client.waitForTransactionReceipt({ hash: original.hash, transaction: original, onReplaced: replacement => replacements.push(replacement), pollingInterval: 0, timeout }),
	}
}

for (const scenario of [
	{ name: 'unchanged head', head: 20n, forkFrom: 19n, replacementBlock: 19n, firstRescan: 19n },
	{ name: 'advancing head', head: 21n, forkFrom: 19n, replacementBlock: 19n, firstRescan: 19n },
	{ name: 'regressed head', head: 19n, forkFrom: 18n, replacementBlock: 18n, firstRescan: 18n },
	{ name: 'reorg beyond retained history', head: 20n, forkFrom: 0n, replacementBlock: 10n, firstRescan: 8n },
	{ name: 'regression below retained history', head: 5n, forkFrom: 0n, replacementBlock: 2n, firstRescan: 0n },
]) {
	for (const reason of ['repriced', 'cancelled', 'replaced'] as const) {
		test(`replacement scan recovers ${reason} with ${scenario.name}`, async () => {
			const fixture = replacementFixture([{ head: 20n }, scenario], { reason })
			const receipt = await fixture.wait()
			expect(receipt.transactionHash).toBe(replacementHash)
			expect(fixture.replacements.map(replacement => replacement.reason)).toEqual([reason])
			expect(fixture.reads.find(read => read.poll === 2 && read.full)?.number).toBe(scenario.firstRescan)
			for (const poll of [1, 2]) {
				expect(fixture.reads.filter(read => read.poll === poll && read.full).length).toBeLessThanOrEqual(13)
				expect(fixture.reads.filter(read => read.poll === poll && !read.full).length).toBeLessThanOrEqual(14)
			}
		})
	}
}

test('replacement scan verifies an unchanged canonical head without rescanning transaction bodies', async () => {
	const fixture = replacementFixture([{ head: 20n }, { head: 20n }, { head: 21n, replacementBlock: 21n }])
	await fixture.wait()
	expect(fixture.reads.filter(read => read.poll === 2)).toEqual([{ number: 20n, full: false, poll: 2 }])
	expect(fixture.reads.filter(read => read.poll === 3 && read.full).map(read => read.number)).toEqual([21n])
})

test('replacement scan discards a batch reorganized during its final canonicality read', async () => {
	const state: ChainState = { head: 20n }
	let reorganized = false
	const fixture = replacementFixture([state], {
		onBlock: (number, full) => {
			if (number === 20n && !full && !reorganized) {
				reorganized = true
				state.forkFrom = 18n
				state.replacementBlock = 18n
			}
		},
	})
	await fixture.wait()
	expect(reorganized).toBe(true)
	expect(fixture.reads.filter(read => read.number === 18n && read.full)).toHaveLength(2)
	expect(fixture.replacements).toHaveLength(1)
})

test('replacement scan rejects mixed ancestry and retries the bounded range', async () => {
	const state: ChainState = { head: 20n }
	let reorganized = false
	const fixture = replacementFixture([state], {
		onBlock: (number, full) => {
			if (number === 20n && full && !reorganized) {
				reorganized = true
				state.forkFrom = 18n
				state.replacementBlock = 18n
			}
		},
	})
	await fixture.wait()
	expect(fixture.reads.filter(read => read.number === 18n && read.full)).toHaveLength(2)
	expect(fixture.replacements).toHaveLength(1)
})

test('replacement scan keeps deep recovery bounded and does not infer execution outside its window', async () => {
	const fixture = replacementFixture([{ head: 20n }, { head: 20n, forkFrom: 0n, replacementBlock: 7n }])
	await expect(fixture.wait(30)).rejects.toThrow('could not be found')
	expect(fixture.replacements).toHaveLength(0)
	expect(fixture.reads.every(read => read.number >= 8n)).toBe(true)
	expect(fixture.reads.filter(read => read.poll === 2 && read.full)).toHaveLength(13)
})

test('replacement canonicality reads remain subject to the overall deadline', async () => {
	const fixture = replacementFixture([{ head: 20n }], {
		onBlock: (_number, full) => {
			if (!full) throw { code: 429, message: 'canonicality rate limit' }
		},
	})
	await expect(fixture.wait(20)).rejects.toThrow('canonicality rate limit')
	expect(fixture.replacements).toHaveLength(0)
})

test('replacement scan evicts old checkpoints during long waits before bounded recovery', async () => {
	const states: ChainState[] = Array.from({ length: 21 }, (_, index) => ({ head: 20n + BigInt(index) }))
	states.push({ head: 40n, forkFrom: 20n, replacementBlock: 30n })
	const fixture = replacementFixture(states)
	await fixture.wait()
	const recoveryReads = fixture.reads.filter(read => read.poll === 22)
	expect(recoveryReads.every(read => read.number >= 28n)).toBe(true)
	expect(recoveryReads.filter(read => !read.full)).toHaveLength(14)
	expect(recoveryReads.filter(read => read.full).map(read => read.number)).toEqual([28n, 29n, 30n])
})

test('replacement scan retries rate-limited canonicality reads before trusting progress', async () => {
	let failures = 0
	const fixture = replacementFixture([{ head: 20n }, { head: 20n, forkFrom: 19n, replacementBlock: 19n }], {
		onBlock: (number, full, poll) => {
			if (poll === 2 && number === 20n && !full && failures === 0) {
				failures += 1
				throw { code: 429, message: 'canonicality rate limit' }
			}
		},
	})
	await fixture.wait()
	expect(failures).toBe(1)
	expect(fixture.reads.filter(read => read.poll === 2 && read.number === 20n && !read.full)).toHaveLength(2)
	expect(fixture.replacements).toHaveLength(1)
})

test('replacement scan restarts within the supported window after a large head jump', async () => {
	const fixture = replacementFixture([{ head: 20n }, { head: 100n, replacementBlock: 90n }], {
		onBlock: (number, _full, poll) => {
			if (poll === 2 && number < 88n) throw new Error('Historical block unavailable')
		},
	})
	await fixture.wait()
	expect(fixture.reads.filter(read => read.poll === 2 && read.full).map(read => read.number)).toEqual([88n, 89n, 90n])
})
