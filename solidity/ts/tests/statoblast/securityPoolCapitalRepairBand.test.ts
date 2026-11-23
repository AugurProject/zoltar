import { beforeAll, describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as artifact, statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact, test_statoblast_CapitalLedgerHarness_CapitalLedgerHarness as harnessArtifact } from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { deployCapitalLedgerHarness, fundCapitalOwners } from './securityPoolCapitalTestComponents'

// Harness: security multiplier 1.05, minimum commitment 1e15. Price error is
// in 1e7 units, so 200_000 is 2%: conservative = P / 0.98, liquidation = P / 1.02.
const E = 10n ** 18n
const MIN = 10n ** 15n
const READY = 5n

describe('capital repairs never leave a position between the liquidation and conservative price', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mallory: WriteClient
	let bob: WriteClient
	let carol: WriteClient
	let ledger: Address
	let index: Address
	let harness: Address
	const account = (client: WriteClient) => mallory.readContract({ abi: artifact.abi, address: ledger, functionName: 'ownerAccount', args: [client.account.address] })
	const position = (id: bigint) => mallory.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })
	const read = <const Name extends 'conservativePrice' | 'liquidationPrice' | 'demandAttoEth'>(functionName: Name) => mallory.readContract({ abi: artifact.abi, address: ledger, functionName })
	const healthy = async () => (await mallory.readContract({ abi: artifact.abi, address: ledger, functionName: 'totals' }))[2]
	const started = (id: bigint) => mallory.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })
	const preview = async (id: bigint) => mallory.readContract({ abi: indexArtifact.abi, address: index, functionName: 'previewRetirement', args: [id, await read('conservativePrice'), await read('demandAttoEth')] })
	const priceError = (error: bigint) => writeContractAndWait(mallory, () => mallory.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setPriceError', args: [error] }))
	const price = async (amount: bigint) => {
		const now = (await mallory.getBlock()).timestamp
		return writeContractAndWait(mallory, () => mallory.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setPrice', args: [amount, Number(now) + 100_000] }))
	}
	const demand = (amount: bigint) => writeContractAndWait(mallory, () => mallory.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setDemand', args: [amount] }))
	const deposit = (client: WriteClient, amount: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'depositFor', args: [client.account.address, amount] }))
	const setCommitment = (client: WriteClient, commitment: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'setCommitment', args: [commitment] }))
	const serve = (client: WriteClient, id: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'serveRetirement', args: [id] }))
	const take = (client: WriteClient, id: bigint, amount: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'takeOver', args: [id, amount, 0n, 10_000n * E] }))
	const commit = async (client: WriteClient, rep: bigint, commitment: bigint) => {
		await deposit(client, rep)
		await setCommitment(client, commitment)
		return (await account(client)).positionId
	}
	const expectEligibleOrTakeable = async (id: bigint) => {
		const source = await position(id)
		if (source.commitment === 0n || source.maxHealthyPrice >= (await read('conservativePrice'))) return
		expect(source.maxHealthyPrice < (await read('liquidationPrice'))).toBe(true)
		expect(await started(id)).not.toBe(0n)
	}

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		mallory = createWriteClient(ethereum, TEST_ADDRESSES[0])
		bob = createWriteClient(ethereum, TEST_ADDRESSES[1])
		carol = createWriteClient(ethereum, TEST_ADDRESSES[2])
		const deployment = await deployCapitalLedgerHarness(mallory)
		harness = deployment.harness
		ledger = deployment.ledger
		index = deployment.index
		await fundCapitalOwners(mallory, deployment, [mallory, bob, carol], 10_000n * E)
		await setBaselineSnapshot()
	})

	test('#1552 anyone can serve a ready request whose position sits in the band, freeing the spare it reserves', async () => {
		await priceError(200_000n)
		await price(E)
		const malloryId = await commit(mallory, (10715n * E) / 100n, 100n * E)
		const bobId = await commit(bob, 210n * E, 100n * E)
		await commit(carol, 210n * E, 100n * E)
		await demand(250n * E)
		// Spare is 50 ETH, so Mallory's full exit queues first.
		await setCommitment(mallory, 0n)
		expect((await position(malloryId)).batch).not.toBe(0n)
		await price((101n * E) / 100n)
		const band = await position(malloryId)
		expect(band.maxHealthyPrice < (await read('conservativePrice'))).toBe(true)
		expect(band.maxHealthyPrice >= (await read('liquidationPrice'))).toBe(true)
		await demand(100n * E)
		await setCommitment(bob, 0n)
		expect((await position(bobId)).commitment).toBe(100n * E)
		expect((await preview(malloryId)).status).toBe(READY)
		// Bob executes Mallory's own ready request; her principal stays hers.
		await serve(bob, malloryId)
		expect((await position(malloryId)).commitment).toBe(0n)
		expect((await mallory.readContract({ abi: artifact.abi, address: ledger, functionName: 'ownerCollateral', args: [mallory.account.address] })).withdrawable).toBe((10715n * E) / 100n)
		expect((await preview(bobId)).status).toBe(READY)
		await serve(bob, bobId)
		expect((await position(bobId)).commitment).toBe(0n)
	})

	test('#1570 a partial takeover may not leave the source between the two prices', async () => {
		// 5% uncertainty; at P = 4.2 liquidation is 4.0 and conservative is 4.421.
		await priceError(500_000n)
		await price(E)
		const malloryId = await commit(mallory, 400n * E, 100n * E)
		await commit(bob, 1_000n * E, 100n * E)
		await demand(200n * E)
		await price((42n * E) / 10n)
		expect(await started(malloryId)).not.toBe(0n)
		await deposit(carol, 1_000n * E)
		// Taking 10 ETH would leave 90 ETH at max healthy price 4.23: in the band.
		await expect(take(carol, malloryId, 10n * E)).rejects.toThrow('Takeover would strand source')
		// Taking 4 ETH leaves the source below the liquidation price, still takeable.
		await take(carol, malloryId, 4n * E)
		await expectEligibleOrTakeable(malloryId)
		expect(await started(malloryId)).not.toBe(0n)
		// The full repair restores eligibility at the conservative price.
		await take(carol, malloryId, (await position(malloryId)).commitment)
		expect((await position(malloryId)).maxHealthyPrice >= (await read('conservativePrice'))).toBe(true)
		expect(await healthy()).toBeGreaterThanOrEqual(200n * E)
	})

	test('#1571 a takeover whose cure uses nominal spare repairs to the conservative price', async () => {
		await priceError(200_000n)
		await price(E)
		const malloryId = await commit(mallory, (10715n * E) / 100n, 100n * E)
		await commit(bob, 400n * E, 100n * E)
		await demand(150n * E)
		await price((12n * E) / 10n)
		await deposit(carol, 1_000n * E)
		await take(carol, malloryId, 100n * E)
		await expectEligibleOrTakeable(malloryId)
		expect((await position(malloryId)).maxHealthyPrice >= (await read('conservativePrice'))).toBe(true)
		expect(await healthy()).toBeGreaterThanOrEqual(await read('demandAttoEth'))
	})

	test('#1571 a cure limited by nominal spare continues into a receiver-funded transfer', async () => {
		await priceError(200_000n)
		await price(E)
		const malloryId = await commit(mallory, (10715n * E) / 100n, 100n * E)
		await commit(bob, 400n * E, 100n * E)
		// Only 5 ETH of nominal spare, less than the ~16.7 ETH the source must shed.
		await demand(195n * E)
		await price((12n * E) / 10n)
		await deposit(carol, 1_000n * E)
		await take(carol, malloryId, 100n * E)
		expect((await position(malloryId)).maxHealthyPrice >= (await read('conservativePrice'))).toBe(true)
		expect((await account(carol)).positionId).not.toBe(0n)
		expect(await healthy()).toBeGreaterThanOrEqual(195n * E)
	})

	test('a spare-limited conservative cure preserves an accrued auction bonus through the price band', async () => {
		await priceError(200_000n)
		await price(E)
		const principal = (10715n * E) / 100n
		const sourceId = await commit(mallory, principal, 100n * E)
		await commit(bob, 400n * E, 100n * E)
		await demand(186n * E)
		await price((12n * E) / 10n)
		await deposit(carol, 1_000n * E)
		await getAnvilWindowEthereum().advanceTime(900n)
		await take(carol, sourceId, 100n * E)
		const source = await position(sourceId)
		const receiver = await position((await account(carol)).positionId)
		expect(source.maxHealthyPrice).toBeGreaterThanOrEqual(await read('conservativePrice'))
		expect(receiver.rep).toBeGreaterThan(1_000n * E)
		expect(source.rep + receiver.rep).toBe(principal + 1_000n * E)
		expect(await healthy()).toBeGreaterThanOrEqual(186n * E)
	})

	test('#1563 a takeover never hands the receiver a retirement target below the minimum', async () => {
		await priceError(0n)
		await price(E)
		const aliceId = await commit(mallory, (10n * MIN * 105n) / 100n + 1n, 10n * MIN)
		await commit(carol, 400n * E, 100n * E)
		await deposit(bob, 100n * E)
		await demand(100n * E + 10n * MIN)
		// Alice queues a partial retirement from 10 to 4 minimums; no spare, so it waits.
		await setCommitment(mallory, 4n * MIN)
		expect((await position(aliceId)).remainingCommitment).toBe(4n * MIN)
		// At 3x the price Alice supports ~3.33 minimums, below her 4-minimum target.
		await price(3n * E)
		// Taking just enough to push Alice 1 attoETH below her retained target.
		await take(bob, aliceId, 6n * MIN + 1n)
		const bobId = (await account(bob)).positionId
		const receiver = await position(bobId)
		expect(receiver.remainingCommitment === 0n || receiver.remainingCommitment >= MIN).toBe(true)
		await demand(0n)
		await serve(bob, bobId)
		const served = await position(bobId)
		expect(served.commitment === 0n || served.commitment >= MIN).toBe(true)
	})
})
