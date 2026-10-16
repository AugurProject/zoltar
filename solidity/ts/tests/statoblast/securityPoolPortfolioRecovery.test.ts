import { beforeAll, describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolPortfolioRecovery_SecurityPoolPortfolioRecovery as artifact } from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

describe('Statoblast: aggregate allocation recovery accounting', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let ledger: Address
	const alice = addressString(TEST_ADDRESSES[0])
	const bob = addressString(TEST_ADDRESSES[1])
	const precision = 10n ** 36n
	const target = () => ({ abi: artifact.abi, address: ledger })
	const append = async () => await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'appendPosition' }))
	const balance = async (owner: Address, shares: bigint, generation = 1n) => await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'setOwnerBalance', args: [owner, generation, shares] }))
	const credit = async (position: bigint, rep: bigint, eth: bigint, denominator: bigint) => await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'credit', args: [position, rep, eth, denominator] }))
	const interval = async (owner: Address, id = 0n) => await client.readContract({ ...target(), functionName: 'getOwnerInterval', args: [owner, id] })
	const count = async (owner: Address) => await client.readContract({ ...target(), functionName: 'getOwnerIntervalCount', args: [owner] })
	const preview = async (owner: Address, id = 0n) => [...(await client.readContract({ ...target(), functionName: 'claimableInterval', args: [owner, id] }))]
	const claim = async (owner: Address, ids = [0n]) => {
		const result = await client.readContract({ ...target(), functionName: 'claim', args: [owner, ids], account: client.account.address })
		expect(await client.readContract({ ...target(), functionName: 'previewClaim', args: [owner, ids] })).toEqual(result)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'claim', args: [owner, ids] }))
		return [...result]
	}
	const exclude = async (owner: Address, id: bigint, position: bigint) => await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'excludePosition', args: [owner, id, position] }))
	const closeGeneration = async (generation: bigint) => await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'closeGeneration', args: [generation] }))

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: `0x${artifact.evm.bytecode.object}` }) })
		if (receipt.contractAddress === undefined) throw new Error('Recovery ledger deployment address missing')
		ledger = receipt.contractAddress
		await setBaselineSnapshot()
	})

	test('tree growth preserves prior recoveries and supports repeated out-of-order credits', async () => {
		await balance(alice, 100n)
		await append()
		await credit(1n, 11n, 7n, 100n)
		await append()
		await credit(2n, 13n, 9n, 100n)
		await append()
		await append()
		await credit(4n, 17n, 3n, 100n)
		await credit(1n, 19n, 5n, 100n)
		await credit(3n, 23n, 11n, 100n)
		expect(await preview(alice)).toEqual([83n, 35n])
		await expect(claim(alice, [0n, 0n])).rejects.toThrow('Choose increasing owner intervals')
		await expect(client.readContract({ ...target(), functionName: 'previewClaim', args: [alice, [0n, 0n]] })).rejects.toThrow('Choose increasing owner intervals')
		expect(await claim(alice)).toEqual([83n, 35n])
		expect(await claim(alice)).toEqual([0n, 0n])
		await credit(2n, 29n, 13n, 100n)
		expect(await claim(alice)).toEqual([29n, 13n])
	})

	test('new deposits do not acquire old allocations and other-owner churn adds no victim intervals', async () => {
		await balance(alice, 100n)
		await append()
		await balance(bob, 100n)
		await append()
		await balance(bob, 0n)
		await append()
		await balance(bob, 200n)
		await append()
		await credit(4n, 90n, 60n, 300n)
		await credit(1n, 70n, 20n, 100n)
		await credit(3n, 50n, 30n, 100n)
		await credit(2n, 80n, 40n, 200n)
		expect(await count(alice)).toBe(1n)
		expect(await count(bob)).toBe(2n)
		expect(await claim(alice)).toEqual([190n, 90n])
		expect(await claim(bob, [0n, 1n])).toEqual([100n, 60n])
	})

	test('personal balance changes preserve late returns after withdrawing all idle shares', async () => {
		await balance(alice, 100n)
		await append()
		await balance(alice, 40n)
		await append()
		await balance(alice, 0n)
		await append()
		await credit(3n, 1_000n, 1_000n, 100n)
		await credit(2n, 30n, 10n, 40n)
		await credit(1n, 70n, 20n, 100n)
		expect(await claim(alice, [1n])).toEqual([30n, 10n])
		expect(await claim(alice, [0n])).toEqual([70n, 20n])
		await credit(1n, 9n, 3n, 100n)
		expect(await claim(alice, [0n, 1n])).toEqual([9n, 3n])
	})

	test('generation closure bounds untouched owners and later re-entry creates only their next interval', async () => {
		await balance(alice, 100n)
		await append()
		await closeGeneration(1n)
		await balance(bob, 200n, 2n)
		await append()
		await closeGeneration(2n)
		await balance(alice, 50n, 3n)
		await append()
		await credit(3n, 30n, 3n, 50n)
		await credit(1n, 10n, 1n, 100n)
		await credit(2n, 20n, 2n, 200n)
		expect(await count(alice)).toBe(2n)
		expect((await interval(alice)).endPosition).toBe(1n)
		expect((await interval(alice)).open).toBe(false)
		expect(await claim(alice, [0n, 1n])).toEqual([40n, 4n])
		expect(await claim(bob)).toEqual([20n, 2n])
	})

	test('an in-kind exit excludes only its leaf and preserves earlier proceeds without duplicate payment', async () => {
		await balance(alice, 60n)
		await balance(bob, 40n)
		for (let index = 0; index < 3; index++) await append()
		await credit(1n, 100n, 10n, 100n)
		await credit(2n, 200n, 20n, 100n)
		await credit(3n, 300n, 30n, 100n)
		await exclude(alice, 0n, 2n)
		expect((await interval(alice, 0n)).active).toBe(false)
		expect(await count(alice)).toBe(3n)
		expect(await claim(alice, [])).toEqual([360n, 36n])
		await credit(2n, 100n, 10n, 40n)
		await credit(1n, 50n, 5n, 100n)
		await credit(3n, 50n, 5n, 100n)
		await append()
		await credit(4n, 100n, 10n, 100n)
		expect(await claim(alice, [1n, 2n])).toEqual([120n, 12n])
		expect(await claim(bob)).toEqual([420n, 42n])
		await expect(exclude(alice, 0n, 2n)).rejects.toThrow('Owner interval retired')
		await expect(exclude(alice, 1n, 2n)).rejects.toThrow('Allocation outside owner interval')
	})

	test('excluding the newest leaf preserves future ownership and respects the next balance change', async () => {
		await balance(alice, 100n)
		await append()
		await exclude(alice, 0n, 1n)
		expect((await interval(alice, 1n)).startPosition).toBe(2n)
		await balance(alice, 50n)
		expect(await count(alice)).toBe(2n)
		await append()
		await credit(1n, 100n, 10n, 100n)
		await credit(2n, 50n, 5n, 50n)
		expect(await claim(alice, [1n])).toEqual([50n, 5n])
	})

	test('splitting an expired generation cannot reopen rights to later allocations', async () => {
		await balance(alice, 50n)
		await balance(bob, 50n)
		await append()
		await append()
		await closeGeneration(1n)
		await balance(bob, 100n, 2n)
		await append()
		await exclude(alice, 0n, 1n)
		const remainder = await interval(alice, 1n)
		expect(remainder.open).toBe(false)
		expect(remainder.endPosition).toBe(2n)
		await credit(3n, 1_000n, 100n, 100n)
		await credit(2n, 100n, 10n, 100n)
		await credit(1n, 100n, 10n, 50n)
		expect(await claim(alice, [1n])).toEqual([50n, 5n])
		expect(await claim(bob, [0n, 1n])).toEqual([1_150n, 115n])
	})

	test('fractional rewards survive repeated claims and sum across personal intervals', async () => {
		await balance(alice, 1n)
		await balance(bob, 2n)
		await append()
		await credit(1n, 1n, 1n, 3n)
		expect(await claim(alice)).toEqual([0n, 0n])
		await balance(alice, 2n)
		await append()
		await credit(2n, 1n, 1n, 4n)
		expect(await claim(alice, [1n])).toEqual([0n, 0n])
		await credit(1n, 2n, 2n, 3n)
		expect(await claim(alice, [0n, 1n])).toEqual([1n, 1n])
		expect(await claim(bob)).toEqual([2n, 2n])
		await credit(2n, 1n, 1n, 4n)
		expect(await claim(alice, [0n, 1n])).toEqual([1n, 1n])
		expect(await claim(bob)).toEqual([1n, 1n])
	})

	test('in-kind exits conserve proportional index carry before changing the remaining denominator', async () => {
		await balance(alice, precision / 2n)
		await balance(bob, precision / 4n)
		await append()
		await credit(1n, 1n, 1n, (3n * precision) / 4n)
		await exclude(alice, 0n, 1n)
		await credit(1n, 1n, 1n, precision / 4n)
		await exclude(bob, 0n, 1n)
		expect(await claim(alice, [])).toEqual([0n, 0n])
		expect(await claim(bob, [])).toEqual([1n, 1n])
		const aliceCredits = await client.readContract({ ...target(), functionName: 'ownerCredits', args: [alice] })
		const bobCredits = await client.readContract({ ...target(), functionName: 'ownerCredits', args: [bob] })
		expect(aliceCredits[2]).toBe((2n * precision) / 3n)
		expect(aliceCredits[2] + bobCredits[2]).toBe(precision)
		expect(aliceCredits[3] + bobCredits[3]).toBe(precision)
		expect(await claim(bob, [])).toEqual([0n, 0n])
	})

	test('a sole owner in-kind exit preserves one atto of REP and ETH across both rounding stages', async () => {
		const shares = 240n * 10n ** 18n + 1n
		await balance(alice, shares)
		await append()
		await credit(1n, 1n, 1n, shares)
		expect(await claim(alice)).toEqual([0n, 0n])
		await exclude(alice, 0n, 1n)
		expect(await claim(alice, [])).toEqual([1n, 1n])
	})

	test('terminal index dust remains fractional when no whole cash entitlement can be paid', async () => {
		const shares = 240n * 10n ** 18n + 1n
		await balance(alice, shares)
		await append()
		await credit(1n, 1n, 1n, shares)
		expect(await claim(alice)).toEqual([0n, 0n])
		expect(await claim(alice)).toEqual([0n, 0n])
		const credits = await client.readContract({ ...target(), functionName: 'ownerCredits', args: [alice] })
		const unassignedIndexFraction = precision % shares
		expect(unassignedIndexFraction).toBeGreaterThan(0n)
		expect(credits[2]).toBeLessThan(precision)
		expect(credits[2] + unassignedIndexFraction).toBe(precision)
		expect(credits[3] + unassignedIndexFraction).toBe(precision)
	})

	test('only the portfolio may mutate recovery rights or consume a beneficiary credit', async () => {
		const outsider = createWriteClient(getAnvilWindowEthereum(), TEST_ADDRESSES[1])
		await expect(writeContractAndWait(outsider, () => outsider.writeContract({ ...target(), functionName: 'appendPosition' }))).rejects.toThrow('Only portfolio')
		await expect(writeContractAndWait(outsider, () => outsider.writeContract({ ...target(), functionName: 'setOwnerBalance', args: [bob, 1n, 100n] }))).rejects.toThrow('Only portfolio')
		await balance(alice, 100n)
		await append()
		await credit(1n, 100n, 10n, 100n)
		await expect(writeContractAndWait(outsider, () => outsider.writeContract({ ...target(), functionName: 'claim', args: [alice, [0n]] }))).rejects.toThrow('Only portfolio')
		await expect(writeContractAndWait(outsider, () => outsider.writeContract({ ...target(), functionName: 'excludePosition', args: [alice, 0n, 1n] }))).rejects.toThrow('Only portfolio')
		expect(await claim(alice)).toEqual([100n, 10n])
	})

	test('one owner claim remains one interval after many funded allocations', async () => {
		await balance(alice, 100n)
		for (let position = 1n; position <= 64n; position++) {
			await append()
			await credit(position, position, 1n, 100n)
			await balance(bob, 1n)
			await balance(bob, 0n)
		}
		expect(await count(alice)).toBe(1n)
		expect(await claim(alice)).toEqual([2_080n, 64n])
	})
})
