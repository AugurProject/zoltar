import { beforeAll, describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { test_statoblast_TimestampMapHarness_TimestampMapHarness as harness } from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

type Entry = { value: bigint; weight: bigint }
const maximumTimestamp = 2 ** 48 - 1
const maximumWeight = (1n << 256n) - 1n

describe('Statoblast timestamp schedule map', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	const target = () => ({ abi: harness.abi, address })
	const read = async (index: bigint, key: number, frozen = false, modular = false): Promise<readonly [bigint, bigint, bigint, bigint]> => {
		const [value, floor, prefix, total] = await client.readContract({ ...target(), functionName: 'read', args: [index, key, frozen, modular] })
		return [value, floor, prefix, total]
	}
	const set = (scope: bigint, key: number, value: bigint, weight = value, modular = false) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'set', args: [scope, key, value, weight, modular] }))
	const seal = (scope: bigint, snapshot: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'seal', args: [scope, snapshot] }))
	const inherit = (scope: bigint, snapshot: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'inheritSnapshot', args: [scope, snapshot] }))

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const hash = await client.sendTransaction({ data: `0x${harness.evm.bytecode.object}` })
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === undefined) throw new Error('Timestamp map harness deployment address missing')
		address = receipt.contractAddress
		await setBaselineSnapshot()
	})

	test('exact point, floor and prefix reads match ordered entries across every digit and independent fork writers', async () => {
		const write = async (scope: bigint, model: Map<number, Entry>, key: number, value: bigint, weight = value) => {
			await set(scope, key, value, weight)
			if (value === 0n) model.delete(key)
			else model.set(key, { value, weight })
		}
		const compare = async (index: bigint, model: Map<number, Entry>, keys: readonly number[], frozen = false) => {
			const entries = [...model].sort(([left], [right]) => left - right)
			const total = entries.reduce((sum, [, item]) => sum + item.weight, 0n)
			for (const key of keys) {
				const prefix = entries.filter(([candidate]) => candidate <= key)
				expect(await read(index, key, frozen)).toEqual([model.get(key)?.value ?? 0n, prefix.at(-1)?.[1].value ?? 0n, prefix.reduce((sum, [, item]) => sum + item.weight, 0n), total])
			}
		}
		const parent = new Map<number, Entry>()
		await compare(1n, parent, [0, maximumTimestamp])
		const digitKeys = Array.from({ length: 16 }, (_, digit) => 8 ** digit)
		const cutoffs = [0, ...digitKeys.flatMap(key => [key - 1, key, key + 1]), maximumTimestamp - 1, maximumTimestamp]
		await write(1n, parent, 0, 1n, 0n)
		for (const [index, key] of digitKeys.entries()) await write(1n, parent, key, BigInt(index + 2), BigInt(index + 10))
		for (let digit = 2; digit < 8; digit++) await write(1n, parent, digit * 8 ** 15, BigInt(digit))
		await write(1n, parent, maximumTimestamp, 90n)
		await compare(1n, parent, cutoffs)
		await seal(1n, 1n)
		const original = new Map(parent)
		const left = new Map(parent)
		const right = new Map(parent)
		await inherit(2n, 1n)
		await inherit(3n, 1n)

		await write(1n, parent, 0, 100n)
		await write(1n, parent, 0, 101n)
		await write(2n, left, 0, 200n)
		await write(3n, right, 0, 300n)
		await write(3n, right, 7, 301n, 0n)
		for (const key of digitKeys) await write(2n, left, key, 0n)
		await write(2n, left, 7, 0n)
		for (const [index, model] of [
			[1n, parent],
			[2n, left],
			[3n, right],
		] as const) {
			await compare(index, model, [...cutoffs, 6, 7])
		}
		await compare(1n, original, cutoffs, true)

		await seal(2n, 2n)
		await inherit(4n, 2n)
		const grandchild = new Map(left)
		await write(4n, grandchild, maximumTimestamp, 0n)
		await compare(4n, grandchild, [0, maximumTimestamp])
		await compare(2n, left, [0, maximumTimestamp], true)
	})

	test('checked overflow rolls back and modular prefixes retain wrapped historical weights', async () => {
		await set(1n, 1, 1n, maximumWeight)
		expect(await read(1n, 0)).toEqual([0n, 0n, 0n, maximumWeight])
		await expect(set(1n, 2, 2n, 1n)).rejects.toThrow()
		expect(await read(1n, 2)).toEqual([0n, 1n, maximumWeight, maximumWeight])

		await set(2n, 1, 1n, maximumWeight, true)
		await set(2n, 2, 2n, 2n, true)
		expect(await read(2n, 1, false, true)).toEqual([1n, 1n, maximumWeight, 1n])
		expect(await read(2n, 2, false, true)).toEqual([2n, 2n, 1n, 1n])
		await seal(2n, 1n)
		await set(2n, 2, 0n, 0n, true)
		expect(await read(2n, 2, false, true)).toEqual([0n, 1n, maximumWeight, maximumWeight])
		expect(await read(1n, 2, true, true)).toEqual([2n, 2n, 1n, 1n])
	})
})
