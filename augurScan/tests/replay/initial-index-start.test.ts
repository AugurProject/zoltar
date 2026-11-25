import { expect, mock, test } from 'bun:test'
import { initialIndexStartBlock } from '../../src/indexer.ts'
import type { Address } from '../../src/ethereum.ts'

const address = '0x1000000000000000000000000000000000000001' as const

test('retains the configured first block when the head has just reached it', async () => {
	expect(await initialIndexStartBlock([[address, 'OpenOracle', 'openOracle']], 97n, 97n, async () => undefined)).toBe(97n)
})

test('starts a fresh index at the earliest tracked contract deployment', async () => {
	const secondAddress = '0x2000000000000000000000000000000000000002' as const
	const helperAddress = '0x3000000000000000000000000000000000000003' as const
	const searches: Address[] = []
	expect(
		await initialIndexStartBlock(
			[
				[address, 'OpenOracle', 'openOracle'],
				[secondAddress, 'Zoltar', 'zoltar'],
				[helperAddress, 'Multicall3', 'multicall3'],
			],
			0n,
			1_000n,
			async candidate => {
				searches.push(candidate)
				return { block: candidate === address ? 750n : 800n, exact: true }
			},
		),
	).toBe(750n)
	expect(searches).toEqual([address, secondAddress])
})

test('starts fresh log coverage at the configured floor for an inexact deployment bound', async () => {
	expect(await initialIndexStartBlock([[address, 'OpenOracle', 'openOracle']], 10n, 100n, async () => ({ block: 50n, exact: false }))).toBe(10n)
})

test('does not let an earlier Multicall3 helper widen fresh history', async () => {
	const multicall = '0x2000000000000000000000000000000000000002' as const
	expect(
		await initialIndexStartBlock(
			[
				[multicall, 'Multicall3', 'multicall3'],
				[address, 'Zoltar', 'zoltar'],
			],
			0n,
			1_000n,
			async candidate => ({ block: candidate === multicall ? 100n : 750n, exact: true }),
		),
	).toBe(750n)
})

test('waits at the next block when no tracked contract is deployed yet', async () => {
	expect(await initialIndexStartBlock([[address, 'OpenOracle', 'openOracle']], 0n, 1_000n, async () => undefined)).toBe(1_001n)
})

test('honors a configured future start without attempting deployment discovery', async () => {
	const detection = mock(async () => ({ block: 750n, exact: true }))
	expect(await initialIndexStartBlock([[address, 'OpenOracle', 'openOracle']], 1_001n, 1_000n, detection)).toBe(1_001n)
	expect(detection).not.toHaveBeenCalled()
})
