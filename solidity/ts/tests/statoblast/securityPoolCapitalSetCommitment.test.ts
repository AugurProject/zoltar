import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as artifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	test_statoblast_CapitalLedgerHarness_CapitalLedgerHarness as harnessArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { deployCapitalTestComponents } from './securityPoolCapitalTestComponents'

const E = 10n ** 18n
// The harness ledger's economic minimum commitment.
const MINIMUM = 10n ** 15n

describe('Statoblast: owner-set capital commitment', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let alice: WriteClient
	let bob: WriteClient
	let carol: WriteClient
	let ledger: Address
	let index: Address
	let harness: Address
	const account = (client: WriteClient) => alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'ownerAccount', args: [client.account.address] })
	const position = (id: bigint) => alice.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })
	const healthy = async () => (await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'totals' }))[2]
	const currentBatch = () => alice.readContract({ abi: indexArtifact.abi, address: index, functionName: 'currentBatch' })
	const price = async (amount: bigint, duration = 100_000) => {
		const now = (await alice.getBlock()).timestamp
		return writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setPrice', args: [amount, Number(now) + duration] }))
	}
	const demand = (amount: bigint) => writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setDemand', args: [amount] }))
	const deposit = (client: WriteClient, amount: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'depositFor', args: [client.account.address, amount] }))
	const setCommitment = (client: WriteClient, commitment: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'setCommitment', args: [commitment] }))
	const commit = async (client: WriteClient, rep: bigint, commitment: bigint) => {
		await deposit(client, rep)
		await setCommitment(client, commitment)
		const owner = await account(client)
		if (owner.positionId === 0n) throw new Error('Committed position missing')
		return owner.positionId
	}

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		alice = createWriteClient(ethereum, TEST_ADDRESSES[0])
		bob = createWriteClient(ethereum, TEST_ADDRESSES[1])
		carol = createWriteClient(ethereum, TEST_ADDRESSES[2])
		const componentsReceipt = await deployCapitalTestComponents(alice)
		if (componentsReceipt.contractAddress === undefined) throw new Error('Capital test components address missing')
		const receipt = await alice.waitForTransactionReceipt({ hash: await alice.sendTransaction({ data: encodeDeployData({ abi: harnessArtifact.abi, bytecode: `0x${harnessArtifact.evm.bytecode.object}`, args: [componentsReceipt.contractAddress] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('Capital harness address missing')
		harness = receipt.contractAddress
		ledger = await alice.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'ledger' })
		const token = await alice.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'token' })
		index = await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'commitmentIndex' })
		for (const client of [alice, bob, carol]) {
			await writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [client.account.address, 10_000n * E] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [ledger, 10_000n * E] }))
		}
		await price(E)
		await setBaselineSnapshot()
	})

	test('only the owner can shrink its commitment: the ledger has no third-party cure', async () => {
		const names = new Set<string>(artifact.abi.flatMap(item => (item.type === 'function' ? [item.name] : [])))
		for (const removed of ['cure', 'cureAuctionBid', 'authorize', 'authorizeWithReport', 'requestRetirement', 'cancelRetirement']) expect(names.has(removed)).toBe(false)
		const id = await commit(alice, 105n * E, 100n * E)
		await demand(100n * E)
		await price(2n * E)
		// Another account's call only ever addresses its own, here empty, position.
		await expect(setCommitment(carol, 0n)).rejects.toThrow('Commitment below minimum')
		expect((await position(id)).commitment).toBe(100n * E)
	})

	test('an underwater owner cuts its unbacked commitment at once, which adds to the healthy spare an earlier request waits for', async () => {
		const aliceId = await commit(alice, 105n * E, 100n * E)
		const bobId = await commit(bob, 210n * E, 100n * E)
		await commit(carol, 420n * E, 100n * E)
		await demand(200n * E)
		await price(2n * E)
		// Bob and carol remain healthy and exactly cover demand, so bob's full exit has no spare and waits.
		await setCommitment(bob, 0n)
		expect((await position(bobId)).batch).not.toBe(0n)
		expect((await position(bobId)).commitment).toBe(100n * E)
		const healthyBefore = await healthy()
		expect(healthyBefore).toBe(200n * E)
		// Alice's 105 REP backs 50 ETH at this price, so her 50 ETH deficit is removed without queueing.
		await setCommitment(alice, 50n * E)
		const cured = await position(aliceId)
		expect(cured.commitment).toBe(50n * E)
		expect(cured.batch).toBe(0n)
		expect(cured.rep).toBe(105n * E)
		// The cured remainder counts as healthy again; that new spare serves part of bob's earlier request.
		expect((await position(bobId)).commitment).toBe(50n * E)
		expect(await healthy()).toBe(200n * E)
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [aliceId] })).toBe(0n)
	})

	test('lowering below the backed amount cures at once and queues only the rest', async () => {
		const id = await commit(alice, 105n * E, 100n * E)
		await commit(carol, 420n * E, 100n * E)
		await demand(150n * E)
		await price(2n * E)
		await setCommitment(alice, 20n * E)
		const account = await position(id)
		expect(account.commitment).toBe(50n * E)
		expect(account.batch).not.toBe(0n)
		expect(account.remainingCommitment).toBe(20n * E)
	})

	test('without enough spare, a cure never leaves a partial queued reduction below the economic minimum', async () => {
		const id = await commit(alice, 105n * E, 100n * E)
		await commit(carol, 420n * E, 100n * E)
		await demand(150n * E)
		await price(2n * E)
		const target = 50n * E - MINIMUM / 2n
		await setCommitment(alice, target)
		const account = await position(id)
		// Spare covers only the deficit, so the cut stops early and the queued rest is exactly the minimum.
		expect(account.commitment).toBe(target + MINIMUM)
		expect(account.remainingCommitment).toBe(target)
		await expect(setCommitment(carol, 100n * E - MINIMUM / 2n)).rejects.toThrow('Retirement below economic minimum')
	})

	test('a sub-minimum queued rest is cut at once when spare allows, leaving the owner fully backed', async () => {
		const id = await commit(alice, 105n * E, 100n * E)
		await commit(carol, 420n * E, 100n * E)
		// Spare is 60 ETH, more than the 50 ETH deficit plus the sub-minimum rest.
		await demand(140n * E)
		await price(2n * E)
		const target = 50n * E - MINIMUM / 2n
		await setCommitment(alice, target)
		const account = await position(id)
		expect(account.commitment).toBe(target)
		expect(account.batch).toBe(0n)
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBe(0n)
	})

	test('a stale price queues the whole reduction without curing', async () => {
		const id = await commit(alice, 105n * E, 100n * E)
		await demand(100n * E)
		await price(2n * E, 100)
		await getAnvilWindowEthereum().advanceTime(101n)
		await setCommitment(alice, 20n * E)
		const account = await position(id)
		expect(account.commitment).toBe(100n * E)
		expect(account.remainingCommitment).toBe(20n * E)
		expect(account.batch).not.toBe(0n)
	})

	test('a pending request is locked: repeating it keeps its place and any other value reverts', async () => {
		const id = await commit(alice, 210n * E, 100n * E)
		await demand(100n * E)
		await setCommitment(alice, 50n * E)
		// Any later service promotes the request into the closed current cohort.
		await writeContractAndWait(bob, () => bob.writeContract({ abi: artifact.abi, address: ledger, functionName: 'serveRetirement', args: [0n] }))
		const promoted = await currentBatch()
		expect((await position(id)).batch).toBe(promoted)
		await setCommitment(alice, 50n * E)
		expect((await position(id)).batch).toBe(promoted)
		for (const other of [0n, 40n * E, 60n * E, 100n * E, 120n * E]) await expect(setCommitment(alice, other)).rejects.toThrow('Retirement pending')
		await expect(writeContractAndWait(alice, () => alice.writeContract({ abi: artifact.abi, address: ledger, functionName: 'setCommitmentWithReport', args: [1n, 120n * E] }))).rejects.toThrow('Retirement pending')
		expect(await position(id)).toMatchObject({ batch: promoted, commitment: 100n * E, remainingCommitment: 50n * E })
	})

	// Healthy capacity (carol's 100 ETH) stays below demand, so the queue serves nothing and only the owner's cure can act.
	const queueUnderwaterRequest = async (target: bigint) => {
		const id = await commit(alice, 105n * E, 100n * E)
		await commit(carol, 420n * E, 100n * E)
		await demand(150n * E)
		await price(2n * E, 100)
		await getAnvilWindowEthereum().advanceTime(101n)
		await setCommitment(alice, target)
		expect((await position(id)).commitment).toBe(100n * E)
		await price(2n * E)
		return id
	}

	test('repeating a pending value while underwater cures in place and completes the request at its target', async () => {
		const id = await queueUnderwaterRequest(50n * E)
		await setCommitment(alice, 50n * E)
		const account = await position(id)
		expect(account.commitment).toBe(50n * E)
		expect(account.batch).toBe(0n)
		expect(account.remainingCommitment).toBe(0n)
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBe(0n)
	})

	test('repeating a pending value while underwater cures in place and keeps the rest queued in its cohort', async () => {
		const id = await queueUnderwaterRequest(45n * E)
		const batch = (await position(id)).batch
		expect(batch).not.toBe(0n)
		await setCommitment(alice, 45n * E)
		const account = await position(id)
		expect(account.commitment).toBe(50n * E)
		expect(account.batch).toBe(batch)
		expect(account.remainingCommitment).toBe(45n * E)
	})

	test('lowering never requires the saved health target', async () => {
		const id = await commit(alice, 105n * E, 100n * E)
		await demand(100n * E)
		await price(2n * E)
		// No spare exists, so nothing is cured and the whole exit waits without any health check.
		await setCommitment(alice, 0n)
		expect((await position(id)).batch).not.toBe(0n)
		expect((await position(id)).commitment).toBe(100n * E)
	})

	test('a funded report prices growth only', async () => {
		await commit(alice, 210n * E, 100n * E)
		await expect(writeContractAndWait(alice, () => alice.writeContract({ abi: artifact.abi, address: ledger, functionName: 'setCommitmentWithReport', args: [1n, 50n * E] }))).rejects.toThrow('Reports price growth only')
	})
})
