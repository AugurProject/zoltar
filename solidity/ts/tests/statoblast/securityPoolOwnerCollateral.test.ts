import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as ledgerArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	test_statoblast_CapitalLedgerHarness_CapitalLedgerHarness as harnessArtifact,
	test_statoblast_CapitalLedgerHarness_CapitalLedgerTestComponents as componentsArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

const E = 10n ** 18n

describe('Statoblast: owner-wide deposited collateral', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let alice: WriteClient
	let bob: WriteClient
	let keeper: WriteClient
	let ledger: Address
	let index: Address
	let harness: Address
	let token: Address
	const account = (client: WriteClient) => alice.readContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'ownerAccount', args: [client.account.address] })
	const position = (id: bigint) => alice.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })
	const deposit = (client: WriteClient, amount: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'depositFor', args: [client.account.address, amount] }))
	const withdraw = (client: WriteClient, amount: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'withdrawPrincipal', args: [amount, client.account.address] }))
	const price = async (amount: bigint, duration = 100_000) => {
		const now = (await alice.getBlock()).timestamp
		return writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setPrice', args: [amount, Number(now) + duration] }))
	}
	const demand = (amount: bigint) => writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setDemand', args: [amount] }))
	const authorize = async (client: WriteClient, commitment: bigint) => {
		await writeContractAndWait(client, () => client.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'authorize', args: [commitment] }))
		const owner = await account(client)
		if (owner.positionId === 0n) throw new Error('Authorized owner position missing')
		return owner.positionId
	}
	const retire = (client: WriteClient, id: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'requestRetirement', args: [id, 0n] }))
	const cure = (id: bigint) => writeContractAndWait(keeper, () => keeper.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'cure', args: [id] }))
	const healthy = async () => (await alice.readContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'totals' }))[2]
	const earnedEth = async (client: WriteClient, id: bigint) => (await account(client)).feesAttoEth + (await position(id)).ethFees

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		alice = createWriteClient(ethereum, TEST_ADDRESSES[0])
		bob = createWriteClient(ethereum, TEST_ADDRESSES[1])
		keeper = createWriteClient(ethereum, TEST_ADDRESSES[2])
		const componentsReceipt = await alice.waitForTransactionReceipt({ hash: await alice.sendTransaction({ data: `0x${componentsArtifact.evm.bytecode.object}` }) })
		if (componentsReceipt.contractAddress === undefined) throw new Error('Capital test components address missing')
		const receipt = await alice.waitForTransactionReceipt({ hash: await alice.sendTransaction({ data: encodeDeployData({ abi: harnessArtifact.abi, bytecode: `0x${harnessArtifact.evm.bytecode.object}`, args: [componentsReceipt.contractAddress] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('Capital harness address missing')
		harness = receipt.contractAddress
		ledger = await alice.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'ledger' })
		token = await alice.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'token' })
		index = await alice.readContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'commitmentIndex' })
		for (const client of [alice, bob, keeper]) {
			await writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [client.account.address, 10_000n * E] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [ledger, 10_000n * E] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'fundExecutionReserve', args: [client.account.address], value: 100n * E }))
		}
		await price(E)
		await setBaselineSnapshot()
	})

	test('previously free deposited REP protects the owner without a separate allocation', async () => {
		await deposit(alice, 158n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await price((3n * E) / 2n)
		expect(await healthy()).toBe(100n * E)
		await cure(id)
		expect(await position(id)).toMatchObject({ rep: 158n * E, commitment: 100n * E })
		expect(await alice.readContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBe(0n)
	})

	test('a deposit repairs indexed health and cancels an existing liquidation interval immediately', async () => {
		await deposit(alice, 105n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await price((3n * E) / 2n)
		await cure(id)
		expect(await alice.readContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBeGreaterThan(0n)
		await deposit(alice, 53n * E)
		expect(await healthy()).toBe(100n * E)
		expect(await alice.readContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBe(0n)
		await cure(id)
		expect((await position(id)).commitment).toBe(100n * E)
	})

	test('withdrawals stop at the owner collateral floor including a one-attoREP boundary', async () => {
		await deposit(alice, 158n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await price((3n * E) / 2n)
		expect([...(await alice.readContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'ownerCollateral', args: [alice.account.address] }))]).toEqual([158n * E, 100n * E, E / 2n])
		await withdraw(alice, E / 2n)
		expect((await position(id)).rep).toBe((315n * E) / 2n)
		expect([...(await alice.readContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'ownerCollateral', args: [alice.account.address] }))]).toEqual([(315n * E) / 2n, 100n * E, 0n])
		await expect(withdraw(alice, 1n)).rejects.toThrow('Owner collateral too low')
		expect(await healthy()).toBe(100n * E)
	})

	test('partial retirement retains all principal as backing for the remaining owner commitment', async () => {
		await deposit(alice, 210n * E)
		const id = await authorize(alice, 100n * E)
		await demand(75n * E)
		await retire(alice, id)
		expect(await position(id)).toMatchObject({ rep: 210n * E, commitment: 75n * E, releasedRep: 0n })
		await price(2n * E)
		expect(await healthy()).toBe(75n * E)
		await withdraw(alice, (105n * E) / 2n)
		expect((await position(id)).rep).toBe((315n * E) / 2n)
		await expect(withdraw(alice, 1n)).rejects.toThrow('Owner collateral too low')
	})

	test('an owner cannot add a parallel commitment while retaining retirement priority', async () => {
		await deposit(alice, 210n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await retire(alice, id)
		await expect(authorize(alice, 100n * E)).rejects.toThrow('Cancel retirement first')
		expect((await position(id)).commitment).toBe(100n * E)
		await writeContractAndWait(alice, () => alice.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'cancelRetirement', args: [id] }))
		expect(await authorize(alice, 150n * E)).toBe(id)
		expect(await position(id)).toMatchObject({ rep: 210n * E, commitment: 150n * E, batch: 0n })
	})

	test('a restoring deposit checkpoints old fee eligibility and earns only later healthy income', async () => {
		await deposit(alice, 105n * E)
		await deposit(bob, 210n * E)
		const a = await authorize(alice, 100n * E)
		const b = await authorize(bob, 100n * E)
		await demand(200n * E)
		await price((3n * E) / 2n)
		await writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'fundFees', value: 86400n * E }))
		const fundedAt = (await alice.getBlock()).timestamp
		await getAnvilWindowEthereum().advanceTime(100n)
		await deposit(alice, 53n * E)
		const restoredAt = (await alice.getBlock()).timestamp
		const priorAlice = await earnedEth(alice, a)
		const priorBob = await earnedEth(bob, b)
		expect(priorAlice).toBe(0n)
		// Bob earns his half of total commitment, never Alice's unhealthy share.
		expect(priorBob).toBe(((restoredAt - fundedAt) * E) / 2n)
		await getAnvilWindowEthereum().advanceTime(100n)
		await writeContractAndWait(alice, () => alice.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'checkpoint' }))
		const laterAlice = (await earnedEth(alice, a)) - priorAlice
		const laterBob = (await earnedEth(bob, b)) - priorBob
		expect(laterAlice).toBeGreaterThanOrEqual(50n * E)
		expect(laterAlice).toBe(laterBob)
	})

	test('a partial takeover retains every unawarded REP as collateral for the source owner', async () => {
		await deposit(alice, 105n * E)
		await deposit(keeper, 200n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await price(2n * E)
		await cure(id)
		await getAnvilWindowEthereum().advanceTime(1800n)
		await writeContractAndWait(keeper, () => keeper.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'takeOver', args: [id, 50n * E, 1n, 200n * E] }))
		const source = await position(id)
		const receiver = await position((await account(keeper)).positionId)
		const award = receiver.rep - 200n * E
		expect(award).toBeGreaterThan(0n)
		expect(award).toBeLessThan((105n * E) / 2n)
		expect(source).toMatchObject({ rep: 105n * E - award, commitment: 50n * E })
		expect((await account(alice)).freeAttoRep).toBe(0n)
		expect(source.rep + receiver.rep).toBe(305n * E)
	})

	test('owner authorization prevents a one-attoREP donation from griefing exact takeover collateral consent', async () => {
		await deposit(alice, 105n * E)
		await deposit(keeper, 200n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await price(2n * E)
		await cure(id)
		await getAnvilWindowEthereum().advanceTime(3601n)
		await expect(writeContractAndWait(bob, () => bob.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'depositFor', args: [keeper.account.address, 1n] }))).rejects.toThrow('Invalid capital deposit')
		expect((await account(keeper)).freeAttoRep).toBe(200n * E)
		expect((await account(keeper)).positionId).toBe(0n)
		await expect(writeContractAndWait(keeper, () => keeper.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'takeOver', args: [id, 50n * E, 1n, 200n * E - 1n] }))).rejects.toThrow('Receiver consent exceeded')
		await writeContractAndWait(keeper, () => keeper.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'takeOver', args: [id, 50n * E, 1n, 200n * E] }))
		expect((await account(keeper)).freeAttoRep).toBe(0n)
		expect((await position((await account(keeper)).positionId)).commitment).toBe(50n * E)
	})

	test('owner authorization rejects third-party live collateral deposits while allowing an owner to repair health', async () => {
		await deposit(alice, 105n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await price((3n * E) / 2n)
		expect(await healthy()).toBe(0n)
		await expect(writeContractAndWait(bob, () => bob.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'depositFor', args: [alice.account.address, 1n] }))).rejects.toThrow('Invalid capital deposit')
		expect((await position(id)).rep).toBe(105n * E)
		expect((await account(alice)).freeAttoRep).toBe(0n)
		await deposit(alice, 53n * E)
		expect((await position(id)).rep).toBe(158n * E)
		expect(await healthy()).toBe(100n * E)
	})

	test('an existing retiring receiver must relinquish its cohort before assuming active obligations', async () => {
		await deposit(alice, 105n * E)
		await deposit(keeper, 210n * E)
		const source = await authorize(alice, 100n * E)
		const receiver = await authorize(keeper, 100n * E)
		await demand(200n * E)
		await retire(keeper, receiver)
		await price(2n * E)
		await cure(source)
		await getAnvilWindowEthereum().advanceTime(3601n)
		const takeover = () => writeContractAndWait(keeper, () => keeper.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'takeOver', args: [source, 50n * E, 1n, 0n] }))
		await expect(takeover()).rejects.toThrow('Receiver retirement differs')
		expect((await position(receiver)).commitment).toBe(100n * E)
		await writeContractAndWait(keeper, () => keeper.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'cancelRetirement', args: [receiver] }))
		await deposit(keeper, 105n * E)
		await takeover()
		expect((await account(keeper)).positionId).toBe(receiver)
		expect(await position(receiver)).toMatchObject({ commitment: 150n * E, batch: 0n })
	})

	test('REP earnings remain claimable income and cannot conceal an undercollateralized commitment', async () => {
		await deposit(alice, 105n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'fundRepFees', args: [86400n * E] }))
		await getAnvilWindowEthereum().advanceTime(200n)
		await price(2n * E)
		expect((await position(id)).repFees).toBeGreaterThanOrEqual(200n * E)
		expect((await position(id)).rep).toBe(105n * E)
		expect(await healthy()).toBe(0n)
		expect([...(await alice.readContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'ownerCollateral', args: [alice.account.address] }))]).toEqual([105n * E, 100n * E, 0n])
		const before = await alice.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [alice.account.address] })
		await writeContractAndWait(alice, () => alice.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'claimEarnings' }))
		const after = await alice.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [alice.account.address] })
		expect(after - before).toBeGreaterThanOrEqual(200n * E)
		expect((await position(id)).rep).toBe(105n * E)
		expect(await healthy()).toBe(0n)
		await cure(id)
		expect(await alice.readContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBeGreaterThan(0n)
	})

	test('withdrawing live collateral requires a fresh price while uncommitted owners can exit', async () => {
		await deposit(alice, 200n * E)
		await deposit(bob, 77n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await price(E, 5)
		await getAnvilWindowEthereum().advanceTime(6n)
		expect([...(await alice.readContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'ownerCollateral', args: [alice.account.address] }))]).toEqual([200n * E, 100n * E, 0n])
		expect([...(await alice.readContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'ownerCollateral', args: [bob.account.address] }))]).toEqual([77n * E, 0n, 77n * E])
		await expect(withdraw(alice, 1n)).rejects.toThrow('Capital price stale')
		await withdraw(bob, 77n * E)
		expect((await account(bob)).freeAttoRep).toBe(0n)
		expect((await position(id)).rep).toBe(200n * E)
	})

	test('fully retired principal remains withdrawable after the oracle expires', async () => {
		await deposit(alice, 105n * E)
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await retire(alice, id)
		await demand(0n)
		expect(await position(id)).toMatchObject({ commitment: 0n, releasedRep: 105n * E })
		await price(E, 5)
		await getAnvilWindowEthereum().advanceTime(6n)
		await withdraw(alice, 105n * E)
		expect((await account(alice)).freeAttoRep).toBe(0n)
		expect((await account(alice)).positionId).toBe(0n)
	})

	test('a chosen health buffer constrains withdrawals without moving the liquidation floor', async () => {
		await deposit(alice, 147n * E)
		await writeContractAndWait(alice, () => alice.writeContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'setHealthTarget', args: [12_000n] }))
		const id = await authorize(alice, 100n * E)
		await demand(100n * E)
		await withdraw(alice, 21n * E)
		expect(await position(id)).toMatchObject({ rep: 126n * E, commitment: 100n * E })
		expect((await account(alice)).targetHealthFactorBps).toBe(12_000n)
		await expect(withdraw(alice, 1n)).rejects.toThrow('Owner collateral too low')
		await price((11n * E) / 10n)
		await cure(id)
		expect(await alice.readContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBe(0n)
	})

	test('fork snapshots include all committed owner principal while zero-commitment cash stays withdrawable', async () => {
		await deposit(alice, 105n * E)
		await authorize(alice, 100n * E)
		await deposit(alice, 53n * E)
		await deposit(bob, 77n * E)
		const forkTime = (await alice.getBlock()).timestamp
		await writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setFork', args: [forkTime] }))
		expect(await alice.readContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'frozenBackingAttoRep' })).toBe(158n * E)
		expect([...(await alice.readContract({ abi: ledgerArtifact.abi, address: ledger, functionName: 'ownerCollateral', args: [alice.account.address] }))]).toEqual([158n * E, 100n * E, 0n])
		await writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'exportChoice', args: [alice.account.address] }))
		await expect(withdraw(alice, 1n)).rejects.toThrow('Capital universe inactive')
		await withdraw(bob, 77n * E)
		expect((await account(bob)).freeAttoRep).toBe(0n)
	})
})
