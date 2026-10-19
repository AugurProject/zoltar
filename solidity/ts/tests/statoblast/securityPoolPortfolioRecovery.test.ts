import { beforeAll, describe, expect, test } from 'bun:test'
import { concatHex, encodeAbiParameters, parseAbi, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolPortfolioRecovery_SecurityPoolPortfolioRecovery as artifact } from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { requireBigInt, setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

const retirementAbi = parseAbi([
	'function markPositionComplete(uint256 positionId)',
	'function positionComplete(uint256 positionId) view returns (bool)',
	'function unfinishedPositionCount() view returns (uint256)',
	'function getOwnerActiveIntervalCount(address owner) view returns (uint256)',
	'function canRetireOwnerInterval(address owner,uint256 intervalId) view returns (bool)',
	'function getOwnerActiveIntervals(address owner,uint256 cursor,uint256 count) view returns (uint256[] intervalIds,uint256 nextCursor)',
	'function setOwnerBalance(address owner,uint256 generation,uint256 shares) returns (uint256)',
	'function closeGeneration(uint256 generation) returns (uint256)',
	'function creditMaintenance(uint256 amount)',
	'function takeMaintenanceReward(uint256 positionId,uint256 cap) returns (uint256)',
	'function claim(address owner,uint256[] intervalIds) returns (uint256 rep,uint256 eth,bool retired)',
])

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
		const amounts = [result[0], result[1]]
		expect([...(await client.readContract({ ...target(), functionName: 'previewClaim', args: [owner, ids] }))]).toEqual(amounts)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'claim', args: [owner, ids] }))
		return amounts
	}
	const exclude = async (owner: Address, id: bigint, position: bigint) => await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'excludePosition', args: [owner, id, position] }))
	const closeGeneration = async (generation: bigint) => await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'closeGeneration', args: [generation] }))
	const retirementTarget = () => ({ abi: retirementAbi, address: ledger })
	const complete = async (position: bigint) => await writeContractAndWait(client, () => client.writeContract({ ...retirementTarget(), functionName: 'markPositionComplete', args: [position] }))
	const active = async (owner: Address, cursor = 0n, pageSize = 64n) => await client.readContract({ ...retirementTarget(), functionName: 'getOwnerActiveIntervals', args: [owner, cursor, pageSize] })

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: concatHex([`0x${artifact.evm.bytecode.object}`, encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'bool' }], [client.account.address, 0n, false])]) }) })
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

	test('consecutive owner round trips restore only the proven cohort and transient cohorts stay unique', async () => {
		const change = async (owner: Address, shares: bigint, generation = 1n) => {
			const version = await client.readContract({ ...retirementTarget(), functionName: 'setOwnerBalance', args: [owner, generation, shares], account: client.account.address })
			await balance(owner, shares, generation)
			return requireBigInt(version, 'Ownership version')
		}
		const aliceVersion = await change(alice, 100n)
		await append()
		const transientVersion = await change(bob, 40n)
		await append()
		expect(await change(bob, 0n)).toBe(aliceVersion)
		expect(await change(bob, 20n)).toBeGreaterThan(transientVersion)
		await change(alice, 90n)
		expect(await change(bob, 0n)).toBeGreaterThan(transientVersion)
		const closedVersion = requireBigInt(await client.readContract({ ...retirementTarget(), functionName: 'closeGeneration', args: [1n], account: client.account.address }), 'Closed generation ownership version')
		await closeGeneration(1n)
		expect(await change(alice, 0n)).toBe(closedVersion)
		expect(await client.readContract({ ...retirementTarget(), functionName: 'closeGeneration', args: [1n], account: client.account.address })).toBe(closedVersion)
		expect(await change(alice, 100n, 2n)).toBeGreaterThan(closedVersion)
	})

	test('maintenance rewards belong only to allocations unfinished when the fee was paid', async () => {
		const fund = async (amount: bigint) => writeContractAndWait(client, () => client.writeContract({ ...retirementTarget(), functionName: 'creditMaintenance', args: [amount] }))
		const take = async (position: bigint, cap: bigint) => {
			const reward = await client.readContract({ ...retirementTarget(), functionName: 'takeMaintenanceReward', args: [position, cap], account: client.account.address })
			await writeContractAndWait(client, () => client.writeContract({ ...retirementTarget(), functionName: 'takeMaintenanceReward', args: [position, cap] }))
			return reward
		}
		await append()
		await append()
		await fund(100n)
		await complete(1n)
		await append()
		await fund(100n)
		// The first allocation froze before the second fee, and the newest missed the first.
		expect(await take(1n, 100n)).toBe(50n)
		await complete(2n)
		expect(await take(2n, 60n)).toBe(60n)
		await complete(3n)
		expect(await take(3n, 100n)).toBe(50n)
		expect(await take(2n, 100n)).toBe(0n)
		await expect(fund(1n)).rejects.toThrow('No unfinished allocations')
		await fund(0n)
		await expect(take(0n, 100n)).rejects.toThrow('Unknown allocation position')
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

	test('claiming an empty closed generation retires its interval without affecting future ownership', async () => {
		await balance(alice, 100n)
		await closeGeneration(1n)
		expect(await client.readContract({ ...retirementTarget(), functionName: 'claim', args: [alice, [0n]], account: client.account.address })).toEqual([0n, 0n, true])
		expect(await claim(alice)).toEqual([0n, 0n])
		expect((await interval(alice)).active).toBe(false)
		await balance(alice, 100n, 2n)
		await append()
		await credit(1n, 10n, 1n, 100n)
		expect(await claim(alice, [1n])).toEqual([10n, 1n])
	})

	test('fork-frozen generation closure is idempotent and idle withdrawals preserve historical weights', async () => {
		await balance(alice, 100n)
		await append()
		await closeGeneration(1n)
		await balance(alice, 0n)
		await append()
		await closeGeneration(1n)
		expect(await count(alice)).toBe(1n)
		expect((await interval(alice)).shares).toBe(100n)
		expect((await interval(alice)).endPosition).toBe(1n)
		await credit(1n, 10n, 1n, 100n)
		await complete(1n)
		expect(await claim(alice)).toEqual([10n, 1n])
		expect((await interval(alice)).active).toBe(false)
		await balance(alice, 20n)
		expect(await count(alice)).toBe(1n)
	})

	test('closed intervals wait for every terminal position while an open owner keeps future rights', async () => {
		await balance(alice, 40n)
		await balance(bob, 60n)
		await append()
		await append()
		await balance(alice, 0n)
		await credit(2n, 100n, 10n, 100n)
		await complete(2n)
		await complete(2n)
		expect(await client.readContract({ ...retirementTarget(), functionName: 'canRetireOwnerInterval', args: [alice, 0n] })).toBe(false)
		expect(await client.readContract({ ...retirementTarget(), functionName: 'unfinishedPositionCount' })).toBe(1n)
		expect(await claim(alice)).toEqual([40n, 4n])
		expect((await interval(alice)).active).toBe(true)
		await credit(1n, 200n, 20n, 100n)
		await complete(1n)
		expect(await client.readContract({ ...retirementTarget(), functionName: 'canRetireOwnerInterval', args: [alice, 0n] })).toBe(true)
		expect(await client.readContract({ ...retirementTarget(), functionName: 'canRetireOwnerInterval', args: [bob, 0n] })).toBe(false)
		expect(await claim(alice)).toEqual([80n, 8n])
		expect(await client.readContract({ ...retirementTarget(), functionName: 'canRetireOwnerInterval', args: [alice, 0n] })).toBe(false)
		expect((await interval(alice)).active).toBe(false)
		expect(await active(alice)).toEqual([[], 0n])
		expect(await claim(bob)).toEqual([180n, 18n])
		expect((await interval(bob)).active).toBe(true)
		await append()
		await credit(3n, 60n, 6n, 60n)
		expect(await claim(bob)).toEqual([60n, 6n])
		expect(await client.readContract({ ...retirementTarget(), functionName: 'unfinishedPositionCount' })).toBe(1n)
		await expect(credit(1n, 1n, 0n, 100n)).rejects.toThrow('Allocation recovery is complete')
	})

	test('completion tree growth preserves old terminal counts across new ancestors', async () => {
		await balance(alice, 100n)
		await append()
		await complete(1n)
		await append()
		await complete(2n)
		await append()
		await complete(3n)
		await append()
		await balance(alice, 0n)
		await claim(alice)
		expect((await interval(alice)).active).toBe(true)
		await complete(4n)
		await claim(alice)
		expect((await interval(alice)).active).toBe(false)
		expect(await client.readContract({ ...retirementTarget(), functionName: 'unfinishedPositionCount' })).toBe(0n)
	})

	test('retiring terminal intervals retains fractional cash across later generations', async () => {
		await balance(alice, 1n)
		await balance(bob, 1n)
		await append()
		await credit(1n, 1n, 1n, 2n)
		await complete(1n)
		await closeGeneration(1n)
		expect(await claim(alice)).toEqual([0n, 0n])
		expect((await interval(alice)).active).toBe(false)
		expect((await client.readContract({ ...target(), functionName: 'ownerCredits', args: [alice] }))[2]).toBe(precision / 2n)
		await balance(alice, 1n, 2n)
		await balance(bob, 1n, 2n)
		await append()
		await credit(2n, 1n, 1n, 2n)
		await complete(2n)
		await closeGeneration(2n)
		expect(await claim(alice, [1n])).toEqual([1n, 1n])
		expect(await claim(bob, [0n, 1n])).toEqual([1n, 1n])
		expect(await active(alice)).toEqual([[], 0n])
		expect(await active(bob)).toEqual([[], 0n])
	})

	test('active pagination unlinks middle and head intervals without scanning retired history', async () => {
		await balance(alice, 100n)
		for (let id = 1n; id <= 4n; id++) {
			await append()
			await balance(alice, 100n + id)
		}
		expect(await active(alice, 0n, 2n)).toEqual([[0n, 1n], 3n])
		await complete(2n)
		await claim(alice, [1n])
		expect(await active(alice, 0n, 2n)).toEqual([[0n, 2n], 4n])
		await complete(1n)
		await claim(alice, [0n])
		expect(await active(alice, 0n, 2n)).toEqual([[2n, 3n], 5n])
		expect(await active(alice, 5n, 2n)).toEqual([[4n], 0n])
		await expect(active(alice, 2n, 2n)).rejects.toThrow('Owner interval cursor retired')
		await expect(active(alice, 0n, 0n)).rejects.toThrow('Choose positive interval page size')
		expect(await client.readContract({ ...retirementTarget(), functionName: 'getOwnerActiveIntervalCount', args: [alice] })).toBe(3n)
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
		await expect(writeContractAndWait(outsider, () => outsider.writeContract({ ...retirementTarget(), functionName: 'markPositionComplete', args: [1n] }))).rejects.toThrow('Only portfolio')
		await expect(writeContractAndWait(outsider, () => outsider.writeContract({ ...retirementTarget(), functionName: 'creditMaintenance', args: [1n] }))).rejects.toThrow('Only portfolio')
		await expect(writeContractAndWait(outsider, () => outsider.writeContract({ ...retirementTarget(), functionName: 'takeMaintenanceReward', args: [1n, 1n] }))).rejects.toThrow('Only portfolio')
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

describe('Statoblast: sparse shared fork recovery accounting', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	const importedAbi = parseAbi(['function importInterval(address owner, uint256 start, uint256 end, uint256 shares) returns (uint256)', 'function retireImportedInterval(address owner, uint256 intervalId)', 'function sealImports()', 'function getPointShares(uint256 positionId) view returns (uint256)'])
	let client: WriteClient
	let ledger: Address
	const alice = addressString(TEST_ADDRESSES[0])
	const bob = addressString(TEST_ADDRESSES[1])
	const target = () => ({ abi: artifact.abi, address: ledger })
	const importedTarget = () => ({ abi: importedAbi, address: ledger })
	const register = async (owner: Address, start: bigint, end: bigint, shares: bigint) => await writeContractAndWait(client, () => client.writeContract({ ...importedTarget(), functionName: 'importInterval', args: [owner, start, end, shares] }))
	const retire = async (owner: Address, id: bigint) => await writeContractAndWait(client, () => client.writeContract({ ...importedTarget(), functionName: 'retireImportedInterval', args: [owner, id] }))
	const seal = async () => await writeContractAndWait(client, () => client.writeContract({ ...importedTarget(), functionName: 'sealImports' }))
	const weight = async (position: bigint) => await client.readContract({ ...importedTarget(), functionName: 'getPointShares', args: [position] })
	const credit = async (position: bigint, rep: bigint, eth: bigint, shares: bigint) => await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'credit', args: [position, rep, eth, shares] }))
	const claim = async (owner: Address, ids: bigint[]) => {
		const amounts = await client.readContract({ ...target(), functionName: 'previewClaim', args: [owner, ids] })
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'claim', args: [owner, ids] }))
		return [...amounts]
	}
	const retirementTarget = () => ({ abi: retirementAbi, address: ledger })
	const complete = async (position: bigint) => await writeContractAndWait(client, () => client.writeContract({ ...retirementTarget(), functionName: 'markPositionComplete', args: [position] }))

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const data = concatHex([`0x${artifact.evm.bytecode.object}`, encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'bool' }], [client.account.address, 4_096n, true])])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data }) })
		if (receipt.contractAddress === undefined) throw new Error('Sparse recovery ledger deployment address missing')
		ledger = receipt.contractAddress
		await setBaselineSnapshot()
	})

	test('one imported ownership interval covers thousands of sparse allocations without appending leaves', async () => {
		expect(await client.readContract({ ...target(), functionName: 'positionCount' })).toBe(4_096n)
		await register(alice, 1n, 4_096n, 60n)
		await register(bob, 17n, 19n, 40n)
		expect(await weight(1n)).toBe(60n)
		expect(await weight(16n)).toBe(60n)
		expect(await weight(17n)).toBe(100n)
		expect(await weight(19n)).toBe(100n)
		expect(await weight(20n)).toBe(60n)
		expect(await weight(4_096n)).toBe(60n)
		await retire(bob, 0n)
		expect(await weight(17n)).toBe(60n)
		expect(await client.readContract({ ...target(), functionName: 'getOwnerIntervalCount', args: [alice] })).toBe(1n)
		await seal()
		await credit(4_096n, 120n, 12n, 60n)
		await credit(1n, 180n, 18n, 60n)
		expect(await claim(alice, [0n])).toEqual([300n, 30n])
		expect(await claim(alice, [0n])).toEqual([0n, 0n])
	})

	test('enrollment cannot change after recovery begins and malformed ranges cannot create rights', async () => {
		await expect(register(alice, 0n, 1n, 1n)).rejects.toThrow('Invalid imported interval')
		await expect(register(alice, 2n, 1n, 1n)).rejects.toThrow('Invalid imported interval')
		await expect(register(alice, 1n, 4_097n, 1n)).rejects.toThrow('Invalid imported interval')
		await expect(register(alice, 1n, 1n, 0n)).rejects.toThrow('Invalid imported shares')
		await expect(register(alice, 1n, 1n, 10n ** 36n + 1n)).rejects.toThrow('Invalid imported shares')
		await register(alice, 1n, 2n, 60n)
		await expect(complete(1n)).rejects.toThrow('Fork imports not sealed')
		await expect(credit(1n, 1n, 0n, 60n)).rejects.toThrow('Fork imports not sealed')
		await expect(writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'excludePosition', args: [alice, 0n, 1n] }))).rejects.toThrow('Fork imports not sealed')
		await seal()
		await expect(register(bob, 1n, 2n, 40n)).rejects.toThrow('Fork imports sealed')
		await expect(retire(alice, 0n)).rejects.toThrow('Fork imports sealed')
		await expect(credit(1n, 1n, 0n, 100n)).rejects.toThrow('Recovery cohort shares mismatch')
		await expect(writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'appendPosition' }))).rejects.toThrow('Fixed recovery ownership')
		await expect(writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'setOwnerBalance', args: [alice, 1n, 100n] }))).rejects.toThrow('Fixed recovery ownership')
		await expect(writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'closeGeneration', args: [1n] }))).rejects.toThrow('Fixed recovery ownership')
		await expect(weight(0n)).rejects.toThrow('Unknown allocation position')
		await expect(weight(4_097n)).rejects.toThrow('Unknown allocation position')
	})

	test('shared recovery retires an owner interval without changing frozen cohort denominators', async () => {
		await register(alice, 1n, 3n, 60n)
		await register(bob, 1n, 3n, 40n)
		await seal()
		await credit(1n, 100n, 10n, 100n)
		await complete(1n)
		await complete(3n)
		expect(await claim(alice, [0n])).toEqual([60n, 6n])
		expect((await client.readContract({ ...target(), functionName: 'getOwnerInterval', args: [alice, 0n] })).active).toBe(true)
		await credit(2n, 200n, 20n, 100n)
		await complete(2n)
		expect(await claim(alice, [0n])).toEqual([120n, 12n])
		expect((await client.readContract({ ...target(), functionName: 'getOwnerInterval', args: [alice, 0n] })).active).toBe(false)
		expect(await weight(1n)).toBe(100n)
		expect(await weight(2n)).toBe(100n)
		expect(await claim(bob, [0n])).toEqual([120n, 12n])
	})

	test('active page gas is independent of retired choice history', async () => {
		const page = { ...retirementTarget(), functionName: 'getOwnerActiveIntervals', args: [bob, 0n, 1n] } as const
		await register(bob, 1n, 1n, 1n)
		const initialGas = await client.estimateContractGas(page)
		await retire(bob, 0n)
		for (let id = 1n; id < 64n; id++) {
			await register(bob, 1n, 1n, 1n)
			await retire(bob, id)
		}
		await register(bob, 1n, 1n, 1n)
		expect(await client.readContract(page)).toEqual([[64n], 0n])
		const retiredHistoryGas = await client.estimateContractGas(page)
		expect(retiredHistoryGas).toBeLessThanOrEqual(initialGas + 100n)
		console.info('Active interval page gas, before/after 64 retired intervals:', initialGas.toString(), retiredHistoryGas.toString())
		expect(await client.readContract({ ...retirementTarget(), functionName: 'getOwnerActiveIntervalCount', args: [bob] })).toBe(1n)
	})

	test('single-operation gas grows logarithmically across a thousandfold allocation history', async () => {
		const measure = async (points: bigint) => {
			const data = concatHex([`0x${artifact.evm.bytecode.object}`, encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'bool' }], [client.account.address, points, true])])
			const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data }) })
			if (receipt.contractAddress === undefined) throw new Error('Gas comparison ledger deployment address missing')
			const address = receipt.contractAddress
			await writeContractAndWait(client, () => client.writeContract({ abi: importedAbi, address, functionName: 'importInterval', args: [alice, 1n, points, 100n] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: importedAbi, address, functionName: 'sealImports' }))
			const creditCall = { abi: artifact.abi, address, functionName: 'credit', args: [1n, 100n, 10n, 100n] } as const
			const creditGas = await client.estimateContractGas(creditCall)
			await writeContractAndWait(client, () => client.writeContract(creditCall))
			const completeGas = await client.estimateContractGas({ abi: retirementAbi, address, functionName: 'markPositionComplete', args: [1n] })
			await writeContractAndWait(client, () => client.writeContract({ abi: retirementAbi, address, functionName: 'markPositionComplete', args: [1n] }))
			const claimGas = await client.estimateContractGas({ abi: artifact.abi, address, functionName: 'claim', args: [alice, [0n]] })
			return { creditGas, completeGas, claimGas }
		}
		const small = await measure(63n)
		const large = await measure(65_535n)
		console.info('Recovery gas across 63 and 65,535 allocation slots:', small, large)
		// 1,040x more allocation slots adds only ten tree levels, not a registry traversal.
		expect(large.creditGas).toBeLessThan(small.creditGas * 3n)
		expect(large.completeGas).toBeLessThan(small.completeGas * 3n)
		expect(large.claimGas).toBeLessThan(small.claimGas * 3n)
		expect(large.creditGas).toBeLessThan(1_000_000n)
		expect(large.completeGas).toBeLessThan(500_000n)
		expect(large.claimGas).toBeLessThan(500_000n)
	})

	test('a revoked choice can rejoin without resurrecting the retired interval or growing another owner history', async () => {
		await register(alice, 1n, 4_096n, 60n)
		for (let index = 0n; index < 8n; index++) {
			await register(bob, 10n, 20n, 40n)
			await retire(bob, index)
		}
		await register(bob, 10n, 20n, 40n)
		expect(await weight(10n)).toBe(100n)
		expect(await client.readContract({ ...target(), functionName: 'getOwnerIntervalCount', args: [alice] })).toBe(1n)
		await expect(retire(bob, 0n)).rejects.toThrow('Owner interval retired')
		await seal()
		await credit(11n, 100n, 10n, 100n)
		expect(await claim(alice, [0n])).toEqual([60n, 6n])
		expect(await claim(bob, [8n])).toEqual([40n, 4n])
		await expect(claim(bob, [0n])).rejects.toThrow('Owner interval retired')
	})

	test('an individual child exit excludes one point while preserving earlier cash and surrounding weights', async () => {
		await register(alice, 1n, 3n, 60n)
		await register(bob, 1n, 3n, 40n)
		await seal()
		await credit(1n, 100n, 10n, 100n)
		await credit(2n, 200n, 20n, 100n)
		await credit(3n, 300n, 30n, 100n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'excludePosition', args: [alice, 0n, 2n] }))
		expect(await weight(1n)).toBe(100n)
		expect(await weight(2n)).toBe(40n)
		expect(await weight(3n)).toBe(100n)
		expect(await claim(alice, [])).toEqual([360n, 36n])
		await credit(2n, 100n, 10n, 40n)
		await credit(1n, 50n, 5n, 100n)
		await credit(3n, 50n, 5n, 100n)
		expect(await claim(alice, [1n, 2n])).toEqual([60n, 6n])
		expect(await claim(bob, [0n])).toEqual([380n, 38n])
	})

	test('fractional distribution carry survives a sparse child exclusion and final exit', async () => {
		const precision = 10n ** 36n
		await register(alice, 4_096n, 4_096n, precision / 2n)
		await register(bob, 4_096n, 4_096n, precision / 4n)
		await seal()
		await credit(4_096n, 1n, 1n, (3n * precision) / 4n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'excludePosition', args: [alice, 0n, 4_096n] }))
		expect(await weight(4_096n)).toBe(precision / 4n)
		await credit(4_096n, 1n, 1n, precision / 4n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'excludePosition', args: [bob, 0n, 4_096n] }))
		expect(await weight(4_096n)).toBe(0n)
		expect(await claim(alice, [])).toEqual([0n, 0n])
		expect(await claim(bob, [])).toEqual([1n, 1n])
		const first = await client.readContract({ ...target(), functionName: 'ownerCredits', args: [alice] })
		const second = await client.readContract({ ...target(), functionName: 'ownerCredits', args: [bob] })
		expect(first[2] + second[2]).toBe(precision)
		expect(first[3] + second[3]).toBe(precision)
	})

	test('deployment can bind authority to a controller distinct from the deploying account', async () => {
		const controller = createWriteClient(getAnvilWindowEthereum(), TEST_ADDRESSES[1])
		const data = concatHex([`0x${artifact.evm.bytecode.object}`, encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'bool' }], [controller.account.address, 1n, true])])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data }) })
		if (receipt.contractAddress === undefined) throw new Error('Controller-owned ledger deployment address missing')
		const child = { abi: importedAbi, address: receipt.contractAddress }
		const args = [alice, 1n, 1n, 100n] as const
		await expect(writeContractAndWait(client, () => client.writeContract({ ...child, functionName: 'importInterval', args }))).rejects.toThrow('Only portfolio')
		await writeContractAndWait(controller, () => controller.writeContract({ ...child, functionName: 'importInterval', args }))
		expect(await controller.readContract({ ...child, functionName: 'getPointShares', args: [1n] })).toBe(100n)
		expect((await controller.readContract({ abi: artifact.abi, address: receipt.contractAddress, functionName: 'portfolio' })).toLowerCase()).toBe(controller.account.address.toLowerCase())
	})

	test('only the declared controller can import, revoke, seal or collect ownership', async () => {
		const outsider = createWriteClient(getAnvilWindowEthereum(), TEST_ADDRESSES[1])
		await expect(writeContractAndWait(outsider, () => outsider.writeContract({ ...importedTarget(), functionName: 'importInterval', args: [bob, 1n, 2n, 100n] }))).rejects.toThrow('Only portfolio')
		await register(alice, 1n, 2n, 100n)
		await expect(writeContractAndWait(outsider, () => outsider.writeContract({ ...importedTarget(), functionName: 'retireImportedInterval', args: [alice, 0n] }))).rejects.toThrow('Only portfolio')
		await expect(writeContractAndWait(outsider, () => outsider.writeContract({ ...importedTarget(), functionName: 'sealImports' }))).rejects.toThrow('Only portfolio')
		await seal()
		await credit(2n, 100n, 10n, 100n)
		await expect(writeContractAndWait(outsider, () => outsider.writeContract({ ...target(), functionName: 'claim', args: [alice, [0n]] }))).rejects.toThrow('Only portfolio')
		expect(await claim(alice, [0n])).toEqual([100n, 10n])
	})
})
