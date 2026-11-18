import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { test_statoblast_SecurityPoolMaturityMapHarness_SecurityPoolMaturityMapHarness as artifact } from '../../types/contractArtifact'
import { deployContract } from '../../testSupport/deployContract'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

const maximumTime = 2 ** 48 - 1
const maximumWeight = (1n << 256n) - 1n

describe('Statoblast maturity index', () => {
	const node = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	const target = () => ({ abi: artifact.abi, address })
	const add = async (root: bigint, key: number, units: bigint, correction: bigint) => {
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'add', args: [root, key, units, correction] }))
	}
	const get = async (root: bigint, key: number) => [...(await client.readContract({ ...target(), functionName: 'get', args: [root, key] }))]
	const prefix = async (root: bigint, cutoff: number) => [...(await client.readContract({ ...target(), functionName: 'prefix', args: [root, cutoff] }))]
	const total = (root: bigint) => client.readContract({ ...target(), functionName: 'total', args: [root] })
	const storedRoot = (root: bigint) => client.readContract({ ...target(), functionName: 'roots', args: [root] })

	beforeAll(async () => {
		const ethereum = node.getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		address = await deployContract(client, encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` }))
		await node.setBaselineSnapshot()
	})

	test('prefixes include the exact cutoff across all four radix children', async () => {
		const entries = [7, 4, 6, 5, maximumTime]
		for (const [index, key] of entries.entries()) await add(BigInt(index), key, BigInt(index + 1), BigInt(index + 10))
		const root = BigInt(entries.length)
		for (const cutoff of [0, 3, 4, 5, 6, 7, 8, maximumTime - 1, maximumTime]) {
			let units = 0n
			let correction = 0n
			for (const [index, key] of entries.entries()) {
				if (key > cutoff) continue
				units += BigInt(index + 1)
				correction += BigInt(index + 10)
			}
			expect(await prefix(root, cutoff)).toEqual([units, correction])
		}
		expect(await get(root, maximumTime - 1)).toEqual([0n, 0n])
		expect(await get(root, maximumTime)).toEqual([5n, 14n])
		expect(await total(root)).toBe(15n)
	})

	test('zero keys and zero deltas keep the original root', async () => {
		await add(0n, 9, 0n, 5n)
		await add(1n, 0, 12n, 34n)
		await add(2n, maximumTime, 0n, 0n)
		expect(await storedRoot(2n)).toBe(await storedRoot(1n))
		expect(await storedRoot(3n)).toBe(await storedRoot(1n))
		expect(await prefix(3n, maximumTime)).toEqual([0n, 5n])
	})

	test('modular changes delete empty nodes without modifying parent or sibling roots', async () => {
		await add(0n, 4, maximumWeight, 3n)
		await add(1n, 5, 2n, maximumWeight)
		expect(await prefix(2n, 5)).toEqual([1n, 2n])
		await add(2n, 4, 1n, maximumWeight - 2n)
		await add(2n, 5, maximumWeight - 1n, 1n)
		expect(await get(3n, 4)).toEqual([0n, 0n])
		expect(await prefix(3n, maximumTime)).toEqual([2n, maximumWeight])
		expect(await get(4n, 5)).toEqual([0n, 0n])
		expect(await prefix(4n, maximumTime)).toEqual([maximumWeight, 3n])
		expect(await prefix(2n, maximumTime)).toEqual([1n, 2n])
		await add(3n, 5, maximumWeight - 1n, 1n)
		expect(await storedRoot(5n)).toBe(0n)
		expect(await get(1n, 4)).toEqual([maximumWeight, 3n])
	})

	test('mixed updates across branches match independent prefix sums', async () => {
		const keys = [1, 2, 4, 5, 40, 3 * 86_400, 364 * 86_400, 2 ** 36, maximumTime - 4, maximumTime]
		const snapshots = [new Map<number, readonly [bigint, bigint]>()]
		for (let index = 0; index < 32; index++) {
			const parent = index % 5 === 4 ? index - 3 : index
			const key = keys[(index * 7) % keys.length]
			const previous = snapshots[parent]
			if (key === undefined || previous === undefined) throw new Error('Invalid maturity test fixture')

			const [oldUnits, oldCorrection] = previous.get(key) ?? [0n, 0n]
			const units = index % 3 === 0 ? -oldUnits : BigInt(index + 1)
			const correction = index % 3 === 0 ? -oldCorrection : BigInt(2 * index + 1)
			const expected = new Map(previous)
			const nextBalance = [oldUnits + units, oldCorrection + correction] as const
			expected.set(key, nextBalance)
			snapshots.push(expected)
			await add(BigInt(parent), key, BigInt.asUintN(256, units), BigInt.asUintN(256, correction))

			const root = BigInt(index + 1)
			expect(await get(root, key)).toEqual([...nextBalance])
			for (const cutoff of [key - 1, key, maximumTime]) {
				let totalUnits = 0n
				let totalCorrection = 0n
				for (const [deadline, [entryUnits, entryCorrection]] of expected) {
					if (deadline > cutoff) continue
					totalUnits += entryUnits
					totalCorrection += entryCorrection
				}
				expect(await prefix(root, cutoff)).toEqual([totalUnits, totalCorrection])
			}
			expect(await get(BigInt(parent), key)).toEqual([oldUnits, oldCorrection])
		}
	})

	test('a full-width radix path fits the index update budget', async () => {
		await add(0n, 1, 10n, 20n)
		// Place one entry in each two-bit range of the uint48 key space.
		for (let level = 0; level < 24; level++) await add(BigInt(level + 1), 2 ** (2 * level + 1), 1n, 2n)
		const hash = await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'add', args: [25n, 1, 1n, 1n] }))
		const { gasUsed } = await client.getTransactionReceipt({ hash })
		expect(gasUsed).toBeLessThan(2_500_000n)
		expect(await prefix(25n, 1)).toEqual([10n, 20n])
		expect(await prefix(26n, 1)).toEqual([11n, 21n])
		expect(await prefix(26n, maximumTime)).toEqual([35n, 69n])
	})
})
