import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { test_statoblast_CommitmentIndexHarness_InspectableCommitmentIndex as artifact } from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

const owner = (id: number) => addressString(BigInt(id) + 0x1000n)

describe('Statoblast: auction position materialization preserves cohort history', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let outsider: WriteClient
	let address: Address
	const account = (id: bigint) => client.readContract({ abi: artifact.abi, address, functionName: 'accountOf', args: [id] })
	const epoch = (id: bigint) => client.readContract({ abi: artifact.abi, address, functionName: 'healthEpoch', args: [id] })
	const started = async (id: bigint) => BigInt(await client.readContract({ abi: artifact.abi, address, functionName: 'liquidationStarted', args: [id] }))
	const totals = async () => [...(await client.readContract({ abi: artifact.abi, address, functionName: 'totals' }))]
	const validate = () => client.readContract({ abi: artifact.abi, address, functionName: 'validate', args: [0n] })
	const create = async (rep: bigint, commitment: bigint, price: bigint) => {
		await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'create', args: [owner(1), rep, commitment, price] }))
		return client.readContract({ abi: artifact.abi, address, functionName: 'lastPositionId' })
	}
	const split = async (id: bigint, rep: bigint, commitment: bigint, receiver = owner(2)) => {
		await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'splitAuctionPosition', args: [id, receiver, rep, commitment] }))
		return client.readContract({ abi: artifact.abi, address, functionName: 'lastPositionId' })
	}
	const observe = (price: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'observeHealthy', args: [price] }))
	const credit = (eth: bigint, rep: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'creditFees', args: [0n, eth, rep] }))
	const claim = (id: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'claim', args: [id] }))
	const request = (id: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'requestRetirement', args: [id, 0n, 1n] }))

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		outsider = createWriteClient(ethereum, TEST_ADDRESSES[1])
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [client.account.address] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('Auction index deployment address missing')
		address = receipt.contractAddress
		await setBaselineSnapshot()
	})

	test('delayed partial and full materialization retain the first adverse observation', async () => {
		const source = await create(1_000n, 100n, 10n)
		await observe(10n)
		await getAnvilWindowEthereum().advanceTime(100n)
		await observe(11n)
		const distress = await started(source)
		expect(distress).toBeGreaterThan(0n)
		await getAnvilWindowEthereum().advanceTime(3_600n)
		await observe(12n)
		const first = await split(source, 250n, 25n)
		expect(await started(source)).toBe(distress)
		expect(await started(first)).toBe(distress)
		expect(await epoch(first)).toBe(await epoch(source))
		expect(await account(source)).toMatchObject({ rep: 750n, commitment: 75n, maxHealthyPrice: 10n })
		expect(await account(first)).toMatchObject({ owner: owner(2), rep: 250n, commitment: 25n, maxHealthyPrice: 10n })
		const last = await split(source, 750n, 75n)
		expect(await account(source)).toMatchObject({ rep: 0n, commitment: 0n, maxHealthyPrice: 10n })
		expect(await started(source)).toBe(0n)
		expect(await started(last)).toBe(distress)
		expect(await totals()).toEqual([1_000n, 100n])
		await validate()
	})

	test('a newly created cohort and its materialized owners begin distress only on their first new observation', async () => {
		await observe(20n)
		const source = await create(100n, 10n, 10n)
		await getAnvilWindowEthereum().advanceTime(100n)
		const receiver = await split(source, 50n, 5n)
		expect(await started(source)).toBe(0n)
		expect(await started(receiver)).toBe(0n)
		await observe(20n)
		const distress = (await client.getBlock()).timestamp
		expect(await started(source)).toBe(distress)
		expect(await started(receiver)).toBe(distress)
	})

	test('lazy ancestor recovery epochs survive splitting, reinsertion and later relapse without affecting neighbors', async () => {
		const low = await create(1_000n, 100n, 10n)
		const source = await create(1_000n, 100n, 20n)
		const high = await create(1_000n, 100n, 30n)
		await observe(0n)
		await observe(21n)
		await getAnvilWindowEthereum().advanceTime(100n)
		// This recovery stamps the whole root lazily; the next observation only
		// touches the healthy suffix, leaving source's stamp on its ancestors.
		await observe(10n)
		await observe(21n)
		const distress = await started(source)
		expect(await epoch(source)).toBe(3n)
		const receiver = await split(source, 250n, 25n)
		expect(await Promise.all([low, source, receiver, high].map(epoch))).toEqual([3n, 3n, 3n, 4n])
		expect(await Promise.all([low, source, receiver, high].map(started))).toEqual([distress, distress, distress, 0n])
		await observe(0n)
		const later = await split(receiver, 100n, 10n)
		expect(await Promise.all([low, source, receiver, high, later].map(epoch))).toEqual([5n, 5n, 5n, 5n, 5n])
		await getAnvilWindowEthereum().advanceTime(100n)
		await observe(31n)
		const relapse = (await client.getBlock()).timestamp
		expect(await Promise.all([low, source, receiver, high, later].map(started))).toEqual([relapse, relapse, relapse, relapse, relapse])
		expect(await totals()).toEqual([3_000n, 300n])
		await validate()
	})

	test('controller-certified recovery newer than tree history is inherited independently', async () => {
		const source = await create(100n, 10n, 10n)
		await observe(11n)
		await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'replace', args: [source, 120n, 10n, 12n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'clearLiquidation', args: [source] }))
		await getAnvilWindowEthereum().advanceTime(100n)
		await observe(13n)
		const distress = await started(source)
		expect(distress).toBe((await client.getBlock()).timestamp)
		expect(await epoch(source)).toBe(0n)
		await getAnvilWindowEthereum().advanceTime(100n)
		const receiver = await split(source, 60n, 5n)
		expect(await epoch(receiver)).toBe(0n)
		expect(await started(source)).toBe(distress)
		expect(await started(receiver)).toBe(distress)
	})

	test('old fees remain claimable on an emptied source while new owners earn only future fees', async () => {
		const source = await create(1_000n, 100n, 10n)
		await credit(100n, 80n)
		const first = await split(source, 250n, 25n)
		expect(await account(source)).toMatchObject({ ethFees: 100n, repFees: 80n })
		expect(await account(first)).toMatchObject({ ethFees: 0n, repFees: 0n })
		await credit(100n, 80n)
		const last = await split(source, 750n, 75n)
		expect(await account(source)).toMatchObject({ rep: 0n, commitment: 0n, ethFees: 175n, repFees: 140n })
		expect(await account(last)).toMatchObject({ ethFees: 0n, repFees: 0n })
		await credit(100n, 80n)
		expect(await account(first)).toMatchObject({ ethFees: 50n, repFees: 40n })
		expect(await account(last)).toMatchObject({ ethFees: 75n, repFees: 60n })
		const claimable = await client.simulateContract({ abi: artifact.abi, address, functionName: 'claim', args: [source], account: client.account.address })
		expect([...claimable.result]).toEqual([0n, 175n, 140n])
		await claim(source)
		expect(await account(source)).toMatchObject({ ethFees: 0n, repFees: 0n })
		expect(await totals()).toEqual([1_000n, 100n])
		await validate()
	})

	test('exact proportionality accepts overflowing intermediate products and rejects rounded shares', async () => {
		const rep = 2n ** 200n
		const commitment = 2n ** 180n
		const source = await create(rep, commitment, 123n)
		const receiver = await split(source, rep / 2n, commitment / 2n)
		expect(await account(receiver)).toMatchObject({ rep: rep / 2n, commitment: commitment / 2n, maxHealthyPrice: 123n })
		expect(await totals()).toEqual([rep, commitment])
		const indivisible = await create(10n, 6n, 9n)
		await expect(split(indivisible, 3n, 2n)).rejects.toThrow('Auction split must be proportional')
		await expect(split(indivisible, 4n, 2n)).rejects.toThrow('Auction split must be proportional')
		await expect(split(indivisible, 9n, 6n)).rejects.toThrow('Auction split must be proportional')
		expect(await account(indivisible)).toMatchObject({ rep: 10n, commitment: 6n })
		await validate()
	})

	test('authorization, nonzero amounts, active membership and sealed imports are required', async () => {
		await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'initCohorts', args: [1n, 2n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'importPosition', args: [owner(1), 100n, 10n, 10n, 0n, 0n] }))
		await expect(split(1n, 50n, 5n)).rejects.toThrow('Commitment imports are open')
		await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'sealImports' }))
		await expect(writeContractAndWait(outsider, () => outsider.writeContract({ abi: artifact.abi, address, functionName: 'splitAuctionPosition', args: [1n, owner(2), 50n, 5n] }))).rejects.toThrow('Only portfolio')
		await expect(split(99n, 50n, 5n)).rejects.toThrow('Unknown commitment position')
		await expect(split(1n, 0n, 5n)).rejects.toThrow('Invalid auction commitment split')
		await expect(split(1n, 50n, 0n)).rejects.toThrow('Invalid auction commitment split')
		await expect(split(1n, 101n, 10n)).rejects.toThrow('Invalid auction commitment split')
		await expect(split(1n, 100n, 11n)).rejects.toThrow('Invalid auction commitment split')
		await expect(split(1n, 50n, 5n, zeroAddress)).rejects.toThrow('Invalid commitment position')
		await request(1n)
		await expect(split(1n, 50n, 5n)).rejects.toThrow('Auction position is not active')
		await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'retire', args: [0n, 0n, 0n] }))
		await expect(split(1n, 50n, 5n)).rejects.toThrow('Auction position is not active')
		const source = await create(100n, 10n, 10n)
		await split(source, 100n, 10n)
		await expect(split(source, 1n, 1n)).rejects.toThrow('Auction position is not active')
	})

	test('ordinary takeover split still grants the receiver fresh history', async () => {
		const source = await create(100n, 10n, 10n)
		await observe(0n)
		await observe(11n)
		const distress = await started(source)
		await getAnvilWindowEthereum().advanceTime(100n)
		await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address, functionName: 'split', args: [source, owner(2), 50n, 5n, 10n, 10n] }))
		const receiver = await client.readContract({ abi: artifact.abi, address, functionName: 'lastPositionId' })
		expect(await started(source)).toBe(distress)
		expect(await started(receiver)).toBe(0n)
		expect(await epoch(receiver)).toBe(0n)
		await observe(11n)
		expect(await started(receiver)).toBe((await client.getBlock()).timestamp)
		expect(await started(source)).toBe(distress)
		await validate()
	})
})
