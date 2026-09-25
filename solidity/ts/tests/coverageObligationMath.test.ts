import { beforeEach, describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { test_statoblast_CoverageObligationMathHarness_CoverageObligationMathHarness } from '../types/contractArtifact'
import { deployContract } from '../testSupport/deployContract'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'

const artifact = test_statoblast_CoverageObligationMathHarness_CoverageObligationMathHarness

describe('assigned coverage arithmetic', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address

	beforeEach(async () => {
		const window = getAnvilWindowEthereum()
		await setupTestAccounts(window)
		client = createWriteClient(window, TEST_ADDRESSES[0])
		address = await deployContract(client, `0x${artifact.evm.bytecode.object}`)
	})

	test('obligations round up and the charged collateral fraction rounds down', async () => {
		for (const [collateral, units, total] of [
			[101n, 1n, 3n],
			[1n, 1n, 2n],
			[100n, 100n, 100n],
			[0n, 0n, 0n],
			[(1n << 200n) + 1n, 1n << 100n, (1n << 150n) + 3n],
		] as const) {
			const obligation = await client.readContract({ address, abi: artifact.abi, functionName: 'obligation', args: [collateral, units, total] })
			const base = await client.readContract({ address, abi: artifact.abi, functionName: 'feeBase', args: [collateral, units, total] })
			expect(obligation).toBe(total === 0n ? 0n : (collateral * units + total - 1n) / total)
			expect(base).toBe(total === 0n ? 0n : (collateral * units) / total)
		}
	})

	test('written-off and unbacked units do not contribute to the fee base', async () => {
		for (const [active, expected] of [
			[0n, 0n],
			[25n, 250n],
			[100n, 1000n],
		] as const) {
			expect(await client.readContract({ address, abi: artifact.abi, functionName: 'feeBase', args: [1000n, active, 100n] })).toBe(expected)
		}
		await expect(client.readContract({ address, abi: artifact.abi, functionName: 'feeBase', args: [1000n, 101n, 100n] })).rejects.toThrow('Active units exceed total')
		await expect(client.readContract({ address, abi: artifact.abi, functionName: 'obligation', args: [1000n, 101n, 100n] })).rejects.toThrow('Obligation units exceed total')
	})

	test('initial issuance and non-integral exchange rates use separate obligation units', async () => {
		for (const [collateral, total, addition, expected] of [
			[0n, 0n, 17n, 17n],
			[7n, 11n, 3n, 5n],
			[3n, 1n, 1n, 1n],
		] as const) {
			expect(await client.readContract({ address, abi: artifact.abi, functionName: 'mintUnits', args: [collateral, total, addition] })).toBe(expected)
		}
		await expect(client.readContract({ address, abi: artifact.abi, functionName: 'mintUnits', args: [0n, 17n, 1n] })).rejects.toThrow('Exhausted collateral epoch')
		await expect(client.readContract({ address, abi: artifact.abi, functionName: 'mintUnits', args: [1n, 0n, 1n] })).rejects.toThrow('Unassigned collateral')
		await expect(client.readContract({ address, abi: artifact.abi, functionName: 'mintUnits', args: [0n, 0n, 0n] })).rejects.toThrow('Zero mint collateral')
		expect(await client.readContract({ address, abi: artifact.abi, functionName: 'mintUnits', args: [1n << 200n, 1n << 150n, (1n << 200n) + 1n] })).toBe((1n << 150n) + 1n)
	})

	test('rounded nonparticipant obligations never increase across atomic reduction and mint sequences', async () => {
		for (let seed = 1n; seed <= 24n; seed++) {
			const additions = Array.from({ length: 24 }, (_, index) => ((seed * BigInt(index + 1)) % 19n) + 1n)
			const reductions = additions.map(value => value - 1n)
			await client.readContract({ address, abi: artifact.abi, functionName: 'checkNonparticipatingSequence', args: [seed, seed * 7n + 1n, seed * 3n, additions, reductions] })
		}
	})
})
